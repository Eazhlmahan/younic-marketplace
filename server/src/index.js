import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profiles.js';
import bookingRoutes from './routes/bookings.js';
import subscriptionRoutes from './routes/subscriptions.js';

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// Auto-seed demo creators on boot (idempotent — skips existing). Disable with SEED_ON_START=false.
if (process.env.SEED_ON_START !== 'false') {
  const { seedDemoData } = await import('./db/seed.js');
  if ((await seedDemoData()) === 0) console.log('Seeded demo creators. Login any with password: password123');
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/', profileRoutes);       // /creators, /businesses
app.use('/', bookingRoutes);       // /briefs, /bookings/*
app.use('/', subscriptionRoutes);  // /subscriptions

// Serve the web client (../../web) so `npm run dev` gives you the whole app at once.
app.use(express.static(path.join(__dirname, '../../web')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Younic API + web app running on http://localhost:${PORT}`));
