import axios from 'axios';

/**
 * PrestaShop Webservice API Client
 */
export class PrestaShopService {
  constructor(config = {}) {
    this.baseUrl = config.url || process.env.PRESTASHOP_URL;
    this.apiKey = config.apiKey || process.env.PRESTASHOP_API_KEY;
    this.languageId = config.languageId || process.env.PRESTASHOP_LANGUAGE_ID || 1;

    if (!this.baseUrl || !this.apiKey) {
      throw new Error('PrestaShop URL and API key are required');
    }

    this.client = axios.create({
      baseURL: `${this.baseUrl}/api`,
      auth: {
        username: this.apiKey,
        password: ''
      },
      params: {
        output_format: 'JSON'
      }
    });
  }

  /**
   * Get multilanguage field value
   */
  getLocalizedValue(field, languageId = this.languageId) {
    if (!field) return null;
    if (typeof field === 'string') return field;
    if (Array.isArray(field)) {
      const localized = field.find(f => f.id == languageId);
      return localized?.value || field[0]?.value || null;
    }
    return null;
  }

  // ==================== ORDERS ====================

  /**
   * Get order by ID
   */
  async getOrder(orderId) {
    try {
      const response = await this.client.get(`/orders/${orderId}`, {
        params: { display: 'full' }
      });
      return response.data.order;
    } catch (error) {
      this.handleError(error, 'getOrder');
    }
  }

  /**
   * Get order by reference number
   */
  async getOrderByReference(reference) {
    try {
      const response = await this.client.get('/orders', {
        params: {
          'filter[reference]': reference,
          display: 'full'
        }
      });
      const orders = response.data.orders;
      return orders?.length > 0 ? orders[0] : null;
    } catch (error) {
      this.handleError(error, 'getOrderByReference');
    }
  }

  /**
   * Get orders by customer ID
   */
  async getOrdersByCustomer(customerId, limit = 10) {
    try {
      const response = await this.client.get('/orders', {
        params: {
          'filter[id_customer]': customerId,
          sort: '[date_add_DESC]',
          limit: limit,
          display: '[id,reference,current_state,total_paid,date_add]'
        }
      });
      return response.data.orders || [];
    } catch (error) {
      this.handleError(error, 'getOrdersByCustomer');
    }
  }

  /**
   * Get order state label
   */
  async getOrderState(stateId) {
    try {
      const response = await this.client.get(`/order_states/${stateId}`);
      const state = response.data.order_state;
      return {
        id: state.id,
        name: this.getLocalizedValue(state.name),
        color: state.color
      };
    } catch (error) {
      this.handleError(error, 'getOrderState');
    }
  }

  // ==================== CUSTOMERS ====================

  /**
   * Find customer by email
   */
  async getCustomerByEmail(email) {
    try {
      const response = await this.client.get('/customers', {
        params: { 'filter[email]': email }
      });
      const customers = response.data.customers;
      return customers?.length > 0 ? customers[0] : null;
    } catch (error) {
      this.handleError(error, 'getCustomerByEmail');
    }
  }

  /**
   * Get customer by ID
   */
  async getCustomer(customerId) {
    try {
      const response = await this.client.get(`/customers/${customerId}`);
      return response.data.customer;
    } catch (error) {
      this.handleError(error, 'getCustomer');
    }
  }

  // ==================== PRODUCTS ====================

  /**
   * Get product by ID
   */
  async getProduct(productId) {
    try {
      const response = await this.client.get(`/products/${productId}`, {
        params: { display: 'full' }
      });
      const product = response.data.product;
      return {
        id: product.id,
        name: this.getLocalizedValue(product.name),
        description: this.getLocalizedValue(product.description_short),
        price: parseFloat(product.price),
        active: product.active === '1',
        available: product.available_for_order === '1'
      };
    } catch (error) {
      this.handleError(error, 'getProduct');
    }
  }

  /**
   * Search products by name
   */
  async searchProducts(searchTerm, limit = 5) {
    try {
      const response = await this.client.get('/products', {
        params: {
          'filter[name]': `%${searchTerm}%`,
          limit: limit,
          display: '[id,name,price,active]'
        }
      });
      return response.data.products || [];
    } catch (error) {
      this.handleError(error, 'searchProducts');
    }
  }

  /**
   * Check product stock availability
   */
  async getProductStock(productId) {
    try {
      const response = await this.client.get('/stock_availables', {
        params: {
          'filter[id_product]': productId,
          'filter[id_product_attribute]': 0
        }
      });
      const stocks = response.data.stock_availables;
      if (stocks?.length > 0) {
        return {
          productId,
          quantity: parseInt(stocks[0].quantity) || 0,
          inStock: parseInt(stocks[0].quantity) > 0
        };
      }
      return { productId, quantity: 0, inStock: false };
    } catch (error) {
      this.handleError(error, 'getProductStock');
    }
  }

  // ==================== ADDRESSES ====================

  /**
   * Get address by ID
   */
  async getAddress(addressId) {
    try {
      const response = await this.client.get(`/addresses/${addressId}`);
      const addr = response.data.address;
      return {
        id: addr.id,
        firstname: addr.firstname,
        lastname: addr.lastname,
        address1: addr.address1,
        address2: addr.address2,
        city: addr.city,
        postcode: addr.postcode,
        phone: addr.phone
      };
    } catch (error) {
      this.handleError(error, 'getAddress');
    }
  }

  // ==================== TRACKING ====================

  /**
   * Get tracking info for order
   */
  async getOrderTracking(orderId) {
    try {
      const response = await this.client.get('/order_carriers', {
        params: { 'filter[id_order]': orderId }
      });
      const carriers = response.data.order_carriers;
      if (carriers?.length > 0) {
        const orderCarrier = carriers[0];
        // Get carrier details for tracking URL
        const carrierResponse = await this.client.get(`/carriers/${orderCarrier.id_carrier}`);
        const carrier = carrierResponse.data.carrier;

        return {
          trackingNumber: orderCarrier.tracking_number,
          carrierName: carrier.name,
          trackingUrl: carrier.url?.replace('@', orderCarrier.tracking_number) || null,
          shippedDate: orderCarrier.date_add
        };
      }
      return null;
    } catch (error) {
      this.handleError(error, 'getOrderTracking');
    }
  }

  // ==================== MESSAGES ====================

  /**
   * Create customer message/support ticket
   */
  async createMessage(orderId, customerId, message) {
    try {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<prestashop>
  <message>
    <id_order>${orderId}</id_order>
    <id_customer>${customerId}</id_customer>
    <message><![CDATA[${message}]]></message>
    <private>0</private>
  </message>
</prestashop>`;

      const response = await this.client.post('/messages', xml, {
        headers: { 'Content-Type': 'application/xml' },
        params: {} // Override JSON output format for POST
      });
      return response.data;
    } catch (error) {
      this.handleError(error, 'createMessage');
    }
  }

  // ==================== ERROR HANDLING ====================

  handleError(error, method) {
    const status = error.response?.status;
    const data = error.response?.data;

    console.error(`PrestaShop API Error [${method}]:`, {
      status,
      message: error.message,
      errors: data?.errors
    });

    if (status === 401) {
      throw new Error('Invalid PrestaShop API key');
    }
    if (status === 404) {
      return null; // Resource not found
    }

    throw new Error(`PrestaShop API error: ${error.message}`);
  }
}

export default PrestaShopService;
