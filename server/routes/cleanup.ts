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
import { MediaCleanupSnooze } from '@server/entity/MediaCleanupSnooze';
import { MediaRequest } from '@server/entity/MediaRequest';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const cleanupRoutes = Router();

// Simple in-memory cache (5 min TTL)
let cache: { data: CleanupResult[]; timestamp: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

interface CleanupResult {
  mediaId: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  posterPath: string | null;
  year: string;
  requestedBy: {
    id: number;
    displayName: string;
    avatar: string;
  };
  requestedAt: string;
  watchStats: {
    totalPlays: number;
    totalTime: number;
  };
}

cleanupRoutes.get('/', async (_req, res, next) => {
  try {
    const settings = getSettings();
    const tautulliSettings = settings.tautulli;

    if (
      !tautulliSettings.hostname ||
      !tautulliSettings.port ||
      !tautulliSettings.apiKey
    ) {
      return res.status(200).json({ results: [] });
    }

    // Return cached data if fresh
    if (cache && Date.now() - cache.timestamp < CACHE_TTL) {
      return res.status(200).json({ results: cache.data });
    }

    const tautulli = new TautulliAPI(tautulliSettings);
    const requestRepository = getRepository(MediaRequest);
    const snoozeRepository = getRepository(MediaCleanupSnooze);

    // Get active snooze mediaIds
    const activeSnoozes = await snoozeRepository
      .createQueryBuilder('snooze')
      .where('snooze.snoozeUntil > :now', { now: new Date().toISOString() })
      .getMany();
    const snoozedMediaIds = activeSnoozes.map((s) => s.mediaId);

    // Query completed requests with available media, oldest first
    const qb = requestRepository
      .createQueryBuilder('request')
      .innerJoinAndSelect('request.media', 'media')
      .innerJoinAndSelect('request.requestedBy', 'user')
      .where('request.status IN (:...statuses)', {
        statuses: [MediaRequestStatus.APPROVED, MediaRequestStatus.COMPLETED],
      })
      .andWhere(
        '(media.status = :available OR media.status4k = :available)',
        { available: MediaStatus.AVAILABLE }
      )
      .andWhere('media.ratingKey IS NOT NULL')
      .orderBy('request.createdAt', 'ASC')
      .take(30);

    if (snoozedMediaIds.length > 0) {
      qb.andWhere('media.id NOT IN (:...snoozedIds)', {
        snoozedIds: snoozedMediaIds,
      });
    }

    const candidates = await qb.getMany();

    // Deduplicate by mediaId (keep oldest request per media)
    const seen = new Set<number>();
    const uniqueCandidates: MediaRequest[] = [];
    for (const req of candidates) {
      if (!seen.has(req.media.id)) {
        seen.add(req.media.id);
        uniqueCandidates.push(req);
      }
    }

    // Check Tautulli for each candidate, collect up to 5 watched items
    const results: CleanupResult[] = [];
    const tmdb = new TheMovieDb();

    for (const request of uniqueCandidates) {
      if (results.length >= 5) break;

      try {
        const ratingKey = request.media.ratingKey as string;
        const watchStats = await tautulli.getMediaWatchStats(ratingKey);
        const allTimeStats = watchStats.find((s) => s.query_days === 0);

        if (!allTimeStats || allTimeStats.total_plays === 0) {
          continue;
        }

        // Fetch TMDB data for title/poster
        let title = '';
        let posterPath: string | null = null;
        let year = '';

        try {
          if (request.media.mediaType === MediaType.MOVIE) {
            const movie = await tmdb.getMovie({
              movieId: request.media.tmdbId,
            });
            title = movie.title;
            posterPath = movie.poster_path ?? null;
            year = movie.release_date
              ? new Date(movie.release_date).getFullYear().toString()
              : '';
          } else {
            const tv = await tmdb.getTvShow({
              tvId: request.media.tmdbId,
            });
            title = tv.name;
            posterPath = tv.poster_path ?? null;
            year = tv.first_air_date
              ? new Date(tv.first_air_date).getFullYear().toString()
              : '';
          }
        } catch {
          title = `Unknown (TMDB ${request.media.tmdbId})`;
        }

        results.push({
          mediaId: request.media.id,
          tmdbId: request.media.tmdbId,
          mediaType: request.media.mediaType as MediaType,
          title,
          posterPath,
          year,
          requestedBy: {
            id: request.requestedBy.id,
            displayName: request.requestedBy.displayName,
            avatar: request.requestedBy.avatar,
          },
          requestedAt: request.createdAt.toISOString(),
          watchStats: {
            totalPlays: allTimeStats.total_plays,
            totalTime: allTimeStats.total_time,
          },
        });
      } catch (e) {
        logger.warn('Failed to check watch stats for cleanup candidate', {
          label: 'Cleanup',
          mediaId: request.media.id,
          errorMessage: e.message,
        });
        continue;
      }
    }

    // Update cache
    cache = { data: results, timestamp: Date.now() };

    return res.status(200).json({ results });
  } catch (e) {
    logger.error('Failed to fetch cleanup candidates', {
      label: 'Cleanup',
      errorMessage: e.message,
    });
    next({ status: 500, message: 'Failed to fetch cleanup candidates.' });
  }
});

cleanupRoutes.delete<{ mediaId: string }>('/:mediaId', async (req, res, next) => {
  try {
    const mediaId = Number(req.params.mediaId);
    const mediaRepository = getRepository(Media);
    const settings = getSettings();

    const media = await mediaRepository.findOne({
      where: { id: mediaId },
    });

    if (!media) {
      return next({ status: 404, message: 'Media not found.' });
    }

    // Delete files from Radarr/Sonarr
    const isMovie = media.mediaType === MediaType.MOVIE;
    const is4k = media.status4k === MediaStatus.AVAILABLE && media.status !== MediaStatus.AVAILABLE;

    const serviceSettings = isMovie
      ? settings.radarr.find((r) => (is4k ? r.is4k && r.isDefault : !r.is4k && r.isDefault))
      : settings.sonarr.find((s) => (is4k ? s.is4k && s.isDefault : !s.is4k && s.isDefault));

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
        logger.warn('Failed to remove media from service, continuing with DB cleanup', {
          label: 'Cleanup',
          mediaId,
          errorMessage: e.message,
        });
      }
    }

    // Remove media record from DB (cascades to requests)
    await mediaRepository.remove(media);

    // Invalidate cache
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

cleanupRoutes.post<{ mediaId: string }>('/:mediaId/snooze', async (req, res, next) => {
  try {
    const mediaId = Number(req.params.mediaId);
    const snoozeRepository = getRepository(MediaCleanupSnooze);

    const now = new Date();
    const snoozeUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Upsert: remove existing snooze for this media, then insert new one
    await snoozeRepository.delete({ mediaId });

    const snooze = new MediaCleanupSnooze();
    snooze.mediaId = mediaId;
    snooze.snoozedAt = now;
    snooze.snoozeUntil = snoozeUntil;

    await snoozeRepository.save(snooze);

    // Invalidate cache
    cache = null;

    return res.status(200).json({
      mediaId,
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

export default cleanupRoutes;
