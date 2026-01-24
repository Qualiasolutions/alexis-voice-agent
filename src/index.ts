/**
 * Alexis Voice Agent - Cloudflare Worker
 *
 * Retell AI webhook handler for armenius.cy PrestaShop
 * Optimized for ultra-low latency (~2ms cold start)
 *
 * Performance optimizations:
 * - 5-second timeout on all API calls
 * - Parallel API calls where possible
 * - Minimal data fetching (only required fields)
 * - Cached carrier lookup
 */

export interface Env {
  PRESTASHOP_API_KEY: string;
  PRESTASHOP_URL: string;
  RETELL_API_KEY?: string; // Optional: for Retell webhook signature verification
}

// Voice optimization constants
const VOICE_ITEM_LIMIT = 5;      // Max items to read aloud in orders
const VOICE_SEARCH_DEFAULT = 5;  // Default search results for voice
const VOICE_SEARCH_MAX = 10;     // Max products in search results

// PrestaShop API response interfaces
interface PrestaShopOrder {
  id: number;
  reference: string;
  current_state: number;
  total_paid: string;
  date_add: string;
  payment: string;
  associations?: {
    order_rows: OrderRow[] | OrderRow;
  };
}

interface OrderRow {
  product_name: string;
  product_quantity: string;
}

interface PrestaShopCustomer {
  id: number;
}

interface PrestaShopProduct {
  id: number;
  name: string | { id: number; value: string }[];
  price: string;
}

interface PrestaShopStockAvailable {
  quantity: string;
}

interface PrestaShopCarrier {
  id: string;
  name: string;
}

interface PrestaShopOrderCarrier {
  id_carrier: string;
  tracking_number: string;
}

// Order state mapping (pre-computed, zero runtime cost)
const ORDER_STATES: Record<number, string> = {
  1: 'awaiting check payment',
  2: 'payment accepted',
  3: 'being processed',
  4: 'shipped',
  5: 'delivered',
  6: 'cancelled',
  7: 'refunded',
  8: 'payment error',
  9: 'being prepared',
  10: 'awaiting bank transfer',
  11: 'payment accepted',
  12: 'on backorder',
  13: 'awaiting COD validation',
  14: 'delivered and paid',
  15: 'invoice sent',
  17: 'ready for pickup',
  19: 'partially refunded',
  20: 'awaiting payment capture',
  21: 'awaiting SEPA payment'
};

// In-memory caches (persist across requests in same isolate)
let carrierCache: Map<number, string> = new Map();
let carrierCacheTime = 0;
const CARRIER_CACHE_TTL = 3600000; // 1 hour

// Product cache for frequently accessed products (5 min TTL, max 100 items)
let productCache: Map<number, { name: string; price: string; time: number }> = new Map();
const PRODUCT_CACHE_TTL = 300000; // 5 minutes
const PRODUCT_CACHE_MAX = 100;

// Search result cache (30s TTL, max 50 queries) - reduces duplicate PrestaShop API calls
let searchCache: Map<string, { ids: number[]; time: number }> = new Map();
const SEARCH_CACHE_TTL = 30000; // 30 seconds
const SEARCH_CACHE_MAX = 50;

// Pre-compiled regex patterns (avoids regex compilation on each call)
const REGEX_ORDER_REF = /^[A-Z0-9]{9}$/i;
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REGEX_FILTER_CHARS = /[\[\]|,]/g;
const REGEX_NUMERIC = /^\d+$/;
const REGEX_QUOTES = /['"]/g;
const REGEX_SPECIAL_CHARS = /[^\w\s\-\.]/g;
const REGEX_WHITESPACE = /\s+/g;
const REGEX_GPU_SERIES = /\b(rtx|gtx|radeon)\s*(\d{2})\s*(series|line)?\b/i;
const REGEX_MEM_SPEC = /(\d+)\s*(gb|tb|mb)/i;
const REGEX_HAS_DIGIT = /\d/;
const REGEX_PHONE_CLEAN = /[\s\-\(\)\+]/g;

// TTS transformation regexes (pre-compiled for makeSpeechFriendly)
const REGEX_G_MODEL = /\bG(\d+)\b/g;
const REGEX_GB = /(\d+)\s*GB\b/gi;
const REGEX_TB = /(\d+)\s*TB\b/gi;
const REGEX_MB = /(\d+)\s*MB\b/gi;
const REGEX_DDR = /\bDDR(\d+)\b/gi;
const REGEX_PROC_FULL = /\bi(\d+)-(\d+)G(\d+)\b/gi;
const REGEX_PROC_SHORT = /\bi(\d+)-(\d+)\b/gi;

// Rate limiting (per-isolate, sliding window)
const RATE_LIMIT_REQUESTS = 100;  // Max requests per window
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute window
const rateLimitMap: Map<string, number[]> = new Map();

// Helper: Check rate limit for IP (sliding window algorithm)
function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  // Get existing timestamps for this IP
  let timestamps = rateLimitMap.get(ip) || [];

  // Remove expired timestamps (outside window)
  timestamps = timestamps.filter(ts => ts > windowStart);

  // Check if under limit
  const allowed = timestamps.length < RATE_LIMIT_REQUESTS;

  if (allowed) {
    // Add current timestamp
    timestamps.push(now);
    rateLimitMap.set(ip, timestamps);
  }

  // Calculate reset time (when oldest timestamp expires)
  const resetMs = timestamps.length > 0
    ? Math.max(0, timestamps[0] + RATE_LIMIT_WINDOW_MS - now)
    : 0;

  // Periodic cleanup: remove IPs with no recent requests (every ~100 checks)
  if (Math.random() < 0.01) {
    for (const [key, ts] of rateLimitMap.entries()) {
      if (ts.every(t => t <= windowStart)) {
        rateLimitMap.delete(key);
      }
    }
  }

  return {
    allowed,
    remaining: Math.max(0, RATE_LIMIT_REQUESTS - timestamps.length),
    resetMs
  };
}

