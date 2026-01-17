#!/usr/bin/env node
/**
 * Test webhook locally
 * Usage: VAPI_WEBHOOK_SECRET=xxx node scripts/test-webhook.js
 *
 * IMPORTANT: VAPI_WEBHOOK_SECRET is required for signed requests
 */
const crypto = require('crypto');

// Mock VAPI request format (matches actual VAPI tool-calls webhook format)
// VAPI nests function name and arguments under toolCallList[].function
const mockVapiRequest = (functionName, args) => ({
  message: {
    type: 'tool-calls',
    toolCallList: [{
      id: 'test-call-123',
      type: 'function',
      function: {
        name: functionName,
        arguments: args
      }
    }]
  }
});

// Generate VAPI-compatible HMAC-SHA256 signature
function signRequest(body, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  return hmac.digest('hex');
}

async function testWebhook() {
  // Default to wrangler dev port (8787), not 3000
  const baseUrl = process.env.WEBHOOK_URL || 'http://localhost:8787';
  const secret = process.env.VAPI_WEBHOOK_SECRET;

  if (!secret) {
    console.error('ERROR: VAPI_WEBHOOK_SECRET environment variable is required');
    console.error('Usage: VAPI_WEBHOOK_SECRET=xxx npm run test');
    process.exit(1);
  }

  console.log('Testing Alexis Webhook\n');
  // Cloudflare Worker handles requests at root path, not /api/webhook
  console.log(`URL: ${baseUrl}\n`);

  const tests = [
    {
      name: 'Search Products',
      fn: 'searchProducts',
      args: { query: 'shirt', limit: 3 }
    },
    {
      name: 'Check Stock (by name)',
      fn: 'checkProductStock',
      args: { product_name: 'test' }
    },
    {
      name: 'Get Order Status (invalid ref)',
      fn: 'getOrderStatus',
      args: { reference: 'TESTREF123' }
    }
  ];

  for (const test of tests) {
    console.log(`\nTest: ${test.name}`);
    console.log(`   Function: ${test.fn}`);
    console.log(`   Args: ${JSON.stringify(test.args)}`);

    try {
      const body = JSON.stringify(mockVapiRequest(test.fn, test.args));
      const signature = signRequest(body, secret);

      // Cloudflare Worker handles at root path (not /api/webhook)
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VAPI-Signature': signature
        },
        body
      });

      const data = await response.json();
      console.log(`   Status: ${response.status}`);
      console.log(`   Result: ${JSON.stringify(data, null, 2)}`);
    } catch (error) {
      console.log(`   Error: ${error.message}`);
    }
  }

  console.log('\nTests complete\n');
}

testWebhook();
