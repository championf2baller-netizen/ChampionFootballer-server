const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'salman1209',
  password: process.env.DB_PASSWORD || 'Malik,g12',
});

async function main() {
  const userRes = await pool.query(`
    SELECT id, "firstName", "lastName", xp, achievements
    FROM users
    WHERE "firstName" ILIKE '%Muhib%' OR "firstName" ILIKE '%Ru%' OR "firstName" ILIKE '%Emdad%'
  `);

  console.table(userRes.rows);

  await pool.end();
}

main();
