import { useState, useCallback, useRef } from 'react';
import { getDb } from '../database/useDatabase';
import { MediaType, MediaStatus, MediaCategory } from '../database/schema';
import { useSyncStore } from '../store/useSyncStore';
import { supabase } from '../services/supabase';
import { getMediaDetails, checkIfAnime, findBestTrailer } from '../services/tmdb';

export interface MediaListItem {
  tmdb_id: number;
  media_type: MediaType;
  status: MediaStatus;
  updated_at: number;
  sync_pending: number; // 0 or 1 in SQLite
  title: string | null;
  overview: string | null;
  poster_path: string | null;
  is_anime?: number | null;
  release_date?: string | null;
  vote_average?: number | null;
  season_count?: number | null;
  trailer_key?: string | null;
  episode_count?: number | null;
  air_status?: string | null;
  next_air_date?: string | null;
  next_episode_info?: string | null;
  watched_episodes_count?: number;
  user_rating?: number | null;
  user_notes?: string | null;
  is_pinned?: number | null;
}

export interface MediaMetadataInput {
  title?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  is_anime?: boolean | number;
  release_date?: string | null;
  vote_average?: number | null;
  season_count?: number | null;
  trailer_key?: string | null;
  episode_count?: number | null;
  air_status?: string | null;
  next_air_date?: string | null;
  next_episode_info?: string | null;
}

