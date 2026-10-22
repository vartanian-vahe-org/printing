/** Order email contents. Pure functions: order data in, subject/HTML/text out. */
import type { OrderView } from '../orders.service.js';
import { addressLines, button, datesLine, escapeHtml, itemsTableHtml, itemsText, layout, money, type RenderedEmail, type StoreIdentity } from './layout.js';

/** Estimates assume production starts now; manual payment and proofs can move them. */
const DATES_NOTE = 'Dates assume payment and proof approval today and move if either comes later.';

/** To the customer right after checkout. */
export function orderConfirmationEmail(order: OrderView, store: StoreIdentity, orderUrl: string): RenderedEmail {
  const firstName = order.shippingAddress.name.split(/\s+/)[0] ?? '';
  const subject = `Order #${order.number} received – ${store.storeName}`;
  const payment = order.paymentInstructions;
  const dates = datesLine(order);
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:22px;margin:0 0 8px;">Thanks for your order${firstName ? `, ${escapeHtml(firstName)}` : ''}!</h1>
<p style="margin:0 0 16px;">We received order <strong>#${order.number}</strong>.</p>
${dates ? `<p style="margin:0 0 16px;"><strong>${escapeHtml(dates)}</strong><br><span style="font-size:13px;color:#6b6b70;">${escapeHtml(DATES_NOTE)}</span></p>` : ''}
${payment ? `<div style="background:#fff8e6;border:1px solid #f2d48a;border-radius:8px;padding:12px 14px;margin:0 0 16px;"><strong>Next step: payment</strong><br>${escapeHtml(payment)}</div>` : ''}
${button(orderUrl, 'View your order')}
${itemsTableHtml(order)}
<h2 style="font-size:16px;margin:24px 0 6px;">Shipping to</h2>
<p style="margin:0;">${addressLines(order).map(escapeHtml).join('<br>')}</p>
<h2 style="font-size:16px;margin:24px 0 6px;">What happens next</h2>
<ol style="margin:0;padding-left:20px;">
<li>We check your design and send you a proof to approve.</li>
<li>We print in our California shop once payment and proof are done.</li>
<li>You get a tracking number when your order ships.</li>
</ol>`,
  );
  const text = [
    `Thanks for your order${firstName ? `, ${firstName}` : ''}!`,
    `We received order #${order.number}.`,
    ...(dates ? ['', dates, DATES_NOTE] : []),
    ...(payment ? ['', `Next step: payment. ${payment}`] : []),
    '',
    `View your order: ${orderUrl}`,
    '',
    itemsText(order),
    '',
    'Shipping to:',
    ...addressLines(order),
    '',
    'What happens next:',
    '1. We check your design and send you a proof to approve.',
    '2. We print in our California shop once payment and proof are done.',
    '3. You get a tracking number when your order ships.',
    '',
    `Questions? Reply to this email or write to ${store.supportEmail}.`,
  ].join('\n');
  return { subject, html, text };
}

/** "Find my order": the private link again, nothing else. */
export function orderLinkEmail(order: OrderView, store: StoreIdentity, orderUrl: string): RenderedEmail {
  const subject = `Your link to order #${order.number} – ${store.storeName}`;
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:22px;margin:0 0 8px;">Order #${order.number}</h1>
<p style="margin:0;">Here is the link to check your order. Keep it private: anyone with the link can see the order.</p>
${button(orderUrl, 'View your order')}
<p style="margin:0;font-size:13px;color:#6b6b70;">Didn't ask for this? You can ignore this email.</p>`,
  );
  const text = [
    `Order #${order.number}`,
    'Here is the link to check your order. Keep it private: anyone with the link can see the order.',
    '',
    orderUrl,
    '',
    "Didn't ask for this? You can ignore this email.",
  ].join('\n');
  return { subject, html, text };
}

