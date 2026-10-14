export const SQLITE_SCHEMA = `
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS sync_queue (
    tmdb_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    status TEXT NOT NULL CHECK (status IN ('watching', 'completed', 'plan_to_watch')),
    updated_at INTEGER NOT NULL, -- Storing as Unix timestamp for SQLite ease
    sync_pending INTEGER NOT NULL DEFAULT 0, -- 0 for false, 1 for true
    user_rating REAL,
    user_notes TEXT,
    PRIMARY KEY (tmdb_id, media_type)
  );

  CREATE TABLE IF NOT EXISTS media_cache (
    tmdb_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK (media_type IN ('movie', 'tv')),
    title TEXT,
    overview TEXT,
    poster_path TEXT,
    last_fetched_at INTEGER NOT NULL,
    is_anime INTEGER DEFAULT 0,
    release_date TEXT,
    vote_average REAL,
    season_count INTEGER DEFAULT 0,
    trailer_key TEXT,
    episode_count INTEGER DEFAULT 0,
    air_status TEXT,
    next_air_date TEXT,
    next_episode_info TEXT,
    PRIMARY KEY (tmdb_id, media_type)
  );

  CREATE TABLE IF NOT EXISTS sync_episodes_queue (
    tmdb_id INTEGER NOT NULL,
    season_number INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    watched INTEGER NOT NULL DEFAULT 0, -- 0 for false, 1 for true
    updated_at INTEGER NOT NULL,
    sync_pending INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tmdb_id, season_number, episode_number)
  );
`;

export type MediaType = 'movie' | 'tv';
export type MediaStatus = 'watching' | 'completed' | 'plan_to_watch';
export type MediaCategory = 'all' | 'movie' | 'tv' | 'anime';

export interface SyncQueueItem {
  tmdb_id: number;
  media_type: MediaType;
  status: MediaStatus;
  updated_at: number;
  sync_pending: boolean;
  user_rating?: number | null;
  user_notes?: string | null;
}

export interface MediaCacheItem {
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  overview: string | null;
  poster_path: string | null;
  last_fetched_at: number;
  is_anime?: number | null;
  release_date?: string | null;
  vote_average?: number | null;
  season_count?: number | null;
  trailer_key?: string | null;
  episode_count?: number | null;
  air_status?: string | null;
  next_air_date?: string | null;
  next_episode_info?: string | null;
}

export interface SyncEpisodeItem {
  tmdb_id: number;
  season_number: number;
  episode_number: number;
  watched: boolean | number;
  updated_at: number;
  sync_pending: boolean | number;
}
