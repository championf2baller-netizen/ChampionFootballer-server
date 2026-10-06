const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME || 'championfootballer',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'postgres',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false
  }
);

async function run() {
  try {
    const [leagues] = await sequelize.query(`SELECT id, name FROM "Leagues" ORDER BY name`);
    console.log('Leagues found:', leagues);

    const [users] = await sequelize.query(`
      SELECT id, "firstName", "lastName", position, "positionType", xp
      FROM users
      WHERE position IS NOT NULL OR "positionType" IS NOT NULL
      ORDER BY xp DESC NULLS LAST
    `);
    console.log('Total users with position:', users.length);

    const lfs = users.filter(u => {
      const pos = `${u.positionType || ''} ${u.position || ''}`.toLowerCase();
      return pos.includes('lf') || pos.includes('left forward') || pos.includes('rf') || pos.includes('right forward');
    });

    console.log('LF/RF Users count:', lfs.length);
    console.log('LF/RF Users sample:', lfs.slice(0, 10));

  } catch (e) {
    console.error('Error:', e);
  } finally {
    await sequelize.close();
  }
}

run();
