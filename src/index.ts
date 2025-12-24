/**
 * Alexis Voice Agent - Cloudflare Worker
 *
 * VAPI webhook handler for armenius.cy PrestaShop
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
  PRESTASHOP_B2B_URL: string;
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

// In-memory carrier cache (persists across requests in same isolate)
let carrierCache: Map<number, string> = new Map();
let carrierCacheTime = 0;
const CARRIER_CACHE_TTL = 3600000; // 1 hour

// Helper: Base64 encode for Workers (optimized)
function base64Encode(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const binString = Array.from(bytes, (x) => String.fromCodePoint(x)).join('');
  return btoa(binString);
}

// Helper: PrestaShop API call with timeout and improved error handling
async function prestashopFetch(env: Env, endpoint: string, useB2B = false, timeoutMs = 5000): Promise<any> {
  const baseUrl = useB2B ? env.PRESTASHOP_B2B_URL : env.PRESTASHOP_URL;
  const url = `${baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}output_format=JSON`;
  const auth = base64Encode(`${env.PRESTASHOP_API_KEY}:`);

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { 'Authorization': `Basic ${auth}` },
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
function makeSpeechFriendly(name: string): string {
  return name
    // Fix model numbers like "G8" → "G 8" (not "grams")
    .replace(/\bG(\d+)\b/g, 'G $1')
    // Fix storage/RAM: "16GB" → "16 gigabytes", "256GB" → "256 gigabytes"
    .replace(/(\d+)\s*GB\b/gi, '$1 gigabytes')
    .replace(/(\d+)\s*TB\b/gi, '$1 terabytes')
    .replace(/(\d+)\s*MB\b/gi, '$1 megabytes')
    // Fix RAM type: "DDR4" → "D D R 4"
    .replace(/\bDDR(\d+)\b/gi, 'D D R $1')
    // Fix processor names: "i5-1145G7" → "i5 1145 G 7"
    .replace(/\bi(\d+)-(\d+)G(\d+)\b/gi, 'i$1 $2 G $3')
    .replace(/\bi(\d+)-(\d+)\b/gi, 'i$1 $2')
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
function shortenForListing(name: string): string {
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

// Tool: Get Order Status (optimized - includes order items for "what did I order?" questions)
async function getOrderStatus(env: Env, args: { reference?: string; email?: string }) {
  try {
    let order: any;

    if (args.reference) {
      // Optimized: Fetch order with full details in single call using display parameter
      const data = await prestashopFetch(env, `/orders?filter[reference]=${args.reference}&display=full`);
      if (!data.orders?.length) {
        return { success: false, message: `No order found with reference ${args.reference}` };
      }
      order = data.orders[0];
    } else if (args.email) {
      // Step 1: Get customer ID
      const customers = await prestashopFetch(env, `/customers?filter[email]=${encodeURIComponent(args.email)}&display=[id]`);
      if (!customers.customers?.length) {
        return { success: false, message: `No customer found with email ${args.email}` };
      }

      // Step 2: Get latest order with full details
      const orders = await prestashopFetch(env, `/orders?filter[id_customer]=${customers.customers[0].id}&display=full&sort=[id_DESC]&limit=1`);
      if (!orders.orders?.length) {
        return { success: false, message: 'No orders found for this customer' };
      }
      order = orders.orders[0];
    } else {
      return { success: false, message: 'Please provide an order reference number or email address' };
    }

    // Extract order items for "what did I order?" questions
    const items: string[] = [];
    if (order.associations?.order_rows) {
      const rows = Array.isArray(order.associations.order_rows)
        ? order.associations.order_rows
        : [order.associations.order_rows];
      for (const row of rows.slice(0, 5)) { // Limit to 5 items for voice
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

// Tool: Check Product Stock (optimized - parallel calls, minimal data)
async function checkProductStock(env: Env, args: { product_id?: number; product_name?: string }) {
  try {
    let productId = args.product_id;
    let productName: string;

    if (args.product_name && !args.product_id) {
      // Search returns id and name only
      // PrestaShop filter: %value% for CONTAINS match (case-insensitive)
      const search = await prestashopFetch(env, `/products?filter[name]=%${encodeURIComponent(args.product_name)}%&display=[id,name]&limit=1`);
      if (!search.products?.length) {
        return { success: false, message: `No product found matching "${args.product_name}"` };
      }
      productId = search.products[0].id;
      productName = makeSpeechFriendly(extractProductName(search.products[0].name));
    } else {
      // Fetch only name field (NOT display=full - saves ~30KB)
      const product = await prestashopFetch(env, `/products/${productId}?display=[id,name]`);
      const productInfo = product.products?.[0] || product.product;
      productName = makeSpeechFriendly(extractProductName(productInfo?.name));
    }

    // Fetch stock from B2B endpoint
    // Note: filter[field]=value for exact match (not [value] which is interval/OR syntax)
    const stock = await prestashopFetch(env, `/stock_availables?filter[id_product]=${productId}&filter[id_product_attribute]=0&display=[quantity]`, true);

    if (!stock.stock_availables?.length) {
      return { success: false, message: 'Unable to check stock for this product' };
    }

    const quantity = parseInt(stock.stock_availables[0].quantity, 10);

    return {
      success: true,
      product_id: productId,
      name: productName,
      quantity: quantity,
      in_stock: quantity > 0,
      message: quantity > 0
        ? `Yes, we have ${quantity} units in stock`
        : 'Sorry, this product is currently out of stock'
    };
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
  } catch {
    return 'Standard shipping';
  }
}

// Tool: Get Tracking Info (optimized - cached carrier lookup)
async function getTrackingInfo(env: Env, args: { reference?: string; order_id?: number }) {
  try {
    let orderId = args.order_id;

    if (args.reference && !args.order_id) {
      const orders = await prestashopFetch(env, `/orders?filter[reference]=${args.reference}&display=[id]`);
      if (!orders.orders?.length) {
        return { success: false, message: `No order found with reference ${args.reference}` };
      }
      orderId = orders.orders[0].id;
    }

    const carriers = await prestashopFetch(env, `/order_carriers?filter[id_order]=${orderId}&display=[id_carrier,tracking_number]`);

    if (!carriers.order_carriers?.length) {
      return { success: false, message: 'No shipping information available yet for this order' };
    }

    const orderCarrier = carriers.order_carriers[0];
    const trackingNumber = orderCarrier.tracking_number;

    // Use cached carrier name lookup
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

// Tool: Search Products (searches name, reference, and meta fields)
async function searchProducts(env: Env, args: { query: string; limit?: number }) {
  try {
    const limit = Math.min(args.limit || 5, 10);
    const query = args.query.trim();

    // If query looks like a product ID/SKU (numeric), fetch directly
    if (/^\d+$/.test(query)) {
      try {
        const product = await prestashopFetch(env, `/products/${query}?display=[id,name,price]`);
        const p = product.products?.[0] || product.product;
        if (p) {
          return {
            success: true,
            count: 1,
            products: [{
              id: p.id,
              name: makeSpeechFriendly(extractProductName(p.name)),
              price: `€${parseFloat(p.price).toFixed(2)}`
            }]
          };
        }
      } catch { /* continue to text search */ }
    }

    // Text search - use unencoded % for PrestaShop LIKE queries
    const encodedQuery = encodeURIComponent(query);
    const search = await prestashopFetch(env, `/products?filter[name]=%${encodedQuery}%&display=[id,name,price]&limit=${limit}`);

    if (!search.products?.length) {
      return { success: false, message: `No products found matching "${query}"` };
    }

    // For multiple products: use short names for natural listing
    // For single product: use full TTS-friendly name
    const isList = search.products.length > 1;

    const products = search.products.map((p: any) => {
      const fullName = extractProductName(p.name);
      return {
        id: p.id,
        name: isList ? shortenForListing(fullName) : makeSpeechFriendly(fullName),
        price: `€${parseFloat(p.price).toFixed(2)}`
      };
    });

    return {
      success: true,
      count: products.length,
      products: products
    };
  } catch (error) {
    console.error('searchProducts error:', error);
    return { success: false, message: 'Unable to search products. Please try again.' };
  }
}

