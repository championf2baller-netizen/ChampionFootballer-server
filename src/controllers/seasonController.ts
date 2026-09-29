import { Context } from 'koa';
import Season from '../models/Season';
import League from '../models/League';
import User from '../models/User';
import Notification from '../models/Notification';
import Match from '../models/Match';
import cache from '../utils/cache';
import { Op, QueryTypes } from 'sequelize';
import { randomUUID } from 'crypto';
import { getInviteCode } from '../modules/utils';

const normalizeBoolean = (value: unknown): boolean | undefined => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return undefined;
};

const getSeasonStatus = (season: Season): 'active' | 'inactive' | 'archived' | 'deleted' => {
  if ((season as any).deleted) return 'deleted';
  if ((season as any).archived) return 'archived';
  if (season.isActive) return 'active';
  return 'inactive';
};

const buildSeasonPayload = (season: Season, extra?: Record<string, unknown>) => ({
  id: season.id,
  leagueId: season.leagueId,
  seasonNumber: season.seasonNumber,
  name: season.name,
  inviteCode: (season as any).inviteCode || '',
  isActive: season.isActive,
  archived: Boolean((season as any).archived),
  deleted: Boolean((season as any).deleted),
  status: getSeasonStatus(season),
  startDate: season.startDate,
  endDate: season.endDate,
  maxGames: season.maxGames,
  showPoints: season.showPoints,
  createdAt: season.createdAt,
  updatedAt: season.updatedAt,
  ...(extra || {}),
});

const RESULT_MATCH_STATUSES = [
  'RESULT_PUBLISHED',
  'RESULT_UPLOADED',
  'REVISION_REQUESTED',
];

const countSeasonResultMatches = async (
  leagueId: string,
  seasonId: string,
  transaction?: any,
): Promise<number> => {
  const count = await Match.count({
    where: {
      leagueId,
      seasonId,
      status: { [Op.in]: RESULT_MATCH_STATUSES },
    } as any,
    transaction,
  });
  return typeof count === 'number' ? count : Number(count || 0);
};

const generateUniqueSeasonInviteCode = async (transaction?: any): Promise<string> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const candidate = String(getInviteCode() || '').trim().toUpperCase();
    if (!candidate) continue;

    const existing = await Season.findOne({
      where: { inviteCode: candidate } as any,
      attributes: ['id'],
      transaction,
    });

    if (!existing) {
      return candidate;
    }
  }

  throw new Error('Unable to generate a unique season invite code');
};

const checkLeagueAdmin = async (leagueId: string, userId: string): Promise<{ league: League | null; isAdmin: boolean }> => {
  const league = await League.findByPk(leagueId, {
    include: [
      {
        model: User,
        as: 'administeredLeagues',
        attributes: ['id']
      }
    ]
  });

  if (!league) {
    return { league: null, isAdmin: false };
  }

  const adminList = (league as any).administeredLeagues || [];
  let isAdmin = adminList.some((admin: any) => String(admin.id) === String(userId));

  if (!isAdmin) {
    const directResult = await (League as any).sequelize.query(
      'SELECT "userId" FROM "LeagueAdmin" WHERE "leagueId" = :leagueId AND "userId" = :userId LIMIT 1',
      { replacements: { leagueId, userId }, type: (League as any).sequelize.QueryTypes.SELECT }
    );
    isAdmin = Array.isArray(directResult) && directResult.length > 0;
  }

  return { league, isAdmin };
};

const invalidateAuthRelatedCaches = (rawUserIds: Array<string | number | null | undefined>) => {
  const userIds = Array.from(
    new Set(
      rawUserIds
        .map((id) => String(id ?? '').trim())
        .filter((id) => id.length > 0),
    ),
  );

  userIds.forEach((id) => {
    cache.del(`auth_data_${id}_ultra_fast`);
    cache.del(`auth_status_${id}_fast`);
    cache.del(`user_leagues_${id}`);
  });
};

const invalidateLeagueMutationCaches = async (
  leagueId: string,
  extraUserIds: Array<string | number | null | undefined> = [],
) => {
  const gatheredUserIds: Array<string | number | null | undefined> = [...extraUserIds];
  try {
    const leagueWithUsers = await League.findByPk(leagueId, {
      attributes: ['id'],
      include: [
        {
          model: User,
          as: 'members',
          attributes: ['id'],
          through: { attributes: [] },
          required: false,
        },
        {
          model: User,
          as: 'administeredLeagues',
          attributes: ['id'],
          through: { attributes: [] },
          required: false,
        },
      ],
    });

    const members = ((leagueWithUsers as any)?.members || []) as Array<{ id?: string | number }>;
    const admins = ((leagueWithUsers as any)?.administeredLeagues || []) as Array<{ id?: string | number }>;
    members.forEach((m) => gatheredUserIds.push(m?.id));
    admins.forEach((a) => gatheredUserIds.push(a?.id));
  } catch (cacheInvalidateError) {
    console.warn('[seasonController] Failed to gather league users for cache invalidation:', cacheInvalidateError);
  }

  invalidateAuthRelatedCaches(gatheredUserIds);
  cache.clearPattern(`league_${leagueId}`);
  cache.clearPattern(`matches_league_${leagueId}`);

  try {
    const { invalidateLeagueCompletionCache } = require('../utils/leagueCompletion');
    invalidateLeagueCompletionCache(leagueId);
  } catch (err) {
    console.error('Failed to invalidate league completion cache in invalidateLeagueMutationCaches:', err);
  }
};

