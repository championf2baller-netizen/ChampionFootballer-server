import { Context } from 'koa';
import models from '../models';
import { Op, QueryTypes } from 'sequelize';
import cache from '../utils/cache';
import sequelize from '../config/database';
import { registeredUserWhere } from '../utils/playerIdentity';

const { User: UserModel, Match: MatchModel, MatchStatistics, League: LeagueModel, Vote } = models;

export const getAllPlayers = async (ctx: Context) => {
  const cacheKey = 'players_all_registered_v2_ultra_fast';
  const cached = cache.get(cacheKey);
  if (cached) {
    ctx.set('X-Cache', 'HIT');
    ctx.body = cached;
    return;
  }

  try {
    const players = await UserModel.findAll({
      attributes: ['id', 'firstName', 'lastName', 'profilePicture', 'xp', 'position', 'positionType'],
      where: {
        ...registeredUserWhere(),
        xp: { [Op.gt]: 0 }
      },
      order: [['xp', 'DESC']],
      limit: 50
    });

    const result = {
      success: true,
      players: players.map(p => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        profilePicture: p.profilePicture,
        rating: p.xp || 0,
        position: p.position,
        positionType: p.positionType,
      })),
    };
    cache.set(cacheKey, result, 1800);
    ctx.set('X-Cache', 'MISS');
    ctx.body = result;
  } catch (error) {
    console.error('Error fetching all players:', error);
    ctx.throw(500, 'Failed to fetch players.');
  }
};

export const getPlayerById = async (ctx: Context) => {
  const { id } = ctx.params;

  try {
    const player = await UserModel.findByPk(id, {
      attributes: { exclude: ['password'] },
      include: [
        {
          model: LeagueModel,
          as: 'leagues',
          attributes: ['id', 'name', 'image'],
          through: { attributes: [] }
        },
        {
          model: MatchStatistics,
          as: 'statistics',
          attributes: ['id', 'goals', 'assists', 'cleanSheets', 'impact', 'xpAwarded'],
          required: false
        }
      ]
    });

    if (!player) {
      ctx.throw(404, 'Player not found');
      return;
    }

    ctx.body = {
      success: true,
      player
    };
  } catch (error) {
    console.error('Error fetching player:', error);
    ctx.throw(500, 'Failed to fetch player.');
  }
};

export const getPlayerStats = async (ctx: Context) => {
  const { id } = ctx.params;
  const { leagueId, year, seasonId } = ctx.query as { leagueId?: string; year?: string; seasonId?: string };

  try {
    const player = await UserModel.findByPk(id, {
      attributes: ['id'],
      include: [{ model: LeagueModel, as: 'leagues', attributes: ['id', 'name', 'image', 'createdAt', 'updatedAt'] }]
    });

    if (!player) {
      ctx.throw(404, 'Player not found');
      return;
    }

    const VALID_MATCH_STATUSES = ['RESULT_PUBLISHED', 'RESULT_UPLOADED', 'REVISION_REQUESTED'];

    const matchWhere: Record<string, unknown> = {
      status: { [Op.in]: VALID_MATCH_STATUSES },
      deleted: { [Op.ne]: true }
    };
    let shouldUseSeasonScope = Boolean(seasonId && seasonId !== 'all');

    if (leagueId && leagueId !== 'all') {
      matchWhere.leagueId = leagueId;

      if (shouldUseSeasonScope) {
        const legacyUnseasonedMatches = await MatchModel.count({
          where: {
            leagueId,
            seasonId: { [Op.is]: null },
            status: { [Op.in]: VALID_MATCH_STATUSES },
            deleted: { [Op.ne]: true }
          } as any
        });
        shouldUseSeasonScope = legacyUnseasonedMatches === 0;
      }
    }

    if (shouldUseSeasonScope) {
      matchWhere.seasonId = seasonId;
    }

    if (year && year !== 'all') {
      const y = Number(year);
      if (!Number.isNaN(y)) {
        matchWhere.date = {
          [Op.gte]: new Date(Date.UTC(y, 0, 1)),
          [Op.lt]: new Date(Date.UTC(y + 1, 0, 1))
        };
      }
    }

    // Fetch match IDs where user participated via MatchStatistics AND join tables
    const userStatsRows = await MatchStatistics.findAll({
      where: { user_id: id },
      attributes: ['match_id', 'goals', 'assists', 'cleanSheets', 'defence', 'impact', 'xpAwarded'],
      raw: true
    });

    const HomeModel = (sequelize.models as any)?.UserHomeMatches;
    const AwayModel = (sequelize.models as any)?.UserAwayMatches;

    const [homeMembershipRows, awayMembershipRows] = await Promise.all([
      HomeModel ? HomeModel.findAll({ where: { userId: id }, attributes: ['matchId'], raw: true }) : Promise.resolve([]),
      AwayModel ? AwayModel.findAll({ where: { userId: id }, attributes: ['matchId'], raw: true }) : Promise.resolve([])
    ]);

    const homeMatchIdSet = new Set((homeMembershipRows as any[]).map((r: any) => String(r.matchId || '')).filter(Boolean));
    const awayMatchIdSet = new Set((awayMembershipRows as any[]).map((r: any) => String(r.matchId || '')).filter(Boolean));
    const statsByMatchId = new Map<string, any>();
    (userStatsRows as any[]).forEach((s: any) => {
      const mid = String(s.match_id || '').trim();
      if (mid) statsByMatchId.set(mid, s);
    });

    const allPlayerMatchIds = Array.from(new Set([
      ...Array.from(statsByMatchId.keys()),
      ...Array.from(homeMatchIdSet),
      ...Array.from(awayMatchIdSet)
    ]));

    if (allPlayerMatchIds.length === 0) {
      const emptyStats = {
        goals: 0, assists: 0, motm: 0, rating: 0, matches: 0, played: 0,
        wins: 0, draws: 0, losses: 0, cleanSheets: 0, defence: 0, impact: 0,
        contributionIndex: 0, motmVotes: 0, defensiveImpact: 0, defensiveImpactVotes: 0,
        mentality: 0, teamGoalsConceded: 0, totalXP: 0, xp: 0, avgXP: 0, winRate: 0,
        recentMatches: [], last10: []
      };
      ctx.body = { success: true, stats: emptyStats, data: { leagues: [] } };
      return;
    }

    matchWhere.id = { [Op.in]: allPlayerMatchIds };

    const matches = await MatchModel.findAll({
      where: matchWhere,
      attributes: [
        'id', 'date', 'leagueId', 'seasonId', 'homeTeamGoals', 'awayTeamGoals',
        'status', 'homeCaptainId', 'awayCaptainId', 'homeDefensiveImpactId',
        'awayDefensiveImpactId', 'homeMentalityId', 'awayMentalityId'
      ],
      include: [
        { model: UserModel, as: 'homeTeamUsers', attributes: ['id'] },
        { model: UserModel, as: 'awayTeamUsers', attributes: ['id'] }
      ],
      order: [['date', 'ASC']]
    });

    const matchIds = matches.map((m: any) => String(m.id));

    const votes = matchIds.length
      ? await Vote.findAll({
        where: { matchId: { [Op.in]: matchIds }, votedForId: id },
        attributes: ['matchId'],
        raw: true
      })
      : [];

    const votesByMatch: Record<string, number> = {};
    (votes as any[]).forEach((v) => {
      const mid = String(v.matchId);
      votesByMatch[mid] = (votesByMatch[mid] || 0) + 1;
    });

    let played = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let goals = 0;
    let assists = 0;
    let cleanSheets = 0;
    let defence = 0;
    let totalImpact = 0;
    let totalXP = 0;
    let teamGoalsConceded = 0;
    let motmVotes = 0;
    let defensiveImpact = 0;
    let mentality = 0;

    const matchDetailsList: Array<{
      id: string;
      matchId: string;
      date: string;
      result: 'W' | 'L' | 'D';
      teamGoals: number;
      opponentGoals: number;
      goals: number;
      assists: number;
      cleanSheets: number;
      motmVotes: number;
      impact: number;
      defence: number;
    }> = [];

    matches.forEach((match: any) => {
      const matchId = String(match.id);
      const statRow = statsByMatchId.get(matchId) || {};

      const homeUserIds = (match.homeTeamUsers || []).map((u: any) => String(u.id));
      const awayUserIds = (match.awayTeamUsers || []).map((u: any) => String(u.id));

      let isHome = homeMatchIdSet.has(matchId) || homeUserIds.includes(String(id)) || String(match.homeCaptainId || '') === String(id);
      let isAway = awayMatchIdSet.has(matchId) || awayUserIds.includes(String(id)) || String(match.awayCaptainId || '') === String(id);

      if (!isHome && !isAway) {
        isHome = true;
      } else if (isHome && isAway) {
        if (homeMatchIdSet.has(matchId)) isAway = false;
        else if (awayMatchIdSet.has(matchId)) isHome = false;
        else isAway = false;
      }

      const homeGoals = Number(match.homeTeamGoals || 0);
      const awayGoals = Number(match.awayTeamGoals || 0);
      const teamGoals = isHome ? homeGoals : awayGoals;
      const oppGoals = isHome ? awayGoals : homeGoals;

      let result: 'W' | 'L' | 'D' = 'D';
      if (teamGoals > oppGoals) result = 'W';
      else if (teamGoals < oppGoals) result = 'L';

      const matchMotm = Number(votesByMatch[matchId] || 0);
      const g = Number(statRow.goals || 0);
      const a = Number(statRow.assists || 0);
      const cs = Number(statRow.cleanSheets || 0);
      const d = Number(statRow.defence || 0);
      const imp = Number(statRow.impact || 0);
      const xpVal = Number(statRow.xpAwarded || 0);

      played += 1;
      goals += g;
      assists += a;
      cleanSheets += cs;
      defence += d;
      totalImpact += imp;
      totalXP += xpVal;
      motmVotes += matchMotm;
      teamGoalsConceded += oppGoals;

      if (String(match.homeDefensiveImpactId || '') === String(id) || String(match.awayDefensiveImpactId || '') === String(id)) {
        defensiveImpact += 1;
      }
      if (String(match.homeMentalityId || '') === String(id) || String(match.awayMentalityId || '') === String(id)) {
        mentality += 1;
      }

      if (result === 'W') wins += 1;
      else if (result === 'D') draws += 1;
      else losses += 1;

      matchDetailsList.push({
        id: matchId,
        matchId,
        date: match.date,
        result,
        teamGoals,
        opponentGoals: oppGoals,
        goals: g,
        assists: a,
        cleanSheets: cs,
        motmVotes: matchMotm,
        impact: imp,
        defence: d
      });
    });

    const avgImpact = played > 0 ? +(totalImpact / played).toFixed(2) : 0;
    const avgXP = played > 0 ? Math.floor(((totalXP / played) + 1e-9) * 100) / 100 : 0;
    const winRate = played > 0 ? (wins / played) * 100 : 0;

    // Recent matches in descending date order (newest first)
    const recentMatches = [...matchDetailsList]
      .reverse()
      .slice(0, 10)
      .map((item, idx) => ({ ...item, isLatest: idx === 0 }));

    const totalStats = {
      // legacy keys
      goals,
      assists,
      motm: motmVotes,
      rating: avgImpact,
      matches: played,
      // canonical keys
      played,
      wins,
      draws,
      losses,
      winRate: Math.round(winRate * 10) / 10,
      cleanSheets,
      defence,
      impact: avgImpact,
      contributionIndex: avgImpact,
      motmVotes,
      defensiveImpact,
      defensiveImpactVotes: defensiveImpact,
      mentality,
      teamGoalsConceded,
      totalXP,
      xp: totalXP,
      avgXP,
      recentMatches,
      last10: recentMatches,
      lastFive: recentMatches,
      last10Results: recentMatches.map(m => m.result)
    };

    const leagues = ((player as any).leagues || []).map((l: any) => ({
      id: String(l.id),
      name: l.name || 'League',
      image: l.image,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt
    })).sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));

    ctx.body = {
      success: true,
      stats: totalStats,
      data: { leagues }
    };
  } catch (error) {
    console.error('Error fetching player stats:', error);
    ctx.throw(500, 'Failed to fetch player stats.');
  }
};

