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
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  genre_ids?: number[];
  original_language?: string;
  origin_country?: string[];
}

export interface TMDBMediaDetail {
  id: number;
  title?: string;
  name?: string;
  overview: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  runtime?: number;
  number_of_seasons?: number;
  number_of_episodes?: number;
  original_language?: string;
  origin_country?: string[];
  production_countries?: { iso_3166_1: string; name: string }[];
  genres?: {
    id: number;
    name: string;
  }[];
  seasons?: {
    id: number;
    name: string;
    season_number: number;
    episode_count: number;
    poster_path?: string | null;
  }[];
  status?: string;
  next_episode_to_air?: {
    id: number;
    name?: string;
    air_date?: string;
    episode_number?: number;
    season_number?: number;
  } | null;
  last_episode_to_air?: {
    id: number;
    name?: string;
    air_date?: string;
    episode_number?: number;
    season_number?: number;
  } | null;
  videos?: {
    results: {
      id: string;
      key: string;
      name: string;
      site: string;
      type: string;
      official?: boolean;
    }[];
  };
}

export const checkIfAnime = (item: {
  media_type?: string;
  original_language?: string;
  origin_country?: string[];
  production_countries?: { iso_3166_1: string }[];
  genre_ids?: number[];
  genres?: { id: number; name?: string }[];
}): boolean => {
  const isJapaneseLang = item.original_language === 'ja';
  const isJapanCountry = 
    Boolean(item.origin_country && item.origin_country.includes('JP')) ||
    Boolean(item.production_countries && item.production_countries.some(c => c.iso_3166_1 === 'JP'));
  
  const hasAnimationGenre = 
    Boolean(item.genre_ids && item.genre_ids.includes(16)) ||
    Boolean(item.genres && item.genres.some(g => g.id === 16 || g.name?.toLowerCase().includes('anima')));

  return hasAnimationGenre && (isJapaneseLang || isJapanCountry);
};

export const findBestTrailer = (videos: any[] = []): string | null => {
  if (!videos || videos.length === 0) return null;
  const youtubeVideos = videos.filter((v: any) => v.site === 'YouTube');
  if (youtubeVideos.length === 0) return null;

  const officialTrailer = youtubeVideos.find((v: any) => v.type === 'Trailer' && v.official);
  if (officialTrailer) return officialTrailer.key;

  const anyTrailer = youtubeVideos.find((v: any) => v.type === 'Trailer');
  if (anyTrailer) return anyTrailer.key;

  const teaser = youtubeVideos.find((v: any) => v.type === 'Teaser');
  if (teaser) return teaser.key;

  return youtubeVideos[0]?.key || null;
};

export const formatAirDate = (dateStr?: string | null): string => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `${day}/${month}/${year}`;
  }
  return dateStr;
};

export interface MediaAirStatusInfo {
  type: 'ended' | 'scheduled' | 'ongoing_no_date' | 'movie';
  label: string;
  badgeStyle: 'ended' | 'scheduled' | 'ongoing' | 'movie';
  icon: string;
}

export const getMediaAirStatusInfo = (item: {
  media_type: string;
  is_anime?: boolean | number | null;
  air_status?: string | null;
  next_air_date?: string | null;
  next_episode_info?: string | null;
  release_date?: string | null;
}): MediaAirStatusInfo | null => {
  if (item.media_type === 'movie') {
    if (!item.release_date) return null;
    const isFuture = new Date(item.release_date).getTime() > Date.now();
    if (isFuture) {
      return {
        type: 'movie',
        label: `Estreia em ${formatAirDate(item.release_date)}`,
        badgeStyle: 'scheduled',
        icon: '🗓️',
      };
    }
    return null;
  }

  // TV / Anime
  const isAnime = Boolean(item.is_anime);
  const statusLower = (item.air_status || '').toLowerCase();

  if (statusLower === 'ended') {
    return {
      type: 'ended',
      label: isAnime ? 'Finalizado • Todos os eps lançados' : 'Finalizada • Todos os eps lançados',
      badgeStyle: 'ended',
      icon: '🏁',
    };
  }

  if (statusLower === 'canceled') {
    return {
      type: 'ended',
      label: 'Cancelada • Todos os eps lançados',
      badgeStyle: 'ended',
      icon: '⛔',
    };
  }

  if (item.next_air_date) {
    const formattedDate = formatAirDate(item.next_air_date);
    const epSuffix = item.next_episode_info ? ` (${item.next_episode_info})` : '';
    return {
      type: 'scheduled',
      label: `Próximo ep: ${formattedDate}${epSuffix}`,
      badgeStyle: 'scheduled',
      icon: '🗓️',
    };
  }

  // Ongoing or returning, but no upcoming episode date scheduled
  return {
    type: 'ongoing_no_date',
    label: 'Em exibição • Sem data para novo ep.',
    badgeStyle: 'ongoing',
    icon: '⏳',
  };
};

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

