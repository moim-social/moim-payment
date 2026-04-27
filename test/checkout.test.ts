import { describe, expect, it } from "vitest";
import { checkoutRequest, testApp, testConfig } from "./helpers.js";
import { InMemoryCallbackRepository, InMemoryCheckoutRepository } from "../src/repository.js";
import { TicketPaymentService } from "../src/service.js";

const auth = { authorization: "Bearer test-token" };

describe("checkout creation", () => {
  it("rejects requests without bearer token", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: { "idempotency-key": "key-1" },
      payload: checkoutRequest(),
    });
    expect(response.statusCode).toBe(401);
  });

  it("requires Idempotency-Key", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: auth,
      payload: checkoutRequest(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("missing_idempotency_key");
  });

  it("creates a checkout and returns enabled methods only", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: { ...auth, "idempotency-key": "key-1" },
      payload: checkoutRequest(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      provider: "portone",
      paymentMethodFamily: "easy_pay",
      status: "requires_payment",
    });
    expect(response.json().availableMethods.map((method: any) => method.easyPayProvider)).toEqual([
      "kakaopay",
      "tosspay",
    ]);
  });

  it("returns the same checkout for the same Idempotency-Key", async () => {
    const { app } = await testApp();
    const first = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: { ...auth, "idempotency-key": "same-key" },
      payload: checkoutRequest(),
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: { ...auth, "idempotency-key": "same-key" },
      payload: checkoutRequest({ amount: 99999 }),
    });
    expect(second.json().checkoutId).toBe(first.json().checkoutId);
    expect(second.json().status).toBe("requires_payment");
  });

  it("does not create another active checkout for the same reservationId", async () => {
    const { app } = await testApp();
    const first = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: { ...auth, "idempotency-key": "key-1" },
      payload: checkoutRequest(),
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: { ...auth, "idempotency-key": "key-2" },
      payload: checkoutRequest({ orderName: "Other" }),
    });
    expect(second.json().checkoutId).toBe(first.json().checkoutId);
  });

  it("rejects invalid amount and currency", async () => {
    const { app } = await testApp();
    const badAmount = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: { ...auth, "idempotency-key": "key-1" },
      payload: checkoutRequest({ amount: 0 }),
    });
    const badCurrency = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: { ...auth, "idempotency-key": "key-2" },
      payload: checkoutRequest({ currency: "USD" }),
    });
    expect(badAmount.statusCode).toBe(400);
    expect(badCurrency.statusCode).toBe(400);
  });

  it("rejects URLs outside the allowlist", async () => {
    const { app } = await testApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: { ...auth, "idempotency-key": "key-1" },
      payload: checkoutRequest({ callbackUrl: "https://evil.example/callback" }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("origin_not_allowed");
  });

  it("rejects unsupported provider routing", async () => {
    const service = new TicketPaymentService(
      testConfig({ providerAccounts: [] }),
      new InMemoryCheckoutRepository(),
      new InMemoryCallbackRepository(),
      { getPayment: async () => {
        throw new Error("unused");
      }, verifyWebhook: async () => ({}) },
      { send: async () => ({ status: 200 }) },
    );
    await expect(service.createCheckout(checkoutRequest(), "key-1")).rejects.toMatchObject({
      code: "unsupported_payment_route",
    });
  });
});
