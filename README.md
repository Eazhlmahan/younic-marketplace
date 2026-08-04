# Younic — v1 project

A real, runnable full-stack build of the Younic marketplace: signup/login, phone and email
verification (real one-time codes, not just flags), browse/discovery, booking requests,
negotiation (3-round cap), escrow-gated identity unlock, delivery/approval, payout with
commission, and ratings.

## Run it (one command)

```bash
cd server
npm install
npm run seed     # loads 3 sample creators — login any with password: password123
npm run dev       # serves the API AND the web app together at http://localhost:4000
```

Open http://localhost:4000 in a browser (desktop or mobile — it's responsive) and use the app.
Create a business account, browse the seeded creators, and run the whole flow for real.

## What's genuinely real
- Full auth: bcrypt password hashing, JWT sessions
- Real SQLite database (`server/src/db/younic.db`), not mock arrays
- The complete booking state machine enforced server-side, including:
  - negotiation capped at exactly 3 rounds (rejects a 4th, verified by test)
  - identities locked (`reveal` endpoint returns 403) until escrow is paid (verified by test)
  - contact-info regex filter strips phone/email/handles from pre-unlock messages (verified by test)
  - commission math computed server-side at payout
- Frontend calls the real API over `fetch()` — no mock data anywhere in `web/index.html`

## What's stubbed (and exactly where to swap it)
See `server/README.md` — every stubbed integration point (SMS/email delivery, payment
gateway, payout API, subscription billing) is marked with a `dev_note` in its own API response
and documented there with which real provider to wire in.

## Structure
```
server/   Express + SQLite API — the real backend
web/      Static HTML/CSS/JS client, calls the API via fetch()
```

## Next real steps (in order)
1. Swap phone OTP delivery for a real SMS provider (Twilio Verify / MSG91).
2. Swap email OTP delivery for a real transactional email provider (SendGrid / Postmark / SES).
3. Swap the escrow "instant hold" for real Razorpay Route order creation + webhook.
4. Move SQLite to Postgres (schema is plain SQL, translates directly) once you need multi-instance
   deployment.
5. Wrap the web client in React Native (or Capacitor, for a faster port of this exact HTML/JS) to
   get an installable mobile app — that's a separate build, not a config flag.
