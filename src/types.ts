export type Provider = "portone";
export type PaymentMethodFamily = "easy_pay";
export type PortOneEasyPayProvider = "kakaopay" | "tosspay" | "naverpay";
export type CheckoutStatus = "requires_payment" | "payment_pending" | "paid" | "failed";
export type CallbackStatus = "pending" | "delivered" | "retry_scheduled" | "failed";

export interface ProviderAccount {
  id: string;
  provider: Provider;
  paymentMethodFamily: PaymentMethodFamily;
  easyPayProvider: PortOneEasyPayProvider;
  displayName: string;
  storeId: string;
  channelKey: string;
  enabled: boolean;
}

export interface Customer {
  moimUserId: string;
  name?: string;
  email?: string;
}

export interface TicketCheckout {
  id: string;
  reservationId: string;
  eventId: string;
  tierId: string;
  orderName: string;
  amount: number;
  currency: string;
  customer: Customer;
  callbackUrl: string;
  successUrl: string;
  cancelUrl: string;
  status: CheckoutStatus;
  idempotencyKey: string;
  selectedEasyPayProvider?: PortOneEasyPayProvider;
  providerAccountId?: string;
  providerPaymentId?: string;
  providerTxId?: string;
  rawProviderResponse?: unknown;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallbackEvent {
  id: string;
  checkoutId: string;
  paymentId: string;
  type: "ticket_payment.paid";
  body: PaidCallbackBody;
  status: CallbackStatus;
  attempts: number;
  lastError?: string;
  nextRetryAt?: string;
  deliveredAt?: string;
  createdAt: string;
}

export interface PaidCallbackBody {
  type: "ticket_payment.paid";
  reservationId: string;
  checkoutId: string;
  paymentId: string;
  txId?: string;
  provider: Provider;
  amount: number;
  currency: string;
  paidAt: string;
}

export interface PortOnePayment {
  paymentId: string;
  status: string;
  orderName?: string;
  amount: {
    total: number;
  };
  currency: string;
  customData?: string | Record<string, unknown> | null;
  channel?: {
    id?: string;
    key?: string;
    name?: string;
    pg?: string;
    mid?: string;
    type?: string;
  };
  transaction?: {
    id?: string;
    txId?: string;
  };
  txId?: string;
}

export interface PortOneAdapter {
  getPayment(paymentId: string): Promise<PortOnePayment>;
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<unknown>;
}

export interface CallbackSender {
  send(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; text?: string }>;
}