export const useMediaList = () => {
  const [data, setData] = useState<MediaListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const backfilledKeysRef = useRef<Set<string>>(new Set());
  
  const { runSync } = useSyncStore();

  const backfillMetadata = useCallback(async (items: MediaListItem[]) => {
    try {
      const db = await getDb();
      let hasChanges = false;

      for (const item of items) {
        const key = `${item.media_type}-${item.tmdb_id}`;
        if (backfilledKeysRef.current.has(key)) continue;
        backfilledKeysRef.current.add(key);

        try {
          const details = await getMediaDetails(item.media_type, item.tmdb_id);
          const isAnime = checkIfAnime(details);
          const trailerKey = findBestTrailer(details.videos?.results || []);
          const seasonCount = details.number_of_seasons || details.seasons?.filter(s => s.season_number > 0).length || 0;
          const episodeCount = details.number_of_episodes || details.seasons?.reduce((acc, s) => s.season_number > 0 ? acc + (s.episode_count || 0) : acc, 0) || 0;
          const releaseDate = details.release_date || details.first_air_date || null;
          const voteAverage = details.vote_average ?? null;
          const airStatus = details.status || null;
          const nextAirDate = details.next_episode_to_air?.air_date || null;
          const nextEpisodeInfo = details.next_episode_to_air 
            ? `T${details.next_episode_to_air.season_number} E${details.next_episode_to_air.episode_number}` 
            : null;

          await db.runAsync(
            `INSERT OR REPLACE INTO media_cache (
              tmdb_id, media_type, title, overview, poster_path, is_anime, release_date, vote_average, season_count, trailer_key, episode_count, air_status, next_air_date, next_episode_info, last_fetched_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              Number(item.tmdb_id),
              String(item.media_type),
              details.title || details.name || item.title || '',
              details.overview ? String(details.overview) : item.overview,
              details.poster_path ? String(details.poster_path) : item.poster_path,
              isAnime ? 1 : 0,
              releaseDate,
              voteAverage,
              seasonCount,
              trailerKey,
              episodeCount,
              airStatus,
              nextAirDate,
              nextEpisodeInfo,
              Date.now()
            ]
          );
          hasChanges = true;
        } catch (err) {
          console.error(`Failed to backfill metadata for ${item.media_type} ${item.tmdb_id}:`, err);
        }
      }

      if (hasChanges) {
        const updated = await db.getAllAsync<MediaListItem>(
          `SELECT q.*, c.title, c.overview, c.poster_path, c.is_anime, c.release_date, c.vote_average, c.season_count, c.trailer_key,
                  c.episode_count, c.air_status, c.next_air_date, c.next_episode_info,
                  COALESCE((
                    SELECT COUNT(*) 
                    FROM sync_episodes_queue eq 
                    WHERE eq.tmdb_id = q.tmdb_id AND eq.watched = 1
                  ), 0) AS watched_episodes_count
           FROM sync_queue q
           LEFT JOIN media_cache c ON q.tmdb_id = c.tmdb_id AND q.media_type = c.media_type
           ORDER BY COALESCE(q.is_pinned, 0) DESC, q.updated_at DESC`
        );
        setData(updated);
      }
    } catch (e) {
      console.error('Error during backfillMetadata:', e);
    }
  }, []);

  const loadMedia = useCallback(async (filterStatus?: MediaStatus, filterCategory?: MediaCategory) => {
    setLoading(true);
    try {
      const db = await getDb();
      let query = `
        SELECT q.*, c.title, c.overview, c.poster_path, c.is_anime, c.release_date, c.vote_average, c.season_count, c.trailer_key,
               c.episode_count, c.air_status, c.next_air_date, c.next_episode_info,
               COALESCE((
                 SELECT COUNT(*) 
                 FROM sync_episodes_queue eq 
                 WHERE eq.tmdb_id = q.tmdb_id AND eq.watched = 1
               ), 0) AS watched_episodes_count
        FROM sync_queue q
        LEFT JOIN media_cache c ON q.tmdb_id = c.tmdb_id AND q.media_type = c.media_type
        WHERE 1 = $dummy
      `;
      const params: Record<string, any> = { $dummy: 1 };
      
      if (filterStatus) {
        query += ` AND q.status = $status`;
        params.$status = String(filterStatus);
      }

      if (filterCategory && filterCategory !== 'all') {
        if (filterCategory === 'anime') {
          query += ` AND c.is_anime = 1`;
        } else if (filterCategory === 'movie') {
          query += ` AND q.media_type = 'movie' AND (c.is_anime = 0 OR c.is_anime IS NULL)`;
        } else if (filterCategory === 'tv') {
          query += ` AND q.media_type = 'tv' AND (c.is_anime = 0 OR c.is_anime IS NULL)`;
        }
      }
      
      query += ` ORDER BY COALESCE(q.is_pinned, 0) DESC, q.updated_at DESC`;

      const result = await db.getAllAsync<MediaListItem>(query, params);

      // Clamp watched_episodes_count to episode_count and clean up excess in background if needed
      for (const row of result) {
        if (row.episode_count && row.episode_count > 0 && (row.watched_episodes_count || 0) > row.episode_count) {
          const excess = (row.watched_episodes_count || 0) - row.episode_count;
          db.getAllAsync<{ season_number: number; episode_number: number }>(
            'SELECT season_number, episode_number FROM sync_episodes_queue WHERE tmdb_id = ? AND watched = 1 ORDER BY season_number DESC, episode_number DESC',
            [Number(row.tmdb_id)]
          ).then((eps) => {
            const toDel = eps.slice(0, excess);
            for (const ep of toDel) {
              db.runAsync(
                'DELETE FROM sync_episodes_queue WHERE tmdb_id = ? AND season_number = ? AND episode_number = ?',
                [Number(row.tmdb_id), ep.season_number, ep.episode_number]
              );
            }
          }).catch((err) => console.error('Failed to clean up excess episodes:', err));

          row.watched_episodes_count = row.episode_count;
        }
      }

      setData(result);

      // Check if any items need metadata population (e.g. Boruto/Slime with missing release_date, unclassified anime, or missing episode count)
      const needsBackfill = result.filter(
        item => item.release_date === null || 
                (item.media_type === 'tv' && (item.is_anime === 0 || item.is_anime === null || item.episode_count == null || item.air_status == null))
      );
      if (needsBackfill.length > 0) {
        setTimeout(() => {
          backfillMetadata(needsBackfill);
        }, 50);
      }
    } catch (e) {
      console.error('Error loading media:', e);
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, [backfillMetadata]);

  const addOrUpdateMedia = async (
    tmdb_id: number,
    media_type: MediaType,
    status: MediaStatus,
    metadata?: MediaMetadataInput
  ) => {
    if (!tmdb_id || !media_type || !status) {
      console.warn('Invalid data passed to addOrUpdateMedia:', { tmdb_id, media_type, status });
      return;
    }
    
    try {
      const db = await getDb();
      const now = Date.now();
      
      await db.runAsync(
        `INSERT INTO sync_queue (tmdb_id, media_type, status, updated_at, sync_pending) 
         VALUES ($tmdb_id, $media_type, $status, $updated_at, 1)
         ON CONFLICT (tmdb_id, media_type) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at,
           sync_pending = 1`,
        {
          $tmdb_id: Number(tmdb_id),
          $media_type: String(media_type),
          $status: String(status),
          $updated_at: Number(now)
        }
      );

      if (metadata) {
        await db.runAsync(
          `INSERT OR REPLACE INTO media_cache (
            tmdb_id, media_type, title, overview, poster_path, is_anime, release_date, vote_average, season_count, trailer_key, episode_count, air_status, next_air_date, next_episode_info, last_fetched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            Number(tmdb_id),
            String(media_type),
            metadata.title ?? null,
            metadata.overview ?? null,
            metadata.poster_path ?? null,
            metadata.is_anime ? 1 : 0,
            metadata.release_date ?? null,
            metadata.vote_average ?? null,
            metadata.season_count ?? 0,
            metadata.trailer_key ?? null,
            metadata.episode_count ?? 0,
            metadata.air_status ?? null,
            metadata.next_air_date ?? null,
            metadata.next_episode_info ?? null,
            Number(now)
          ]
        );
      }
      
      // Clear pending deletion queue if it was previously deleted
      await db.runAsync(
        'DELETE FROM deleted_media_queue WHERE tmdb_id = $tmdb_id AND media_type = $media_type',
        { $tmdb_id: Number(tmdb_id), $media_type: String(media_type) }
      );
      
      // Refresh local list immediately
      await loadMedia();
      
      // Attempt background sync
      runSync().catch((err) => console.error('Background sync failed:', err));
    } catch (e) {
      console.error('Error saving media:', e);
      throw e;
    }
  };

  const removeMedia = async (tmdb_id: number, media_type: MediaType) => {
    if (!tmdb_id || !media_type) {
      console.warn('Invalid data passed to removeMedia:', { tmdb_id, media_type });
      return;
    }

    try {
      const db = await getDb();
      const now = Date.now();

      // 1. Delete from local sync_queue and sync_episodes_queue
      await db.runAsync(
        'DELETE FROM sync_queue WHERE tmdb_id = $tmdb_id AND media_type = $media_type',
        { $tmdb_id: Number(tmdb_id), $media_type: String(media_type) }
      );
      await db.runAsync(
        'DELETE FROM sync_episodes_queue WHERE tmdb_id = $tmdb_id',
        { $tmdb_id: Number(tmdb_id) }
      );

      // 2. Queue for deletion on Supabase
      await db.runAsync(
        `INSERT OR REPLACE INTO deleted_media_queue (tmdb_id, media_type, deleted_at)
         VALUES ($tmdb_id, $media_type, $deleted_at)`,
        {
          $tmdb_id: Number(tmdb_id),
          $media_type: String(media_type),
          $deleted_at: Number(now),
        }
      );

      // Optimistic update of local UI list immediately
      setData((prev) => prev.filter((item) => !(Number(item.tmdb_id) === Number(tmdb_id) && item.media_type === media_type)));

      // 3. Attempt immediate remote removal from Supabase if authenticated
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase
            .from('user_media')
            .delete()
            .match({ user_id: user.id, tmdb_id: Number(tmdb_id), media_type: String(media_type) });

          await supabase
            .from('user_episodes')
            .delete()
            .match({ user_id: user.id, tmdb_id: Number(tmdb_id) });

          // Removal confirmed remotely, remove from local deletion queue
          await db.runAsync(
            'DELETE FROM deleted_media_queue WHERE tmdb_id = $tmdb_id AND media_type = $media_type',
            { $tmdb_id: Number(tmdb_id), $media_type: String(media_type) }
          );
        }
      } catch (remoteErr) {
        console.warn('Could not sync removal to Supabase immediately (will retry on next sync):', remoteErr);
      }

      await loadMedia();
    } catch (e) {
      console.error('Error removing media:', e);
      throw e;
    }
  };

  const updateUserReview = async (
    tmdb_id: number,
    media_type: MediaType,
    user_rating: number | null,
    user_notes: string | null
  ) => {
    try {
      const db = await getDb();
      const now = Date.now();
      await db.runAsync(
        `INSERT INTO sync_queue (tmdb_id, media_type, status, user_rating, user_notes, updated_at, sync_pending)
         VALUES ($tmdb_id, $media_type, 'plan_to_watch', $rating, $notes, $now, 1)
         ON CONFLICT (tmdb_id, media_type) DO UPDATE SET
           user_rating = excluded.user_rating,
           user_notes = excluded.user_notes,
           updated_at = excluded.updated_at,
           sync_pending = 1`,
        {
          $rating: user_rating ?? null,
          $notes: user_notes ?? null,
          $now: Number(now),
          $tmdb_id: Number(tmdb_id),
          $media_type: String(media_type),
        }
      );
      await loadMedia();
      runSync().catch((err) => console.error('Background sync failed:', err));
    } catch (e) {
      console.error('Error updating user review:', e);
      throw e;
    }
  };

  const togglePinMedia = useCallback(async (tmdb_id: number, media_type: MediaType) => {
    try {
      const db = await getDb();
      await db.runAsync(
        `UPDATE sync_queue 
         SET is_pinned = CASE WHEN COALESCE(is_pinned, 0) = 1 THEN 0 ELSE 1 END,
             updated_at = $updated_at,
             sync_pending = 1
         WHERE tmdb_id = $tmdb_id AND media_type = $media_type`,
        {
          $tmdb_id: Number(tmdb_id),
          $media_type: String(media_type),
          $updated_at: Date.now(),
        }
      );
      await loadMedia();
      runSync().catch((err) => console.error('Background sync failed:', err));
    } catch (e) {
      console.error('Error toggling pin:', e);
      throw e;
    }
  }, [loadMedia, runSync]);

  const quickIncrementEpisode = useCallback(async (item: MediaListItem) => {
    if (item.media_type !== 'tv') return;
    try {
      const db = await getDb();
      const currentWatched = item.watched_episodes_count || 0;
      const totalEpisodes = item.episode_count || 0;

      // Validation: If totalEpisodes is known and already 100% watched, do not increment further!
      if (totalEpisodes > 0 && currentWatched >= totalEpisodes) {
        if (item.status !== 'completed') {
          await db.runAsync(
            "UPDATE sync_queue SET status = 'completed', updated_at = ?, sync_pending = 1 WHERE tmdb_id = ? AND media_type = 'tv'",
            [Date.now(), Number(item.tmdb_id)]
          );
          await loadMedia();
        }
        return;
      }

      const nextWatched = currentWatched + 1;

      const lastWatched = await db.getFirstAsync<{ season_number: number; episode_number: number }>(
        'SELECT season_number, episode_number FROM sync_episodes_queue WHERE tmdb_id = ? AND watched = 1 ORDER BY season_number DESC, episode_number DESC LIMIT 1',
        [Number(item.tmdb_id)]
      );

      const targetSeason = lastWatched?.season_number || 1;
      const targetEpisode = (lastWatched?.episode_number || 0) + 1;
      const now = Date.now();

      await db.runAsync(
        `INSERT OR REPLACE INTO sync_episodes_queue (tmdb_id, season_number, episode_number, watched, updated_at, sync_pending) 
         VALUES (?, ?, ?, 1, ?, 1)`,
        [Number(item.tmdb_id), targetSeason, targetEpisode, now]
      );

      const nextStatus = (totalEpisodes > 0 && nextWatched >= totalEpisodes) ? 'completed' : 'watching';

      await db.runAsync(
        `UPDATE sync_queue SET status = ?, updated_at = ?, sync_pending = 1 WHERE tmdb_id = ? AND media_type = 'tv'`,
        [nextStatus, now, Number(item.tmdb_id)]
      );

      await loadMedia();
      runSync().catch((err) => console.error('Background sync failed:', err));
    } catch (e) {
      console.error('Error incrementing episode:', e);
    }
  }, [loadMedia, runSync]);

  return {
    data,
    loading,
    error,
    loadMedia,
    addOrUpdateMedia,
    removeMedia,
    updateUserReview,
    togglePinMedia,
    quickIncrementEpisode,
  };
};
