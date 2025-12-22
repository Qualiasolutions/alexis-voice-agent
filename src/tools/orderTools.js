import { PrestaShopService } from '../services/prestashop.js';

const prestashop = new PrestaShopService();

/**
 * VAPI Tool: Lookup order by reference or customer email
 */
export async function lookupOrder({ order_reference, customer_email }) {
  try {
    // If order reference provided, lookup directly
    if (order_reference) {
      const order = await prestashop.getOrderByReference(order_reference);
      if (!order) {
        return {
          success: false,
          message: `No order found with reference ${order_reference}`
        };
      }
      return formatOrderResponse(order);
    }

    // If email provided, lookup customer first
    if (customer_email) {
      const customer = await prestashop.getCustomerByEmail(customer_email);
      if (!customer) {
        return {
          success: false,
          message: `No customer found with email ${customer_email}`
        };
      }

      const orders = await prestashop.getOrdersByCustomer(customer.id);
      if (!orders || orders.length === 0) {
        return {
          success: false,
          message: `No orders found for ${customer_email}`
        };
      }

      return {
        success: true,
        customer_name: `${customer.firstname} ${customer.lastname}`,
        orders: orders.map(o => ({
          id: o.id,
          reference: o.reference,
          total: o.total_paid,
          date: o.date_add
        }))
      };
    }

    return {
      success: false,
      message: 'Please provide either an order reference or customer email'
    };
  } catch (error) {
    console.error('lookupOrder error:', error);
    return { success: false, message: 'Error looking up order' };
  }
}

/**
 * VAPI Tool: Get order status and tracking
 */
export async function getOrderStatus({ order_id }) {
  try {
    const order = await prestashop.getOrder(order_id);
    if (!order) {
      return {
        success: false,
        message: `Order ${order_id} not found`
      };
    }

    const state = await prestashop.getOrderState(order.current_state);
    const tracking = await prestashop.getOrderTracking(order_id);

    return {
      success: true,
      order_reference: order.reference,
      status: state?.name || 'Unknown',
      total_paid: order.total_paid,
      order_date: order.date_add,
      tracking: tracking ? {
        carrier: tracking.carrierName,
        tracking_number: tracking.trackingNumber,
        tracking_url: tracking.trackingUrl,
        shipped_date: tracking.shippedDate
      } : null
    };
  } catch (error) {
    console.error('getOrderStatus error:', error);
    return { success: false, message: 'Error getting order status' };
  }
}

/**
 * VAPI Tool: Get tracking information
 */
export async function getTrackingInfo({ order_id }) {
  try {
    const order = await prestashop.getOrder(order_id);
    if (!order) {
      return {
        success: false,
        message: `Order ${order_id} not found`
      };
    }

    const tracking = await prestashop.getOrderTracking(order_id);
    if (!tracking) {
      const state = await prestashop.getOrderState(order.current_state);
      return {
        success: true,
        has_tracking: false,
        message: `Order is currently: ${state?.name}. Tracking information is not yet available.`
      };
    }

    return {
      success: true,
      has_tracking: true,
      carrier: tracking.carrierName,
      tracking_number: tracking.trackingNumber,
      tracking_url: tracking.trackingUrl,
      shipped_date: tracking.shippedDate
    };
  } catch (error) {
    console.error('getTrackingInfo error:', error);
    return { success: false, message: 'Error getting tracking information' };
  }
}

/**
 * Format order response for voice output
 */
function formatOrderResponse(order) {
  return {
    success: true,
    order_id: order.id,
    reference: order.reference,
    total_paid: order.total_paid,
    payment_method: order.payment,
    order_date: order.date_add,
    items_count: order.associations?.order_rows?.length || 0
  };
}

export default {
  lookupOrder,
  getOrderStatus,
  getTrackingInfo
};
