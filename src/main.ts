import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { FetchCallbackSender, RealPortOneAdapter } from "./adapters/portone.js";
import { InMemoryCallbackRepository, InMemoryCheckoutRepository } from "./repository.js";
import { createPostgresPool, PostgresCallbackRepository, PostgresCheckoutRepository } from "./postgresRepository.js";
import { TicketPaymentService } from "./service.js";

const config = loadConfig();
const postgresPool = config.databaseUrl ? createPostgresPool(config.databaseUrl) : undefined;
const service = new TicketPaymentService(
  config,
  postgresPool ? new PostgresCheckoutRepository(postgresPool) : new InMemoryCheckoutRepository(),
  postgresPool ? new PostgresCallbackRepository(postgresPool) : new InMemoryCallbackRepository(),
  new RealPortOneAdapter(config.portoneApiSecret, config.portoneWebhookSecret),
  new FetchCallbackSender(),
);

const app = await buildApp({ config, service });
await app.listen({ port: config.port, host: "0.0.0.0" });
