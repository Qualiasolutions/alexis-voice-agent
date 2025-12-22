# CLAUDE.md - Alexis Voice Agent for PrestaShop

## Project Overview

Alexis is a VAPI voice AI agent that integrates with PrestaShop e-commerce platform. The agent handles customer service calls including order status, product inquiries, returns, and general support.

## Architecture

```
alexis/
├── src/
│   ├── tools/          # VAPI tool implementations (webhooks)
│   ├── services/       # PrestaShop API service layer
│   └── utils/          # Helpers, validation, formatting
├── docs/               # Additional documentation
├── config/             # Environment and configuration
└── tests/              # Test files
```

## PrestaShop Webservice API

### Authentication

PrestaShop uses API key authentication via HTTP Basic Auth:

```bash
# API Key goes in username field, password is empty
curl -u "YOUR_API_KEY:" https://your-store.com/api/
```

### Base Configuration

```env
PRESTASHOP_URL=https://your-store.com
PRESTASHOP_API_KEY=your_webservice_api_key
```

### Enabling Webservice in PrestaShop

1. Go to **Advanced Parameters** > **Webservice**
2. Enable webservice: **Yes**
3. Click **Add new webservice key**
4. Generate or enter API key
5. Set permissions for each resource (GET, POST, PUT, DELETE)

### Required Permissions for Voice Agent

| Resource | GET | POST | PUT | DELETE | Purpose |
|----------|-----|------|-----|--------|---------|
| orders | ✓ | - | - | - | Check order status |
| order_histories | ✓ | ✓ | - | - | Update order status |
| order_states | ✓ | - | - | - | Get status labels |
| customers | ✓ | - | ✓ | - | Customer lookup/update |
| addresses | ✓ | - | - | - | Shipping info |
| products | ✓ | - | - | - | Product information |
| stock_availables | ✓ | - | - | - | Inventory check |
| categories | ✓ | - | - | - | Product categories |
| carriers | ✓ | - | - | - | Shipping carriers |
| order_carriers | ✓ | - | - | - | Tracking info |
| messages | ✓ | ✓ | - | - | Customer messages |
| customer_threads | ✓ | ✓ | - | - | Support tickets |

---

## PrestaShop API Endpoints

### Base URL Format
```
https://{store_url}/api/{resource}
```

### Response Format

By default, PrestaShop returns XML. For JSON:
```
?output_format=JSON
```

---

## Core API Resources

### 1. Orders

**Get all orders:**
```http
GET /api/orders?output_format=JSON
```

**Get specific order:**
```http
GET /api/orders/{id}?output_format=JSON
```

**Filter by customer email (via customer ID):**
```http
GET /api/orders?filter[id_customer]={customer_id}&output_format=JSON
```

**Filter by reference:**
```http
GET /api/orders?filter[reference]={order_reference}&output_format=JSON
```

**Filter by date:**
```http
GET /api/orders?filter[date_add]=[2024-01-01,2024-12-31]&output_format=JSON
```

**Order Response Structure:**
```json
{
  "order": {
    "id": 123,
    "reference": "ABCDEFGHI",
    "id_customer": 45,
    "id_address_delivery": 67,
    "id_address_invoice": 68,
    "current_state": 4,
    "payment": "Credit Card",
    "total_paid": "150.00",
    "total_products": "130.00",
    "total_shipping": "20.00",
    "date_add": "2024-01-15 10:30:00",
    "associations": {
      "order_rows": [
        {
          "id": 1,
          "product_id": 10,
          "product_name": "Product Name",
          "product_quantity": 2,
          "unit_price_tax_incl": "65.00"
        }
      ]
    }
  }
}
```

### 2. Order States (Status Labels)

**Get all order states:**
```http
GET /api/order_states?output_format=JSON
```

**Common Order States (default PrestaShop):**
| ID | Name |
|----|------|
| 1 | Awaiting check payment |
| 2 | Payment accepted |
| 3 | Processing in progress |
| 4 | Shipped |
| 5 | Delivered |
| 6 | Canceled |
| 7 | Refunded |
| 8 | Payment error |
| 9 | On backorder (paid) |
| 10 | Awaiting bank wire payment |
| 11 | Awaiting PayPal payment |
| 12 | Remote payment accepted |

