-- PostgreSQL schema for Younic. Run on boot by db/index.js (idempotent).

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('business','creator')),
  anon_id TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  real_name TEXT,
  public_name TEXT,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  email_verified BOOLEAN NOT NULL DEFAULT false,
  id_verified BOOLEAN NOT NULL DEFAULT false,
  business_verified BOOLEAN NOT NULL DEFAULT false,
  tier TEXT NOT NULL DEFAULT 'unverified',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  niche TEXT,
  avg_reach INTEGER NOT NULL DEFAULT 0,
  engagement_rate REAL NOT NULL DEFAULT 0,
  portfolio_urls TEXT NOT NULL DEFAULT '[]',
  completed_deals INTEGER NOT NULL DEFAULT 0,
  rating_avg REAL NOT NULL DEFAULT 0,
  social_handle TEXT,
  verified_account_url TEXT
);

CREATE TABLE IF NOT EXISTS business_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  industry TEXT,
  budget_range TEXT,
  gst_number TEXT
);

CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES users(id),
  niche TEXT,
  budget INTEGER,
  deliverable TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  brief_id TEXT REFERENCES briefs(id),
  business_id TEXT REFERENCES users(id),
  creator_id TEXT REFERENCES users(id),
  deliverable TEXT,
  deadline TEXT,
  agreed_price INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counter_offers (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  offered_by TEXT CHECK(offered_by IN ('business','creator')),
  price INTEGER,
  timeline_days INTEGER,
  round INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS escrow_transactions (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  amount INTEGER,
  commission_pct REAL NOT NULL DEFAULT 0.15,
  gateway_ref TEXT,
  status TEXT NOT NULL DEFAULT 'held',
  held_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  file_url TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  rater_id TEXT REFERENCES users(id),
  ratee_id TEXT REFERENCES users(id),
  score INTEGER,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  sender_id TEXT REFERENCES users(id),
  body TEXT,
  filtered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES users(id),
  tier TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'active',
  renews_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  channel TEXT NOT NULL DEFAULT 'phone' CHECK(channel IN ('phone','email')),
  code TEXT,
  expires_at TIMESTAMPTZ,
  consumed BOOLEAN NOT NULL DEFAULT false
);
