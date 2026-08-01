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
    // Check all users named Ru or Uddin or Soyef or Alim or Minhaz
    const users = await pool.query(`
      SELECT id, "firstName", "lastName", position, "positionType", style 
      FROM users 
      WHERE "firstName" ILIKE '%Ru%' OR "lastName" ILIKE '%Uddin%' OR "firstName" ILIKE '%Soyef%' OR "firstName" ILIKE '%Alim%' OR "firstName" ILIKE '%Minhaz%'
    `);
    console.log('USERS FOUND:', users.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
run();
