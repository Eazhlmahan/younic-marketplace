# Younic API (v1 backend)

A real, runnable Express + SQLite backend implementing the full booking/escrow/negotiation
state machine from the Younic tech spec. Tested end-to-end (see "What's verified" below).

## Run it

```bash
npm install
npm run seed   # loads 3 sample creators, all with password: password123
npm run dev    # starts on http://localhost:4000
```

## What's real vs. stubbed

**Real and working:**
- User signup/login with bcrypt password hashing + JWT auth
- Phone and email verification via one-time codes — real generation, expiry (5 min), and
  consumption logic; tier flips to `verified` only once both are confirmed (tested end-to-end,
  including that a wrong code is correctly rejected)
- Full booking state machine: `pending → negotiating → confirmed → identity_unlocked → delivered → paid_out`
- Negotiation with a hard 3-round cap, enforced server-side
- Escrow hold → identity unlock gating (reveal endpoint 403s until escrow is paid)
- Contact-info regex filter on all messages before identity unlock
- Commission math (15%) computed and returned at payout
- SQLite database with the full schema from the tech doc (users, bookings, escrow_transactions,
  counter_offers, deliverables, ratings, subscriptions, messages)

**Stubbed — clearly marked with `dev_note` in the API responses, swap these for production:**
- `POST /auth/otp/send` (`{channel: 'phone'|'email'}`) — logs the code to the server console
  instead of actually sending an SMS or email. Swap in MSG91/Twilio for SMS and
  SendGrid/Postmark/SES for email — the code generation, 5-minute expiry, and single-use
  consumption logic underneath is already correct and doesn't need to change.
- `POST /bookings/:id/escrow/pay` — instantly marks payment as held. Swap for real Razorpay Route
  or Cashfree Payouts order creation + webhook confirmation (the state transition logic — only
  unlock identity once the webhook confirms the hold — is already correct, you're replacing the
  trigger, not the logic).
- `POST /bookings/:id/approve` payout — instantly marks as paid. Swap for a real payout API call.
  Commission math is already correct.
- `POST /subscriptions` — instantly activates. Swap for real recurring billing via your gateway.

## API reference
See `src/routes/*.js` — each route file is small and documents its own behavior inline.
Main flow: `auth.js` → `profiles.js` (browse/discovery) → `bookings.js` (the core state machine).

## Database
SQLite file at `src/db/younic.db`, created automatically from `schema.sql` on first run.
Swap to Postgres for production — the schema is plain SQL and translates directly; only
`better-sqlite3` calls in `db/index.js` would need to become a Postgres client (e.g. `pg` or Prisma).
