import { describe, expect, it, vi } from "vitest";
import { checkoutRequest, paidPayment, testApp } from "./helpers.js";

describe("security-sensitive behavior", () => {
  it("uses checkout amount during complete validation, not browser-submitted amount", async () => {
    const { app, portone } = await testApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: { authorization: "Bearer test-token", "idempotency-key": "key-1" },
      payload: checkoutRequest({ amount: 15000 }),
    });
    const checkoutId = created.json().checkoutId;
    const intent = await app.inject({
      method: "POST",
      url: `/checkouts/${checkoutId}/payment-intents`,
      payload: { providerAccountId: "portone_kakaopay", amount: 1 },
    });
    const paymentId = intent.json().paymentId;
    vi.mocked(portone.getPayment).mockResolvedValue(
      paidPayment({
        paymentId,
        amount: { total: 15000 },
        customData: { checkoutId, reservationId: "reservation-1", eventId: "event-1", tierId: "tier-1", easyPayProvider: "kakaopay" },
      }),
    );
    const response = await app.inject({ method: "POST", url: `/checkouts/${checkoutId}/complete`, payload: { paymentId, amount: 1 } });
    expect(response.statusCode).toBe(200);
  });
});
