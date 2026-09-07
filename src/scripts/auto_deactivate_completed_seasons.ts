import sequelize from '../config/database';
import { Op } from 'sequelize';
import Season from '../models/Season';
import Match from '../models/Match';
import League from '../models/League';
import '../models';
import { checkLastNMatchesStatsComplete } from '../utils/leagueCompletion';

async function main() {
  console.log('🚀 Starting Automatic Season Deactivation Check for Completed Seasons...');
  const startTime = Date.now();

  try {
    await sequelize.authenticate();
    console.log('✅ Database connected successfully.');

    // Find all active non-deleted seasons
    const activeSeasons = await Season.findAll({
      where: {
        isActive: true,
        deleted: false,
      },
      include: [{ model: League, as: 'league', attributes: ['id', 'name', 'maxGames'] }],
    });

    console.log(`Found ${activeSeasons.length} active seasons to inspect.`);

    let deactivatedCount = 0;
    const report: Array<{
      seasonId: string;
      seasonName: string;
      leagueName: string;
      completedMatches: number;
      maxGames: number;
    }> = [];

    for (const season of activeSeasons) {
      const maxGames = Number(season.maxGames ?? (season as any).league?.maxGames ?? 0);
      if (maxGames <= 0) continue;

      const completedCount = await Match.count({
        where: {
          seasonId: season.id,
          status: { [Op.in]: ['RESULT_PUBLISHED', 'RESULT_UPLOADED'] },
          archived: { [Op.ne]: true },
          deleted: { [Op.ne]: true },
        },
      });

      if (completedCount >= maxGames) {
        const statsCheck = await checkLastNMatchesStatsComplete(season.id, 1);
        if (!statsCheck.allComplete) {
          console.log(`⏳ Season "${season.name}" (${season.id}) reached max games (${completedCount}/${maxGames}) but missing stats from ${statsCheck.missingPlayerIds.length} players. Waiting for stats before deactivating.`);
          continue;
        }

        season.isActive = false;
        if (!season.endDate) season.endDate = new Date();
        await season.save();
        deactivatedCount++;

        const leagueName = (season as any).league?.name || season.leagueId;
        report.push({
          seasonId: season.id,
          seasonName: season.name,
          leagueName,
          completedMatches: completedCount,
          maxGames,
        });

        console.log(
          `🔒 [Auto-Deactivated] Season "${season.name}" (${season.id}) in League "${leagueName}" | Completed Matches: ${completedCount}/${maxGames} with all stats submitted.`
        );
      }
    }

    console.log('\n==================================================');
    console.log(`🎉 Auto-Deactivation Check Completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    console.log(`Total Active Seasons Inspected: ${activeSeasons.length}`);
    console.log(`Total Seasons Auto-Deactivated: ${deactivatedCount}`);
    console.log('==================================================\n');

    if (report.length > 0) {
      console.log('Summary of Auto-Deactivated Seasons:');
      console.table(report);
    } else {
      console.log('All active seasons are within their match limits.');
    }
  } catch (error) {
    console.error('❌ Auto-Deactivation Check Failed:', error);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

main();
