import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import db from '../db/index.js';
import { signToken, requireAuth } from '../lib/auth.js';

const router = Router();

function nextAnonId(role) {
  const prefix = role === 'business' ? 'Business' : 'Creator';
  const row = db.prepare('SELECT COUNT(*) as n FROM users WHERE role = ?').get(role);
  const num = String(100 + row.n).padStart(3, '0');
  return `${prefix} #${num}`;
}

// POST /auth/signup { role, name, email, phone, password }
router.post('/signup', (req, res) => {
  const { role, name, email, phone, password } = req.body;
  if (!role || !['business', 'creator'].includes(role)) return res.status(400).json({ error: 'role must be business or creator' });
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const id = uuid();
  const anon_id = nextAnonId(role);
  const password_hash = bcrypt.hashSync(password, 10);

  db.prepare(`INSERT INTO users (id, role, anon_id, email, phone, password_hash, real_name)
              VALUES (?,?,?,?,?,?,?)`)
    .run(id, role, anon_id, email, phone || null, password_hash, name || null);

  if (role === 'creator') {
    db.prepare('INSERT INTO creator_profiles (user_id) VALUES (?)').run(id);
  } else {
    db.prepare('INSERT INTO business_profiles (user_id) VALUES (?)').run(id);
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  const token = signToken(user);
  res.status(201).json({ token, user: publicUser(user) });
});

// POST /auth/login { email, password }
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
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
router.post('/otp/send', requireAuth, (req, res) => {
  const channel = req.body.channel === 'email' ? 'email' : 'phone';
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const id = uuid();
  const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO otp_codes (id, user_id, channel, code, expires_at) VALUES (?,?,?,?,?)')
    .run(id, req.user.id, channel, code, expires_at);

  if (channel === 'email') {
    console.log(`[DEV EMAIL OTP] user ${req.user.id} code: ${code}`); // replace with real email send
  } else {
    console.log(`[DEV SMS OTP] user ${req.user.id} code: ${code}`); // replace with real SMS send
  }
  res.json({ sent: true, channel, dev_note: `Real deployments call a ${channel === 'email' ? 'transactional email' : 'SMS'} provider here instead of logging to console.` });
});

// POST /auth/otp/verify { channel, code }
router.post('/otp/verify', requireAuth, (req, res) => {
  const channel = req.body.channel === 'email' ? 'email' : 'phone';
  const { code } = req.body;
  const row = db.prepare(`SELECT * FROM otp_codes WHERE user_id = ? AND channel = ? AND consumed = 0
                           ORDER BY id DESC LIMIT 1`).get(req.user.id, channel);
  if (!row) return res.status(400).json({ error: 'No pending code — request a new one' });
  if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Code expired' });
  if (row.code !== code) return res.status(400).json({ error: 'Incorrect code' });

  db.prepare('UPDATE otp_codes SET consumed = 1 WHERE id = ?').run(row.id);
  const column = channel === 'email' ? 'email_verified' : 'phone_verified';
  db.prepare(`UPDATE users SET ${column} = 1 WHERE id = ?`).run(req.user.id);
  recomputeTier(req.user.id);
  res.json({ verified: true, channel });
});

function recomputeTier(userId) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const tier = (u.phone_verified && u.email_verified) ? 'verified' : 'unverified';
  db.prepare('UPDATE users SET tier = ? WHERE id = ?').run(tier, userId);
}

router.get('/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

function publicUser(u) {
  let social_handle = null, verified_account_url = null;
  if (u.role === 'creator') {
    const cp = db.prepare('SELECT social_handle, verified_account_url FROM creator_profiles WHERE user_id = ?').get(u.id);
    if (cp) { social_handle = cp.social_handle; verified_account_url = cp.verified_account_url; }
  }
  return {
    id: u.id, role: u.role, anon_id: u.anon_id, email: u.email, phone: u.phone,
    phone_verified: !!u.phone_verified, email_verified: !!u.email_verified,
    tier: u.tier, public_name: u.public_name, social_handle, verified_account_url,
  };
}

export default router;
