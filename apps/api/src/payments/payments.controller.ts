import { Body, Controller, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { RequiresFeature, RequiresPermission } from '../access/guards.js';
import { PAYMENT_PROVIDER, PaymentProvider } from './payment.provider.js';

const linkBody = z.object({
  amountPaise: z.number().int().positive(),
  reference: z.string().min(1).max(80),
  description: z.string().max(200).optional(),
  customerPhone: z.string().max(20).optional(),
});

/**
 * Create a pay-by-link (Text2Pay) URL to send a customer for a due or an
 * advance. The provider is stubbed in development; the route shape and its
 * guards are the same whether the link is synthetic or a real Razorpay one, so
 * going live changes nothing here.
 */
@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider) {}

  @Post('link')
  @RequiresFeature('billing')
  @RequiresPermission('bill.create')
  async link(@Body() raw: unknown) {
    const body = linkBody.parse(raw);
    return this.payments.createLink(body);
  }
}
