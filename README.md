# Alexis - VAPI Voice Agent for PrestaShop

Voice AI customer service agent that integrates with PrestaShop e-commerce platform.

## Features

- Order status lookup by reference or email
- Shipment tracking information
- Product availability checks
- Customer support ticket creation
- Customer verification

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your credentials

# Run development server
npm run dev
```

## Configuration

See `.env.example` for required environment variables:

- `PRESTASHOP_URL` - Your PrestaShop store URL
- `PRESTASHOP_API_KEY` - WebService API key
- `VAPI_API_KEY` - Your VAPI API key

## VAPI Tools

| Tool | Description |
|------|-------------|
| `lookup_order` | Find order by reference or customer email |
| `get_order_status` | Get order status and tracking |
| `get_tracking_info` | Get shipping tracking details |
| `check_product_availability` | Check if product is in stock |
| `get_product_info` | Get product details |
| `create_support_ticket` | Create customer support ticket |
| `verify_customer` | Verify customer by email |

## Endpoints

- `GET /health` - Health check
- `POST /vapi/tools` - VAPI tool calls webhook
- `POST /vapi/webhook` - VAPI event webhook

## Documentation

See `CLAUDE.md` for complete PrestaShop API documentation.
