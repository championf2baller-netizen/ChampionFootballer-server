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

// Import sequelize models via ts-node / node require from built dist or ts-node
async function main() {
  const userId = '8c732c9f-fe40-41bb-9869-5d8d250f900a'; // Muhib User

  const beforeUser = await pool.query(`SELECT id, "firstName", "lastName", xp, achievements FROM users WHERE id = $1`, [userId]);
  console.log('BEFORE:', beforeUser.rows[0]);

  // Let's run the TypeScript recalculation using ts-node
  await pool.end();
}

main();
