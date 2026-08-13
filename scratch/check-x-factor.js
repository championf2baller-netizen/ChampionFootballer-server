const { Sequelize, QueryTypes } = require('sequelize');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false
});

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ DB Connected!');

    const matches = await sequelize.query(
      `SELECT id, "leagueId", status, "homeDefensiveImpactId", "awayDefensiveImpactId", "homeMentalityId", "awayMentalityId"
       FROM "Matches"
       WHERE "homeDefensiveImpactId" IS NOT NULL 
          OR "awayDefensiveImpactId" IS NOT NULL
          OR "homeMentalityId" IS NOT NULL
          OR "awayMentalityId" IS NOT NULL
       LIMIT 10`,
      { type: QueryTypes.SELECT }
    );

    console.log('Matches with picks:', JSON.stringify(matches, null, 2));

    const totalWithPicks = await sequelize.query(
      `SELECT COUNT(*) FROM "Matches"
       WHERE "homeDefensiveImpactId" IS NOT NULL 
          OR "awayDefensiveImpactId" IS NOT NULL
          OR "homeMentalityId" IS NOT NULL
          OR "awayMentalityId" IS NOT NULL`,
      { type: QueryTypes.SELECT }
    );
    console.log('Total matches with any Defensive Impact or Mentality pick:', totalWithPicks);

  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

main();
