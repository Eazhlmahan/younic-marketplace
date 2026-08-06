import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import db from '../db/index.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();
const TIERS = ['starter', 'growth', 'scale'];

// POST /subscriptions { tier }
router.post('/subscriptions', requireAuth, async (req, res) => {
  if (req.user.role !== 'business') return res.status(403).json({ error: 'Businesses only' });
  const tier = TIERS.includes(req.body.tier) ? req.body.tier : 'starter';
  const now = new Date();
  const renews_at = new Date(now.getTime() + 30 * 86400000).toISOString();

  const existing = await db.query('SELECT id FROM subscriptions WHERE business_id = $1', [req.user.id]);
  if (existing.rows.length) {
    await db.query(`UPDATE subscriptions SET tier = $1, status = 'active', renews_at = $2 WHERE business_id = $3`,
      [tier, renews_at, req.user.id]);
    return res.json({ updated: true, tier, renews_at });
  }
  const id = uuid();
  await db.query(`INSERT INTO subscriptions (id, business_id, tier, status, renews_at) VALUES ($1,$2,$3,'active',$4)`,
    [id, req.user.id, tier, renews_at]);
  res.status(201).json({ id, tier, renews_at });
});

router.get('/subscriptions/me', requireAuth, async (req, res) => {
  if (req.user.role !== 'business') return res.status(403).json({ error: 'Businesses only' });
  const { rows } = await db.query('SELECT tier, status, renews_at FROM subscriptions WHERE business_id = $1', [req.user.id]);
  const current = rows[0] || { tier: 'starter', status: 'inactive', renews_at: null };
  res.json({ subscription: current });
});

export default router;