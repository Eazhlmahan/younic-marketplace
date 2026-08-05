import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { filterContactInfo } from '../lib/contactFilter.js';

const router = Router();
const COMMISSION_PCT = 0.15;
const MAX_NEGOTIATION_ROUNDS = 3;

function getBooking(id) {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}
function assertParty(booking, userId) {
  return booking.business_id === userId || booking.creator_id === userId;
}

// POST /briefs { niche, budget, deliverable }
router.post('/briefs', requireAuth, (req, res) => {
  if (req.user.role !== 'business') return res.status(403).json({ error: 'Businesses only' });
  const { niche, budget, deliverable } = req.body;
  const id = uuid();
  db.prepare(`INSERT INTO briefs (id, business_id, niche, budget, deliverable) VALUES (?,?,?,?,?)`)
    .run(id, req.user.id, niche, budget, deliverable);
  res.status(201).json({ id });
});

router.get('/briefs', (req, res) => {
  const rows = db.prepare(`SELECT id, niche, budget, deliverable, status FROM briefs WHERE status = 'open'`).all();
  res.json({ briefs: rows });
});

// POST /bookings { creator_anon_id, deliverable, price, deadline, brief_id? }
router.post('/bookings', requireAuth, (req, res) => {
  if (req.user.role !== 'business') return res.status(403).json({ error: 'Only businesses can start a booking request' });
  const { creator_anon_id, deliverable, price, deadline, brief_id } = req.body;
  const creator = db.prepare(`SELECT id FROM users WHERE anon_id = ? AND role = 'creator'`).get(creator_anon_id);
  if (!creator) return res.status(404).json({ error: 'Creator not found' });

  const id = uuid();
  db.prepare(`INSERT INTO bookings (id, brief_id, business_id, creator_id, deliverable, deadline, agreed_price, status)
              VALUES (?,?,?,?,?,?,?, 'negotiating')`)
    .run(id, brief_id || null, req.user.id, creator.id, deliverable, deadline, price);

  db.prepare(`INSERT INTO counter_offers (id, booking_id, offered_by, price, timeline_days, round)
              VALUES (?,?,?,?,?,1)`)
    .run(uuid(), id, 'business', price, parseInt(deadline) || 7);

  res.status(201).json({ id, status: 'negotiating' });
});

// GET /bookings/:id — status + counter-offer history (still anonymized)
router.get('/bookings/:id', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const offers = db.prepare(`SELECT offered_by, price, timeline_days, round, created_at
                              FROM counter_offers WHERE booking_id = ? ORDER BY id`).all(b.id);
  const identityUnlocked = ['identity_unlocked', 'delivered', 'approved', 'paid_out'].includes(b.status);
  const creator = db.prepare('SELECT anon_id FROM users WHERE id = ?').get(b.creator_id);
  const business = db.prepare('SELECT anon_id FROM users WHERE id = ?').get(b.business_id);
  res.json({
    booking: { ...b, creator_anon: creator ? creator.anon_id : null, business_anon: business ? business.anon_id : null },
    offers, identity_unlocked: identityUnlocked,
  });
});

// POST /bookings/:id/counter { price, timeline_days }
router.post('/bookings/:id/counter', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'negotiating') return res.status(400).json({ error: `Cannot counter — booking is ${b.status}` });

  const lastRound = db.prepare(`SELECT MAX(round) as r FROM counter_offers WHERE booking_id = ?`).get(b.id).r || 0;
  if (lastRound >= MAX_NEGOTIATION_ROUNDS) {
    return res.status(400).json({ error: 'Negotiation round limit reached — accept or withdraw.' });
  }
  const { price, timeline_days } = req.body;
  const role = req.user.id === b.business_id ? 'business' : 'creator';
  db.prepare(`INSERT INTO counter_offers (id, booking_id, offered_by, price, timeline_days, round)
              VALUES (?,?,?,?,?,?)`)
    .run(uuid(), b.id, role, price, timeline_days, lastRound + 1);
  db.prepare(`UPDATE bookings SET agreed_price = ? WHERE id = ?`).run(price, b.id);
  res.json({ round: lastRound + 1, price });
});

// POST /bookings/:id/accept — accepts the latest offer, locks price, moves to confirmed
router.post('/bookings/:id/accept', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'negotiating') return res.status(400).json({ error: `Cannot accept — booking is ${b.status}` });
  db.prepare(`UPDATE bookings SET status = 'confirmed' WHERE id = ?`).run(b.id);
  res.json({ status: 'confirmed', agreed_price: b.agreed_price });
});

