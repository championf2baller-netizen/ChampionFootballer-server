const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Sequelize } = require('sequelize');

const databaseUrl = process.env.DATABASE_URL;

const { calculateAndAwardXPAchievements } = require('./dist/utils/xpAchievementsEngine');

async function main() {
  console.log('Running calculateAndAwardXPAchievements for Muhib User...');
  await calculateAndAwardXPAchievements('8c732c9f-fe40-41bb-9869-5d8d250f900a');
  console.log('Finished!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
