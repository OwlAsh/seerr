import PlexAPI from '@server/api/plexapi';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TautulliAPI from '@server/api/tautulli';
import TheMovieDb from '@server/api/themoviedb';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaCleanupResponse } from '@server/entity/MediaCleanupResponse';
import { MediaRequest } from '@server/entity/MediaRequest';
import { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const cleanupRoutes = Router();

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;
const COMPLETION_THRESHOLD = 0.8;

// In-memory cache (10 min TTL)
let cache: { data: CleanupCandidate[]; timestamp: number } | null = null;
const CACHE_TTL = 10 * 60 * 1000;

type UserWatchStatus = 'finished' | 'pending' | 'active' | 'snoozed' | 'consented';

interface CleanupUserStatus {
  id: number;
  plexId: number;
  displayName: string;
  avatar: string;
  status: UserWatchStatus;
  snoozeUntil?: string;
}

interface CleanupCandidate {
  mediaId: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  year: string;
  seasonNumber: number | null;
  readyToDelete: boolean;
  users: CleanupUserStatus[];
}

async function buildCleanupCandidates(): Promise<CleanupCandidate[]> {
  const settings = getSettings();
  const tautulliSettings = settings.tautulli;

  if (!tautulliSettings.hostname || !tautulliSettings.port || !tautulliSettings.apiKey) {
    return [];
  }

  const tautulli = new TautulliAPI(tautulliSettings);
  const tmdb = new TheMovieDb();
  const requestRepository = getRepository(MediaRequest);
  const responseRepository = getRepository(MediaCleanupResponse);
  const userRepository = getRepository(User);

  // Get admin for Plex API access
  const admin = await userRepository.findOneOrFail({
    select: { id: true, plexToken: true },
    where: { id: 1 },
  });
  const plexApi = new PlexAPI({ plexToken: admin.plexToken });

  // Get all Seerr users with plexIds for mapping
  const allUsers = await userRepository.find();
  const plexIdToUser = new Map(
    allUsers.filter((u) => u.plexId).map((u) => [u.plexId!, u])
  );

  // Query APPROVED/COMPLETED requests with available media
  const requests = await requestRepository
    .createQueryBuilder('request')
    .innerJoinAndSelect('request.media', 'media')
    .innerJoinAndSelect('request.requestedBy', 'user')
    .leftJoinAndSelect('request.seasons', 'seasons')
    .where('request.status IN (:...statuses)', {
      statuses: [MediaRequestStatus.APPROVED, MediaRequestStatus.COMPLETED],
    })
    .andWhere(
      '(media.status = :available OR media.status4k = :available)',
      { available: MediaStatus.AVAILABLE }
    )
    .andWhere('media.ratingKey IS NOT NULL')
    .orderBy('request.createdAt', 'ASC')
    .take(30)
    .getMany();

  // Deduplicate by mediaId
  const seen = new Set<number>();
  const uniqueRequests: MediaRequest[] = [];
  for (const req of requests) {
    if (!seen.has(req.media.id)) {
      seen.add(req.media.id);
      uniqueRequests.push(req);
    }
  }

  // Load all existing responses
  const existingResponses = await responseRepository.find();
  const responseMap = new Map<string, MediaCleanupResponse>();
  for (const resp of existingResponses) {
    responseMap.set(`${resp.mediaId}:${resp.userId}`, resp);
  }

  const results: CleanupCandidate[] = [];
  const nowSec = Math.floor(Date.now() / 1000);

  for (const request of uniqueRequests) {
    if (results.length >= 10) break;

    try {
      const media = request.media;
      const ratingKey = media.ratingKey as string;

      // Get TMDB data
      let title = '';
      let posterPath: string | null = null;
      let year = '';
      let tmdbSeasons: { season_number: number; episode_count: number }[] = [];

      try {
        if (media.mediaType === MediaType.MOVIE) {
          const movie = await tmdb.getMovie({ movieId: media.tmdbId });
          title = movie.title;
          posterPath = movie.poster_path ?? null;
          year = movie.release_date
            ? new Date(movie.release_date).getFullYear().toString()
            : '';
        } else {
          const tv = await tmdb.getTvShow({ tvId: media.tmdbId });
          title = tv.name;
          posterPath = tv.poster_path ?? null;
          year = tv.first_air_date
            ? new Date(tv.first_air_date).getFullYear().toString()
            : '';
          tmdbSeasons = tv.seasons
            .filter((s) => s.season_number > 0)
            .map((s) => ({
              season_number: s.season_number,
              episode_count: s.episode_count,
            }));
        }
      } catch {
        title = `Unknown (TMDB ${media.tmdbId})`;
      }

      // Get watchers from Tautulli
      const watchUsers = await tautulli.getMediaWatchUsers(ratingKey);

      if (watchUsers.length === 0) continue;

      if (media.mediaType === MediaType.MOVIE) {
        // MOVIE: check each watcher
        const userStatuses: CleanupUserStatus[] = [];

        for (const wu of watchUsers) {
          const seerrUser = plexIdToUser.get(wu.user_id);
          if (!seerrUser) continue;

          const existingResp = responseMap.get(`${media.id}:${seerrUser.id}`);

          let status: UserWatchStatus;

          const progress = await tautulli.getMovieWatchProgress(ratingKey, wu.user_id);

          if (progress.watched) {
            status = 'finished';
          } else if (existingResp?.response === 'consent') {
            status = 'consented';
          } else if (
            existingResp?.response === 'snooze' &&
            existingResp.snoozeUntil &&
            new Date(existingResp.snoozeUntil) > new Date()
          ) {
            status = 'snoozed';
          } else if (nowSec - progress.lastWatchedAt > THIRTY_DAYS_SEC) {
            status = 'pending';
          } else {
            status = 'active';
          }

          userStatuses.push({
            id: seerrUser.id,
            plexId: wu.user_id,
            displayName: seerrUser.displayName,
            avatar: seerrUser.avatar,
            status,
            snoozeUntil: existingResp?.snoozeUntil?.toISOString() ?? undefined,
          });
        }

        if (userStatuses.length === 0) continue;

        const readyToDelete = userStatuses.every(
          (u) => u.status === 'finished' || u.status === 'consented'
        );

        results.push({
          mediaId: media.id,
          tmdbId: media.tmdbId,
          mediaType: MediaType.MOVIE,
          title,
          posterPath,
          year,
          seasonNumber: null,
          readyToDelete,
          users: userStatuses,
        });
      } else {
        // TV: per-season logic
        // Get season ratingKeys from Plex
        let plexSeasons: { ratingKey: string; index: number }[] = [];
        try {
          const children = await plexApi.getChildrenMetadata(ratingKey);
          plexSeasons = children
            .filter((c) => c.type === 'season' && c.index > 0)
            .map((c) => ({ ratingKey: c.ratingKey, index: c.index }));
        } catch {
          logger.warn('Failed to get Plex seasons for cleanup', {
            label: 'Cleanup',
            mediaId: media.id,
          });
          continue;
        }

        for (const plexSeason of plexSeasons) {
          if (results.length >= 10) break;

          const tmdbSeason = tmdbSeasons.find(
            (s) => s.season_number === plexSeason.index
          );
          if (!tmdbSeason || tmdbSeason.episode_count === 0) continue;

          const userStatuses: CleanupUserStatus[] = [];

          for (const wu of watchUsers) {
            const seerrUser = plexIdToUser.get(wu.user_id);
            if (!seerrUser) continue;

            // Use mediaId:seasonNumber as key for per-season responses
            const responseKey = `${media.id}:${seerrUser.id}`;
            const existingResp = responseMap.get(responseKey);

            let status: UserWatchStatus;

            try {
              const progress = await tautulli.getSeasonWatchProgress(
                plexSeason.ratingKey,
                wu.user_id
              );

              const completionRatio =
                progress.uniqueEpisodes / tmdbSeason.episode_count;

              if (completionRatio >= COMPLETION_THRESHOLD) {
                status = 'finished';
              } else if (progress.uniqueEpisodes === 0) {
                continue; // Never watched this season
              } else if (existingResp?.response === 'consent') {
                status = 'consented';
              } else if (
                existingResp?.response === 'snooze' &&
                existingResp.snoozeUntil &&
                new Date(existingResp.snoozeUntil) > new Date()
              ) {
                status = 'snoozed';
              } else if (nowSec - progress.lastWatchedAt > THIRTY_DAYS_SEC) {
                status = 'pending';
              } else {
                status = 'active';
              }
            } catch {
              continue;
            }

            userStatuses.push({
              id: seerrUser.id,
              plexId: wu.user_id,
              displayName: seerrUser.displayName,
              avatar: seerrUser.avatar,
              status,
              snoozeUntil: existingResp?.snoozeUntil?.toISOString() ?? undefined,
            });
          }

          if (userStatuses.length === 0) continue;

          const readyToDelete = userStatuses.every(
            (u) => u.status === 'finished' || u.status === 'consented'
          );

          results.push({
            mediaId: media.id,
            tmdbId: media.tmdbId,
            mediaType: MediaType.TV,
            title: `${title} - Season ${plexSeason.index}`,
            posterPath,
            year,
            seasonNumber: plexSeason.index,
            readyToDelete,
            users: userStatuses,
          });
        }
      }
    } catch (e) {
      logger.warn('Failed to process cleanup candidate', {
        label: 'Cleanup',
        mediaId: request.media.id,
        errorMessage: e.message,
      });
      continue;
    }
  }

  return results;
}

// GET /api/v1/cleanup
cleanupRoutes.get('/', async (req, res, next) => {
  try {
    // Return cached data if fresh
    if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
      return res.status(200).json({
        results: filterForUser(cache.data, req.user!),
      });
    }

    const candidates = await buildCleanupCandidates();
    cache = { data: candidates, timestamp: Date.now() };

    return res.status(200).json({
      results: filterForUser(candidates, req.user!),
    });
  } catch (e) {
    logger.error('Failed to fetch cleanup candidates', {
      label: 'Cleanup',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Failed to fetch cleanup candidates.' });
  }
});

function filterForUser(candidates: CleanupCandidate[], user: User): CleanupCandidate[] {
  const isAdmin = user.hasPermission(Permission.MANAGE_REQUESTS);

  if (isAdmin) {
    return candidates;
  }

  // Normal users: only see items where they are 'pending'
  return candidates
    .filter((c) => c.users.some((u) => u.id === user.id && u.status === 'pending'))
    .map((c) => ({
      ...c,
      users: c.users.filter((u) => u.id === user.id),
    }));
}

// POST /api/v1/cleanup/:mediaId/consent
cleanupRoutes.post<{ mediaId: string }>('/:mediaId/consent', async (req, res, next) => {
  try {
    const mediaId = Number(req.params.mediaId);
    const userId = req.user!.id;
    const responseRepository = getRepository(MediaCleanupResponse);

    await responseRepository.delete({ mediaId, userId });

    const entry = new MediaCleanupResponse();
    entry.mediaId = mediaId;
    entry.userId = userId;
    entry.response = 'consent';
    entry.respondedAt = new Date();
    entry.snoozeUntil = null;

    await responseRepository.save(entry);

    cache = null;

    // Check if all users are now ready → auto-delete
    const candidates = await buildCleanupCandidates();
    cache = { data: candidates, timestamp: Date.now() };

    const candidate = candidates.find((c) => c.mediaId === mediaId);
    if (candidate?.readyToDelete) {
      await deleteMediaFromServices(mediaId);
    }

    return res.status(200).json({ mediaId, response: 'consent' });
  } catch (e) {
    logger.error('Failed to record cleanup consent', {
      label: 'Cleanup',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Failed to record consent.' });
  }
});

// POST /api/v1/cleanup/:mediaId/snooze
cleanupRoutes.post<{ mediaId: string }>('/:mediaId/snooze', async (req, res, next) => {
  try {
    const mediaId = Number(req.params.mediaId);
    const userId = req.user!.id;
    const responseRepository = getRepository(MediaCleanupResponse);

    const now = new Date();
    const snoozeUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await responseRepository.delete({ mediaId, userId });

    const entry = new MediaCleanupResponse();
    entry.mediaId = mediaId;
    entry.userId = userId;
    entry.response = 'snooze';
    entry.respondedAt = now;
    entry.snoozeUntil = snoozeUntil;

    await responseRepository.save(entry);

    cache = null;

    return res.status(200).json({
      mediaId,
      response: 'snooze',
      snoozeUntil: snoozeUntil.toISOString(),
    });
  } catch (e) {
    logger.error('Failed to snooze cleanup item', {
      label: 'Cleanup',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Failed to snooze cleanup item.' });
  }
});

// DELETE /api/v1/cleanup/:mediaId - Admin force delete
cleanupRoutes.delete<{ mediaId: string }>('/:mediaId', async (req, res, next) => {
  if (!req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
    return next({ status: 403, message: 'Insufficient permissions.' });
  }

  try {
    const mediaId = Number(req.params.mediaId);
    await deleteMediaFromServices(mediaId);

    cache = null;
    return res.status(204).send();
  } catch (e) {
    logger.error('Failed to delete cleanup item', {
      label: 'Cleanup',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Failed to delete cleanup item.' });
  }
});

async function deleteMediaFromServices(mediaId: number): Promise<void> {
  const mediaRepository = getRepository(Media);
  const settings = getSettings();

  const media = await mediaRepository.findOne({ where: { id: mediaId } });
  if (!media) return;

  const isMovie = media.mediaType === MediaType.MOVIE;
  const is4k =
    media.status4k === MediaStatus.AVAILABLE &&
    media.status !== MediaStatus.AVAILABLE;

  const serviceSettings = isMovie
    ? settings.radarr.find((r) =>
        is4k ? r.is4k && r.isDefault : !r.is4k && r.isDefault
      )
    : settings.sonarr.find((s) =>
        is4k ? s.is4k && s.isDefault : !s.is4k && s.isDefault
      );

  if (serviceSettings) {
    try {
      if (isMovie) {
        const radarr = new RadarrAPI({
          apiKey: serviceSettings.apiKey,
          url: RadarrAPI.buildUrl(serviceSettings, '/api/v3'),
        });
        await radarr.removeMovie(media.tmdbId);
      } else {
        const sonarr = new SonarrAPI({
          apiKey: serviceSettings.apiKey,
          url: SonarrAPI.buildUrl(serviceSettings, '/api/v3'),
        });
        const tmdb = new TheMovieDb();
        const series = await tmdb.getTvShow({ tvId: media.tmdbId });
        const tvdbId = series.external_ids.tvdb_id ?? media.tvdbId;
        if (tvdbId) {
          await sonarr.removeSeries(tvdbId);
        }
      }
    } catch (e) {
      logger.warn(
        'Failed to remove media from service, continuing with DB cleanup',
        { label: 'Cleanup', mediaId, errorMessage: e.message }
      );
    }
  }

  await mediaRepository.remove(media);
}

export default cleanupRoutes;
