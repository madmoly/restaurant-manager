import 'dotenv/config';
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// 1. requirementType
try {
  await conn.query(`ALTER TABLE store_checklist_templates ADD COLUMN requirementType ENUM('none','text_input','camera_photo') NOT NULL DEFAULT 'none' AFTER itemText`);
  console.log('OK: requirementType column added');
} catch(e) {
  if (e.code === 'ER_DUP_FIELDNAME') console.log('SKIP: requirementType already exists');
  else throw e;
}

// 2. checkedItems
try {
  await conn.query(`ALTER TABLE daily_checklist_logs ADD COLUMN checkedItems JSON DEFAULT (JSON_ARRAY()) AFTER checkedItemIds`);
  console.log('OK: checkedItems column added');
} catch(e) {
  if (e.code === 'ER_DUP_FIELDNAME') console.log('SKIP: checkedItems already exists');
  else throw e;
}

const [cols1] = await conn.query('SHOW COLUMNS FROM store_checklist_templates');
console.log('templates:', cols1.map(c => c.Field).join(', '));

const [cols2] = await conn.query('SHOW COLUMNS FROM daily_checklist_logs');
console.log('logs:', cols2.map(c => c.Field).join(', '));

await conn.end();
console.log('Migration complete');
