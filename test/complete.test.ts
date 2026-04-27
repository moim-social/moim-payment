import { describe, expect, it, vi } from "vitest";
import { checkoutRequest, paidPayment, testApp } from "./helpers.js";

async function createPreparedCheckout() {
  const context = await testApp();
  const created = await context.app.inject({
    method: "POST",
    url: "/v1/ticket-checkouts",
    headers: { authorization: "Bearer test-token", "idempotency-key": "key-1" },
    payload: checkoutRequest(),
  });
  const checkoutId = created.json().checkoutId;
  const intent = await context.app.inject({
    method: "POST",
    url: `/checkouts/${checkoutId}/payment-intents`,
    payload: { providerAccountId: "portone_kakaopay" },
  });
  return { ...context, checkoutId, paymentId: intent.json().paymentId };
}

describe("complete API", () => {
  it("returns 404 for unknown checkoutId", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/checkouts/missing/complete",
      payload: { paymentId: "pay_1" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("rejects non-paid PortOne payment", async () => {
    const { app, portone, checkoutId, paymentId } = await createPreparedCheckout();
    vi.mocked(portone.getPayment).mockResolvedValue(paidPayment({ paymentId, status: "READY" }));
    const response = await app.inject({
      method: "POST",
      url: `/checkouts/${checkoutId}/complete`,
      payload: { paymentId },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("payment_not_paid");
  });

  it.each([
    ["amount mismatch", paidPayment({ amount: { total: 1 } }), "amount_mismatch"],
    ["currency mismatch", paidPayment({ currency: "USD" }), "currency_mismatch"],
    ["reservationId mismatch", paidPayment({ customData: { checkoutId: "placeholder", reservationId: "other", eventId: "event-1", tierId: "tier-1", easyPayProvider: "kakaopay" } }), "reservationId_mismatch"],
    ["easyPayProvider mismatch", paidPayment({ customData: { checkoutId: "placeholder", reservationId: "reservation-1", eventId: "event-1", tierId: "tier-1", easyPayProvider: "tosspay" } }), "easy_pay_provider_mismatch"],
  ])("rejects %s", async (_name, payment, code) => {
    const { app, portone, checkoutId, paymentId } = await createPreparedCheckout();
    const customData = typeof payment.customData === "object" ? { ...payment.customData, checkoutId } : payment.customData;
    vi.mocked(portone.getPayment).mockResolvedValue({ ...payment, paymentId, customData });
    const response = await app.inject({
      method: "POST",
      url: `/checkouts/${checkoutId}/complete`,
      payload: { paymentId },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe(code);
  });

  it("rejects checkoutId mismatch", async () => {
    const { app, portone, checkoutId, paymentId } = await createPreparedCheckout();
    vi.mocked(portone.getPayment).mockResolvedValue(
      paidPayment({
        paymentId,
        customData: { checkoutId: "other", reservationId: "reservation-1", eventId: "event-1", tierId: "tier-1", easyPayProvider: "kakaopay" },
      }),
    );
    const response = await app.inject({
      method: "POST",
      url: `/checkouts/${checkoutId}/complete`,
      payload: { paymentId },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("checkoutId_mismatch");
  });

  it("marks checkout paid and sends Moim callback after validation", async () => {
    const { app, portone, callbackSender, callbacks, checkoutId, paymentId } = await createPreparedCheckout();
    vi.mocked(portone.getPayment).mockResolvedValue(
      paidPayment({ paymentId, customData: { checkoutId, reservationId: "reservation-1", eventId: "event-1", tierId: "tier-1", easyPayProvider: "kakaopay" } }),
    );
    const response = await app.inject({
      method: "POST",
      url: `/checkouts/${checkoutId}/complete`,
      payload: { paymentId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("paid");
    expect(callbackSender.send).toHaveBeenCalledTimes(1);
    const events = await callbacks.list();
    expect(events[0]).toMatchObject({ checkoutId, paymentId, status: "delivered", attempts: 1 });
  });

  it("is idempotent after checkout is paid", async () => {
    const { app, portone, callbackSender, checkoutId, paymentId } = await createPreparedCheckout();
    vi.mocked(portone.getPayment).mockResolvedValue(
      paidPayment({ paymentId, customData: { checkoutId, reservationId: "reservation-1", eventId: "event-1", tierId: "tier-1", easyPayProvider: "kakaopay" } }),
    );
    await app.inject({ method: "POST", url: `/checkouts/${checkoutId}/complete`, payload: { paymentId } });
    const second = await app.inject({ method: "POST", url: `/checkouts/${checkoutId}/complete`, payload: { paymentId } });
    expect(second.statusCode).toBe(200);
    expect(callbackSender.send).toHaveBeenCalledTimes(1);
  });
});
