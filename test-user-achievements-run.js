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

const { computeAchievementState, toAchievementMatchInput } = require('./dist/utils/achievementChecker');

async function main() {
  const userId = '8c732c9f-fe40-41bb-9869-5d8d250f900a'; // Muhib User

  // 1. Fetch user played matches
  const matchesRes = await pool.query(`
    SELECT DISTINCT m.id, m."leagueId", m."seasonId", m.status, m."homeTeamGoals", m."awayTeamGoals", m.date, m."createdAt",
           m."homeCaptainId", m."awayCaptainId", m."homeDefensiveImpactId", m."awayDefensiveImpactId", m."homeMentalityId", m."awayMentalityId"
    FROM "Matches" m
    WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
    ORDER BY m.date ASC, m."createdAt" ASC;
  `);

  const playedMatches = matchesRes.rows;
  const matchIds = playedMatches.map(m => String(m.id));

  // 2. Fetch Home & Away team user IDs
  const homeRows = (await pool.query(`SELECT "matchId"::text, "userId"::text FROM "UserHomeMatches" WHERE "matchId"::text = ANY($1::text[])`, [matchIds])).rows;
  const awayRows = (await pool.query(`SELECT "matchId"::text, "userId"::text FROM "UserAwayMatches" WHERE "matchId"::text = ANY($1::text[])`, [matchIds])).rows;
  const statsRows = (await pool.query(`SELECT match_id::text, user_id::text, goals, assists FROM match_statistics WHERE user_id::text = $1`, [userId])).rows;

  const homeMap = new Map();
  const awayMap = new Map();
  homeRows.forEach(r => {
    if (!homeMap.has(r.matchId)) homeMap.set(r.matchId, []);
    homeMap.get(r.matchId).push(r.userId);
  });
  awayRows.forEach(r => {
    if (!awayMap.has(r.matchId)) awayMap.set(r.matchId, []);
    awayMap.get(r.matchId).push(r.userId);
  });

  const statsByMatch = new Map();
  statsRows.forEach(r => {
    statsByMatch.set(String(r.match_id).toLowerCase(), { goals: Number(r.goals || 0), assists: Number(r.assists || 0) });
  });

  const achievementMatches = playedMatches.map(m => {
    const homeUsers = (homeMap.get(m.id) || []).map(id => ({ id }));
    const awayUsers = (awayMap.get(m.id) || []).map(id => ({ id }));
    return toAchievementMatchInput({
      ...m,
      homeTeamUsers: homeUsers,
      awayTeamUsers: awayUsers,
    });
  });

  const computed = computeAchievementState(userId, achievementMatches, statsByMatch);
  console.log('--- COMPUTED BADGES FOR MUHIB USER ---');
  console.log(JSON.stringify(computed.badges, null, 2));

  await pool.end();
}

main();