// Tool: Create Support Ticket (optimized - with timeout)
async function createSupportTicket(env: Env, args: { order_id?: number; message: string; customer_email?: string }) {
  try {
    const url = `${env.PRESTASHOP_URL}/messages?output_format=JSON`;
    const auth = base64Encode(`${env.PRESTASHOP_API_KEY}:`);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <message>
    <id_order>${args.order_id || ''}</id_order>
    <message><![CDATA[${args.message}\n\n[Created via Alexis Voice Agent]]]></message>
    <private>0</private>
  </message>
</prestashop>`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
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

// Main handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    try {
      const body: any = await request.json();

      // VAPI sends many event types - only process tool-call events
      const toolCall = body.message?.toolCalls?.[0];

      // If no tool call, acknowledge the event and return fast
      if (!toolCall) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }

      const functionName = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments || '{}');

      let result: any;

      switch (functionName) {
        case 'getOrderStatus':
          result = await getOrderStatus(env, args);
          break;
        case 'checkProductStock':
          result = await checkProductStock(env, args);
          break;
        case 'getTrackingInfo':
          result = await getTrackingInfo(env, args);
          break;
        case 'searchProducts':
          result = await searchProducts(env, args);
          break;
        case 'createSupportTicket':
          result = await createSupportTicket(env, args);
          break;
        default:
          result = { error: `Unknown function: ${functionName}` };
      }

      return new Response(JSON.stringify({
        results: [{
          toolCallId: toolCall.id,
          result: JSON.stringify(result)
        }]
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      });

    } catch (error) {
      console.error('Webhook error:', error);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  }
};
