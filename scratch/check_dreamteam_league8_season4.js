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
    const [leagues] = await sequelize.query(`SELECT id, name FROM "Leagues" WHERE name ILIKE '%Season 8%' OR name ILIKE '%8%'`);
    if (leagues.length === 0) return;

    const leagueId = leagues[0].id;

    const [users] = await sequelize.query(`
      SELECT u.id, u."firstName", u."lastName", u.position, u."positionType", u.xp
      FROM users u
      JOIN "LeagueMember" lm ON lm."userId" = u.id
      WHERE lm."leagueId" = :leagueId
      ORDER BY u.xp DESC NULLS LAST
    `, { replacements: { leagueId } });

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
        combined.includes('left mid')
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

    console.log('\n--- Members Final Categorization ---');
    users.forEach(u => {
      console.log(`${u.firstName} ${u.lastName} | Pos: "${u.position}" | Type: "${u.positionType}" | XP: ${u.xp} => ${getPositionType(u)}`);
    });

  } catch (e) {
    console.error('Error:', e);
  } finally {
    await sequelize.close();
  }
}

run();
