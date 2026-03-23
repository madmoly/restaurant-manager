import 'dotenv/config';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const sqlFile = readFileSync('./drizzle/migrations/add_daily_ops_v2.sql', 'utf8');
const statements = sqlFile
  .split(';')
  .map(s => s.replace(/--.*$/gm, '').trim())
  .filter(s => s.length > 0);

for (const stmt of statements) {
  try {
    await conn.query(stmt);
    console.log('OK:', stmt.slice(0, 60) + '...');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') {
      console.log('SKIP (already exists):', stmt.slice(0, 60) + '...');
    } else if (e.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log('SKIP (table exists):', stmt.slice(0, 60) + '...');
    } else {
      console.error('ERROR:', e.message);
      console.error('SQL:', stmt.slice(0, 100));
    }
  }
}

await conn.end();
console.log('Migration v2 complete');
