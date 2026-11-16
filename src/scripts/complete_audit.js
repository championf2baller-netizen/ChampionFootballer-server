const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });
const { Client } = require('pg');

const { xpAchievements } = require('../../dist/utils/xpAchievements');

const XP_BY_ID = xpAchievements.reduce((acc, ach) => {
  acc[ach.id] = ach.xp;
  return acc;
}, {});

async function completeAudit() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  console.log('--- RUNNING FULL SYSTEM AUDIT ---');

  // 1. Check total users and XP breakdown
  const usersRes = await c.query(`
    SELECT id, "firstName", "lastName", email, xp, achievements
    FROM users
  `);
  const users = usersRes.rows;
  console.log(`Total users in system: ${users.length}`);

  // 2. Check match statistics sum per user
  const statsRes = await c.query(`
    SELECT 
      ms.user_id,
      SUM(ms.xp_awarded)::int AS match_xp,
      COUNT(ms.id)::int AS appearances_count
    FROM match_statistics ms
    JOIN "Matches" m ON ms.match_id = m.id
    WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
    GROUP BY ms.user_id
  `);

  const statsMap = new Map();
  statsRes.rows.forEach(r => {
    statsMap.set(String(r.user_id), {
      match_xp: Number(r.match_xp || 0),
      count: Number(r.appearances_count || 0)
    });
  });

  let perfectMatches = 0;
  let mismatches = [];
  let usersWithBadges = 0;
  let totalBadgesCount = 0;
  let totalBadgeXPAwarded = 0;
  let invalidBadgesFound = [];

  for (const u of users) {
    const userId = String(u.id);
    const statData = statsMap.get(userId) || { match_xp: 0, count: 0 };
    const matchXP = statData.match_xp;

    const badges = Array.isArray(u.achievements) ? u.achievements : [];
    if (badges.length > 0) {
      usersWithBadges++;
      totalBadgesCount += badges.length;
    }

    let achXP = 0;
    for (const b of badges) {
      if (XP_BY_ID[b] !== undefined) {
        achXP += XP_BY_ID[b];
      } else {
        invalidBadgesFound.push({ userId, badge: b });
      }
    }
    totalBadgeXPAwarded += achXP;

    const expectedTotalXP = matchXP + achXP;
    const actualTotalXP = Number(u.xp || 0);

    if (expectedTotalXP === actualTotalXP) {
      perfectMatches++;
    } else {
      mismatches.push({
        id: userId,
        name: `${u.firstName} ${u.lastName}`,
        actualTotalXP,
        expectedTotalXP,
        matchXP,
        achXP,
        diff: actualTotalXP - expectedTotalXP,
        badgesCount: badges.length
      });
    }
  }

  console.log('\n=== AUDIT RESULTS ===');
  console.log(`1. Total Users: ${users.length}`);
  console.log(`2. 100% Mathematical Consistency (users.xp == matchXP + achXP): ${perfectMatches} / ${users.length} (${((perfectMatches/users.length)*100).toFixed(2)}%)`);
  console.log(`3. Discrepancies / Mismatches: ${mismatches.length}`);
  console.log(`4. Users with Badges / Rewards: ${usersWithBadges}`);
  console.log(`5. Total Badges active in DB: ${totalBadgesCount}`);
  console.log(`6. Total Reward XP active in DB: ${totalBadgeXPAwarded}`);
  console.log(`7. Invalid Badge IDs: ${invalidBadgesFound.length}`);

  if (mismatches.length > 0) {
    console.log('\nMismatch details:');
    console.table(mismatches);
  }

  // 3. Check for any missing appearance in completed matches
  const missingAppearances = await c.query(`
    WITH all_lineups AS (
      SELECT "matchId" AS match_id, "userId" AS user_id FROM "UserHomeMatches"
      UNION
      SELECT "matchId" AS match_id, "userId" AS user_id FROM "UserAwayMatches"
    )
    SELECT COUNT(*)::int AS count
    FROM all_lineups l
    JOIN "Matches" m ON l.match_id = m.id
    LEFT JOIN match_statistics ms ON l.match_id = ms.match_id AND l.user_id = ms.user_id
    WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
      AND ms.id IS NULL
  `);
  console.log(`8. Missing match appearances: ${missingAppearances.rows[0].count}`);

  // 4. Check for any match_statistics with xp_awarded IS NULL or < 0
  const invalidStats = await c.query(`
    SELECT COUNT(*)::int AS count
    FROM match_statistics
    WHERE xp_awarded IS NULL OR xp_awarded < 0
  `);
  console.log(`9. Invalid / negative match_statistics XP: ${invalidStats.rows[0].count}`);

  // 5. Check sample active players
  const sampleActive = await c.query(`
    SELECT "firstName", "lastName", xp, cardinality(achievements) as badges,
      (SELECT SUM(xp_awarded) FROM match_statistics WHERE user_id = u.id)::int as stat_xp
    FROM users u
    WHERE xp > 0
    ORDER BY xp DESC
    LIMIT 10
  `);
  console.log('\nTop 10 Active Players Sample:');
  console.table(sampleActive.rows);

  await c.end();
}

completeAudit().catch(console.error);