export const getMediaVideos = async (mediaType: 'movie' | 'tv', id: number) => {
  try {
    const dataPt = await fetchFromTMDB(`/${mediaType}/${id}/videos`);
    const ptVideos = (dataPt.results || []).filter((v: any) => v.site === 'YouTube');
    if (ptVideos.length > 0) return ptVideos;

    // Fallback to en-US if no PT videos
    const dataEn = await fetchFromTMDB(`/${mediaType}/${id}/videos`, { language: 'en-US' });
    return (dataEn.results || []).filter((v: any) => v.site === 'YouTube');
  } catch (err) {
    console.error(`Error fetching videos for ${mediaType} ${id}:`, err);
    return [];
  }
};

export const searchMulti = async (query: string, page: number = 1): Promise<TMDBMultiSearchResult[]> => {
  if (!query) return [];
  const data = await fetchFromTMDB('/search/multi', { query, page: String(page) });
  // Filter out people, we only want movie and tv
  return data.results.filter((item: TMDBMultiSearchResult) => item.media_type === 'movie' || item.media_type === 'tv');
};

export const getMediaDetails = async (mediaType: 'movie' | 'tv', id: number): Promise<TMDBMediaDetail> => {
  const data = await fetchFromTMDB(`/${mediaType}/${id}`, { append_to_response: 'videos' });
  if (!data.videos?.results || data.videos.results.length === 0) {
    try {
      const enVideos = await getMediaVideos(mediaType, id);
      data.videos = { results: enVideos };
    } catch {
      // Ignore fallback error
    }
  }
  return data;
};

export const getSeasonDetails = async (tvId: number, seasonNumber: number) => {
  return fetchFromTMDB(`/tv/${tvId}/season/${seasonNumber}`);
};

export interface GenreOption {
  id: string;
  name: string;
  movieGenreId: number;
  tvGenreId: number;
  icon: string;
}

export const COMMON_GENRES: GenreOption[] = [
  { id: 'all', name: 'Todos os Gêneros', movieGenreId: 0, tvGenreId: 0, icon: '🌟' },
  { id: 'action', name: 'Ação & Aventura', movieGenreId: 28, tvGenreId: 10759, icon: '💥' },
  { id: 'animation', name: 'Animação', movieGenreId: 16, tvGenreId: 16, icon: '🎨' },
  { id: 'comedy', name: 'Comédia', movieGenreId: 35, tvGenreId: 35, icon: '😂' },
  { id: 'drama', name: 'Drama', movieGenreId: 18, tvGenreId: 18, icon: '🎭' },
  { id: 'scifi', name: 'Ficção & Fantasia', movieGenreId: 878, tvGenreId: 10765, icon: '🚀' },
  { id: 'horror', name: 'Terror & Suspense', movieGenreId: 27, tvGenreId: 9648, icon: '😱' },
  { id: 'romance', name: 'Romance', movieGenreId: 10749, tvGenreId: 10766, icon: '❤️' },
  { id: 'crime', name: 'Crime & Mistério', movieGenreId: 80, tvGenreId: 80, icon: '🕵️' },
  { id: 'family', name: 'Família', movieGenreId: 10751, tvGenreId: 10751, icon: '👨‍👩‍👧‍👦' },
  { id: 'documentary', name: 'Documentário', movieGenreId: 99, tvGenreId: 99, icon: '📜' },
];

export const RATING_OPTIONS = [
  { label: 'Qualquer nota', value: null },
  { label: '⭐ 6.0+', value: 6.0 },
  { label: '⭐ 7.0+', value: 7.0 },
  { label: '⭐ 7.5+', value: 7.5 },
  { label: '⭐ 8.0+', value: 8.0 },
  { label: '⭐ 8.5+', value: 8.5 },
];

export const YEAR_OPTIONS = [
  { label: 'Qualquer época', value: 'all' },
  { label: 'Recentes (2024+)', value: 'recent' },
  { label: 'Anos 2020', value: '2020s' },
  { label: 'Anos 2010', value: '2010s' },
  { label: 'Anos 2000', value: '2000s' },
  { label: 'Anos 90', value: '1990s' },
  { label: 'Clássicos (Antes de 1990)', value: 'classics' },
];

export const SORT_OPTIONS = [
  { label: '🔥 Mais Populares', value: 'popularity.desc' as const },
  { label: '⭐ Mais Bem Avaliados', value: 'vote_average.desc' as const },
  { label: '📅 Mais Recentes', value: 'release_date.desc' as const },
];