// Cached auth header (computed once per isolate lifecycle)
let cachedAuth: string | null = null;
let cachedAuthKey: string | null = null;

// Helper: Get cached auth header
function getAuthHeader(apiKey: string): string {
  if (cachedAuth && cachedAuthKey === apiKey) {
    return cachedAuth;
  }
  const bytes = new TextEncoder().encode(`${apiKey}:`);
  const binString = Array.from(bytes, (x) => String.fromCodePoint(x)).join('');
  cachedAuth = `Basic ${btoa(binString)}`;
  cachedAuthKey = apiKey;
  return cachedAuth;
}

// Helper: Escape CDATA breakout sequences for XML safety
export function escapeCdata(text: string): string {
  return text.replace(/\]\]>/g, ']]]]><![CDATA[>');
}

// Helper: Validate order reference format (9 alphanumeric chars)
export function isValidOrderReference(ref: string): boolean {
  return REGEX_ORDER_REF.test(ref);
}

// Helper: Validate email format (basic check)
export function isValidEmail(email: string): boolean {
  return REGEX_EMAIL.test(email);
}

// Helper: Sanitize search query (remove PrestaShop filter operators)
export function sanitizeSearchQuery(query: string): string {
  return query.replace(REGEX_FILTER_CHARS, '').trim();
}

// Search query normalization for better matching
// Handles tech product naming conventions, series patterns, and common variations
interface NormalizedQuery {
  original: string;
  terms: string[];           // Individual significant terms
  variations: string[];      // Alternative search queries to try
}

// Stop words to remove from search (common words that don't help matching)
const SEARCH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
  'who', 'whom', 'this', 'that', 'these', 'those', 'am', 'is', 'are',
  'looking', 'want', 'need', 'find', 'search', 'show', 'get', 'any', 'some',
  'series', 'line', 'model', 'type', 'kind', 'version', 'gen', 'generation'
]);

// Tech brand names to preserve in searches
const TECH_BRANDS = new Set([
  'nvidia', 'geforce', 'rtx', 'gtx', 'radeon', 'amd', 'intel', 'arc',
  'asus', 'msi', 'gigabyte', 'evga', 'zotac', 'palit', 'pny', 'sapphire',
  'corsair', 'kingston', 'crucial', 'samsung', 'seagate', 'western', 'sandisk',
  'logitech', 'razer', 'steelseries', 'hyperx', 'cooler', 'nzxt', 'thermaltake',
  'dell', 'hp', 'lenovo', 'acer', 'asus', 'apple', 'microsoft', 'sony',
  'lg', 'benq', 'viewsonic', 'philips', 'aoc', 'alienware', 'predator'
]);