export const searchPlayers = async (ctx: Context) => {
  const { q } = ctx.query;

  if (!q || typeof q !== 'string') {
    ctx.throw(400, 'Search query is required');
    return;
  }

  try {
    const players = await UserModel.findAll({
      where: {
        ...registeredUserWhere(),
        [Op.or]: [
          { firstName: { [Op.iLike]: `%${q}%` } },
          { lastName: { [Op.iLike]: `%${q}%` } },
          { email: { [Op.iLike]: `%${q}%` } }
        ]
      },
      attributes: ['id', 'firstName', 'lastName', 'email', 'profilePicture', 'position', 'xp'],
      limit: 20
    });

    ctx.body = {
      success: true,
      players: players.map(p => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        email: p.email,
        profilePicture: p.profilePicture,
        position: p.position,
        rating: p.xp || 0
      }))
    };
  } catch (error) {
    console.error('Error searching players:', error);
    ctx.throw(500, 'Failed to search players.');
  }
};

// GET COMPLETE PLAYER PROFILE WITH LEAGUES, MATCHES AND STATS
export const getPlayerProfile = async (ctx: Context) => {
  const { id } = ctx.params;
  const { leagueId, year } = ctx.query;

  try {
    const cacheLeagueId = typeof leagueId === 'string' && leagueId.trim() && leagueId !== 'all' ? leagueId.trim() : 'all';
    const cacheYear = typeof year === 'string' && year.trim() && year !== 'all' ? year.trim() : 'all';

    const cacheKey = `player_profile_${id}_${cacheLeagueId}_${cacheYear}`;
    const hasForceRefresh = Boolean(ctx.query._t || ctx.query.bust || ctx.query.refresh);
    const cached = hasForceRefresh ? null : cache.get(cacheKey);
    if (cached) {
      ctx.body = cached;
      return;
    }

    // 1. Get player basic info
    const player = await UserModel.findByPk(id, {
      attributes: ['id', 'firstName', 'lastName', 'profilePicture', 'xp', 'position', 'positionType', 'shirtNumber', 'email'],
      include: [{
        model: LeagueModel,
        as: 'leagues',
        where: { archived: false },
        required: false,
        attributes: ['id', 'name', 'image', 'createdAt', 'updatedAt', 'active', 'archived']
      }]
    });

    if (!player) {
      ctx.throw(404, 'Player not found');
      return;
    }

    // 2. Get player stats and related match data in small queries.
    const statRows = await MatchStatistics.findAll({
      where: { user_id: id },
      attributes: ['id', 'goals', 'assists', 'cleanSheets', 'penalties', 'freeKicks', 'defence', 'impact', 'rating', 'xpAwarded', 'match_id'],
      raw: true,
    });

    const uniqueMatchIdsFromStats = Array.from(new Set((statRows as any[]).map((stat) => String(stat.match_id)).filter(Boolean)));
    const [homeMatches, awayMatches] = await Promise.all([
      sequelize.query(
        `SELECT "matchId" FROM "UserHomeMatches" WHERE "userId" = :playerId`,
        { replacements: { playerId: id }, type: 'SELECT' as any }
      ),
      sequelize.query(
        `SELECT "matchId" FROM "UserAwayMatches" WHERE "userId" = :playerId`,
        { replacements: { playerId: id }, type: 'SELECT' as any }
      )
    ]);

    const userHomeMatchIds = new Set((homeMatches as any[]).map((row) => String(row.matchId)));
    const userAwayMatchIds = new Set((awayMatches as any[]).map((row) => String(row.matchId)));

    const playedMatchIds = Array.from(new Set([
      ...userHomeMatchIds,
      ...userAwayMatchIds
    ])).filter(Boolean);

    const uniqueMatchIds = Array.from(new Set([
      ...uniqueMatchIdsFromStats,
      ...playedMatchIds
    ])).filter(Boolean);

    const selectedLeagueId = typeof leagueId === 'string' && leagueId.trim() && leagueId !== 'all' ? leagueId.trim() : '';
    const selectedYear = typeof year === 'string' && year.trim() && year !== 'all' ? Number(year) : null;

    const VALID_MATCH_STATUSES = ['RESULT_PUBLISHED', 'RESULT_UPLOADED', 'REVISION_REQUESTED'];

    // Fetch all published matches for the player in a single query
    const allMatches: any[] = uniqueMatchIds.length
      ? await MatchModel.findAll({
        where: {
          id: { [Op.in]: uniqueMatchIds },
          status: { [Op.in]: VALID_MATCH_STATUSES },
          deleted: { [Op.ne]: true }
        },
        attributes: [
          'id',
          'date',
          'seasonId',
          'homeTeamName',
          'awayTeamName',
          'location',
          'leagueId',
          'end',
          'homeCaptainId',
          'awayCaptainId',
          'homeDefensiveImpactId',
          'awayDefensiveImpactId',
          'homeMentalityId',
          'awayMentalityId',
          'homeTeamGoals',
          'awayTeamGoals',
        ],
        raw: true,
      })
      : [];

    const allYears = [...new Set(
      allMatches
        .map((match) => match?.date ? new Date(match.date).getFullYear() : null)
        .filter((matchYear): matchYear is number => typeof matchYear === 'number' && Number.isFinite(matchYear))
    )];

    // Filter matches for the specific request in-memory
    let matchRows = allMatches;
    if (selectedLeagueId) {
      matchRows = matchRows.filter((match) => String(match.leagueId) === selectedLeagueId);
    }
    if (selectedYear && Number.isFinite(selectedYear)) {
      matchRows = matchRows.filter((match) => new Date(match.date).getFullYear() === selectedYear);
    }

    const visibleMatchIds = matchRows.map((match) => String(match.id));
    const visibleMatchIdSet = new Set(visibleMatchIds);
    const statsByMatchId = new Map<string, any>();
    (statRows as any[]).forEach((stat) => {
      const matchId = String(stat.match_id);
      if (visibleMatchIdSet.has(matchId)) {
        statsByMatchId.set(matchId, stat);
      }
    });

    const voteRows = visibleMatchIds.length
      ? await Vote.findAll({
        where: { matchId: { [Op.in]: visibleMatchIds } },
        attributes: ['voterId', 'votedForId', 'matchId'],
        raw: true,
      })
      : [];

    const votesByMatchId = new Map<string, any[]>();
    (voteRows as any[]).forEach((vote) => {
      const matchId = String(vote.matchId);
      if (!votesByMatchId.has(matchId)) votesByMatchId.set(matchId, []);
      votesByMatchId.get(matchId)!.push(vote);
    });

    const teamByMatchId = new Map<string, 'home' | 'away'>();
    visibleMatchIds.forEach((mId) => {
      const matchObj = allMatches.find(m => String(m.id) === mId);
      if (userHomeMatchIds.has(mId) || String(matchObj?.homeCaptainId || '') === String(id)) {
        teamByMatchId.set(mId, 'home');
      } else if (userAwayMatchIds.has(mId) || String(matchObj?.awayCaptainId || '') === String(id)) {
        teamByMatchId.set(mId, 'away');
      } else {
        teamByMatchId.set(mId, 'home');
      }
    });

    const allStats = matchRows
      .map((match) => {
        let stat = statsByMatchId.get(String(match.id));
        if (!stat) {
          stat = {
            goals: 0,
            assists: 0,
            cleanSheets: 0,
            penalties: 0,
            freeKicks: 0,
            defence: 0,
            impact: 0,
            rating: 0,
            xpAwarded: 0,
            match_id: match.id,
          };
        }
        return {
          ...stat,
          match: {
            ...match,
            votes: votesByMatchId.get(String(match.id)) || [],
            playerTeam: teamByMatchId.get(String(match.id)) || null,
          },
        };
      })
      .filter(Boolean);

    // 3. Group matches by league
    const leaguesMap = new Map();
    const playerLeagues = (player as any).leagues || [];

    playerLeagues.forEach((league: any) => {
      if (Boolean(league?.archived) || String(league?.status || '').toLowerCase() === 'archived' || String(league?.status || '').toLowerCase() === 'inactive') return;
      leaguesMap.set(league.id, {
        id: league.id,
        name: league.name,
        image: league.image,
        createdAt: league.createdAt,
        updatedAt: league.updatedAt,
        active: league.active,
        archived: Boolean(league.archived),
        matches: []
      });
    });

    // Add matches with player stats to respective leagues
    allStats.forEach((stat: any) => {
      const match = stat.match;
      if (!match) return;

      const leagueId = match.leagueId;
      if (!leaguesMap.has(leagueId)) {
        // Skip if league is not in player's non-archived leagues
        return;
      }

      const isHomePlayer = match.playerTeam === 'home';
      const homeGoals = Number(match.homeTeamGoals || 0);
      const awayGoals = Number(match.awayTeamGoals || 0);
      const teamGoals = isHomePlayer ? homeGoals : awayGoals;
      const oppGoals = isHomePlayer ? awayGoals : homeGoals;
      const result: 'W' | 'D' | 'L' =
        teamGoals === oppGoals ? 'D' : (teamGoals > oppGoals ? 'W' : 'L');

      const matchVotes = match.votes || [];
      const motmVotesCount = matchVotes.filter((v: any) => String(v.votedForId) === String(id)).length;

      leaguesMap.get(leagueId).matches.push({
        id: match.id,
        date: match.date,
        seasonId: match.seasonId,
        homeTeamName: match.homeTeamName,
        awayTeamName: match.awayTeamName,
        location: match.location,
        end: match.end,
        homeDefensiveImpactId: match.homeDefensiveImpactId,
        awayDefensiveImpactId: match.awayDefensiveImpactId,
        homeMentalityId: match.homeMentalityId,
        awayMentalityId: match.awayMentalityId,
        homeTeamGoals: match.homeTeamGoals,
        awayTeamGoals: match.awayTeamGoals,
        result,
        votes: match.votes || [],
        playerStats: {
          id: stat.id,
          goals: stat.goals || 0,
          assists: stat.assists || 0,
          cleanSheets: stat.cleanSheets || 0,
          penalties: stat.penalties || 0,
          freeKicks: stat.freeKicks || 0,
          defence: stat.defence || 0,
          impact: stat.impact || 0,
          contributionIndex: stat.impact || 0,
          contributionIndexPercent: `${Number(stat.impact || 0)}%`,
          rating: stat.rating || 0,
          xpAwarded: Number(stat.xpAwarded || 0),
          result,
          teamGoals,
          opponentGoals: oppGoals,
          motmVotes: motmVotesCount
        }
      });
    });

    const leagues = Array.from(leaguesMap.values())
      .filter((l: any) => !Boolean(l.archived) && (l.active === true || (Array.isArray(l.matches) && l.matches.length > 0)))
      .sort((a: any, b: any) =>
        String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
      );
    const validYears = [...new Set(
      allStats
        .map((s: any) => s.match?.date ? new Date(s.match.date).getFullYear() : null)
        .filter((y): y is number => typeof y === 'number' && Number.isFinite(y))
    )];

    // 4. Build response
    const response = {
      success: true,
      data: {
        player: {
          id: player.id,
          name: `${player.firstName || ''} ${player.lastName || ''}`.trim() || 'Player',
          avatar: player.profilePicture,
          profilePicture: player.profilePicture,
          position: player.position,
          positionType: player.positionType,
          shirtNo: player.shirtNumber,
          rating: player.xp || 0
        },
        leagues: leagues,
        years: validYears,
        allYears,
        currentStats: {},
        accumulativeStats: {},
        trophies: {}
      }
    };

    cache.set(cacheKey, response, 300);
    ctx.body = response;
  } catch (error) {
    console.error('Error fetching player profile:', error);
    ctx.throw(500, error instanceof Error ? error.message : 'Failed to fetch player profile.');
  }
};

