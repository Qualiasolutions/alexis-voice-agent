import 'dotenv/config';
import express from 'express';
import { lookupOrder, getOrderStatus, getTrackingInfo } from './tools/orderTools.js';
import { checkProductAvailability, getProductInfo } from './tools/productTools.js';
import { createSupportTicket, verifyCustomer } from './tools/supportTools.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'alexis-voice-agent' });
});

// VAPI Webhook endpoint for tool calls
app.post('/vapi/tools', async (req, res) => {
  const { message } = req.body;

  // VAPI sends tool calls in the message
  if (message?.type !== 'tool-calls') {
    return res.json({ results: [] });
  }

  const toolCalls = message.toolCalls || [];
  const results = [];

  for (const toolCall of toolCalls) {
    const { name, arguments: args } = toolCall.function;
    let result;

    try {
      switch (name) {
        case 'lookup_order':
          result = await lookupOrder(args);
          break;
        case 'get_order_status':
          result = await getOrderStatus(args);
          break;
        case 'get_tracking_info':
          result = await getTrackingInfo(args);
          break;
        case 'check_product_availability':
          result = await checkProductAvailability(args);
          break;
        case 'get_product_info':
          result = await getProductInfo(args);
          break;
        case 'create_support_ticket':
          result = await createSupportTicket(args);
          break;
        case 'verify_customer':
          result = await verifyCustomer(args);
          break;
        default:
          result = { error: `Unknown tool: ${name}` };
      }
    } catch (error) {
      console.error(`Tool ${name} error:`, error);
      result = { error: error.message };
    }

    results.push({
      toolCallId: toolCall.id,
      result: JSON.stringify(result)
    });
  }

  res.json({ results });
});

// VAPI webhook for other events (optional logging)
app.post('/vapi/webhook', (req, res) => {
  const { message } = req.body;
  console.log('VAPI Event:', message?.type, JSON.stringify(message, null, 2));
  res.json({ success: true });
});

// Start server
app.listen(PORT, () => {
  console.log(`Alexis Voice Agent server running on port ${PORT}`);
  console.log(`Tool endpoint: POST /vapi/tools`);
  console.log(`Webhook endpoint: POST /vapi/webhook`);
});
