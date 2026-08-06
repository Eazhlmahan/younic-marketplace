import { Router } from 'express';
import db from '../db/index.js';
import { requireAuth } from '../lib/auth.js';

const router = Router();

// GET /creators?niche=&tier=  -> anonymized list for browsing
router.get('/creators', async (req, res) => {
  const { niche, tier } = req.query;
  let q = `SELECT u.anon_id, u.tier, cp.niche, cp.avg_reach, cp.engagement_rate,
                  cp.completed_deals, cp.rating_avg
           FROM users u JOIN creator_profiles cp ON cp.user_id = u.id
           WHERE u.role = 'creator'`;
  const params = [];
  if (niche) { q += ' AND cp.niche LIKE $' + (params.length + 1); params.push(`%${niche}%`); }
  if (tier) { q += ' AND u.tier = $' + (params.length + 1); params.push(tier); }
  const { rows } = await db.query(q, params);
  res.json({ creators: rows });
});

// GET /creators/:anon_id -> anonymized detail (no real_name/contact)
router.get('/creators/:anon_id', async (req, res) => {
  const { rows } = await db.query(`SELECT u.*, cp.* FROM users u JOIN creator_profiles cp ON cp.user_id = u.id
                                   WHERE u.anon_id = $1 AND u.role = 'creator'`, [req.params.anon_id]);
  const u = rows[0];
  if (!u) return res.status(404).json({ error: 'Creator not found' });
  const { rows: history } = await db.query(`SELECT r.score, r.comment, b.deliverable, ub.anon_id as rater_anon
                                            FROM ratings r
                                            JOIN bookings b ON b.id = r.booking_id
                                            JOIN users ub ON ub.id = r.rater_id
                                            WHERE r.ratee_id = $1`, [u.id]);
  res.json({
    anon_id: u.anon_id, tier: u.tier, niche: u.niche, avg_reach: u.avg_reach,
    engagement_rate: u.engagement_rate, portfolio_urls: JSON.parse(u.portfolio_urls || '[]'),
    completed_deals: u.completed_deals, rating_avg: u.rating_avg, history,
  });
});

// PATCH /creators/me — creator updates own profile
router.patch('/creators/me', requireAuth, async (req, res) => {
  if (req.user.role !== 'creator') return res.status(403).json({ error: 'Creators only' });
  const { niche, avg_reach, engagement_rate, portfolio_urls, social_handle, verified_account_url } = req.body;
  await db.query(`UPDATE creator_profiles SET niche=$1, avg_reach=$2, engagement_rate=$3, portfolio_urls=$4,
                  social_handle=$5, verified_account_url=$6
                  WHERE user_id = $7`,
    [niche, avg_reach || 0, engagement_rate || 0, JSON.stringify(portfolio_urls || []),
     social_handle || null, verified_account_url || null, req.user.id]);
  res.json({ updated: true });
});

// PATCH /businesses/me
router.patch('/businesses/me', requireAuth, async (req, res) => {
  if (req.user.role !== 'business') return res.status(403).json({ error: 'Businesses only' });
  const { industry, budget_range, gst_number, public_name } = req.body;
  await db.query(`UPDATE business_profiles SET industry=$1, budget_range=$2, gst_number=$3 WHERE user_id = $4`,
    [industry, budget_range, gst_number, req.user.id]);
  if (public_name) await db.query(`UPDATE users SET public_name = $1 WHERE id = $2`, [public_name, req.user.id]);
  res.json({ updated: true });
});

export default router;
