import { getDb } from '../database/useDatabase';
import { supabase } from './supabase';
import { getMediaDetails, checkIfAnime, findBestTrailer } from './tmdb';
import { MediaType, MediaStatus } from '../database/schema';

export const syncEngine = {
  async sync() {
    try {
      const db = await getDb();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('User not authenticated for sync');
      }

      // 0. Push pending deletions to Supabase
      const pendingDeletions = await db.getAllAsync<{ tmdb_id: number; media_type: MediaType }>(
        'SELECT tmdb_id, media_type FROM deleted_media_queue'
      );
      if (pendingDeletions.length > 0) {
        for (const del of pendingDeletions) {
          try {
            await supabase
              .from('user_media')
              .delete()
              .match({ user_id: user.id, tmdb_id: Number(del.tmdb_id), media_type: String(del.media_type) });

            await supabase
              .from('user_episodes')
              .delete()
              .match({ user_id: user.id, tmdb_id: Number(del.tmdb_id) });

            await db.runAsync(
              'DELETE FROM deleted_media_queue WHERE tmdb_id = $tmdb_id AND media_type = $media_type',
              { $tmdb_id: Number(del.tmdb_id), $media_type: String(del.media_type) }
            );
          } catch (delErr) {
            console.warn('Failed to sync deletion for', del, delErr);
          }
        }
      }

      // 1. Push local changes to Supabase (Upsert)
      const pendingItems = await db.getAllAsync<{ 
        tmdb_id: number; 
        media_type: MediaType; 
        status: MediaStatus; 
        user_rating?: number | null;
        user_notes?: string | null;
        is_pinned?: number | null;
        updated_at: number; 
        sync_pending: number 
      }>(
        'SELECT * FROM sync_queue WHERE sync_pending = $pending',
        { $pending: 1 }
      );

      if (pendingItems.length > 0) {
        const payload = pendingItems.map(item => ({
          user_id: user.id,
          tmdb_id: item.tmdb_id,
          media_type: item.media_type,
          status: item.status,
          user_rating: item.user_rating ?? null,
          user_notes: item.user_notes ?? null,
          is_pinned: Boolean(item.is_pinned),
          updated_at: new Date(item.updated_at).toISOString(),
        }));

        let { error: upsertError } = await supabase
          .from('user_media')
          .upsert(payload, { onConflict: 'user_id, tmdb_id, media_type' });

        // If Supabase table does not yet have user_rating / user_notes / is_pinned columns, fallback to base payload
        if (upsertError && (upsertError.message?.includes('column') || (upsertError as any).code === '42703')) {
          const fallbackPayload = pendingItems.map(item => ({
            user_id: user.id,
            tmdb_id: item.tmdb_id,
            media_type: item.media_type,
            status: item.status,
            updated_at: new Date(item.updated_at).toISOString(),
          }));
          const fallbackResult = await supabase
            .from('user_media')
            .upsert(fallbackPayload, { onConflict: 'user_id, tmdb_id, media_type' });
          upsertError = fallbackResult.error;
        }

        if (upsertError) throw upsertError;

        for (const item of pendingItems) {
          await db.runAsync(
            'UPDATE sync_queue SET sync_pending = 0 WHERE tmdb_id = $tmdb_id AND media_type = $media_type',
            { $tmdb_id: Number(item.tmdb_id), $media_type: String(item.media_type) }
          );
        }
      }

      // 1.5 Push episodes changes
      const pendingEpisodes = await db.getAllAsync<{ tmdb_id: number; season_number: number; episode_number: number; watched: number; updated_at: number; sync_pending: number }>(
        'SELECT * FROM sync_episodes_queue WHERE sync_pending = $pending',
        { $pending: 1 }
      );

      if (pendingEpisodes.length > 0) {
        const payload = pendingEpisodes.map(item => ({
          user_id: user.id,
          tmdb_id: item.tmdb_id,
          season_number: item.season_number,
          episode_number: item.episode_number,
          watched: item.watched === 1,
          updated_at: new Date(item.updated_at).toISOString(),
        }));

        const { error: upsertError } = await supabase
          .from('user_episodes')
          .upsert(payload, { onConflict: 'user_id, tmdb_id, season_number, episode_number' });

        if (upsertError) throw upsertError;

        for (const item of pendingEpisodes) {
          await db.runAsync(
            'UPDATE sync_episodes_queue SET sync_pending = 0 WHERE tmdb_id = $tmdb_id AND season_number = $season_number AND episode_number = $episode_number',
            { 
              $tmdb_id: Number(item.tmdb_id), 
              $season_number: Number(item.season_number), 
              $episode_number: Number(item.episode_number) 
            }
          );
        }
      }

      // 2. Pull remote changes from Supabase
      // Conflict resolution: latest updated_at wins, but preserve local ratings/notes if remote is null
      const { data: remoteData, error: pullError } = await supabase
        .from('user_media')
        .select('*')
        .eq('user_id', user.id);

      if (pullError) throw pullError;

      // Pending deletions should not be re-pulled
      const remainingDeleted = await db.getAllAsync<{ tmdb_id: number; media_type: string }>(
        'SELECT tmdb_id, media_type FROM deleted_media_queue'
      );
      const deletedSet = new Set(remainingDeleted.map(d => `${d.media_type}-${d.tmdb_id}`));

      if (remoteData && remoteData.length > 0) {
        for (const remote of remoteData) {
          if (deletedSet.has(`${remote.media_type}-${remote.tmdb_id}`)) {
            continue;
          }
          const remoteTime = new Date(remote.updated_at).getTime();
          
          const localItem = await db.getFirstAsync<{ updated_at: number; user_rating?: number | null; user_notes?: string | null; is_pinned?: number | null }>(
            'SELECT updated_at, user_rating, user_notes, is_pinned FROM sync_queue WHERE tmdb_id = $tmdb_id AND media_type = $media_type',
            { $tmdb_id: Number(remote.tmdb_id), $media_type: String(remote.media_type) }
          );

          if (!localItem || localItem.updated_at < remoteTime) {
            await db.runAsync(
              `INSERT INTO sync_queue (tmdb_id, media_type, status, user_rating, user_notes, is_pinned, updated_at, sync_pending) 
               VALUES ($tmdb_id, $media_type, $status, $user_rating, $user_notes, $is_pinned, $updated_at, 0)
               ON CONFLICT(tmdb_id, media_type) DO UPDATE SET
                 status = excluded.status,
                 user_rating = COALESCE(excluded.user_rating, sync_queue.user_rating),
                 user_notes = COALESCE(excluded.user_notes, sync_queue.user_notes),
                 is_pinned = COALESCE(excluded.is_pinned, sync_queue.is_pinned),
                 updated_at = excluded.updated_at,
                 sync_pending = 0`,
              { 
                $tmdb_id: Number(remote.tmdb_id), 
                $media_type: String(remote.media_type), 
                $status: String(remote.status), 
                $user_rating: remote.user_rating ?? null,
                $user_notes: remote.user_notes ?? null,
                $is_pinned: remote.is_pinned ? 1 : 0,
                $updated_at: Number(remoteTime) 
              }
            );
          }
        }
      }

      // 2.5 Pull remote episodes
      const { data: remoteEpisodes, error: pullEpError } = await supabase
        .from('user_episodes')
        .select('*')
        .eq('user_id', user.id);
        
      if (pullEpError) throw pullEpError;
      
      if (remoteEpisodes && remoteEpisodes.length > 0) {
        for (const remote of remoteEpisodes) {
          const remoteTime = new Date(remote.updated_at).getTime();
          
          const localItem = await db.getFirstAsync<{ updated_at: number }>(
            'SELECT updated_at FROM sync_episodes_queue WHERE tmdb_id = $tmdb_id AND season_number = $season_number AND episode_number = $episode_number',
            { 
              $tmdb_id: Number(remote.tmdb_id), 
              $season_number: Number(remote.season_number), 
              $episode_number: Number(remote.episode_number) 
            }
          );

          if (!localItem || localItem.updated_at < remoteTime) {
            await db.runAsync(
              `INSERT OR REPLACE INTO sync_episodes_queue (tmdb_id, season_number, episode_number, watched, updated_at, sync_pending) 
               VALUES ($tmdb_id, $season_number, $episode_number, $watched, $updated_at, 0)`,
              { 
                $tmdb_id: Number(remote.tmdb_id), 
                $season_number: Number(remote.season_number), 
                $episode_number: Number(remote.episode_number), 
                $watched: remote.watched ? 1 : 0, 
                $updated_at: Number(remoteTime) 
              }
            );
          }
        }
      }

      // 3. Fetch missing metadata from TMDb
      const missingCacheItems = await db.getAllAsync<{ tmdb_id: number; media_type: MediaType }>(
        `SELECT q.tmdb_id, q.media_type 
         FROM sync_queue q 
         LEFT JOIN media_cache c ON q.tmdb_id = c.tmdb_id AND q.media_type = c.media_type 
         WHERE (c.tmdb_id IS NULL OR c.release_date IS NULL OR c.is_anime IS NULL OR (q.media_type = 'tv' AND c.episode_count IS NULL)) AND 1 = $pending`,
        { $pending: 1 }
      );

      // Batch TMDb requests to respect rate limits
      const BATCH_SIZE = 10;
      for (let i = 0; i < missingCacheItems.length; i += BATCH_SIZE) {
        const batch = missingCacheItems.slice(i, i + BATCH_SIZE);
        
        const fetchedResults = await Promise.all(
          batch.map(async (item) => {
            try {
              const details = await getMediaDetails(item.media_type, item.tmdb_id);
              return { item, details };
            } catch (err) {
              console.error(`Failed to fetch TMDb data for ${item.media_type} ${item.tmdb_id}:`, err);
              return null;
            }
          })
        );

        for (const entry of fetchedResults) {
          if (!entry) continue;
          const { item, details } = entry;
          const title = details.title || details.name || '';
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
              String(title),
              details.overview ? String(details.overview) : null,
              details.poster_path ? String(details.poster_path) : null,
              isAnime ? 1 : 0,
              releaseDate,
              voteAverage,
              seasonCount,
              trailerKey,
              episodeCount,
              airStatus,
              nextAirDate,
              nextEpisodeInfo,
              Number(Date.now())
            ]
          );
        }
        
        // Slight delay to prevent rate limit spikes if multiple batches
        if (i + BATCH_SIZE < missingCacheItems.length) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }

    } catch (error) {
      console.error('Sync failed:', error);
      throw error;
    }
  }
};
