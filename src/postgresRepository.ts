import { Pool, type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { CallbackEvent, Customer, TicketCheckout } from "./types.js";
import type { CallbackRepository, CheckoutRepository } from "./repository.js";

export function createPostgresPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

export class PostgresCheckoutRepository implements CheckoutRepository {
  constructor(private readonly pool: Pool) {}

  async create(checkout: TicketCheckout): Promise<TicketCheckout> {
    const row = await this.one(
      `INSERT INTO ticket_checkouts (
        id, reservation_id, event_id, tier_id, order_name, amount, currency, customer,
        callback_url, success_url, cancel_url, status, idempotency_key,
        selected_easy_pay_provider, provider_account_id, provider_payment_id, provider_tx_id,
        raw_provider_response, paid_at, created_at, updated_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
      ) RETURNING *`,
      checkoutParams(checkout),
    );
    return checkoutFromRow(row);
  }

  async findById(id: string): Promise<TicketCheckout | undefined> {
    return this.maybeOne("SELECT * FROM ticket_checkouts WHERE id = $1", [id]).then(mapMaybeCheckout);
  }

  async findByIdempotencyKey(key: string): Promise<TicketCheckout | undefined> {
    return this.maybeOne("SELECT * FROM ticket_checkouts WHERE idempotency_key = $1", [key]).then(mapMaybeCheckout);
  }

  async findActiveByReservationId(reservationId: string): Promise<TicketCheckout | undefined> {
    return this.maybeOne(
      "SELECT * FROM ticket_checkouts WHERE reservation_id = $1 AND status IN ('requires_payment', 'payment_pending', 'paid') ORDER BY created_at ASC LIMIT 1",
      [reservationId],
    ).then(mapMaybeCheckout);
  }

  async findByProviderPaymentId(paymentId: string): Promise<TicketCheckout | undefined> {
    return this.maybeOne("SELECT * FROM ticket_checkouts WHERE provider_payment_id = $1", [paymentId]).then(mapMaybeCheckout);
  }

  async update(checkout: TicketCheckout): Promise<TicketCheckout> {
    const row = await this.one(
      `UPDATE ticket_checkouts SET
        reservation_id = $2,
        event_id = $3,
        tier_id = $4,
        order_name = $5,
        amount = $6,
        currency = $7,
        customer = $8,
        callback_url = $9,
        success_url = $10,
        cancel_url = $11,
        status = $12,
        idempotency_key = $13,
        selected_easy_pay_provider = $14,
        provider_account_id = $15,
        provider_payment_id = $16,
        provider_tx_id = $17,
        raw_provider_response = $18,
        paid_at = $19,
        created_at = $20,
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
      checkoutParams(checkout),
    );
    return checkoutFromRow(row);
  }

  private async maybeOne(sql: string, params: unknown[]): Promise<any | undefined> {
    const result = await this.pool.query(sql, params);
    return result.rows[0];
  }

  private async one(sql: string, params: unknown[]): Promise<any> {
    const result = await this.pool.query(sql, params);
    return result.rows[0];
  }
}

export class PostgresCallbackRepository implements CallbackRepository {
  constructor(private readonly pool: Pool) {}

  async createIfAbsent(event: Omit<CallbackEvent, "id" | "createdAt">): Promise<{ event: CallbackEvent; created: boolean }> {
    return withClient(this.pool, async (client) => {
      const id = randomUUID();
      const inserted = await client.query(
        `INSERT INTO callback_events (
          id, checkout_id, payment_id, type, body, status, attempts, last_error, next_retry_at, delivered_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (checkout_id, payment_id, type) DO NOTHING
        RETURNING *`,
        [
          id,
          event.checkoutId,
          event.paymentId,
          event.type,
          event.body,
          event.status,
          event.attempts,
          event.lastError,
          event.nextRetryAt,
          event.deliveredAt,
        ],
      );
      if (inserted.rows[0]) return { event: callbackFromRow(inserted.rows[0]), created: true };

      const existing = await client.query(
        "SELECT * FROM callback_events WHERE checkout_id = $1 AND payment_id = $2 AND type = $3",
        [event.checkoutId, event.paymentId, event.type],
      );
      return { event: callbackFromRow(existing.rows[0]), created: false };
    });
  }

  async updateDelivery(
    id: string,
    patch: Pick<CallbackEvent, "status" | "attempts"> & Partial<Pick<CallbackEvent, "lastError" | "nextRetryAt" | "deliveredAt">>,
  ): Promise<CallbackEvent> {
    const result = await this.pool.query(
      `UPDATE callback_events SET
        status = $2,
        attempts = $3,
        last_error = $4,
        next_retry_at = $5,
        delivered_at = $6
      WHERE id = $1
      RETURNING *`,
      [id, patch.status, patch.attempts, patch.lastError, patch.nextRetryAt, patch.deliveredAt],
    );
    return callbackFromRow(result.rows[0]);
  }

  async findByCheckoutPaymentType(checkoutId: string, paymentId: string, type: CallbackEvent["type"]): Promise<CallbackEvent | undefined> {
    const result = await this.pool.query(
      "SELECT * FROM callback_events WHERE checkout_id = $1 AND payment_id = $2 AND type = $3",
      [checkoutId, paymentId, type],
    );
    return result.rows[0] ? callbackFromRow(result.rows[0]) : undefined;
  }

  async list(): Promise<CallbackEvent[]> {
    const result = await this.pool.query("SELECT * FROM callback_events ORDER BY created_at ASC");
    return result.rows.map(callbackFromRow);
  }
}

function checkoutParams(checkout: TicketCheckout): unknown[] {
  return [
    checkout.id,
    checkout.reservationId,
    checkout.eventId,
    checkout.tierId,
    checkout.orderName,
    checkout.amount,
    checkout.currency,
    checkout.customer,
    checkout.callbackUrl,
    checkout.successUrl,
    checkout.cancelUrl,
    checkout.status,
    checkout.idempotencyKey,
    checkout.selectedEasyPayProvider,
    checkout.providerAccountId,
    checkout.providerPaymentId,
    checkout.providerTxId,
    checkout.rawProviderResponse,
    checkout.paidAt,
    checkout.createdAt,
    checkout.updatedAt,
  ];
}

function checkoutFromRow(row: any): TicketCheckout {
  return {
    id: row.id,
    reservationId: row.reservation_id,
    eventId: row.event_id,
    tierId: row.tier_id,
    orderName: row.order_name,
    amount: row.amount,
    currency: row.currency,
    customer: row.customer as Customer,
    callbackUrl: row.callback_url,
    successUrl: row.success_url,
    cancelUrl: row.cancel_url,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    selectedEasyPayProvider: row.selected_easy_pay_provider,
    providerAccountId: row.provider_account_id,
    providerPaymentId: row.provider_payment_id,
    providerTxId: row.provider_tx_id,
    rawProviderResponse: row.raw_provider_response,
    paidAt: iso(row.paid_at),
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}

function callbackFromRow(row: any): CallbackEvent {
  return {
    id: row.id,
    checkoutId: row.checkout_id,
    paymentId: row.payment_id,
    type: row.type,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    nextRetryAt: iso(row.next_retry_at),
    deliveredAt: iso(row.delivered_at),
    createdAt: iso(row.created_at)!,
  };
}

function mapMaybeCheckout(row: any | undefined): TicketCheckout | undefined {
  return row ? checkoutFromRow(row) : undefined;
}

function iso(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function withClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}
