import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import db from '../db/index.js';
import { signToken, requireAuth } from '../lib/auth.js';

const router = Router();

async function nextAnonId(role) {
  const prefix = role === 'business' ? 'Business' : 'Creator';
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM users WHERE role = $1', [role]);
  const n = Number(rows[0].n);
  const num = String(100 + n).padStart(3, '0');
  return `${prefix} #${num}`;
}

// POST /auth/signup { role, name, email, phone, password }
router.post('/signup', async (req, res) => {
  const { role, name, email, phone, password } = req.body;
  if (!role || !['business', 'creator'].includes(role)) return res.status(400).json({ error: 'role must be business or creator' });
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const existing = await db.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length) return res.status(409).json({ error: 'Email already registered' });

  const id = uuid();
  const anon_id = await nextAnonId(role);
  const password_hash = bcrypt.hashSync(password, 10);

  await db.query(`INSERT INTO users (id, role, anon_id, email, phone, password_hash, real_name)
                  VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, role, anon_id, email, phone || null, password_hash, name || null]);

  if (role === 'creator') {
    await db.query('INSERT INTO creator_profiles (user_id) VALUES ($1)', [id]);
  } else {
    await db.query('INSERT INTO business_profiles (user_id) VALUES ($1)', [id]);
  }

  const user = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  const token = signToken(user.rows[0]);
  res.status(201).json({ token, user: publicUser(user.rows[0]) });
});

// POST /auth/login { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken(user);
  res.json({ token, user: publicUser(user) });
});

// POST /auth/otp/send { channel: 'phone' | 'email' }
// Simulated: logs the code to the server console instead of sending a real SMS/email.
// Swap the console.log lines for a real SMS provider (MSG91, Twilio) and email provider
// (SendGrid, Postmark, AWS SES) in production — the code-generation/expiry/consume logic
// underneath is already correct and doesn't need to change.
router.post('/otp/send', requireAuth, async (req, res) => {
  const channel = req.body.channel === 'email' ? 'email' : 'phone';
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const id = uuid();
  const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await db.query(`INSERT INTO otp_codes (id, user_id, channel, code, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [id, req.user.id, channel, code, expires_at]);

  if (channel === 'email') {
    console.log(`[DEV EMAIL OTP] user ${req.user.id} code: ${code}`); // replace with real email send
  } else {
    console.log(`[DEV SMS OTP] user ${req.user.id} code: ${code}`); // replace with real SMS send
  }
  res.json({ sent: true, channel, dev_note: `Real deployments call a ${channel === 'email' ? 'transactional email' : 'SMS'} provider here instead of logging to console.` });
});

// POST /auth/otp/verify { channel, code }
router.post('/otp/verify', requireAuth, async (req, res) => {
  const channel = req.body.channel === 'email' ? 'email' : 'phone';
  const { code } = req.body;
  const { rows } = await db.query(`SELECT * FROM otp_codes WHERE user_id = $1 AND channel = $2 AND consumed = false
                                   ORDER BY id DESC LIMIT 1`, [req.user.id, channel]);
  const row = rows[0];
  if (!row) return res.status(400).json({ error: 'No pending code — request a new one' });
  if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Code expired' });
  if (row.code !== code) return res.status(400).json({ error: 'Incorrect code' });

  await db.query('UPDATE otp_codes SET consumed = true WHERE id = $1', [row.id]);
  const column = channel === 'email' ? 'email_verified' : 'phone_verified';
  await db.query(`UPDATE users SET ${column} = true WHERE id = $1`, [req.user.id]);
  await recomputeTier(req.user.id);
  res.json({ verified: true, channel });
});

async function recomputeTier(userId) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  const u = rows[0];
  const tier = (u.phone_verified && u.email_verified) ? 'verified' : 'unverified';
  await db.query('UPDATE users SET tier = $1 WHERE id = $2', [tier, userId]);
}

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  res.json({ user: publicUser(rows[0]) });
});

async function publicUser(u) {
  let social_handle = null, verified_account_url = null;
  if (u.role === 'creator') {
    const { rows } = await db.query('SELECT social_handle, verified_account_url FROM creator_profiles WHERE user_id = $1', [u.id]);
    if (rows[0]) { social_handle = rows[0].social_handle; verified_account_url = rows[0].verified_account_url; }
  }
  return {
    id: u.id, role: u.role, anon_id: u.anon_id, email: u.email, phone: u.phone,
    phone_verified: !!u.phone_verified, email_verified: !!u.email_verified,
    tier: u.tier, public_name: u.public_name, social_handle, verified_account_url,
  };
}

export default router;
