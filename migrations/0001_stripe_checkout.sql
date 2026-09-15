CREATE TABLE IF NOT EXISTS gyotaku_orders (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  line_display_name TEXT NOT NULL,
  species TEXT NOT NULL,
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy > 0),
  status TEXT NOT NULL CHECK (status IN ('draft', 'awaiting_payment', 'paid', 'producing', 'delivered', 'refunded')),
  metadata_key TEXT NOT NULL,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent TEXT,
  confirmation_sent_at TEXT,
  refunded_amount_jpy INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS gyotaku_orders_line_user_id
  ON gyotaku_orders (line_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);
