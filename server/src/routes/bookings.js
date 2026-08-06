import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { filterContactInfo } from '../lib/contactFilter.js';

const router = Router();
const COMMISSION_PCT = 0.15;
const MAX_NEGOTIATION_ROUNDS = 3;

async function getBooking(id) {
  const { rows } = await db.query('SELECT * FROM bookings WHERE id = $1', [id]);
  return rows[0] || null;
}
function assertParty(booking, userId) {
  return booking.business_id === userId || booking.creator_id === userId;
}

// Adds the counterpart's anonymized handle so listing rows stay privacy-safe
// (real name only shown on dedicated reveal endpoints).
async function enrichRow(b, userId) {
  const isCreatorViewing = userId === b.creator_id;
  const otherId = isCreatorViewing ? b.business_id : b.creator_id;
  const other = (await db.query('SELECT anon_id FROM users WHERE id = $1', [otherId])).rows[0];
  return { ...b, counterparty_anon: other ? other.anon_id : null };
}

// POST /briefs { niche, budget, deliverable }
router.post('/briefs', requireAuth, async (req, res) => {
  if (req.user.role !== 'business') return res.status(403).json({ error: 'Businesses only' });
  const { niche, budget, deliverable } = req.body;
  const id = uuid();
  await db.query(`INSERT INTO briefs (id, business_id, niche, budget, deliverable) VALUES ($1,$2,$3,$4,$5)`,
    [id, req.user.id, niche, budget, deliverable]);
  res.status(201).json({ id });
});

router.get('/briefs', async (req, res) => {
  const { rows } = await db.query(`SELECT id, niche, budget, deliverable, status FROM briefs WHERE status = 'open'`);
  res.json({ briefs: rows });
});

// POST /bookings { creator_anon_id, deliverable, price, deadline, brief_id? }
router.post('/bookings', requireAuth, async (req, res) => {
  if (req.user.role !== 'business') return res.status(403).json({ error: 'Only businesses can start a booking request' });
  const { creator_anon_id, deliverable, price, deadline, brief_id } = req.body;
  const { rows } = await db.query(`SELECT u.id, u.real_name, cp.social_handle, cp.verified_account_url
                                   FROM users u LEFT JOIN creator_profiles cp ON cp.user_id = u.id
                                   WHERE u.anon_id = $1 AND u.role = 'creator'`, [creator_anon_id]);
  const creator = rows[0];
  if (!creator) return res.status(404).json({ error: 'Creator not found' });

  const id = uuid();
  await db.query(`INSERT INTO bookings (id, brief_id, business_id, creator_id, deliverable, deadline, agreed_price, status)
                  VALUES ($1,$2,$3,$4,$5,$6,$7, 'negotiating')`,
    [id, brief_id || null, req.user.id, creator.id, deliverable, deadline, price]);

  await db.query(`INSERT INTO counter_offers (id, booking_id, offered_by, price, timeline_days, round)
                  VALUES ($1,$2,'business',$3,$4,1)`,
    [uuid(), id, price, parseInt(deadline) || 7]);

  // Identity reveals the moment a booking request is created — both sides see the
  // other's real name + verified public handle. Phone/email are never shared.
  res.status(201).json({
    id, status: 'negotiating',
    counterparty: {
      name: creator.real_name, handle: creator.social_handle, verified_account_url: creator.verified_account_url,
    },
  });
});

// GET /bookings/:id — status + counter-offer history + counterpart identity
router.get('/bookings/:id', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const { rows: offers } = await db.query(`SELECT offered_by, price, timeline_days, round, created_at
                                           FROM counter_offers WHERE booking_id = $1 ORDER BY id`, [b.id]);
  const identityUnlocked = ['identity_unlocked', 'delivered', 'approved', 'paid_out'].includes(b.status);
  const creator = (await db.query(`SELECT u.anon_id, u.real_name, cp.social_handle, cp.verified_account_url
                                   FROM users u LEFT JOIN creator_profiles cp ON cp.user_id = u.id WHERE u.id = $1`, [b.creator_id])).rows[0];
  const business = (await db.query('SELECT anon_id, public_name, real_name FROM users WHERE id = $1', [b.business_id])).rows[0];
  res.json({
    booking: {
      ...b,
      creator_anon: creator ? creator.anon_id : null,
      creator_name: creator ? creator.real_name : null,
      creator_handle: creator ? creator.social_handle : null,
      creator_verified_url: creator ? creator.verified_account_url : null,
      business_anon: business ? business.anon_id : null,
      business_name: business ? (business.public_name || business.real_name) : null,
    },
    offers, identity_unlocked: identityUnlocked,
  });
});

