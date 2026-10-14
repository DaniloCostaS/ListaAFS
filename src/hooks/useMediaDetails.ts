import { useState, useCallback } from 'react';
import { getDb } from '../database/useDatabase';
import { SyncEpisodeItem } from '../database/schema';
import { useSyncStore } from '../store/useSyncStore';

export const useMediaDetails = (tmdb_id: number) => {
  const [episodes, setEpisodes] = useState<SyncEpisodeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const { runSync } = useSyncStore();

  const loadEpisodes = useCallback(async () => {
    if (!tmdb_id || isNaN(tmdb_id)) return;
    
    setLoading(true);
    try {
      const db = await getDb();
      const result = await db.getAllAsync<SyncEpisodeItem>(
        'SELECT * FROM sync_episodes_queue WHERE tmdb_id = ?',
        [Number(tmdb_id)]
      );
      setEpisodes(result);
    } catch (e) {
      console.error('Error loading episodes:', e);
    } finally {
      setLoading(false);
    }
  }, [tmdb_id]);

  const toggleEpisode = async (season_number: number, episode_number: number, watched: boolean) => {
    if (!tmdb_id || isNaN(tmdb_id) || season_number == null || episode_number == null) {
      console.warn('Invalid episode data:', { tmdb_id, season_number, episode_number });
      return;
    }

    try {
      const db = await getDb();
      const now = Date.now();
      const watchedInt = watched ? 1 : 0;
      
      await db.runAsync(
        `INSERT OR REPLACE INTO sync_episodes_queue (tmdb_id, season_number, episode_number, watched, updated_at, sync_pending) 
         VALUES (?, ?, ?, ?, ?, 1)`,
        [
          Number(tmdb_id),
          Number(season_number),
          Number(episode_number),
          watchedInt,
          now
        ]
      );
      
      await loadEpisodes();
      runSync();
    } catch (e) {
      console.error('Error toggling episode:', e);
    }
  };

  return {
    episodes,
    loading,
    loadEpisodes,
    toggleEpisode,
  };
};