// Normalize search query for better matching
export function normalizeSearchQuery(rawQuery: string): NormalizedQuery {
  const original = rawQuery.trim().toLowerCase();
  const variations: string[] = [];

  // Remove special characters but preserve numbers and hyphens in model numbers
  let cleaned = original
    .replace(REGEX_QUOTES, '')           // Remove quotes
    .replace(REGEX_SPECIAL_CHARS, ' ')   // Keep alphanumeric, spaces, hyphens, dots
    .replace(REGEX_WHITESPACE, ' ')      // Normalize whitespace
    .trim();

  // Extract individual terms (filter stop words, keep brands and specs)
  const allTerms = cleaned.split(/\s+/);
  const terms = allTerms.filter(term => {
    if (term.length < 2) return false;
    if (SEARCH_STOP_WORDS.has(term)) return false;
    return true;
  });

  // Build search variations

  // Variation 1: Original cleaned query
  if (cleaned) variations.push(cleaned);

  // Variation 2: Just the significant terms joined
  if (terms.length > 1) {
    const termQuery = terms.join(' ');
    if (termQuery !== cleaned) variations.push(termQuery);
  }

  // Variation 3: Handle GPU series patterns (e.g., "rtx 50 series" → "rtx 5070", "rtx 5080")
  const gpuSeriesMatch = original.match(REGEX_GPU_SERIES);
  if (gpuSeriesMatch) {
    const prefix = gpuSeriesMatch[1].toUpperCase();
    const seriesNum = gpuSeriesMatch[2];
    // Generate specific model numbers for the series
    const suffixes = ['60', '70', '80', '90', '70 ti', '80 super'];
    for (const suffix of suffixes) {
      variations.push(`${prefix} ${seriesNum}${suffix}`);
    }
  }

  // Variation 4: Handle memory/storage specs (e.g., "16gb ram" → "16gb", "16 gb")
  const memMatch = original.match(REGEX_MEM_SPEC);
  if (memMatch) {
    const size = memMatch[1];
    const unit = memMatch[2].toUpperCase();
    // Try with and without space
    variations.push(`${size}${unit}`);
    variations.push(`${size} ${unit}`);
  }

  // Variation 5: Brand + category combinations
  const foundBrands = terms.filter(t => TECH_BRANDS.has(t));
  const nonBrandTerms = terms.filter(t => !TECH_BRANDS.has(t) && !SEARCH_STOP_WORDS.has(t));

  if (foundBrands.length > 0 && nonBrandTerms.length > 0) {
    // Try brand + each significant term
    for (const brand of foundBrands) {
      for (const term of nonBrandTerms.slice(0, 2)) {
        variations.push(`${brand} ${term}`);
      }
    }
  }

  // Variation 6: Individual significant terms (for fallback)
  // Only add terms that are likely product identifiers (brands, model numbers)
  for (const term of terms) {
    if (TECH_BRANDS.has(term) || REGEX_HAS_DIGIT.test(term)) {
      if (!variations.includes(term)) variations.push(term);
    }
  }

  // Deduplicate variations while preserving order
  const uniqueVariations = [...new Set(variations)];

  return {
    original,
    terms,
    variations: uniqueVariations
  };
}

// Helper: Verify Retell webhook signature (HMAC-SHA256)
async function verifyRetellSignature(
  request: Request,
  body: string,
  apiKey: string
): Promise<boolean> {
  const signature = request.headers.get('x-retell-signature');
  if (!signature) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(apiKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    // Compute expected signature
    const expectedSig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expectedHex = Array.from(new Uint8Array(expectedSig))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    return signature === expectedHex;
  } catch (error) {
    console.warn('Retell webhook signature verification failed:', error);
    return false;
  }
}

