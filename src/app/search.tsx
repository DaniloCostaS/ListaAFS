import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Linking,
  ScrollView
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  searchMulti,
  getMediaDetails,
  checkIfAnime,
  findBestTrailer,
  discoverMedia,
  COMMON_GENRES,
  RATING_OPTIONS,
  YEAR_OPTIONS,
  SORT_OPTIONS,
  TMDBMultiSearchResult,
  TMDBMediaDetail,
  getMediaAirStatusInfo
} from '../services/tmdb';
import { useMediaList } from '../hooks/useMediaList';
import { getDb } from '../database/useDatabase';
import { MediaCategory } from '../database/schema';

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TMDBMultiSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [detailsCache, setDetailsCache] = useState<Record<string, TMDBMediaDetail>>({});
  const [loadingDetailsKey, setLoadingDetailsKey] = useState<string | null>(null);
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());

  // Filter States
  const [selectedCategory, setSelectedCategory] = useState<MediaCategory>('all');
  const [selectedGenreId, setSelectedGenreId] = useState<string>('all');
  const [selectedMinRating, setSelectedMinRating] = useState<number | null>(null);
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [selectedSortBy, setSelectedSortBy] = useState<'popularity.desc' | 'vote_average.desc' | 'release_date.desc'>('popularity.desc');
  const [showFilters, setShowFilters] = useState<boolean>(false);

  const router = useRouter();
  const { addOrUpdateMedia } = useMediaList();

  useEffect(() => {
    let isMounted = true;
    getDb()
      .then((db) => db.getAllAsync<{ tmdb_id: number; media_type: string }>('SELECT tmdb_id, media_type FROM sync_queue'))
      .then((rows) => {
        if (isMounted) {
          setExistingIds(new Set(rows.map(r => `${r.media_type}-${r.tmdb_id}`)));
        }
      })
      .catch((e) => console.error('Error loading existing IDs:', e));

    return () => {
      isMounted = false;
    };
  }, []);

  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (selectedCategory !== 'all') count++;
    if (selectedGenreId !== 'all') count++;
    if (selectedMinRating !== null) count++;
    if (selectedYear !== 'all') count++;
    if (selectedSortBy !== 'popularity.desc') count++;
    return count;
  }, [selectedCategory, selectedGenreId, selectedMinRating, selectedYear, selectedSortBy]);

  const handleResetFilters = () => {
    setSelectedCategory('all');
    setSelectedGenreId('all');
    setSelectedMinRating(null);
    setSelectedYear('all');
    setSelectedSortBy('popularity.desc');
  };

  const fetchResults = useCallback(async () => {
    setLoading(true);
    setExpandedKey(null);
    try {
      if (query.trim()) {
        const rawResults = await searchMulti(query.trim());
        let filtered = [...rawResults];

        // 1. Category Filter
        if (selectedCategory === 'anime') {
          filtered = filtered.filter(item => checkIfAnime(item));
        } else if (selectedCategory === 'movie') {
          filtered = filtered.filter(item => item.media_type === 'movie' && !checkIfAnime(item));
        } else if (selectedCategory === 'tv') {
          filtered = filtered.filter(item => item.media_type === 'tv' && !checkIfAnime(item));
        }

        // 2. Genre Filter
        if (selectedGenreId !== 'all') {
          const gObj = COMMON_GENRES.find(g => g.id === selectedGenreId);
          if (gObj) {
            filtered = filtered.filter(item =>
              Boolean(item.genre_ids && (item.genre_ids.includes(gObj.movieGenreId) || item.genre_ids.includes(gObj.tvGenreId)))
            );
          }
        }

        // 3. Min Rating Filter
        if (selectedMinRating !== null) {
          filtered = filtered.filter(item => (item.vote_average || 0) >= selectedMinRating);
        }

        // 4. Year Filter
        if (selectedYear !== 'all') {
          filtered = filtered.filter(item => {
            const dateStr = item.release_date || item.first_air_date;
            if (!dateStr) return false;
            const y = parseInt(dateStr.substring(0, 4), 10);
            if (selectedYear === 'recent') return y >= 2024;
            if (selectedYear === '2020s') return y >= 2020 && y <= 2029;
            if (selectedYear === '2010s') return y >= 2010 && y <= 2019;
            if (selectedYear === '2000s') return y >= 2000 && y <= 2009;
            if (selectedYear === '1990s') return y >= 1990 && y <= 1999;
            if (selectedYear === 'classics') return y < 1990;
            return true;
          });
        }

        // 5. Sort
        if (selectedSortBy === 'vote_average.desc') {
          filtered.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
        } else if (selectedSortBy === 'release_date.desc') {
          filtered.sort((a, b) => {
            const dateA = a.release_date || a.first_air_date || '';
            const dateB = b.release_date || b.first_air_date || '';
            return dateB.localeCompare(dateA);
          });
        }

        setResults(filtered);
      } else {
        // Discovery mode (curated TMDB search)
        const discovered = await discoverMedia({
          category: selectedCategory,
          genreId: selectedGenreId,
          minRating: selectedMinRating,
          year: selectedYear,
          sortBy: selectedSortBy,
        });
        setResults(discovered);
      }
    } catch (err) {
      console.error('Error fetching search/discover results:', err);
    } finally {
      setLoading(false);
    }
  }, [query, selectedCategory, selectedGenreId, selectedMinRating, selectedYear, selectedSortBy]);

  // Run search or discovery whenever filters change or on initial mount
  useEffect(() => {
    let isCancelled = false;
    Promise.resolve().then(() => {
      if (!isCancelled) {
        fetchResults();
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [fetchResults]);

  const toggleExpand = async (item: TMDBMultiSearchResult) => {
    const key = `${item.media_type}-${item.id}`;
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }

    setExpandedKey(key);

    if (!detailsCache[key]) {
      setLoadingDetailsKey(key);
      try {
        const detail = await getMediaDetails(item.media_type, item.id);
        setDetailsCache(prev => ({ ...prev, [key]: detail }));
      } catch (err) {
        console.error('Failed to load media details for expansion:', err);
      } finally {
        setLoadingDetailsKey(null);
      }
    }
  };

  const handleAdd = async (item: TMDBMultiSearchResult) => {
    const key = `${item.media_type}-${item.id}`;
    let detail = detailsCache[key];

    setAddingKey(key);
    try {
      // Ensure full details are fetched so anime detection, trailer and seasons are 100% accurate
      if (!detail) {
        try {
          detail = await getMediaDetails(item.media_type, item.id);
          setDetailsCache(prev => ({ ...prev, [key]: detail }));
        } catch (e) {
          console.warn('Could not fetch full details, falling back to item:', e);
        }
      }

      const isAnime = checkIfAnime(detail || item);
      const trailerKey = detail ? findBestTrailer(detail.videos?.results || []) : null;
      const seasonCount = detail?.number_of_seasons || detail?.seasons?.filter(s => s.season_number > 0).length || 0;
      const episodeCount = detail?.number_of_episodes || detail?.seasons?.reduce((acc, s) => s.season_number > 0 ? acc + (s.episode_count || 0) : acc, 0) || 0;
      const releaseDate = detail?.release_date || detail?.first_air_date || item.release_date || item.first_air_date || null;
      const voteAverage = detail?.vote_average ?? item.vote_average ?? null;
      const airStatus = detail?.status || null;
      const nextAirDate = detail?.next_episode_to_air?.air_date || null;
      const nextEpisodeInfo = detail?.next_episode_to_air
        ? `T${detail.next_episode_to_air.season_number} E${detail.next_episode_to_air.episode_number}`
        : null;

      await addOrUpdateMedia(item.id, item.media_type, 'plan_to_watch', {
        title: item.title || item.name || detail?.title || detail?.name || null,
        overview: detail?.overview || item.overview || null,
        poster_path: item.poster_path || detail?.poster_path || null,
        is_anime: isAnime,
        release_date: releaseDate,
        vote_average: voteAverage,
        season_count: seasonCount,
        trailer_key: trailerKey,
        episode_count: episodeCount,
        air_status: airStatus,
        next_air_date: nextAirDate,
        next_episode_info: nextEpisodeInfo,
      });

      // Update local set of existing IDs
      setExistingIds(prev => new Set(prev).add(key));

      // Return immediately so the user sees the synchronized list with the new addition
      router.back();
    } catch (err) {
      console.error('Error adding media:', err);
    } finally {
      setAddingKey(null);
    }
  };

  const handleOpenTrailer = (trailerKey: string) => {
    const url = `https://www.youtube.com/watch?v=${trailerKey}`;
    Linking.canOpenURL(url)
      .then((supported) => {
        if (supported) {
          Linking.openURL(url);
        } else {
          Linking.openURL(`https://m.youtube.com/watch?v=${trailerKey}`);
        }
      })
      .catch((err) => console.error('Failed to open trailer:', err));
  };

  const feedTitle = useMemo(() => {
    if (query.trim()) {
      return `Resultados para "${query.trim()}"`;
    }
    const catLabels: Record<string, string> = {
      all: 'Destaques Populares',
      movie: 'Filmes em Alta',
      tv: 'Séries em Alta',
      anime: 'Animes em Alta',
    };
    const genreObj = COMMON_GENRES.find(g => g.id === selectedGenreId);
    let title = catLabels[selectedCategory] || 'Explorar';
    if (genreObj && genreObj.id !== 'all') {
      title += ` • ${genreObj.name}`;
    }
    if (selectedMinRating) {
      title += ` (⭐ ${selectedMinRating}+)`;
    }
    return title;
  }, [query, selectedCategory, selectedGenreId, selectedMinRating]);

  const renderItem = ({ item }: { item: TMDBMultiSearchResult }) => {
    const key = `${item.media_type}-${item.id}`;
    const isExpanded = expandedKey === key;
    const detail = detailsCache[key];
    const isLoadingDetail = loadingDetailsKey === key;
    const isAdding = addingKey === key;
    const isAlreadyInList = existingIds.has(key);

    const title = item.title || item.name || 'Sem Título';
    const imageUrl = item.poster_path
      ? `https://image.tmdb.org/t/p/w200${item.poster_path}`
      : null;

    const isAnime = checkIfAnime(detail || item);
    const categoryBadgeText = isAnime ? '🎌 ANIME' : item.media_type === 'movie' ? '🎬 FILME' : '📺 SÉRIE';
    const categoryBadgeStyle = isAnime ? styles.badgeAnime : item.media_type === 'movie' ? styles.badgeMovie : styles.badgeTv;

    const year = (item.release_date || item.first_air_date || detail?.release_date || detail?.first_air_date)?.substring(0, 4);
    const rating = (detail?.vote_average ?? item.vote_average);
    const trailerKey = detail ? findBestTrailer(detail.videos?.results || []) : null;
    const airStatusInfo = detail ? getMediaAirStatusInfo({
      media_type: item.media_type,
      is_anime: isAnime,
      air_status: detail.status,
      next_air_date: detail.next_episode_to_air?.air_date,
      next_episode_info: detail.next_episode_to_air ? `T${detail.next_episode_to_air.season_number} E${detail.next_episode_to_air.episode_number}` : null,
      release_date: detail.release_date || item.release_date,
    }) : null;

    return (
      <View style={[styles.card, isExpanded && styles.cardExpanded]}>
        {/* Card Header Area - Tappable to expand */}
        <TouchableOpacity
          style={styles.cardHeaderRow}
          onPress={() => toggleExpand(item)}
          activeOpacity={0.7}
        >
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.poster} />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]}>
              <Text style={styles.posterPlaceholderText}>Sem Imagem</Text>
            </View>
          )}

          <View style={styles.cardInfo}>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, categoryBadgeStyle]}>
                <Text style={styles.badgeText}>{categoryBadgeText}</Text>
              </View>
              {isAlreadyInList && (
                <View style={styles.badgeInList}>
                  <Text style={styles.badgeInListText}>✓ Na sua lista</Text>
                </View>
              )}
            </View>

            <Text style={styles.title} numberOfLines={2}>{title}</Text>

            <View style={styles.metaRow}>
              {year ? <Text style={styles.metaText}>📅 {year}</Text> : null}
              {rating ? <Text style={styles.metaText}>⭐ {rating.toFixed(1)}</Text> : null}
            </View>

            <Text style={styles.overview} numberOfLines={isExpanded ? 0 : 2}>
              {item.overview || 'Sem sinopse disponível.'}
            </Text>

            <View style={styles.expandHintRow}>
              <Text style={styles.expandHintText}>
                {isExpanded ? 'Recolher informações ▴' : 'Toque no card para temporadas, trailer e mais ▾'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* Expanded Details Section */}
        {isExpanded && (
          <View style={styles.expandedSection}>
            {isLoadingDetail ? (
              <View style={styles.detailLoader}>
                <ActivityIndicator size="small" color="#007AFF" />
                <Text style={styles.detailLoaderText}>Carregando mais informações...</Text>
              </View>
            ) : detail ? (
              <View style={styles.detailContent}>
                {/* Air Status / Next Episode Banner */}
                {airStatusInfo && (
                  <View style={[
                    styles.airStatusTag,
                    airStatusInfo.badgeStyle === 'ended' && styles.airStatusTagEnded,
                    airStatusInfo.badgeStyle === 'scheduled' && styles.airStatusTagScheduled,
                    airStatusInfo.badgeStyle === 'ongoing' && styles.airStatusTagOngoing,
                  ]}>
                    <Text style={styles.airStatusTagIcon}>{airStatusInfo.icon}</Text>
                    <Text style={[
                      styles.airStatusTagText,
                      airStatusInfo.badgeStyle === 'ended' && styles.airStatusTextEnded,
                      airStatusInfo.badgeStyle === 'scheduled' && styles.airStatusTextScheduled,
                      airStatusInfo.badgeStyle === 'ongoing' && styles.airStatusTextOngoing,
                    ]}>
                      {airStatusInfo.label}
                    </Text>
                  </View>
                )}

                {/* Extra Metadata Stats */}
                <View style={styles.detailStatsContainer}>
                  {item.media_type === 'tv' && (
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>Temporadas</Text>
                      <Text style={styles.statValue}>
                        {detail.number_of_seasons || detail.seasons?.filter(s => s.season_number > 0).length || 1}
                      </Text>
                      {detail.number_of_episodes ? (
                        <Text style={styles.statSub}>({detail.number_of_episodes} eps)</Text>
                      ) : null}
                    </View>
                  )}

                  {item.media_type === 'movie' && detail.runtime ? (
                    <View style={styles.statBox}>
                      <Text style={styles.statLabel}>Duração</Text>
                      <Text style={styles.statValue}>{detail.runtime} min</Text>
                    </View>
                  ) : null}

                  {detail.genres && detail.genres.length > 0 && (
                    <View style={[styles.statBox, { flex: 2 }]}>
                      <Text style={styles.statLabel}>Gêneros</Text>
                      <Text style={styles.statValueGenres} numberOfLines={2}>
                        {detail.genres.map(g => g.name).join(' • ')}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Full Synopsis */}
                {detail.overview && detail.overview !== item.overview ? (
                  <View style={styles.synopsisContainer}>
                    <Text style={styles.synopsisTitle}>Sinopse Completa</Text>
                    <Text style={styles.synopsisText}>{detail.overview}</Text>
                  </View>
                ) : null}

                {/* Trailer Section */}
                {trailerKey ? (
                  <View style={styles.trailerContainer}>
                    <Text style={styles.trailerHeader}>🎬 Trailer Oficial</Text>
                    <TouchableOpacity
                      style={styles.trailerButton}
                      onPress={() => handleOpenTrailer(trailerKey)}
                      activeOpacity={0.8}
                    >
                      <Image
                        source={{ uri: `https://img.youtube.com/vi/${trailerKey}/hqdefault.jpg` }}
                        style={styles.trailerThumbnail}
                      />
                      <View style={styles.trailerOverlay}>
                        <View style={styles.playIconContainer}>
                          <Text style={styles.playIcon}>▶</Text>
                        </View>
                        <Text style={styles.trailerOverlayText}>Assistir Trailer no YouTube</Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.noTrailerText}>Nenhum trailer oficial disponível no TMDB.</Text>
                )}
              </View>
            ) : null}

            {/* Action Button: Add to List */}
            <View style={styles.actionContainer}>
              <TouchableOpacity
                style={[
                  styles.addButton,
                  isAlreadyInList && styles.addButtonInList,
                  isAdding && styles.addButtonDisabled
                ]}
                onPress={() => handleAdd(item)}
                disabled={isAdding}
                activeOpacity={0.7}
              >
                {isAdding ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addButtonText}>
                    {isAlreadyInList ? '✓ Já na Lista (Salvar Novamente)' : '+ Adicionar à Minha Lista'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Collapsed quick add button */}
        {!isExpanded && (
          <View style={styles.cardFooter}>
            <TouchableOpacity
              style={[styles.quickAddBtn, isAlreadyInList && styles.quickAddBtnInList]}
              onPress={() => handleAdd(item)}
              disabled={isAdding}
            >
              <Text style={[styles.quickAddBtnText, isAlreadyInList && styles.quickAddBtnTextInList]}>
                {isAdding ? 'Adicionando...' : isAlreadyInList ? '✓ Na Lista' : '+ Adicionar'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const categories = [
    { key: 'all' as MediaCategory, label: '🌟 Todos' },
    { key: 'movie' as MediaCategory, label: '🎬 Filmes' },
    { key: 'tv' as MediaCategory, label: '📺 Séries' },
    { key: 'anime' as MediaCategory, label: '🎌 Animes' },
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Buscar & Explorar', headerBackTitle: 'Voltar' }} />

      {/* Top Search Input Bar */}
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="Buscar filme, série ou anime..."
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={fetchResults}
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.searchButton} onPress={fetchResults} disabled={loading}>
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.searchButtonText}>Buscar</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Category Pills Bar */}
      <View style={styles.categoriesBar}>
        {categories.map((cat) => {
          const isActive = selectedCategory === cat.key;
          return (
            <TouchableOpacity
              key={cat.key}
              style={[styles.catPill, isActive && styles.catPillActive]}
              onPress={() => setSelectedCategory(cat.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.catPillText, isActive && styles.catPillTextActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Filter Control Header */}
      <View style={styles.filterControlBar}>
        <TouchableOpacity
          style={[styles.filterToggleBtn, showFilters && styles.filterToggleBtnActive]}
          onPress={() => setShowFilters(!showFilters)}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterToggleText, showFilters && styles.filterToggleTextActive]}>
            ⚙️ Filtros {activeFiltersCount > 0 ? `(${activeFiltersCount})` : ''} {showFilters ? '▴' : '▾'}
          </Text>
        </TouchableOpacity>

        {activeFiltersCount > 0 && (
          <TouchableOpacity style={styles.resetFiltersBtn} onPress={handleResetFilters}>
            <Text style={styles.resetFiltersText}>✕ Limpar Filtros</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Collapsible Filter Panel */}
      {showFilters && (
        <View style={styles.filtersPanel}>
          <ScrollView showsVerticalScrollIndicator={false} style={styles.filterScroll}>
            {/* 1. Gêneros */}
            <Text style={styles.filterSectionTitle}>Gênero</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
              {COMMON_GENRES.map((g) => {
                const isSelected = selectedGenreId === g.id;
                return (
                  <TouchableOpacity
                    key={g.id}
                    style={[styles.chip, isSelected && styles.chipActive]}
                    onPress={() => setSelectedGenreId(g.id)}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                      {g.icon} {g.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* 2. Avaliação Mínima */}
            <Text style={styles.filterSectionTitle}>Avaliação Mínima (Nota ⭐)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
              {RATING_OPTIONS.map((r, idx) => {
                const isSelected = selectedMinRating === r.value;
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.chip, isSelected && styles.chipActive]}
                    onPress={() => setSelectedMinRating(r.value)}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* 3. Época / Ano */}
            <Text style={styles.filterSectionTitle}>Ano de Lançamento</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
              {YEAR_OPTIONS.map((y, idx) => {
                const isSelected = selectedYear === y.value;
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.chip, isSelected && styles.chipActive]}
                    onPress={() => setSelectedYear(y.value)}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                      {y.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* 4. Ordenação */}
            <Text style={styles.filterSectionTitle}>Ordenar Por</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsScroll}>
              {SORT_OPTIONS.map((s, idx) => {
                const isSelected = selectedSortBy === s.value;
                return (
                  <TouchableOpacity
                    key={idx}
                    style={[styles.chip, isSelected && styles.chipActive]}
                    onPress={() => setSelectedSortBy(s.value)}
                  >
                    <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>
                      {s.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </ScrollView>
        </View>
      )}

      {/* Feed Title Bar */}
      <View style={styles.feedHeaderRow}>
        <Text style={styles.feedTitle} numberOfLines={1}>{feedTitle}</Text>
        <Text style={styles.feedCount}>{results.length} itens</Text>
      </View>

      {/* Results List */}
      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => `${item.media_type}-${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {query.trim()
                  ? `Nenhum resultado encontrado para "${query.trim()}". Tente ajustar os filtros.`
                  : 'Nenhum resultado encontrado com os filtros selecionados.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f7fb',
  },
  searchBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: '#fff',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: '#f0f2f5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    fontSize: 15,
  },
  searchButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 18,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
  },
  searchButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  categoriesBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  catPill: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#f4f5f8',
    borderWidth: 1,
    borderColor: '#e2e5eb',
  },
  catPillActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  catPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
  },
  catPillTextActive: {
    color: '#fff',
  },
  filterControlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  filterToggleBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: '#f0f4f9',
  },
  filterToggleBtnActive: {
    backgroundColor: '#007AFF20',
  },
  filterToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
  },
  filterToggleTextActive: {
    color: '#007AFF',
  },
  resetFiltersBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  resetFiltersText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FF3B30',
  },
  filtersPanel: {
    backgroundColor: '#fff',
    maxHeight: 260,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  filterScroll: {
    paddingTop: 4,
  },
  filterSectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 6,
  },
  chipsScroll: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f2f3f7',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  chipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#444',
  },
  chipTextActive: {
    color: '#fff',
  },
  feedHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  feedTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    flex: 1,
  },
  feedCount: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
    marginLeft: 8,
  },
  loader: {
    marginTop: 40,
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 14,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  cardExpanded: {
    borderColor: '#007AFF55',
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    padding: 12,
  },
  poster: {
    width: 90,
    height: 135,
    borderRadius: 8,
    backgroundColor: '#e5e5e5',
  },
  posterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterPlaceholderText: {
    fontSize: 10,
    color: '#999',
  },
  cardInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'space-between',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeMovie: {
    backgroundColor: '#007AFF18',
  },
  badgeTv: {
    backgroundColor: '#00968818',
  },
  badgeAnime: {
    backgroundColor: '#AF52DE18',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#333',
  },
  badgeInList: {
    backgroundColor: '#34C75920',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeInListText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34C759',
  },
  title: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  metaText: {
    fontSize: 11,
    color: '#666',
    fontWeight: '500',
  },
  overview: {
    fontSize: 12,
    color: '#555',
    lineHeight: 16,
  },
  expandHintRow: {
    marginTop: 6,
  },
  expandHintText: {
    fontSize: 11,
    color: '#007AFF',
    fontWeight: '600',
  },
  expandedSection: {
    backgroundColor: '#fafbfc',
    borderTopWidth: 1,
    borderColor: '#eee',
    padding: 14,
  },
  detailLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  detailLoaderText: {
    fontSize: 12,
    color: '#666',
  },
  detailContent: {
    marginBottom: 12,
  },
  airStatusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 10,
    backgroundColor: '#f1f5f9',
  },
  airStatusTagEnded: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  airStatusTagScheduled: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  airStatusTagOngoing: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  airStatusTagIcon: {
    fontSize: 13,
    marginRight: 6,
  },
  airStatusTagText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  airStatusTextEnded: {
    color: '#047857',
  },
  airStatusTextScheduled: {
    color: '#1d4ed8',
  },
  airStatusTextOngoing: {
    color: '#b45309',
  },
  detailStatsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e8e8e8',
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 10,
    color: '#888',
    textTransform: 'uppercase',
    fontWeight: '600',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#222',
  },
  statSub: {
    fontSize: 10,
    color: '#888',
  },
  statValueGenres: {
    fontSize: 11,
    fontWeight: '600',
    color: '#444',
    textAlign: 'center',
  },
  synopsisContainer: {
    marginBottom: 12,
  },
  synopsisTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  synopsisText: {
    fontSize: 12,
    color: '#444',
    lineHeight: 18,
  },
  trailerContainer: {
    marginBottom: 12,
  },
  trailerHeader: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#222',
    marginBottom: 8,
  },
  trailerButton: {
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
    height: 140,
    backgroundColor: '#000',
  },
  trailerThumbnail: {
    width: '100%',
    height: '100%',
    opacity: 0.8,
  },
  trailerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
  },
  playIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FF0000',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  playIcon: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginLeft: 3,
  },
  trailerOverlayText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowRadius: 3,
  },
  noTrailerText: {
    fontSize: 11,
    color: '#888',
    fontStyle: 'italic',
    marginBottom: 10,
  },
  actionContainer: {
    marginTop: 4,
  },
  addButton: {
    backgroundColor: '#34C759',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  addButtonInList: {
    backgroundColor: '#007AFF',
  },
  addButtonDisabled: {
    opacity: 0.6,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  quickAddBtn: {
    backgroundColor: '#34C759',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  quickAddBtnInList: {
    backgroundColor: '#eef8ee',
    borderWidth: 1,
    borderColor: '#34C759',
  },
  quickAddBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  quickAddBtnTextInList: {
    color: '#34C759',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
  },
});