// POST /bookings/:id/withdraw
router.post('/bookings/:id/withdraw', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE bookings SET status = 'refunded' WHERE id = ?`).run(b.id);
  res.json({ status: 'refunded' });
});

// POST /bookings/:id/escrow/pay — simulated payment hold.
// Swap the "instant success" block for a real Razorpay Route / Cashfree Payouts
// order-creation + webhook-confirmation flow in production.
router.post('/bookings/:id/escrow/pay', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || b.business_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'confirmed') return res.status(400).json({ error: `Cannot pay — booking is ${b.status}` });

  const escrowId = uuid();
  db.prepare(`INSERT INTO escrow_transactions (id, booking_id, amount, commission_pct, gateway_ref, status)
              VALUES (?,?,?,?,?, 'held')`)
    .run(escrowId, b.id, b.agreed_price, COMMISSION_PCT, `SIMULATED-${escrowId.slice(0, 8)}`);

  // Identity unlocks the moment escrow is confirmed held — this is the enforcement point.
  db.prepare(`UPDATE bookings SET status = 'identity_unlocked' WHERE id = ?`).run(b.id);
  res.json({ status: 'identity_unlocked', escrow_id: escrowId, dev_note: 'Payment simulated — wire a real gateway here.' });
});

// GET /bookings/:id/reveal — only returns real identity if escrow is held+
router.get('/bookings/:id/reveal', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const unlocked = ['identity_unlocked', 'delivered', 'approved', 'paid_out'].includes(b.status);
  if (!unlocked) return res.status(403).json({ error: 'Identities are locked until escrow payment clears.' });

  const otherId = req.user.id === b.business_id ? b.creator_id : b.business_id;
  const other = db.prepare('SELECT real_name, phone, email FROM users WHERE id = ?').get(otherId);
  res.json({ real_name: other.real_name, phone: other.phone, email: other.email });
});

// POST /bookings/:id/messages { body } — filtered until unlocked
router.post('/bookings/:id/messages', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const unlocked = ['identity_unlocked', 'delivered', 'approved', 'paid_out'].includes(b.status);
  const { body } = req.body;
  const { clean, flagged } = unlocked ? { clean: body, flagged: false } : filterContactInfo(body);
  const id = uuid();
  db.prepare(`INSERT INTO messages (id, booking_id, sender_id, body, filtered) VALUES (?,?,?,?,?)`)
    .run(id, b.id, req.user.id, clean, flagged ? 1 : 0);
  res.status(201).json({ id, body: clean, filtered: flagged });
});

router.get('/bookings/:id/messages', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  const msgs = db.prepare(`SELECT sender_id, body, filtered, created_at FROM messages WHERE booking_id = ? ORDER BY id`).all(b.id);
  res.json({ messages: msgs });
});

// POST /bookings/:id/deliverables { file_url }
router.post('/bookings/:id/deliverables', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || b.creator_id !== req.user.id) return res.status(403).json({ error: 'Only the assigned creator can deliver' });
  if (b.status !== 'identity_unlocked') return res.status(400).json({ error: `Cannot deliver — booking is ${b.status}` });

  const id = uuid();
  db.prepare(`INSERT INTO deliverables (id, booking_id, file_url) VALUES (?,?,?)`).run(id, b.id, req.body.file_url);
  db.prepare(`UPDATE bookings SET status = 'delivered' WHERE id = ?`).run(b.id);
  res.status(201).json({ id, status: 'delivered' });
});

// POST /bookings/:id/approve — triggers simulated payout
router.post('/bookings/:id/approve', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || b.business_id !== req.user.id) return res.status(403).json({ error: 'Only the business can approve' });
  if (b.status !== 'delivered') return res.status(400).json({ error: `Cannot approve — booking is ${b.status}` });

  db.prepare(`UPDATE deliverables SET approved_at = CURRENT_TIMESTAMP WHERE booking_id = ?`).run(b.id);
  db.prepare(`UPDATE escrow_transactions SET status = 'released', released_at = CURRENT_TIMESTAMP WHERE booking_id = ?`).run(b.id);
  db.prepare(`UPDATE bookings SET status = 'paid_out' WHERE id = ?`).run(b.id);
  db.prepare(`UPDATE creator_profiles SET completed_deals = completed_deals + 1 WHERE user_id = ?`).run(b.creator_id);

  const commission = Math.round(b.agreed_price * COMMISSION_PCT);
  res.json({ status: 'paid_out', payout_to_creator: b.agreed_price - commission, commission, dev_note: 'Payout simulated — wire a real payout API here.' });
});

// POST /bookings/:id/dispute { reason }
router.post('/bookings/:id/dispute', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  db.prepare(`UPDATE bookings SET status = 'disputed' WHERE id = ?`).run(b.id);
  res.json({ status: 'disputed' });
});

// POST /bookings/:id/rate { score, comment }
router.post('/bookings/:id/rate', requireAuth, (req, res) => {
  const b = getBooking(req.params.id);
  if (!b || !assertParty(b, req.user.id)) return res.status(404).json({ error: 'Not found' });
  if (b.status !== 'paid_out') return res.status(400).json({ error: 'Can only rate completed bookings' });

  const rateeId = req.user.id === b.business_id ? b.creator_id : b.business_id;
  const { score, comment } = req.body;
  db.prepare(`INSERT INTO ratings (id, booking_id, rater_id, ratee_id, score, comment) VALUES (?,?,?,?,?,?)`)
    .run(uuid(), b.id, req.user.id, rateeId, score, comment || null);

  const avg = db.prepare(`SELECT AVG(score) as a FROM ratings WHERE ratee_id = ?`).get(rateeId).a;
  db.prepare(`UPDATE creator_profiles SET rating_avg = ? WHERE user_id = ?`).run(avg, rateeId);
  res.status(201).json({ rated: true });
});

// GET /bookings/mine — all bookings for the logged-in user
router.get('/bookings/mine/all', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM bookings WHERE business_id = ? OR creator_id = ? ORDER BY created_at DESC`)
    .all(req.user.id, req.user.id);
  const enriched = rows.map(b => {
    const creator = db.prepare('SELECT anon_id FROM users WHERE id = ?').get(b.creator_id);
    const business = db.prepare('SELECT anon_id FROM users WHERE id = ?').get(b.business_id);
    const myRole = req.user.id === b.business_id ? 'business' : 'creator';
    const other = myRole === 'business' ? creator : business;
    return { ...b, my_role: myRole, counterparty_anon: other ? other.anon_id : null };
  });
  res.json({ bookings: enriched });
});

export default router;
