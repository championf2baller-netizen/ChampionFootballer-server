import { QueryTypes } from 'sequelize';
import sequelize from '../config/database';
import cache from '../utils/cache';

export interface LeaguePlayerRankResult {
  rankChanges: Record<string, number>;
  currentRanks: Record<string, number>;
  previousRanks: Record<string, number | null>;
}

/**
 * Calculates and persists league table ranks and rank movements (rankChange) for all members.
 * rankChange > 0 means the player moved UP (e.g. from 5 to 3 => +2)
 * rankChange < 0 means the player moved DOWN (e.g. from 3 to 5 => -2)
 * rankChange = 0 means rank remained unchanged
 */
export async function calculateAndSaveLeaguePlayerRanks(
  leagueId: string,
  seasonId?: string | null,
  triggerMatchId?: string | null
): Promise<LeaguePlayerRankResult> {
  const emptyResult: LeaguePlayerRankResult = {
    rankChanges: {},
    currentRanks: {},
    previousRanks: {},
  };

  if (!leagueId) return emptyResult;

  try {
    // 1. Fetch scoring configuration (showPoints: true = Advanced / XP, false = PTS)
    let showPoints = true;
    if (seasonId) {
      const seasonRows = await sequelize.query<{ id: string; showPoints: boolean }>(
        `SELECT id, "showPoints" FROM "Seasons" WHERE id = $1 LIMIT 1`,
        { bind: [seasonId], type: QueryTypes.SELECT }
      );
      if (seasonRows && seasonRows.length > 0 && seasonRows[0].showPoints !== null && seasonRows[0].showPoints !== undefined) {
        showPoints = seasonRows[0].showPoints !== false;
      } else {
        const leagueRows = await sequelize.query<{ id: string; showPoints: boolean }>(
          `SELECT id, "showPoints" FROM "Leagues" WHERE id = $1 LIMIT 1`,
          { bind: [leagueId], type: QueryTypes.SELECT }
        );
        showPoints = leagueRows?.[0]?.showPoints !== false;
      }
    } else {
      const leagueRows = await sequelize.query<{ id: string; showPoints: boolean }>(
        `SELECT id, "showPoints" FROM "Leagues" WHERE id = $1 LIMIT 1`,
        { bind: [leagueId], type: QueryTypes.SELECT }
      );
      showPoints = leagueRows?.[0]?.showPoints !== false;
    }

    // 2. Fetch members for this league / season
    let members: Array<{ id: string; firstName: string; lastName: string; xp: number }> = [];

    if (seasonId) {
      members = await sequelize.query<{ id: string; firstName: string; lastName: string; xp: number }>(`
        SELECT DISTINCT u.id, u."firstName", u."lastName", COALESCE(u.xp, 0) as xp
        FROM users u
        JOIN "SeasonPlayers" sp ON sp."userId" = u.id
        WHERE sp."seasonId" = $1
          AND (u.provider IS NULL OR u.provider != 'guest')
          AND COALESCE(u.email, '') NOT ILIKE '%guest%'
      `, { bind: [seasonId], type: QueryTypes.SELECT });

      // Fallback: If SeasonPlayers is empty, fetch all members from LeagueMember
      if (!members || members.length === 0) {
        members = await sequelize.query<{ id: string; firstName: string; lastName: string; xp: number }>(`
          SELECT DISTINCT u.id, u."firstName", u."lastName", COALESCE(u.xp, 0) as xp
          FROM users u
          JOIN "LeagueMember" lm ON lm."userId" = u.id
          WHERE lm."leagueId" = $1
            AND (u.provider IS NULL OR u.provider != 'guest')
            AND COALESCE(u.email, '') NOT ILIKE '%guest%'
        `, { bind: [leagueId], type: QueryTypes.SELECT });
      }
    } else {
      members = await sequelize.query<{ id: string; firstName: string; lastName: string; xp: number }>(`
        SELECT DISTINCT u.id, u."firstName", u."lastName", COALESCE(u.xp, 0) as xp
        FROM users u
        JOIN "LeagueMember" lm ON lm."userId" = u.id
        WHERE lm."leagueId" = $1
          AND (u.provider IS NULL OR u.provider != 'guest')
          AND COALESCE(u.email, '') NOT ILIKE '%guest%'
      `, { bind: [leagueId], type: QueryTypes.SELECT });
    }

    if (!members || members.length === 0) return emptyResult;

    // 3. Fetch all completed matches with results
    let matchesQuery = `
      SELECT id, "seasonId", "homeTeamGoals", "awayTeamGoals", "date", "createdAt", status
      FROM "Matches"
      WHERE "leagueId" = $1
        AND (deleted IS NULL OR deleted = false)
        AND (archived IS NULL OR archived = false)
        AND status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
        AND "homeTeamGoals" IS NOT NULL
        AND "awayTeamGoals" IS NOT NULL
    `;
    const binds: any[] = [leagueId];
    if (seasonId) {
      matchesQuery += ` AND "seasonId" = $2`;
      binds.push(seasonId);
    }
    matchesQuery += ` ORDER BY "date" ASC, "createdAt" ASC`;

    const matches = await sequelize.query<{
      id: string;
      seasonId: string | null;
      homeTeamGoals: number;
      awayTeamGoals: number;
      date: string;
      createdAt: string;
      status: string;
    }>(matchesQuery, { bind: binds, type: QueryTypes.SELECT });

    const matchIds = matches.map(m => m.id);
    const matchHomeUsers = new Map<string, Set<string>>();
    const matchAwayUsers = new Map<string, Set<string>>();
    const matchUserXp = new Map<string, number>();

    if (matchIds.length > 0) {
      const [hUsers, aUsers, mStats] = await Promise.all([
        sequelize.query<{ matchId: string; userId: string }>(
          `SELECT "matchId", "userId" FROM "UserHomeMatches" WHERE "matchId" IN (:matchIds)`,
          { replacements: { matchIds }, type: QueryTypes.SELECT }
        ),
        sequelize.query<{ matchId: string; userId: string }>(
          `SELECT "matchId", "userId" FROM "UserAwayMatches" WHERE "matchId" IN (:matchIds)`,
          { replacements: { matchIds }, type: QueryTypes.SELECT }
        ),
        sequelize.query<{ match_id: string; user_id: string; xp_awarded: number }>(
          `SELECT match_id, user_id, COALESCE(xp_awarded, 0) as xp_awarded FROM match_statistics WHERE match_id IN (:matchIds)`,
          { replacements: { matchIds }, type: QueryTypes.SELECT }
        )
      ]);

      hUsers.forEach(row => {
        const mid = String(row.matchId);
        if (!matchHomeUsers.has(mid)) matchHomeUsers.set(mid, new Set());
        matchHomeUsers.get(mid)!.add(String(row.userId));
      });

      aUsers.forEach(row => {
        const mid = String(row.matchId);
        if (!matchAwayUsers.has(mid)) matchAwayUsers.set(mid, new Set());
        matchAwayUsers.get(mid)!.add(String(row.userId));
      });

      mStats.forEach(row => {
        matchUserXp.set(`${row.match_id}_${row.user_id}`, Number(row.xp_awarded) || 0);
      });
    }

    // Helper to compute standings map: userId => rank (1, 2, 3...)
    const computeStandings = (matchesSubset: typeof matches): Map<string, number> => {
      const userStats = new Map<string, {
        id: string;
        name: string;
        played: number;
        wins: number;
        draws: number;
        losses: number;
        goalsFor: number;
        goalsAgainst: number;
        goalDifference: number;
        xp: number;
      }>();

      members.forEach(m => {
        userStats.set(String(m.id), {
          id: String(m.id),
          name: `${m.firstName || ''} ${m.lastName || ''}`.trim(),
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          goalDifference: 0,
          xp: 0,
        });
      });

      matchesSubset.forEach(match => {
        const homeSet = matchHomeUsers.get(match.id) || new Set();
        const awaySet = matchAwayUsers.get(match.id) || new Set();
        const homeGoals = Number(match.homeTeamGoals ?? 0);
        const awayGoals = Number(match.awayTeamGoals ?? 0);
        const homeWon = homeGoals > awayGoals;
        const awayWon = awayGoals > homeGoals;
        const isDraw = homeGoals === awayGoals;

        const processPlayer = (userId: string, isHome: boolean) => {
          let st = userStats.get(userId);
          if (!st) {
            st = {
              id: userId,
              name: '',
              played: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              goalsFor: 0,
              goalsAgainst: 0,
              goalDifference: 0,
              xp: 0,
            };
            userStats.set(userId, st);
          }
          st.played++;
          st.goalsFor += (isHome ? homeGoals : awayGoals);
          st.goalsAgainst += (isHome ? awayGoals : homeGoals);
          st.goalDifference = st.goalsFor - st.goalsAgainst;
          if ((isHome && homeWon) || (!isHome && awayWon)) st.wins++;
          else if (isDraw) st.draws++;
          else st.losses++;

          const xpAwarded = matchUserXp.get(`${match.id}_${userId}`) || 0;
          st.xp += xpAwarded;
        };

        homeSet.forEach(uid => processPlayer(uid, true));
        awaySet.forEach(uid => processPlayer(uid, false));
      });

      const list = Array.from(userStats.values());

      // Sorting rules match client TableData sort exactly:
      // Primary: Score (XP if showPoints else Points)
      // Secondary: Wins DESC
      // Tertiary: Games Played ASC (fewer is better)
      // Quaternary: Goal Difference DESC
      // Quinary: Name ASC
      list.sort((a, b) => {
        const aPlayed = a.played > 0 ? 1 : 0;
        const bPlayed = b.played > 0 ? 1 : 0;
        if (bPlayed !== aPlayed) return bPlayed - aPlayed;
        const aPts = a.wins * 3 + a.draws;
        const bPts = b.wins * 3 + b.draws;
        const aScore = showPoints ? a.xp : aPts;
        const bScore = showPoints ? b.xp : bPts;
        if (bScore !== aScore) return bScore - aScore;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (a.played !== b.played) return a.played - b.played;
        if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return (a.name || '').localeCompare(b.name || '');
      });

      const ranks = new Map<string, number>();
      list.forEach((p, idx) => {
        ranks.set(p.id, idx + 1);
      });
      return ranks;
    };

    // 4. Calculate current standings
    const currentRanksMap = computeStandings(matches);

    // 5. Determine previous ranks (standings before the latest completed match)
    const existingRows = await sequelize.query<{
      userId: string;
      currentRank: number;
      previousRank: number | null;
      lastMatchId: string | null;
    }>(`
      SELECT "userId", "currentRank", "previousRank", "lastMatchId"
      FROM "LeaguePlayerRanks"
      WHERE "leagueId" = $1
        AND ($2::uuid IS NULL AND "seasonId" IS NULL OR "seasonId" = $2)
    `, { bind: [leagueId, seasonId || null], type: QueryTypes.SELECT });

    const existingMap = new Map(existingRows.map(r => [String(r.userId), r]));

    // Standings before the latest completed match:
    const priorMatches = matches.length > 1 ? matches.slice(0, matches.length - 1) : [];
    const priorRanksMap = priorMatches.length > 0 ? computeStandings(priorMatches) : null;

    const rankChanges: Record<string, number> = {};
    const currentRanks: Record<string, number> = {};
    const previousRanks: Record<string, number | null> = {};

    const lastMatch = matches.length > 0 ? matches[matches.length - 1] : null;
    const effectiveLastMatchId = triggerMatchId || lastMatch?.id || null;

    // 6. Build rank updates and persist
    const upsertPromises = members.map(async (m) => {
      const uid = String(m.id);
      const curr = currentRanksMap.get(uid) ?? members.length;
      let prev: number | null = null;

      if (priorRanksMap && priorRanksMap.has(uid)) {
        prev = priorRanksMap.get(uid)!;
      } else {
        const existing = existingMap.get(uid);
        if (existing && typeof existing.previousRank === 'number') {
          prev = existing.previousRank;
        } else {
          prev = curr;
        }
      }

      // rankChange: positive if moved up (e.g. from 3 to 1 => +2), negative if moved down (e.g. from 1 to 2 => -1)
      const change = prev != null ? (prev - curr) : 0;

      rankChanges[uid] = change;
      currentRanks[uid] = curr;
      previousRanks[uid] = prev;

      await sequelize.query(`
        INSERT INTO "LeaguePlayerRanks" (
          "id", "leagueId", "seasonId", "userId", "currentRank", "previousRank", "rankChange", "lastMatchId", "createdAt", "updatedAt"
        )
        VALUES (
          gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW(), NOW()
        )
        ON CONFLICT ("leagueId", "userId", COALESCE("seasonId", '00000000-0000-0000-0000-000000000000'::uuid))
        DO UPDATE SET
          "previousRank" = EXCLUDED."previousRank",
          "currentRank" = EXCLUDED."currentRank",
          "rankChange" = EXCLUDED."rankChange",
          "lastMatchId" = EXCLUDED."lastMatchId",
          "updatedAt" = NOW()
      `, {
        bind: [
          leagueId,
          seasonId || null,
          uid,
          curr,
          prev,
          change,
          effectiveLastMatchId
        ],
        type: QueryTypes.UPSERT
      });
    });

    await Promise.all(upsertPromises);

    // Invalidate caches so callers get fresh data
    try {
      cache.clearPattern(`league_${leagueId}`);
    } catch { }

    return { rankChanges, currentRanks, previousRanks };
  } catch (err) {
    console.error('Error calculating league player ranks:', err);
    return emptyResult;
  }
}