// POST /bookings/:id/counter { price, timeline_days }
router.post('/bookings/:id/counter', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'negotiating') return res.status(400).json({ error: `Cannot counter — booking is ${b.status}` });

  const lastRound = Number((await db.query(`SELECT MAX(round) AS r FROM counter_offers WHERE booking_id = $1`, [b.id])).rows[0].r) || 0;
  if (lastRound >= MAX_NEGOTIATION_ROUNDS) {
    return res.status(400).json({ error: 'Negotiation round limit reached — accept or withdraw.' });
  }
  const { price, timeline_days } = req.body;
  const role = req.user.id === b.business_id ? 'business' : 'creator';
  await db.query(`INSERT INTO counter_offers (id, booking_id, offered_by, price, timeline_days, round)
                  VALUES ($1,$2,$3,$4,$5,$6)`,
    [uuid(), b.id, role, price, timeline_days, lastRound + 1]);
  await db.query('UPDATE bookings SET agreed_price = $1 WHERE id = $2', [price, b.id]);
  res.json({ round: lastRound + 1, price });
});

// POST /bookings/:id/accept — accepts the latest offer, locks price, moves to confirmed
router.post('/bookings/:id/accept', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'negotiating') return res.status(400).json({ error: `Cannot accept — booking is ${b.status}` });
  await db.query(`UPDATE bookings SET status = 'confirmed' WHERE id = $1`, [b.id]);
  res.json({ status: 'confirmed', agreed_price: b.agreed_price });
});

// POST /bookings/:id/withdraw
router.post('/bookings/:id/withdraw', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  await db.query(`UPDATE bookings SET status = 'refunded' WHERE id = $1`, [b.id]);
  res.json({ status: 'refunded' });
});

// POST /bookings/:id/escrow/pay — simulated payment hold.
// Swap the "instant success" block for a real Razorpay Route / Cashfree Payouts
// order-creation + webhook-confirmation flow in production.
router.post('/bookings/:id/escrow/pay', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || b.business_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'confirmed') return res.status(400).json({ error: `Cannot pay — booking is ${b.status}` });

  const escrowId = uuid();
  await db.query(`INSERT INTO escrow_transactions (id, booking_id, amount, commission_pct, gateway_ref, status)
                  VALUES ($1,$2,$3,$4,$5, 'held')`,
    [escrowId, b.id, b.agreed_price, COMMISSION_PCT, `SIMULATED-${escrowId.slice(0, 8)}`]);

  // Escrow's job is purely to hold and release money based on delivery approval —
  // identity is already revealed at booking creation. This status just means "funded".
  await db.query(`UPDATE bookings SET status = 'identity_unlocked' WHERE id = $1`, [b.id]);
  res.json({ status: 'identity_unlocked', escrow_id: escrowId, dev_note: 'Payment simulated — wire a real gateway here.' });
});

// GET /bookings/:id/reveal — real name + verified public handle, available at any booking
// status the moment a booking exists. Phone/email are NEVER exposed here.
router.get('/bookings/:id/reveal', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });

  if (req.user.id === b.business_id) {
    const creator = (await db.query(`SELECT u.anon_id, u.real_name, cp.social_handle, cp.verified_account_url
                                     FROM users u LEFT JOIN creator_profiles cp ON cp.user_id = u.id WHERE u.id = $1`, [b.creator_id])).rows[0];
    return res.json({
      anon_id: creator.anon_id, name: creator.real_name,
      handle: creator.social_handle, verified_account_url: creator.verified_account_url,
    });
  }
  const business = (await db.query('SELECT anon_id, public_name, real_name FROM users WHERE id = $1', [b.business_id])).rows[0];
  res.json({
    anon_id: business.anon_id, name: business.public_name || business.real_name,
    handle: null, verified_account_url: null,
  });
});

