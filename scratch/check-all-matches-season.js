const path = require('path');
const serverDir = 'c:\\Users\\tech solutionor\\Desktop\\latest work on champion\\championfootballer-client\\championfootballerserver';
require('ts-node').register({ transpileOnly: true, project: path.join(serverDir, 'tsconfig.json') });

async function check() {
    try {
        const { League, Season, Match } = require(path.join(serverDir, 'src', 'models'));

        const leagues = await League.findAll({
            include: [{ model: Season, as: 'seasons' }]
        });

        console.log('=== LEAGUES ===');
        for (const l of leagues) {
            console.log(`League ID: ${l.id} | Name: ${l.name}`);
            const seasons = l.seasons || [];
            console.log(`  Seasons (${seasons.length}):`);
            for (const s of seasons) {
                console.log(`    Season ID: ${s.id} | seasonNumber: ${s.seasonNumber} | name: ${s.name} | startDate: ${s.startDate} | endDate: ${s.endDate}`);
            }

            const matches = await Match.findAll({ where: { leagueId: l.id, deleted: false } });
            console.log(`  Matches (${matches.length}):`);
            for (const m of matches) {
                console.log(`    Match ID: ${m.id} | seasonId: ${m.seasonId} | date: ${m.date} | start: ${m.start} | status: ${m.status}`);
            }
        }
    } catch (e) {
        console.error('Error:', e);
    }
    process.exit(0);
}

check();
