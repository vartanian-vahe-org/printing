/**
 * What the customer fills in for "let us design it": one field per line of the card, so nothing is
 * forgotten and our designer gets it sorted. Business cards only for now; other products get their
 * own list when they are added.
 */
export interface BriefFieldDef {
  key: string;
  label: string;
  placeholder: string;
  type?: 'text' | 'tel' | 'email' | 'url';
  autoComplete?: string;
  /** Several lines (address, extra text). */
  multiline?: boolean;
  /** Takes the whole row in the two-column form. */
  wide?: boolean;
  maxLength: number;
}

export const BRIEF_FIELDS: BriefFieldDef[] = [
  { key: 'name', label: 'Full name', placeholder: 'Jane Doe', autoComplete: 'name', maxLength: 100 },
  { key: 'title', label: 'Job title', placeholder: 'Marketing Director', autoComplete: 'organization-title', maxLength: 100 },
  { key: 'company', label: 'Company', placeholder: 'Acme Inc.', autoComplete: 'organization', maxLength: 100 },
  { key: 'tagline', label: 'Slogan or tagline', placeholder: 'Homes that fit your life', maxLength: 150 },
  { key: 'phone', label: 'Phone', placeholder: '(555) 123-4567', type: 'tel', autoComplete: 'tel', maxLength: 50 },
  { key: 'phone2', label: 'Second phone or fax', placeholder: 'Mobile (555) 987-6543', type: 'tel', maxLength: 50 },
  { key: 'email', label: 'Email', placeholder: 'jane@acme.com', type: 'email', autoComplete: 'email', maxLength: 150 },
  { key: 'website', label: 'Website', placeholder: 'acme.com', type: 'url', autoComplete: 'url', maxLength: 150 },
  { key: 'address', label: 'Address', placeholder: '123 Main St, Suite 200\nLos Angeles, CA 90012', multiline: true, wide: true, maxLength: 300 },
  { key: 'social', label: 'Social media', placeholder: 'Instagram @acme · LinkedIn /in/janedoe', wide: true, maxLength: 200 },
  {
    key: 'other',
    label: 'Anything else to print',
    placeholder: 'Back of the card: list of services, a QR code to our booking page, license number…',
    multiline: true,
    wide: true,
    maxLength: 1000,
  },
];

/** The filled fields in form order, as stored with the order: what to print, line by line. */
export function briefLines(fields: Record<string, string>): { key: string; label: string; value: string }[] {
  return BRIEF_FIELDS.flatMap((f) => {
    const value = (fields[f.key] ?? '').trim();
    return value ? [{ key: f.key, label: f.label, value }] : [];
  });
}
