#!/usr/bin/env node
/**
 * Deploy Alexis to Retell AI
 *
 * Usage:
 *   RETELL_API_KEY=xxx WEBHOOK_URL=https://alexis-webhook.workers.dev npm run deploy:retell
 *
 * This script:
 * 1. Creates or updates the Retell LLM with tools
 * 2. Creates or updates the Retell Agent
 * 3. Saves deployment state to .retell-deployment.json
 */

const fs = require('fs');
const path = require('path');

const RETELL_API_KEY = process.env.RETELL_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://alexis-webhook.workers.dev';
const DEPLOYMENT_FILE = path.join(__dirname, '..', '.retell-deployment.json');

if (!RETELL_API_KEY) {
  console.error('Error: RETELL_API_KEY environment variable is required');
  console.error('Get your API key from: https://dashboard.retellai.com/settings');
  process.exit(1);
}

// Load existing deployment state
function loadDeploymentState() {
  try {
    return JSON.parse(fs.readFileSync(DEPLOYMENT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Save deployment state
function saveDeploymentState(state) {
  fs.writeFileSync(DEPLOYMENT_FILE, JSON.stringify(state, null, 2));
}

// Replace template variables in config
function processConfig(config, vars) {
  const str = JSON.stringify(config);
  const processed = str
    .replace(/\$\{WEBHOOK_URL\}/g, vars.WEBHOOK_URL)
    .replace(/\$\{LLM_ID\}/g, vars.LLM_ID || '');
  return JSON.parse(processed);
}

// Retell API helper
async function retellFetch(endpoint, options = {}) {
  const url = `https://api.retellai.com${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${RETELL_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Retell API error ${response.status}: ${error}`);
  }

  return response.json();
}

// Create or update LLM
async function deployLLM(config, existingId) {
  if (existingId) {
    console.log(`Updating LLM ${existingId}...`);
    return retellFetch(`/update-retell-llm/${existingId}`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  }

  console.log('Creating new LLM...');
  return retellFetch('/create-retell-llm', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

// Create or update Agent
async function deployAgent(config, existingId) {
  if (existingId) {
    console.log(`Updating Agent ${existingId}...`);
    return retellFetch(`/update-agent/${existingId}`, {
      method: 'PATCH',
      body: JSON.stringify(config),
    });
  }

  console.log('Creating new Agent...');
  return retellFetch('/create-agent', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

async function main() {
  console.log('Deploying Alexis to Retell AI...');
  console.log(`Webhook URL: ${WEBHOOK_URL}`);
  console.log('');

  // Load configs
  const llmConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'retell-config', 'alexis-llm.json'), 'utf8')
  );
  const agentConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'retell-config', 'alexis-agent.json'), 'utf8')
  );

  // Load existing deployment state
  const state = loadDeploymentState();

  // Process LLM config with variables
  const processedLLM = processConfig(llmConfig, { WEBHOOK_URL });

  // Deploy LLM
  const llmResult = await deployLLM(processedLLM, state.llm_id);
  console.log(`✓ LLM deployed: ${llmResult.llm_id}`);
  state.llm_id = llmResult.llm_id;

  // Process Agent config with LLM ID
  const processedAgent = processConfig(agentConfig, {
    WEBHOOK_URL,
    LLM_ID: state.llm_id,
  });

  // Deploy Agent
  const agentResult = await deployAgent(processedAgent, state.agent_id);
  console.log(`✓ Agent deployed: ${agentResult.agent_id}`);
  state.agent_id = agentResult.agent_id;

  // Save state
  state.last_deployed = new Date().toISOString();
  state.webhook_url = WEBHOOK_URL;
  saveDeploymentState(state);

  console.log('');
  console.log('Deployment complete!');
  console.log(`State saved to: ${DEPLOYMENT_FILE}`);
  console.log('');
  console.log('Next steps:');
  console.log('1. Go to https://dashboard.retellai.com');
  console.log(`2. Find agent: ${agentResult.agent_id}`);
  console.log('3. Test the agent in the dashboard');
  console.log('4. Assign a phone number when ready');
}

main().catch(error => {
  console.error('Deployment failed:', error.message);
  process.exit(1);
});
