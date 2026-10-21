/** Checkout form state and the same checks the API applies, for inline errors. */
import { isUsPhone, isUsState, isUsZip } from '@printing/pricing';
import type { ShippingAddress } from './checkout';

export interface CheckoutForm {
  email: string;
  name: string;
  company: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
}

export type CheckoutField = keyof CheckoutForm;

export const EMPTY_CHECKOUT_FORM: CheckoutForm = {
  email: '',
  name: '',
  company: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCheckoutForm(form: CheckoutForm): Partial<Record<CheckoutField, string>> {
  const errors: Partial<Record<CheckoutField, string>> = {};
  const required = (field: CheckoutField, label: string) => {
    if (!form[field].trim()) errors[field] = `Enter your ${label}`;
  };
  if (!EMAIL.test(form.email.trim())) errors.email = 'Enter a valid email address';
  required('name', 'full name');
  required('line1', 'street address');
  required('city', 'city');
  if (!isUsState(form.state)) errors.state = 'Choose a state';
  if (!isUsZip(form.zip)) errors.zip = 'Enter a 5-digit ZIP code';
  if (!isUsPhone(form.phone)) errors.phone = 'Enter a 10-digit US phone number';
  return errors;
}

/** State and ZIP once both are valid: enough to price shipping and tax. */
export function rateAddress(form: CheckoutForm): { state: string; zip: string } | null {
  return isUsState(form.state) && isUsZip(form.zip) ? { state: form.state, zip: form.zip.trim() } : null;
}

export function toShippingAddress(form: CheckoutForm): ShippingAddress {
  const optional = (v: string) => (v.trim() ? v.trim() : undefined);
  return {
    name: form.name.trim(),
    company: optional(form.company),
    line1: form.line1.trim(),
    line2: optional(form.line2),
    city: form.city.trim(),
    state: form.state,
    zip: form.zip.trim(),
    phone: form.phone.trim(),
  };
}
