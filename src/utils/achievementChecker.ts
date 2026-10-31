import { xpAchievements } from './xpAchievements';

type Result = 'W' | 'D' | 'L';

export type RewardAchievementId =
  | 'hat_trick_3_matches'
  | 'captain_5_wins'
  | 'assist_10_consecutive'
  | 'scoring_10_consecutive'
  | 'captain_performance_3'
  | 'motm_4_consecutive'
  | 'clean_sheet_5_wins'
  | 'top_spot_10_matches'
  | 'consecutive_10_victories';

export interface AchievementMatchInput {
  id: string;
  leagueId: string;
  seasonId?: string | null;
  homeTeamGoals: number;
  awayTeamGoals: number;
  homeTeamUserIds: string[];
  awayTeamUserIds: string[];
  votePlayerIds: string[];
  defenceVotedUserIds?: string[];
  influenceVotedUserIds?: string[];
  homeCaptainId?: string | null;
  awayCaptainId?: string | null;
  homeDefensiveImpactId?: string | null;
  awayDefensiveImpactId?: string | null;
  homeMentalityId?: string | null;
  awayMentalityId?: string | null;
  time: number;
}

export interface AchievementStatLine {
  goals: number;
  assists: number;
}

export interface AchievementBadge {
  id: RewardAchievementId;
  title: string;
  count: number;
  xp: number;
  unlocked: boolean;
  progressText: string;
}

interface MatchSummary {
  goals: number;
  assists: number;
  conceded: number;
  result: Result;
  isCaptainWin: boolean;
  hasXFactorPick: boolean;
  xFactorPicks: number;
  wonMotmAward: boolean;
  cleanSheetTeam: boolean;
}

export interface ComputedAchievementState {
  badges: AchievementBadge[];
  xpAchievementInstances: string[];
  countsById: Record<RewardAchievementId, number>;
}

export interface ComputeAchievementOptions {
  totalMatchesByLeague?: Record<string, number>;
  totalMatchesBySeason?: Record<string, number>;
}

const REWARD_ORDER: RewardAchievementId[] = [
  'scoring_10_consecutive',
  'assist_10_consecutive',
  'hat_trick_3_matches',
  'captain_5_wins',
  'captain_performance_3',
  'motm_4_consecutive',
  'clean_sheet_5_wins',
  'top_spot_10_matches',
  'consecutive_10_victories',
];

const REWARD_TITLE: Record<RewardAchievementId, string> = {
  scoring_10_consecutive: 'Goal Rush',
  assist_10_consecutive: 'Pure Magic',
  hat_trick_3_matches: 'Triple Treat',
  captain_5_wins: 'Leader of Legends',
  captain_performance_3: 'The X-Factor',
  motm_4_consecutive: 'Spotlight Star',
  clean_sheet_5_wins: 'Finders Keepers',
  top_spot_10_matches: 'Iron Will',
  consecutive_10_victories: 'Win Streak X',
};

const XP_BY_ID: Record<RewardAchievementId, number> = xpAchievements.reduce((acc, ach) => {
  acc[ach.id as RewardAchievementId] = ach.xp;
  return acc;
}, {} as Record<RewardAchievementId, number>);

const normalizeId = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
};

const getSeasonScopeKey = (leagueId: string, seasonId?: string | null): string => {
  const normSeason = normalizeId(seasonId);
  const normLeague = normalizeId(leagueId);
  if (normSeason && normLeague) return `${normLeague}:${normSeason}`;
  if (normSeason) return normSeason;
  if (normLeague) return `${normLeague}:default`;
  return 'default';
};

const comparableId = (value: unknown): string => {
  const id = normalizeId(value);
  return id.startsWith('guest-') ? id.slice(6) : id;
};

const sameComparableId = (a: unknown, b: unknown): boolean => {
  const left = comparableId(a);
  const right = comparableId(b);
  return left !== '' && right !== '' && left === right;
};

const longestStreak = (arr: MatchSummary[], predicate: (m: MatchSummary) => boolean): number => {
  let best = 0;
  let streak = 0;
  for (const item of arr) {
    if (predicate(item)) {
      streak += 1;
      if (streak > best) best = streak;
    } else {
      streak = 0;
    }
  }
  return best;
};

