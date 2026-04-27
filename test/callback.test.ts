import { describe, expect, it, vi } from "vitest";
import { callbackHeaders, signCallbackBody } from "../src/callback.js";
import { checkoutRequest, paidPayment, testApp } from "./helpers.js";

async function preparedPaidContext(callbackStatus = 200) {
  const context = await testApp();
  vi.mocked(context.callbackSender.send).mockResolvedValue({ status: callbackStatus, text: "response" });
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
  const paymentId = intent.json().paymentId;
  vi.mocked(context.portone.getPayment).mockResolvedValue(
    paidPayment({
      paymentId,
      customData: { checkoutId, reservationId: "reservation-1", eventId: "event-1", tierId: "tier-1", easyPayProvider: "kakaopay" },
    }),
  );
  await context.app.inject({ method: "POST", url: `/checkouts/${checkoutId}/complete`, payload: { paymentId } });
  return { ...context, checkoutId, paymentId };
}

describe("Moim callback", () => {
  it("creates deterministic HMAC SHA-256 signature", () => {
    const body = JSON.stringify({ type: "ticket_payment.paid", reservationId: "r1" });
    expect(signCallbackBody("fixed-secret", body)).toBe("49db581def94362b682a7ab5bf310e8a15669eb6403fec88a193d0635743e6da");
    expect(callbackHeaders("fixed-secret", "event-1", body)).toMatchObject({
      "X-Ticket-Payment-Event-Id": "event-1",
      "X-Ticket-Payment-Signature": "49db581def94362b682a7ab5bf310e8a15669eb6403fec88a193d0635743e6da",
    });
  });

  it("sends required paid callback fields and marks delivered on 2xx", async () => {
    const { callbackSender, callbacks, checkoutId, paymentId } = await preparedPaidContext(204);
    expect(callbackSender.send).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(vi.mocked(callbackSender.send).mock.calls[0][1]);
    expect(sentBody).toMatchObject({
      type: "ticket_payment.paid",
      reservationId: "reservation-1",
      checkoutId,
      paymentId,
      txId: "tx_1",
      amount: 15000,
      currency: "KRW",
    });
    expect((await callbacks.list())[0]).toMatchObject({ status: "delivered", attempts: 1 });
  });

  it("schedules retry and stores lastError when Moim returns 5xx", async () => {
    const { callbacks } = await preparedPaidContext(500);
    const event = (await callbacks.list())[0];
    expect(event.status).toBe("retry_scheduled");
    expect(event.attempts).toBe(1);
    expect(event.lastError).toBe("HTTP 500");
    expect(event.nextRetryAt).toBeDefined();
  });

  it("does not create duplicate callback event for the same paid payment", async () => {
    const { app, callbackSender, callbacks, checkoutId, paymentId } = await preparedPaidContext(200);
    await app.inject({ method: "POST", url: `/checkouts/${checkoutId}/complete`, payload: { paymentId } });
    expect(callbackSender.send).toHaveBeenCalledTimes(1);
    expect(await callbacks.list()).toHaveLength(1);
  });
});
