# Alexis - PrestaShop API Reference

PrestaShop e-commerce API documentation for voice agent integration.

**Store:** https://armenius.cy

---

## Authentication

PrestaShop uses API key via HTTP Basic Auth:

```bash
curl -u "API_KEY:" https://armenius.cy/api/
```

**Enable Webservice:**
1. **Advanced Parameters** > **Webservice**
2. Enable webservice: **Yes**
3. Add new webservice key
4. Set permissions per resource

---

## Required Permissions

| Resource | GET | POST | Purpose |
|----------|-----|------|---------|
| orders | ✓ | - | Order status |
| order_states | ✓ | - | Status labels |
| order_carriers | ✓ | - | Tracking info |
| customers | ✓ | - | Customer lookup |
| addresses | ✓ | - | Shipping info |
| products | ✓ | - | Product info |
| stock_availables | ✓ | - | Inventory |
| carriers | ✓ | - | Shipping carriers |
| messages | ✓ | ✓ | Support tickets |

---

## API Endpoints

Base: `https://armenius.cy/api/{resource}?output_format=JSON`

---

### Orders

**Get order by ID:**
```
GET /api/orders/{id}?output_format=JSON
```

**Filter by reference:**
```
GET /api/orders?filter[reference]={REFERENCE}&output_format=JSON
```

**Filter by customer:**
```
GET /api/orders?filter[id_customer]={customer_id}&output_format=JSON
```

**Response:**
```json
{
  "order": {
    "id": 123,
    "reference": "ABCDEFGHI",
    "id_customer": 45,
    "id_address_delivery": 67,
    "current_state": 4,
    "payment": "Credit Card",
    "total_paid": "150.00",
    "date_add": "2024-01-15 10:30:00"
  }
}
```

---

### Order States

**Get all states:**
```
GET /api/order_states?output_format=JSON
```

| ID | Status |
|----|--------|
| 1 | Awaiting check payment |
| 2 | Payment accepted |
| 3 | Processing in progress |
| 4 | Shipped |
| 5 | Delivered |
| 6 | Canceled |
| 7 | Refunded |

---

### Customers

**Find by email:**
```
GET /api/customers?filter[email]={email}&output_format=JSON
```

**Get by ID:**
```
GET /api/customers/{id}?output_format=JSON
```

---

### Products

**Get product:**
```
GET /api/products/{id}?display=full&output_format=JSON
```

**Search by name:**
```
GET /api/products?filter[name]=%{search}%&output_format=JSON
```

---

### Stock Availability

**Check stock (use bracket notation):**
```
GET /api/stock_availables?filter[id_product]=[{product_id}]&filter[id_product_attribute]=[0]&display=full&output_format=JSON
```

**Example:**
```
GET /api/stock_availables?filter[id_product]=[39041]&filter[id_product_attribute]=[0]&display=full&output_format=JSON
```

**Response:**
```json
{
  "stock_availables": [{
    "id": 40580,
    "id_product": 39041,
    "id_product_attribute": 0,
    "quantity": 5,
    "out_of_stock": 2
  }]
}
```

**Stock is in the `quantity` key.**

---

### Tracking

**Get carrier for order:**
```
GET /api/order_carriers?filter[id_order]={order_id}&output_format=JSON
```

**Get carrier details:**
```
GET /api/carriers/{carrier_id}?output_format=JSON
```

---

### Addresses

**Get address:**
```
GET /api/addresses/{id}?output_format=JSON
```

---

## Delivery Times

**Delivery times are NOT in the API.**

Direct customers to the product page:
```
https://armenius.cy/index.php?id_product={product_id}&controller=product
```

Always tell customers: *"For delivery times, please check the product page. I can send you the link."*

---

## Filter Syntax

| Type | Syntax | Example |
|------|--------|---------|
| Equals | `filter[field]=value` | `filter[id]=5` |
| Contains | `filter[field]=%value%` | `filter[name]=%shirt%` |
| Bracket | `filter[field]=[value]` | `filter[id_product]=[39041]` |
| Range | `filter[field]=[min,max]` | `filter[price]=[10,50]` |

---

## Multilanguage Fields

Product names/descriptions are arrays:
```json
{
  "name": [
    {"id": 1, "value": "English Name"},
    {"id": 2, "value": "Greek Name"}
  ]
}
```

Use language ID 1 for English.

---

## Error Codes

| Code | Meaning |
|------|---------|
| 1 | Missing API key |
| 2 | Invalid API key |
| 14 | Resource not found |
| 67 | Required field missing |
