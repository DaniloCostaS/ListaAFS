import { useState, useCallback } from 'react';
import { getDb } from '../database/useDatabase';
import { MediaType, MediaStatus } from '../database/schema';
import { useSyncStore } from '../store/useSyncStore';

export interface MediaListItem {
  tmdb_id: number;
  media_type: MediaType;
  status: MediaStatus;
  updated_at: number;
  sync_pending: number; // 0 or 1 in SQLite
  title: string | null;
  overview: string | null;
  poster_path: string | null;
}

export const useMediaList = () => {
  const [data, setData] = useState<MediaListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const { runSync } = useSyncStore();

  const loadMedia = useCallback(async (filterStatus?: MediaStatus) => {
    setLoading(true);
    try {
      const db = await getDb();
      let query = `
        SELECT q.*, c.title, c.overview, c.poster_path 
        FROM sync_queue q
        LEFT JOIN media_cache c ON q.tmdb_id = c.tmdb_id AND q.media_type = c.media_type
        WHERE 1 = $dummy
      `;
      const params: Record<string, any> = { $dummy: 1 };
      
      if (filterStatus) {
        query += ` AND q.status = $status`;
        params.$status = String(filterStatus);
      }
      
      query += ` ORDER BY q.updated_at DESC`;

      const result = await db.getAllAsync<MediaListItem>(query, params);

      setData(result);
    } catch (e) {
      console.error('Error loading media:', e);
      setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

  const addOrUpdateMedia = async (tmdb_id: number, media_type: MediaType, status: MediaStatus) => {
    if (!tmdb_id || !media_type || !status) {
      console.warn('Invalid data passed to addOrUpdateMedia:', { tmdb_id, media_type, status });
      return;
    }
    
    try {
      const db = await getDb();
      const now = Date.now();
      
      await db.runAsync(
        `INSERT OR REPLACE INTO sync_queue (tmdb_id, media_type, status, updated_at, sync_pending) 
         VALUES ($tmdb_id, $media_type, $status, $updated_at, 1)`,
        {
          $tmdb_id: Number(tmdb_id),
          $media_type: String(media_type),
          $status: String(status),
          $updated_at: Number(now)
        }
      );
      
      // Refresh local list
      await loadMedia();
      
      // Attempt background sync
      runSync();
    } catch (e) {
      console.error('Error saving media:', e);
      throw e;
    }
  };

  return {
    data,
    loading,
    error,
    loadMedia,
    addOrUpdateMedia,
  };
};
