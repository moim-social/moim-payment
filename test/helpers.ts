import { vi } from "vitest";
import type { AppConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import { InMemoryCallbackRepository, InMemoryCheckoutRepository } from "../src/repository.js";
import { TicketPaymentService } from "../src/service.js";
import type { CallbackSender, PortOneAdapter, PortOnePayment } from "../src/types.js";
import { buildApp } from "../src/app.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({
      BASE_URL: "https://payment.example",
      PAYMENT_SERVICE_API_TOKEN: "test-token",
      TICKET_PAYMENT_CALLBACK_SECRET: "callback-secret",
      PORTONE_API_SECRET: "portone-secret",
      PORTONE_WEBHOOK_SECRET: "webhook-secret",
      ALLOWED_ORIGINS: "https://moim.kodingwarrior.dev",
    }),
    ...overrides,
  };
}

export function checkoutRequest(overrides: Record<string, unknown> = {}) {
  return {
    provider: "portone",
    paymentMethodFamily: "easy_pay",
    reservationId: "reservation-1",
    eventId: "event-1",
    tierId: "tier-1",
    orderName: "Moim Ticket",
    amount: 15000,
    currency: "KRW",
    customer: { moimUserId: "user-1", email: "user@example.com" },
    successUrl: "https://moim.kodingwarrior.dev/success",
    cancelUrl: "https://moim.kodingwarrior.dev/cancel",
    callbackUrl: "https://moim.kodingwarrior.dev/callback",
    ...overrides,
  };
}

export function paidPayment(overrides: Partial<PortOnePayment> = {}): PortOnePayment {
  return {
    paymentId: "pay_1",
    status: "PAID",
    amount: { total: 15000 },
    currency: "KRW",
    customData: {
      checkoutId: "unused",
      reservationId: "reservation-1",
      eventId: "event-1",
      tierId: "tier-1",
      easyPayProvider: "kakaopay",
    },
    channel: { key: "test-kakaopay-channel" },
    transaction: { id: "tx_1" },
    ...overrides,
  };
}

export async function testApp() {
  const config = testConfig();
  const checkouts = new InMemoryCheckoutRepository();
  const callbacks = new InMemoryCallbackRepository();
  const portone: PortOneAdapter = {
    getPayment: vi.fn(),
    verifyWebhook: vi.fn(async () => ({ data: { paymentId: "pay_1" } })),
  };
  const callbackSender: CallbackSender = {
    send: vi.fn(async () => ({ status: 200, text: "ok" })),
  };
  const service = new TicketPaymentService(config, checkouts, callbacks, portone, callbackSender);
  const app = await buildApp({ config, service });
  return { app, config, service, checkouts, callbacks, portone, callbackSender };
}
