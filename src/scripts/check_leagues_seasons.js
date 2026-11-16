const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

async function checkLeaguesAndSeasonsIntegrity() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log('=== CHECKING MATCHES, LEAGUES & SEASONS INTEGRITY ===\n');

    // 1. Matches with NULL seasonId
    const nullSeasonMatches = await client.query('SELECT COUNT(*) FROM "Matches" WHERE "seasonId" IS NULL');
    console.log('Matches with NULL seasonId:', nullSeasonMatches.rows[0].count);

    // 2. Matches with NULL leagueId
    const nullLeagueMatches = await client.query('SELECT COUNT(*) FROM "Matches" WHERE "leagueId" IS NULL');
    console.log('Matches with NULL leagueId:', nullLeagueMatches.rows[0].count);

    // 3. Matches whose leagueId does NOT exist in Leagues table
    const orphanLeagueMatches = await client.query(`
      SELECT COUNT(*) 
      FROM "Matches" m 
      LEFT JOIN "Leagues" l ON m."leagueId" = l.id 
      WHERE l.id IS NULL
    `);
    console.log('Matches with orphaned leagueId (league not in Leagues table):', orphanLeagueMatches.rows[0].count);

    // 4. Matches whose seasonId does NOT exist in Seasons table
    const orphanSeasonMatches = await client.query(`
      SELECT COUNT(*) 
      FROM "Matches" m 
      LEFT JOIN "Seasons" s ON m."seasonId" = s.id 
      WHERE s.id IS NULL
    `);
    console.log('Matches with orphaned seasonId (season not in Seasons table):', orphanSeasonMatches.rows[0].count);

    // 5. Leagues without Season 1
    const leaguesWithoutSeason = await client.query(`
      SELECT l.id, l.name
      FROM "Leagues" l
      LEFT JOIN "Seasons" s ON l.id = s."leagueId"
      WHERE s.id IS NULL
    `);
    console.log('Leagues with NO Seasons at all:', leaguesWithoutSeason.rows.length);
    if (leaguesWithoutSeason.rows.length > 0) {
      console.table(leaguesWithoutSeason.rows);
    }

    // 6. Check completed matches breakdown:
    const completedMatches = await client.query(`
      SELECT 
        COUNT(*) as total_completed,
        COUNT(m."seasonId") as with_season,
        COUNT(CASE WHEN m."seasonId" IS NULL THEN 1 END) as without_season
      FROM "Matches" m
      WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
    `);
    console.log('\nCompleted Matches:', completedMatches.rows[0]);

    // 7. Check if seasonId in Matches matches the league's Season
    const mismatchedSeasons = await client.query(`
      SELECT m.id as match_id, m."leagueId", m."seasonId", s."leagueId" as season_league_id
      FROM "Matches" m
      JOIN "Seasons" s ON m."seasonId" = s.id
      WHERE m."leagueId" != s."leagueId"
    `);
    console.log('Matches where match.leagueId != season.leagueId:', mismatchedSeasons.rows.length);

  } finally {
    client.release();
    await pool.end();
  }
}

checkLeaguesAndSeasonsIntegrity().catch(console.error);
