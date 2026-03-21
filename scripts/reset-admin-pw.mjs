import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

const newHash = await bcrypt.hash('1111', 10);

const [result] = await conn.query(
  'UPDATE users SET passwordHash = ? WHERE username IN ("admin", "master")',
  [newHash]
);

console.log(`Updated ${result.affectedRows} rows`);

// 검증
const [rows] = await conn.query(
  'SELECT username, passwordHash FROM users WHERE username IN ("admin", "master")'
);
for (const r of rows) {
  const ok = await bcrypt.compare('1111', r.passwordHash);
  console.log(`${r.username}: 1111 match = ${ok}`);
}

await conn.end();