/**
 * Retrieves persisted rank movements for a league (and optional season).
 * If no records exist yet in the database, automatically calculates and persists them.
 */
export async function getLeaguePlayerRanks(
  leagueId: string,
  seasonId?: string | null
): Promise<LeaguePlayerRankResult> {
  if (!leagueId) return { rankChanges: {}, currentRanks: {}, previousRanks: {} };

  try {
    const rows = await sequelize.query<{
      userId: string;
      currentRank: number;
      previousRank: number | null;
      rankChange: number;
    }>(`
      SELECT "userId", "currentRank", "previousRank", "rankChange"
      FROM "LeaguePlayerRanks"
      WHERE "leagueId" = $1
        AND ($2::uuid IS NULL AND "seasonId" IS NULL OR "seasonId" = $2)
    `, { bind: [leagueId, seasonId || null], type: QueryTypes.SELECT });

    if (rows && rows.length > 0) {
      const rankChanges: Record<string, number> = {};
      const currentRanks: Record<string, number> = {};
      const previousRanks: Record<string, number | null> = {};

      rows.forEach(r => {
        const uid = String(r.userId);
        rankChanges[uid] = Number(r.rankChange) || 0;
        currentRanks[uid] = Number(r.currentRank);
        previousRanks[uid] = r.previousRank != null ? Number(r.previousRank) : null;
      });

      return { rankChanges, currentRanks, previousRanks };
    }

    // Auto-populate if none exists yet
    return await calculateAndSaveLeaguePlayerRanks(leagueId, seasonId);
  } catch (err) {
    console.error('Error getting league player ranks:', err);
    return { rankChanges: {}, currentRanks: {}, previousRanks: {} };
  }
}
