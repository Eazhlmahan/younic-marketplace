import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Postgres connection pool. Connection string is provided by Railway as DATABASE_URL once
// a Postgres addon is attached — never hardcode a connection string here.
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Create tables on boot (idempotent). pg's simple query protocol executes multiple statements.
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
await pool.query(schema);

export default pool;