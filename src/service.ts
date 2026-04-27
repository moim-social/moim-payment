import { randomUUID } from "node:crypto";
import { z } from "zod";
import { badRequest, conflict, notFound } from "./errors.js";
import { deliverCallback } from "./callback.js";
import type { AppConfig } from "./config.js";
import type { CallbackRepository, CheckoutRepository } from "./repository.js";
import { ProviderAccountRegistry } from "./providerAccounts.js";
import type {
  CallbackSender,
  PaidCallbackBody,
  PortOneAdapter,
  PortOnePayment,
  ProviderAccount,
  TicketCheckout,
} from "./types.js";

const createCheckoutSchema = z.object({
  provider: z.literal("portone"),
  paymentMethodFamily: z.literal("easy_pay"),
  reservationId: z.string().min(1),
  eventId: z.string().min(1),
  tierId: z.string().min(1),
  orderName: z.string().min(1),
  amount: z.number().int().positive(),
  currency: z.literal("KRW"),
  customer: z.object({
    moimUserId: z.string().min(1),
    name: z.string().optional(),
    email: z.string().email().optional(),
  }),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
  callbackUrl: z.string().url(),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

export class TicketPaymentService {
  private readonly registry: ProviderAccountRegistry;

  constructor(
    private readonly config: AppConfig,
    private readonly checkouts: CheckoutRepository,
    private readonly callbacks: CallbackRepository,
    private readonly portone: PortOneAdapter,
    private readonly callbackSender: CallbackSender,
  ) {
    this.registry = new ProviderAccountRegistry(config.providerAccounts);
  }

  listProviderAccounts(): ProviderAccount[] {
    return this.registry.listEnabled();
  }

  async createCheckout(input: unknown, idempotencyKey: string | undefined): Promise<TicketCheckout> {
    if (!idempotencyKey) throw badRequest("missing_idempotency_key", "Idempotency-Key header is required");
    const parsed = createCheckoutSchema.safeParse(input);
    if (!parsed.success) throw badRequest("invalid_checkout_request", "Invalid checkout request");
    const request = parsed.data;

    if (!this.registry.supports(request.provider, request.paymentMethodFamily)) {
      throw badRequest("unsupported_payment_route", "Unsupported provider or payment method family");
    }
    for (const url of [request.successUrl, request.cancelUrl, request.callbackUrl]) {
      this.assertAllowedOrigin(url);
    }

    const existingByKey = await this.checkouts.findByIdempotencyKey(idempotencyKey);
    if (existingByKey) return existingByKey;

    const active = await this.checkouts.findActiveByReservationId(request.reservationId);
    if (active) return active;

    const now = new Date().toISOString();
    return this.checkouts.create({
      id: `chk_${randomUUID()}`,
      reservationId: request.reservationId,
      eventId: request.eventId,
      tierId: request.tierId,
      orderName: request.orderName,
      amount: request.amount,
      currency: request.currency,
      customer: request.customer,
      callbackUrl: request.callbackUrl,
      successUrl: request.successUrl,
      cancelUrl: request.cancelUrl,
      status: "requires_payment",
      idempotencyKey,
      createdAt: now,
      updatedAt: now,
    });
  }

  async preparePayment(checkoutId: string, providerAccountId: string): Promise<{
    checkout: TicketCheckout;
    account: ProviderAccount;
    paymentId: string;
  }> {
    const checkout = await this.getCheckout(checkoutId);
    if (checkout.status === "paid") {
      throw conflict("checkout_already_paid", "Checkout is already paid");
    }
    const account = this.registry.findEnabled(providerAccountId);
    if (!account) throw badRequest("provider_account_disabled", "Provider account is disabled or unknown");
    const paymentId = checkout.providerPaymentId ?? `pay_${randomUUID()}`;
    const updated = await this.checkouts.update({
      ...checkout,
      status: "payment_pending",
      selectedEasyPayProvider: account.easyPayProvider,
      providerAccountId: account.id,
      providerPaymentId: paymentId,
    });
    return { checkout: updated, account, paymentId };
  }

  async completeCheckout(checkoutId: string, paymentId: string): Promise<TicketCheckout> {
    const checkout = await this.getCheckout(checkoutId);
    if (checkout.status === "paid") return checkout;
    if (!paymentId || typeof paymentId !== "string") throw badRequest("invalid_payment_id", "paymentId is required");
    if (checkout.providerPaymentId && checkout.providerPaymentId !== paymentId) {
      throw badRequest("payment_id_mismatch", "paymentId does not match checkout payment");
    }
    const payment = await this.portone.getPayment(paymentId);
    return this.confirmPaid(checkout, payment, paymentId);
  }

  async syncPortOnePayment(paymentId: string): Promise<TicketCheckout | undefined> {
    const checkout = await this.checkouts.findByProviderPaymentId(paymentId);
    if (!checkout) return undefined;
    if (checkout.status === "paid") return checkout;
    const payment = await this.portone.getPayment(paymentId);
    return this.confirmPaid(checkout, payment, paymentId);
  }

  async verifyPortOneWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<unknown> {
    return this.portone.verifyWebhook(rawBody, headers);
  }

  async getCheckout(checkoutId: string): Promise<TicketCheckout> {
    const checkout = await this.checkouts.findById(checkoutId);
    if (!checkout) throw notFound("checkout_not_found", "Checkout not found");
    return checkout;
  }

  checkoutResponse(checkout: TicketCheckout): Record<string, unknown> {
    return {
      checkoutId: checkout.id,
      checkoutUrl: `${this.config.baseUrl}/checkouts/${checkout.id}`,
      provider: "portone",
      paymentMethodFamily: "easy_pay",
      status: checkout.status,
      availableMethods: this.registry.availableMethods(),
    };
  }

  private async confirmPaid(checkout: TicketCheckout, payment: PortOnePayment, requestedPaymentId: string): Promise<TicketCheckout> {
    if (payment.status !== "PAID") throw badRequest("payment_not_paid", "PortOne payment is not PAID");
    this.verifyPayment(checkout, payment);

    const providerPaymentId = payment.paymentId ?? requestedPaymentId;
    const paidAt = new Date().toISOString();
    const paid = await this.checkouts.update({
      ...checkout,
      status: "paid",
      providerPaymentId,
      providerTxId: payment.txId ?? payment.transaction?.txId ?? payment.transaction?.id,
      rawProviderResponse: sanitizeProviderResponse(payment),
      paidAt,
    });
    await this.enqueueAndDeliverPaidCallback(paid);
    return paid;
  }

  private verifyPayment(checkout: TicketCheckout, payment: PortOnePayment): void {
    if (payment.amount.total !== checkout.amount) throw badRequest("amount_mismatch", "Payment amount mismatch");
    if (payment.currency !== checkout.currency) throw badRequest("currency_mismatch", "Payment currency mismatch");

    const customData = parseCustomData(payment.customData);
    const expectedCustomData = {
      checkoutId: checkout.id,
      reservationId: checkout.reservationId,
      eventId: checkout.eventId,
      tierId: checkout.tierId,
    };
    for (const field of ["checkoutId", "reservationId", "eventId", "tierId"] as const) {
      if (customData[field] !== expectedCustomData[field]) {
        throw badRequest(`${field}_mismatch`, `Payment customData.${field} mismatch`);
      }
    }
    if (customData.easyPayProvider !== checkout.selectedEasyPayProvider) {
      throw badRequest("easy_pay_provider_mismatch", "Payment easyPayProvider mismatch");
    }
    const account = checkout.providerAccountId ? this.registry.findEnabled(checkout.providerAccountId) : undefined;
    if (!account) throw badRequest("provider_account_missing", "Checkout has no enabled provider account");
    if (payment.channel?.key && payment.channel.key !== account.channelKey) {
      throw badRequest("channel_mismatch", "Payment channel mismatch");
    }
  }

  private async enqueueAndDeliverPaidCallback(checkout: TicketCheckout): Promise<void> {
    const paymentId = checkout.providerPaymentId;
    if (!paymentId || !checkout.paidAt) throw new Error("paid checkout is missing payment fields");
    const body: PaidCallbackBody = {
      type: "ticket_payment.paid",
      reservationId: checkout.reservationId,
      checkoutId: checkout.id,
      paymentId,
      txId: checkout.providerTxId,
      provider: "portone",
      amount: checkout.amount,
      currency: checkout.currency,
      paidAt: checkout.paidAt,
    };
    const { event, created } = await this.callbacks.createIfAbsent({
      checkoutId: checkout.id,
      paymentId,
      type: "ticket_payment.paid",
      body,
      status: "pending",
      attempts: 0,
    });
    if (created || event.status !== "delivered") {
      await deliverCallback(event, checkout.callbackUrl, this.config.callbackSecret, this.callbackSender, this.callbacks);
    }
  }

  private assertAllowedOrigin(value: string): void {
    const origin = new URL(value).origin;
    if (!this.config.allowedOrigins.includes(origin)) {
      throw badRequest("origin_not_allowed", "URL origin is not allowed");
    }
  }
}

function parseCustomData(customData: PortOnePayment["customData"]): Record<string, unknown> {
  if (typeof customData === "string") return JSON.parse(customData) as Record<string, unknown>;
  if (customData && typeof customData === "object") return customData;
  throw badRequest("missing_custom_data", "Payment customData is required");
}

function sanitizeProviderResponse(payment: PortOnePayment): unknown {
  return {
    paymentId: payment.paymentId,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    channel: payment.channel
      ? {
          key: payment.channel.key,
          id: payment.channel.id,
          pg: payment.channel.pg,
          type: payment.channel.type,
        }
      : undefined,
    transaction: payment.transaction,
  };
}
