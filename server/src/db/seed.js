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
  const exists = db.prepare('SELECT id FROM users WHERE anon_id = ?').get(c.anon);
  if (exists) continue;
  const id = uuid();
  db.prepare(`INSERT INTO users (id, role, anon_id, email, password_hash, real_name, phone_verified, email_verified, tier)
              VALUES (?, 'creator', ?, ?, ?, ?, 1, 1, ?)`)
    .run(id, c.anon, `${id.slice(0, 8)}@seed.younic.dev`, pw, c.name, c.tier);
  db.prepare(`INSERT INTO creator_profiles (user_id, niche, avg_reach, engagement_rate, completed_deals, rating_avg, social_handle, verified_account_url)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, c.niche, c.reach, c.eng, Math.floor(Math.random() * 20) + 3, (4 + Math.random()).toFixed(1), c.handle, c.url);
}

export function seedDemoData() {
  const count = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  return count;
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  console.log(`Seeded ${creators.length} creators. Login any with password: password123`);
}
