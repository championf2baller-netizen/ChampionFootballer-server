import sequelize from '../config/database';
import { calculateAndAwardXPAchievements } from '../utils/xpAchievementsEngine';
import { recalcUserTotalXP } from '../utils/xpRecalc';
import User from '../models/User';
import '../models';

async function main() {
  console.log('🚀 Starting Fast Parallel Recalculation of Achievements & XP for All Registered Players...');
  const startTime = Date.now();

  try {
    await sequelize.authenticate();
    console.log('✅ Database connected successfully.');

    // Fetch all user records via User model
    const userRows = await User.findAll({
      attributes: ['id'],
      raw: true,
    });

    const activeUserIds = (userRows as any[])
      .map((r) => String(r.id || ''))
      .filter((id) => id !== '' && !id.startsWith('guest-'));

    console.log(`Found ${activeUserIds.length} registered players to recalculate.`);

    let updatedCount = 0;
    const report: Array<{
      id: string;
      name: string;
      oldXp: number;
      newXp: number;
      oldXFactorCount: number;
      newXFactorCount: number;
    }> = [];

    const batchSize = 25;
    for (let i = 0; i < activeUserIds.length; i += batchSize) {
      const batchIds = activeUserIds.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(activeUserIds.length / batchSize)} (${batchIds.length} users)...`);

      await Promise.all(
        batchIds.map(async (userId) => {
          try {
            const user = await User.findByPk(userId, { attributes: ['id', 'firstName', 'lastName', 'xp', 'achievements'] });
            if (!user) return;

            const oldXp = Number(user.xp || 0);
            const oldAch: string[] = Array.isArray(user.achievements) ? (user.achievements as string[]) : [];
            const oldXFactorCount = oldAch.filter((id) => id === 'captain_performance_3').length;

            // Recalculate achievements for this user
            await calculateAndAwardXPAchievements(userId);
            // Recalculate total XP (stats + achievements)
            const newXp = (await recalcUserTotalXP(userId)) ?? oldXp;

            // Reload updated user
            const updatedUser = await User.findByPk(userId, { attributes: ['id', 'xp', 'achievements'] });
            const newAch: string[] = Array.isArray(updatedUser?.achievements) ? (updatedUser!.achievements as string[]) : [];
            const newXFactorCount = newAch.filter((id) => id === 'captain_performance_3').length;

            if (oldXp !== newXp || oldXFactorCount !== newXFactorCount) {
              updatedCount++;
              const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || userId;
              report.push({
                id: userId,
                name,
                oldXp,
                newXp,
                oldXFactorCount,
                newXFactorCount,
              });

              console.log(
                `✨ Updated User: ${name} (${userId}) | XP: ${oldXp} → ${newXp} | X-Factor Badges: ${oldXFactorCount} → ${newXFactorCount}`
              );
            }
          } catch (err) {
            console.error(`Error processing user ${userId}:`, err);
          }
        })
      );
    }

    console.log('\n==================================================');
    console.log(`🎉 Recalculation Completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    console.log(`Total Registered Players Processed: ${activeUserIds.length}`);
    console.log(`Total Players Updated: ${updatedCount}`);
    console.log('==================================================\n');

    if (report.length > 0) {
      console.log('Summary of Updated Players:');
      console.table(report);
    } else {
      console.log('All registered players were already up to date.');
    }
  } catch (error) {
    console.error('❌ Recalculation Failed:', error);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

main();
