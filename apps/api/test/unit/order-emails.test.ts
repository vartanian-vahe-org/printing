import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../../src/orders/emails/layout.js';
import { newOrderNotificationEmail, orderConfirmationEmail, orderLinkEmail, paymentReceivedEmail } from '../../src/orders/emails/order-emails.js';
import type { OrderView } from '../../src/orders/orders.service.js';
import { trackingUrl } from '../../src/orders/tracking.js';

const store = { storeName: 'Print Studio', supportEmail: 'support@example.com' };
const url = 'https://shop.example.com/orders/100001#secret';

const order: OrderView = {
  number: 100001,
  status: 'placed',
  paymentStatus: 'unpaid',
  proofStatus: 'pending',
  email: 'jamie@example.com',
  placedAt: '2026-10-21T10:00:00.000Z',
  paidAt: null,
  shippedAt: null,
  cancelledAt: null,
  shipBy: '2026-10-23',
  deliverFrom: '2026-10-28',
  deliverTo: '2026-10-30',
  shippingAddress: { name: 'Jamie <img src=x onerror=alert(1)> Rivera', line1: '100 Main St', city: 'Los Angeles', state: 'CA', zip: '90012', phone: '(213) 555-0100' },
  shippingMethod: { label: 'Standard Shipping', priceCents: 699, transitDaysMin: 3, transitDaysMax: 5 },
  tax: { label: 'CA', rateBps: 725 },
  items: [
    {
      productName: 'Business Cards',
      summary: [{ label: 'Paper', value: 'Standard – 14pt Cardstock' }],
      design: { mode: 'template', templateCode: 'classic', values: { name: '"Jamie" & <Co>' } },
      quantity: 500,
      totalCents: 3948,
      proof: { status: 'pending', issues: [], images: [], approvedAt: null, checkFailed: false },
      designService: null,
    },
  ],
  shipments: [],
  subtotalCents: 3948,
  shippingCents: 699,
  taxCents: 286,
  totalCents: 4933,
  paymentInstructions: 'We will contact you about payment.',
};

describe('order emails', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('confirmation: link, totals, payment step, and customer text escaped', () => {
    const email = orderConfirmationEmail(order, store, url);
    expect(email.subject).toBe('Order #100001 received – Print Studio');
    expect(email.html).toContain(`href="${url}"`);
    expect(email.html).toContain('$49.33');
    expect(email.html).toContain('Next step: payment');
    expect(email.html).not.toContain('<img src=x');
    expect(email.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(email.html).toContain('&quot;Jamie&quot; &amp; &lt;Co&gt;');
    expect(email.text).toContain(`View your order: ${url}`);
    expect(email.text).toContain('Total: $49.33');
    expect(email.html).toContain('support@example.com');
  });

  it('confirmation without payment step once paid', () => {
    const email = orderConfirmationEmail({ ...order, paymentInstructions: null }, store, url);
    expect(email.html).not.toContain('Next step: payment');
  });

  it('order link email carries only the link', () => {
    const email = orderLinkEmail(order, store, url);
    expect(email.subject).toBe('Your link to order #100001 – Print Studio');
    expect(email.text).toContain(url);
    expect(email.html).not.toContain('$49.33');
  });

  it('staff notification shows the customer and total, without the customer footer', () => {
    const email = newOrderNotificationEmail(order, store);
    expect(email.subject).toBe('New order #100001 – $49.33');
    expect(email.html).toContain('mailto:jamie@example.com');
    expect(email.html).not.toContain('Questions? Reply');
  });
});

describe('trackingUrl', () => {
  it('links the known carriers and nothing else', () => {
    expect(trackingUrl('UPS', ' 1Z999AA10123456784 ')).toBe('https://www.ups.com/track?tracknum=1Z999AA10123456784');
    expect(trackingUrl('usps', '9400 1000')).toBe('https://tools.usps.com/go/TrackConfirmAction?tLabels=9400%201000');
    expect(trackingUrl('fedex', '123')).toContain('fedex.com');
    expect(trackingUrl('local courier', '123')).toBeNull();
  });
});

describe('estimated dates in emails', () => {
  it('shows ship and delivery dates in the confirmation and the payment email', () => {
    const confirmation = orderConfirmationEmail(order, store, url);
    expect(confirmation.text).toContain('Ships by Fri, Oct 23 · Estimated delivery Wed, Oct 28 – Fri, Oct 30');
    expect(confirmation.html).toContain('Ships by Fri, Oct 23');
    expect(paymentReceivedEmail(order, store, url).text).toContain('Ships by Fri, Oct 23');
  });

  it('leaves dates out for orders without estimates', () => {
    const email = orderConfirmationEmail({ ...order, shipBy: null, deliverFrom: null, deliverTo: null }, store, url);
    expect(email.text).not.toContain('Ships by');
  });
});