const countStreakCompletions = (
  arr: MatchSummary[],
  predicate: (m: MatchSummary) => boolean,
  target: number
): number => {
  if (target <= 0) return 0;
  let streak = 0;
  let awards = 0;
  for (const item of arr) {
    if (predicate(item)) {
      streak += 1;
      if (streak === target) {
        awards += 1;
        streak = 0;
      }
    } else {
      streak = 0;
    }
  }
  return awards;
};

const computeTripleTreatForMatches = (
  arr: MatchSummary[]
): { count: number; best: number } => {
  let awards = 0;
  let best = 0;
  let window: Array<{ matchIndex: number; hatTricks: number }> = [];

  for (let i = 0; i < arr.length; i++) {
    const m = arr[i];
    const h = Math.floor((m.goals || 0) / 3);

    // Keep only active matches within the last 3 matches (i-2, i-1, i)
    window = window.filter((entry) => entry.matchIndex >= i - 2 && entry.hatTricks > 0);

    if (h > 0) {
      window.push({ matchIndex: i, hatTricks: h });
    }

    const windowSum = window.reduce((sum, entry) => sum + entry.hatTricks, 0);
    best = Math.max(best, windowSum);

    if (windowSum >= 3) {
      const newAwards = Math.floor(windowSum / 3);
      awards += newAwards;

      let toConsume = newAwards * 3;
      for (const entry of window) {
        if (toConsume <= 0) break;
        const take = Math.min(entry.hatTricks, toConsume);
        entry.hatTricks -= take;
        toConsume -= take;
      }
      window = window.filter((entry) => entry.hatTricks > 0);
    }
  }

  return { count: awards, best: Math.min(best, 3) };
};

const buildVoteCounts = (votePlayerIds: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const votedForId of votePlayerIds) {
    const key = comparableId(votedForId);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
};

const getTopMotmWinner = (votePlayerIds: string[]): string => {
  const counts = buildVoteCounts(votePlayerIds);
  let winner = '';
  let maxVotes = 0;
  for (const [playerId, votes] of Object.entries(counts)) {
    if (votes > maxVotes) {
      winner = playerId;
      maxVotes = votes;
    }
  }
  return maxVotes > 0 ? winner : '';
};

export const toAchievementMatchInput = (match: any): AchievementMatchInput => {
  const toNumber = (value: unknown): number => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  const toIdArray = (rows: unknown): string[] => {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => {
        if (typeof row === 'string' || typeof row === 'number') return normalizeId(row);
        if (row && typeof row === 'object') {
          return normalizeId((row as any).id ?? (row as any).userId ?? (row as any).user_id ?? (row as any).playerId ?? row);
        }
        return normalizeId(row);
      })
      .filter((id) => id !== '');
  };
  const rawVotes = Array.isArray(match?.votes) ? match.votes : [];
  const motmVotes = rawVotes
    .filter((v: any) => !v.category || v.category === 'motm')
    .map((v: any) => normalizeId(v?.votedForId ?? v))
    .filter((id: string) => id !== '');
  const defenceVotes = rawVotes
    .filter((v: any) => v.category === 'defence' || v.category === 'defensive')
    .map((v: any) => normalizeId(v?.votedForId ?? v))
    .filter((id: string) => id !== '');
  const influenceVotes = rawVotes
    .filter((v: any) => v.category === 'influence' || v.category === 'mentality')
    .map((v: any) => normalizeId(v?.votedForId ?? v))
    .filter((id: string) => id !== '');

  const timeValue = match?.date ?? match?.start ?? match?.createdAt ?? match?.updatedAt ?? match?.end ?? 0;
  const ms = new Date(timeValue).getTime();

  return {
    id: normalizeId(match?.id),
    leagueId: normalizeId(match?.leagueId ?? match?.league_id),
    seasonId: normalizeId(match?.seasonId ?? match?.season_id) || null,
    homeTeamGoals: toNumber(match?.homeTeamGoals ?? match?.homeGoals ?? match?.homeScore ?? match?.score?.home ?? match?.home_goals ?? match?.home_score),
    awayTeamGoals: toNumber(match?.awayTeamGoals ?? match?.awayGoals ?? match?.awayScore ?? match?.score?.away ?? match?.away_goals ?? match?.away_score),
    homeTeamUserIds: toIdArray(match?.homeTeamUsers ?? match?.homeTeamUserIds ?? match?.homeUsers ?? match?.home_team_user_ids),
    awayTeamUserIds: toIdArray(match?.awayTeamUsers ?? match?.awayTeamUserIds ?? match?.awayUsers ?? match?.away_team_user_ids),
    votePlayerIds: motmVotes,
    defenceVotedUserIds: defenceVotes,
    influenceVotedUserIds: influenceVotes,
    homeCaptainId: normalizeId(match?.homeCaptainId ?? match?.home_captain_id) || null,
    awayCaptainId: normalizeId(match?.awayCaptainId ?? match?.away_captain_id) || null,
    homeDefensiveImpactId: normalizeId(match?.homeDefensiveImpactId) || null,
    awayDefensiveImpactId: normalizeId(match?.awayDefensiveImpactId) || null,
    homeMentalityId: normalizeId(match?.homeMentalityId) || null,
    awayMentalityId: normalizeId(match?.awayMentalityId) || null,
    time: Number.isFinite(ms) ? ms : 0,
  };
};

