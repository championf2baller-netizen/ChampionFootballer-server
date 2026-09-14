import { Context } from 'koa';
import models from '../models';
import cache from '../utils/cache';

const { User, Match, MatchStatistics, Vote } = models;

export const clearDreamTeamCache = () => {
  try {
    cache.clearPattern('dreamteam');
  } catch {}
};

export const getDreamTeam = async (ctx: Context) => {
  const leagueId = ctx.query.leagueId as string | undefined;
  const seasonId = ctx.query.seasonId as string | undefined;
  const forceRefresh =
    ctx.query.refresh === '1' ||
    ctx.query.nocache === '1' ||
    typeof ctx.query._t !== 'undefined';
  
  if (!leagueId) {
    ctx.throw(400, 'leagueId is required');
    return;
  }

  const cacheKey = `dreamteam_${leagueId}_${seasonId || 'all'}`;
  const cached = forceRefresh ? undefined : cache.get(cacheKey);
  if (cached) { 
    ctx.body = cached; 
    return; 
  }

  try {
    // Get league and its members (optionally filtered by season)
    const leagueInclude: any = [{ model: models.User, as: 'members' }];
    
    const league = await models.League.findByPk(leagueId, {
      include: leagueInclude
    });
    
    if (!league) {
      ctx.throw(404, 'League not found');
      return;
    }
    
    let memberIds: string[];
    
    // If seasonId is provided, get members for that season
    if (seasonId) {
      const season = await models.Season.findOne({
        where: { id: seasonId, leagueId },
        include: [{ model: models.User, as: 'players' }]
      });
      
      if (!season) {
        ctx.throw(404, 'Season not found');
        return;
      }
      
      memberIds = (season as any).players?.map((m: any) => m.id) || [];
    } else {
      memberIds = (league as any).members.map((m: any) => m.id);
    }

    // Build match where clause
    const matchWhere: any = { status: 'RESULT_PUBLISHED', leagueId };
    if (seasonId) {
      matchWhere.seasonId = seasonId;
    }

    // 1. Fetch matches in the league/season that have status 'RESULT_PUBLISHED'
    const matches = await Match.findAll({
      where: matchWhere,
      include: [
        { model: User, as: 'homeTeamUsers', attributes: ['id'] },
        { model: User, as: 'awayTeamUsers', attributes: ['id'] }
      ]
    });

    const matchIds = matches.map(m => m.id);

    // If there are no published matches, return empty dream team immediately
    if (matchIds.length === 0) {
      const result = {
        success: true,
        dreamTeam: {
          goalkeeper: [],
          defenders: [],
          midfielders: [],
          forwards: []
        },
        formation: '2-2-1'
      };
      cache.set(cacheKey, result, 3600);
      ctx.body = result;
      return;
    }

    // 2. Fetch match statistics for the league members in these matches
    const statistics = await MatchStatistics.findAll({
      where: {
        user_id: memberIds,
        match_id: matchIds
      }
    });

    // 3. Fetch votes for these matches
    const votes = await Vote.findAll({
      where: {
        votedForId: memberIds,
        matchId: matchIds
      }
    });

    // 4. Fetch basic user details for these members
    const users = await User.findAll({
      where: { id: memberIds },
      attributes: ['id', 'firstName', 'lastName', 'position', 'positionType', 'profilePicture']
    });

    // Map statistics and votes by userId for fast O(1) lookup
    const statsByUser = new Map<string, any[]>();
    statistics.forEach((stat: any) => {
      if (!statsByUser.has(stat.user_id)) {
        statsByUser.set(stat.user_id, []);
      }
      statsByUser.get(stat.user_id)!.push(stat);
    });

    const votesByUser = new Map<string, any[]>();
    votes.forEach((vote: any) => {
      if (!votesByUser.has(vote.votedForId)) {
        votesByUser.set(vote.votedForId, []);
      }
      votesByUser.get(vote.votedForId)!.push(vote);
    });

    const matchesMap = new Map<string, any>();
    matches.forEach((m: any) => {
      matchesMap.set(m.id, m);
    });

    // Calculate player scores using official XP awarded in match statistics
    const playersWithScores = users.map((user: any) => {
      const stats = statsByUser.get(user.id) || [];
      const userVotes = votesByUser.get(user.id) || [];
      
      let totalGoals = 0;
      let totalAssists = 0;
      let totalRating = 0;
      let totalXP = 0;
      let wins = 0;
      let matchesPlayed = stats.length;
      let motm = userVotes.length;

      stats.forEach((stat: any) => {
        totalGoals += Number(stat.goals || 0);
        totalAssists += Number(stat.assists || 0);
        totalRating += Number(stat.rating || 0);
        totalXP += Number(stat.xp_awarded ?? stat.xpAwarded ?? 0);

        const match = matchesMap.get(stat.match_id);
        if (match) {
          const homeTeamIds = match.homeTeamUsers?.map((u: any) => u.id) || [];
          const awayTeamIds = match.awayTeamUsers?.map((u: any) => u.id) || [];
          const isHome = homeTeamIds.includes(user.id);
          const isAway = awayTeamIds.includes(user.id);

          if (isHome && match.homeTeamGoals > match.awayTeamGoals) wins++;
          if (isAway && match.awayTeamGoals > match.homeTeamGoals) wins++;
        }
      });

      const avgRating = matchesPlayed > 0 ? totalRating / matchesPlayed : 0;

      // Primary score metric is official total XP points awarded in this league/season.
      // Fallback score formula is used if totalXP is 0 for legacy records.
      const fallbackScore = (totalGoals * 3) + (totalAssists * 2) + (avgRating * 0.5) + (wins * 1) + (motm * 5);
      const score = totalXP > 0 ? totalXP : parseFloat(fallbackScore.toFixed(2));

      return {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: `${user.firstName} ${user.lastName}`,
        position: user.position,
        positionType: user.positionType,
        profilePicture: user.profilePicture,
        xp: totalXP,
        stats: {
          goals: totalGoals,
          assists: totalAssists,
          rating: parseFloat(avgRating.toFixed(1)),
          matches: matchesPlayed,
          wins,
          motm,
          xp: totalXP
        },
        score: parseFloat(score.toFixed(2))
      };
    });

    // Normalize position types accurately. Returns null if player has NO valid position set.
    const getPositionType = (player: any): 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward' | null => {
      if (!player) return null;
      const rawType = String(player.positionType || '').trim().toLowerCase();
      const rawPos = String(player.position || '').trim().toLowerCase();

      // Filter out players if both position and positionType are empty, null, undefined, or unassigned
      const invalidTokens = ['', 'null', 'undefined', 'n/a', 'none', '-', 'unassigned'];
      if (invalidTokens.includes(rawType) && invalidTokens.includes(rawPos)) {
        return null;
      }

      const combined = `${rawType} ${rawPos}`.trim();
      if (!combined) return null;

      if (
        combined.includes('goalkeeper') ||
        combined.includes('gk') ||
        combined.includes('keeper') ||
        rawType === 'goalkeeper' ||
        rawType === 'goalkeepers'
      ) {
        return 'Goalkeeper';
      }

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
        rawType.startsWith('def')
      ) {
        return 'Defender';
      }

      if (
        combined.includes('midfield') ||
        combined.includes('midfielder') ||
        combined.includes('cdm') ||
        combined.includes('cam') ||
        combined.includes('cm') ||
        combined.includes('lm') ||
        combined.includes('rm') ||
        rawType.startsWith('mid')
      ) {
        return 'Midfielder';
      }

      if (
        combined.includes('forward') ||
        combined.includes('striker') ||
        combined.includes('winger') ||
        combined.includes('attacker') ||
        combined.includes('st') ||
        combined.includes('cf') ||
        combined.includes('lw') ||
        combined.includes('rw') ||
        combined.includes('fwd') ||
        rawType.startsWith('for') ||
        rawType.startsWith('st')
      ) {
        return 'Forward';
      }

      return null;
    };

    // Filter out players who do NOT have a valid position configured
    const eligiblePlayers = playersWithScores.filter(p => getPositionType(p) !== null);

    // Sort function: Prioritize XP FIRST when 2 players have the same position
    const sortByXPAndScore = (a: any, b: any, primaryStatKey?: 'goals' | 'assists' | 'rating') => {
      // 1. Highest XP first
      const xpA = Number(a.xp ?? a.stats?.xp ?? 0);
      const xpB = Number(b.xp ?? b.stats?.xp ?? 0);
      if (xpB !== xpA) return xpB - xpA;

      // 2. Highest Score
      const scoreA = Number(a.score || 0);
      const scoreB = Number(b.score || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;

      // 3. Primary Stat (assists for midfield, goals for forward, rating for defender)
      if (primaryStatKey) {
        const statA = Number(a.stats?.[primaryStatKey] || 0);
        const statB = Number(b.stats?.[primaryStatKey] || 0);
        if (statB !== statA) return statB - statA;
      }

      // 4. Rating
      const ratingA = Number(a.stats?.rating || 0);
      const ratingB = Number(b.stats?.rating || 0);
      if (ratingB !== ratingA) return ratingB - ratingA;

      // 5. Wins
      const winsA = Number(a.stats?.wins || 0);
      const winsB = Number(b.stats?.wins || 0);
      if (winsB !== winsA) return winsB - winsA;

      return String(a.id).localeCompare(String(b.id));
    };

    const goalkeeperSort = (a: any, b: any) => sortByXPAndScore(a, b, 'rating');
    const defenderSort = (a: any, b: any) => sortByXPAndScore(a, b, 'rating');
    const midfielderSort = (a: any, b: any) => sortByXPAndScore(a, b, 'assists');
    const forwardSort = (a: any, b: any) => sortByXPAndScore(a, b, 'goals');

    // Client 5-a-side layout specs: 2 Best Defenders, 2 Best Midfielders, 1 Top Striker, 1 GK
    const positions = {
      Goalkeeper: eligiblePlayers.filter(p => getPositionType(p) === 'Goalkeeper').sort(goalkeeperSort).slice(0, 1),
      Defender: eligiblePlayers.filter(p => getPositionType(p) === 'Defender').sort(defenderSort).slice(0, 2),
      Midfielder: eligiblePlayers.filter(p => getPositionType(p) === 'Midfielder').sort(midfielderSort).slice(0, 2),
      Forward: eligiblePlayers.filter(p => getPositionType(p) === 'Forward').sort(forwardSort).slice(0, 1)
    };

    const result = {
      success: true,
      dreamTeam: {
        goalkeeper: positions.Goalkeeper,
        defenders: positions.Defender,
        midfielders: positions.Midfielder,
        forwards: positions.Forward
      },
      formation: '2-2-1'
    };

    cache.set(cacheKey, result, 3600);
    ctx.body = result;
  } catch (error) {
    console.error('Dream team error:', error);
    ctx.throw(500, 'Failed to generate dream team');
  }
};
