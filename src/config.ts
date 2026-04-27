import type { PortOneEasyPayProvider, ProviderAccount } from "./types.js";

const defaultProviderAccounts: ProviderAccount[] = [
  {
    id: "portone_kakaopay",
    provider: "portone",
    paymentMethodFamily: "easy_pay",
    easyPayProvider: "kakaopay",
    displayName: "카카오페이",
    storeId: "test-store",
    channelKey: "test-kakaopay-channel",
    enabled: true,
  },
  {
    id: "portone_tosspay",
    provider: "portone",
    paymentMethodFamily: "easy_pay",
    easyPayProvider: "tosspay",
    displayName: "토스페이",
    storeId: "test-store",
    channelKey: "test-tosspay-channel",
    enabled: true,
  },
  {
    id: "portone_naverpay",
    provider: "portone",
    paymentMethodFamily: "easy_pay",
    easyPayProvider: "naverpay",
    displayName: "네이버페이",
    storeId: "test-store",
    channelKey: "test-naverpay-channel",
    enabled: false,
  },
];

export interface AppConfig {
  port: number;
  baseUrl: string;
  apiToken: string;
  callbackSecret: string;
  portoneApiSecret: string;
  portoneWebhookSecret: string;
  databaseUrl?: string;
  allowedOrigins: string[];
  providerAccounts: ProviderAccount[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const providerAccounts = buildProviderAccounts(env);

  return {
    port: Number(env.PORT ?? 8080),
    baseUrl: env.BASE_URL ?? "http://localhost:8080",
    apiToken: env.PAYMENT_SERVICE_API_TOKEN ?? "dev-payment-token",
    callbackSecret: env.TICKET_PAYMENT_CALLBACK_SECRET ?? "dev-callback-secret",
    portoneApiSecret: env.PORTONE_API_SECRET ?? "dev-portone-secret",
    portoneWebhookSecret: env.PORTONE_WEBHOOK_SECRET ?? "dev-webhook-secret",
    databaseUrl: env.DATABASE_URL,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "https://moim.kodingwarrior.dev,https://moim.live")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    providerAccounts,
  };
}

function buildProviderAccounts(env: NodeJS.ProcessEnv): ProviderAccount[] {
  const enabledProviders = new Set(
    (env.DEFAULT_ENABLED_EASY_PAY_PROVIDERS ?? "kakaopay,tosspay")
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean),
  );

  const accounts = [
    buildProviderAccount({
      easyPayProvider: "kakaopay",
      displayName: "카카오페이",
      storeId: env.PORTONE_KAKAOPAY_STORE_ID,
      channelKey: env.PORTONE_KAKAOPAY_CHANNEL_KEY,
      enabled: enabledProviders.has("kakaopay"),
    }),
    buildProviderAccount({
      easyPayProvider: "tosspay",
      displayName: "토스페이",
      storeId: env.PORTONE_TOSSPAY_STORE_ID,
      channelKey: env.PORTONE_TOSSPAY_CHANNEL_KEY,
      enabled: enabledProviders.has("tosspay"),
    }),
    buildProviderAccount({
      easyPayProvider: "naverpay",
      displayName: "네이버페이",
      storeId: env.PORTONE_NAVERPAY_STORE_ID,
      channelKey: env.PORTONE_NAVERPAY_CHANNEL_KEY,
      enabled: env.PORTONE_NAVERPAY_ENABLED === "true" && enabledProviders.has("naverpay"),
    }),
  ].filter((account): account is ProviderAccount => account != null);

  if (accounts.length > 0 || env.NODE_ENV === "production") return accounts;
  return defaultProviderAccounts;
}

function buildProviderAccount(input: {
  easyPayProvider: PortOneEasyPayProvider;
  displayName: string;
  storeId?: string;
  channelKey?: string;
  enabled: boolean;
}): ProviderAccount | undefined {
  const storeId = input.storeId?.trim();
  const channelKey = input.channelKey?.trim();
  if (!storeId || !channelKey) return undefined;

  return {
    id: `portone_${input.easyPayProvider}`,
    provider: "portone",
    paymentMethodFamily: "easy_pay",
    easyPayProvider: input.easyPayProvider,
    displayName: input.displayName,
    storeId,
    channelKey,
    enabled: input.enabled,
  };
}
