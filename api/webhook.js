/**
 * Alexis Voice Agent - PrestaShop Webhook Handler
 * Deploy to Vercel/Netlify Edge Functions
 *
 * Handles VAPI function calls for:
 * - getOrderStatus: Look up order by reference number
 * - checkProductStock: Check inventory for a product
 * - getTrackingInfo: Get shipping/tracking details
 * - searchProducts: Search products by name
 * - createSupportTicket: Create customer support message
 */

const PRESTASHOP_URL = process.env.PRESTASHOP_URL || 'https://armenius.cy/api';
const PRESTASHOP_B2B_URL = process.env.PRESTASHOP_B2B_URL || 'https://b2b.armenius.cy/api';
const PRESTASHOP_API_KEY = process.env.PRESTASHOP_API_KEY;

// Helper: Make authenticated PrestaShop API call
async function prestashopFetch(endpoint, useB2B = false) {
  const baseUrl = useB2B ? PRESTASHOP_B2B_URL : PRESTASHOP_URL;
  const url = `${baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}output_format=JSON`;
  const auth = Buffer.from(`${PRESTASHOP_API_KEY}:`).toString('base64');

  const response = await fetch(url, {
    headers: { 'Authorization': `Basic ${auth}` }
  });

  if (!response.ok) {
    throw new Error(`PrestaShop API error: ${response.status}`);
  }

  return response.json();
}

