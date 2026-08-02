/**
 * The seam between our code and a payments provider (Razorpay). Callers deal in
 * this interface; the development binding is {@link StubPaymentProvider}, which
 * mints a Text2Pay-style link without any network call or credentials. Going
 * live is swapping the binding in the module — key_id/key_secret drop into the
 * live implementation and nothing upstream changes.
 */
export interface PaymentLinkRequest {
  /** Amount in paise. */
  readonly amountPaise: number;
  readonly reference: string;
  readonly description?: string;
  readonly customerPhone?: string;
}

export interface PaymentLink {
  readonly url: string;
  readonly providerRef: string;
}

export abstract class PaymentProvider {
  abstract createLink(request: PaymentLinkRequest): Promise<PaymentLink>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export class StubPaymentProvider extends PaymentProvider {
  async createLink(request: PaymentLinkRequest): Promise<PaymentLink> {
    const ref = `stub_plink_${crypto.randomUUID()}`;
    return { url: `https://pay.example.test/${ref}?amt=${request.amountPaise}`, providerRef: ref };
  }
}
