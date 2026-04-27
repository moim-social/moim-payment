import { describe, expect, it } from "vitest";
import { checkoutRequest, testApp } from "./helpers.js";
import { loadConfig } from "../src/config.js";

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

  it("builds provider accounts from PortOne environment variables", () => {
    const config = loadConfig({
      NODE_ENV: "production",
      DEFAULT_ENABLED_EASY_PAY_PROVIDERS: "kakaopay",
      PORTONE_KAKAOPAY_STORE_ID: "store-real",
      PORTONE_KAKAOPAY_CHANNEL_KEY: "channel-real",
      PORTONE_TOSSPAY_STORE_ID: "store-toss",
      PORTONE_TOSSPAY_CHANNEL_KEY: "channel-toss",
      PORTONE_NAVERPAY_ENABLED: "false",
      PORTONE_NAVERPAY_STORE_ID: "store-naver",
      PORTONE_NAVERPAY_CHANNEL_KEY: "channel-naver",
    });

    expect(config.providerAccounts).toEqual([
      {
        id: "portone_kakaopay",
        provider: "portone",
        paymentMethodFamily: "easy_pay",
        easyPayProvider: "kakaopay",
        displayName: "카카오페이",
        storeId: "store-real",
        channelKey: "channel-real",
        enabled: true,
      },
      {
        id: "portone_tosspay",
        provider: "portone",
        paymentMethodFamily: "easy_pay",
        easyPayProvider: "tosspay",
        displayName: "토스페이",
        storeId: "store-toss",
        channelKey: "channel-toss",
        enabled: false,
      },
      {
        id: "portone_naverpay",
        provider: "portone",
        paymentMethodFamily: "easy_pay",
        easyPayProvider: "naverpay",
        displayName: "네이버페이",
        storeId: "store-naver",
        channelKey: "channel-naver",
        enabled: false,
      },
    ]);
  });
});
