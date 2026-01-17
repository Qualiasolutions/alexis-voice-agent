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

  console.log('Testing Alexis Webhook\n');
  console.log(`URL: ${baseUrl}`);
  console.log(`Signed requests: ${secret ? 'Yes' : 'No (set VAPI_WEBHOOK_SECRET to enable)'}\n`);

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
      const headers = { 'Content-Type': 'application/json' };

      // Add signature if secret is provided
      if (secret) {
        headers['X-VAPI-Signature'] = signRequest(body, secret);
      }

      // Cloudflare Worker handles at root path (not /api/webhook)
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers,
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
