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
  console.log('🔍 Checking for archived leagues and orphaned leagues in Database...\n');

  const res = await pool.query(`
    SELECT 
      l.id, 
      l.name, 
      l.active, 
      l.archived, 
      (SELECT COUNT(*) FROM "LeagueMember" lm WHERE lm."leagueId" = l.id) as member_count,
      (SELECT COUNT(*) FROM "LeagueAdmin" la WHERE la."leagueId" = l.id) as admin_count,
      (SELECT COUNT(*) FROM "Matches" m WHERE m."leagueId" = l.id) as match_count
    FROM "Leagues" l
    ORDER BY l."createdAt" DESC;
  `);

  console.table(res.rows);

  const orphaned = res.rows.filter(r => parseInt(r.member_count) === 0 && parseInt(r.match_count) > 0);
  console.log(`\n⚠️ Found ${orphaned.length} leagues that have matches BUT 0 members (wiped by setMembers):`);
  console.table(orphaned);

  await pool.end();
}

main().catch(console.error);
