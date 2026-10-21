import { createHash, createHmac } from 'node:crypto';
import { config } from '../config.js';

/**
 * Secret part of the customer's order link. Derived from the order id with a server secret, so the
 * same link can be emailed again ("find my order") while only its hash is stored on the order.
 */
export function orderAccessToken(orderId: string): string {
  return createHmac('sha256', config.orderLinkSecret).update(`order-link:v1:${orderId}`).digest('base64url');
}

export function hashOrderToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Storefront order page. The token is in the #fragment so browsers never send it to a server. */
export function orderUrl(orderNumber: number, orderId: string): string {
  return `${config.webUrl}/orders/${orderNumber}#${orderAccessToken(orderId)}`;
}
