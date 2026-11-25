import { Context } from 'koa';
import models from '../models';
import { Op, fn, col, literal } from 'sequelize';
import cache from '../utils/cache';
import { registeredUserWhere } from '../utils/playerIdentity';

const METRIC_MAP: Record<string, string> = {
  goals: 'goals',
  assists: 'assists',
  defence: 'defence',
  motm: 'motm',
  impact: 'impact',
  mentality: 'mentality',
  influence: 'mentality',
  contribution: 'impact',
  cleanSheet: 'clean_sheets'
};

const NON_GUEST_PROVIDER_WHERE = registeredUserWhere();

const FINALIZED_MATCH_STATUSES = ['RESULT_PUBLISHED', 'RESULT_UPLOADED'];

const clampPercentage = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

type CaptainVoteLeaderboardConfig = {
  voteCategories: string[];
  homeColumn: 'homeDefensiveImpactId' | 'homeMentalityId';
  awayColumn: 'awayDefensiveImpactId' | 'awayMentalityId';
};

async function getCaptainVoteLeaderboard(
  matchWhere: Record<string, unknown>,
  config: CaptainVoteLeaderboardConfig,
  topLimit: number,
  positionType?: string
) {
  const matches = await models.Match.findAll({
    where: matchWhere,
    attributes: ['id', config.homeColumn, config.awayColumn],
    raw: true
  }) as any[];

  if (matches.length === 0) {
    return [];
  }

  const matchIds = matches.map((m) => String(m.id)).filter(Boolean);
  const votes = await models.Vote.findAll({
    where: {
      matchId: { [Op.in]: matchIds },
      category: { [Op.in]: config.voteCategories }
    },
    attributes: ['matchId', 'voterId', 'votedForId'],
    raw: true
  }) as any[];

  // Count every per-voter vote in Votes table (deduped per match+voter),
  // and track which matches already have Vote rows for this category.
  const playerCounts: Record<string, number> = {};
  const seenVoterPerMatch = new Set<string>();
  const matchesWithVotes = new Set<string>();

  for (const v of votes) {
    const matchId = String(v.matchId || '').trim();
    const voterId = String(v.voterId || '').trim();
    const votedForId = String(v.votedForId || '').trim();
    if (!matchId || !votedForId) continue;

    matchesWithVotes.add(matchId);
    if (voterId) {
      const voterKey = `${matchId}:${voterId}`;
      if (seenVoterPerMatch.has(voterKey)) continue;
      seenVoterPerMatch.add(voterKey);
    }

    playerCounts[votedForId] = (playerCounts[votedForId] || 0) + 1;
  }

  // Fallback to Match table columns only for legacy matches without Vote rows in this category.
  for (const m of matches) {
    const matchId = String(m.id || '').trim();
    if (!matchId || matchesWithVotes.has(matchId)) continue;

    const fallbackIds = new Set<string>();
    const homePick = String(m[config.homeColumn] || '').trim();
    const awayPick = String(m[config.awayColumn] || '').trim();
    if (homePick) fallbackIds.add(homePick);
    if (awayPick) fallbackIds.add(awayPick);

    for (const pid of fallbackIds) {
      playerCounts[pid] = (playerCounts[pid] || 0) + 1;
    }
  }

  const allPlayerIds = Object.keys(playerCounts);
  if (allPlayerIds.length === 0) {
    return [];
  }

  const users = await models.User.findAll({
    where: {
      id: allPlayerIds,
      ...NON_GUEST_PROVIDER_WHERE,
      ...(positionType && { positionType })
    },
    attributes: ['id', 'firstName', 'lastName', 'profilePicture', 'position', 'positionType']
  });

  const userMap = new Map(users.map((u) => [String(u.id), u]));

  return Object.entries(playerCounts)
    .map(([playerId, count]) => {
      const user = userMap.get(String(playerId));
      if (!user) return null;
      if (positionType && user.positionType !== positionType) return null;
      return {
        id: String(playerId),
        name: `${user.firstName} ${user.lastName}`,
        profilePicture: user.profilePicture,
        position: user.position,
        positionType: user.positionType,
        value: count
      };
    })
    .filter((p): p is {
      id: string;
      name: string;
      profilePicture: string;
      position: string;
      positionType: string;
      value: number;
    } => p !== null)
    .sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      const nameCmp = a.name.localeCompare(b.name);
      if (nameCmp !== 0) return nameCmp;
      return a.id.localeCompare(b.id);
    })
    .slice(0, topLimit);
}