export const discoverMedia = async (filters: {
  category?: 'all' | 'movie' | 'tv' | 'anime';
  genreId?: string;
  minRating?: number | null;
  year?: string;
  sortBy?: 'popularity.desc' | 'vote_average.desc' | 'release_date.desc';
  page?: number;
}): Promise<TMDBMultiSearchResult[]> => {
  const { 
    category = 'all', 
    genreId, 
    minRating, 
    year, 
    sortBy = 'popularity.desc', 
    page = 1 
  } = filters;

  const selectedGenre = COMMON_GENRES.find(g => g.id === genreId);

  const getYearParams = (mediaType: 'movie' | 'tv') => {
    const prefix = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
    if (!year || year === 'all') return {};
    if (year === 'recent') return { [`${prefix}.gte`]: '2024-01-01' };
    if (year === '2020s') return { [`${prefix}.gte`]: '2020-01-01', [`${prefix}.lte`]: '2029-12-31' };
    if (year === '2010s') return { [`${prefix}.gte`]: '2010-01-01', [`${prefix}.lte`]: '2019-12-31' };
    if (year === '2000s') return { [`${prefix}.gte`]: '2000-01-01', [`${prefix}.lte`]: '2009-12-31' };
    if (year === '1990s') return { [`${prefix}.gte`]: '1990-01-01', [`${prefix}.lte`]: '1999-12-31' };
    if (year === 'classics') return { [`${prefix}.lte`]: '1989-12-31' };
    return {};
  };

  const getSortParam = (mediaType: 'movie' | 'tv') => {
    if (sortBy === 'release_date.desc') {
      return mediaType === 'movie' ? 'primary_release_date.desc' : 'first_air_date.desc';
    }
    return sortBy;
  };

  if (category === 'anime') {
    const params: Record<string, string> = {
      page: String(page),
      sort_by: getSortParam('tv'),
      with_original_language: 'ja',
      'vote_count.gte': minRating ? '30' : '15',
      ...getYearParams('tv'),
    };
    if (minRating) {
      params['vote_average.gte'] = String(minRating);
    }
    if (selectedGenre && selectedGenre.id !== 'all' && selectedGenre.id !== 'animation') {
      params.with_genres = `16,${selectedGenre.tvGenreId}`;
    } else {
      params.with_genres = '16';
    }
    const data = await fetchFromTMDB('/discover/tv', params);
    return (data.results || []).map((x: any) => ({ ...x, media_type: 'tv' as const }));
  }

  if (category === 'movie') {
    const params: Record<string, string> = {
      page: String(page),
      sort_by: getSortParam('movie'),
      'vote_count.gte': minRating ? '50' : '15',
      ...getYearParams('movie'),
    };
    if (minRating) {
      params['vote_average.gte'] = String(minRating);
    }
    if (selectedGenre && selectedGenre.id !== 'all') {
      params.with_genres = String(selectedGenre.movieGenreId);
    }
    const data = await fetchFromTMDB('/discover/movie', params);
    return (data.results || []).map((x: any) => ({ ...x, media_type: 'movie' as const }));
  }

  if (category === 'tv') {
    const params: Record<string, string> = {
      page: String(page),
      sort_by: getSortParam('tv'),
      'vote_count.gte': minRating ? '50' : '15',
      ...getYearParams('tv'),
    };
    if (minRating) {
      params['vote_average.gte'] = String(minRating);
    }
    if (selectedGenre && selectedGenre.id !== 'all') {
      params.with_genres = String(selectedGenre.tvGenreId);
    }
    const data = await fetchFromTMDB('/discover/tv', params);
    return (data.results || []).map((x: any) => ({ ...x, media_type: 'tv' as const }));
  }

  // category === 'all'
  const [movieData, tvData] = await Promise.all([
    fetchFromTMDB('/discover/movie', {
      page: String(page),
      sort_by: getSortParam('movie'),
      'vote_count.gte': minRating ? '50' : '15',
      ...(minRating ? { 'vote_average.gte': String(minRating) } : {}),
      ...(selectedGenre && selectedGenre.id !== 'all' ? { with_genres: String(selectedGenre.movieGenreId) } : {}),
      ...getYearParams('movie'),
    }).catch(() => ({ results: [] })),
    fetchFromTMDB('/discover/tv', {
      page: String(page),
      sort_by: getSortParam('tv'),
      'vote_count.gte': minRating ? '50' : '15',
      ...(minRating ? { 'vote_average.gte': String(minRating) } : {}),
      ...(selectedGenre && selectedGenre.id !== 'all' ? { with_genres: String(selectedGenre.tvGenreId) } : {}),
      ...getYearParams('tv'),
    }).catch(() => ({ results: [] })),
  ]);

  const movies = (movieData.results || []).map((x: any) => ({ ...x, media_type: 'movie' as const }));
  const tvs = (tvData.results || []).map((x: any) => ({ ...x, media_type: 'tv' as const }));
  const combined = [...movies, ...tvs];

  if (sortBy === 'vote_average.desc') {
    combined.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
  } else if (sortBy === 'release_date.desc') {
    combined.sort((a, b) => {
      const dateA = a.release_date || a.first_air_date || '';
      const dateB = b.release_date || b.first_air_date || '';
      return dateB.localeCompare(dateA);
    });
  } else {
    combined.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
  }

  return combined;
};
