#!/usr/bin/env node
/**
 * Telnyx Phone Number Debugger
 *
 * Diagnoses common Telnyx + VAPI integration issues:
 * - Phone number configuration
 * - SIP connection status
 * - Call routing issues
 * - Audio quality problems
 *
 * Usage:
 *   VAPI_TOKEN=xxx node scripts/debug-telnyx.js
 *   VAPI_TOKEN=xxx TELNYX_API_KEY=xxx node scripts/debug-telnyx.js --full
 */

const VAPI_API = 'https://api.vapi.ai';
const TELNYX_API = 'https://api.telnyx.com/v2';
const VAPI_TOKEN = process.env.VAPI_TOKEN;
const TELNYX_API_KEY = process.env.TELNYX_API_KEY;

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

function header(text) {
  console.log('\n' + colorize('═'.repeat(60), 'cyan'));
  console.log(colorize(`  ${text}`, 'bold'));
  console.log(colorize('═'.repeat(60), 'cyan'));
}

function section(text) {
  console.log('\n' + colorize(`▸ ${text}`, 'blue'));
  console.log(colorize('─'.repeat(40), 'dim'));
}

function warn(text) { console.log(colorize(`  ⚠ ${text}`, 'yellow')); }
function error(text) { console.log(colorize(`  ✗ ${text}`, 'red')); }
function success(text) { console.log(colorize(`  ✓ ${text}`, 'green')); }
function info(label, value) { console.log(`  ${colorize(label + ':', 'dim')} ${value}`); }

// ============================================================================
// API Helpers
// ============================================================================