### 3. Customers

**Search customer by email:**
```http
GET /api/customers?filter[email]={email}&output_format=JSON
```

**Get customer by ID:**
```http
GET /api/customers/{id}?output_format=JSON
```

**Customer Response:**
```json
{
  "customer": {
    "id": 45,
    "id_lang": 1,
    "firstname": "John",
    "lastname": "Doe",
    "email": "john.doe@email.com",
    "active": "1",
    "date_add": "2023-05-10 14:20:00"
  }
}
```

### 4. Products

**Get product by ID:**
```http
GET /api/products/{id}?output_format=JSON
```

**Search products by name:**
```http
GET /api/products?filter[name]=%{search_term}%&output_format=JSON
```

**Get product with full details:**
```http
GET /api/products/{id}?display=full&output_format=JSON
```

**Product Response:**
```json
{
  "product": {
    "id": 10,
    "id_manufacturer": 1,
    "id_category_default": 5,
    "name": [{"id": 1, "value": "Product Name"}],
    "description": [{"id": 1, "value": "Full description"}],
    "description_short": [{"id": 1, "value": "Short description"}],
    "price": "65.000000",
    "active": "1",
    "available_for_order": "1",
    "quantity": 100
  }
}
```

### 5. Stock Availability

**Check stock for product:**
```http
GET /api/stock_availables?filter[id_product]={product_id}&output_format=JSON
```

**Response:**
```json
{
  "stock_available": {
    "id": 1,
    "id_product": 10,
    "id_product_attribute": 0,
    "quantity": 50,
    "out_of_stock": 1
  }
}
```

### 6. Addresses

**Get delivery address:**
```http
GET /api/addresses/{id}?output_format=JSON
```

**Response:**
```json
{
  "address": {
    "id": 67,
    "id_customer": 45,
    "firstname": "John",
    "lastname": "Doe",
    "address1": "123 Main Street",
    "address2": "Apt 4B",
    "city": "New York",
    "postcode": "10001",
    "id_country": 21,
    "phone": "+1234567890"
  }
}
```

### 7. Order Carriers (Tracking)

**Get carrier info for order:**
```http
GET /api/order_carriers?filter[id_order]={order_id}&output_format=JSON
```

**Response:**
```json
{
  "order_carrier": {
    "id": 1,
    "id_order": 123,
    "id_carrier": 2,
    "tracking_number": "1Z999AA10123456784",
    "date_add": "2024-01-16 09:00:00"
  }
}
```

### 8. Carriers

**Get carrier details:**
```http
GET /api/carriers/{id}?output_format=JSON
```

**Response:**
```json
{
  "carrier": {
    "id": 2,
    "name": "UPS",
    "url": "https://www.ups.com/track?tracknum=@",
    "active": "1"
  }
}
```

### 9. Customer Messages

**Create customer message:**
```http
POST /api/messages
Content-Type: application/xml

<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <message>
    <id_order>123</id_order>
    <id_customer>45</id_customer>
    <message>Customer inquiry from voice call...</message>
    <private>0</private>
  </message>
</prestashop>
```

---

## API Filter Operators

| Operator | Syntax | Example |
|----------|--------|---------|
| Equals | `filter[field]=value` | `filter[id]=5` |
| Contains | `filter[field]=%value%` | `filter[name]=%shirt%` |
| Starts with | `filter[field]=value%` | `filter[reference]=ABC%` |
| Range | `filter[field]=[min,max]` | `filter[price]=[10,50]` |
| Multiple values | `filter[field]=[v1\|v2]` | `filter[id]=[1\|2\|3]` |

---

## Display Options

**Select specific fields:**
```http
GET /api/orders?display=[id,reference,total_paid]&output_format=JSON
```

**Get full resource:**
```http
GET /api/orders/{id}?display=full&output_format=JSON
```

---

