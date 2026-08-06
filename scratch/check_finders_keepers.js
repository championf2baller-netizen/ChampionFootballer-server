const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

const db = require('../dist/config/database').default;
const models = require('../dist/models').default;
const { Match, MatchStatistics, User } = models;

async function main() {
  await db.authenticate();
  console.log('Database connected.');

  const users = await User.findAll({ attributes: ['id', 'firstName', 'lastName'], raw: true });

  for (const u of users) {
    const userId = String(u.id);

    const [homeMatches, awayMatches] = await Promise.all([
      db.query(`SELECT "matchId" FROM "UserHomeMatches" WHERE "userId" = :userId`, { replacements: { userId }, type: 'SELECT' }),
      db.query(`SELECT "matchId" FROM "UserAwayMatches" WHERE "userId" = :userId`, { replacements: { userId }, type: 'SELECT' })
    ]);

    const matchIds = Array.from(new Set([
      ...homeMatches.map(m => String(m.matchId)),
      ...awayMatches.map(m => String(m.matchId))
    ]));

    if (matchIds.length === 0) continue;

    const matches = await Match.findAll({
      where: { id: matchIds, status: 'RESULT_PUBLISHED' },
      attributes: ['id', 'leagueId', 'seasonId', 'homeTeamGoals', 'awayTeamGoals', 'date'],
      raw: true
    });

    if (matches.length === 0) continue;

    const processMatchIds = matches.map(m => String(m.id));
    const [homeRows, awayRows] = await Promise.all([
      db.query(`SELECT "matchId", "userId" FROM "UserHomeMatches" WHERE "matchId" IN (:matchIds)`, { replacements: { matchIds: processMatchIds }, type: 'SELECT' }),
      db.query(`SELECT "matchId", "userId" FROM "UserAwayMatches" WHERE "matchId" IN (:matchIds)`, { replacements: { matchIds: processMatchIds }, type: 'SELECT' })
    ]);

    const homeByMatch = new Map();
    const awayByMatch = new Map();
    homeRows.forEach(r => {
      const mId = String(r.matchId);
      if (!homeByMatch.has(mId)) homeByMatch.set(mId, []);
      homeByMatch.get(mId).push(String(r.userId));
    });
    awayRows.forEach(r => {
      const mId = String(r.matchId);
      if (!awayByMatch.has(mId)) awayByMatch.set(mId, []);
      awayByMatch.get(mId).push(String(r.userId));
    });

    let cleanSheetsTotal = 0;
    let cleanSheetWins = 0;
    let cleanSheetDraws = 0;

    for (const m of matches) {
      const isHome = (homeByMatch.get(String(m.id)) || []).includes(userId);
      const teamGoals = isHome ? Number(m.homeTeamGoals || 0) : Number(m.awayTeamGoals || 0);
      const oppGoals = isHome ? Number(m.awayTeamGoals || 0) : Number(m.homeTeamGoals || 0);

      if (oppGoals === 0) {
        cleanSheetsTotal++;
        if (teamGoals > 0) cleanSheetWins++;
        else cleanSheetDraws++;
      }
    }

    if (cleanSheetsTotal > 0) {
      console.log(`User: ${u.firstName} ${u.lastName} (${userId})`);
      console.log(`  Total Clean Sheets (oppGoals === 0): ${cleanSheetsTotal} -> Badges count = ${Math.floor(cleanSheetsTotal / 3)}`);
      console.log(`  Clean Sheet Wins (teamGoals > 0 && oppGoals === 0): ${cleanSheetWins} -> Badges count = ${Math.floor(cleanSheetWins / 3)}`);
      console.log(`  Clean Sheet 0-0 Draws: ${cleanSheetDraws}`);
    }
  }

  await db.close();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
