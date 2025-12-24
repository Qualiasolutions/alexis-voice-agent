#!/usr/bin/env node
/**
 * Test webhook locally
 * Usage: PRESTASHOP_API_KEY=xxx node scripts/test-webhook.js
 */

// Mock VAPI request format
const mockVapiRequest = (functionName, args) => ({
  message: {
    toolCalls: [{
      id: 'test-call-123',
      function: {
        name: functionName,
        arguments: JSON.stringify(args)
      }
    }]
  }
});

async function testWebhook() {
  const baseUrl = process.env.WEBHOOK_URL || 'http://localhost:3000';

  console.log('🧪 Testing Alexis Webhook\n');
  console.log(`URL: ${baseUrl}/api/webhook\n`);

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
    console.log(`\n📋 Test: ${test.name}`);
    console.log(`   Function: ${test.fn}`);
    console.log(`   Args: ${JSON.stringify(test.args)}`);

    try {
      const response = await fetch(`${baseUrl}/api/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mockVapiRequest(test.fn, test.args))
      });

      const data = await response.json();
      console.log(`   Status: ${response.status}`);
      console.log(`   Result: ${JSON.stringify(data, null, 2)}`);
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  console.log('\n✅ Tests complete\n');
}

testWebhook();
