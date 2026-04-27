import { z } from "zod";
import type { ProviderAccount } from "./types.js";

const providerAccountSchema = z.object({
  id: z.string().min(1),
  provider: z.literal("portone"),
  paymentMethodFamily: z.literal("easy_pay"),
  easyPayProvider: z.enum(["kakaopay", "tosspay", "naverpay"]),
  displayName: z.string().min(1),
  storeId: z.string().min(1),
  channelKey: z.string().min(1),
  enabled: z.boolean(),
});

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
  const providerAccounts = env.PROVIDER_ACCOUNTS_JSON
    ? z.array(providerAccountSchema).parse(JSON.parse(env.PROVIDER_ACCOUNTS_JSON))
    : defaultProviderAccounts;

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
