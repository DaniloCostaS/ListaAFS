import { useEffect, useState } from 'react';
import * as SQLite from 'expo-sqlite';
import { SQLITE_SCHEMA } from './schema';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// Helper to get db instance (singleton to avoid GC issues and race conditions)
export const getDb = async (): Promise<SQLite.SQLiteDatabase> => {
  if (dbInstance) {
    return dbInstance;
  }

  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync('lista_afs.db');
        await db.execAsync(SQLITE_SCHEMA);

        // Safe column migrations for existing databases
        const migrations = [
          'ALTER TABLE media_cache ADD COLUMN is_anime INTEGER DEFAULT 0;',
          'ALTER TABLE media_cache ADD COLUMN release_date TEXT;',
          'ALTER TABLE media_cache ADD COLUMN vote_average REAL;',
          'ALTER TABLE media_cache ADD COLUMN season_count INTEGER DEFAULT 0;',
          'ALTER TABLE media_cache ADD COLUMN trailer_key TEXT;',
          'ALTER TABLE media_cache ADD COLUMN episode_count INTEGER DEFAULT 0;',
          'ALTER TABLE media_cache ADD COLUMN air_status TEXT;',
          'ALTER TABLE media_cache ADD COLUMN next_air_date TEXT;',
          'ALTER TABLE media_cache ADD COLUMN next_episode_info TEXT;'
        ];
        for (const sql of migrations) {
          try {
            await db.execAsync(sql);
          } catch {
            // Column already exists, safe to ignore
          }
        }

        dbInstance = db;
        return db;
      } catch (err) {
        dbPromise = null;
        throw err;
      }
    })();
  }

  return dbPromise;
};

export const useDatabase = () => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    getDb()
      .then(() => {
        if (isMounted) setIsReady(true);
      })
      .catch((e) => {
        console.error('Failed to initialize database:', e);
        if (isMounted) setError(e instanceof Error ? e : new Error(String(e)));
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return { isReady, error };
};
