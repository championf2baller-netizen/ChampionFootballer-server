const { Pool } = require('pg');
require('dotenv').config({ path: './championfootballerserver/.env' });

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

async function run() {
  try {
    const res = await pool.query(`SELECT id, email, "firstName", "lastName", position, "positionType", style, xp FROM users WHERE "firstName" ILIKE 'Ru%'`);
    console.log('ALL RU USERS:', res.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
