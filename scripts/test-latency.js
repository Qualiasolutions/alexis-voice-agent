#!/usr/bin/env node
/**
 * Webhook Latency Tester
 *
 * Tests your webhook endpoint to measure:
 * - Cold start latency
 * - Warm request latency
 * - PrestaShop API latency
 * - End-to-end response time
 *
 * Usage:
 *   WEBHOOK_URL=https://your-webhook.workers.dev node scripts/test-latency.js
 *   WEBHOOK_URL=http://localhost:8787 node scripts/test-latency.js --local
 */

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:8787';
const ITERATIONS = 5;

// ============================================================================
// Test Cases - Simulates VAPI tool calls
// ============================================================================

const TEST_CASES = [
  {
    name: 'searchProducts (simple)',
    toolCall: {
      id: 'test-search-1',
      function: {
        name: 'searchProducts',
        arguments: JSON.stringify({ query: 'laptop', limit: 3 })
      }
    }
  },
  {
    name: 'checkProductStock (by name)',
    toolCall: {
      id: 'test-stock-1',
      function: {
        name: 'checkProductStock',
        arguments: JSON.stringify({ product_name: 'keyboard' })
      }
    }
  },
  {
    name: 'getOrderStatus (invalid ref)',
    toolCall: {
      id: 'test-order-1',
      function: {
        name: 'getOrderStatus',
        arguments: JSON.stringify({ reference: 'TESTREF99' })
      }
    }
  },
  {
    name: 'getTrackingInfo (invalid ref)',
    toolCall: {
      id: 'test-tracking-1',
      function: {
        name: 'getTrackingInfo',
        arguments: JSON.stringify({ reference: 'TESTREF99' })
      }
    }
  },
  {
    name: 'Non-tool event (fast path)',
    body: {
      message: {
        type: 'conversation-update'
      }
    }
  }
];

// ============================================================================
// Formatting
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
};

function colorize(text, color) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function formatMs(ms) {
  if (ms < 100) return colorize(`${ms.toFixed(0)}ms`, 'green');
  if (ms < 300) return colorize(`${ms.toFixed(0)}ms`, 'yellow');
  if (ms < 500) return colorize(`${ms.toFixed(0)}ms`, 'yellow');
  return colorize(`${ms.toFixed(0)}ms`, 'red');
}

function formatLatencyBar(ms, maxMs = 2000) {
  const width = 30;
  const filled = Math.min(Math.round((ms / maxMs) * width), width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);

  if (ms < 100) return colorize(bar, 'green');
  if (ms < 300) return colorize(bar, 'yellow');
  return colorize(bar, 'red');
}

// ============================================================================
// Test Runner
// ============================================================================

async function measureRequest(testCase) {
  const body = testCase.body || {
    message: {
      toolCalls: [testCase.toolCall]
    }
  };

  const start = performance.now();

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const end = performance.now();
    const latency = end - start;

    const data = await response.json();

    return {
      success: response.ok,
      latency,
      status: response.status,
      data
    };
  } catch (error) {
    return {
      success: false,
      latency: performance.now() - start,
      error: error.message
    };
  }
}

async function runTestCase(testCase, iterations) {
  const results = [];

  // Cold start (first request)
  const coldResult = await measureRequest(testCase);
  results.push({ ...coldResult, type: 'cold' });

  // Warm requests
  for (let i = 1; i < iterations; i++) {
    // Small delay between requests
    await new Promise(r => setTimeout(r, 100));
    const result = await measureRequest(testCase);
    results.push({ ...result, type: 'warm' });
  }

  return results;
}

function analyzeResults(name, results) {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  if (successful.length === 0) {
    console.log(`\n${colorize('✗', 'red')} ${name}`);
    console.log(`  ${colorize('All requests failed!', 'red')}`);
    if (failed[0]?.error) {
      console.log(`  Error: ${failed[0].error}`);
    }
    return null;
  }

  const latencies = successful.map(r => r.latency);
  const coldLatency = results[0]?.latency || 0;
  const warmLatencies = latencies.slice(1);

  const stats = {
    cold: coldLatency,
    min: Math.min(...latencies),
    max: Math.max(...latencies),
    avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    warmAvg: warmLatencies.length > 0
      ? warmLatencies.reduce((a, b) => a + b, 0) / warmLatencies.length
      : coldLatency,
    p50: latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)],
    successRate: (successful.length / results.length) * 100
  };

  console.log(`\n${colorize('✓', 'green')} ${colorize(name, 'bold')}`);
  console.log(`  ${formatLatencyBar(stats.avg)}`);
  console.log(`  Cold:  ${formatMs(stats.cold)}`);
  console.log(`  Warm:  ${formatMs(stats.warmAvg)} avg`);
  console.log(`  Range: ${formatMs(stats.min)} - ${formatMs(stats.max)}`);

  if (failed.length > 0) {
    console.log(`  ${colorize(`Failed: ${failed.length}/${results.length}`, 'red')}`);
  }

  // Recommendations
  if (stats.cold > 1000) {
    console.log(`  ${colorize('⚠ High cold start - consider warming strategies', 'yellow')}`);
  }
  if (stats.warmAvg > 500) {
    console.log(`  ${colorize('⚠ High latency - check PrestaShop API or add caching', 'yellow')}`);
  }
  if (stats.cold > stats.warmAvg * 3) {
    console.log(`  ${colorize('⚠ Large cold/warm gap - typical for serverless', 'dim')}`);
  }

  return stats;
}

