import { describe, expect, it } from 'vitest';
import { EMPTY_CHECKOUT_FORM, rateAddress, toShippingAddress, validateCheckoutForm } from '../lib/checkout-form.js';
import { formatBusinessDays } from '../lib/format.js';
import { US_STATE_OPTIONS } from '../lib/us-states.js';

const valid = {
  ...EMPTY_CHECKOUT_FORM,
  email: 'jamie@example.com',
  name: 'Jamie Rivera',
  line1: '100 Main St',
  city: 'Los Angeles',
  state: 'CA',
  zip: '90012',
  phone: '(213) 555-0100',
};

describe('checkout form', () => {
  it('accepts a complete US address', () => {
    expect(validateCheckoutForm(valid)).toEqual({});
  });

  it('flags every missing or malformed field', () => {
    expect(Object.keys(validateCheckoutForm(EMPTY_CHECKOUT_FORM)).sort()).toEqual(
      ['city', 'email', 'line1', 'name', 'phone', 'state', 'zip'].sort(),
    );
    expect(validateCheckoutForm({ ...valid, email: 'jamie@', zip: '9001', phone: '555-0100' })).toEqual({
      email: 'Enter a valid email address',
      zip: 'Enter a 5-digit ZIP code',
      phone: 'Enter a 10-digit US phone number',
    });
  });

  it('prices shipping only once state and ZIP are valid', () => {
    expect(rateAddress({ ...valid, zip: '900' })).toBeNull();
    expect(rateAddress({ ...valid, zip: ' 90012 ' })).toEqual({ state: 'CA', zip: '90012' });
  });

  it('trims values and drops empty optional fields', () => {
    expect(toShippingAddress({ ...valid, name: ' Jamie ', company: '  ', line2: 'Suite 5' })).toEqual({
      name: 'Jamie',
      line1: '100 Main St',
      line2: 'Suite 5',
      city: 'Los Angeles',
      state: 'CA',
      zip: '90012',
      phone: '(213) 555-0100',
    });
  });

  it('lists 50 states and DC by name', () => {
    expect(US_STATE_OPTIONS).toHaveLength(51);
    expect(US_STATE_OPTIONS[0]).toEqual({ code: 'AL', name: 'Alabama' });
  });
});

describe('formatBusinessDays', () => {
  it('does not print a range for a single day count', () => {
    expect(formatBusinessDays(1, 1)).toBe('1 business day');
    expect(formatBusinessDays(2, 2)).toBe('2 business days');
    expect(formatBusinessDays(3, 5)).toBe('3–5 business days');
  });
});
