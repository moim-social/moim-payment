import { createHmac } from "node:crypto";
import type { CallbackEvent, CallbackSender, PaidCallbackBody } from "./types.js";
import type { CallbackRepository } from "./repository.js";

export function signCallbackBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function callbackHeaders(secret: string, eventId: string, body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Ticket-Payment-Event-Id": eventId,
    "X-Ticket-Payment-Signature": signCallbackBody(secret, body),
  };
}

export async function deliverCallback(
  event: CallbackEvent,
  callbackUrl: string,
  secret: string,
  sender: CallbackSender,
  callbacks: CallbackRepository,
  now = new Date(),
): Promise<CallbackEvent> {
  const body = stableJson(event.body);
  const headers = callbackHeaders(secret, event.id, body);
  const attempts = event.attempts + 1;

  try {
    const response = await sender.send(callbackUrl, body, headers);
    if (response.status >= 200 && response.status < 300) {
      return callbacks.updateDelivery(event.id, {
        status: "delivered",
        attempts,
        deliveredAt: now.toISOString(),
        lastError: undefined,
        nextRetryAt: undefined,
      });
    }
    return callbacks.updateDelivery(event.id, {
      status: "retry_scheduled",
      attempts,
      lastError: `HTTP ${response.status}`,
      nextRetryAt: nextRetryAt(attempts, now).toISOString(),
    });
  } catch (error) {
    return callbacks.updateDelivery(event.id, {
      status: "retry_scheduled",
      attempts,
      lastError: error instanceof Error ? error.message : "Unknown callback error",
      nextRetryAt: nextRetryAt(attempts, now).toISOString(),
    });
  }
}

export function stableJson(body: PaidCallbackBody): string {
  return JSON.stringify(body);
}

function nextRetryAt(attempts: number, now: Date): Date {
  const delaySeconds = Math.min(60 * 30, 2 ** Math.max(0, attempts - 1) * 30);
  return new Date(now.getTime() + delaySeconds * 1000);
}
