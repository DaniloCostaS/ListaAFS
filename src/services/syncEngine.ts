import { getDb } from '../database/useDatabase';
import { supabase } from './supabase';
import { getMediaDetails } from './tmdb';
import { MediaType, MediaStatus } from '../database/schema';

export const syncEngine = {
  async sync() {
    try {
      const db = await getDb();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new Error('User not authenticated for sync');
      }

      // 1. Push local changes to Supabase (Upsert)
      const pendingItems = await db.getAllAsync<{ tmdb_id: number; media_type: MediaType; status: MediaStatus; updated_at: number; sync_pending: number }>(
        'SELECT * FROM sync_queue WHERE sync_pending = $pending',
        { $pending: 1 }
      );

      if (pendingItems.length > 0) {
        const payload = pendingItems.map(item => ({
          user_id: user.id,
          tmdb_id: item.tmdb_id,
          media_type: item.media_type,
          status: item.status,
          updated_at: new Date(item.updated_at).toISOString(),
        }));

        const { error: upsertError } = await supabase
          .from('user_media')
          .upsert(payload, { onConflict: 'user_id, tmdb_id, media_type' });

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
      // Conflict resolution: latest updated_at wins
      const { data: remoteData, error: pullError } = await supabase
        .from('user_media')
        .select('*')
        .eq('user_id', user.id);

      if (pullError) throw pullError;

      if (remoteData && remoteData.length > 0) {
        for (const remote of remoteData) {
          const remoteTime = new Date(remote.updated_at).getTime();
          
          const localItem = await db.getFirstAsync<{ updated_at: number }>(
            'SELECT updated_at FROM sync_queue WHERE tmdb_id = $tmdb_id AND media_type = $media_type',
            { $tmdb_id: Number(remote.tmdb_id), $media_type: String(remote.media_type) }
          );

          if (!localItem || localItem.updated_at < remoteTime) {
            await db.runAsync(
              `INSERT OR REPLACE INTO sync_queue (tmdb_id, media_type, status, updated_at, sync_pending) 
               VALUES ($tmdb_id, $media_type, $status, $updated_at, 0)`,
              { 
                $tmdb_id: Number(remote.tmdb_id), 
                $media_type: String(remote.media_type), 
                $status: String(remote.status), 
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
         WHERE c.tmdb_id IS NULL AND 1 = $pending`,
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
          
          await db.runAsync(
            `INSERT OR REPLACE INTO media_cache (tmdb_id, media_type, title, overview, poster_path, last_fetched_at) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              Number(item.tmdb_id),
              String(item.media_type),
              String(title),
              details.overview ? String(details.overview) : null,
              details.poster_path ? String(details.poster_path) : null,
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
