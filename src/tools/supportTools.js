import { PrestaShopService } from '../services/prestashop.js';

const prestashop = new PrestaShopService();

/**
 * VAPI Tool: Create support ticket
 */
export async function createSupportTicket({ customer_email, order_id, message }) {
  try {
    // Find customer
    const customer = await prestashop.getCustomerByEmail(customer_email);
    if (!customer) {
      return {
        success: false,
        message: `No customer found with email ${customer_email}. Please verify the email address.`
      };
    }

    // If order_id provided, verify it belongs to customer
    if (order_id) {
      const order = await prestashop.getOrder(order_id);
      if (!order) {
        return {
          success: false,
          message: `Order ${order_id} not found`
        };
      }
      if (order.id_customer != customer.id) {
        return {
          success: false,
          message: `Order ${order_id} does not belong to this customer`
        };
      }
    }

    // Create the message/ticket
    const ticketMessage = `[Voice Call Support Ticket]\n\nCustomer: ${customer.firstname} ${customer.lastname}\nEmail: ${customer_email}\n${order_id ? `Order: ${order_id}\n` : ''}\n\nMessage:\n${message}`;

    await prestashop.createMessage(
      order_id || 0,
      customer.id,
      ticketMessage
    );

    return {
      success: true,
      message: 'Support ticket created successfully',
      customer_name: `${customer.firstname} ${customer.lastname}`,
      ticket_details: {
        customer_id: customer.id,
        order_id: order_id || null,
        issue: message
      }
    };
  } catch (error) {
    console.error('createSupportTicket error:', error);
    return {
      success: false,
      message: 'Error creating support ticket. Our team has been notified.'
    };
  }
}

/**
 * VAPI Tool: Get customer info for verification
 */
export async function verifyCustomer({ email }) {
  try {
    const customer = await prestashop.getCustomerByEmail(email);
    if (!customer) {
      return {
        success: false,
        found: false,
        message: `No account found with email ${email}`
      };
    }

    return {
      success: true,
      found: true,
      customer: {
        first_name: customer.firstname,
        last_name: customer.lastname,
        email: customer.email
      }
    };
  } catch (error) {
    console.error('verifyCustomer error:', error);
    return { success: false, message: 'Error verifying customer' };
  }
}

export default {
  createSupportTicket,
  verifyCustomer
};