async function testPrestaShopDirect() {
  console.log(colorize('\n═══ PrestaShop API Direct Test ═══', 'cyan'));

  const PRESTASHOP_API_KEY = process.env.PRESTASHOP_API_KEY;
  const PRESTASHOP_URL = process.env.PRESTASHOP_URL || 'https://armenius.cy/api';

  if (!PRESTASHOP_API_KEY) {
    console.log(colorize('  Skipped (PRESTASHOP_API_KEY not set)', 'dim'));
    return;
  }

  const auth = Buffer.from(`${PRESTASHOP_API_KEY}:`).toString('base64');
  const endpoints = [
    { name: 'Products (minimal)', path: '/products?display=[id]&limit=1' },
    { name: 'Orders (minimal)', path: '/orders?display=[id]&limit=1' },
    { name: 'Carriers (all)', path: '/carriers?display=[id,name]' }
  ];

  for (const endpoint of endpoints) {
    const start = performance.now();
    try {
      const response = await fetch(
        `${PRESTASHOP_URL}${endpoint.path}&output_format=JSON`,
        { headers: { 'Authorization': `Basic ${auth}` } }
      );
      const latency = performance.now() - start;

      if (response.ok) {
        console.log(`  ${endpoint.name}: ${formatMs(latency)}`);
      } else {
        console.log(`  ${endpoint.name}: ${colorize(`Error ${response.status}`, 'red')}`);
      }
    } catch (err) {
      console.log(`  ${endpoint.name}: ${colorize(err.message, 'red')}`);
    }
  }
}

async function main() {
  console.log(colorize('╔════════════════════════════════════════════╗', 'cyan'));
  console.log(colorize('║      WEBHOOK LATENCY TESTER                ║', 'cyan'));
  console.log(colorize('╚════════════════════════════════════════════╝', 'cyan'));
  console.log(`\nTarget: ${colorize(WEBHOOK_URL, 'bold')}`);
  console.log(`Iterations per test: ${ITERATIONS}`);

  // Quick connectivity check
  console.log(colorize('\n═══ Connectivity Check ═══', 'cyan'));
  try {
    const check = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {} })
    });
    console.log(`  Status: ${check.ok ? colorize('OK', 'green') : colorize(check.status, 'red')}`);
  } catch (err) {
    console.log(`  ${colorize('✗ Cannot connect to webhook', 'red')}`);
    console.log(`  ${err.message}`);
    process.exit(1);
  }

  // Run all test cases
  console.log(colorize('\n═══ Tool Latency Tests ═══', 'cyan'));

  const allStats = [];

  for (const testCase of TEST_CASES) {
    const results = await runTestCase(testCase, ITERATIONS);
    const stats = analyzeResults(testCase.name, results);
    if (stats) allStats.push({ name: testCase.name, ...stats });
  }

  // Test PrestaShop directly if credentials available
  await testPrestaShopDirect();

  // Summary
  console.log(colorize('\n═══ Summary ═══', 'cyan'));

  if (allStats.length > 0) {
    const avgCold = allStats.reduce((a, s) => a + s.cold, 0) / allStats.length;
    const avgWarm = allStats.reduce((a, s) => a + s.warmAvg, 0) / allStats.length;

    console.log(`\n  Overall Performance:`);
    console.log(`  • Average cold start: ${formatMs(avgCold)}`);
    console.log(`  • Average warm response: ${formatMs(avgWarm)}`);

    // VAPI latency budget analysis
    console.log(`\n  ${colorize('VAPI Latency Budget:', 'bold')}`);
    console.log(`  Target: < 700ms total response time`);

    const estimatedTotal = avgWarm + 150 + 200 + 150; // webhook + LLM + TTS + network
    console.log(`  Estimated breakdown:`);
    console.log(`    Transcription:  ~100-150ms`);
    console.log(`    Webhook:        ~${avgWarm.toFixed(0)}ms ${avgWarm < 200 ? '✓' : '⚠'}`);
    console.log(`    LLM:            ~150-300ms (Gemini 2.0 Flash)`);
    console.log(`    TTS:            ~100-200ms (Cartesia)`);
    console.log(`    Network:        ~50-150ms`);
    console.log(`    ─────────────────────`);
    console.log(`    Estimated:      ~${estimatedTotal.toFixed(0)}ms ${estimatedTotal < 700 ? colorize('✓', 'green') : colorize('⚠', 'yellow')}`);
  }

  // Recommendations
  console.log(colorize('\n═══ Optimization Tips ═══', 'cyan'));
  console.log(`
  1. ${colorize('Reduce cold starts:', 'bold')}
     - Use Cloudflare Workers (already optimized)
     - Avoid large dependencies
     - Keep bundle size minimal

  2. ${colorize('Speed up PrestaShop calls:', 'bold')}
     - Use display=[field1,field2] instead of display=full
     - Cache carrier names (already implemented)
     - Consider caching product names

  3. ${colorize('Optimize for VAPI:', 'bold')}
     - Keep webhook response < 200ms
     - Use streaming-optimized voices (Cartesia)
     - Use fast LLMs (Gemini 2.0 Flash, GPT-4o-mini)

  4. ${colorize('Monitor production:', 'bold')}
     - Check VAPI dashboard for call analytics
     - Use: node scripts/debug-vapi.js --call <id>
`);
}

main().catch(console.error);