export const getAllSeasons = async (ctx: Context) => {
  const { leagueId } = ctx.params;
  const userId = ctx.state.user?.userId;

  const user = userId ? await User.findByPk(userId) : null;
  const isSuperAdmin = Boolean(user?.isAdmin || user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN');

  // Check if user is admin of this league
  const league = await League.findByPk(leagueId, {
    include: [
      {
        model: User,
        as: 'administeredLeagues',
        attributes: ['id']
      }
    ]
  });
  
  if (!league) {
    ctx.throw(404, 'League not found');
    return;
  }

  const isAdmin = isSuperAdmin || (league as any).administeredLeagues?.some((admin: any) => String(admin.id) === String(userId));


  const seasonWhere: Record<string, any> = { leagueId };
  if (!isSuperAdmin) {
    seasonWhere.deleted = false;
  }

  const seasons = await Season.findAll({
    where: seasonWhere,
    order: [['seasonNumber', 'DESC']],

    include: [
      {
        model: User,
        as: 'players',
        attributes: ['id', 'email', 'firstName', 'lastName']
      }
    ]
  });

  const matchCounts = await Match.findAll({
    where: {
      leagueId,
      deleted: false,
    },
    attributes: [
      'seasonId',
      [(Season as any).sequelize.fn('COUNT', (Season as any).sequelize.col('id')), 'count'],
    ],
    group: ['seasonId'],
    raw: true,
  }) as unknown as Array<{ seasonId: string; count: string | number }>;

  const matchCountBySeasonId = new Map<string, number>();
  matchCounts.forEach((row) => {
    if (row.seasonId) {
      matchCountBySeasonId.set(String(row.seasonId), Number(row.count || 0));
    }
  });

  // If user is admin, show ALL seasons
  if (isAdmin) {
    const allSeasons = seasons.map((season) => {
      const players = (season as any).players || [];
      const isPlayerInSeason = players.some((p: any) => String(p.id) === String(userId));
      return {
        id: season.id,
        seasonNumber: season.seasonNumber,
        name: season.name,
        inviteCode: (season as any).inviteCode || '',
        isActive: season.isActive,
        archived: Boolean((season as any).archived),
        deleted: Boolean((season as any).deleted),
        status: getSeasonStatus(season),
        startDate: season.startDate,
        endDate: season.endDate,
        maxGames: season.maxGames || (league as any).maxGames || null,
        showPoints: season.showPoints,
        players: players,
        playerCount: players.length,
        matchCount: matchCountBySeasonId.get(String(season.id)) || 0,
        createdAt: season.createdAt,
        isMember: isPlayerInSeason
      };
    });

    ctx.body = {
      success: true,
      viewerIsAdmin: true,
      seasons: allSeasons
    };
    return;
  }

  // For non-admin members - only show seasons where user is a member
  const seasonInviteStatusBySeasonId = new Map<string, string>();
  try {
    const seasonNotifications = await Notification.findAll({
      where: {
        user_id: userId,
        type: 'NEW_SEASON',
      },
      order: [['created_at', 'DESC']],
      attributes: ['meta', 'created_at'],
    });

    seasonNotifications.forEach((notification) => {
      const meta = (notification as any)?.meta;
      if (!meta || typeof meta !== 'object') return;
      const metaRecord = meta as Record<string, unknown>;
      const metaLeagueId = String(metaRecord.leagueId || '').trim();
      const metaSeasonId = String(metaRecord.seasonId || '').trim();
      if (!metaSeasonId || metaLeagueId !== String(leagueId)) return;
      if (seasonInviteStatusBySeasonId.has(metaSeasonId)) return;

      const actionTaken = String(metaRecord.actionTaken || '').trim().toLowerCase();
      seasonInviteStatusBySeasonId.set(metaSeasonId, actionTaken || 'pending');
    });
  } catch (notificationLookupError) {
    console.error('Error checking season invite notifications:', notificationLookupError);
  }

  const filteredSeasons = await Promise.all(
    seasons.map(async (season) => {
      const players = (season as any).players || [];
      const isPlayerInSeason = players.some((p: any) => String(p.id) === String(userId));

      // ONLY show season if user is a member of it
      if (isPlayerInSeason) {
        return {
          id: season.id,
          seasonNumber: season.seasonNumber,
          name: season.name,
          inviteCode: (season as any).inviteCode || '',
          isActive: season.isActive,
          archived: Boolean((season as any).archived),
          deleted: Boolean((season as any).deleted),
          status: getSeasonStatus(season),
          startDate: season.startDate,
          endDate: season.endDate,
          maxGames: season.maxGames,
          showPoints: season.showPoints,
          players: players,
          playerCount: players.length,
          matchCount: matchCountBySeasonId.get(String(season.id)) || 0,
          totalMatches: matchCountBySeasonId.get(String(season.id)) || 0,
          createdAt: season.createdAt,
          isMember: true
        };
      }

      const seasonId = String((season as any).id || '').trim();
      const inviteStatus = seasonInviteStatusBySeasonId.get(seasonId) || '';
      const isDeclined = inviteStatus === 'declined' || inviteStatus === 'left';
      const shouldAutoEnroll =
        season.isActive === true &&
        !isDeclined &&
        inviteStatus === 'joined';

      if (shouldAutoEnroll) {
        try {
          await (season as any).addPlayer(userId);
        } catch (addPlayerError) {
          const err = addPlayerError as { message?: string; original?: { code?: string }; parent?: { code?: string } };
          const msg = String(err?.message || '').toLowerCase();
          const code = String(err?.original?.code || err?.parent?.code || '').toLowerCase();
          const isDuplicate = code === '23505' || msg.includes('duplicate') || msg.includes('unique');
          if (!isDuplicate) {
            console.error(`Error auto-enrolling user ${userId} into season ${seasonId}:`, addPlayerError);
            return null;
          }
        }

        const refreshedPlayers = await (season as any).getPlayers({
          attributes: ['id', 'email', 'firstName', 'lastName']
        });

        return {
          id: season.id,
          seasonNumber: season.seasonNumber,
          name: season.name,
          inviteCode: (season as any).inviteCode || '',
          isActive: season.isActive,
          archived: Boolean((season as any).archived),
          deleted: Boolean((season as any).deleted),
          status: getSeasonStatus(season),
          startDate: season.startDate,
          endDate: season.endDate,
          maxGames: season.maxGames,
          showPoints: season.showPoints,
          players: refreshedPlayers,
          playerCount: refreshedPlayers.length,
          matchCount: matchCountBySeasonId.get(String(season.id)) || 0,
          totalMatches: matchCountBySeasonId.get(String(season.id)) || 0,
          createdAt: season.createdAt,
          isMember: true
        };
      }

      return {
        id: season.id,
        seasonNumber: season.seasonNumber,
        name: season.name,
        inviteCode: (season as any).inviteCode || '',
        isActive: season.isActive,
        archived: Boolean((season as any).archived),
        deleted: Boolean((season as any).deleted),
        status: getSeasonStatus(season),
        startDate: season.startDate,
        endDate: season.endDate,
        maxGames: season.maxGames,
        showPoints: season.showPoints,
        players: players,
        playerCount: players.length,
        matchCount: matchCountBySeasonId.get(String(season.id)) || 0,
        totalMatches: matchCountBySeasonId.get(String(season.id)) || 0,
        createdAt: season.createdAt,
        isMember: false
      };
    })
  );

  ctx.body = {
    success: true,
    viewerIsAdmin: false,
    seasons: filteredSeasons.filter(s => s !== null)
  };
};

export const getActiveSeason = async (ctx: Context) => {
  const { leagueId } = ctx.params;
  const userId = ctx.state.user?.userId;

  // Check if user is admin of this league
  const league = await League.findByPk(leagueId, {
    include: [
      {
        model: User,
        as: 'administeredLeagues',
        attributes: ['id']
      }
    ]
  });

  const isAdmin = league && (league as any).administeredLeagues?.some((admin: any) => String(admin.id) === String(userId));

  const activeSeason = await Season.findOne({
    where: {
      leagueId,
      isActive: true,
      archived: false,
      deleted: false,
    },
    include: [
      {
        model: User,
        as: 'players',
        attributes: ['id', 'email', 'firstName', 'lastName']
      }
    ]
  });

  if (!activeSeason) {
    ctx.body = {
      success: false,
      message: 'No active season found'
    };
    return;
  }

  // If user is ADMIN - always return active season (admin sees everything)
  if (isAdmin) {
    ctx.body = {
      success: true,
      season: {
        ...buildSeasonPayload(activeSeason),
        players: (activeSeason as any).players,
      },
    };
    return;
  }

  // Check if user is a member of the active season
  const players = (activeSeason as any).players || [];
  const isUserInActiveSeason = players.some((p: any) => String(p.id) === String(userId));

  // If user is in the active season, return it
  if (isUserInActiveSeason) {
    ctx.body = {
      success: true,
      season: {
        ...buildSeasonPayload(activeSeason),
        players: (activeSeason as any).players,
      },
    };
    return;
  }

  // User is NOT in the active season - return their previous season
  const previousSeason = await Season.findOne({
    where: {
      leagueId,
      seasonNumber: activeSeason.seasonNumber - 1,
      deleted: false,
    },
    include: [
      {
        model: User,
        as: 'players',
        attributes: ['id', 'email', 'firstName', 'lastName']
      }
    ]
  });

  if (previousSeason) {
    ctx.body = {
      success: true,
      season: {
        ...buildSeasonPayload(previousSeason as Season, { isActive: false }),
        players: (previousSeason as any).players,
      },
    };
    return;
  }

  // If no previous season found, return no season
  ctx.body = {
    success: false,
    message: 'No season found for this user'
  };
};

export const createNewSeason = async (ctx: Context) => {
  const { leagueId } = ctx.params;
  const { copyPlayers = true } = ctx.request.body as { copyPlayers?: boolean | string | number };
  const shouldCopyPlayers = normalizeBoolean(copyPlayers) ?? true;

  const adminUserId = String(ctx.state.user?.userId || ctx.state.user?.id || '');
  const { league, isAdmin } = await checkLeagueAdmin(String(leagueId), adminUserId);

  if (!league || !isAdmin) {
    ctx.throw(403, 'You are not an administrator of this league');
    return;
  }

  const sequelizeRef = (Season as any).sequelize;
  const partialSeasonUniqueIndexRows = await sequelizeRef.query(
    `
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'Seasons'
      AND indexname = 'seasons_league_id_season_number_active'
    LIMIT 1;
    `,
    { type: QueryTypes.SELECT }
  );
  const usePartialConflictClause = Array.isArray(partialSeasonUniqueIndexRows) && partialSeasonUniqueIndexRows.length > 0;
  const conflictClause = usePartialConflictClause
    ? 'ON CONFLICT ("leagueId","seasonNumber") WHERE "deleted" = false DO NOTHING'
    : 'ON CONFLICT ("leagueId","seasonNumber") DO NOTHING';

  let currentSeason: Season | null = null;
  let newSeason: Season | null = null;
  let newSeasonNumber = 0;
  let transferredPlayersCount = 0;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tx = await sequelizeRef.transaction();
    try {
      let sourceSeasonForCopy: Season | null = null;

      // Serialize season creation per league to avoid race conditions on seasonNumber.
      const lockedLeague = await League.findByPk(leagueId, {
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });

      if (!lockedLeague) {
        await tx.rollback();
        ctx.throw(404, 'League not found');
        return;
      }

      currentSeason = await Season.findOne({
        where: {
          leagueId,
          isActive: true,
          archived: false,
          deleted: false,
        },
        order: [['seasonNumber', 'DESC']],
        transaction: tx,
      });

      // If an active season exists, end it first. If not, still allow creating a new season.
      if (currentSeason) {
        currentSeason.isActive = false;
        currentSeason.endDate = currentSeason.endDate || new Date();
        await currentSeason.save({ transaction: tx });
      }
      sourceSeasonForCopy = currentSeason;

      if (!sourceSeasonForCopy && shouldCopyPlayers) {
        sourceSeasonForCopy = await Season.findOne({
          where: {
            leagueId,
            deleted: false,
          },
          order: [['seasonNumber', 'DESC']],
          transaction: tx,
        });
      }

      // Determine new seasonNumber candidate:
      // - Find all existing seasons in this league, ordered by seasonNumber DESC.
      // - Any season that was permanently deleted (deleted: true) AND had 0 match results
      //   is an empty/accidental season that should be discarded/reused.
      // - Find the highest season that is VALID (either NOT deleted, OR has match results > 0).
      // - Next candidate season number is highestValidNum + 1.
      // - If no valid seasons exist in the league, candidate is 1.
      const allSeasons = await Season.findAll({
        where: { leagueId },
        order: [['seasonNumber', 'DESC']],
        transaction: tx,
      });

      let candidate = 1;
      let foundValid = false;

      for (const s of allSeasons) {
        const sNum = Number(s.seasonNumber || 1);
        const isDeleted = Boolean((s as any).deleted);
        const resCount = await countSeasonResultMatches(leagueId, s.id, tx);

        if (!isDeleted || resCount > 0) {
          candidate = sNum + 1;
          foundValid = true;
          break;
        }
      }

      if (!foundValid) {
        candidate = 1;
      }

      // Clean up any soft-deleted seasons with seasonNumber >= candidate that had 0 match results,
      // so candidate can insert cleanly with NO duplicate key / unique constraint conflict.
      const deletedToClean = await Season.findAll({
        where: {
          leagueId,
          deleted: true,
          seasonNumber: { [Op.gte]: candidate },
        },
        transaction: tx,
      });
      for (const s of deletedToClean) {
        const resCount = await countSeasonResultMatches(s.leagueId, s.id, tx);
        if (resCount === 0) {
          await Match.destroy({
            where: { leagueId: s.leagueId, seasonId: s.id },
            transaction: tx,
          });
          try {
            await (s as any).setPlayers([], { transaction: tx });
          } catch {}
          await s.destroy({ transaction: tx });
        }
      }
      // Insert with ON CONFLICT DO NOTHING so duplicate seasonNumber never aborts the tx.
      // This handles race conditions and old unique-constraint states safely.
      let insertedSeasonId = '';
      let insertGuard = 0;
      while (!insertedSeasonId && insertGuard < Math.max(candidate + 25, 25)) {
        const now = new Date();
        const seasonInviteCode = await generateUniqueSeasonInviteCode(tx);
        const replacements = {
          id: randomUUID(),
          leagueId,
          seasonNumber: candidate,
          name: `Season ${candidate}`,
          inviteCode: seasonInviteCode,
          startDate: now,
          snapshot: '{}',
          createdAt: now,
          updatedAt: now,
        };

        const insertRowsRaw = await sequelizeRef.query(
          `
          INSERT INTO "Seasons"
            ("id","leagueId","seasonNumber","name","inviteCode","isActive","archived","deleted","startDate","showPoints","trophyAwardSnapshot","createdAt","updatedAt")
          VALUES
            (:id,:leagueId,:seasonNumber,:name,:inviteCode,true,false,false,:startDate,true,:snapshot::jsonb,:createdAt,:updatedAt)
          ${conflictClause}
          RETURNING "id","seasonNumber";
          `,
          {
            replacements,
            type: QueryTypes.SELECT,
            transaction: tx,
          }
        );
        const insertRows = (insertRowsRaw || []) as Array<{ id: string; seasonNumber: number }>;

        if (Array.isArray(insertRows) && insertRows.length > 0) {
          insertedSeasonId = String(insertRows[0].id);
          newSeasonNumber = Number(insertRows[0].seasonNumber || candidate);
          break;
        }

        candidate += 1;
        insertGuard += 1;
      }

      if (!insertedSeasonId) {
        throw new Error('Unable to allocate a unique season number');
      }

      const seasonInTx = await Season.findByPk(insertedSeasonId, { transaction: tx });
      if (!seasonInTx) {
        throw new Error('New season insert succeeded but record was not found');
      }
      newSeason = seasonInTx;

      const playerIdsToAdd = new Set<string>();
      playerIdsToAdd.add(String(adminUserId));

      if (shouldCopyPlayers && sourceSeasonForCopy) {
        try {
          const previousSeasonPlayers = await (sourceSeasonForCopy as any).getPlayers({
            attributes: ['id'],
            joinTableAttributes: [],
            transaction: tx,
          });

          previousSeasonPlayers.forEach((player: any) => {
            const id = String(player?.id || '').trim();
            if (id) playerIdsToAdd.add(id);
          });
        } catch (copyError) {
          console.error('Error reading previous season players for copy:', copyError);
        }
      }

      let addedPlayersCounter = 0;
      for (const playerId of playerIdsToAdd) {
        try {
          await (newSeason as any).addPlayer(playerId, { transaction: tx });
          addedPlayersCounter += 1;
        } catch (addPlayerError) {
          console.error(`Error adding player ${playerId} to new season:`, addPlayerError);
        }
      }
      transferredPlayersCount = Math.max(addedPlayersCounter - 1, 0); // Exclude admin from transferred count

      await tx.commit();
      break;
    } catch (error) {
      try { await tx.rollback(); } catch {}
      const err = error as { original?: { code?: string; constraint?: string; message?: string }; message?: string };
      const code = err?.original?.code || '';
      console.error('[createNewSeason] attempt failed', {
        attempt: attempt + 1,
        code,
        constraint: err?.original?.constraint || '',
        message: err?.original?.message || err?.message || 'unknown',
      });

      // Retry transient/transaction issues once or twice with fresh tx.
      if (['25P02', '40001', '40P01'].includes(code) && attempt < 2) continue;
      throw error;
    }
  }

  if (!newSeason) {
    ctx.throw(500, 'Failed to create a new season');
    return;
  }

  if (currentSeason) {
    console.log(`Season ${currentSeason.seasonNumber} ended for league ${league.name}`);
  } else {
    console.log(`No active season found in league ${league.name}; creating a fresh active season`);
  }
  console.log(`Season ${newSeasonNumber} created for league ${league.name}`);

  // Send notification to all league members (EXCEPT admin) asking if they want to join the new season
  try {
    const leagueMembers = await User.findAll({
      include: [
        {
          model: League,
          as: 'leagues',
          where: { id: leagueId },
          attributes: [],
          required: true
        }
      ],
      subQuery: false
    });

    console.log(`Found ${leagueMembers.length} league members before deduplication`);

    // Remove duplicates - ensure each user gets only one notification
    const uniqueMembers = Array.from(
      new Map(leagueMembers.map(member => [member.id, member])).values()
    );

    // Filter out the admin - admin doesn't need notification as they're auto-added
    const nonAdminMembers = uniqueMembers.filter(member => String(member.id) !== String(adminUserId));

    console.log(`After deduplication and excluding admin: ${nonAdminMembers.length} members to notify`);

    // Create notifications for all non-admin league members
    const notificationPromises = nonAdminMembers.map(async (member) => {
      const notificationBody = shouldCopyPlayers
        ? `Season ${newSeasonNumber} has just begun! You have been moved automatically. If you decline, you will be removed from this season.`
        : `Season ${newSeasonNumber} has just begun! Would you like to join this season? If you don't respond, you won't be automatically added.`;

      return Notification.create({
        user_id: member.id,
        type: 'NEW_SEASON',
        title: `New Season Started in ${league.name}!`,
        body: notificationBody,
        meta: {
          leagueId,
          leagueName: league.name,
          seasonId: newSeason.id,
          seasonNumber: newSeasonNumber,
          actionRequired: true,
          autoTransferred: shouldCopyPlayers
        },
        read: false,
        created_at: new Date()
      });
    });

    await Promise.all(notificationPromises);
    console.log(`Sent NEW_SEASON notifications to ${nonAdminMembers.length} league members (admin excluded)`);
  } catch (notifError) {
    console.error('Error sending season notifications:', notifError);
    // Don't fail the season creation if notifications fail
  }

  await invalidateLeagueMutationCaches(String(leagueId), [adminUserId]);

  ctx.body = {
    success: true,
    message: `Season ${newSeasonNumber} created successfully`,
    previousSeason: {
      id: currentSeason?.id || null,
      seasonNumber: currentSeason?.seasonNumber || null,
      endDate: currentSeason?.endDate || null
    },
    newSeason: {
      id: newSeason.id,
      seasonNumber: newSeason.seasonNumber,
      name: newSeason.name,
      inviteCode: (newSeason as any).inviteCode || '',
      startDate: newSeason.startDate,
      isActive: newSeason.isActive
    },
    copiedPlayers: shouldCopyPlayers,
    transferredPlayersCount
  };
};

