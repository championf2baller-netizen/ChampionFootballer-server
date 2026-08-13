const { Sequelize, QueryTypes } = require('sequelize');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false
});

// Import models and utils from ts-node or compiled
const { computeAchievementState, toAchievementMatchInput } = require('../src/utils/achievementChecker');

async function main() {
  try {
    await sequelize.authenticate();
    console.log('✅ DB Connected!');

    const targetUserId = '40803381-fe6d-4854-9a0f-26ebb2fea67f'; // or 003c3874-fa1e-4a81-b0f8-55fdb53b1a1d

    // Query played matches for targetUserId
    const matches = await sequelize.query(
      `SELECT m.id, m."leagueId", m."homeTeamGoals", m."awayTeamGoals", m.date, m.start, m."createdAt",
              m."homeCaptainId", m."awayCaptainId",
              m."homeDefensiveImpactId", m."awayDefensiveImpactId",
              m."homeMentalityId", m."awayMentalityId"
       FROM "Matches" m
       JOIN match_statistics ms ON ms.match_id = m.id
       WHERE ms.user_id = :targetUserId
         AND m.status = 'RESULT_PUBLISHED'
       ORDER BY m.date ASC`,
      { replacements: { targetUserId }, type: QueryTypes.SELECT }
    );

    console.log(`Found ${matches.length} matches in stats for user ${targetUserId}`);

    const statsByMatch = new Map();
    const statsRows = await sequelize.query(
      `SELECT match_id, goals, assists FROM match_statistics WHERE user_id = :targetUserId`,
      { replacements: { targetUserId }, type: QueryTypes.SELECT }
    );
    for (const r of statsRows) {
      statsByMatch.set(String(r.match_id), { goals: Number(r.goals || 0), assists: Number(r.assists || 0) });
    }

    const achievementMatches = matches.map((m) => {
      const isHomePick = String(m.homeDefensiveImpactId || '') === targetUserId || String(m.homeMentalityId || '') === targetUserId;
      const isAwayPick = String(m.awayDefensiveImpactId || '') === targetUserId || String(m.awayMentalityId || '') === targetUserId;
      const isHome = isHomePick || !isAwayPick;
      const isAway = isAwayPick;
      return toAchievementMatchInput({
        ...m,
        homeTeamUsers: isHome ? [{ id: targetUserId }] : [],
        awayTeamUsers: isAway ? [{ id: targetUserId }] : [],
        votes: []
      });
    });

    const computed = computeAchievementState(targetUserId, achievementMatches, statsByMatch);
    console.log('Computed achievements:');
    const xFactor = computed.badges.find(b => b.id === 'captain_performance_3');
    console.log('The X-Factor Badge:', JSON.stringify(xFactor, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await sequelize.close();
  }
}

main();