// Order state mapping (PrestaShop IDs → Human readable)
const ORDER_STATES = {
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

// Helper: Shorten product name for listings (brand + model only)
function shortenForListing(name) {
  const words = name.split(/[\s,\-–]+/).filter(w => w.length > 0);
  let cutoff = words.length;
  for (let i = 0; i < words.length; i++) {
    if (/^\d+\s*(GB|TB|MB|mm|cm|MHz|W|mAh)/i.test(words[i]) ||
        /^\d+x\d+/i.test(words[i]) ||
        /^(RGB|LED|LCD|USB|HDMI|DDR\d)/i.test(words[i])) {
      cutoff = Math.max(3, i);
      break;
    }
  }
  return words.slice(0, Math.min(cutoff, 5)).join(' ');
}

// VAPI Tool: Get Order Status (includes order items)
async function getOrderStatus({ reference, email }) {
  try {
    let order;

    if (reference) {
      // Fetch order with full details in single call
      const data = await prestashopFetch(`/orders?filter[reference]=${reference}&display=full`);
      if (!data.orders?.length) {
        return { success: false, message: `No order found with reference ${reference}` };
      }
      order = data.orders[0];
    } else if (email) {
      // Find customer by email, then get their orders
      const customers = await prestashopFetch(`/customers?filter[email]=${encodeURIComponent(email)}&display=[id]`);
      if (!customers.customers?.length) {
        return { success: false, message: `No customer found with email ${email}` };
      }
      const customerId = customers.customers[0].id;
      const orders = await prestashopFetch(`/orders?filter[id_customer]=${customerId}&display=full&sort=[id_DESC]&limit=1`);
      if (!orders.orders?.length) {
        return { success: false, message: 'No orders found for this customer' };
      }
      order = orders.orders[0];
    } else {
      return { success: false, message: 'Please provide an order reference number or email address' };
    }

    // Extract order items for "what did I order?" questions
    const items = [];
    if (order.associations?.order_rows) {
      const rows = Array.isArray(order.associations.order_rows)
        ? order.associations.order_rows
        : [order.associations.order_rows];
      for (const row of rows.slice(0, 5)) {
        if (row.product_name) {
          const qty = parseInt(row.product_quantity, 10) || 1;
          items.push(qty > 1 ? `${qty}x ${shortenForListing(row.product_name)}` : shortenForListing(row.product_name));
        }
      }
    }

    const status = ORDER_STATES[order.current_state] || 'unknown';

    return {
      success: true,
      reference: order.reference,
      status: status,
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

// VAPI Tool: Check Product Stock
async function checkProductStock({ product_id, product_name }) {
  try {
    let productId = product_id;
    let productName;

    if (product_name && !product_id) {
      // Search by name first - PrestaShop filter: %value% for CONTAINS match
      const search = await prestashopFetch(`/products?filter[name]=%${encodeURIComponent(product_name)}%&display=[id,name]&limit=1`);
      if (!search.products?.length) {
        return { success: false, message: `No product found matching "${product_name}"` };
      }
      productId = search.products[0].id;
      const nameField = search.products[0].name;
      productName = Array.isArray(nameField)
        ? nameField.find(n => n.id === 1)?.value || nameField[0]?.value
        : nameField;
    } else {
      // Fetch only name field (NOT display=full - saves bandwidth)
      const product = await prestashopFetch(`/products/${productId}?display=[id,name]`);
      const productInfo = product.products?.[0] || product.product;
      const nameField = productInfo?.name;
      productName = Array.isArray(nameField)
        ? nameField.find(n => n.id === 1)?.value || nameField[0]?.value
        : nameField;
    }

    // Get stock via B2B endpoint - more reliable for stock queries
    // Note: filter[field]=value for exact match (not [value] which is interval/OR syntax)
    const stock = await prestashopFetch(`/stock_availables?filter[id_product]=${productId}&filter[id_product_attribute]=0&display=[quantity]`, true);

    if (!stock.stock_availables?.length) {
      return { success: false, message: 'Unable to check stock for this product' };
    }

    const quantity = parseInt(stock.stock_availables[0].quantity, 10);

    return {
      success: true,
      product_id: productId,
      name: productName || 'Unknown product',
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

// VAPI Tool: Get Tracking Information
async function getTrackingInfo({ reference, order_id }) {
  try {
    let orderId = order_id;

    if (reference && !order_id) {
      const orders = await prestashopFetch(`/orders?filter[reference]=${reference}`);
      if (!orders.orders?.length) {
        return { success: false, message: `No order found with reference ${reference}` };
      }
      orderId = orders.orders[0].id;
    }

    // Get order carrier info
    const carriers = await prestashopFetch(`/order_carriers?filter[id_order]=${orderId}`);

    if (!carriers.order_carriers?.length) {
      return { success: false, message: 'No shipping information available yet for this order' };
    }

    const orderCarrier = carriers.order_carriers[0];
    const trackingNumber = orderCarrier.tracking_number;

    // Get carrier details
    let carrierName = 'Standard shipping';
    if (orderCarrier.id_carrier) {
      const carrier = await prestashopFetch(`/carriers/${orderCarrier.id_carrier}`);
      carrierName = carrier.carrier?.name || carrierName;
    }

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

// VAPI Tool: Search Products
async function searchProducts({ query, limit = 5 }) {
  try {
    const search = await prestashopFetch(`/products?filter[name]=%${encodeURIComponent(query)}%&display=[id,name,price]&limit=${limit}`);

    if (!search.products?.length) {
      return { success: false, message: `No products found matching "${query}"` };
    }

    const products = search.products.map(p => {
      const name = Array.isArray(p.name)
        ? p.name.find(n => n.id === 1)?.value || p.name[0]?.value
        : p.name;
      return {
        id: p.id,
        name: name,
        price: `€${parseFloat(p.price).toFixed(2)}`,
        url: `https://armenius.cy/index.php?id_product=${p.id}&controller=product`
      };
    });

    return {
      success: true,
      count: products.length,
      products: products,
      message: `Found ${products.length} products matching "${query}"`
    };
  } catch (error) {
    console.error('searchProducts error:', error);
    return { success: false, message: 'Unable to search products. Please try again.' };
  }
}

// VAPI Tool: Create Support Ticket
async function createSupportTicket({ order_id, message, customer_email }) {
  try {
    // For PrestaShop messages API, we need to POST
    const url = `${PRESTASHOP_URL}/messages?output_format=JSON`;
    const auth = Buffer.from(`${PRESTASHOP_API_KEY}:`).toString('base64');

    // Build XML payload (PrestaShop API requires XML for POST)
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <message>
    <id_order>${order_id || ''}</id_order>
    <message><![CDATA[${message}\n\n[Created via Alexis Voice Agent]]]></message>
    <private>0</private>
  </message>
</prestashop>`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/xml'
      },
      body: xml
    });

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

// Main webhook handler
export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;

    // VAPI sends function calls in message.toolCalls
    if (!message?.toolCalls?.length) {
      return res.status(400).json({ error: 'No tool calls in request' });
    }

    const toolCall = message.toolCalls[0];
    const functionName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments || '{}');

    let result;

    switch (functionName) {
      case 'getOrderStatus':
        result = await getOrderStatus(args);
        break;
      case 'checkProductStock':
        result = await checkProductStock(args);
        break;
      case 'getTrackingInfo':
        result = await getTrackingInfo(args);
        break;
      case 'searchProducts':
        result = await searchProducts(args);
        break;
      case 'createSupportTicket':
        result = await createSupportTicket(args);
        break;
      default:
        result = { error: `Unknown function: ${functionName}` };
    }

    // VAPI expects this response format
    return res.status(200).json({
      results: [{
        toolCallId: toolCall.id,
        result: JSON.stringify(result)
      }]
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// For local testing
export const config = {
  api: { bodyParser: true }
};
