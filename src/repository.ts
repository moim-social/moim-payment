import { randomUUID } from "node:crypto";
import type { CallbackEvent, CallbackStatus, TicketCheckout } from "./types.js";

export interface CheckoutRepository {
  create(checkout: TicketCheckout): Promise<TicketCheckout>;
  findById(id: string): Promise<TicketCheckout | undefined>;
  findByIdempotencyKey(key: string): Promise<TicketCheckout | undefined>;
  findActiveByReservationId(reservationId: string): Promise<TicketCheckout | undefined>;
  findByProviderPaymentId(paymentId: string): Promise<TicketCheckout | undefined>;
  update(checkout: TicketCheckout): Promise<TicketCheckout>;
}

export interface CallbackRepository {
  createIfAbsent(event: Omit<CallbackEvent, "id" | "createdAt">): Promise<{ event: CallbackEvent; created: boolean }>;
  updateDelivery(
    id: string,
    patch: Pick<CallbackEvent, "status" | "attempts"> & Partial<Pick<CallbackEvent, "lastError" | "nextRetryAt" | "deliveredAt">>,
  ): Promise<CallbackEvent>;
  findByCheckoutPaymentType(checkoutId: string, paymentId: string, type: CallbackEvent["type"]): Promise<CallbackEvent | undefined>;
  list(): Promise<CallbackEvent[]>;
}

export class InMemoryCheckoutRepository implements CheckoutRepository {
  private readonly byId = new Map<string, TicketCheckout>();
  private readonly idempotency = new Map<string, string>();

  async create(checkout: TicketCheckout): Promise<TicketCheckout> {
    this.byId.set(checkout.id, checkout);
    this.idempotency.set(checkout.idempotencyKey, checkout.id);
    return checkout;
  }

  async findById(id: string): Promise<TicketCheckout | undefined> {
    return this.byId.get(id);
  }

  async findByIdempotencyKey(key: string): Promise<TicketCheckout | undefined> {
    const id = this.idempotency.get(key);
    return id ? this.byId.get(id) : undefined;
  }

  async findActiveByReservationId(reservationId: string): Promise<TicketCheckout | undefined> {
    return [...this.byId.values()].find(
      (checkout) =>
        checkout.reservationId === reservationId &&
        ["requires_payment", "payment_pending", "paid"].includes(checkout.status),
    );
  }

  async findByProviderPaymentId(paymentId: string): Promise<TicketCheckout | undefined> {
    return [...this.byId.values()].find((checkout) => checkout.providerPaymentId === paymentId);
  }

  async update(checkout: TicketCheckout): Promise<TicketCheckout> {
    const updated = { ...checkout, updatedAt: new Date().toISOString() };
    this.byId.set(checkout.id, updated);
    return updated;
  }
}

export class InMemoryCallbackRepository implements CallbackRepository {
  private readonly byId = new Map<string, CallbackEvent>();
  private readonly unique = new Map<string, string>();

  async createIfAbsent(event: Omit<CallbackEvent, "id" | "createdAt">): Promise<{ event: CallbackEvent; created: boolean }> {
    const key = this.key(event.checkoutId, event.paymentId, event.type);
    const existingId = this.unique.get(key);
    if (existingId) {
      return { event: this.byId.get(existingId)!, created: false };
    }
    const created: CallbackEvent = { ...event, id: randomUUID(), createdAt: new Date().toISOString() };
    this.byId.set(created.id, created);
    this.unique.set(key, created.id);
    return { event: created, created: true };
  }

  async updateDelivery(
    id: string,
    patch: Pick<CallbackEvent, "status" | "attempts"> & Partial<Pick<CallbackEvent, "lastError" | "nextRetryAt" | "deliveredAt">>,
  ): Promise<CallbackEvent> {
    const current = this.byId.get(id);
    if (!current) throw new Error("callback event not found");
    const updated = { ...current, ...patch };
    this.byId.set(id, updated);
    return updated;
  }

  async findByCheckoutPaymentType(checkoutId: string, paymentId: string, type: CallbackEvent["type"]): Promise<CallbackEvent | undefined> {
    const id = this.unique.get(this.key(checkoutId, paymentId, type));
    return id ? this.byId.get(id) : undefined;
  }

  async list(): Promise<CallbackEvent[]> {
    return [...this.byId.values()];
  }

  private key(checkoutId: string, paymentId: string, type: CallbackStatus | string): string {
    return `${checkoutId}:${paymentId}:${type}`;
  }
}
