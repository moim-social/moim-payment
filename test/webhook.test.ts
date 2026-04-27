import { describe, expect, it, vi } from "vitest";
import { checkoutRequest, paidPayment, testApp } from "./helpers.js";

async function preparedWebhookContext() {
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
  const paymentId = intent.json().paymentId;
  vi.mocked(context.portone.getPayment).mockResolvedValue(
    paidPayment({
      paymentId,
      customData: { checkoutId, reservationId: "reservation-1", eventId: "event-1", tierId: "tier-1", easyPayProvider: "kakaopay" },
    }),
  );
  vi.mocked(context.portone.verifyWebhook).mockResolvedValue({ data: { paymentId } });
  return { ...context, checkoutId, paymentId };
}

describe("PortOne webhook", () => {
  it("rejects invalid raw body signature", async () => {
    const { app, portone } = await testApp();
    vi.mocked(portone.verifyWebhook).mockRejectedValue(new Error("invalid"));
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/portone",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ data: { paymentId: "pay_1" } }),
    });
    expect(response.statusCode).toBe(400);
  });

  it("returns 200 when paymentId is absent", async () => {
    const { app, portone } = await testApp();
    vi.mocked(portone.verifyWebhook).mockResolvedValue({ data: {} });
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/portone",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ data: {} }),
    });
    expect(response.statusCode).toBe(200);
    expect(portone.getPayment).not.toHaveBeenCalled();
  });

  it("syncs paid payment and creates one callback for duplicate webhooks", async () => {
    const { app, callbackSender, callbacks, paymentId } = await preparedWebhookContext();
    const payload = JSON.stringify({ data: { paymentId } });
    const first = await app.inject({ method: "POST", url: "/webhooks/portone", headers: { "content-type": "application/json" }, payload });
    const second = await app.inject({ method: "POST", url: "/webhooks/portone", headers: { "content-type": "application/json" }, payload });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(callbackSender.send).toHaveBeenCalledTimes(1);
    expect(await callbacks.list()).toHaveLength(1);
  });

  it("can complete payment through webhook even if browser complete is never called", async () => {
    const { app, checkouts, paymentId, checkoutId } = await preparedWebhookContext();
    await app.inject({
      method: "POST",
      url: "/webhooks/portone",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ data: { paymentId } }),
    });
    await expect(checkouts.findById(checkoutId)).resolves.toMatchObject({ status: "paid" });
  });
});
