/** Account emails: verify the address, reset the password. */
import { button, escapeHtml, layout, type RenderedEmail, type StoreIdentity } from '../orders/emails/layout.js';

export function verifyEmailEmail(name: string, store: StoreIdentity, url: string): RenderedEmail {
  const subject = `Confirm your email – ${store.storeName}`;
  const body = 'Confirm your email to finish creating your account. Orders you placed with this email will then show in your account.';
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:22px;margin:0 0 8px;">Hi ${escapeHtml(name)}, confirm your email</h1>
<p style="margin:0;">${escapeHtml(body)}</p>
${button(url, 'Confirm my email')}
<p style="margin:0;font-size:13px;color:#6b6b70;">Didn't create an account? You can ignore this email.</p>`,
  );
  return { subject, html, text: [`Hi ${name},`, body, '', url, '', "Didn't create an account? You can ignore this email."].join('\n') };
}

export function resetPasswordEmail(store: StoreIdentity, url: string, minutes: number): RenderedEmail {
  const subject = `Reset your password – ${store.storeName}`;
  const body = `Use this link to choose a new password. It works once, for ${minutes} minutes.`;
  const html = layout(
    store,
    subject,
    `<h1 style="font-size:22px;margin:0 0 8px;">Reset your password</h1>
<p style="margin:0;">${escapeHtml(body)}</p>
${button(url, 'Choose a new password')}
<p style="margin:0;font-size:13px;color:#6b6b70;">Didn't ask for this? Your password stays the same; you can ignore this email.</p>`,
  );
  return { subject, html, text: [body, '', url, '', "Didn't ask for this? Your password stays the same."].join('\n') };
}
