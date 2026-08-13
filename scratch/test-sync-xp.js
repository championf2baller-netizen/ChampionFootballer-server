const { Sequelize } = require('sequelize');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const sequelize = new Sequelize(process.env.DATABASE_URL, { logging: false });

const { calculateAndAwardXPAchievements } = require('../src/utils/xpAchievementsEngine');
const { recalcUserTotalXP } = require('../src/utils/xpRecalc');
const models = require('../src/models').default;

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ DB Connected!');

    const userId = '40803381-fe6d-4854-9a0f-26ebb2fea67f';
    console.log('Running calculateAndAwardXPAchievements for user:', userId);
    await calculateAndAwardXPAchievements(userId);

    console.log('Running recalcUserTotalXP for user:', userId);
    const newXP = await recalcUserTotalXP(userId);

    const user = await models.User.findByPk(userId);
    console.log('User achievements:', user.achievements);
    console.log('Updated user total XP:', newXP);

  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

main();
