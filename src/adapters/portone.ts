import type { PortOneAdapter, PortOnePayment } from "../types.js";

export class RealPortOneAdapter implements PortOneAdapter {
  private client: any;
  private webhook: any;

  constructor(
    private readonly apiSecret: string,
    private readonly webhookSecret: string,
  ) {}

  private async load(): Promise<void> {
    if (this.client && this.webhook) return;
    const sdk = await import("@portone/server-sdk");
    this.client = (sdk as any).PortOneClient({ secret: this.apiSecret });
    this.webhook = (sdk as any).Webhook;
  }

  async getPayment(paymentId: string): Promise<PortOnePayment> {
    await this.load();
    return this.client.payment.getPayment({ paymentId }) as Promise<PortOnePayment>;
  }

  async verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<unknown> {
    await this.load();
    return this.webhook.verify(this.webhookSecret, rawBody, headers);
  }
}

export class FetchCallbackSender {
  async send(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; text?: string }> {
    const response = await fetch(url, { method: "POST", headers, body });
    return { status: response.status, text: await response.text().catch(() => undefined) };
  }
}
