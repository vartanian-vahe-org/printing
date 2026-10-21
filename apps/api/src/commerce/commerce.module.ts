import { Module } from '@nestjs/common';
import { PAYMENT_PROVIDER, SHIPPING_RATE_PROVIDER, TAX_PROVIDER } from './ports.js';
import { FlatRateShippingProvider } from './providers/flat-rate-shipping.provider.js';
import { ManualPaymentProvider } from './providers/manual-payment.provider.js';
import { StateTableTaxProvider } from './providers/state-table-tax.provider.js';

/**
 * Wires the payment / shipping / tax ports to their implementations.
 * Defaults until providers are chosen (docs/decisions.md T14, open issues S6, S1, S7):
 * swap a `useClass` here when a real provider is added.
 */
@Module({
  providers: [
    { provide: PAYMENT_PROVIDER, useClass: ManualPaymentProvider },
    { provide: SHIPPING_RATE_PROVIDER, useClass: FlatRateShippingProvider },
    { provide: TAX_PROVIDER, useClass: StateTableTaxProvider },
  ],
  exports: [PAYMENT_PROVIDER, SHIPPING_RATE_PROVIDER, TAX_PROVIDER],
})
export class CommerceModule {}
