const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { Pool } = require('pg');

const clampPercentage = (v) => Math.max(0, Math.min(100, Math.round(v)));

async function main() {
  const url = (process.env.DATABASE_URL || '').replace(/^"|"$/g, '');
  const pool = new Pool({ connectionString: url });

  try {
    console.log('Fetching all match_statistics with match info...');
    const res = await pool.query(`
      SELECT 
        ms.id,
        ms.user_id,
        ms.goals,
        ms.assists,
        ms.clean_sheets,
        ms.defence,
        ms.impact as old_impact,
        COALESCE(m."homeTeamGoals", 0) + COALESCE(m."awayTeamGoals", 0) as total_goals,
        (CASE WHEN ms.user_id = m."homeMentalityId" OR ms.user_id = m."awayMentalityId" THEN true ELSE false END) as is_mentality
      FROM match_statistics ms
      JOIN "Matches" m ON ms.match_id = m.id
    `);

    console.log(`Total rows fetched: ${res.rows.length}`);

    const updates = [];

    for (const r of res.rows) {
      const goals = Math.max(0, Number(r.goals || 0));
      const assists = Math.max(0, Number(r.assists || 0));
      const cs = Math.max(0, Number(r.clean_sheets || 0));
      const def = Math.max(0, Number(r.defence || 0));
      const tg = Math.max(0, Number(r.total_goals || 0));
      const isMentality = Boolean(r.is_mentality);

      const gContrib = tg > 0 ? (goals / tg) * 100 : 0;
      const aContrib = tg > 0 ? (assists / tg) * 50 : 0;
      const csContrib = cs > 0 ? 15 * cs : 0;
      const defContrib = def * 10;
      const mentContrib = isMentality ? 5 : 0;

      const raw = gContrib + aContrib + csContrib + defContrib + mentContrib;
      const newImpact = clampPercentage(raw > 0 ? raw : 15);
      const oldImpact = Number(r.old_impact || 0);

      if (newImpact !== oldImpact) {
        updates.push({ id: r.id, oldImpact, newImpact });
      }
    }

    console.log(`Rows needing impact update: ${updates.length}`);

    if (updates.length > 0) {
      console.log('Applying updates in batches...');
      const batchSize = 500;
      for (let i = 0; i < updates.length; i += batchSize) {
        const batch = updates.slice(i, i + batchSize);
        const cases = batch.map(b => `WHEN '${b.id}' THEN ${b.newImpact}`).join(' ');
        const ids = batch.map(b => `'${b.id}'`).join(',');
        
        await pool.query(`
          UPDATE match_statistics
          SET impact = CASE id ${cases} END,
              updated_at = NOW()
          WHERE id IN (${ids})
        `);
        console.log(`Updated batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(updates.length / batchSize)} (${batch.length} rows)`);
      }
      console.log('All impact updates applied successfully!');
    } else {
      console.log('No updates needed, all records are up to date.');
    }
  } catch (err) {
    console.error('Error during recalculation:', err);
  } finally {
    await pool.end();
  }
}

main();
