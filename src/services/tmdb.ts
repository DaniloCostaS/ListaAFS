const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
// Use environment variables (e.g., process.env.EXPO_PUBLIC_TMDB_API_KEY) in a real app
const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY || 'YOUR_TMDB_API_KEY'; 

export interface TMDBMultiSearchResult {
  id: number;
  media_type: 'movie' | 'tv';
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
}

export interface TMDBMediaDetail {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  seasons?: {
    id: number;
    name: string;
    season_number: number;
    episode_count: number;
  }[];
}

const fetchFromTMDB = async (endpoint: string, params: Record<string, string> = {}) => {
  const queryParams = new URLSearchParams({
    api_key: TMDB_API_KEY,
    language: 'pt-BR',
    ...params,
  });

  const response = await fetch(`${TMDB_BASE_URL}${endpoint}?${queryParams.toString()}`);
  
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Rate limit exceeded');
    }
    throw new Error(`TMDb API Error: ${response.status}`);
  }

  return response.json();
};

export const searchMulti = async (query: string, page: number = 1): Promise<TMDBMultiSearchResult[]> => {
  if (!query) return [];
  const data = await fetchFromTMDB('/search/multi', { query, page: String(page) });
  // Filter out people, we only want movie and tv
  return data.results.filter((item: TMDBMultiSearchResult) => item.media_type === 'movie' || item.media_type === 'tv');
};

export const getMediaDetails = async (mediaType: 'movie' | 'tv', id: number): Promise<TMDBMediaDetail> => {
  const data = await fetchFromTMDB(`/${mediaType}/${id}`);
  return data;
};

export const getSeasonDetails = async (tvId: number, seasonNumber: number) => {
  return fetchFromTMDB(`/tv/${tvId}/season/${seasonNumber}`);
};
