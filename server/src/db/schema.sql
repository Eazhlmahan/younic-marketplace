CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('business','creator')),
  anon_id TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  real_name TEXT,
  public_name TEXT,
  phone_verified INTEGER DEFAULT 0,
  email_verified INTEGER DEFAULT 0,
  id_verified INTEGER DEFAULT 0,
  business_verified INTEGER DEFAULT 0,
  tier TEXT DEFAULT 'unverified',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS creator_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  niche TEXT,
  avg_reach INTEGER DEFAULT 0,
  engagement_rate REAL DEFAULT 0,
  portfolio_urls TEXT DEFAULT '[]',
  completed_deals INTEGER DEFAULT 0,
  rating_avg REAL DEFAULT 0,
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
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  brief_id TEXT REFERENCES briefs(id),
  business_id TEXT REFERENCES users(id),
  creator_id TEXT REFERENCES users(id),
  deliverable TEXT,
  deadline TEXT,
  agreed_price INTEGER,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS counter_offers (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  offered_by TEXT CHECK(offered_by IN ('business','creator')),
  price INTEGER,
  timeline_days INTEGER,
  round INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS escrow_transactions (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  amount INTEGER,
  commission_pct REAL DEFAULT 0.15,
  gateway_ref TEXT,
  status TEXT DEFAULT 'held',
  held_at TEXT DEFAULT CURRENT_TIMESTAMP,
  released_at TEXT
);

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  file_url TEXT,
  submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT
);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  rater_id TEXT REFERENCES users(id),
  ratee_id TEXT REFERENCES users(id),
  score INTEGER,
  comment TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES bookings(id),
  sender_id TEXT REFERENCES users(id),
  body TEXT,
  filtered INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  business_id TEXT REFERENCES users(id),
  tier TEXT DEFAULT 'starter',
  status TEXT DEFAULT 'active',
  renews_at TEXT
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  channel TEXT DEFAULT 'phone' CHECK(channel IN ('phone','email')),
  code TEXT,
  expires_at TEXT,
  consumed INTEGER DEFAULT 0
);