export const getCareerDashboard = async (ctx: Context) => {
  const { id } = ctx.params;
  const { leagueId, year, seasonId } = ctx.query as { leagueId?: string; year?: string; seasonId?: string };

  const cacheKey = `career_dashboard_${id}_${leagueId || 'all'}_${year || 'all'}_${seasonId || 'all'}`;
  const hasForceRefresh = Boolean(ctx.query._t || ctx.query.bust || ctx.query.refresh);
  const cached = hasForceRefresh ? null : cache.get(cacheKey);
  if (cached) {
    ctx.body = cached;
    return;
  }

  try {
    const player = await UserModel.findByPk(id, {
      attributes: ['id', 'firstName', 'lastName', 'position', 'positionType', 'profilePicture', 'shirtNumber', 'xp']
    });

    if (!player) {
      ctx.throw(404, 'Player not found');
      return;
    }

    const playerName = `${player.firstName || ''} ${player.lastName || ''}`.trim() || 'Player';
    const playerPosition = player.position || player.positionType || '';

    // Match filter criteria
    const matchWhere: Record<string, unknown> = {
      status: { [Op.in]: ['RESULT_PUBLISHED', 'RESULT_UPLOADED'] },
      deleted: { [Op.ne]: true }
    };
    if (leagueId && leagueId !== 'all') {
      matchWhere.leagueId = leagueId;
    }
    if (seasonId && seasonId !== 'all') {
      matchWhere.seasonId = seasonId;
    }
    let yearStart: Date | null = null;
    let yearEnd: Date | null = null;
    if (year && year !== 'all') {
      const y = Number(year);
      if (!Number.isNaN(y)) {
        yearStart = new Date(Date.UTC(y, 0, 1));
        yearEnd = new Date(Date.UTC(y + 1, 0, 1));
        matchWhere.date = {
          [Op.gte]: yearStart,
          [Op.lt]: yearEnd
        };
      }
    }

    // Fetch match IDs where user participated via MatchStatistics AND join tables
    const userStatsRows = await MatchStatistics.findAll({
      where: { user_id: id },
      attributes: ['match_id', 'goals', 'assists', 'cleanSheets', 'defence', 'impact', 'xpAwarded'],
      raw: true
    });

    const HomeModel = (sequelize.models as any)?.UserHomeMatches;
    const AwayModel = (sequelize.models as any)?.UserAwayMatches;

    const [homeMembershipRows, awayMembershipRows] = await Promise.all([
      HomeModel ? HomeModel.findAll({ where: { userId: id }, attributes: ['matchId'], raw: true }) : Promise.resolve([]),
      AwayModel ? AwayModel.findAll({ where: { userId: id }, attributes: ['matchId'], raw: true }) : Promise.resolve([])
    ]);

    const homeMatchIdSet = new Set((homeMembershipRows as any[]).map((r: any) => String(r.matchId || '')).filter(Boolean));
    const awayMatchIdSet = new Set((awayMembershipRows as any[]).map((r: any) => String(r.matchId || '')).filter(Boolean));
    const statsByMatchId = new Map<string, any>();
    (userStatsRows as any[]).forEach((s: any) => {
      const mid = String(s.match_id || '').trim();
      if (mid) statsByMatchId.set(mid, s);
    });

    const allPlayerMatchIds = Array.from(new Set([
      ...Array.from(statsByMatchId.keys()),
      ...Array.from(homeMatchIdSet),
      ...Array.from(awayMatchIdSet)
    ]));

    if (allPlayerMatchIds.length === 0) {
      const emptyDashboard = {
        success: true,
        data: {
          playerId: String(id),
          playerName,
          playerPosition,
          filters: { leagueId: leagueId || 'all', year: year || 'all', seasonId: seasonId || 'all' },
          yourStats: { n: 0, played: 0, wins: 0, draws: 0, losses: 0, winRate: 0, impactAvg: 0, motmVotes: 0, defence: 0, defensiveImpactVotes: 0, ga: 0, goals: 0, assists: 0, cleanSheets: 0, matchesWithGoals: 0, matchesWithAssists: 0, matchesWithCleanSheets: 0, captainMatchesCount: 0, captainWinsCount: 0, captainWinRate: 0 },
          lastPrev10: { last: { n: 0, wins: 0, draws: 0, losses: 0, winRate: 0, impactAvg: 0, motmVotes: 0, ga: 0, goals: 0, assists: 0, cleanSheets: 0, matchesWithGoals: 0, matchesWithAssists: 0, matchesWithCleanSheets: 0 }, prev: { n: 0, wins: 0, draws: 0, losses: 0, winRate: 0, impactAvg: 0, motmVotes: 0, ga: 0, goals: 0, assists: 0, cleanSheets: 0, matchesWithGoals: 0, matchesWithAssists: 0, matchesWithCleanSheets: 0 }, matches: [], results: [] },
          last10: [],
          lastFive: [],
          recentMatches: [],
          last10Results: [],
          leagueAverage: { goals: 0.8, assists: 0.5, cleanSheets: 0.3, defence: 0.5, motmVotes: 0.4, defensiveImpactVotes: 0.3, impact: 55, winRate: 50, wins: 2.5, expectedGoals: 0.5, expectedAssists: 0.4, expectedCleanSheets: 0.1 },
          impactRows: [],
          impactTable: [],
          leagueComparisonRows: [],
          topStrengths: { rows: [], note: '', narrative: null },
          focusSuggestion: 'Play a few more games to unlock a personalized focus area.',
          winLossBreakdown: [
            { name: 'Win', value: 0, color: '#15b57a', fill: '#15b57a' },
            { name: 'Loss', value: 0, color: '#d22f2f', fill: '#d22f2f' },
            { name: 'Draw', value: 0, color: '#ff4bd2', fill: '#ff4bd2' }
          ],
          influenceRadar: [],
          playerMaxSingleMatchStats: { goals: 0, assists: 0, motmVotes: 0 }
        }
      };
      ctx.body = emptyDashboard;
      return;
    }

    matchWhere.id = { [Op.in]: allPlayerMatchIds };

    const matches = await MatchModel.findAll({
      where: matchWhere,
      attributes: [
        'id', 'date', 'leagueId', 'seasonId', 'homeTeamGoals', 'awayTeamGoals',
        'status', 'homeCaptainId', 'awayCaptainId', 'homeDefensiveImpactId',
        'awayDefensiveImpactId'
      ],
      include: [
        { model: UserModel, as: 'homeTeamUsers', attributes: ['id'] },
        { model: UserModel, as: 'awayTeamUsers', attributes: ['id'] }
      ],
      order: [['date', 'ASC']]
    });

    const matchIds = matches.map((m: any) => String(m.id));

    // Fetch MOTM votes
    const votes = matchIds.length
      ? await Vote.findAll({
        where: { matchId: { [Op.in]: matchIds }, votedForId: id },
        attributes: ['matchId'],
        raw: true
      })
      : [];

    const votesByMatch: Record<string, number> = {};
    (votes as any[]).forEach((v) => {
      const mid = String(v.matchId);
      votesByMatch[mid] = (votesByMatch[mid] || 0) + 1;
    });

    // Process played matches
    let played = 0;
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let goals = 0;
    let assists = 0;
    let cleanSheets = 0;
    let defence = 0;
    let totalImpact = 0;
    let motmVotes = 0;
    let defensiveImpactVotes = 0;
    let captainMatchesCount = 0;
    let captainWinsCount = 0;
    let matchesWithGoals = 0;
    let matchesWithAssists = 0;
    let matchesWithCleanSheets = 0;

    const playedMatchesList: Array<{
      match: any;
      stat: any;
      result: 'W' | 'L' | 'D';
      teamGoals: number;
      oppGoals: number;
      motmVotes: number;
    }> = [];

    matches.forEach((match: any) => {
      const matchId = String(match.id);
      const statRow = statsByMatchId.get(matchId) || {};

      const homeUserIds = (match.homeTeamUsers || []).map((u: any) => String(u.id));
      const awayUserIds = (match.awayTeamUsers || []).map((u: any) => String(u.id));

      let isHome = homeMatchIdSet.has(matchId) || homeUserIds.includes(String(id)) || String(match.homeCaptainId || '') === String(id);
      let isAway = awayMatchIdSet.has(matchId) || awayUserIds.includes(String(id)) || String(match.awayCaptainId || '') === String(id);

      if (!isHome && !isAway) {
        isHome = true;
      } else if (isHome && isAway) {
        if (homeMatchIdSet.has(matchId)) isAway = false;
        else if (awayMatchIdSet.has(matchId)) isHome = false;
        else isAway = false;
      }

      const homeGoals = Number(match.homeTeamGoals || 0);
      const awayGoals = Number(match.awayTeamGoals || 0);
      const teamGoals = isHome ? homeGoals : awayGoals;
      const oppGoals = isHome ? awayGoals : homeGoals;

      let result: 'W' | 'L' | 'D' = 'D';
      if (teamGoals > oppGoals) result = 'W';
      else if (teamGoals < oppGoals) result = 'L';

      const matchMotm = Number(votesByMatch[matchId] || 0);
      const g = Number(statRow.goals || 0);
      const a = Number(statRow.assists || 0);
      const cs = Number(statRow.cleanSheets || 0);
      const d = Number(statRow.defence || 0);
      const imp = Number(statRow.impact || 0);

      played += 1;
      goals += g;
      assists += a;
      cleanSheets += cs;
      defence += d;
      totalImpact += imp;
      motmVotes += matchMotm;

      if (g > 0) matchesWithGoals += 1;
      if (a > 0) matchesWithAssists += 1;
      if (cs > 0) matchesWithCleanSheets += 1;

      if (result === 'W') wins += 1;
      else if (result === 'D') draws += 1;
      else losses += 1;

      const isHomeCaptain = String(match.homeCaptainId || '') === String(id);
      const isAwayCaptain = String(match.awayCaptainId || '') === String(id);
      if (isHomeCaptain || isAwayCaptain) {
        captainMatchesCount += 1;
        if (result === 'W') captainWinsCount += 1;
      }

      const isHomeDef = String(match.homeDefensiveImpactId || '') === String(id);
      const isAwayDef = String(match.awayDefensiveImpactId || '') === String(id);
      if (isHomeDef || isAwayDef) defensiveImpactVotes += 1;

      playedMatchesList.push({ match, stat: statRow, result, teamGoals, oppGoals, motmVotes: matchMotm });
    });

    const winRate = played > 0 ? (wins / played) * 100 : 0;
    const impactAvg = played > 0 ? Math.max(0, Math.min(100, totalImpact / played)) : 0;
    const captainWinRate = captainMatchesCount > 0 ? (captainWinsCount / captainMatchesCount) * 100 : 0;

    const yourStats = {
      n: played,
      played,
      wins,
      draws,
      losses,
      winRate: Math.round(winRate * 10) / 10,
      impactAvg: Math.round(impactAvg * 10) / 10,
      motmVotes,
      defence,
      defensiveImpactVotes,
      ga: goals + assists,
      goals,
      assists,
      cleanSheets,
      matchesWithGoals,
      matchesWithAssists,
      matchesWithCleanSheets,
      captainMatchesCount,
      captainWinsCount,
      captainWinRate: Math.round(captainWinRate * 10) / 10,
    };

    // Helper for aggregate match set
    const aggregateMatchSet = (list: typeof playedMatchesList) => {
      const n = list.length;
      let w = 0, d = 0, l = 0;
      let g = 0, a = 0, cs = 0, impSum = 0, motm = 0;
      let mg = 0, ma = 0, mcs = 0;

      list.forEach((item) => {
        if (item.result === 'W') w++;
        else if (item.result === 'D') d++;
        else l++;

        const itemG = Number(item.stat.goals || 0);
        const itemA = Number(item.stat.assists || 0);
        const itemCs = Number(item.stat.cleanSheets || 0);
        g += itemG;
        a += itemA;
        cs += itemCs;
        impSum += Number(item.stat.impact || 0);
        motm += item.motmVotes;

        if (itemG > 0) mg++;
        if (itemA > 0) ma++;
        if (itemCs > 0) mcs++;
      });

      const wr = n > 0 ? (w / n) * 100 : 0;
      const imp = n > 0 ? impSum / n : 0;

      return {
        n,
        wins: w,
        draws: d,
        losses: l,
        winRate: Math.round(wr * 10) / 10,
        impactAvg: Math.round(imp * 10) / 10,
        motmVotes: motm,
        ga: g + a,
        goals: g,
        assists: a,
        cleanSheets: cs,
        matchesWithGoals: mg,
        matchesWithAssists: ma,
        matchesWithCleanSheets: mcs
      };
    };

    const last10Matches = playedMatchesList.slice(-10);
    const prev10Matches = playedMatchesList.slice(-20, -10);

    // Format last 10 matches in DESCENDING date order (newest first)
    const last10MatchList = [...last10Matches]
      .reverse()
      .map((item, idx) => ({
        id: String(item.match.id),
        matchId: String(item.match.id),
        date: item.match.date,
        result: item.result,
        teamGoals: item.teamGoals,
        opponentGoals: item.oppGoals,
        goals: Number(item.stat?.goals || 0),
        assists: Number(item.stat?.assists || 0),
        cleanSheets: Number(item.stat?.cleanSheets || 0),
        motmVotes: item.motmVotes,
        impact: Number(item.stat?.impact || 0),
        defence: Number(item.stat?.defence || 0),
        isLatest: idx === 0,
      }));

    const last10ResultsArray = last10MatchList.map((m) => m.result);

    const lastPrev10 = {
      last: aggregateMatchSet(last10Matches),
      prev: aggregateMatchSet(prev10Matches),
      matches: last10MatchList,
      results: last10ResultsArray
    };

    // League Benchmark Average (using database averages)
    let leagueAvgGoals = 0.8;
    let leagueAvgAssists = 0.5;
    let leagueAvgCleanSheets = 0.3;
    let leagueAvgDefence = 0.5;
    let leagueAvgMotmVotes = 0.4;
    let leagueAvgDefensiveImpactVotes = 0.3;
    let leagueAvgImpact = 55.0;
    let leagueAvgWinRate = 50.0;
    let leagueAvgWins = 2.5;
    let leagueAvgExpectedGoals = 0.5;
    let leagueAvgExpectedAssists = 0.4;
    let leagueAvgExpectedCleanSheets = 0.1;

    try {
      const avgResults: any = await sequelize.query(`
        WITH ActiveLeaguePlayers AS (
          SELECT 
            ms.user_id,
            COUNT(DISTINCT ms.match_id) AS matches_count,
            SUM(ms.goals) AS goals,
            SUM(ms.assists) AS assists,
            SUM(ms.clean_sheets) AS clean_sheets,
            SUM(ms.defence) AS defence,
            AVG(ms.impact) AS impact_avg
          FROM match_statistics ms
          INNER JOIN "Matches" m ON ms.match_id = m.id
          INNER JOIN users u ON ms.user_id = u.id
          WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
            AND (m.deleted = false OR m.deleted IS NULL)
            AND (u.provider IS NULL OR u.provider != 'guest')
            AND (u.email IS NULL OR (u.email NOT ILIKE '%guest%' AND u.email NOT ILIKE '%@local.invalid'))
            ${leagueId && leagueId !== 'all' ? 'AND m."leagueId" = :leagueId' : ''}
            ${seasonId && seasonId !== 'all' ? 'AND m."seasonId" = :seasonId' : ''}
            ${yearStart ? 'AND m."date" >= :yearStart AND m."date" < :yearEnd' : ''}
          GROUP BY ms.user_id
        ),
        LeagueTotalMatches AS (
          SELECT COUNT(DISTINCT m.id) AS total_matches
          FROM "Matches" m
          INNER JOIN match_statistics ms ON m.id = ms.match_id
          INNER JOIN users u ON ms.user_id = u.id
          WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
            AND (m.deleted = false OR m.deleted IS NULL)
            AND (u.provider IS NULL OR u.provider != 'guest')
            AND (u.email IS NULL OR (u.email NOT ILIKE '%guest%' AND u.email NOT ILIKE '%@local.invalid'))
            ${leagueId && leagueId !== 'all' ? 'AND m."leagueId" = :leagueId' : ''}
            ${seasonId && seasonId !== 'all' ? 'AND m."seasonId" = :seasonId' : ''}
            ${yearStart ? 'AND m."date" >= :yearStart AND m."date" < :yearEnd' : ''}
        ),
        PlayerWins AS (
          SELECT
            alp.user_id,
            COUNT(m.id) AS wins
          FROM ActiveLeaguePlayers alp
          INNER JOIN "UserHomeMatches" uhm ON alp.user_id = uhm."userId"
          INNER JOIN "Matches" m ON uhm."matchId" = m.id
          WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
            AND (m.deleted = false OR m.deleted IS NULL)
            AND m."homeTeamGoals" > m."awayTeamGoals"
            ${leagueId && leagueId !== 'all' ? 'AND m."leagueId" = :leagueId' : ''}
            ${seasonId && seasonId !== 'all' ? 'AND m."seasonId" = :seasonId' : ''}
            ${yearStart ? 'AND m."date" >= :yearStart AND m."date" < :yearEnd' : ''}
          GROUP BY alp.user_id
          UNION ALL
          SELECT
            alp.user_id,
            COUNT(m.id) AS wins
          FROM ActiveLeaguePlayers alp
          INNER JOIN "UserAwayMatches" uam ON alp.user_id = uam."userId"
          INNER JOIN "Matches" m ON uam."matchId" = m.id
          WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
            AND (m.deleted = false OR m.deleted IS NULL)
            AND m."awayTeamGoals" > m."homeTeamGoals"
            ${leagueId && leagueId !== 'all' ? 'AND m."leagueId" = :leagueId' : ''}
            ${seasonId && seasonId !== 'all' ? 'AND m."seasonId" = :seasonId' : ''}
            ${yearStart ? 'AND m."date" >= :yearStart AND m."date" < :yearEnd' : ''}
          GROUP BY alp.user_id
        ),
        PlayerTotalWins AS (
          SELECT user_id, SUM(wins) AS wins
          FROM PlayerWins
          GROUP BY user_id
        ),
        PlayerMotm AS (
          SELECT v."votedForId" AS user_id, COUNT(*) AS motm_votes
          FROM "Votes" v
          INNER JOIN "Matches" m ON v."matchId" = m.id
          INNER JOIN ActiveLeaguePlayers alp ON v."votedForId" = alp.user_id
          WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
            AND (m.deleted = false OR m.deleted IS NULL)
            ${leagueId && leagueId !== 'all' ? 'AND m."leagueId" = :leagueId' : ''}
            ${seasonId && seasonId !== 'all' ? 'AND m."seasonId" = :seasonId' : ''}
            ${yearStart ? 'AND m."date" >= :yearStart AND m."date" < :yearEnd' : ''}
          GROUP BY v."votedForId"
        ),
        PlayerDefensiveImpact AS (
          SELECT m."homeDefensiveImpactId" AS user_id, COUNT(*) AS def_votes
          FROM "Matches" m
          INNER JOIN ActiveLeaguePlayers alp ON m."homeDefensiveImpactId" = alp.user_id
          WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
            AND (m.deleted = false OR m.deleted IS NULL)
            AND m."homeDefensiveImpactId" IS NOT NULL
            ${leagueId && leagueId !== 'all' ? 'AND m."leagueId" = :leagueId' : ''}
            ${seasonId && seasonId !== 'all' ? 'AND m."seasonId" = :seasonId' : ''}
            ${yearStart ? 'AND m."date" >= :yearStart AND m."date" < :yearEnd' : ''}
          GROUP BY m."homeDefensiveImpactId"
          UNION ALL
          SELECT m."awayDefensiveImpactId" AS user_id, COUNT(*) AS def_votes
          FROM "Matches" m
          INNER JOIN ActiveLeaguePlayers alp ON m."awayDefensiveImpactId" = alp.user_id
          WHERE m.status IN ('RESULT_PUBLISHED', 'RESULT_UPLOADED')
            AND (m.deleted = false OR m.deleted IS NULL)
            AND m."awayDefensiveImpactId" IS NOT NULL
            ${leagueId && leagueId !== 'all' ? 'AND m."leagueId" = :leagueId' : ''}
            ${seasonId && seasonId !== 'all' ? 'AND m."seasonId" = :seasonId' : ''}
            ${yearStart ? 'AND m."date" >= :yearStart AND m."date" < :yearEnd' : ''}
          GROUP BY m."awayDefensiveImpactId"
        ),
        PlayerTotalDefensiveImpact AS (
          SELECT user_id, SUM(def_votes) AS def_votes
          FROM PlayerDefensiveImpact
          GROUP BY user_id
        )
        SELECT 
          COUNT(alp.user_id) AS total_players,
          COALESCE((SELECT total_matches FROM LeagueTotalMatches), 0) AS total_matches,
          SUM(alp.goals) AS sum_goals,
          SUM(alp.assists) AS sum_assists,
          SUM(alp.clean_sheets) AS sum_clean_sheets,
          AVG(alp.goals) AS avg_goals,
          AVG(alp.assists) AS avg_assists,
          AVG(alp.clean_sheets) AS avg_clean_sheets,
          AVG(alp.defence) AS avg_defence,
          AVG(alp.impact_avg) AS avg_impact,
          AVG(COALESCE(pm.motm_votes, 0)) AS avg_motm_votes,
          AVG(COALESCE(ptw.wins, 0)) AS avg_wins,
          AVG(CASE WHEN alp.matches_count > 0 THEN (COALESCE(ptw.wins, 0)::float / alp.matches_count::float) * 100 ELSE 0 END) AS avg_win_rate,
          AVG(CASE WHEN alp.matches_count > 0 THEN (alp.goals::float / alp.matches_count::float) ELSE 0 END) AS avg_expected_goals,
          AVG(CASE WHEN alp.matches_count > 0 THEN (alp.assists::float / alp.matches_count::float) ELSE 0 END) AS avg_expected_assists,
          AVG(CASE WHEN alp.matches_count > 0 THEN (alp.clean_sheets::float / alp.matches_count::float) ELSE 0 END) AS avg_expected_clean_sheets,
          AVG(COALESCE(ptdi.def_votes, 0)) AS avg_def_votes
        FROM ActiveLeaguePlayers alp
        LEFT JOIN PlayerTotalWins ptw ON alp.user_id = ptw.user_id
        LEFT JOIN PlayerMotm pm ON alp.user_id = pm.user_id
        LEFT JOIN PlayerTotalDefensiveImpact ptdi ON alp.user_id = ptdi.user_id;
      `, {
        replacements: { leagueId, seasonId, yearStart, yearEnd },
        type: QueryTypes.SELECT
      });

      const avgRow = avgResults && avgResults[0];
      if (avgRow) {
        if (avgRow.avg_expected_goals != null) leagueAvgExpectedGoals = Number(avgRow.avg_expected_goals);
        if (avgRow.avg_expected_assists != null) leagueAvgExpectedAssists = Number(avgRow.avg_expected_assists);
        if (avgRow.avg_expected_clean_sheets != null) leagueAvgExpectedCleanSheets = Number(avgRow.avg_expected_clean_sheets);
        if (avgRow.avg_goals != null) leagueAvgGoals = Number(avgRow.avg_goals);
        if (avgRow.avg_assists != null) leagueAvgAssists = Number(avgRow.avg_assists);
        if (avgRow.avg_clean_sheets != null) leagueAvgCleanSheets = Number(avgRow.avg_clean_sheets);
        if (avgRow.avg_defence != null) leagueAvgDefence = Number(avgRow.avg_defence);
        if (avgRow.avg_impact != null) leagueAvgImpact = Number(avgRow.avg_impact);
        if (avgRow.avg_motm_votes != null) leagueAvgMotmVotes = Number(avgRow.avg_motm_votes);
        if (avgRow.avg_wins != null) leagueAvgWins = Number(avgRow.avg_wins);
        if (avgRow.avg_win_rate != null) leagueAvgWinRate = Number(avgRow.avg_win_rate);
        if (avgRow.avg_def_votes != null) leagueAvgDefensiveImpactVotes = Number(avgRow.avg_def_votes);
      }
    } catch (err) {
      console.warn('League benchmark query fallback:', err);
    }

    const leagueAverage = {
      goals: Math.round(leagueAvgGoals * 10) / 10,
      assists: Math.round(leagueAvgAssists * 10) / 10,
      cleanSheets: Math.round(leagueAvgCleanSheets * 10) / 10,
      defence: Math.round(leagueAvgDefence * 10) / 10,
      motmVotes: Math.round(leagueAvgMotmVotes * 10) / 10,
      defensiveImpactVotes: Math.round(leagueAvgDefensiveImpactVotes * 10) / 10,
      impact: Math.round(leagueAvgImpact * 10) / 10,
      winRate: Math.round(leagueAvgWinRate * 10) / 10,
      wins: Math.round(leagueAvgWins * 10) / 10,
      expectedGoals: Math.round(leagueAvgExpectedGoals * 10) / 10,
      expectedAssists: Math.round(leagueAvgExpectedAssists * 10) / 10,
      expectedCleanSheets: Math.round(leagueAvgExpectedCleanSheets * 10) / 10,
    };

    const formatStatDecimal = (value: number, suffix = ''): string => {
      const rounded = Math.round(Number(value) * 10) / 10;
      const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
      return `${display}${suffix}`;
    };

    // Formatted Impact Table Rows (xG, xA, xCS, Win Rate for Mobile App Impact Card)
    const expectedGoalsPerMatch = played > 0 ? goals / played : 0;
    const expectedAssistsPerMatch = played > 0 ? assists / played : 0;
    const expectedCleanSheetsPerMatch = played > 0 ? cleanSheets / played : 0;

    const impactRows = [
      {
        metric: 'Expected to score a goal (xG)',
        yourStats: formatStatDecimal(expectedGoalsPerMatch),
        leagueAverage: formatStatDecimal(leagueAverage.expectedGoals),
        yourValue: Math.round(expectedGoalsPerMatch * 10) / 10,
        leagueValue: leagueAverage.expectedGoals,
      },
      {
        metric: 'Expected to assist a goal (xA)',
        yourStats: formatStatDecimal(expectedAssistsPerMatch),
        leagueAverage: formatStatDecimal(leagueAverage.expectedAssists),
        yourValue: Math.round(expectedAssistsPerMatch * 10) / 10,
        leagueValue: leagueAverage.expectedAssists,
      },
      {
        metric: 'Expected to keep Clean Sheet (xCS)',
        yourStats: formatStatDecimal(expectedCleanSheetsPerMatch),
        leagueAverage: formatStatDecimal(leagueAverage.expectedCleanSheets),
        yourValue: Math.round(expectedCleanSheetsPerMatch * 10) / 10,
        leagueValue: leagueAverage.expectedCleanSheets,
      },
      {
        metric: 'Win rate',
        yourStats: `${Math.round(winRate)}%`,
        leagueAverage: `${Math.round(leagueAverage.winRate)}%`,
        yourValue: Math.round(winRate),
        leagueValue: Math.round(leagueAverage.winRate),
      },
    ];

    // Formatted Comparison Rows
    const leagueComparisonRows = [
      {
        metric: 'Goals',
        yourTotal: goals,
        yourDisplay: String(goals),
        leagueAverage: leagueAverage.goals,
        leagueDisplay: formatStatDecimal(leagueAverage.goals),
      },
      {
        metric: 'Assists',
        yourTotal: assists,
        yourDisplay: String(assists),
        leagueAverage: leagueAverage.assists,
        leagueDisplay: formatStatDecimal(leagueAverage.assists),
      },
      {
        metric: 'Clean Sheets',
        yourTotal: cleanSheets,
        yourDisplay: String(cleanSheets),
        leagueAverage: leagueAverage.cleanSheets,
        leagueDisplay: formatStatDecimal(leagueAverage.cleanSheets),
      },
      {
        metric: 'MOTM Votes',
        yourTotal: motmVotes,
        yourDisplay: String(motmVotes),
        leagueAverage: leagueAverage.motmVotes,
        leagueDisplay: formatStatDecimal(leagueAverage.motmVotes),
      },
      {
        metric: 'Defensive Impact Votes',
        yourTotal: defensiveImpactVotes,
        yourDisplay: String(defensiveImpactVotes),
        leagueAverage: leagueAverage.defensiveImpactVotes,
        leagueDisplay: formatStatDecimal(leagueAverage.defensiveImpactVotes),
      },
      {
        metric: 'Game Contribution Index',
        yourTotal: yourStats.impactAvg,
        yourDisplay: `${Math.round(yourStats.impactAvg)}%`,
        leagueAverage: leagueAverage.impact,
        leagueDisplay: formatStatDecimal(leagueAverage.impact, '%'),
      },
    ];

    if (captainMatchesCount > 0) {
      leagueComparisonRows.push({
        metric: 'Captains Performance',
        yourTotal: yourStats.captainWinRate,
        yourDisplay: `${Math.round(yourStats.captainWinRate)}%`,
        leagueAverage: leagueAverage.winRate,
        leagueDisplay: `${Math.round(leagueAverage.winRate)}%`,
      });
    }

    // Top Strengths evaluation
    const strengthCandidates = [
      {
        metric: '% Impact',
        rank: 1,
        yourTotal: yourStats.impactAvg,
        yourDisplay: `${Math.round(yourStats.impactAvg)}%`,
        leagueAverage: leagueAverage.impact,
        leagueDisplay: `${formatStatDecimal(leagueAverage.impact)}%`,
        qualified: played > 0 && leagueAverage.impact > 0 && yourStats.impactAvg >= 1.25 * leagueAverage.impact,
      },
      {
        metric: 'Wins',
        rank: 2,
        yourTotal: wins,
        yourDisplay: String(wins),
        leagueAverage: leagueAverage.wins,
        leagueDisplay: formatStatDecimal(leagueAverage.wins),
        qualified: leagueAverage.wins > 0 && wins >= 1.25 * leagueAverage.wins,
      },
      {
        metric: 'Captains Performance',
        rank: 3,
        yourTotal: captainWinsCount,
        yourDisplay: String(captainWinsCount),
        leagueAverage: leagueAverage.wins,
        leagueDisplay: formatStatDecimal(leagueAverage.wins),
        qualified: captainMatchesCount > 0 && captainWinsCount > leagueAverage.wins,
      },
      {
        metric: 'Frequent Top Performer',
        rank: 4,
        yourTotal: motmVotes,
        yourDisplay: String(motmVotes),
        leagueAverage: leagueAverage.motmVotes,
        leagueDisplay: formatStatDecimal(leagueAverage.motmVotes),
        qualified: leagueAverage.motmVotes > 0 && motmVotes >= 1.25 * leagueAverage.motmVotes,
      },
      {
        metric: 'Individual Brilliances',
        rank: 5,
        yourTotal: defensiveImpactVotes,
        yourDisplay: String(defensiveImpactVotes),
        leagueAverage: leagueAverage.defensiveImpactVotes,
        leagueDisplay: formatStatDecimal(leagueAverage.defensiveImpactVotes),
        qualified: defensiveImpactVotes > 3,
      },
      {
        metric: 'Clean Sheet',
        rank: 6,
        yourTotal: cleanSheets,
        yourDisplay: String(cleanSheets),
        leagueAverage: leagueAverage.cleanSheets,
        leagueDisplay: formatStatDecimal(leagueAverage.cleanSheets),
        qualified: cleanSheets > 0,
      },
      {
        metric: 'Goals',
        rank: 7,
        yourTotal: goals,
        yourDisplay: String(goals),
        leagueAverage: leagueAverage.goals,
        leagueDisplay: formatStatDecimal(leagueAverage.goals),
        qualified: goals > 0,
      },
      {
        metric: 'Assist',
        rank: 7,
        yourTotal: assists,
        yourDisplay: String(assists),
        leagueAverage: leagueAverage.assists,
        leagueDisplay: formatStatDecimal(leagueAverage.assists),
        qualified: assists > 0,
      },
    ];

    let qualifiedStrengths = strengthCandidates.filter(s => s.qualified);
    if (qualifiedStrengths.length === 0) {
      qualifiedStrengths = strengthCandidates.filter(s => s.yourTotal > 0);
    }
    qualifiedStrengths.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return b.yourTotal - a.yourTotal;
    });

    const top3Strengths = qualifiedStrengths.slice(0, 3).map(s => ({
      metric: s.metric,
      yourTotal: s.yourTotal,
      yourDisplay: s.yourDisplay,
      leagueAverage: s.leagueAverage,
      leagueDisplay: s.leagueDisplay,
    }));

    const strengthDescriptionMap: Record<string, string> = {
      '% Impact': 'Match Impact: 25% or more above the league average.',
      'Wins': 'Wins: 25% or more above the league average.',
      'Captains Performance': 'Captains Performance: Surpassed the average wins of all captains in the league.',
      'Frequent Top Performer': 'Frequent Top Performer: 25% or more MOTM votes than the league average.',
      'Individual Brilliances': "Individual Brilliances: Received the captain's pick for outstanding performance more than 3 times.",
      'Clean Sheet': 'Clean Sheet: Kept at least one clean sheet in matches.',
      'Goals': 'Goals: Scored at least one goal in matches.',
      'Assist': 'Assist: Made at least one assist in matches.',
    };

    const topStrengthNote = top3Strengths.length > 0
      ? strengthDescriptionMap[top3Strengths[0].metric] || `${top3Strengths[0].metric}: ${top3Strengths[0].yourDisplay}; league average ${top3Strengths[0].leagueDisplay}.`
      : '';

    const narrativeMessages: Record<string, string> = {
      'Goals': "You're among the top goal scorers! Ranked in the top 10% for goals scored in the league",
      'Assist': "You're one of the top assist providers, ranked in the top 5% for assists in the league!",
      'Clean Sheet': "You're goal keeping is impressive! Ranked among the top 27% for clean sheets in the league",
      'Frequent Top Performer': "You’re a consistent standout! Regularly among the top performers in matches",
      'Captains Performance': "Leading by example! You’ve earned the captain’s pick for outstanding performances multiple times.",
      'Individual Brilliances': "A match-winning presence! Your individual brilliance is undeniable",
      'Wins': "Winning mindset! You’re one of the top players with the most wins in the league",
      '% Impact': "You make a difference every time! Your positive impact on games is among the highest in the league",
    };

    const strongestNarrative = top3Strengths.length > 0
      ? { metric: top3Strengths[0].metric, message: narrativeMessages[top3Strengths[0].metric] || '' }
      : null;

    // Focus Suggestion
    const isAttackingPlayer = (pos: string): boolean => {
      const p = String(pos || '').toLowerCase();
      return p.includes('striker') || p.includes('midfield') || p.includes('forward') || p.includes('winger') || p.includes('attacker');
    };

    const focusMessages: Record<string, string> = {
      'Goals': "Focus on building your goal-scoring consistency, and you'll continue to rise among the league’s top scorers. Keep pushing yourself, and the goals will follow.",
      'Assists': "By increasing your assists, you'll elevate your game even further. Keep playing with vision and creativity, and you'll make a greater impact on match results",
      'Clean Sheets': "Each game provides an opportunity to sharpen your defensive and goalkeeping skills. By focusing on these areas, you can help transform losses into wins.",
      'MOTM Votes': "To stand out even more, focus on delivering consistent performances in every match – keep it simple, effective, and stay confident in your approach.",
      'Captains Performance': "To enhance your leadership even further, continue delivering outstanding performances. Leading by example will inspire everyone to perform at their highest level.",
      'Total Wins': "Keep enhancing your performances, and you'll start turning every opportunity into more victories for both yourself and your team",
      '% Win Influence Rate': "To make an even greater impact on matches, maintain your focus throughout, keep your game simple, effective, and trust your instincts"
    };

    let focusSuggestion = 'Play a few more games to unlock a personalized focus area.';
    if (played > 0) {
      const attacking = isAttackingPlayer(playerPosition);
      const comparableRows = leagueComparisonRows.filter((row) => {
        if (row.metric === 'Goals' || row.metric === 'Assists') return attacking;
        return Boolean(focusMessages[row.metric]);
      });

      const rowsWithGap = comparableRows.map((row) => {
        const gap = Number(row.leagueAverage) - Number(row.yourTotal);
        const isPct = row.metric.includes('%') || row.metric === 'Captains Performance';
        const gapRatio = isPct ? gap / 100 : gap / Math.max(Math.abs(Number(row.leagueAverage)), 1);
        return { row, gap, gapRatio };
      });

      const target = rowsWithGap
        .filter((item) => item.gap > 0 && item.row.leagueDisplay !== item.row.yourDisplay)
        .sort((a, b) => b.gapRatio - a.gapRatio || b.gap - a.gap)[0];

      if (target && focusMessages[target.row.metric]) {
        focusSuggestion = focusMessages[target.row.metric];
      } else {
        focusSuggestion = "All your metrics are currently above the league average. Keep up the excellent work and continue building your consistency to maintain this edge!";
      }
    }

    // Win/Loss Breakdown (Largest-Remainder method)
    const totalWLMatches = wins + losses + draws;
    let winLossBreakdown = [
      { name: 'Win', value: 0, color: '#15b57a', fill: '#15b57a' },
      { name: 'Loss', value: 0, color: '#d22f2f', fill: '#d22f2f' },
      { name: 'Draw', value: 0, color: '#ff4bd2', fill: '#ff4bd2' }
    ];

    if (totalWLMatches > 0) {
      const rawWin = (wins / totalWLMatches) * 100;
      const rawLoss = (losses / totalWLMatches) * 100;
      const rawDraw = (draws / totalWLMatches) * 100;
      let floorWin = Math.floor(rawWin);
      let floorLoss = Math.floor(rawLoss);
      let floorDraw = Math.floor(rawDraw);
      let remainder = 100 - floorWin - floorLoss - floorDraw;

      const fracs = [
        { key: 'win', frac: rawWin - floorWin },
        { key: 'loss', frac: rawLoss - floorLoss },
        { key: 'draw', frac: rawDraw - floorDraw }
      ].sort((a, b) => b.frac - a.frac);

      for (const f of fracs) {
        if (remainder <= 0) break;
        if (f.key === 'win') floorWin += 1;
        else if (f.key === 'loss') floorLoss += 1;
        else floorDraw += 1;
        remainder -= 1;
      }

      winLossBreakdown = [
        { name: 'Win', value: floorWin, color: '#15b57a', fill: '#15b57a' },
        { name: 'Loss', value: floorLoss, color: '#d22f2f', fill: '#d22f2f' },
        { name: 'Draw', value: floorDraw, color: '#ff4bd2', fill: '#ff4bd2' }
      ];
    }

    // Influence Radar
    const influenceRadar = [
      { metric: 'Goals', [playerName]: goals, 'League Avg': leagueAverage.goals },
      { metric: 'Assists', [playerName]: assists, 'League Avg': leagueAverage.assists },
      { metric: 'Clean Sheets', [playerName]: cleanSheets, 'League Avg': leagueAverage.cleanSheets },
      { metric: 'Defensive Impact', [playerName]: defence, 'League Avg': leagueAverage.defence },
      { metric: 'MOTM Votes', [playerName]: motmVotes, 'League Avg': leagueAverage.motmVotes },
    ];

    // Single match maxes
    const playerMaxSingleMatchStats = {
      goals: playedMatchesList.length > 0 ? Math.max(...playedMatchesList.map(m => Number(m.stat.goals || 0))) : 0,
      assists: playedMatchesList.length > 0 ? Math.max(...playedMatchesList.map(m => Number(m.stat.assists || 0))) : 0,
      motmVotes: playedMatchesList.length > 0 ? Math.max(...playedMatchesList.map(m => m.motmVotes)) : 0,
    };

    const payload = {
      success: true,
      data: {
        playerId: String(id),
        playerName,
        playerPosition,
        filters: {
          leagueId: leagueId || 'all',
          year: year || 'all',
          seasonId: seasonId || 'all'
        },
        yourStats,
        lastPrev10,
        last10: last10MatchList,
        lastFive: last10MatchList,
        recentMatches: last10MatchList,
        last10Results: last10ResultsArray,
        leagueAverage,
        impactRows,
        impactTable: impactRows,
        leagueComparisonRows,
        topStrengths: {
          rows: top3Strengths,
          note: topStrengthNote,
          narrative: strongestNarrative
        },
        focusSuggestion,
        winLossBreakdown,
        influenceRadar,
        playerMaxSingleMatchStats
      }
    };

    cache.set(cacheKey, payload, 300);
    ctx.body = payload;
  } catch (error) {
    console.error('Error fetching career dashboard:', error);
    ctx.throw(500, 'Failed to fetch career dashboard.');
  }
};

