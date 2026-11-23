const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

async function main() {
  const url = (process.env.DATABASE_URL || '').replace(/^"|"$/g, '');
  const pool = new Pool({ connectionString: url });

  try {
    // Let's check recent users and their leagues
    const users = await pool.query(`
      SELECT id, "firstName", "lastName", email, "createdAt"
      FROM users
      ORDER BY "createdAt" DESC
      LIMIT 5
    `);
    console.log('Recent users:', users.rows);

    // Let's check all leagues with 1 match that have votes
    const singleMatchWithVotes = await pool.query(`
      SELECT l.id as league_id, l.name as league_name, m.id as match_id, m.status::text,
             COUNT(v.id) as vote_count,
             json_agg(json_build_object('voterId', v."voterId", 'votedForId', v."votedForId", 'category', v.category, 'createdAt', v."createdAt")) as votes
      FROM "Leagues" l
      JOIN "Matches" m ON m."leagueId" = l.id
      JOIN "Votes" v ON v."matchId" = m.id
      GROUP BY l.id, l.name, m.id, m.status::text
      HAVING (SELECT COUNT(*) FROM "Matches" m2 WHERE m2."leagueId" = l.id) = 1
    `);
    console.log('\nSingle match leagues with votes:');
    for (const r of singleMatchWithVotes.rows) {
      console.log(`\nLeague: ${r.league_name} (${r.league_id}), Match status: ${r.status}, Vote count: ${r.vote_count}`);
      console.log('Votes:', r.votes);

      // What does the leaderboard return for this league?
      const lb = await pool.query(`
        SELECT v."votedForId", u."firstName", u."lastName", count(DISTINCT CONCAT(v."matchId", '-', v."voterId")) as distinct_votes, count(v.id) as all_votes
        FROM "Votes" v
        JOIN "Matches" m ON m.id = v."matchId"
        LEFT JOIN users u ON u.id = v."votedForId"
        WHERE m."leagueId" = $1 AND (v.category IS NULL OR v.category = 'motm')
        GROUP BY v."votedForId", u."firstName", u."lastName"
      `, [r.league_id]);
      console.log('Leaderboard for this league:');
      console.table(lb.rows);
    }

    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
