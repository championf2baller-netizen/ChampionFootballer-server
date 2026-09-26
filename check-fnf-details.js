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

async function main() {
  const fnfLeagueId = '9099ab43-1fce-45f5-b31d-02c4b9dcf317'; // Season 8 FNF

  // Get all matches for this league sorted chronologically
  const matches = (await pool.query(`
    SELECT id, status, "homeTeamGoals", "awayTeamGoals", date, "createdAt"
    FROM "Matches"
    WHERE "leagueId" = $1
    ORDER BY date ASC, "createdAt" ASC;
  `, [fnfLeagueId])).rows;

  console.log(`Total Matches in Season 8 FNF: ${matches.length}`);
  console.table(matches.map((m, i) => ({ index: i + 1, id: m.id, status: m.status, score: `${m.homeTeamGoals}-${m.awayTeamGoals}`, date: m.date })));

  const matchIds = matches.map(m => m.id);

  // Fetch all stats for these matches
  const statsRes = await pool.query(`
    SELECT ms.match_id, ms.user_id, u."firstName", u."lastName", ms.goals, ms.assists
    FROM match_statistics ms
    JOIN users u ON ms.user_id = u.id
    WHERE ms.match_id::text = ANY($1::text[]);
  `, [matchIds]);

  // Group stats by user
  const userStats = {};
  statsRes.rows.forEach(r => {
    if (!userStats[r.user_id]) {
      userStats[r.user_id] = { name: `${r.firstName} ${r.lastName}`, matches: {} };
    }
    userStats[r.user_id].matches[r.match_id] = r.goals;
  });

  console.log('\n=== PLAYER STREAKS IN Season 8 FNF ===');
  Object.entries(userStats).forEach(([userId, data]) => {
    let maxGoalStreak = 0;
    let currentGoalStreak = 0;
    let publishedGoalStreak = 0;
    let maxPublishedGoalStreak = 0;

    matches.forEach(m => {
      const goals = data.matches[m.id];
      const played = goals !== undefined;
      const isGoal = Number(goals || 0) > 0;

      // Only count if played & scored goal
      if (played) {
        if (isGoal) {
          currentGoalStreak++;
          if (currentGoalStreak > maxGoalStreak) maxGoalStreak = currentGoalStreak;
        } else {
          currentGoalStreak = 0;
        }
      }

      // Check published only
      if (m.status === 'RESULT_PUBLISHED') {
        if (played) {
          if (isGoal) {
            publishedGoalStreak++;
            if (publishedGoalStreak > maxPublishedGoalStreak) maxPublishedGoalStreak = publishedGoalStreak;
          } else {
            publishedGoalStreak = 0;
          }
        }
      }
    });

    console.log(`Player: ${data.name.padEnd(20)} | Max Goal Streak (All): ${maxGoalStreak} | Max Goal Streak (Published Only): ${maxPublishedGoalStreak}`);
  });

  await pool.end();
}

main();
