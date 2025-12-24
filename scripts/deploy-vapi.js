#!/usr/bin/env node
/**
 * Deploy Alexis to VAPI
 *
 * This script creates/updates the VAPI assistant and tools.
 * Run after deploying the webhook to get the URL.
 *
 * Usage:
 *   VAPI_TOKEN=xxx WEBHOOK_URL=https://your-app.vercel.app node scripts/deploy-vapi.js
 */

const fs = require('fs');
const path = require('path');

const VAPI_API = 'https://api.vapi.ai';
const VAPI_TOKEN = process.env.VAPI_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

if (!VAPI_TOKEN) {
  console.error('Error: VAPI_TOKEN environment variable required');
  process.exit(1);
}

if (!WEBHOOK_URL) {
  console.error('Error: WEBHOOK_URL environment variable required');
  process.exit(1);
}

async function vapiRequest(method, endpoint, body = null) {
  const options = {
    method,
    headers: {
      'Authorization': `Bearer ${VAPI_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${VAPI_API}${endpoint}`, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(`VAPI API error: ${JSON.stringify(data)}`);
  }

  return data;
}

async function createTools() {
  console.log('\n📦 Creating VAPI tools...\n');

  const toolsConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../vapi-config/tools.json'), 'utf8')
  );

  const createdTools = [];

  for (const tool of toolsConfig.tools) {
    // Replace webhook URL placeholder (server is at root level per VAPI spec)
    if (tool.server?.url) {
      tool.server.url = tool.server.url.replace('${WEBHOOK_URL}', WEBHOOK_URL);
    }

    const toolName = tool.function?.name || 'unnamed';
    console.log(`  Creating tool: ${toolName}...`);

    try {
      const created = await vapiRequest('POST', '/tool', tool);
      createdTools.push(created);
      console.log(`  ✅ Created: ${created.id}`);
    } catch (error) {
      console.error(`  ❌ Failed: ${error.message}`);
    }
  }

  return createdTools;
}

async function createAssistant(toolIds) {
  console.log('\n🤖 Creating Alexis assistant...\n');

  const assistantConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../vapi-config/alexis-assistant.json'), 'utf8')
  );

  // Add tool IDs
  if (toolIds.length > 0) {
    assistantConfig.toolIds = toolIds;
  }

  try {
    const created = await vapiRequest('POST', '/assistant', assistantConfig);
    console.log(`  ✅ Assistant created: ${created.id}`);
    console.log(`  Name: ${created.name}`);
    return created;
  } catch (error) {
    console.error(`  ❌ Failed: ${error.message}`);
    throw error;
  }
}

async function listPhoneNumbers() {
  console.log('\n📞 Available phone numbers:\n');

  try {
    const numbers = await vapiRequest('GET', '/phone-number');

    if (numbers.length === 0) {
      console.log('  No phone numbers configured.');
      console.log('  Add one at: https://dashboard.vapi.ai/phone-numbers');
    } else {
      numbers.forEach(num => {
        console.log(`  ${num.number} (${num.id})`);
      });
    }

    return numbers;
  } catch (error) {
    console.error(`  ❌ Failed to list: ${error.message}`);
    return [];
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║      ALEXIS VAPI DEPLOYMENT SCRIPT         ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`\nWebhook URL: ${WEBHOOK_URL}`);

  try {
    // Step 1: Create tools
    const tools = await createTools();
    const toolIds = tools.map(t => t.id);

    // Step 2: Create assistant with tools
    const assistant = await createAssistant(toolIds);

    // Step 3: List available phone numbers
    const phones = await listPhoneNumbers();

    // Summary
    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║              DEPLOYMENT COMPLETE           ║');
    console.log('╚════════════════════════════════════════════╝');
    console.log(`\n✅ Assistant ID: ${assistant.id}`);
    console.log(`✅ Tools created: ${toolIds.length}`);

    if (phones.length > 0) {
      console.log(`\n📞 To connect a phone number, run:`);
      console.log(`   curl -X PATCH https://api.vapi.ai/phone-number/${phones[0].id} \\`);
      console.log(`     -H "Authorization: Bearer $VAPI_TOKEN" \\`);
      console.log(`     -H "Content-Type: application/json" \\`);
      console.log(`     -d '{"assistantId": "${assistant.id}"}'`);
    }

    console.log(`\n🧪 Test the assistant at: https://dashboard.vapi.ai/assistants/${assistant.id}`);

    // Save deployment info
    const deployInfo = {
      assistantId: assistant.id,
      toolIds: toolIds,
      webhookUrl: WEBHOOK_URL,
      deployedAt: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(__dirname, '../.vapi-deployment.json'),
      JSON.stringify(deployInfo, null, 2)
    );
    console.log('\n📄 Deployment info saved to .vapi-deployment.json');

  } catch (error) {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
  }
}

main();
