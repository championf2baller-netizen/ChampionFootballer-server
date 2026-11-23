const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');

const { computeAchievementState, toAchievementMatchInput } = require(path.resolve(__dirname, '../../dist/utils/achievementChecker'));
const { xpAchievements } = require(path.resolve(__dirname, '../../dist/utils/xpAchievements'));

const XP_BY_ID = xpAchievements.reduce((acc, ach) => {
  acc[ach.id] = ach.xp;
  return acc;
}, {});

const xpPointsTable = {
  winningTeam: 30,
  draw: 15,
  losingTeam: 10,
  motm: { win: 10, lose: 5 },
  cleanSheet: 5,
  goal: { win: 3, lose: 2 },
  assist: { win: 2, lose: 1 },
  motmVote: { win: 2, lose: 1 },
  defensiveImpact: { win: 2, lose: 1 },
  mentality: { win: 2, lose: 2 },
};

async function main() {
  const isApply = process.argv.includes('--apply');
  console.log(`\n======================================================`);
  console.log(`  SYNC ALL USERS XP & REWARDS [MODE: ${isApply ? 'APPLY (WRITING TO DB)' : 'DRY-RUN (NO CHANGES)'}]`);
  console.log(`======================================================\n`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
  });

  const client = await pool.connect();

  try {
    // 1. Fetch all completed matches
    console.log('1. Loading completed matches...');
    const matchesRes = await client.query(`
      SELECT DISTINCT m.id, m."leagueId", m."seasonId", m.status, m."homeTeamGoals", m."awayTeamGoals", m.date, m."createdAt",
             m."homeCaptainId", m."awayCaptainId", m."homeDefensiveImpactId", m."awayDefensiveImpactId", m."homeMentalityId", m."awayMentalityId"
      FROM "Matches" m
      WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
      ORDER BY m.date ASC, m."createdAt" ASC;
    `);
    const matches = matchesRes.rows;
    const matchIds = matches.map(m => String(m.id));
    console.log(`   Found ${matches.length} completed matches.`);

    // 2. Fetch lineups, votes, and existing match_statistics
    console.log('2. Loading lineups, votes, and match statistics...');
    const [homeRows, awayRows, voteRows, statsRows] = await Promise.all([
      client.query(`SELECT "matchId"::text, "userId"::text FROM "UserHomeMatches" WHERE "matchId"::text = ANY($1::text[])`, [matchIds]),
      client.query(`SELECT "matchId"::text, "userId"::text FROM "UserAwayMatches" WHERE "matchId"::text = ANY($1::text[])`, [matchIds]),
      client.query(`SELECT "matchId"::text, "votedForId"::text, category FROM "Votes" WHERE "matchId"::text = ANY($1::text[])`, [matchIds]),
      client.query(`SELECT id::text, match_id::text, user_id::text, goals, assists, clean_sheets, xp_awarded FROM match_statistics WHERE match_id::text = ANY($1::text[])`, [matchIds]),
    ]);

    const homeMap = new Map();
    const awayMap = new Map();
    homeRows.rows.forEach(r => {
      if (!homeMap.has(r.matchId)) homeMap.set(r.matchId, new Set());
      homeMap.get(r.matchId).add(r.userId);
    });
    awayRows.rows.forEach(r => {
      if (!awayMap.has(r.matchId)) awayMap.set(r.matchId, new Set());
      awayMap.get(r.matchId).add(r.userId);
    });

    const votesMap = new Map();
    voteRows.rows.forEach(r => {
      if (!votesMap.has(r.matchId)) votesMap.set(r.matchId, []);
      votesMap.get(r.matchId).push(r);
    });

    const statsMap = new Map();
    statsRows.rows.forEach(r => {
      statsMap.set(`${r.match_id}|${r.user_id}`, {
        id: r.id,
        goals: Number(r.goals || 0),
        assists: Number(r.assists || 0),
        cleanSheets: Number(r.clean_sheets || 0),
        xp_awarded: Number(r.xp_awarded || 0),
      });
    });

    console.log(`   Lineup participations: Home=${homeRows.rows.length}, Away=${awayRows.rows.length}`);
    console.log(`   Existing match_statistics: ${statsRows.rows.length}`);

    // 3. Calculate exact match XP for every participation
    console.log('3. Calculating exact match XP for all participations...');
    const missingStatsToInsert = [];
    const statsToUpdate = [];
    const allParticipations = new Map(); // `${matchId}|${userId}` -> calculatedXP
    const userMatchXPMap = new Map(); // userId -> totalMatchXP

    for (const m of matches) {
      const matchId = String(m.id);
      const homeGoals = Number(m.homeTeamGoals);
      const awayGoals = Number(m.awayTeamGoals);

      const homePlayers = homeMap.get(matchId) || new Set();
      const awayPlayers = awayMap.get(matchId) || new Set();
      const allPlayers = new Set([...homePlayers, ...awayPlayers]);

      // Count votes (MOTM votes)
      const votes = votesMap.get(matchId) || [];
      const voteCounts = {};
      for (const v of votes) {
        if (!v.category || v.category === 'motm') {
          const vId = String(v.votedForId);
          voteCounts[vId] = (voteCounts[vId] || 0) + 1;
        }
      }

      let motmId = null;
      let maxVotes = 0;
      for (const [vId, count] of Object.entries(voteCounts)) {
        if (count > maxVotes) {
          motmId = vId;
          maxVotes = count;
        }
      }

      for (const userId of allPlayers) {
        const isHome = homePlayers.has(userId);
        let teamResult = 'lose';
        if (isHome && homeGoals > awayGoals) teamResult = 'win';
        else if (!isHome && awayGoals > homeGoals) teamResult = 'win';
        else if (homeGoals === awayGoals) teamResult = 'draw';

        let xp = 0;
        if (teamResult === 'win') xp += xpPointsTable.winningTeam;
        else if (teamResult === 'draw') xp += xpPointsTable.draw;
        else xp += xpPointsTable.losingTeam;

        const statKey = `${matchId}|${userId}`;
        const existingStat = statsMap.get(statKey);

        if (existingStat) {
          if (existingStat.goals > 0) xp += (teamResult === 'win' ? xpPointsTable.goal.win : xpPointsTable.goal.lose) * existingStat.goals;
          if (existingStat.assists > 0) xp += (teamResult === 'win' ? xpPointsTable.assist.win : xpPointsTable.assist.lose) * existingStat.assists;
          if (existingStat.cleanSheets > 0) xp += xpPointsTable.cleanSheet * existingStat.cleanSheets;
        }

        if (motmId === userId) xp += teamResult === 'win' ? xpPointsTable.motm.win : xpPointsTable.motm.lose;

        const votesReceived = voteCounts[userId] || 0;
        if (votesReceived > 0) xp += (teamResult === 'win' ? xpPointsTable.motmVote.win : xpPointsTable.motmVote.lose) * votesReceived;

        if (String(m.homeDefensiveImpactId || '') === userId || String(m.awayDefensiveImpactId || '') === userId) {
          xp += teamResult === 'win' ? xpPointsTable.defensiveImpact.win : xpPointsTable.defensiveImpact.lose;
        }

        if (String(m.homeMentalityId || '') === userId || String(m.awayMentalityId || '') === userId) {
          xp += teamResult === 'win' ? xpPointsTable.mentality.win : xpPointsTable.mentality.lose;
        }

        allParticipations.set(statKey, xp);
        userMatchXPMap.set(userId, (userMatchXPMap.get(userId) || 0) + xp);

        if (!existingStat) {
          missingStatsToInsert.push({
            id: uuidv4(),
            user_id: userId,
            match_id: matchId,
            xp_awarded: xp,
          });
        } else if (existingStat.xp_awarded !== xp) {
          statsToUpdate.push({
            id: existingStat.id,
            xp_awarded: xp,
          });
        }
      }
    }

    console.log(`   Total participations: ${allParticipations.size}`);
    console.log(`   Missing match_statistics rows to insert: ${missingStatsToInsert.length}`);
    console.log(`   Existing match_statistics rows to update xp_awarded: ${statsToUpdate.length}`);

    // 4. Achievement / Rewards Calculation
    console.log('4. Computing achievements and rewards for all users...');
    const statsByUser = new Map();
    statsRows.rows.forEach(r => {
      if (!statsByUser.has(r.user_id)) statsByUser.set(r.user_id, new Map());
      statsByUser.get(r.user_id).set(String(r.match_id).toLowerCase(), {
        goals: Number(r.goals || 0),
        assists: Number(r.assists || 0)
      });
    });

    const achievementMatches = matches.map(m => {
      const matchId = String(m.id);
      const homeUsers = Array.from(homeMap.get(matchId) || []).map(id => ({ id }));
      const awayUsers = Array.from(awayMap.get(matchId) || []).map(id => ({ id }));
      return toAchievementMatchInput({
        ...m,
        homeTeamUsers: homeUsers,
        awayTeamUsers: awayUsers,
        votes: votesMap.get(matchId) || [],
      });
    });

    const usersRes = await client.query('SELECT id, "firstName", "lastName", email, xp, achievements FROM users');
    const users = usersRes.rows;

    const userUpdates = [];
    let totalBadgesToAward = 0;
    let totalRewardXPToAward = 0;

    for (const u of users) {
      const userId = String(u.id);
      const userStats = statsByUser.get(userId) || new Map();
      const computed = computeAchievementState(userId, achievementMatches, userStats);

      const computedBadges = computed.xpAchievementInstances; // Array of badge ids
      const currentBadges = Array.isArray(u.achievements) ? u.achievements : [];

      const matchXP = userMatchXPMap.get(userId) || 0;
      const achXP = computedBadges.reduce((sum, achId) => sum + (XP_BY_ID[achId] || 0), 0);
      const totalXP = matchXP + achXP;

      const currentXP = Number(u.xp || 0);
      const isBadgesChanged = computedBadges.length !== currentBadges.length ||
                              computedBadges.some((id, idx) => id !== currentBadges[idx]);
      const isXPChanged = currentXP !== totalXP;

      if (isBadgesChanged || isXPChanged) {
        if (computedBadges.length > currentBadges.length) {
          totalBadgesToAward += (computedBadges.length - currentBadges.length);
        }
        totalRewardXPToAward += achXP;

        userUpdates.push({
          id: userId,
          name: `${u.firstName} ${u.lastName}`.trim() || 'Unknown',
          email: u.email,
          currentXP,
          matchXP,
          achXP,
          newTotalXP: totalXP,
          xpDiff: totalXP - currentXP,
          currentBadgesCount: currentBadges.length,
          newBadgesCount: computedBadges.length,
          badgesAwarded: computedBadges,
          unlockedBadgeTitles: computed.badges.filter(b => b.unlocked).map(b => `${b.title} (${b.count})`).join(', ')
        });
      }
    }

    console.log(`   Users requiring XP/Achievement updates: ${userUpdates.length} / ${users.length}`);
    console.log(`   New badge instances to award: ${totalBadgesToAward}`);
    console.log(`   Total reward XP to credit: ${totalRewardXPToAward}`);

    // Sort by largest XP change
    userUpdates.sort((a, b) => b.xpDiff - a.xpDiff);

    console.log('\nTop 20 users who will be updated:');
    console.table(userUpdates.slice(0, 20).map(u => ({
      name: u.name,
      currentXP: u.currentXP,
      matchXP: u.matchXP,
      achXP: u.achXP,
      newTotalXP: u.newTotalXP,
      xpDiff: `+${u.xpDiff}`,
      badges: `${u.currentBadgesCount} -> ${u.newBadgesCount}`,
      unlockedBadges: u.unlockedBadgeTitles.slice(0, 45) + (u.unlockedBadgeTitles.length > 45 ? '...' : '')
    })));

    // 5. If APPLY mode, execute DB writes
    if (isApply) {
      console.log('\n5. Executing database updates in a transaction...');
      await client.query('BEGIN');

      // A. Insert missing match_statistics in batches of 500
      if (missingStatsToInsert.length > 0) {
        console.log(`   Inserting ${missingStatsToInsert.length} missing match_statistics rows...`);
        const BATCH_SIZE = 500;
        for (let i = 0; i < missingStatsToInsert.length; i += BATCH_SIZE) {
          const batch = missingStatsToInsert.slice(i, i + BATCH_SIZE);
          const values = [];
          const rowsSql = batch.map((r, idx) => {
            const p = idx * 6;
            values.push(r.id, r.user_id, r.match_id, 0, 90, r.xp_awarded);
            return `($${p+1}, $${p+2}, $${p+3}, 0, 0, 0, 0, $${p+4}, 0, 0, 0, 0, $${p+5}, 6.0, $${p+6}, NOW(), NOW())`;
          });

          const sql = `
            INSERT INTO match_statistics (
              id, user_id, match_id, goals, assists, clean_sheets, defence, impact,
              penalties, free_kicks, yellow_cards, red_cards, minutes_played, rating,
              xp_awarded, created_at, updated_at
            ) VALUES ${rowsSql.join(', ')}
            ON CONFLICT (user_id, match_id) DO UPDATE SET xp_awarded = EXCLUDED.xp_awarded;
          `;
          await client.query(sql, values);
          console.log(`   - Inserted batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(missingStatsToInsert.length / BATCH_SIZE)}`);
        }
      }

      // B. Update existing match_statistics if xp_awarded changed
      if (statsToUpdate.length > 0) {
        console.log(`   Updating ${statsToUpdate.length} existing match_statistics xp_awarded...`);
        const BATCH_SIZE = 500;
        for (let i = 0; i < statsToUpdate.length; i += BATCH_SIZE) {
          const batch = statsToUpdate.slice(i, i + BATCH_SIZE);
          for (const s of batch) {
            await client.query('UPDATE match_statistics SET xp_awarded = $1, updated_at = NOW() WHERE id = $2', [s.xp_awarded, s.id]);
          }
        }
      }

      // C. Update users table (xp + achievements) in batches
      console.log(`   Updating ${userUpdates.length} users with new total XP and achievements array...`);
      for (const u of userUpdates) {
        await client.query(
          `UPDATE users SET xp = $1, achievements = $2, "updatedAt" = NOW() WHERE id = $3`,
          [u.newTotalXP, u.badgesAwarded, u.id]
        );
      }

      await client.query('COMMIT');
      console.log('   Transaction committed successfully!');

      // D. Clear Cache
      console.log('6. Clearing application cache...');
      try {
        const cache = require('./dist/utils/cache').default;
        if (cache && typeof cache.flushAll === 'function') {
          cache.flushAll();
          console.log('   Cache flushed successfully.');
        } else if (cache && typeof cache.del === 'function') {
          console.log('   Cache instance checked.');
        }
      } catch (cacheErr) {
        console.log('   Cache clear note:', cacheErr.message);
      }

      console.log('\n🎉 ALL USERS XP & REWARDS SUCCESSFULLY SYNCED AND SAVED TO DATABASE!');
    } else {
      console.log('\n[DRY RUN FINISHED] No changes were written to the database.');
      console.log('To apply these changes, run with: node sync_all_users_xp_and_rewards.js --apply');
    }

  } catch (err) {
    if (isApply) {
      await client.query('ROLLBACK');
      console.error('Transaction rolled back due to error.');
    }
    console.error('Execution error:', err);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(console.error);