/** To the shop's staff addresses for every new order. */
export function newOrderNotificationEmail(order: OrderView, store: StoreIdentity): RenderedEmail {
  const subject = `New order #${order.number} – ${money(order.totalCents)}`;
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:20px;margin:0 0 8px;">New order #${order.number}</h1>
<p style="margin:0 0 4px;">Customer: <a href="mailto:${escapeHtml(order.email)}">${escapeHtml(order.email)}</a></p>
<p style="margin:0 0 4px;">Payment: ${escapeHtml(order.paymentStatus)}</p>
<p style="margin:0 0 16px;">${escapeHtml(datesLine(order) ?? '')}</p>
${itemsTableHtml(order)}
<h2 style="font-size:16px;margin:24px 0 6px;">Ship to</h2>
<p style="margin:0;">${addressLines(order).map(escapeHtml).join('<br>')}</p>`,
    false,
  );
  const text = [
    `New order #${order.number}`,
    `Customer: ${order.email}`,
    `Payment: ${order.paymentStatus}`,
    datesLine(order) ?? '',
    '',
    itemsText(order),
    '',
    'Ship to:',
    ...addressLines(order),
  ].join('\n');
  return { subject, html, text };
}

/** After staff record the payment. */
export function paymentReceivedEmail(order: OrderView, store: StoreIdentity, orderUrl: string): RenderedEmail {
  const subject = `Payment received for order #${order.number} – ${store.storeName}`;
  const body = `We received your payment of ${money(order.totalCents)} for order #${order.number}. We will send you a proof if your design needs one, then print your order.`;
  const dates = datesLine(order);
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:22px;margin:0 0 8px;">Payment received</h1>
<p style="margin:0;">${escapeHtml(body)}</p>
${dates ? `<p style="margin:12px 0 0;"><strong>${escapeHtml(dates)}</strong></p>` : ''}
${button(orderUrl, 'View your order')}`,
  );
  return { subject, html, text: [body, ...(dates ? ['', dates] : []), '', `View your order: ${orderUrl}`].join('\n') };
}

/** When staff add a tracking number. Uses the most recent shipment. */
export function orderShippedEmail(order: OrderView, store: StoreIdentity, orderUrl: string): RenderedEmail {
  const shipment = order.shipments.at(-1);
  const subject = `Order #${order.number} has shipped – ${store.storeName}`;
  const carrier = shipment ? `${shipment.carrier.toUpperCase()}${shipment.service ? ` ${shipment.service}` : ''}` : '';
  const trackingHtml = shipment
    ? `<p style="margin:0 0 4px;">${escapeHtml(carrier)} tracking number:</p>
<p style="margin:0;font-size:17px;font-weight:700;">${
        shipment.trackingUrl
          ? `<a href="${escapeHtml(shipment.trackingUrl)}" style="color:#1f5eff;">${escapeHtml(shipment.trackingNumber)}</a>`
          : escapeHtml(shipment.trackingNumber)
      }</p>`
    : '';
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:22px;margin:0 0 8px;">Your order is on its way</h1>
<p style="margin:0 0 16px;">Order #${order.number} left our California shop.</p>
${trackingHtml}
${button(orderUrl, 'View your order')}
<h2 style="font-size:16px;margin:8px 0 6px;">Shipping to</h2>
<p style="margin:0;">${addressLines(order).map(escapeHtml).join('<br>')}</p>`,
  );
  const text = [
    `Order #${order.number} left our California shop.`,
    ...(shipment ? ['', `${carrier} tracking number: ${shipment.trackingNumber}`, ...(shipment.trackingUrl ? [shipment.trackingUrl] : [])] : []),
    '',
    `View your order: ${orderUrl}`,
    '',
    'Shipping to:',
    ...addressLines(order),
  ].join('\n');
  return { subject, html, text };
}

