require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'salman1209',
  password: process.env.DB_PASSWORD || 'Malik,g12',
});

async function main() {
  console.log('🔄 Restoring members for orphaned archived leagues...\n');

  const orphanedLeagues = await pool.query(`
    SELECT l.id, l.name
    FROM "Leagues" l
    WHERE (SELECT COUNT(*) FROM "LeagueMember" lm WHERE lm."leagueId" = l.id) = 0
      AND (SELECT COUNT(*) FROM "Matches" m WHERE m."leagueId" = l.id) > 0;
  `);

  for (const league of orphanedLeagues.rows) {
    console.log(`📌 Processing orphaned league: "${league.name}" (${league.id})`);

    const userIds = new Set();

    // 1. Matches table captains and votes
    const matches = await pool.query(
      `SELECT "homeCaptainId", "awayCaptainId", "suggestedByCaptainId", "homeDefensiveImpactId", "awayDefensiveImpactId", "homeMentalityId", "awayMentalityId", "manOfTheMatchVotes" 
       FROM "Matches" WHERE "leagueId" = $1;`,
      [league.id]
    );

    matches.rows.forEach(m => {
      ['homeCaptainId', 'awayCaptainId', 'suggestedByCaptainId', 'homeDefensiveImpactId', 'awayDefensiveImpactId', 'homeMentalityId', 'awayMentalityId'].forEach(col => {
        if (m[col]) userIds.add(String(m[col]));
      });
      if (m.manOfTheMatchVotes && typeof m.manOfTheMatchVotes === 'object') {
        Object.entries(m.manOfTheMatchVotes).forEach(([k, v]) => {
          if (k) userIds.add(String(k));
          if (typeof v === 'string') userIds.add(v);
        });
      }
    });

    // 2. MatchAvailability
    try {
      const availRes = await pool.query(
        `SELECT DISTINCT "userId" FROM "MatchAvailabilities" WHERE "matchId" IN (SELECT id FROM "Matches" WHERE "leagueId" = $1);`,
        [league.id]
      );
      availRes.rows.forEach(r => { if (r.userId) userIds.add(String(r.userId)); });
    } catch (e) {
      try {
        const availRes2 = await pool.query(
          `SELECT DISTINCT "userId" FROM "MatchAvailability" WHERE "matchId" IN (SELECT id FROM "Matches" WHERE "leagueId" = $1);`,
          [league.id]
        );
        availRes2.rows.forEach(r => { if (r.userId) userIds.add(String(r.userId)); });
      } catch (e2) {}
    }

    // 3. MatchStatistics
    try {
      const statsRes = await pool.query(
        `SELECT DISTINCT "userId" FROM "MatchStatistics" WHERE "matchId" IN (SELECT id FROM "Matches" WHERE "leagueId" = $1);`,
        [league.id]
      );
      statsRes.rows.forEach(r => { if (r.userId) userIds.add(String(r.userId)); });
    } catch (e) {}

    // 4. MatchPlayerLayouts
    try {
      const layoutRes = await pool.query(
        `SELECT DISTINCT "userId" FROM "MatchPlayerLayouts" WHERE "matchId" IN (SELECT id FROM "Matches" WHERE "leagueId" = $1);`,
        [league.id]
      );
      layoutRes.rows.forEach(r => { if (r.userId) userIds.add(String(r.userId)); });
    } catch (e) {}

    console.log(`   Found ${userIds.size} player user IDs in matches for "${league.name}":`, Array.from(userIds));

    // Restore member relationships in LeagueMember
    let addedCount = 0;
    let firstValidUserId = null;

    for (const userId of userIds) {
      if (!userId || userId.startsWith('guest-') || userId === 'null' || userId === 'undefined') continue;

      const userCheck = await pool.query(`SELECT id FROM "users" WHERE id = $1;`, [userId]);
      if (userCheck.rows.length > 0) {
        if (!firstValidUserId) firstValidUserId = userId;
        await pool.query(
          `INSERT INTO "LeagueMember" ("leagueId", "userId", "createdAt", "updatedAt") 
           VALUES ($1, $2, NOW(), NOW()) 
           ON CONFLICT DO NOTHING;`,
          [league.id, userId]
        );
        addedCount++;
      }
    }

    // Restore admin in LeagueAdmin if no admin exists
    const adminCheck = await pool.query(`SELECT "userId" FROM "LeagueAdmin" WHERE "leagueId" = $1;`, [league.id]);
    if (adminCheck.rows.length === 0 && firstValidUserId) {
      await pool.query(
        `INSERT INTO "LeagueAdmin" ("leagueId", "userId", "createdAt", "updatedAt") 
         VALUES ($1, $2, NOW(), NOW()) 
         ON CONFLICT DO NOTHING;`,
        [league.id, firstValidUserId]
      );
      console.log(`   👑 Restored admin for "${league.name}": ${firstValidUserId}`);
    }

    // Set archived = true, active = false
    await pool.query(`UPDATE "Leagues" SET archived = true, active = false WHERE id = $1;`, [league.id]);
    console.log(`   ✅ Restored ${addedCount} members for "${league.name}" & marked archived = true.\n`);
  }

  console.log('✨ All orphaned leagues restored successfully!');
  await pool.end();
}

main().catch(console.error);
