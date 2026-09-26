import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '.env') });

import sequelize from './src/config/database';
import { calculateAndAwardXPAchievements } from './src/utils/xpAchievementsEngine';
import User from './src/models/User';

async function main() {
  try {
    await sequelize.authenticate();
    console.log('DB Connected successfully.');

    // Fetch all users who have matches in Season 8 FNF
    const fnfLeagueId = '9099ab43-1fce-45f5-b31d-02c4b9dcf317';
    const users: any = await sequelize.query(
      `SELECT DISTINCT user_id FROM match_statistics ms
       JOIN "Matches" m ON ms.match_id::text = m.id::text
       WHERE m."leagueId" = :leagueId`,
      { replacements: { leagueId: fnfLeagueId }, type: (sequelize as any).QueryTypes.SELECT }
    );

    console.log(`Found ${users.length} users with stats in Season 8 FNF. Recalculating achievements...`);

    for (const u of users) {
      const uid = String(u.user_id);
      console.log(`Syncing achievements for user ${uid}...`);
      await calculateAndAwardXPAchievements(uid, fnfLeagueId);
    }

    console.log('✅ Achievement sync completed for Season 8 FNF users.');
  } catch (err) {
    console.error('Error during achievement sync:', err);
  } finally {
    await sequelize.close();
  }
}

main();
