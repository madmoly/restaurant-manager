import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(
  'SELECT id, username, name, role, passwordHash FROM users WHERE username IN ("admin", "master") ORDER BY id'
);

for (const r of rows) {
  const has = !!r.passwordHash;
  const len = r.passwordHash?.length;
  const start = r.passwordHash?.substring(0, 7);
  // 1111로 검증
  let match1111 = false;
  if (r.passwordHash) {
    match1111 = await bcrypt.compare('1111', r.passwordHash);
  }
  // admin1234로 검증
  let matchAdmin = false;
  if (r.passwordHash) {
    matchAdmin = await bcrypt.compare('admin1234', r.passwordHash);
  }
  console.log(JSON.stringify({ username: r.username, role: r.role, hasHash: has, len, start, match1111, matchAdmin }));
}

await conn.end();
