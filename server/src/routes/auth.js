import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { Resend } from 'resend';
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
  res.status(201).json({ token, user: await publicUser(user.rows[0]) });
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
  res.json({ token, user: await publicUser(user) });
});

// Sends the verification email via Resend. Requires RESEND_API_KEY env var.
// Delivery mode is chosen by the send handler:
//   - RESEND_FROM set (a domain verified in Resend) -> normal: the OTP goes to the real
//     recipient's address.
//   - No RESEND_FROM (no verified domain yet)       -> sandbox: Resend only allows emailing
//     the account owner, so the OTP is sent to RESEND_TEST_RECIPIENT (the account owner's
//     own address, e.g. eazhl2018@gmail.com) and the email body notes which user it's for.
//     Replace RESEND_FROM + RESEND_TEST_RECIPIENT with a verified-domain sender and remove
//     the sandbox handling once a domain is verified.
async function deliverEmailOtp(email, code, sandboxTo = null) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM || 'Younic <onboarding@resend.dev>';
  const to = sandboxTo || email;
  const sandboxNotice = sandboxTo
    ? '\n\n(Sandbox mode: no Resend domain verified yet, so this code was emailed to the account owner ' + sandboxTo + ' on behalf of ' + email + ' — set RESEND_FROM to a verified-domain address to send to real recipients.)'
    : '';
  const { error } = await resend.emails.send({
    from,
    to: [to],
    subject: 'Your Younic verification code',
    text: `Your Younic verification code is: ${code}.${sandboxNotice}`,
    html: `<p>Your Younic verification code is: <strong>${code}</strong>.</p>${sandboxNotice ? `<p style="font-size:12px;color:#666;">${sandboxNotice}</p>` : ''}`,
  });
  if (error) throw new Error(error.message);
}

// POST /auth/otp/send { channel: 'phone' | 'email' }
// Email is delivered for real via Resend when RESEND_API_KEY is set. The phone channel is
// still simulated (console log) until a real SMS provider is wired up. The code-generation,
// 5-minute expiry, and single-use consumption logic in otp_codes is unchanged. The dev
// console.log is kept as a fallback/debug log alongside the real send so codes remain
// visible in Railway's logs.
router.post('/otp/send', requireAuth, async (req, res) => {
  const channel = req.body.channel === 'email' ? 'email' : 'phone';
  const code = String(Math.floor(1000 + Math.random() * 9000));
  const id = uuid();
  const expires_at = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  await db.query(`INSERT INTO otp_codes (id, user_id, channel, code, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [id, req.user.id, channel, code, expires_at]);

  if (channel === 'email') {
    console.log(`[DEV EMAIL OTP] user ${req.user.id} code: ${code}`); // fallback/debug
    if (process.env.RESEND_API_KEY) {
      try {
        const { rows: userRows } = await db.query('SELECT email FROM users WHERE id = $1', [req.user.id]);
        const email = userRows[0] && userRows[0].email;
        if (!email) throw new Error('User has no email address');
        // Sandbox mode: without a verified Resend domain (RESEND_FROM) the provider only lets
        // us email the account owner, so deliver there when RESEND_TEST_RECIPIENT is set.
        const sandboxTo = !process.env.RESEND_FROM && process.env.RESEND_TEST_RECIPIENT
          ? process.env.RESEND_TEST_RECIPIENT
          : null;
        await deliverEmailOtp(email, code, sandboxTo);
        console.log(`[EMAIL OTP sent via Resend] user ${req.user.id}${sandboxTo ? ` (sandbox -> ${sandboxTo})` : ''}`);
      } catch (e) {
        console.error(`[EMAIL OTP send FAILED] user ${req.user.id}:`, e.message);
        return res.status(502).json({ error: "Couldn't send code, try again" });
      }
    } else {
      console.warn('[EMAIL] RESEND_API_KEY not set — OTP only logged to console');
    }
  } else {
    console.log(`[DEV SMS OTP] user ${req.user.id} code: ${code}`); // placeholder — wire real SMS here
  }
  res.json({ sent: true, channel, dev_note: `Email is delivered via Resend (${process.env.RESEND_FROM ? 'real sender' : process.env.RESEND_TEST_RECIPIENT ? 'sandbox -> account owner' : 'console-only'} mode). Phone channel still logs to console.` });
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
  // Email confirmation is the sole requirement for 'verified' tier. Phone verification is
  // optional — a user's number is stored at signup but never gates tier. To re-enable the
  // stricter flow, change this back to (u.phone_verified && u.email_verified).
  const tier = u.email_verified ? 'verified' : 'unverified';
  await db.query('UPDATE users SET tier = $1 WHERE id = $2', [tier, userId]);
}

router.get('/me', requireAuth, async (req, res) => {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
  res.json({ user: await publicUser(rows[0]) });
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
