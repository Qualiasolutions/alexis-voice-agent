import { PrestaShopService } from '../services/prestashop.js';

const prestashop = new PrestaShopService();

/**
 * VAPI Tool: Check product availability
 */
export async function checkProductAvailability({ product_id, product_name }) {
  try {
    let products = [];

    // If product ID provided, get directly
    if (product_id) {
      const product = await prestashop.getProduct(product_id);
      if (product) {
        products = [product];
      }
    }
    // If name provided, search
    else if (product_name) {
      products = await prestashop.searchProducts(product_name);
    }

    if (!products || products.length === 0) {
      return {
        success: false,
        message: product_id
          ? `Product ${product_id} not found`
          : `No products found matching "${product_name}"`
      };
    }

    // Get stock for each product
    const results = await Promise.all(
      products.slice(0, 5).map(async (product) => {
        const stock = await prestashop.getProductStock(product.id);
        return {
          id: product.id,
          name: product.name,
          price: product.price,
          in_stock: stock?.inStock || false,
          quantity_available: stock?.quantity || 0,
          available_for_order: product.available
        };
      })
    );

    return {
      success: true,
      products: results
    };
  } catch (error) {
    console.error('checkProductAvailability error:', error);
    return { success: false, message: 'Error checking product availability' };
  }
}

/**
 * VAPI Tool: Get product information
 */
export async function getProductInfo({ product_id }) {
  try {
    const product = await prestashop.getProduct(product_id);
    if (!product) {
      return {
        success: false,
        message: `Product ${product_id} not found`
      };
    }

    const stock = await prestashop.getProductStock(product_id);

    return {
      success: true,
      product: {
        id: product.id,
        name: product.name,
        description: product.description,
        price: product.price,
        in_stock: stock?.inStock || false,
        quantity_available: stock?.quantity || 0,
        active: product.active,
        available_for_order: product.available
      }
    };
  } catch (error) {
    console.error('getProductInfo error:', error);
    return { success: false, message: 'Error getting product information' };
  }
}

export default {
  checkProductAvailability,
  getProductInfo
};