async function vapiRequest(method, endpoint) {
  const response = await fetch(`${VAPI_API}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${VAPI_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) throw new Error(`VAPI API error: ${response.status}`);
  return response.json();
}

async function telnyxRequest(method, endpoint) {
  if (!TELNYX_API_KEY) return null;

  const response = await fetch(`${TELNYX_API}${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${TELNYX_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });
  if (!response.ok) throw new Error(`Telnyx API error: ${response.status}`);
  return response.json();
}

// ============================================================================
// Telnyx + VAPI Common Issues
// ============================================================================

const COMMON_ISSUES = {
  'call-not-connecting': {
    symptoms: ['Calls go straight to voicemail', 'Phone rings but no answer', 'Call drops immediately'],
    checks: [
      'Verify phone number is active in Telnyx portal',
      'Check if assistant is assigned to phone number in VAPI',
      'Verify Telnyx messaging profile is configured',
      'Check SIP connection in Telnyx portal'
    ],
    fixes: [
      'Re-import phone number in VAPI dashboard',
      'Check Telnyx account balance/status',
      'Verify webhook URL is reachable'
    ]
  },
  'one-way-audio': {
    symptoms: ['Caller can hear bot but bot can\'t hear caller', 'Bot can hear but caller can\'t hear bot'],
    checks: [
      'Check NAT/firewall settings',
      'Verify RTP port range is open (10000-20000)',
      'Check Telnyx region settings'
    ],
    fixes: [
      'Enable STUN/TURN if behind NAT',
      'Check if ISP is blocking SIP traffic',
      'Try different Telnyx region'
    ]
  },
  'poor-audio-quality': {
    symptoms: ['Choppy audio', 'Echo', 'Delayed responses', 'Robot voice'],
    checks: [
      'Check network latency to Telnyx',
      'Verify codec settings',
      'Check for packet loss'
    ],
    fixes: [
      'Use G.711 codec for reliability',
      'Reduce network hops',
      'Check for bandwidth issues'
    ]
  },
  'transcription-errors': {
    symptoms: ['Bot misunderstands caller', 'Partial transcriptions', 'Wrong language detected'],
    checks: [
      'Verify transcriber settings in VAPI',
      'Check audio quality from Telnyx',
      'Verify language settings'
    ],
    fixes: [
      'Switch to Deepgram Nova-3',
      'Set explicit language instead of auto-detect',
      'Improve caller audio instructions'
    ]
  },
  'high-latency': {
    symptoms: ['Long pauses before bot responds', 'Feels sluggish', 'Caller talks over bot'],
    checks: [
      'Check webhook response time',
      'Verify LLM model speed',
      'Check TTS provider latency'
    ],
    fixes: [
      'Use faster LLM (Gemini 2.0 Flash)',
      'Use Cartesia for TTS',
      'Optimize webhook code',
      'Reduce system prompt length'
    ]
  }
};

// ============================================================================
// Diagnostics
// ============================================================================

async function checkVapiPhones() {
  section('VAPI Phone Numbers');

  const phones = await vapiRequest('GET', '/phone-number');
  const telnyxPhones = phones.filter(p => p.provider === 'telnyx');

  if (telnyxPhones.length === 0) {
    warn('No Telnyx phone numbers found in VAPI');
    console.log('  To add a Telnyx number:');
    console.log('  1. Go to https://dashboard.vapi.ai/phone-numbers');
    console.log('  2. Click "Import from Telnyx"');
    console.log('  3. Enter your Telnyx API key');
    return [];
  }

  console.log(`  Found ${telnyxPhones.length} Telnyx number(s):\n`);

  for (const phone of telnyxPhones) {
    console.log(`  ${colorize(phone.number || phone.id, 'cyan')}`);
    info('    VAPI ID', phone.id);
    info('    Telnyx ID', phone.telnyxPhoneNumberId || colorize('MISSING', 'red'));
    info('    Status', phone.status || 'unknown');

    if (phone.assistantId) {
      success(`    Assistant: ${phone.assistantId}`);
    } else {
      error('    No assistant assigned!');
    }

    // Check for common issues
    if (!phone.telnyxPhoneNumberId) {
      error('    Missing Telnyx Phone Number ID - reimport this number');
    }

    console.log('');
  }

  return telnyxPhones;
}

async function checkTelnyxDirect() {
  if (!TELNYX_API_KEY) {
    section('Telnyx Direct Check (Skipped)');
    console.log('  Set TELNYX_API_KEY to enable direct Telnyx checks');
    return null;
  }

  section('Telnyx Direct Check');

  try {
    // Check phone numbers
    const phonesResp = await telnyxRequest('GET', '/phone_numbers');
    const phones = phonesResp.data || [];

    console.log(`  Found ${phones.length} phone number(s) in Telnyx:\n`);

    for (const phone of phones.slice(0, 5)) {
      console.log(`  ${colorize(phone.phone_number, 'cyan')}`);
      info('    ID', phone.id);
      info('    Status', phone.status);
      info('    Connection', phone.connection_id || 'none');

      if (phone.status !== 'active') {
        error(`    Status is ${phone.status} - should be 'active'`);
      }
    }

    // Check connections (SIP)
    const connectionsResp = await telnyxRequest('GET', '/connections');
    const connections = connectionsResp.data || [];

    console.log(`\n  Found ${connections.length} connection(s):\n`);

    for (const conn of connections.slice(0, 3)) {
      console.log(`  ${colorize(conn.connection_name || conn.id, 'cyan')}`);
      info('    Type', conn.connection_type);
      info('    Active', conn.active ? 'Yes' : colorize('No', 'red'));

      if (!conn.active) {
        error('    Connection is not active!');
      }
    }

    return { phones, connections };
  } catch (err) {
    error(`Telnyx API error: ${err.message}`);
    return null;
  }
}

async function checkRecentCalls() {
  section('Recent Telnyx Calls');

  const calls = await vapiRequest('GET', '/call?limit=20');
  const telnyxCalls = calls.filter(c =>
    c.phoneNumber?.provider === 'telnyx' ||
    c.phoneNumberId
  );

  if (telnyxCalls.length === 0) {
    warn('No recent calls found');
    return [];
  }

  // Analyze call patterns
  const stats = {
    total: telnyxCalls.length,
    successful: 0,
    failed: 0,
    endReasons: {},
    avgDuration: 0
  };

  telnyxCalls.forEach(call => {
    if (call.status === 'ended' && !call.endedReason?.includes('error')) {
      stats.successful++;
    } else {
      stats.failed++;
    }

    if (call.endedReason) {
      stats.endReasons[call.endedReason] = (stats.endReasons[call.endedReason] || 0) + 1;
    }

    if (call.duration) {
      stats.avgDuration += call.duration;
    }
  });

  stats.avgDuration = stats.avgDuration / stats.total;

  info('Total calls', stats.total);
  info('Successful', `${stats.successful} (${((stats.successful/stats.total)*100).toFixed(0)}%)`);
  info('Failed', `${stats.failed} (${((stats.failed/stats.total)*100).toFixed(0)}%)`);
  info('Avg duration', `${stats.avgDuration.toFixed(0)}s`);

  console.log('\n  End reasons:');
  Object.entries(stats.endReasons)
    .sort((a, b) => b[1] - a[1])
    .forEach(([reason, count]) => {
      const color = reason.includes('error') ? 'red' :
                    reason === 'customer-ended-call' ? 'green' :
                    reason === 'assistant-ended-call' ? 'green' : 'yellow';
      console.log(`    ${colorize(reason, color)}: ${count}`);
    });

  // Flag problematic patterns
  const errorCalls = telnyxCalls.filter(c =>
    c.endedReason?.includes('error') ||
    c.status === 'failed'
  );

  if (errorCalls.length > 0) {
    console.log('\n  ' + colorize('Problem calls to investigate:', 'yellow'));
    errorCalls.slice(0, 3).forEach(call => {
      console.log(`    ${colorize(call.id, 'cyan')} - ${call.endedReason || call.status}`);
    });
    console.log(`\n  Run: ${colorize('node scripts/debug-vapi.js --call <id>', 'dim')}`);
  }

  return telnyxCalls;
}

function showTroubleshootingGuide() {
  header('Telnyx + VAPI Troubleshooting Guide');

  Object.entries(COMMON_ISSUES).forEach(([issue, details]) => {
    section(issue.replace(/-/g, ' ').toUpperCase());

    console.log('  ' + colorize('Symptoms:', 'bold'));
    details.symptoms.forEach(s => console.log(`    • ${s}`));

    console.log('\n  ' + colorize('Things to check:', 'bold'));
    details.checks.forEach(c => console.log(`    □ ${c}`));

    console.log('\n  ' + colorize('Possible fixes:', 'bold'));
    details.fixes.forEach(f => console.log(`    → ${f}`));
  });
}

async function runDiagnostics() {
  if (!VAPI_TOKEN) {
    console.error('Error: VAPI_TOKEN environment variable required');
    process.exit(1);
  }

  header('Telnyx + VAPI Diagnostics');

  try {
    await checkVapiPhones();
    await checkTelnyxDirect();
    await checkRecentCalls();
    showTroubleshootingGuide();

    header('Next Steps');
    console.log(`
  1. Check specific call issues:
     ${colorize('VAPI_TOKEN=xxx node scripts/debug-vapi.js --call <call-id>', 'cyan')}

  2. Test webhook latency:
     ${colorize('WEBHOOK_URL=xxx node scripts/test-latency.js', 'cyan')}

  3. Full VAPI diagnostics:
     ${colorize('VAPI_TOKEN=xxx node scripts/debug-vapi.js', 'cyan')}

  4. Telnyx Portal:
     ${colorize('https://portal.telnyx.com/#/app/call-control/applications', 'cyan')}

  5. VAPI Dashboard:
     ${colorize('https://dashboard.vapi.ai', 'cyan')}
`);

  } catch (err) {
    error(`Diagnostics failed: ${err.message}`);
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

const args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log(`
Telnyx + VAPI Debugger

Usage:
  VAPI_TOKEN=xxx node scripts/debug-telnyx.js           # Basic diagnostics
  VAPI_TOKEN=xxx TELNYX_API_KEY=xxx node scripts/debug-telnyx.js --full

Options:
  --help     Show this help
  --guide    Show troubleshooting guide only
  --full     Include direct Telnyx API checks (requires TELNYX_API_KEY)

Environment:
  VAPI_TOKEN       Your VAPI API token (required)
  TELNYX_API_KEY   Your Telnyx API key (optional, for --full mode)
`);
} else if (args.includes('--guide')) {
  showTroubleshootingGuide();
} else {
  runDiagnostics();
}
