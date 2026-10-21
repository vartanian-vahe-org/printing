import { Injectable } from '@nestjs/common';
import type { PaymentProvider, PaymentRequest, PaymentStart } from '../ports.js';

/**
 * Default payment provider until one is chosen (docs/open-issues.md S6): the order is placed
 * unpaid, the shop collects payment outside the site and marks the order paid in the admin.
 */
@Injectable()
export class ManualPaymentProvider implements PaymentProvider {
  readonly code = 'manual';
  readonly checkoutNote = 'No payment is taken online yet. After you place your order, our team contacts you to complete payment before printing.';

  async start(request: PaymentRequest): Promise<PaymentStart> {
    return { status: 'pending', reference: null, next: { type: 'manual', message: this.instructions(request) } };
  }

  instructions(request: PaymentRequest): string {
    return `Our team will contact you at ${request.email} to complete payment for order #${request.orderNumber}. We start printing once payment is received.`;
  }
}
