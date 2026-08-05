import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH
  ? process.env.DATABASE_PATH
  : path.join(__dirname, 'younic.db');

if (path.dirname(dbPath) !== '.' && !fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Idempotent migrations for existing databases (CREATE TABLE IF NOT EXISTS won't add columns).
function addColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
addColumn('users', 'public_name', 'public_name TEXT');
addColumn('creator_profiles', 'social_handle', 'social_handle TEXT');
addColumn('creator_profiles', 'verified_account_url', 'verified_account_url TEXT');

export default db;
