#!/usr/bin/env node
/**
 * VAPI Voice Agent Debugger
 *
 * Comprehensive debugging tool for analyzing:
 * - Call latency breakdown
 * - Telnyx phone number issues
 * - Transcription accuracy
 * - LLM response times
 * - Voice synthesis delays
 * - Webhook performance
 *
 * Usage:
 *   VAPI_TOKEN=xxx node scripts/debug-vapi.js
 *   VAPI_TOKEN=xxx node scripts/debug-vapi.js --call <call-id>
 *   VAPI_TOKEN=xxx node scripts/debug-vapi.js --assistant <assistant-id>
 *   VAPI_TOKEN=xxx node scripts/debug-vapi.js --phone <phone-id>
 */

const VAPI_API = 'https://api.vapi.ai';
const VAPI_TOKEN = process.env.VAPI_TOKEN;

if (!VAPI_TOKEN) {
  console.error('Error: VAPI_TOKEN environment variable required');
  console.error('Get your token from: https://dashboard.vapi.ai/account');
  process.exit(1);
}

// ============================================================================
// API Helpers
// ============================================================================

async function vapiRequest(method, endpoint, body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${VAPI_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${VAPI_API}${endpoint}`, options);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`VAPI API error ${response.status}: ${error}`);
  }

  return response.json();
}

// ============================================================================
// Formatting Helpers
// ============================================================================

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
};

function colorize(text, color) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function formatMs(ms) {
  if (ms < 100) return colorize(`${ms.toFixed(0)}ms`, 'green');
  if (ms < 500) return colorize(`${ms.toFixed(0)}ms`, 'yellow');
  if (ms < 1000) return colorize(`${ms.toFixed(0)}ms`, 'red');
  return colorize(`${(ms/1000).toFixed(2)}s`, 'red');
}

function formatDuration(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
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

function warn(text) {
  console.log(colorize(`  ⚠ ${text}`, 'yellow'));
}

function error(text) {
  console.log(colorize(`  ✗ ${text}`, 'red'));
}

function success(text) {
  console.log(colorize(`  ✓ ${text}`, 'green'));
}

function info(label, value) {
  console.log(`  ${colorize(label + ':', 'dim')} ${value}`);
}

// ============================================================================
// Analysis Functions
// ============================================================================

async function listAssistants() {
  section('Assistants');
  const assistants = await vapiRequest('GET', '/assistant');

  if (assistants.length === 0) {
    warn('No assistants found');
    return [];
  }

  assistants.forEach(a => {
    console.log(`  ${colorize(a.id, 'cyan')} - ${a.name || 'Unnamed'}`);
    if (a.model) {
      info('    Model', `${a.model.provider}/${a.model.model}`);
    }
    if (a.voice) {
      info('    Voice', `${a.voice.provider}/${a.voice.voiceId || a.voice.model}`);
    }
  });

  return assistants;
}

async function listPhoneNumbers() {
  section('Phone Numbers');
  const phones = await vapiRequest('GET', '/phone-number');

  if (phones.length === 0) {
    warn('No phone numbers configured');
    return [];
  }

  phones.forEach(p => {
    const provider = p.provider || 'unknown';
    const status = p.status || 'unknown';
    const statusColor = status === 'active' ? 'green' : 'yellow';

    console.log(`  ${colorize(p.number || p.id, 'cyan')}`);
    info('    ID', p.id);
    info('    Provider', provider.toUpperCase());
    info('    Status', colorize(status, statusColor));

    if (p.assistantId) {
      info('    Assistant', p.assistantId);
    } else {
      warn('    No assistant assigned!');
    }

    // Telnyx-specific checks
    if (provider === 'telnyx') {
      info('    Telnyx ID', p.telnyxPhoneNumberId || 'N/A');
      if (p.fallbackDestination) {
        info('    Fallback', p.fallbackDestination.number);
      }
    }
  });

  return phones;
}

async function analyzeRecentCalls(limit = 10) {
  section(`Recent Calls (last ${limit})`);
  const calls = await vapiRequest('GET', `/call?limit=${limit}`);

  if (calls.length === 0) {
    warn('No calls found');
    return [];
  }

  const stats = {
    totalCalls: calls.length,
    avgDuration: 0,
    statusCounts: {},
    endReasons: {},
    latencyIssues: 0,
    transcriptionIssues: 0
  };

  calls.forEach(call => {
    // Count statuses
    stats.statusCounts[call.status] = (stats.statusCounts[call.status] || 0) + 1;

    // Count end reasons
    if (call.endedReason) {
      stats.endReasons[call.endedReason] = (stats.endReasons[call.endedReason] || 0) + 1;
    }

    // Sum durations
    if (call.duration) {
      stats.avgDuration += call.duration;
    }
  });

  stats.avgDuration = stats.avgDuration / calls.length;

  // Display summary
  info('Total calls', stats.totalCalls);
  info('Avg duration', formatDuration(stats.avgDuration));

  console.log('\n  Status breakdown:');
  Object.entries(stats.statusCounts).forEach(([status, count]) => {
    const pct = ((count / stats.totalCalls) * 100).toFixed(0);
    const color = status === 'ended' ? 'green' : status === 'failed' ? 'red' : 'yellow';
    console.log(`    ${colorize(status, color)}: ${count} (${pct}%)`);
  });

  if (Object.keys(stats.endReasons).length > 0) {
    console.log('\n  End reasons:');
    Object.entries(stats.endReasons).forEach(([reason, count]) => {
      const color = reason.includes('error') || reason.includes('fail') ? 'red' : 'dim';
      console.log(`    ${colorize(reason, color)}: ${count}`);
    });
  }

  return calls;
}

async function analyzeCall(callId) {
  header(`Call Analysis: ${callId}`);

  const call = await vapiRequest('GET', `/call/${callId}`);

  section('Basic Info');
  info('Status', call.status);
  info('Started', new Date(call.createdAt).toLocaleString());
  if (call.endedAt) {
    info('Ended', new Date(call.endedAt).toLocaleString());
  }
  if (call.duration) {
    info('Duration', formatDuration(call.duration));
  }
  info('End Reason', call.endedReason || 'N/A');

  section('Configuration');
  if (call.assistant) {
    info('Assistant', call.assistant.name || call.assistantId);
  }
  if (call.phoneNumber) {
    info('Phone', call.phoneNumber.number || call.phoneNumberId);
    info('Provider', call.phoneNumber.provider || 'unknown');
  }

  // Analyze latency from call data
  section('Latency Analysis');

  if (call.analysis) {
    const analysis = call.analysis;

    if (analysis.averageLatency) {
      console.log(`  Average Latency: ${formatMs(analysis.averageLatency)}`);
    }

    if (analysis.latencyP50) info('P50 Latency', formatMs(analysis.latencyP50));
    if (analysis.latencyP90) info('P90 Latency', formatMs(analysis.latencyP90));
    if (analysis.latencyP99) info('P99 Latency', formatMs(analysis.latencyP99));
  } else {
    warn('No latency analysis available for this call');
  }

  // Check for errors
  section('Issues & Errors');

  if (call.error) {
    error(`Call error: ${JSON.stringify(call.error)}`);
  }

  if (call.endedReason === 'silence-timed-out') {
    warn('Call ended due to silence timeout');
  }

  if (call.endedReason === 'assistant-error') {
    error('Assistant encountered an error');
  }

  if (call.endedReason === 'phone-call-provider-error') {
    error('Phone provider (Telnyx) error occurred');
  }

  // Transcript analysis
  if (call.transcript) {
    section('Transcript Summary');
    info('Messages', call.transcript.length);

    // Check for transcription issues
    const userMessages = call.transcript.filter(m => m.role === 'user');
    const shortMessages = userMessages.filter(m => m.content && m.content.length < 3);

    if (shortMessages.length > userMessages.length * 0.3) {
      warn('Many short transcriptions detected - possible audio quality issue');
    }
  }

  // Cost analysis
  if (call.cost) {
    section('Cost Breakdown');
    info('Total', `$${call.cost.toFixed(4)}`);
    if (call.costBreakdown) {
      Object.entries(call.costBreakdown).forEach(([key, value]) => {
        info(`  ${key}`, `$${value.toFixed(4)}`);
      });
    }
  }

  return call;
}

async function analyzePhoneNumber(phoneId) {
  header(`Phone Number Analysis: ${phoneId}`);

  const phone = await vapiRequest('GET', `/phone-number/${phoneId}`);

  section('Configuration');
  info('Number', phone.number || 'N/A');
  info('Provider', phone.provider || 'unknown');
  info('Status', phone.status || 'unknown');
  info('Created', new Date(phone.createdAt).toLocaleString());

  if (phone.provider === 'telnyx') {
    section('Telnyx Configuration');
    info('Telnyx Phone ID', phone.telnyxPhoneNumberId || 'N/A');
    info('Telnyx App ID', phone.telnyxApplicationId || 'N/A');

    if (!phone.telnyxPhoneNumberId) {
      error('Missing Telnyx Phone Number ID - number may not be properly linked');
    }
  }

  section('Assistant Binding');
  if (phone.assistantId) {
    info('Assistant ID', phone.assistantId);
    success('Phone number is bound to an assistant');
  } else {
    error('No assistant assigned - calls will fail!');
  }

  // Check for fallback configuration
  section('Fallback Configuration');
  if (phone.fallbackDestination) {
    info('Fallback Number', phone.fallbackDestination.number);
    info('Fallback Message', phone.fallbackDestination.message || 'N/A');
    success('Fallback is configured');
  } else {
    warn('No fallback destination configured');
  }

  // Analyze recent calls for this phone number
  section('Recent Activity');
  const calls = await vapiRequest('GET', `/call?phoneNumberId=${phoneId}&limit=5`);

  if (calls.length === 0) {
    warn('No recent calls found for this number');
  } else {
    calls.forEach(call => {
      const status = call.status === 'ended' ? colorize('✓', 'green') :
                     call.status === 'failed' ? colorize('✗', 'red') :
                     colorize('●', 'yellow');
      const duration = call.duration ? formatDuration(call.duration) : 'N/A';
      const date = new Date(call.createdAt).toLocaleDateString();
      console.log(`  ${status} ${date} - ${duration} - ${call.endedReason || call.status}`);
    });
  }

  return phone;
}

async function analyzeAssistant(assistantId) {
  header(`Assistant Analysis: ${assistantId}`);

  const assistant = await vapiRequest('GET', `/assistant/${assistantId}`);

  section('Basic Info');
  info('Name', assistant.name || 'Unnamed');
  info('Created', new Date(assistant.createdAt).toLocaleString());
  info('Updated', new Date(assistant.updatedAt).toLocaleString());

  section('Model Configuration');
  if (assistant.model) {
    const model = assistant.model;
    info('Provider', model.provider);
    info('Model', model.model);
    info('Temperature', model.temperature || 0.7);
    info('Max Tokens', model.maxTokens || 'default');

    // Latency analysis
    const slowModels = ['gpt-4', 'gpt-4-turbo', 'claude-3-opus'];
    const fastModels = ['gpt-3.5-turbo', 'gpt-4o-mini', 'gemini-1.5-flash', 'gemini-2.0-flash'];

    if (slowModels.some(m => model.model.includes(m))) {
      warn(`${model.model} is a slower model - consider faster alternatives for lower latency`);
    }
    if (fastModels.some(m => model.model.includes(m))) {
      success(`${model.model} is optimized for speed`);
    }
  }

  section('Voice Configuration');
  if (assistant.voice) {
    const voice = assistant.voice;
    info('Provider', voice.provider);
    info('Voice ID', voice.voiceId || voice.model);

    // Voice latency analysis
    const fastVoiceProviders = ['deepgram', 'cartesia'];
    const slowVoiceProviders = ['elevenlabs'];

    if (fastVoiceProviders.includes(voice.provider)) {
      success(`${voice.provider} is optimized for low latency`);
    }
    if (slowVoiceProviders.includes(voice.provider)) {
      warn(`${voice.provider} has higher latency - consider Cartesia or Deepgram for speed`);
    }
  }

  section('Transcriber Configuration');
  if (assistant.transcriber) {
    const transcriber = assistant.transcriber;
    info('Provider', transcriber.provider);
    info('Model', transcriber.model);
    info('Language', transcriber.language || 'auto');

    if (transcriber.model === 'nova-3' || transcriber.model === 'nova-2') {
      success('Using Deepgram Nova - excellent accuracy and speed');
    }
  }

  section('Timing Configuration');
  info('Silence Timeout', `${assistant.silenceTimeoutSeconds || 30}s`);
  info('Response Delay', `${assistant.responseDelaySeconds || 0.4}s`);
  info('LLM Request Delay', `${assistant.llmRequestDelaySeconds || 0.1}s`);
  info('Interrupt Words', assistant.numWordsToInterruptAssistant || 1);
  info('Max Duration', `${assistant.maxDurationSeconds || 600}s`);

  // Timing recommendations
  if ((assistant.responseDelaySeconds || 0.4) > 0.5) {
    warn('Response delay > 0.5s may feel sluggish');
  }

  section('Tools/Functions');
  if (assistant.tools && assistant.tools.length > 0) {
    assistant.tools.forEach(tool => {
      console.log(`  • ${tool.function?.name || tool.name || 'unnamed'}`);
    });
  } else if (assistant.toolIds && assistant.toolIds.length > 0) {
    info('Tool IDs', assistant.toolIds.join(', '));
  } else {
    info('Tools', 'None configured');
  }

  // System prompt analysis
  if (assistant.model?.messages) {
    section('System Prompt Analysis');
    const systemMsg = assistant.model.messages.find(m => m.role === 'system');
    if (systemMsg) {
      const promptLength = systemMsg.content.length;
      info('Prompt Length', `${promptLength} characters`);

      if (promptLength > 2000) {
        warn('Long system prompt may increase latency');
      }
      if (promptLength < 200) {
        warn('Short system prompt - assistant may lack context');
      }
    }
  }

  return assistant;
}

async function runFullDiagnostics() {
  header('VAPI Voice Agent Diagnostics');
  console.log(colorize('  Running comprehensive analysis...', 'dim'));

  try {
    // List all resources
    const assistants = await listAssistants();
    const phones = await listPhoneNumbers();
    const calls = await analyzeRecentCalls(20);

    // Summary and recommendations
    header('Recommendations');

    // Check for unassigned phones
    const unassignedPhones = phones.filter(p => !p.assistantId);
    if (unassignedPhones.length > 0) {
      error(`${unassignedPhones.length} phone number(s) without assistant assignment`);
    }

    // Check for failed calls
    const failedCalls = calls.filter(c => c.status === 'failed' || c.endedReason?.includes('error'));
    if (failedCalls.length > 0) {
      warn(`${failedCalls.length} failed calls in recent history - investigate with --call <id>`);
      console.log('  Failed call IDs:');
      failedCalls.slice(0, 3).forEach(c => {
        console.log(`    ${colorize(c.id, 'cyan')} - ${c.endedReason || c.status}`);
      });
    }

    // Analyze first assistant for config issues
    if (assistants.length > 0) {
      await analyzeAssistant(assistants[0].id);
    }

    // Analyze first Telnyx phone for config issues
    const telnyxPhones = phones.filter(p => p.provider === 'telnyx');
    if (telnyxPhones.length > 0) {
      section('Telnyx-Specific Analysis');
      for (const phone of telnyxPhones) {
        await analyzePhoneNumber(phone.id);
      }
    }

    header('Next Steps');
    console.log(`
  1. To analyze a specific call:
     ${colorize('VAPI_TOKEN=xxx node scripts/debug-vapi.js --call <call-id>', 'cyan')}

  2. To analyze a phone number:
     ${colorize('VAPI_TOKEN=xxx node scripts/debug-vapi.js --phone <phone-id>', 'cyan')}

  3. To analyze an assistant:
     ${colorize('VAPI_TOKEN=xxx node scripts/debug-vapi.js --assistant <assistant-id>', 'cyan')}

  4. Check VAPI dashboard for real-time metrics:
     ${colorize('https://dashboard.vapi.ai', 'cyan')}

  5. Test webhook latency:
     ${colorize('node scripts/test-latency.js', 'cyan')}
`);

  } catch (err) {
    error(`Diagnostics failed: ${err.message}`);
    process.exit(1);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  try {
    if (args.includes('--call')) {
      const callId = args[args.indexOf('--call') + 1];
      if (!callId) throw new Error('Missing call ID');
      await analyzeCall(callId);
    } else if (args.includes('--assistant')) {
      const assistantId = args[args.indexOf('--assistant') + 1];
      if (!assistantId) throw new Error('Missing assistant ID');
      await analyzeAssistant(assistantId);
    } else if (args.includes('--phone')) {
      const phoneId = args[args.indexOf('--phone') + 1];
      if (!phoneId) throw new Error('Missing phone ID');
      await analyzePhoneNumber(phoneId);
    } else if (args.includes('--calls')) {
      const limit = parseInt(args[args.indexOf('--calls') + 1]) || 20;
      await analyzeRecentCalls(limit);
    } else {
      await runFullDiagnostics();
    }
  } catch (err) {
    error(err.message);
    process.exit(1);
  }
}

main();
