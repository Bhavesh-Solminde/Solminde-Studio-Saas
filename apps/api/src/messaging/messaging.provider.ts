/**
 * The seam between our code and a WhatsApp Business provider (Meta Cloud API, or
 * a BSP like AiSensy/Interakt). Everything upstream deals in this interface, so
 * going live is swapping the bound implementation in the module — no handler,
 * no controller and no test changes.
 *
 * The development binding is {@link StubMessagingProvider}: it "sends" without a
 * network call and hands back a synthetic reference, which is all the gate and
 * the tests need. It is also what keeps the whole messaging path runnable with
 * zero credentials.
 */
export interface OutboundMessage {
  readonly toPhone: string;
  readonly template: string;
  readonly payload?: Record<string, unknown>;
}

export interface DispatchResult {
  readonly providerRef: string;
}

export abstract class MessagingProvider {
  abstract dispatch(message: OutboundMessage): Promise<DispatchResult>;
}

/** Nest injection token for the bound provider. */
export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');

export class StubMessagingProvider extends MessagingProvider {
  async dispatch(_message: OutboundMessage): Promise<DispatchResult> {
    return { providerRef: `stub-${crypto.randomUUID()}` };
  }
}
