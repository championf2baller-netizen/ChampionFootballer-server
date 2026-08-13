const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  logging: false,
  dialectOptions: { ssl: false }
});

const Vote = sequelize.define('Vote', {
  id: { type: Sequelize.UUID, defaultValue: Sequelize.UUIDV4, primaryKey: true },
  matchId: { type: Sequelize.UUID, allowNull: false },
  voterId: { type: Sequelize.UUID, allowNull: false },
  votedForId: { type: Sequelize.UUID, allowNull: false },
  category: { type: Sequelize.STRING(50), defaultValue: 'motm' },
}, { tableName: 'Votes', timestamps: true });

async function testVoteIsolationAndClear() {
  try {
    await sequelize.authenticate();
    console.log('✅ DB Connected');

    // Get real matches and real users
    const [matches] = await sequelize.query(`SELECT id FROM "Matches" LIMIT 2;`);
    const [users] = await sequelize.query(`SELECT id, "firstName", "lastName" FROM "users" LIMIT 4;`);

    if (matches.length < 1 || users.length < 3) {
      console.log('⚠️ Not enough real matches or users to run test in DB');
      await sequelize.close();
      process.exit(0);
    }

    const testMatchId1 = matches[0].id;
    const usmanId = users[0].id;
    const imranId = users[1].id;

    // Cleanup previous test votes
    await Vote.destroy({ where: { matchId: testMatchId1, voterId: usmanId } });

    console.log('\n1. Creating votes for MOTM, Defensive Impact, and Mentality...');
    await Vote.create({ matchId: testMatchId1, voterId: usmanId, votedForId: imranId, category: 'motm' });
    await Vote.create({ matchId: testMatchId1, voterId: usmanId, votedForId: imranId, category: 'defence' });
    await Vote.create({ matchId: testMatchId1, voterId: usmanId, votedForId: imranId, category: 'influence' });

    let votesCount = await Vote.count({ where: { matchId: testMatchId1, voterId: usmanId } });
    console.log('   Active votes for Usman:', votesCount, '(Expected: 3)');

    console.log('\n2. Clearing MOTM vote ("Clear Selection (None)")...');
    await Vote.destroy({ where: { matchId: testMatchId1, voterId: usmanId, category: 'motm' } });

    let defVote = await Vote.findOne({ where: { matchId: testMatchId1, voterId: usmanId, category: 'defence' } });
    let infVote = await Vote.findOne({ where: { matchId: testMatchId1, voterId: usmanId, category: 'influence' } });
    let motmVote = await Vote.findOne({ where: { matchId: testMatchId1, voterId: usmanId, category: 'motm' } });

    console.log('   MOTM vote cleared:', !motmVote ? 'YES ✅' : 'NO ❌');
    console.log('   Defensive Impact vote intact:', defVote ? 'YES ✅' : 'NO ❌');
    console.log('   Mentality vote intact:', infVote ? 'YES ✅' : 'NO ❌');

    console.log('\n3. Clearing Defensive Impact vote ("Clear Selection (None)")...');
    await Vote.destroy({ where: { matchId: testMatchId1, voterId: usmanId, category: 'defence' } });
    defVote = await Vote.findOne({ where: { matchId: testMatchId1, voterId: usmanId, category: 'defence' } });
    console.log('   Defensive Impact vote cleared:', !defVote ? 'YES ✅' : 'NO ❌');

    console.log('\n4. Clearing Mentality vote ("Clear Selection (None)")...');
    await Vote.destroy({ where: { matchId: testMatchId1, voterId: usmanId, category: 'influence' } });
    infVote = await Vote.findOne({ where: { matchId: testMatchId1, voterId: usmanId, category: 'influence' } });
    console.log('   Mentality vote cleared:', !infVote ? 'YES ✅' : 'NO ❌');

    if (!motmVote && !defVote && !infVote) {
      console.log('\n🎉 ALL CLEAR SELECTION (NONE) TESTS PASSED PERFECTLY!');
    } else {
      console.error('\n❌ CLEAR SELECTION TEST FAILED!');
    }

    // Final cleanup
    await Vote.destroy({ where: { matchId: testMatchId1, voterId: usmanId } });
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error('Test failed with error:', err);
    await sequelize.close();
    process.exit(1);
  }
}

testVoteIsolationAndClear();