export const computeAchievementState = (
  userId: string,
  matches: AchievementMatchInput[],
  statsByMatch: Map<string, AchievementStatLine>,
  options?: ComputeAchievementOptions
): ComputedAchievementState => {
  const normalizedUserId = normalizeId(userId);
  const bySeason: Record<string, MatchSummary[]> = {};
  const providedSeasonTotals = options?.totalMatchesBySeason;
  const providedLeagueTotals = options?.totalMatchesByLeague;
  const totalMatchesBySeason: Record<string, number> = providedSeasonTotals ? { ...providedSeasonTotals } : {};

  const sortedMatches = [...matches]
    .filter((m) => normalizeId(m.id) !== '')
    .sort((a, b) => a.time - b.time);

  for (const match of sortedMatches) {
    const leagueId = normalizeId(match.leagueId);
    const seasonId = normalizeId(match.seasonId);
    const seasonKey = getSeasonScopeKey(leagueId, seasonId);

    if (!providedSeasonTotals || totalMatchesBySeason[seasonKey] === undefined) {
      totalMatchesBySeason[seasonKey] = (totalMatchesBySeason[seasonKey] || 0) + 1;
    }

    const statLine = statsByMatch.get(normalizeId(match.id)) || { goals: 0, assists: 0 };
    const hasRecordedStats = statsByMatch.has(normalizeId(match.id));
    let isHome = match.homeTeamUserIds.some((id) => sameComparableId(id, normalizedUserId));
    let isAway = match.awayTeamUserIds.some((id) => sameComparableId(id, normalizedUserId));
    if (!isHome && !isAway) {
      if (!hasRecordedStats) continue;
      isHome = true;
    }
    const teamGoals = isHome ? Number(match.homeTeamGoals || 0) : Number(match.awayTeamGoals || 0);
    const oppGoals = isHome ? Number(match.awayTeamGoals || 0) : Number(match.homeTeamGoals || 0);
    const result: Result = teamGoals > oppGoals ? 'W' : teamGoals === oppGoals ? 'D' : 'L';
    const isCaptainWin =
      result === 'W' &&
      (sameComparableId(match.homeCaptainId, normalizedUserId) || sameComparableId(match.awayCaptainId, normalizedUserId));
    const hasXFactorPick =
      (match.defenceVotedUserIds || []).some((id) => sameComparableId(id, normalizedUserId)) ||
      (match.influenceVotedUserIds || []).some((id) => sameComparableId(id, normalizedUserId)) ||
      sameComparableId(match.homeDefensiveImpactId, normalizedUserId) ||
      sameComparableId(match.awayDefensiveImpactId, normalizedUserId) ||
      sameComparableId(match.homeMentalityId, normalizedUserId) ||
      sameComparableId(match.awayMentalityId, normalizedUserId);
    const xFactorPicks = hasXFactorPick ? 1 : 0;

    const motmWinnerId = getTopMotmWinner(match.votePlayerIds);
    const wonMotmAward = sameComparableId(motmWinnerId, normalizedUserId);

    if (!bySeason[seasonKey]) bySeason[seasonKey] = [];
    bySeason[seasonKey].push({
      goals: Number(statLine.goals || 0),
      assists: Number(statLine.assists || 0),
      conceded: oppGoals,
      result,
      isCaptainWin,
      hasXFactorPick,
      xFactorPicks,
      wonMotmAward,
      cleanSheetTeam: oppGoals === 0,
    });
  }

  let goalRushCount = 0;
  let goalRushBest = 0;
  let pureMagicCount = 0;
  let pureMagicBest = 0;
  let tripleTreatCount = 0;
  let tripleTreatBest = 0;
  let leaderOfLegendsCount = 0;
  let leaderOfLegendsBest = 0;
  let xFactorCount = 0;
  let xFactorBest = 0;
  let spotlightStarCount = 0;
  let spotlightStarBest = 0;
  let findersKeepersCount = 0;
  let findersKeepersBest = 0;
  let winStreakXCount = 0;
  let winStreakXBest = 0;
  let ironWillCount = 0;
  let ironWillBestPlayed = 0;
  let ironWillBestTotal = 0;
  let ironWillBestPercent = 0;

  for (const [seasonKey, arr] of Object.entries(bySeason)) {
    goalRushBest = Math.max(goalRushBest, longestStreak(arr, (m) => m.goals > 0));
    goalRushCount += countStreakCompletions(arr, (m) => m.goals > 0, 5);

    pureMagicBest = Math.max(pureMagicBest, longestStreak(arr, (m) => m.assists > 0));
    pureMagicCount += countStreakCompletions(arr, (m) => m.assists > 0, 5);

    const tripleTreat = computeTripleTreatForMatches(arr);
    tripleTreatBest = Math.max(tripleTreatBest, tripleTreat.best);
    tripleTreatCount += tripleTreat.count;

    const captainWinsInSeason = arr.filter((m) => m.isCaptainWin).length;
    leaderOfLegendsBest = Math.max(leaderOfLegendsBest, captainWinsInSeason);
    leaderOfLegendsCount += Math.floor(captainWinsInSeason / 3);

    const xFactorMatchesInSeason = arr.filter((m) => m.hasXFactorPick).length;
    xFactorBest = Math.max(xFactorBest, xFactorMatchesInSeason);
    xFactorCount += Math.floor(xFactorMatchesInSeason / 5);

    const motmAwardsInSeason = arr.filter((m) => m.wonMotmAward).length;
    spotlightStarBest = Math.max(spotlightStarBest, motmAwardsInSeason);
    spotlightStarCount += Math.floor(motmAwardsInSeason / 3);

    const cleanSheetsInSeason = arr.filter((m) => m.cleanSheetTeam).length;
    findersKeepersBest = Math.max(findersKeepersBest, cleanSheetsInSeason);
    findersKeepersCount += Math.floor(cleanSheetsInSeason / 3);

    winStreakXBest = Math.max(winStreakXBest, longestStreak(arr, (m) => m.result === 'W'));
    winStreakXCount += countStreakCompletions(arr, (m) => m.result === 'W', 10);

    const rawSeasonId = seasonKey.includes(':') ? seasonKey.split(':')[1] : seasonKey;
    const rawLeagueId = seasonKey.includes(':') ? seasonKey.split(':')[0] : '';
    const totalMatchesInSeason =
      totalMatchesBySeason[seasonKey] ??
      (rawSeasonId && totalMatchesBySeason[rawSeasonId] !== undefined ? totalMatchesBySeason[rawSeasonId] : undefined) ??
      (rawLeagueId && providedLeagueTotals && providedLeagueTotals[rawLeagueId] !== undefined ? providedLeagueTotals[rawLeagueId] : 0) ??
      0;

    const playedMatchesInSeason = arr.length;
    if (totalMatchesInSeason >= 10) {
      const playedPercent = playedMatchesInSeason / totalMatchesInSeason;
      if (playedPercent >= 0.9) ironWillCount += 1;
      if (
        playedPercent > ironWillBestPercent ||
        (playedPercent === ironWillBestPercent && totalMatchesInSeason > ironWillBestTotal)
      ) {
        ironWillBestPercent = playedPercent;
        ironWillBestPlayed = playedMatchesInSeason;
        ironWillBestTotal = totalMatchesInSeason;
      }
    }
  }

  const badges: AchievementBadge[] = [
    {
      id: 'scoring_10_consecutive',
      title: REWARD_TITLE.scoring_10_consecutive,
      count: goalRushCount,
      xp: XP_BY_ID.scoring_10_consecutive || 0,
      unlocked: goalRushCount > 0,
      progressText: `Best scoring streak in a season: ${goalRushBest}/5`,
    },
    {
      id: 'assist_10_consecutive',
      title: REWARD_TITLE.assist_10_consecutive,
      count: pureMagicCount,
      xp: XP_BY_ID.assist_10_consecutive || 0,
      unlocked: pureMagicCount > 0,
      progressText: `Best assist streak in a season: ${pureMagicBest}/5`,
    },
    {
      id: 'hat_trick_3_matches',
      title: REWARD_TITLE.hat_trick_3_matches,
      count: tripleTreatCount,
      xp: XP_BY_ID.hat_trick_3_matches || 0,
      unlocked: tripleTreatCount > 0,
      progressText: `Hat-tricks within 3 matches: ${tripleTreatBest}/3`,
    },
    {
      id: 'captain_5_wins',
      title: REWARD_TITLE.captain_5_wins,
      count: leaderOfLegendsCount,
      xp: XP_BY_ID.captain_5_wins || 0,
      unlocked: leaderOfLegendsCount > 0,
      progressText: `Most captain wins in one season: ${leaderOfLegendsBest}/3`,
    },
    {
      id: 'captain_performance_3',
      title: REWARD_TITLE.captain_performance_3,
      count: xFactorCount,
      xp: XP_BY_ID.captain_performance_3 || 0,
      unlocked: xFactorCount > 0,
      progressText: `Most qualifying matches in one season: ${xFactorBest}/5`,
    },
    {
      id: 'motm_4_consecutive',
      title: REWARD_TITLE.motm_4_consecutive,
      count: spotlightStarCount,
      xp: XP_BY_ID.motm_4_consecutive || 0,
      unlocked: spotlightStarCount > 0,
      progressText: `Most MOTM awards in one season: ${spotlightStarBest}/3`,
    },
    {
      id: 'clean_sheet_5_wins',
      title: REWARD_TITLE.clean_sheet_5_wins,
      count: findersKeepersCount,
      xp: XP_BY_ID.clean_sheet_5_wins || 0,
      unlocked: findersKeepersCount > 0,
      progressText: `Most clean sheets in one season: ${findersKeepersBest}/3`,
    },
    {
      id: 'top_spot_10_matches',
      title: REWARD_TITLE.top_spot_10_matches,
      count: ironWillCount,
      xp: XP_BY_ID.top_spot_10_matches || 0,
      unlocked: ironWillCount > 0,
      progressText:
        ironWillBestTotal > 0
          ? `Best participation in a season: ${ironWillBestPlayed}/${ironWillBestTotal} (${Math.round(
              ironWillBestPercent * 100
            )}%)`
          : 'No completed season with 10+ matches yet',
    },
    {
      id: 'consecutive_10_victories',
      title: REWARD_TITLE.consecutive_10_victories,
      count: winStreakXCount,
      xp: XP_BY_ID.consecutive_10_victories || 0,
      unlocked: winStreakXCount > 0,
      progressText: `Best win streak in a season: ${winStreakXBest}/10`,
    },
  ];

  const xpAchievementInstances: string[] = [];
  const countsById = {} as Record<RewardAchievementId, number>;
  for (const badge of badges) {
    countsById[badge.id] = badge.count;
    for (let i = 0; i < badge.count; i += 1) {
      xpAchievementInstances.push(badge.id);
    }
  }

  xpAchievementInstances.sort((a, b) => REWARD_ORDER.indexOf(a as RewardAchievementId) - REWARD_ORDER.indexOf(b as RewardAchievementId));

  return { badges, xpAchievementInstances, countsById };
};