export const getLeaderboard = async (ctx: Context) => {
  const metric = (ctx.query.metric as string) || 'goals';
  let leagueId = ctx.query.leagueId as string | undefined;
  let seasonId = ctx.query.seasonId as string | undefined;
  const positionType = ctx.query.positionType as string | undefined;
  const requestedLimitRaw = Number(ctx.query.limit);
  const topLimit = Number.isFinite(requestedLimitRaw) && requestedLimitRaw > 0
    ? Math.min(Math.floor(requestedLimitRaw), 200)
    : 5;
  const fetchLimit = Math.max(topLimit * 5, 200);
  const forceRefresh =
    ctx.query.refresh === '1' ||
    ctx.query.nocache === '1' ||
    typeof ctx.query._t !== 'undefined';

  // Sanitize leagueId
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (typeof leagueId === 'string') {
    leagueId = leagueId.trim();
    if (leagueId.length === 0) leagueId = undefined;
  }
  if (leagueId && !uuidRegex.test(leagueId)) {
    ctx.status = 400;
    ctx.body = { players: [], message: 'Invalid leagueId format.' };
    return;
  }

  // Sanitize seasonId
  if (typeof seasonId === 'string') {
    seasonId = seasonId.trim();
    if (seasonId.length === 0) seasonId = undefined;
  }
  if (seasonId && !uuidRegex.test(seasonId)) {
    ctx.status = 400;
    ctx.body = { players: [], message: 'Invalid seasonId format.' };
    return;
  }

  const cacheKey = `leaderboard_${metric}_${leagueId || 'all'}_${seasonId || 'all'}_${positionType || 'all'}_${topLimit}`;
  const cached = forceRefresh ? undefined : cache.get(cacheKey);
  if (cached) {
    ctx.set('X-Cache', 'HIT');
    ctx.body = cached;
    return;
  }
  
  ctx.set('X-Cache', 'MISS');

  try {
    // MOTM: aggregate from Vote model
    if (metric === 'motm') {
      const matchWhere: any = {
        status: { [Op.in]: FINALIZED_MATCH_STATUSES },
        deleted: { [Op.ne]: true }
      };
      if (leagueId) matchWhere.leagueId = leagueId;
      if (seasonId) matchWhere.seasonId = seasonId;
      
      const voteInclude: any[] = [
        {
          model: models.Match,
          as: 'votedMatch',
          where: matchWhere,
          attributes: []
        }
      ];

      const votesGrouped = await models.Vote.findAll({
        where: {
          category: { [Op.or]: ['motm', null] }
        },
        attributes: [
          'votedForId',
          [fn('COUNT', literal('DISTINCT CONCAT("Vote"."matchId", \'-\', "Vote"."voterId")')), 'count']
        ],
        include: voteInclude,
        group: ['Vote.votedForId'],
        order: [[literal('count'), 'DESC']],
        limit: fetchLimit,
        raw: true
      });

      const playerIds = [...new Set(votesGrouped.map((v: any) => v.votedForId))];
      const users = await models.User.findAll({
        where: {
          id: playerIds,
          ...NON_GUEST_PROVIDER_WHERE,
          ...(positionType && { positionType })
        },
        attributes: ['id', 'firstName', 'lastName', 'profilePicture', 'position', 'positionType']
      });

      const userMap = new Map(users.map(u => [u.id, u]));
      const players = votesGrouped
        .map((v: any) => {
          const user = userMap.get(v.votedForId);
          if (!user) return null;
          if (positionType && user.positionType !== positionType) return null;
          return {
            id: v.votedForId,
            name: `${user.firstName} ${user.lastName}`,
            profilePicture: user.profilePicture,
            position: user.position,
            positionType: user.positionType,
            value: parseInt(v.count as string, 10) || 0
          };
        })
        .filter(Boolean)
        .slice(0, topLimit);

      const result = { players };
      cache.set(cacheKey, result, 1800);
      ctx.body = result;
      return;
    }

    // CONTRIBUTION INDEX %:
    // Must match Career page logic:
    // average of MatchStatistics.impact across finalized matches,
    // then clamp to 0-100 and round to integer for leaderboard display.
    if (metric === 'contribution') {
      const matchWhere: any = {
        status: { [Op.in]: FINALIZED_MATCH_STATUSES },
        deleted: { [Op.ne]: true }
      };
      if (leagueId) matchWhere.leagueId = leagueId;
      if (seasonId) matchWhere.seasonId = seasonId;

      const statsGrouped = await models.MatchStatistics.findAll({
        attributes: [
          ['user_id', 'userId'],
          [fn('AVG', col('MatchStatistics.impact')), 'avgImpact']
        ],
        include: [
          {
            model: models.Match,
            as: 'match',
            where: matchWhere,
            attributes: []
          }
        ],
        group: ['MatchStatistics.user_id'],
        order: [[literal('"avgImpact"'), 'DESC']],
        limit: fetchLimit,
        raw: true
      });

      const playerIds = [...new Set(statsGrouped.map((row: any) => String(row.userId || row.user_id || '').trim()).filter(Boolean))];
      const users = await models.User.findAll({
        where: {
          id: playerIds,
          ...NON_GUEST_PROVIDER_WHERE,
          ...(positionType && { positionType })
        },
        attributes: ['id', 'firstName', 'lastName', 'profilePicture', 'position', 'positionType']
      });

      const userMap = new Map(users.map((u) => [u.id, u]));
      const players = statsGrouped
        .map((row: any) => {
          const playerId = String(row.userId || row.user_id || '').trim();
          const user = userMap.get(playerId);
          if (!playerId || !user) return null;
          if (positionType && user.positionType !== positionType) return null;

          const avgContributionRaw = Number(row.avgImpact);
          const avgContribution = Number.isFinite(avgContributionRaw) ? avgContributionRaw : 0;

          return {
            id: playerId,
            name: `${user.firstName} ${user.lastName}`,
            profilePicture: user.profilePicture,
            position: user.position,
            positionType: user.positionType,
            value: clampPercentage(avgContribution)
          };
        })
        .filter((player): player is {
          id: string;
          name: string;
          profilePicture: string;
          position: string;
          positionType: string;
          value: number;
        } => player !== null)
        .sort((a, b) => {
          if (b.value !== a.value) return b.value - a.value;
          return String(a.id).localeCompare(String(b.id));
        })
        .slice(0, topLimit);

      const result = { players };
      cache.set(cacheKey, result, 1800);
      ctx.body = result;
      return;
    }

    // DEFENSIVE IMPACT VOTES: Count per-voter votes from Votes table (with legacy Match fallback)
    if (metric === 'impact') {
      const matchWhere: any = {
        status: { [Op.in]: FINALIZED_MATCH_STATUSES },
        deleted: { [Op.ne]: true }
      };
      if (leagueId) matchWhere.leagueId = leagueId;
      if (seasonId) matchWhere.seasonId = seasonId;

      const players = await getCaptainVoteLeaderboard(
        matchWhere,
        {
          voteCategories: ['defence', 'defensive'],
          homeColumn: 'homeDefensiveImpactId',
          awayColumn: 'awayDefensiveImpactId'
        },
        topLimit,
        positionType
      );

      const result = { players };
      cache.set(cacheKey, result, 1800);
      ctx.body = result;
      return;
    }

    // + MENTALITY VOTES: Count per-voter votes from Votes table (with legacy Match fallback)
    if (metric === 'mentality' || metric === 'influence') {
      const matchWhere: any = {
        status: { [Op.in]: FINALIZED_MATCH_STATUSES },
        deleted: { [Op.ne]: true }
      };
      if (leagueId) matchWhere.leagueId = leagueId;
      if (seasonId) matchWhere.seasonId = seasonId;

      const players = await getCaptainVoteLeaderboard(
        matchWhere,
        {
          voteCategories: ['influence', 'mentality'],
          homeColumn: 'homeMentalityId',
          awayColumn: 'awayMentalityId'
        },
        topLimit,
        positionType
      );

      const result = { players };
      cache.set(cacheKey, result, 1800);
      ctx.body = result;
      return;
    }

    // Standard metrics from MatchStatistics
    const dbColumn = METRIC_MAP[metric] || 'goals';
    const matchWhere: any = {
      status: { [Op.in]: FINALIZED_MATCH_STATUSES },
      deleted: { [Op.ne]: true }
    };
    if (leagueId) matchWhere.leagueId = leagueId;
    if (seasonId) matchWhere.seasonId = seasonId;

    const statsGrouped = await models.MatchStatistics.findAll({
      attributes: [
        ['user_id', 'userId'],
        [fn('SUM', col(dbColumn)), 'total']
      ],
      include: [
        {
          model: models.Match,
          as: 'match',
          where: matchWhere,
          attributes: []
        }
      ],
      group: ['MatchStatistics.user_id'],
      order: [[literal('total'), 'DESC']],
      limit: fetchLimit,
      raw: true
    });

    const playerIds = [...new Set(statsGrouped.map((s: any) => s.userId || s.user_id))];
    const users = await models.User.findAll({
      where: {
        id: playerIds,
        ...NON_GUEST_PROVIDER_WHERE,
        ...(positionType && { positionType })
      },
      attributes: ['id', 'firstName', 'lastName', 'profilePicture', 'position', 'positionType']
    });

    const userMap = new Map(users.map(u => [u.id, u]));
    const players = statsGrouped
      .map((s: any) => {
        const odUserId = s.userId || s.user_id;
        const user = userMap.get(odUserId);
        if (!user) return null;
        if (positionType && user.positionType !== positionType) return null;
        return {
          id: odUserId,
          name: `${user.firstName} ${user.lastName}`,
          profilePicture: user.profilePicture,
          position: user.position,
          positionType: user.positionType,
          value: parseInt(s.total as string, 10) || 0
        };
      })
      .filter(Boolean)
      .slice(0, topLimit);

    const result = { players };
    cache.set(cacheKey, result, 1800);
    ctx.body = result;
  } catch (error) {
    console.error('Leaderboard error:', error);
    ctx.status = 500;
    ctx.body = { players: [], message: 'Internal server error' };
  }
};
