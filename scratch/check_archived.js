const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DB_NAME || 'championfootballer', process.env.DB_USER || 'postgres', process.env.DB_PASSWORD || 'postgres', {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  dialect: 'postgres',
  logging: false
});

async function check() {
  const [seasons] = await sequelize.query(`SELECT id, "leagueId", "seasonNumber", name, "isActive", archived, deleted FROM "Seasons" ORDER BY "createdAt" DESC LIMIT 15`);
  console.log('Recent 15 seasons:');
  console.table(seasons);

  const [matches] = await sequelize.query(`SELECT id, "leagueId", "seasonId", status, deleted, archived FROM "Matches" ORDER BY "createdAt" DESC LIMIT 15`);
  console.log('Recent 15 matches:');
  console.table(matches);

  const [archivedSeasons] = await sequelize.query(`SELECT * FROM "Seasons" WHERE archived = true OR "isActive" = false`);
  console.log('Inactive or archived seasons count:', archivedSeasons.length);
}

check().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
