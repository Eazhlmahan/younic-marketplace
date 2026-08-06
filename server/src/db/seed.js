import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import db from './index.js';

const creators = [
  { anon: 'Creator #077', name: 'Aisha Khan', handle: '@aishakhan.style', url: 'https://instagram.com/aishakhan.style', niche: 'Streetwear / fashion', reach: 22000, eng: 3.4, tier: 'verified' },
  { anon: 'Creator #158', name: 'Rhea Malhotra', handle: '@rheasbeauty', url: 'https://instagram.com/rheasbeauty', niche: 'Fashion / beauty', reach: 90000, eng: 4.1, tier: 'verified' },
  { anon: 'Creator #204', name: 'Zoya Fernandes', handle: '@zoyalf', url: 'https://instagram.com/zoyalf', niche: 'Fashion / lifestyle', reach: 45000, eng: 3.8, tier: 'verified' },
];

const pw = bcrypt.hashSync('password123', 10);

for (const c of creators) {
  const exists = (await db.query('SELECT id FROM users WHERE anon_id = $1', [c.anon])).rows[0];
  if (exists) {
    // Idempotent backfill: keep canonical demo creators' identity fields populated.
    await db.query(`UPDATE users SET real_name = $1 WHERE anon_id = $2 AND (real_name IS NULL OR real_name = '')`,
      [c.name, c.anon]);
    await db.query(`UPDATE creator_profiles SET social_handle = $1, verified_account_url = $2
                    WHERE user_id = $3 AND (social_handle IS NULL OR social_handle = '')`,
      [c.handle, c.url, exists.id]);
    continue;
  }
  const id = uuid();
  await db.query(`INSERT INTO users (id, role, anon_id, email, password_hash, real_name, phone_verified, email_verified, tier)
                  VALUES ($1,'creator',$2,$3,$4,$5,true,true,$6)`,
    [id, c.anon, `${id.slice(0, 8)}@seed.younic.dev`, pw, c.name, c.tier]);
  await db.query(`INSERT INTO creator_profiles (user_id, niche, avg_reach, engagement_rate, completed_deals, rating_avg, social_handle, verified_account_url)
                  VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, c.niche, c.reach, c.eng, Math.floor(Math.random() * 20) + 3, Number((4 + Math.random()).toFixed(1)), c.handle, c.url]);
}

export async function seedDemoData() {
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM users');
  return Number(rows[0].n);
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  console.log(`Seeded ${creators.length} creators. Login any with password: password123`);
}