// POST /bookings/:id/messages { body } — direct contact channels filtered at EVERY stage
router.post('/bookings/:id/messages', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const { body } = req.body;
  const { clean, flagged } = filterContactInfo(body);
  const id = uuid();
  await db.query(`INSERT INTO messages (id, booking_id, sender_id, body, filtered) VALUES ($1,$2,$3,$4,$5)`,
    [id, b.id, req.user.id, clean, flagged]);
  res.status(201).json({ id, body: clean, filtered: flagged });
});

router.get('/bookings/:id/messages', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const { rows: msgs } = await db.query(`SELECT sender_id, body, filtered, created_at FROM messages WHERE booking_id = $1 ORDER BY id`, [b.id]);
  res.json({ messages: msgs });
});

// POST /bookings/:id/deliverables { file_url }
router.post('/bookings/:id/deliverables', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || b.creator_id !== req.user.id) return res.status(403).json({ error: 'Only the assigned creator can deliver' });
  if (b.status !== 'identity_unlocked') return res.status(400).json({ error: `Cannot deliver — booking is ${b.status}` });

  const id = uuid();
  await db.query(`INSERT INTO deliverables (id, booking_id, file_url) VALUES ($1,$2,$3)`, [id, b.id, req.body.file_url]);
  await db.query(`UPDATE bookings SET status = 'delivered' WHERE id = $1`, [b.id]);
  res.status(201).json({ id, status: 'delivered' });
});

// POST /bookings/:id/approve — triggers simulated payout
router.post('/bookings/:id/approve', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || b.business_id !== req.user.id) return res.status(403).json({ error: 'Only the business can approve' });
  if (b.status !== 'delivered') return res.status(400).json({ error: `Cannot approve — booking is ${b.status}` });

  await db.query(`UPDATE deliverables SET approved_at = now() WHERE booking_id = $1`, [b.id]);
  await db.query(`UPDATE escrow_transactions SET status = 'released', released_at = now() WHERE booking_id = $1`, [b.id]);
  await db.query(`UPDATE bookings SET status = 'paid_out' WHERE id = $1`, [b.id]);
  await db.query(`UPDATE creator_profiles SET completed_deals = completed_deals + 1 WHERE user_id = $1`, [b.creator_id]);

  const commission = Math.round(b.agreed_price * COMMISSION_PCT);
  res.json({ status: 'paid_out', payout_to_creator: b.agreed_price - commission, commission, dev_note: 'Payout simulated — wire a real payout API here.' });
});

// POST /bookings/:id/dispute { reason }
router.post('/bookings/:id/dispute', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  await db.query(`UPDATE bookings SET status = 'disputed' WHERE id = $1`, [b.id]);
  res.json({ status: 'disputed' });
});

// POST /bookings/:id/rate { score, comment }
router.post('/bookings/:id/rate', requireAuth, async (req, res) => {
  const b = await getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'paid_out') return res.status(400).json({ error: 'Can only rate completed bookings' });

  const rateeId = req.user.id === b.business_id ? b.creator_id : b.business_id;
  const { score, comment } = req.body;
  await db.query(`INSERT INTO ratings (id, booking_id, rater_id, ratee_id, score, comment) VALUES ($1,$2,$3,$4,$5,$6)`,
    [uuid(), b.id, req.user.id, rateeId, score, comment || null]);

  const { rows } = await db.query('SELECT AVG(score) AS a FROM ratings WHERE ratee_id = $1', [rateeId]);
  const avg = Number(rows[0].a);
  await db.query(`UPDATE creator_profiles SET rating_avg = $1 WHERE user_id = $2`, [avg, rateeId]);
  res.status(201).json({ rated: true });
});

// GET /bookings/mine — all bookings for the logged-in user
router.get('/bookings/mine/all', requireAuth, async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM bookings WHERE business_id = $1 OR creator_id = $1 ORDER BY created_at DESC`, [req.user.id]);
  const enriched = [];
  for (const b of rows) {
    enriched.push(await enrichRow(b, req.user.id));
  }
  res.json({ bookings: enriched });
});

export default router;