## VAPI Agent Tools

The agent should have these tools configured:

### 1. lookup_order
Finds order by reference number or customer email.

**Parameters:**
- `order_reference` (string, optional): Order reference code
- `customer_email` (string, optional): Customer email address

### 2. get_order_status
Gets current status and tracking for an order.

**Parameters:**
- `order_id` (integer): PrestaShop order ID

### 3. check_product_availability
Checks if a product is in stock.

**Parameters:**
- `product_id` (integer, optional): Product ID
- `product_name` (string, optional): Product name to search

### 4. get_product_info
Gets product details including price and description.

**Parameters:**
- `product_id` (integer): Product ID

### 5. create_support_ticket
Creates a customer service ticket.

**Parameters:**
- `customer_email` (string): Customer email
- `order_id` (integer, optional): Related order ID
- `message` (string): Customer's issue description

### 6. get_tracking_info
Gets shipping tracking information.

**Parameters:**
- `order_id` (integer): Order ID

---

## Error Handling

PrestaShop API errors return:

```json
{
  "errors": [
    {
      "code": 100,
      "message": "Error description"
    }
  ]
}
```

**Common Error Codes:**
| Code | Meaning |
|------|---------|
| 1 | Missing webservice key |
| 2 | Invalid webservice key |
| 13 | Invalid filter value |
| 14 | Resource not found |
| 67 | Required field missing |
| 72 | Invalid association |

---

## Rate Limiting

PrestaShop doesn't have built-in rate limiting, but consider:
- Implement client-side rate limiting (10-20 req/sec max)
- Cache frequently accessed data (order states, carriers)
- Use display filters to reduce payload size

---

## Security Best Practices

1. **HTTPS Only**: Always use HTTPS for API calls
2. **Minimal Permissions**: Only enable required resources
3. **IP Whitelist**: Restrict API access to server IPs
4. **Key Rotation**: Rotate API keys periodically
5. **Logging**: Log all API access for auditing

---

## Environment Variables

```env
# PrestaShop Configuration
PRESTASHOP_URL=https://your-store.com
PRESTASHOP_API_KEY=your_api_key
PRESTASHOP_LANGUAGE_ID=1

# VAPI Configuration
VAPI_API_KEY=your_vapi_key
VAPI_ASSISTANT_ID=your_assistant_id
VAPI_PHONE_NUMBER_ID=your_phone_id

# Server Configuration
PORT=3000
NODE_ENV=production
WEBHOOK_SECRET=your_webhook_secret
```

---

## Development Commands

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Start production server
npm start
```

---

## Testing the API

```bash
# Test connection
curl -u "API_KEY:" "https://store.com/api/?output_format=JSON"

# Test order lookup
curl -u "API_KEY:" "https://store.com/api/orders?filter[reference]=ABCD&output_format=JSON"

# Test customer search
curl -u "API_KEY:" "https://store.com/api/customers?filter[email]=test@email.com&output_format=JSON"
```

---

## Multilanguage Support

PrestaShop fields like `name` and `description` are multilanguage:

```json
{
  "name": [
    {"id": 1, "value": "Product Name (English)"},
    {"id": 2, "value": "Nom du produit (French)"}
  ]
}
```

Get the value for a specific language:
```javascript
const name = product.name.find(n => n.id === languageId)?.value;
```

---

## Common Voice Agent Scenarios

### Scenario 1: Order Status Check
1. Customer provides order number or email
2. Agent looks up order via API
3. Agent retrieves order state name
4. Agent gets tracking if shipped
5. Agent communicates status to customer

### Scenario 2: Product Inquiry
1. Customer asks about product
2. Agent searches products by name
3. Agent retrieves stock availability
4. Agent provides price and availability info

### Scenario 3: Return Request
1. Customer provides order number
2. Agent verifies order exists and is delivered
3. Agent creates support ticket for return
4. Agent provides return policy information

### Scenario 4: Tracking Request
1. Customer provides order number
2. Agent retrieves order carrier info
3. Agent gets tracking number
4. Agent provides carrier tracking URL
