import { describe, expect, it } from "vitest";
import { checkoutRequest, testApp } from "./helpers.js";

const auth = { authorization: "Bearer test-token", "idempotency-key": "key-1" };

describe("provider account routing", () => {
  it("returns kakaopay and tosspay but not disabled naverpay", async () => {
    const { app } = await testApp();
    const response = await app.inject({ method: "GET", url: "/v1/provider-accounts" });
    expect(response.statusCode).toBe(200);
    expect(response.json().providerAccounts.map((account: any) => account.easyPayProvider)).toEqual([
      "kakaopay",
      "tosspay",
    ]);
  });

  it("does not render disabled naverpay on checkout page", async () => {
    const { app } = await testApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: auth,
      payload: checkoutRequest(),
    });
    const page = await app.inject({ method: "GET", url: `/checkouts/${created.json().checkoutId}` });
    expect(page.body).toContain("kakaopay");
    expect(page.body).toContain("tosspay");
    expect(page.body).not.toContain("naverpay");
  });

  it("rejects payment intent for disabled providerAccountId", async () => {
    const { app } = await testApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/ticket-checkouts",
      headers: auth,
      payload: checkoutRequest(),
    });
    const response = await app.inject({
      method: "POST",
      url: `/checkouts/${created.json().checkoutId}/payment-intents`,
      payload: { providerAccountId: "portone_naverpay" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("provider_account_disabled");
  });
});
