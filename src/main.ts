import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { FetchCallbackSender, RealPortOneAdapter } from "./adapters/portone.js";
import { InMemoryCallbackRepository, InMemoryCheckoutRepository } from "./repository.js";
import { TicketPaymentService } from "./service.js";

const config = loadConfig();
const service = new TicketPaymentService(
  config,
  new InMemoryCheckoutRepository(),
  new InMemoryCallbackRepository(),
  new RealPortOneAdapter(config.portoneApiSecret, config.portoneWebhookSecret),
  new FetchCallbackSender(),
);

const app = await buildApp({ config, service });
await app.listen({ port: config.port, host: "0.0.0.0" });
