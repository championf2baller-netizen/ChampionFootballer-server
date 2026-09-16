const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DB_NAME || 'championfootballer', process.env.DB_USER || 'postgres', process.env.DB_PASSWORD || 'postgres', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  dialect: 'postgres',
  logging: false
});

async function run() {
  const [matches] = await sequelize.query(`
    SELECT id, status, deleted, archived FROM "Matches" 
    WHERE "leagueId" = 'db89ba14-fc77-4076-a5d7-d2f77925688b'
  `);
  console.log('Matches of again testing 1:');
  console.table(matches);

  await sequelize.close();
}

run().catch(console.error);
