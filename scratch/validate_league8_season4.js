const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME || 'championfootballer',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'postgres',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false
  }
);

async function run() {
  try {
    console.log('====================================================');
    console.log('   DREAM TEAM VALIDATION: LEAGUE 8 & SEASON 4');
    console.log('====================================================');

    // 1. Find League 8
    const [leagues] = await sequelize.query(`
      SELECT id, name FROM "Leagues"
      WHERE name ILIKE '%Season 8%' OR name ILIKE '%League 8%' OR name ILIKE '%FNF%'
    `);

    // Find Season 4 league or Season 8 FNF
    const targetLeague = leagues.find(l => l.name.includes('Season 4') || l.name.includes('Season 8') || l.name.includes('8')) || leagues[0];
    if (!targetLeague) {
      console.log('No matching league found.');
      return;
    }
    console.log(`\nUsing League: "${targetLeague.name}" (ID: ${targetLeague.id})`);

    // 2. Find Seasons for this league
    const [seasons] = await sequelize.query(`
      SELECT id, name, "leagueId" FROM "Seasons"
      WHERE "leagueId" = :leagueId
      ORDER BY name
    `, { replacements: { leagueId: targetLeague.id } });

    console.log('\nSeasons in this League:');
    console.table(seasons);

    const targetSeason = seasons.find(s => s.name.includes('4') || s.name.toLowerCase().includes('season 4')) || seasons[0];
    const seasonId = targetSeason ? targetSeason.id : null;
    console.log(`Using Season: "${targetSeason ? targetSeason.name : 'ALL SEASONS'}" (ID: ${seasonId})`);

    // 3. Get Members for this league / season
    let memberIds = [];
    if (seasonId) {
      const [seasonPlayers] = await sequelize.query(`
        SELECT "userId" FROM "SeasonPlayers" WHERE "seasonId" = :seasonId
      `, { replacements: { seasonId } });
      memberIds = seasonPlayers.map(p => p.userId);
    }
    if (memberIds.length === 0) {
      const [leagueMembers] = await sequelize.query(`
        SELECT "userId" FROM "LeagueMember" WHERE "leagueId" = :leagueId
      `, { replacements: { leagueId: targetLeague.id } });
      memberIds = leagueMembers.map(m => m.userId);
    }

    console.log(`Total Members count: ${memberIds.length}`);

    // 4. Get Matches for this league / season
    let matchQuery = `SELECT id FROM "Matches" WHERE "leagueId" = :leagueId AND status = 'RESULT_PUBLISHED'`;
    const replacements = { leagueId: targetLeague.id, seasonId };
    if (seasonId) {
      matchQuery += ` AND "seasonId" = :seasonId`;
    }
    const [matches] = await sequelize.query(matchQuery, { replacements });
    const matchIds = matches.map(m => m.id);
    console.log(`Published Matches count: ${matchIds.length}`);

    // 5. Fetch Users
    const [users] = await sequelize.query(`
      SELECT id, "firstName", "lastName", position, "positionType", "profilePicture", xp
      FROM users WHERE id IN (:memberIds)
    `, { replacements: { memberIds: memberIds.length ? memberIds : ['00000000-0000-0000-0000-000000000000'] } });

    // 6. Fetch Match Statistics
    let stats = [];
    if (memberIds.length && matchIds.length) {
      const [st] = await sequelize.query(`
        SELECT user_id, goals, assists, rating, xp_awarded
        FROM match_statistics
        WHERE user_id IN (:memberIds) AND match_id IN (:matchIds)
      `, { replacements: { memberIds, matchIds } });
      stats = st;
    }

    // Map stats by user
    const statsByUser = new Map();
    stats.forEach(s => {
      if (!statsByUser.has(s.user_id)) statsByUser.set(s.user_id, []);
      statsByUser.get(s.user_id).push(s);
    });

    // Score calculation
    const playersWithScores = users.map(user => {
      const uStats = statsByUser.get(user.id) || [];
      let totalGoals = 0;
      let totalAssists = 0;
      let totalRating = 0;
      let totalXP = 0;
      uStats.forEach(s => {
        totalGoals += Number(s.goals || 0);
        totalAssists += Number(s.assists || 0);
        totalRating += Number(s.rating || 0);
        totalXP += Number(s.xp_awarded || 0);
      });
      const avgRating = uStats.length > 0 ? totalRating / uStats.length : 0;
      const userXP = Number(user.xp || 0);
      const finalXP = totalXP > 0 ? totalXP : userXP;

      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: `${user.firstName} ${user.lastName}`,
        position: user.position,
        positionType: user.positionType,
        xp: finalXP,
        stats: {
          goals: totalGoals,
          assists: totalAssists,
          rating: parseFloat(avgRating.toFixed(1)),
          matches: uStats.length,
          xp: finalXP
        },
        score: finalXP
      };
    });

    // Position Categorization Function
    const getPositionType = (player) => {
      if (!player) return null;
      const rawType = String(player.positionType || '').trim().toLowerCase();
      const rawPos = String(player.position || '').trim().toLowerCase();

      const invalidTokens = ['', 'null', 'undefined', 'n/a', 'none', '-', 'unassigned'];
      if (invalidTokens.includes(rawType) && invalidTokens.includes(rawPos)) {
        return null;
      }

      // Priority 1: Direct rawType matching
      if (['goalkeeper', 'goalkeepers', 'gk'].includes(rawType)) return 'Goalkeeper';
      if (['defender', 'defenders', 'df'].includes(rawType)) return 'Defender';
      if (['midfielder', 'midfielders', 'mf', 'md'].includes(rawType)) return 'Midfielder';
      if (['forward', 'forwards', 'fw', 'fwd', 'attacker', 'attackers'].includes(rawType)) return 'Forward';

      // Priority 2: Keyword/Token inspection on combined position & type
      const combined = `${rawType} ${rawPos}`.trim();
      if (!combined) return null;

      // Goalkeeper
      if (
        combined.includes('goalkeeper') ||
        combined.includes('keeper') ||
        combined.includes('gk')
      ) {
        return 'Goalkeeper';
      }

      // Midfielder BEFORE Defender (so 'defensive mid' / 'cdm' is matched as Midfielder, not Defender)
      if (
        combined.includes('midfield') ||
        combined.includes('midfielder') ||
        combined.includes('cdm') ||
        combined.includes('cam') ||
        combined.includes('cm') ||
        combined.includes('lm') ||
        combined.includes('rm') ||
        combined.includes('defensive mid') ||
        combined.includes('attacking mid') ||
        combined.includes('central mid') ||
        combined.includes('right mid') ||
        combined.includes('left mid') ||
        rawType.startsWith('mid')
      ) {
        return 'Midfielder';
      }

      // Defender
      if (
        combined.includes('defender') ||
        combined.includes('defence') ||
        combined.includes('defense') ||
        combined.includes('back') ||
        combined.includes('cb') ||
        combined.includes('lb') ||
        combined.includes('rb') ||
        combined.includes('lwb') ||
        combined.includes('rwb') ||
        combined.includes('center-back') ||
        combined.includes('right-back') ||
        combined.includes('left-back') ||
        rawType.startsWith('def')
      ) {
        return 'Defender';
      }

      // Forward (ST, CF, RF, LF, RW, LW)
      if (
        combined.includes('forward') ||
        combined.includes('striker') ||
        combined.includes('winger') ||
        combined.includes('attacker') ||
        combined.includes('st') ||
        combined.includes('cf') ||
        combined.includes('rf') ||
        combined.includes('lf') ||
        combined.includes('rw') ||
        combined.includes('lw') ||
        combined.includes('fwd') ||
        combined.includes('fw') ||
        combined.includes('finisher') ||
        combined.includes('poacher') ||
        combined.includes('predator') ||
        combined.includes('rocket') ||
        combined.includes('ruthless') ||
        combined.includes('sniper') ||
        rawType.startsWith('for') ||
        rawType.startsWith('st') ||
        rawType.startsWith('att')
      ) {
        return 'Forward';
      }

      return null;
    };

    // Filter Eligible Players
    const eligible = playersWithScores.filter(p => getPositionType(p) !== null);

    // Group candidates by category
    const fwds = eligible.filter(p => getPositionType(p) === 'Forward');

    console.log('\n--- FORWARD CANDIDATE POOL (COMBINED ST, CF, RF, LF, RW, LW) ---');
    console.table(fwds.map(p => ({
      name: p.name,
      position: p.position,
      positionType: p.positionType,
      category: getPositionType(p),
      xp: p.xp
    })));

    // Ranking algorithm (Sort by XP & Score)
    const sortByXPAndScore = (a, b) => {
      const xpA = Number(a.xp || 0);
      const xpB = Number(b.xp || 0);
      if (xpB !== xpA) return xpB - xpA;
      return Number(b.score || 0) - Number(a.score || 0);
    };

    const rankedPlayers = [...eligible].sort(sortByXPAndScore);

    const selectedDreamTeam = {
      goalkeeper: [],
      defenders: [],
      midfielders: [],
      forwards: []
    };

    let totalSelected = 0;
    for (const player of rankedPlayers) {
      if (totalSelected >= 5) break;
      const posType = getPositionType(player);
      if (!posType) continue;

      const currentDefensiveCount = selectedDreamTeam.goalkeeper.length + selectedDreamTeam.defenders.length;

      if (posType === 'Goalkeeper' && selectedDreamTeam.goalkeeper.length < 1 && currentDefensiveCount < 2) {
        selectedDreamTeam.goalkeeper.push(player);
        totalSelected++;
      } else if (posType === 'Defender' && selectedDreamTeam.defenders.length < 2 && currentDefensiveCount < 2) {
        selectedDreamTeam.defenders.push(player);
        totalSelected++;
      } else if (posType === 'Midfielder' && selectedDreamTeam.midfielders.length < 2) {
        selectedDreamTeam.midfielders.push(player);
        totalSelected++;
      } else if (posType === 'Forward' && selectedDreamTeam.forwards.length < 1) {
        selectedDreamTeam.forwards.push(player);
        totalSelected++;
      }
    }

    console.log('\n--- SELECTED 5-A-SIDE DREAM TEAM ---');
    console.log('Goalkeeper (1):', selectedDreamTeam.goalkeeper.map(p => `${p.name} (${p.position}) [XP: ${p.xp}]`));
    console.log('Defenders (up to 2):', selectedDreamTeam.defenders.map(p => `${p.name} (${p.position}) [XP: ${p.xp}]`));
    console.log('Midfielders (up to 2):', selectedDreamTeam.midfielders.map(p => `${p.name} (${p.position}) [XP: ${p.xp}]`));
    console.log('Selected FORWARD (1):', selectedDreamTeam.forwards.map(p => `${p.name} (${p.position}) [XP: ${p.xp}]`));

  } catch (e) {
    console.error('Error:', e);
  } finally {
    await sequelize.close();
  }
}

run();