export const addPlayerToSeason = async (ctx: Context) => {
  const { leagueId, userId } = ctx.params;

  // Verify user is league admin
  const league = await League.findByPk(leagueId, {
    include: [
      {
        model: User,
        as: 'administeredLeagues',
        where: { id: ctx.state.user.userId }
      }
    ]
  });

  if (!league) {
    ctx.throw(403, 'You are not an administrator of this league');
    return;
  }

  // Get active season
  const activeSeason = await Season.findOne({
    where: {
      leagueId,
      isActive: true,
      archived: false,
      deleted: false,
    }
  });

  if (!activeSeason) {
    ctx.throw(400, 'No active season found');
    return;
  }

  // Check if user exists
  const user = await User.findByPk(userId);
  if (!user) {
    ctx.throw(404, 'User not found');
    return;
  }

  // Add player to season
  try {
    await (Season as any).sequelize.query(
      `INSERT INTO "SeasonPlayers" ("seasonId", "userId", "createdAt", "updatedAt") VALUES (:seasonId, :userId, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      { replacements: { seasonId: String(activeSeason.id), userId: String(userId) }, type: QueryTypes.INSERT }
    );
  } catch {}
  await (activeSeason as any).addPlayer(userId);
  await invalidateLeagueMutationCaches(String(leagueId), [userId, ctx.state.user?.userId]);

  ctx.body = {
    success: true,
    message: `Player added to ${activeSeason.name}`
  };
};

export const cleanupLeagueMembershipIfNoSeasonsLeft = async (leagueId: string, userId: string) => {
  try {
    const remainingSeasons = await (Season as any).sequelize.query(
      `SELECT sp."seasonId" FROM "SeasonPlayers" sp
       JOIN "Seasons" s ON sp."seasonId" = s.id
       WHERE s."leagueId" = :leagueId AND sp."userId" = :userId AND COALESCE(s.deleted, false) = false
       LIMIT 1`,
      { replacements: { leagueId: String(leagueId), userId: String(userId) }, type: QueryTypes.SELECT }
    );

    const isEnrolledInOtherSeasons = Array.isArray(remainingSeasons) && remainingSeasons.length > 0;
    if (!isEnrolledInOtherSeasons) {
      await (League as any).sequelize.query(
        `DELETE FROM "LeagueMember" WHERE "leagueId" = :leagueId AND "userId" = :userId`,
        { replacements: { leagueId: String(leagueId), userId: String(userId) }, type: QueryTypes.DELETE }
      );
      const userObj = await User.findByPk(userId);
      const leagueObj = await League.findByPk(leagueId);
      if (userObj && leagueObj) {
        try {
          await (leagueObj as any).removeMember(userObj);
        } catch {}
      }
      console.log(`[cleanupLeagueMembership] Removed user ${userId} from LeagueMember for league ${leagueId} (0 seasons remaining)`);
    } else {
      console.log(`[cleanupLeagueMembership] User ${userId} remains in LeagueMember for league ${leagueId} (has other active seasons)`);
    }
  } catch (err) {
    console.error('[cleanupLeagueMembershipIfNoSeasonsLeft] Error:', err);
  }
};

export const removePlayerFromSeason = async (ctx: Context) => {
  const { leagueId, userId } = ctx.params;

  // Verify user is league admin
  const league = await League.findByPk(leagueId, {
    include: [
      {
        model: User,
        as: 'administeredLeagues',
        where: { id: ctx.state.user.userId }
      }
    ]
  });

  if (!league) {
    ctx.throw(403, 'You are not an administrator of this league');
    return;
  }

  // Get active season
  const activeSeason = await Season.findOne({
    where: {
      leagueId,
      isActive: true,
      archived: false,
      deleted: false,
    }
  });

  if (!activeSeason) {
    ctx.throw(400, 'No active season found');
    return;
  }

  // Remove player from season
  try {
    await (Season as any).sequelize.query(
      `DELETE FROM "SeasonPlayers" WHERE "seasonId" = :seasonId AND "userId" = :userId`,
      { replacements: { seasonId: String(activeSeason.id), userId: String(userId) }, type: QueryTypes.DELETE }
    );
  } catch (sqlErr) {
    console.error('[removePlayerFromSeason] SQL delete error:', sqlErr);
  }
  await (activeSeason as any).removePlayer(userId);
  await cleanupLeagueMembershipIfNoSeasonsLeft(String(leagueId), String(userId));
  await invalidateLeagueMutationCaches(String(leagueId), [userId, ctx.state.user?.userId]);

  ctx.body = {
    success: true,
    message: `Player removed from ${activeSeason.name}`
  };
};

export const leaveSeason = async (ctx: Context) => {
  const { leagueId, seasonId } = ctx.params;
  const userId = String(ctx.state.user?.userId || ctx.state.user?.id || '');

  if (!userId) {
    ctx.throw(401, 'Unauthorized');
    return;
  }

  if (!seasonId) {
    ctx.throw(400, 'seasonId is required');
    return;
  }

  const season = await Season.findByPk(seasonId, {
    include: [
      {
        model: User,
        as: 'players',
        attributes: ['id'],
        through: { attributes: [] },
        required: false,
      }
    ]
  });

  if (!season) {
    ctx.throw(404, 'Season not found');
    return;
  }

  const resolvedLeagueId = String(leagueId || season.leagueId || '').trim();
  if (!resolvedLeagueId || String(season.leagueId) !== resolvedLeagueId) {
    ctx.throw(404, 'Season not found in this league');
    return;
  }

  if (Boolean((season as any).deleted)) {
    ctx.throw(410, 'Season has been permanently deleted');
    return;
  }

  const league = await League.findByPk(resolvedLeagueId, {
    include: [
      {
        model: User,
        as: 'members',
        attributes: ['id'],
        through: { attributes: [] },
        required: false,
      },
      {
        model: User,
        as: 'administeredLeagues',
        attributes: ['id'],
        through: { attributes: [] },
        required: false,
      }
    ]
  });

  if (!league) {
    ctx.throw(404, 'League not found');
    return;
  }

  const leagueMembers = ((league as any).members || []) as Array<{ id?: string | number }>;
  const leagueAdmins = ((league as any).administeredLeagues || []) as Array<{ id?: string | number }>;
  const seasonPlayers = ((season as any).players || []) as Array<{ id?: string | number }>;

  const isLeagueMember = leagueMembers.some((member) => String(member.id) === userId);
  const isLeagueAdmin = leagueAdmins.some((admin) => String(admin.id) === userId);

  if (!isLeagueMember && !isLeagueAdmin) {
    ctx.throw(403, 'Access denied');
    return;
  }

  const dbSeasonPlayerCheck = await (Season as any).sequelize.query(
    `SELECT "userId" FROM "SeasonPlayers" WHERE "seasonId" = :seasonId AND "userId" = :userId LIMIT 1`,
    { replacements: { seasonId: String(seasonId), userId: String(userId) }, type: QueryTypes.SELECT }
  );
  const isDirectSeasonPlayer = Array.isArray(dbSeasonPlayerCheck) && dbSeasonPlayerCheck.length > 0;

  const seasonPlayerIds = new Set(
    seasonPlayers
      .map((player) => String(player.id || '').trim())
      .filter((id) => id.length > 0)
  );

  const isIncludedSeasonPlayer = seasonPlayerIds.has(userId);

  if (!isDirectSeasonPlayer && !isIncludedSeasonPlayer) {
    try {
      await (Season as any).sequelize.query(
        `DELETE FROM "SeasonPlayers" WHERE "seasonId" = :seasonId AND "userId" = :userId`,
        { replacements: { seasonId: String(seasonId), userId: String(userId) }, type: QueryTypes.DELETE }
      );
    } catch {}
    ctx.status = 400;
    ctx.body = {
      success: false,
      message: 'You are not participating in this season',
    };
    return;
  }

  if (isLeagueAdmin) {
    const otherAdminsInSeason = leagueAdmins
      .map((admin) => String(admin.id || '').trim())
      .filter((adminId) => adminId.length > 0 && adminId !== userId && (seasonPlayerIds.has(adminId) || isDirectSeasonPlayer));
    const remainingSeasonPlayers = Math.max(0, seasonPlayerIds.size - 1);

    if (remainingSeasonPlayers > 0 && otherAdminsInSeason.length === 0) {
      ctx.status = 400;
      ctx.body = {
        success: false,
        message: 'Before leaving, assign league admin access to another active player in this season.',
      };
      return;
    }
  }

  try {
    await (Season as any).sequelize.query(
      `DELETE FROM "SeasonPlayers" WHERE "seasonId" = :seasonId AND "userId" = :userId`,
      { replacements: { seasonId: String(seasonId), userId: String(userId) }, type: QueryTypes.DELETE }
    );
  } catch (sqlErr) {
    console.error('[leaveSeason] SQL delete error:', sqlErr);
  }

  try {
    await (season as any).removePlayer(userId);
  } catch (removeErr) {
    console.warn('[leaveSeason] removePlayer error:', removeErr);
  }

  await cleanupLeagueMembershipIfNoSeasonsLeft(resolvedLeagueId, userId);

  try {
    const seasonNotifications = await Notification.findAll({
      where: {
        user_id: userId,
        type: 'NEW_SEASON',
      },
      order: [['created_at', 'DESC']],
      attributes: ['id', 'meta'],
    });

    const targetLeagueId = String(resolvedLeagueId);
    const targetSeasonId = String(seasonId);

    await Promise.all(
      seasonNotifications.map(async (notification) => {
        const metaRaw = (notification as any)?.meta;
        if (!metaRaw || typeof metaRaw !== 'object') return;
        const metaRecord = metaRaw as Record<string, unknown>;
        const metaLeagueId = String(metaRecord.leagueId || '').trim();
        const metaSeasonId = String(metaRecord.seasonId || '').trim();
        if (metaLeagueId !== targetLeagueId || metaSeasonId !== targetSeasonId) return;

        await notification.update({
          meta: {
            ...metaRecord,
            actionTaken: 'declined',
            actionSource: 'leave-season',
            leftAt: new Date().toISOString(),
          },
          read: true,
        } as any);
      })
    );
  } catch (notificationUpdateError) {
    console.warn('[leaveSeason] failed to update NEW_SEASON notification state:', notificationUpdateError);
  }

  cache.clearPattern(`user_leagues_${userId}`);
  cache.clearPattern(`user_leagues_`);
  cache.clearPattern(`auth_status_${userId}`);
  cache.clearPattern(`auth_data_${userId}`);
  cache.clearPattern(`league_${resolvedLeagueId}`);
  cache.clearPattern(`matches_league_${resolvedLeagueId}`);

  await invalidateLeagueMutationCaches(resolvedLeagueId, [userId]);

  ctx.body = {
    success: true,
    message: `You have left ${season.name}`,
    season: buildSeasonPayload(season),
  };
};

export const updateSeason = async (ctx: Context) => {
  const { seasonId } = ctx.params;
  const leagueIdParam = ctx.params.leagueId ? String(ctx.params.leagueId) : '';
  const body = (ctx.request.body || {}) as Record<string, unknown>;

  if (!seasonId) {
    ctx.throw(400, 'seasonId is required');
    return;
  }

  const season = await Season.findByPk(seasonId);
  if (!season) {
    ctx.throw(404, 'Season not found');
    return;
  }

  if (Boolean((season as any).deleted)) {
    ctx.throw(410, 'Season has been permanently deleted');
    return;
  }

  if (leagueIdParam && String(season.leagueId) !== leagueIdParam) {
    ctx.throw(404, 'Season not found in this league');
    return;
  }

  const userId = String(ctx.state.user?.userId || ctx.state.user?.id || '');
  const { isAdmin } = await checkLeagueAdmin(String(season.leagueId), userId);
  if (!isAdmin) {
    ctx.throw(403, 'You are not an administrator of this league');
    return;
  }

  const maxGamesRaw = body.maxGames;
  const showPointsInput = normalizeBoolean(body.showPoints);
  const directActive = normalizeBoolean(body.isActive);
  const activeAlias = normalizeBoolean(body.active);
  const seasonIsActive = normalizeBoolean(body.seasonIsActive);
  const seasonActive = normalizeBoolean(body.seasonActive);
  const directArchived = normalizeBoolean(body.archived);
  const seasonArchived = normalizeBoolean(body.seasonArchived);
  const statusRaw = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
  const seasonStatusRaw = typeof body.seasonStatus === 'string' ? body.seasonStatus.trim().toLowerCase() : '';
  const status = seasonStatusRaw || statusRaw;

  let nextArchived = directArchived ?? seasonArchived;
  let nextActive = directActive ?? activeAlias ?? seasonIsActive ?? seasonActive;

  if (status === 'archived') {
    nextArchived = true;
    nextActive = false;
  } else if (status === 'active') {
    nextArchived = false;
    nextActive = true;
  } else if (status === 'inactive') {
    if (nextArchived === undefined) nextArchived = false;
    nextActive = false;
  }

  if (nextArchived === true) {
    nextActive = false;
  }
  if (nextActive === true && nextArchived === undefined) {
    nextArchived = false;
  }

  const tx = await (Season as any).sequelize.transaction();
  try {
    const seasonInTx = await Season.findByPk(seasonId, { transaction: tx });
    if (!seasonInTx) {
      await tx.rollback();
      ctx.throw(404, 'Season not found');
      return;
    }

    if (Boolean((seasonInTx as any).deleted)) {
      await tx.rollback();
      ctx.throw(410, 'Season has been permanently deleted');
      return;
    }

    if (maxGamesRaw !== undefined && maxGamesRaw !== null && maxGamesRaw !== '') {
      const parsedMaxGames = Number(maxGamesRaw);
      if (!Number.isNaN(parsedMaxGames)) {
        seasonInTx.maxGames = parsedMaxGames;
      }
    }

    if (showPointsInput !== undefined) {
      seasonInTx.showPoints = showPointsInput;
    }

    if (nextArchived === true) {
      const seasonMatchCount = await Match.count({
        where: {
          leagueId: seasonInTx.leagueId,
          seasonId: seasonInTx.id,
          deleted: false,
        },
        transaction: tx,
      });

      if (seasonMatchCount === 0) {
        // Season has no matches -> do NOT archive; permanently delete!
        (seasonInTx as any).deleted = true;
        (seasonInTx as any).archived = false;
        seasonInTx.isActive = false;
        if (!seasonInTx.endDate) {
          seasonInTx.endDate = new Date();
        }
        await seasonInTx.save({ transaction: tx });

        await tx.commit();
        await invalidateLeagueMutationCaches(String(seasonInTx.leagueId), [userId]);
        try {
          cache.clear();
        } catch {}

        console.log(`🗑️ [updateSeason] Season "${seasonInTx.name}" had 0 matches and was permanently deleted instead of archived.`);

        ctx.body = {
          success: true,
          permanentlyDeleted: true,
          message: 'Season has no matches and was permanently deleted',
          season: buildSeasonPayload(seasonInTx as Season),
        };
        return;
      }
    }

    if (nextArchived !== undefined) {
      (seasonInTx as any).archived = nextArchived;
    }
    if (nextActive !== undefined) {
      seasonInTx.isActive = nextActive;
    }

    if ((seasonInTx as any).archived === true || seasonInTx.isActive === false) {
      if (!seasonInTx.endDate) {
        seasonInTx.endDate = new Date();
      }
    }

    // If admin explicitly set season to active, keep it active and make parent league LIVE
    if (nextActive === true) {
      seasonInTx.isActive = true;
      (seasonInTx as any).archived = false;
      await League.update(
        { active: true, archived: false },
        { where: { id: seasonInTx.leagueId }, transaction: tx }
      );
      console.log(`🟢 [updateSeason] Season "${seasonInTx.name}" explicitly set to ACTIVE by admin, parent league activated.`);
    }

    if (seasonInTx.isActive === true) {
      await Season.update(
        { isActive: false },
        {
          where: {
            leagueId: seasonInTx.leagueId,
            id: { [Op.ne]: seasonInTx.id },
            deleted: false,
          },
          transaction: tx,
        }
      );
    }

    await seasonInTx.save({ transaction: tx });

    if ((seasonInTx as any).archived === true || seasonInTx.isActive === false) {
      const activeNonArchived = await Season.findOne({
        where: {
          leagueId: seasonInTx.leagueId,
          isActive: true,
          archived: false,
          deleted: false,
        },
        transaction: tx,
      });

      if (!activeNonArchived) {
        console.log(`ℹ️ [updateSeason] Season deactivated for league ${seasonInTx.leagueId}. Parent league status remains controlled manually.`);
      }
    }

    await tx.commit();
    await invalidateLeagueMutationCaches(String(seasonInTx.leagueId), [userId]);

    const refreshed = await Season.findByPk(seasonId);
    const seasonOut = refreshed || seasonInTx;
    const archivedNow = Boolean((seasonOut as any).archived);

    ctx.body = {
      success: true,
      message: archivedNow ? 'Season archived successfully' : 'Season updated successfully',
      season: buildSeasonPayload(seasonOut as Season),
    };
  } catch (error) {
    try { await tx.rollback(); } catch {}
    console.error('updateSeason error:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      message: 'Failed to update season',
    };
  }
};

export const updateSeasonStatus = async (ctx: Context) => {
  await updateSeason(ctx);
};

export const archiveSeason = async (ctx: Context) => {
  const incomingBody = (ctx.request.body || {}) as Record<string, unknown>;
  (ctx.request as any).body = {
    ...incomingBody,
    archived: true,
    isActive: false,
    seasonStatus: 'archived',
  };
  await updateSeason(ctx);
};

export const restoreSeason = async (ctx: Context) => {
  const { seasonId } = ctx.params;
  const leagueIdParam = ctx.params.leagueId ? String(ctx.params.leagueId) : '';

  if (!seasonId) {
    ctx.throw(400, 'seasonId is required');
    return;
  }

  const season = await Season.findByPk(seasonId);
  if (!season) {
    ctx.throw(404, 'Season not found');
    return;
  }

  if (leagueIdParam && String(season.leagueId) !== leagueIdParam) {
    ctx.throw(404, 'Season not found in this league');
    return;
  }

  if (Boolean((season as any).deleted)) {
    ctx.throw(400, 'This season is permanently deleted and cannot be restored');
    return;
  }

  const userId = String(ctx.state.user?.userId || ctx.state.user?.id || '');
  const { isAdmin } = await checkLeagueAdmin(String(season.leagueId), userId);
  if (!isAdmin) {
    ctx.throw(403, 'You are not an administrator of this league');
    return;
  }

  const tx = await (Season as any).sequelize.transaction();
  try {
    const seasonInTx = await Season.findByPk(seasonId, { transaction: tx });
    if (!seasonInTx) {
      await tx.rollback();
      ctx.throw(404, 'Season not found');
      return;
    }

    if (Boolean((seasonInTx as any).deleted)) {
      await tx.rollback();
      ctx.throw(400, 'This season is permanently deleted and cannot be restored');
      return;
    }

    (seasonInTx as any).archived = false;

    const existingActive = await Season.findOne({
      where: {
        leagueId: seasonInTx.leagueId,
        isActive: true,
        archived: false,
        deleted: false,
        id: { [Op.ne]: seasonInTx.id },
      },
      transaction: tx,
    });

    seasonInTx.isActive = !existingActive;
    if (seasonInTx.isActive) {
      seasonInTx.endDate = null as any;
      await Season.update(
        { isActive: false },
        {
          where: {
            leagueId: seasonInTx.leagueId,
            id: { [Op.ne]: seasonInTx.id },
            deleted: false,
          },
          transaction: tx,
        }
      );
    }

    await seasonInTx.save({ transaction: tx });
    await tx.commit();
    await invalidateLeagueMutationCaches(String(seasonInTx.leagueId), [userId]);

    const refreshed = await Season.findByPk(seasonId);
    const seasonOut = refreshed || seasonInTx;
    ctx.body = {
      success: true,
      message: 'Season restored successfully',
      season: buildSeasonPayload(seasonOut as Season),
    };
  } catch (error) {
    try { await tx.rollback(); } catch {}
    console.error('restoreSeason error:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      message: 'Failed to restore season',
    };
  }
};

export const permanentDeleteSeason = async (ctx: Context) => {
  const seasonId = String(ctx.params.seasonId || ctx.params.id || '');
  const leagueIdParam = String(ctx.params.leagueId || (ctx.params.seasonId ? ctx.params.id : '') || '');

  if (!seasonId) {
    ctx.throw(400, 'seasonId is required');
    return;
  }

  const season = await Season.findByPk(seasonId);
  if (!season) {
    ctx.throw(404, 'Season not found');
    return;
  }

  if (leagueIdParam && String(season.leagueId) !== leagueIdParam) {
    ctx.throw(404, 'Season not found in this league');
    return;
  }

  const userId = String(ctx.state.user?.userId || ctx.state.user?.id || '');
  const { isAdmin } = await checkLeagueAdmin(String(season.leagueId), userId);
  if (!isAdmin) {
    ctx.throw(403, 'You are not an administrator of this league');
    return;
  }

  const tx = await (Season as any).sequelize.transaction();
  try {
    const seasonInTx = await Season.findByPk(seasonId, { transaction: tx });
    if (!seasonInTx) {
      await tx.rollback();
      ctx.throw(404, 'Season not found');
      return;
    }

    (seasonInTx as any).deleted = true;
    (seasonInTx as any).archived = false;
    seasonInTx.isActive = false;
    if (!seasonInTx.endDate) {
      seasonInTx.endDate = new Date();
    }
    await seasonInTx.save({ transaction: tx });

    await Match.update(
      { archived: true, deleted: true },
      {
        where: {
          leagueId: seasonInTx.leagueId,
          seasonId: seasonInTx.id,
        },
        transaction: tx,
      }
    );

    // Deleting a season should never automatically activate an inactive or completed season.
    // Inactive seasons must remain inactive unless explicitly activated by the administrator.

    await tx.commit();
    await invalidateLeagueMutationCaches(String(seasonInTx.leagueId), [userId]);
    try {
      cache.clear();
    } catch {}

    ctx.body = {
      success: true,
      message: 'Season permanently deleted (data preserved for history/awards/xp)',
    };
  } catch (error) {
    try { await tx.rollback(); } catch {}
    console.error('permanentDeleteSeason error:', error);
    ctx.status = 500;
    ctx.body = {
      success: false,
      message: 'Failed to permanently delete season',
    };
  }
};

