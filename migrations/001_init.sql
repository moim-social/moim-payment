CREATE TABLE ticket_checkouts (
  id text PRIMARY KEY,
  reservation_id text NOT NULL,
  event_id text NOT NULL,
  tier_id text NOT NULL,
  order_name text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  currency text NOT NULL,
  callback_url text NOT NULL,
  success_url text NOT NULL,
  cancel_url text NOT NULL,
  status text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  selected_easy_pay_provider text,
  provider_account_id text,
  provider_payment_id text,
  provider_tx_id text,
  raw_provider_response jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ticket_checkouts_one_active_reservation
  ON ticket_checkouts (reservation_id)
  WHERE status IN ('requires_payment', 'payment_pending', 'paid');

CREATE TABLE callback_events (
  id text PRIMARY KEY,
  checkout_id text NOT NULL REFERENCES ticket_checkouts(id),
  payment_id text NOT NULL,
  type text NOT NULL,
  body jsonb NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_retry_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (checkout_id, payment_id, type)
);
