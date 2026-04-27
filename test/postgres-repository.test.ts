import { describe, expect, it } from "vitest";
import { PostgresCheckoutRepository } from "../src/postgresRepository.js";
import type { TicketCheckout } from "../src/types.js";

describe("PostgresCheckoutRepository", () => {
  it("uses the same parameter count as the update SQL placeholders", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [checkoutRow({ status: "payment_pending" })] };
      },
    };
    const repo = new PostgresCheckoutRepository(pool as any);

    await repo.update(checkout({ status: "payment_pending" }));

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("UPDATE ticket_checkouts SET");
    expect(queries[0].params).toHaveLength(20);
  });
});

function checkout(overrides: Partial<TicketCheckout> = {}): TicketCheckout {
  return {
    id: "chk_1",
    reservationId: "reservation-1",
    eventId: "event-1",
    tierId: "tier-1",
    orderName: "Moim Ticket",
    amount: 15000,
    currency: "KRW",
    customer: { moimUserId: "user-1" },
    callbackUrl: "https://moim.kodingwarrior.dev/api/ticket-payment-callbacks",
    successUrl: "https://moim.kodingwarrior.dev/events/event-1/register?payment=success",
    cancelUrl: "https://moim.kodingwarrior.dev/events/event-1/register?payment=cancel",
    status: "requires_payment",
    idempotencyKey: "reservation:reservation-1",
    selectedEasyPayProvider: undefined,
    providerAccountId: undefined,
    providerPaymentId: undefined,
    providerTxId: undefined,
    rawProviderResponse: undefined,
    paidAt: undefined,
    createdAt: "2026-04-27T00:00:00.000Z",
    updatedAt: "2026-04-27T00:00:00.000Z",
    ...overrides,
  };
}

function checkoutRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "chk_1",
    reservation_id: "reservation-1",
    event_id: "event-1",
    tier_id: "tier-1",
    order_name: "Moim Ticket",
    amount: 15000,
    currency: "KRW",
    customer: { moimUserId: "user-1" },
    callback_url: "https://moim.kodingwarrior.dev/api/ticket-payment-callbacks",
    success_url: "https://moim.kodingwarrior.dev/events/event-1/register?payment=success",
    cancel_url: "https://moim.kodingwarrior.dev/events/event-1/register?payment=cancel",
    status: "requires_payment",
    idempotency_key: "reservation:reservation-1",
    selected_easy_pay_provider: null,
    provider_account_id: null,
    provider_payment_id: null,
    provider_tx_id: null,
    raw_provider_response: null,
    paid_at: null,
    created_at: "2026-04-27T00:00:00.000Z",
    updated_at: "2026-04-27T00:00:00.000Z",
    ...overrides,
  };
}