// Helper: PrestaShop API call with timeout, caching, and improved error handling
async function prestashopFetch(env: Env, endpoint: string, timeoutMs = 5000): Promise<any> {
  const url = `${env.PRESTASHOP_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}output_format=JSON`;

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': getAuthHeader(env.PRESTASHOP_API_KEY),
        'Accept-Encoding': 'gzip, deflate' // Request compression
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Log response body for debugging API errors
      const errorText = await response.text().catch(() => 'Unable to read error body');
      console.error(`PrestaShop API error: ${response.status} - ${errorText.substring(0, 500)}`);
      throw new Error(`PrestaShop API error: ${response.status}`);
    }

    return response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`PrestaShop API timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// Helper: Extract product name from multilingual field
function extractProductName(nameField: any): string {
  if (Array.isArray(nameField)) {
    return nameField.find((n: any) => n.id === 1)?.value || nameField[0]?.value || 'Unknown';
  }
  return nameField || 'Unknown';
}

// Helper: Make product name TTS-friendly (fix pronunciation issues)
export function makeSpeechFriendly(name: string): string {
  return name
    // Fix model numbers like "G8" → "G 8" (not "grams")
    .replace(REGEX_G_MODEL, 'G $1')
    // Fix storage/RAM: "16GB" → "16 gigabytes", "256GB" → "256 gigabytes"
    .replace(REGEX_GB, '$1 gigabytes')
    .replace(REGEX_TB, '$1 terabytes')
    .replace(REGEX_MB, '$1 megabytes')
    // Fix RAM type: "DDR4" → "D D R 4"
    .replace(REGEX_DDR, 'D D R $1')
    // Fix processor names: "i5-1145G7" → "i5 1145 G 7"
    .replace(REGEX_PROC_FULL, 'i$1 $2 G $3')
    .replace(REGEX_PROC_SHORT, 'i$1 $2')
    // Fix SSD pronunciation
    .replace(/\bSSD\b/g, 'S S D')
    // Fix common abbreviations
    .replace(/\bHDD\b/g, 'H D D')
    .replace(/\bLCD\b/g, 'L C D')
    .replace(/\bLED\b/g, 'L E D')
    .replace(/\bUSB\b/g, 'U S B')
    .replace(/\bHDMI\b/g, 'H D M I');
}

// Helper: Shorten product name for listings (brand + model only)
export function shortenForListing(name: string): string {
  // Take first 4-5 words, skip specs like dimensions, colors, etc.
  const words = name.split(/[\s,\-–]+/).filter(w => w.length > 0);

  // Find where specs start (numbers with units, dimensions, etc.)
  let cutoff = words.length;
  for (let i = 0; i < words.length; i++) {
    // Stop at technical specs (RAM, storage, dimensions, etc.)
    if (/^\d+\s*(GB|TB|MB|mm|cm|MHz|W|mAh)/i.test(words[i]) ||
        /^\d+x\d+/i.test(words[i]) ||
        /^(RGB|LED|LCD|USB|HDMI|DDR\d)/i.test(words[i])) {
      cutoff = Math.max(3, i); // Keep at least 3 words
      break;
    }
  }

  // Take brand + model (max 5 words before specs)
  const short = words.slice(0, Math.min(cutoff, 5)).join(' ');
  return short;
}

// Helper: Format stock result for voice output (DRY helper)
function formatStockResult(productId: number, productName: string, quantity: number) {
  return {
    success: true,
    product_id: productId,
    name: productName,
    quantity,
    in_stock: quantity > 0,
    message: quantity > 0
      ? `We have ${quantity} units in stock. Please check the product page for delivery times.`
      : 'Sorry, this product is currently out of stock',
    note: 'Stock availability does not guarantee instant delivery. Check product page for delivery times.'
  };
}

// Tool: Get Order Status (optimized - includes order items for "what did I order?" questions)
async function getOrderStatus(env: Env, args: { reference?: string; email?: string; phone?: string }) {
  try {
    let order: PrestaShopOrder;

    if (args.reference) {
      // Validate order reference format (9 alphanumeric characters)
      if (!isValidOrderReference(args.reference)) {
        return { success: false, message: 'Order reference should be 9 characters like ABCDEFGHI. Please check and try again.' };
      }

      // Fetch order with minimal fields for performance
      const data = await prestashopFetch(env, `/orders?filter[reference]=${args.reference}&display=[id,reference,current_state,total_paid,date_add,payment,associations]`);
      if (!data.orders?.length) {
        return { success: false, message: `No order found with reference ${args.reference}` };
      }
      order = data.orders[0];
    } else if (args.email) {
      // Validate email format
      if (!isValidEmail(args.email)) {
        return { success: false, message: 'That doesn\'t look like a valid email address. Please try again.' };
      }

      // Step 1: Get customer ID
      const customers = await prestashopFetch(env, `/customers?filter[email]=${encodeURIComponent(args.email)}&display=[id]`);
      if (!customers.customers?.length) {
        return { success: false, message: `No customer found with email ${args.email}` };
      }

      // Step 2: Get latest order with minimal fields for performance
      const orders = await prestashopFetch(env, `/orders?filter[id_customer]=${customers.customers[0].id}&display=[id,reference,current_state,total_paid,date_add,payment,associations]&sort=[id_DESC]&limit=1`);
      if (!orders.orders?.length) {
        return { success: false, message: 'No orders found for this customer' };
      }
      order = orders.orders[0];
    } else if (args.phone) {
      // Clean phone number (remove spaces, dashes, parentheses)
      const cleanPhone = args.phone.replace(REGEX_PHONE_CLEAN, '');

      // Search in addresses table - check both phone and phone_mobile IN PARALLEL
      // This saves ~100-150ms compared to sequential lookups
      const [phoneAddresses, mobileAddresses] = await Promise.all([
        prestashopFetch(env, `/addresses?filter[phone]=%25${encodeURIComponent(cleanPhone)}%25&display=[id_customer]`),
        prestashopFetch(env, `/addresses?filter[phone_mobile]=%25${encodeURIComponent(cleanPhone)}%25&display=[id_customer]`)
      ]);

      // Use first match found (phone field takes priority)
      const customerId = phoneAddresses.addresses?.[0]?.id_customer ||
                         mobileAddresses.addresses?.[0]?.id_customer ||
                         null;

      if (!customerId) {
        return { success: false, message: `No customer found with phone number ${args.phone}. Try your email or order reference instead.` };
      }

      // Get latest order for this customer
      const orders = await prestashopFetch(env, `/orders?filter[id_customer]=${customerId}&display=[id,reference,current_state,total_paid,date_add,payment,associations]&sort=[id_DESC]&limit=1`);
      if (!orders.orders?.length) {
        return { success: false, message: 'No orders found for this phone number' };
      }
      order = orders.orders[0];
    } else {
      return { success: false, message: 'Please provide an order reference number, email, or phone number' };
    }

    // Extract order items for "what did I order?" questions
    const items: string[] = [];
    if (order.associations?.order_rows) {
      const rows = Array.isArray(order.associations.order_rows)
        ? order.associations.order_rows
        : [order.associations.order_rows];
      for (const row of rows.slice(0, VOICE_ITEM_LIMIT)) {
        if (row.product_name) {
          const qty = parseInt(row.product_quantity, 10) || 1;
          items.push(qty > 1 ? `${qty}x ${shortenForListing(row.product_name)}` : shortenForListing(row.product_name));
        }
      }
    }

    return {
      success: true,
      reference: order.reference,
      status: ORDER_STATES[order.current_state] || 'unknown',
      total: `€${parseFloat(order.total_paid).toFixed(2)}`,
      date: new Date(order.date_add).toLocaleDateString('en-GB'),
      payment: order.payment,
      items: items.length > 0 ? items : undefined,
      item_count: items.length > 0 ? items.length : undefined
    };
  } catch (error) {
    console.error('getOrderStatus error:', error);
    return { success: false, message: 'Unable to retrieve order information. Please try again.' };
  }
}

// Helper: Get cached product info or fetch
async function getProductInfo(env: Env, productId: number): Promise<{ name: string; price: string } | null> {
  const now = Date.now();
  const cached = productCache.get(productId);

  if (cached && (now - cached.time) < PRODUCT_CACHE_TTL) {
    return { name: cached.name, price: cached.price };
  }

  try {
    const product = await prestashopFetch(env, `/products/${productId}?display=[id,name,price]`);
    const productInfo = product.products?.[0] || product.product;
    if (!productInfo) return null;

    const name = makeSpeechFriendly(extractProductName(productInfo.name));
    const price = `€${parseFloat(productInfo.price || 0).toFixed(2)}`;

    // Cache with FIFO eviction (oldest entry removed when full)
    if (productCache.size >= PRODUCT_CACHE_MAX) {
      const oldestKey = productCache.keys().next().value;
      if (oldestKey !== undefined) productCache.delete(oldestKey);
    }
    productCache.set(productId, { name, price, time: now });

    return { name, price };
  } catch (error) {
    console.warn('getProductInfo failed for product', productId, error);
    return null;
  }
}

// Tool: Check Product Stock (optimized - parallel calls, caching)
async function checkProductStock(env: Env, args: { product_id?: number; product_name?: string }) {
  try {
    let productId = args.product_id;
    let productName: string;

    if (args.product_name && !args.product_id) {
      // Sanitize product name to prevent filter injection
      const safeName = sanitizeSearchQuery(args.product_name);
      if (!safeName) {
        return { success: false, message: 'Please provide a product name to check.' };
      }

      // Use PrestaShop's /search endpoint (language=1 for English)
      const searchResults = await prestashopFetch(env, `/search?language=1&query=${encodeURIComponent(safeName)}`);
      if (!searchResults.products?.length) {
        return { success: false, message: `No product found matching "${safeName}"` };
      }

      // Get first matching product's details
      productId = searchResults.products[0].id;
      const productData = await prestashopFetch(env, `/products/${productId}?display=[id,name]`);
      const productInfo = productData.products?.[0] || productData.product;
      productName = productInfo ? makeSpeechFriendly(extractProductName(productInfo.name)) : 'Unknown product';

      // Fetch stock after we have the ID (use main shop, not B2B)
      // Use display=[quantity] instead of display=full for performance
      const stock = await prestashopFetch(env, `/stock_availables?filter[id_product]=[${productId}]&filter[id_product_attribute]=[0]&display=[quantity]`);
      if (!stock.stock_availables?.length) {
        return { success: false, message: 'Unable to check stock for this product' };
      }
      const quantity = parseInt(stock.stock_availables[0].quantity, 10);

      return formatStockResult(productId!, productName, quantity);
    }

    // Validate product_id before API calls
    if (!productId || !Number.isInteger(productId) || productId <= 0) {
      return { success: false, message: 'Please provide a valid product ID or name to check stock.' };
    }

    // Have product ID - fetch product info and stock IN PARALLEL (use main shop for stock)
    // Use display=[quantity] instead of display=full for performance
    const [productInfo, stock] = await Promise.all([
      getProductInfo(env, productId),
      prestashopFetch(env, `/stock_availables?filter[id_product]=[${productId}]&filter[id_product_attribute]=[0]&display=[quantity]`)
    ]);

    if (!stock.stock_availables?.length) {
      return { success: false, message: 'Unable to check stock for this product' };
    }

    const quantity = parseInt(stock.stock_availables[0].quantity, 10);
    productName = productInfo?.name || 'Unknown product';

    return formatStockResult(productId, productName, quantity);
  } catch (error) {
    console.error('checkProductStock error:', error);
    return { success: false, message: 'Unable to check product availability. Please try again.' };
  }
}

// Helper: Get carrier name with caching
async function getCarrierName(env: Env, carrierId: number): Promise<string> {
  const now = Date.now();

  // Check if cache is still valid
  if (now - carrierCacheTime < CARRIER_CACHE_TTL && carrierCache.has(carrierId)) {
    return carrierCache.get(carrierId)!;
  }

  // Fetch all carriers and cache them (single call, reused across requests)
  try {
    const carriers = await prestashopFetch(env, `/carriers?display=[id,name]`);
    carrierCache = new Map();
    carrierCacheTime = now;

    if (carriers.carriers) {
      for (const c of carriers.carriers) {
        carrierCache.set(parseInt(c.id, 10), c.name || 'Standard shipping');
      }
    }

    return carrierCache.get(carrierId) || 'Standard shipping';
  } catch (error) {
    console.warn('getCarrierName failed for carrier', carrierId, error);
    return 'Standard shipping';
  }
}

// Tool: Get Tracking Info (optimized - parallel carrier cache refresh + order lookup)
async function getTrackingInfo(env: Env, args: { reference?: string; order_id?: number }) {
  try {
    let orderId = args.order_id;

    // If we need to look up by reference, do that first
    if (args.reference && !args.order_id) {
      // Validate order reference format
      if (!isValidOrderReference(args.reference)) {
        return { success: false, message: 'Order reference should be 9 characters like ABCDEFGHI. Please check and try again.' };
      }

      const orders = await prestashopFetch(env, `/orders?filter[reference]=${args.reference}&display=[id]`);
      if (!orders.orders?.length) {
        return { success: false, message: `No order found with reference ${args.reference}` };
      }
      orderId = orders.orders[0].id;
    }

    // Pre-warm carrier cache in parallel with order_carriers fetch if cache is stale
    const now = Date.now();
    const needsCacheRefresh = (now - carrierCacheTime) >= CARRIER_CACHE_TTL;

    const [carriersResult] = await Promise.all([
      prestashopFetch(env, `/order_carriers?filter[id_order]=${orderId}&display=[id_carrier,tracking_number]`),
      // Refresh carrier cache in background if stale (don't await result)
      needsCacheRefresh ? prestashopFetch(env, `/carriers?display=[id,name]`).then(data => {
        carrierCache = new Map();
        carrierCacheTime = Date.now();
        if (data.carriers) {
          for (const c of data.carriers) {
            carrierCache.set(parseInt(c.id, 10), c.name || 'Standard shipping');
          }
        }
      }).catch(() => {}) : Promise.resolve()
    ]);

    if (!carriersResult.order_carriers?.length) {
      return { success: false, message: 'No shipping information available yet for this order' };
    }

    const orderCarrier = carriersResult.order_carriers[0];
    const trackingNumber = orderCarrier.tracking_number;

    // Use cached carrier name lookup (cache was refreshed in parallel if needed)
    const carrierName = orderCarrier.id_carrier
      ? await getCarrierName(env, parseInt(orderCarrier.id_carrier, 10))
      : 'Standard shipping';

    return {
      success: true,
      carrier: carrierName,
      tracking_number: trackingNumber || 'Not yet assigned',
      has_tracking: !!trackingNumber,
      message: trackingNumber
        ? `Your order is being shipped via ${carrierName}. Tracking number: ${trackingNumber}`
        : `Your order is being prepared for shipping via ${carrierName}. Tracking will be available soon.`
    };
  } catch (error) {
    console.error('getTrackingInfo error:', error);
    return { success: false, message: 'Unable to retrieve tracking information. Please try again.' };
  }
}

// Helper: Construct product URL from ID
function getProductUrl(env: Env, productId: number): string {
  // Use controller-based URL (guaranteed to work with any PrestaShop setup)
  const baseUrl = env.PRESTASHOP_URL.replace('/api', '');
  return `${baseUrl}/index.php?id_product=${productId}&controller=product`;
}

// Helper: Execute a single PrestaShop search query (with caching)
async function executeSearch(env: Env, query: string): Promise<number[]> {
  const sanitized = sanitizeSearchQuery(query);
  if (!sanitized) return [];

  const cacheKey = sanitized.toLowerCase();
  const now = Date.now();

  // Check cache first
  const cached = searchCache.get(cacheKey);
  if (cached && (now - cached.time) < SEARCH_CACHE_TTL) {
    return cached.ids;
  }

  try {
    const encoded = encodeURIComponent(sanitized);
    const results = await prestashopFetch(env, `/search?language=1&query=${encoded}`);
    const ids = results.products?.map((p: any) => p.id) || [];

    // Cache result with FIFO eviction
    if (searchCache.size >= SEARCH_CACHE_MAX) {
      const oldestKey = searchCache.keys().next().value;
      if (oldestKey !== undefined) searchCache.delete(oldestKey);
    }
    searchCache.set(cacheKey, { ids, time: now });

    return ids;
  } catch (error) {
    console.warn(`Search failed for "${query}":`, error);
    return [];
  }
}

// Tool: Search Products (multi-strategy search with fallbacks)
// Handles: exact matches, partial matches, series patterns, tech specs
async function searchProducts(env: Env, args: { query: string; limit?: number }) {
  try {
    const limit = Math.min(args.limit || VOICE_SEARCH_DEFAULT, VOICE_SEARCH_MAX);
    const rawQuery = args.query?.trim() || '';

    if (!rawQuery) {
      return { success: false, message: 'Please tell me what product you\'re looking for.' };
    }

    // Fast path: If query looks like a product ID/SKU (numeric), fetch directly
    if (REGEX_NUMERIC.test(rawQuery)) {
      try {
        const product = await prestashopFetch(env, `/products/${rawQuery}?display=[id,name,price]`);
        const p = product.products?.[0] || product.product;
        if (p) {
          return {
            success: true,
            count: 1,
            products: [{
              id: p.id,
              name: makeSpeechFriendly(extractProductName(p.name)),
              price: `€${parseFloat(p.price).toFixed(2)}`,
              url: getProductUrl(env, p.id)
            }],
            note: 'Prices shown exclude VAT. Check product page for delivery times.'
          };
        }
      } catch (error) {
        console.warn('Direct product lookup failed, falling back to search:', error);
      }
    }

    // Normalize query and generate search variations
    const normalized = normalizeSearchQuery(rawQuery);

    if (normalized.variations.length === 0) {
      return { success: false, message: 'Please provide a product name to search for.' };
    }

    // Pre-compute brand terms once (used for filtering and fetch limit)
    const brandTerms = normalized.terms.filter(t => TECH_BRANDS.has(t));
    const hasBrandTerms = brandTerms.length > 0;

    // Multi-strategy search with early termination
    // Try first variation alone - if it returns enough results, skip parallel searches
    const productScores = new Map<number, number>();
    const firstResult = await executeSearch(env, normalized.variations[0]);

    for (const id of firstResult) {
      productScores.set(id, 1);
    }

    // Only do parallel searches if first variation didn't return enough results
    // This saves 2 API calls in the common case
    const needMoreResults = productScores.size < (hasBrandTerms ? 10 : 5);

    if (needMoreResults && normalized.variations.length > 1) {
      const additionalVariations = normalized.variations.slice(1, 4);
      const additionalResults = await Promise.all(
        additionalVariations.map(v => executeSearch(env, v))
      );

      for (const ids of additionalResults) {
        for (const id of ids) {
          productScores.set(id, (productScores.get(id) || 0) + 1);
        }
      }
    }

    // Fallback only if still no results
    if (productScores.size === 0 && normalized.variations.length > 4) {
      const fallbackVariations = normalized.variations.slice(4, 7);
      const fallbackResults = await Promise.all(
        fallbackVariations.map(v => executeSearch(env, v))
      );

      for (const ids of fallbackResults) {
        for (const id of ids) {
          productScores.set(id, (productScores.get(id) || 0) + 1);
        }
      }
    }

    if (productScores.size === 0) {
      // Provide helpful message with what we searched for
      const searchedTerms = normalized.terms.slice(0, 3).join(', ');
      return {
        success: false,
        message: `No products found matching "${rawQuery}". I searched for: ${searchedTerms}. Try being more specific with the product name or model number.`
      };
    }

    // Sort by score (descending) and take top results
    // Fetch more candidates if we'll be filtering by brand (to ensure enough results after filtering)
    const fetchLimit = hasBrandTerms ? Math.max(limit * 3, 15) : limit;

    const sortedIds = [...productScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, fetchLimit)
      .map(([id]) => id);

    // Fetch product details for matched IDs
    const search = await prestashopFetch(
      env,
      `/products?filter[id]=[${sortedIds.join('|')}]&display=[id,name,price]`
    );

    if (!search.products?.length) {
      return { success: false, message: `No products found matching "${rawQuery}"` };
    }

    // Maintain score-based ordering (PrestaShop may return in different order)
    const productMap = new Map(search.products.map((p: any) => [p.id, p]));
    let orderedProducts = sortedIds
      .map(id => productMap.get(id))
      .filter(Boolean);

    // Post-filter: If user specified a brand, filter to only products where brand is primary
    // This fixes PrestaShop's OR-based search returning unrelated products
    // (e.g., "asus laptop" returning cables that are "compatible with Asus")
    if (hasBrandTerms) {
      const filteredProducts = orderedProducts.filter((p: any) => {
        const productName = extractProductName(p.name).toLowerCase();
        // Brand must appear in the first 50 characters (primary position)
        // This filters out accessories "for Brand" or "compatible with Brand"
        const primaryPart = productName.slice(0, 50);
        return brandTerms.some(brand => primaryPart.includes(brand));
      });

      // If no products match the brand, tell the user clearly
      if (filteredProducts.length === 0) {
        const brandList = brandTerms.join(', ').toUpperCase();
        return {
          success: false,
          message: `No ${brandList} products found matching "${rawQuery}". Try searching without the brand name, or check if we carry ${brandList} products.`
        };
      }

      orderedProducts = filteredProducts.slice(0, limit);
    }

    // For multiple products: use short names for natural listing
    // For single product: use full TTS-friendly name
    const isList = orderedProducts.length > 1;

    const products = orderedProducts.map((p: any) => {
      const fullName = extractProductName(p.name);
      return {
        id: p.id,
        name: isList ? shortenForListing(fullName) : makeSpeechFriendly(fullName),
        price: `€${parseFloat(p.price).toFixed(2)}`,
        url: getProductUrl(env, p.id)
      };
    });

    return {
      success: true,
      count: products.length,
      products: products,
      note: 'Prices shown exclude VAT. Check product page for delivery times.'
    };
  } catch (error) {
    console.error('searchProducts error:', error);
    return { success: false, message: 'Unable to search products. Please try again.' };
  }
}

// Tool: Create Support Ticket (optimized - with timeout, XML injection protected)
async function createSupportTicket(env: Env, args: { order_id?: number; message: string; customer_email?: string }) {
  try {
    // Validate message is not empty
    if (!args.message?.trim()) {
      return { success: false, message: 'Please describe your issue so we can help you.' };
    }

    const url = `${env.PRESTASHOP_URL}/messages?output_format=JSON`;

    // Escape CDATA breakout sequences to prevent XML injection
    const safeMessage = escapeCdata(args.message);
    const safeOrderId = args.order_id ? String(Math.abs(Math.floor(args.order_id))) : '';

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <message>
    <id_order>${safeOrderId}</id_order>
    <message><![CDATA[${safeMessage}\n\n[Created via Alexis Voice Agent]]]></message>
    <private>0</private>
  </message>
</prestashop>`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': getAuthHeader(env.PRESTASHOP_API_KEY),
        'Content-Type': 'application/xml'
      },
      body: xml,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to create ticket: ${response.status}`);
    }

    return {
      success: true,
      message: 'I have created a support ticket for you. Our team will follow up within 24 hours.'
    };
  } catch (error) {
    console.error('createSupportTicket error:', error);
    return {
      success: false,
      message: 'I was unable to create the support ticket automatically. Please email support@armenius.cy or call during business hours.'
    };
  }
}

// Pre-built responses for fast paths
const RETELL_JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
};

const RETELL_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Retell-Signature'
};

// Pre-stringified responses for common cases
const METHOD_NOT_ALLOWED = JSON.stringify({ error: 'Method not allowed' });
const UNAUTHORIZED = JSON.stringify({ error: 'Unauthorized' });
const RATE_LIMITED = JSON.stringify({ error: 'Too many requests' });
const INTERNAL_ERROR = JSON.stringify({ error: 'Internal server error' });

// Tool name mapping for Retell path-based routing
const RETELL_TOOLS: Record<string, (env: Env, args: any) => Promise<any>> = {
  'getOrderStatus': getOrderStatus,
  'checkProductStock': checkProductStock,
  'getTrackingInfo': getTrackingInfo,
  'searchProducts': searchProducts,
  'createSupportTicket': createSupportTicket
};

// Main handler - Retell AI webhook
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const startTime = Date.now();
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight - fastest path
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: RETELL_CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response(METHOD_NOT_ALLOWED, { status: 405, headers: RETELL_JSON_HEADERS });
    }

    // Rate limiting (100 requests/minute per IP)
    const clientIp = request.headers.get('cf-connecting-ip') || 'unknown';
    const rateLimit = checkRateLimit(clientIp);

    if (!rateLimit.allowed) {
      console.warn(`Rate limit exceeded for IP: ${clientIp}`);
      return new Response(RATE_LIMITED, {
        status: 429,
        headers: {
          ...RETELL_JSON_HEADERS,
          'Retry-After': String(Math.ceil(rateLimit.resetMs / 1000)),
          'X-RateLimit-Limit': String(RATE_LIMIT_REQUESTS),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil((Date.now() + rateLimit.resetMs) / 1000))
        }
      });
    }

    try {
      const bodyText = await request.text();

      // Extract tool name from path: /retell/getOrderStatus -> getOrderStatus
      // Also support direct /toolName for simpler URLs
      let toolName = path.startsWith('/retell/')
        ? path.replace('/retell/', '')
        : path.replace('/', '');

      const handler = RETELL_TOOLS[toolName];

      if (!handler) {
        return new Response(JSON.stringify({ error: `Unknown tool: ${toolName}` }), {
          status: 404,
          headers: RETELL_JSON_HEADERS
        });
      }

      // Optional Retell signature verification
      if (env.RETELL_API_KEY) {
        const isValid = await verifyRetellSignature(request, bodyText, env.RETELL_API_KEY);
        if (!isValid) {
          console.warn('Retell signature verification failed');
          return new Response(UNAUTHORIZED, { status: 401, headers: RETELL_JSON_HEADERS });
        }
      }

      // Retell sends params directly at root level
      const args = JSON.parse(bodyText);

      // Execute tool
      const result = await handler(env, args);

      // Log performance
      const duration = Date.now() - startTime;
      if (duration > 500) {
        console.warn(`[retell] Slow tool call: ${toolName} took ${duration}ms`);
      }

      // Retell expects simple JSON response (not wrapped)
      return new Response(JSON.stringify(result), { headers: RETELL_JSON_HEADERS });

    } catch (error) {
      console.error('Webhook error:', error);
      return new Response(INTERNAL_ERROR, { status: 500, headers: RETELL_JSON_HEADERS });
    }
  }
};