/** When staff cancel the order. `reason` is the optional note for the customer. */
export function orderCancelledEmail(order: OrderView, store: StoreIdentity, orderUrl: string, reason?: string): RenderedEmail {
  const subject = `Order #${order.number} was cancelled – ${store.storeName}`;
  const refund =
    order.paymentStatus === 'paid'
      ? `We will refund your payment of ${money(order.totalCents)}.`
      : 'No payment was taken for this order.';
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:22px;margin:0 0 8px;">Order #${order.number} was cancelled</h1>
${reason ? `<p style="margin:0 0 12px;">${escapeHtml(reason)}</p>` : ''}
<p style="margin:0;">${escapeHtml(refund)}</p>
${button(orderUrl, 'View your order')}`,
  );
  const text = [`Order #${order.number} was cancelled.`, ...(reason ? ['', reason] : []), '', refund, '', `View your order: ${orderUrl}`].join('\n');
  return { subject, html, text };
}

/** Every item has a proof to review (no item needs a new file). */
export function proofReadyEmail(order: OrderView, store: StoreIdentity, orderUrl: string): RenderedEmail {
  const subject = `Your proof for order #${order.number} is ready – ${store.storeName}`;
  const notes = order.items.flatMap((item) => item.proof.issues.filter((i) => i.level === 'warning'));
  const waitingForPayment = order.paymentStatus === 'unpaid';
  const intro = `Check how your cards will print and approve the proof. We start printing once it is approved${waitingForPayment ? ' and payment is received' : ''}.`;
  const notesText = notes.length ? `Our file check left ${notes.length} note(s) for you to read before approving.` : '';
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:22px;margin:0 0 8px;">Your proof is ready</h1>
<p style="margin:0 0 12px;">${escapeHtml(intro)}</p>
${notesText ? `<p style="margin:0;">${escapeHtml(notesText)}</p>` : ''}
${button(orderUrl, 'Review your proof')}`,
  );
  return { subject, html, text: [intro, ...(notesText ? ['', notesText] : []), '', `Review your proof: ${orderUrl}`].join('\n') };
}

/** At least one item failed the file check; the customer uploads a new file. */
export function filesNeededEmail(order: OrderView, store: StoreIdentity, orderUrl: string): RenderedEmail {
  const subject = `We need a new file for order #${order.number} – ${store.storeName}`;
  // Designs we make for the customer are fixed by our designer, not listed here.
  const problems = order.items
    .filter((item) => item.design.mode !== 'service')
    .flatMap((item) => item.proof.issues.filter((i) => i.level === 'error').map((i) => `${item.productName}: ${i.message}`));
  const intro = 'Our file check found problems that would spoil the print. Please upload a corrected file; we check it again right away.';
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:22px;margin:0 0 8px;">We need a new file</h1>
<p style="margin:0 0 12px;">${escapeHtml(intro)}</p>
<ul style="margin:0;padding-left:20px;">${problems.map((p) => `<li style="margin-bottom:6px;">${escapeHtml(p)}</li>`).join('')}</ul>
${button(orderUrl, 'Upload a new file')}`,
  );
  return { subject, html, text: [intro, '', ...problems.map((p) => `- ${p}`), '', `Upload a new file: ${orderUrl}`].join('\n') };
}

/** To the shop's staff addresses: a customer asked the designer for changes ("let us design it"). */
export function changesRequestedEmail(order: OrderView, store: StoreIdentity, request: string, adminOrderUrl: string): RenderedEmail {
  const subject = `Design changes requested – order #${order.number}`;
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:20px;margin:0 0 8px;">Changes requested on order #${order.number}</h1>
<p style="margin:0 0 4px;">Customer: <a href="mailto:${escapeHtml(order.email)}">${escapeHtml(order.email)}</a></p>
<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #c9c9c4;white-space:pre-wrap;">${escapeHtml(request)}</blockquote>
${button(adminOrderUrl, 'Open the order')}`,
    false,
  );
  return { subject, html, text: [`Changes requested on order #${order.number}`, `Customer: ${order.email}`, '', request, '', `Open the order: ${adminOrderUrl}`].join('\n') };
}
