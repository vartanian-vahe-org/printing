/** Shared pieces for order emails: escaping, money, and a simple table layout most email clients render. */
import type { OrderView } from '../orders.service.js';

export interface StoreIdentity {
  storeName: string;
  supportEmail: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Every customer-entered value goes through this before it is put in HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const money = (cents: number) => usd.format(cents / 100);

/** 'YYYY-MM-DD' shop date as "Fri, Oct 23". */
export function shopDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}

/** "Ships by Fri, Oct 23 · Estimated delivery Wed, Oct 28 – Fri, Oct 30", or null without dates. */
export function datesLine(order: Pick<OrderView, 'shipBy' | 'deliverFrom' | 'deliverTo'>): string | null {
  if (!order.shipBy) return null;
  const delivery =
    order.deliverFrom && order.deliverTo
      ? ` · Estimated delivery ${order.deliverFrom === order.deliverTo ? shopDate(order.deliverFrom) : `${shopDate(order.deliverFrom)} – ${shopDate(order.deliverTo)}`}`
      : '';
  return `Ships by ${shopDate(order.shipBy)}${delivery}`;
}

/** `customerFooter`: the "Questions? Reply…" line, left out of staff emails. */
export function layout(store: StoreIdentity, title: string, bodyHtml: string, customerFooter = true): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;padding:28px;">
<tr><td style="font-size:18px;font-weight:700;padding-bottom:20px;">${escapeHtml(store.storeName)}</td></tr>
<tr><td style="font-size:15px;line-height:1.5;">${bodyHtml}</td></tr>
${
  customerFooter
    ? `<tr><td style="padding-top:28px;font-size:12px;color:#6b6b70;line-height:1.5;">
Questions? Reply to this email or write to <a href="mailto:${escapeHtml(store.supportEmail)}" style="color:#1f5eff;">${escapeHtml(store.supportEmail)}</a>.
</td></tr>`
    : ''
}
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#1f5eff;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;">${escapeHtml(label)}</a></p>`;
}

function designLine(design: Record<string, unknown>): string {
  if (design.mode === 'upload') {
    const front = (design.front as { fileName: string }).fileName;
    const back = (design.back as { fileName: string } | undefined)?.fileName;
    return `Your design: ${front}${back ? ` + ${back}` : ''}`;
  }
  const name = (design.values as Record<string, string> | undefined)?.name;
  return `Template design${name ? ` · ${name}` : ''}`;
}

export function itemsTableHtml(order: OrderView): string {
  const rows = order.items
    .map(
      (item) => `<tr>
<td style="padding:10px 0;border-bottom:1px solid #e2e2de;vertical-align:top;">
<strong>${escapeHtml(item.productName)} · ${item.quantity.toLocaleString('en-US')}</strong><br>
<span style="font-size:13px;color:#6b6b70;">${escapeHtml(designLine(item.design))}</span><br>
<span style="font-size:13px;color:#6b6b70;">${escapeHtml(item.summary.map((s) => s.value).join(' · '))}</span>
</td>
<td style="padding:10px 0;border-bottom:1px solid #e2e2de;text-align:right;vertical-align:top;white-space:nowrap;">${money(item.totalCents)}</td>
</tr>`,
    )
    .join('');
  const total = (label: string, value: string, strong = false) =>
    `<tr><td style="padding:4px 0;${strong ? 'font-weight:700;font-size:16px;' : 'color:#6b6b70;'}">${escapeHtml(label)}</td><td style="padding:4px 0;text-align:right;${strong ? 'font-weight:700;font-size:16px;' : ''}">${value}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
${rows}
${total('Subtotal', money(order.subtotalCents))}
${total(`Shipping (${order.shippingMethod.label})`, order.shippingCents === 0 ? 'FREE' : money(order.shippingCents))}
${total(`Sales tax${order.tax.rateBps > 0 ? ` (${(order.tax.rateBps / 100).toFixed(2)}%)` : ''}`, money(order.taxCents))}
${total('Total', money(order.totalCents), true)}
</table>`;
}

export function itemsText(order: OrderView): string {
  const lines = order.items.map(
    (item) =>
      `- ${item.productName} x ${item.quantity.toLocaleString('en-US')}: ${money(item.totalCents)}\n  ${designLine(item.design)}\n  ${item.summary.map((s) => s.value).join(' · ')}`,
  );
  return [
    ...lines,
    '',
    `Subtotal: ${money(order.subtotalCents)}`,
    `Shipping (${order.shippingMethod.label}): ${order.shippingCents === 0 ? 'FREE' : money(order.shippingCents)}`,
    `Sales tax: ${money(order.taxCents)}`,
    `Total: ${money(order.totalCents)}`,
  ].join('\n');
}

export function addressLines(order: OrderView): string[] {
  const a = order.shippingAddress;
  return [a.name, a.company, [a.line1, a.line2].filter(Boolean).join(', '), `${a.city}, ${a.state} ${a.zip}`, a.phone].filter(
    (line): line is string => Boolean(line),
  );
}
