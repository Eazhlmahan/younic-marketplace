import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db/index.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();
const TIERS = { starter: 2999, growth: 4999, scale: 7999 };

// POST /subscriptions { tier } — simulated billing. Swap for real gateway recurring billing.
router.post('/subscriptions', requireAuth, (req, res) => {
  if (req.user.role !== 'business') return res.status(403).json({ error: 'Businesses only' });
  const { tier } = req.body;
  if (!TIERS[tier]) return res.status(400).json({ error: 'tier must be starter, growth, or scale' });

  const id = uuid();
  const renews_at = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`INSERT INTO subscriptions (id, business_id, tier, status, renews_at) VALUES (?,?,?, 'active', ?)`)
    .run(id, req.user.id, tier, renews_at);
  res.status(201).json({ id, tier, monthly_price: TIERS[tier], renews_at, dev_note: 'Billing simulated — wire a real recurring payment here.' });
});

router.get('/subscriptions/me', requireAuth, (req, res) => {
  const row = db.prepare(`SELECT * FROM subscriptions WHERE business_id = ? ORDER BY id DESC LIMIT 1`).get(req.user.id);
  res.json({ subscription: row || null });
});

export default router;
