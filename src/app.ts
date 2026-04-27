import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { AppError, unauthorized } from "./errors.js";
import { TicketPaymentService } from "./service.js";
import type { AppConfig } from "./config.js";

export interface AppDeps {
  config: AppConfig;
  service: TicketPaymentService;
}

export async function buildApp({ config, service }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    done(null, body);
  });

  await app.register(cors, {
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/v1/provider-accounts", async () => ({
    providerAccounts: service.listProviderAccounts().map((account) => ({
      id: account.id,
      provider: account.provider,
      paymentMethodFamily: account.paymentMethodFamily,
      easyPayProvider: account.easyPayProvider,
      displayName: account.displayName,
      enabled: account.enabled,
    })),
  }));

  app.post("/v1/ticket-checkouts", async (request) => {
    requireBearer(request.headers.authorization, config.apiToken);
    const checkout = await service.createCheckout(parseJsonBody(request.body), headerValue(request.headers["idempotency-key"]));
    return service.checkoutResponse(checkout);
  });

  app.get("/checkouts/:checkoutId", async (request, reply) => {
    const { checkoutId } = request.params as { checkoutId: string };
    const checkout = await service.getCheckout(checkoutId);
    reply.type("text/html; charset=utf-8").send(renderCheckoutPage(checkout, service.listProviderAccounts()));
  });

  app.post("/checkouts/:checkoutId/payment-intents", async (request) => {
    const { checkoutId } = request.params as { checkoutId: string };
    const body = parseJsonBody(request.body) as { providerAccountId?: string };
    const prepared = await service.preparePayment(checkoutId, body.providerAccountId ?? "");
    return {
      paymentId: prepared.paymentId,
      storeId: prepared.account.storeId,
      channelKey: prepared.account.channelKey,
      checkout: {
        checkoutId: prepared.checkout.id,
        reservationId: prepared.checkout.reservationId,
        eventId: prepared.checkout.eventId,
        tierId: prepared.checkout.tierId,
        orderName: prepared.checkout.orderName,
        amount: prepared.checkout.amount,
        currency: prepared.checkout.currency,
        easyPayProvider: prepared.account.easyPayProvider,
      },
    };
  });

  app.post("/checkouts/:checkoutId/complete", async (request) => {
    const { checkoutId } = request.params as { checkoutId: string };
    const body = parseJsonBody(request.body) as { paymentId?: string };
    const checkout = await service.completeCheckout(checkoutId, body.paymentId ?? "");
    return { status: checkout.status, redirectUrl: checkout.successUrl };
  });

  app.post("/webhooks/portone", async (request, reply) => {
    const rawBody = typeof request.body === "string" ? request.body : "";
    let webhook: any;
    try {
      webhook = await service.verifyPortOneWebhook(rawBody, request.headers);
    } catch {
      reply.code(400).send({ code: "invalid_webhook_signature" });
      return;
    }
    const paymentId = webhook?.data?.paymentId;
    if (typeof paymentId === "string" && paymentId.length > 0) {
      await service.syncPortOnePayment(paymentId);
    }
    return { ok: true };
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({ code: error.code, message: error.message });
      return;
    }
    console.error(error);
    reply.code(500).send({ code: "internal_error", message: "Internal server error" });
  });

  return app;
}

function requireBearer(authorization: string | undefined, token: string): void {
  if (authorization !== `Bearer ${token}`) throw unauthorized();
}

function parseJsonBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  return JSON.parse(body);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function renderCheckoutPage(
  checkout: Awaited<ReturnType<TicketPaymentService["getCheckout"]>>,
  accounts: ReturnType<TicketPaymentService["listProviderAccounts"]>,
): string {
  const publicAccounts = accounts.map((account) => ({
    id: account.id,
    easyPayProvider: account.easyPayProvider,
    label: account.displayName,
  }));
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Moim Ticket Payment</title>
  <script src="https://cdn.portone.io/v2/browser-sdk.js" async defer></script>
  <style>
    body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; color: #121212; background: #f7f7f8; }
    main { max-width: 520px; margin: 48px auto; padding: 24px; background: white; border: 1px solid #dedee3; border-radius: 8px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    .amount { font-size: 28px; font-weight: 700; margin: 24px 0; }
    .methods { display: grid; gap: 10px; }
    button { min-height: 48px; border-radius: 8px; border: 1px solid #202124; background: #202124; color: white; font-weight: 700; cursor: pointer; }
    button:disabled { opacity: .55; cursor: wait; }
    .message { margin-top: 16px; min-height: 24px; color: #9f1239; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(checkout.orderName)}</h1>
    <div>예약 ${escapeHtml(checkout.reservationId)}</div>
    <div class="amount">${checkout.amount.toLocaleString("ko-KR")} ${checkout.currency}</div>
    <div class="methods" id="methods"></div>
    <div class="message" id="message"></div>
  </main>
  <script>
    const checkout = ${JSON.stringify({
      checkoutId: checkout.id,
      reservationId: checkout.reservationId,
      eventId: checkout.eventId,
      tierId: checkout.tierId,
      orderName: checkout.orderName,
      amount: checkout.amount,
      currency: checkout.currency,
    })};
    const accounts = ${JSON.stringify(publicAccounts)};
    const methods = document.getElementById("methods");
    const message = document.getElementById("message");
    for (const account of accounts) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = account.label;
      button.onclick = () => pay(account, button);
      methods.append(button);
    }
    async function waitPortOne() {
      while (!window.PortOne) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    async function pay(account, button) {
      button.disabled = true;
      message.textContent = "";
      try {
        await waitPortOne();
        const intent = await fetch("/checkouts/" + checkout.checkoutId + "/payment-intents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerAccountId: account.id })
        }).then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          return response.json();
        });
        const result = await PortOne.requestPayment({
          storeId: intent.storeId,
          channelKey: intent.channelKey,
          paymentId: intent.paymentId,
          orderName: checkout.orderName,
          totalAmount: checkout.amount,
          currency: checkout.currency,
          payMethod: "EASY_PAY",
          customData: {
            checkoutId: checkout.checkoutId,
            reservationId: checkout.reservationId,
            eventId: checkout.eventId,
            tierId: checkout.tierId,
            easyPayProvider: intent.checkout.easyPayProvider
          }
        });
        if (result.code !== undefined) throw new Error(result.message || "결제 요청에 실패했습니다.");
        const complete = await fetch("/checkouts/" + checkout.checkoutId + "/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentId: intent.paymentId })
        }).then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          return response.json();
        });
        window.location.assign(complete.redirectUrl);
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : "결제에 실패했습니다.";
        button.disabled = false;
      }
    }
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
