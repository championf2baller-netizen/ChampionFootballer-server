const { validateScoreVsPlayerStats } = require('../src/controllers/matchController.full');
const { Match, MatchStatistics } = require('../src/models');

async function test() {
  console.log('Testing validateScoreVsPlayerStats helper...');

  // Find a match with stats in DB
  const stat = await MatchStatistics.findOne({
    where: { goals: { [require('sequelize').Op.gt]: 0 } }
  });

  if (!stat) {
    console.log('No stats found with goals > 0 in DB');
    process.exit(0);
  }

  const matchId = stat.match_id || stat.matchId;
  console.log('Found matchId with player goals:', matchId, 'Player goals:', stat.goals);

  // Test 1: Try setting home goals to 0
  const msg1 = await validateScoreVsPlayerStats(matchId, 0, null);
  console.log('Test 1 (set Home to 0):', msg1);

  // Test 2: Try setting home goals to 1 (lower than total)
  const msg2 = await validateScoreVsPlayerStats(matchId, 0, 0);
  console.log('Test 2 (set both to 0-0):', msg2);

  // Test 3: Try setting valid score (e.g. 10)
  const msg3 = await validateScoreVsPlayerStats(matchId, 99, 99);
  console.log('Test 3 (set 99-99):', msg3);

  process.exit(0);
}

test().catch(e => { console.error(e); process.exit(1); });
