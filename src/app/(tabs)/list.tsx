import React, { useState, useMemo, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  TextInput,
  Alert,
  Platform,
  StatusBar as RNStatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMediaList, MediaListItem } from '../../hooks/useMediaList';
import { useSyncStore } from '../../store/useSyncStore';
import { router, useFocusEffect } from 'expo-router';
import { MediaCategory } from '../../database/schema';
import { getMediaAirStatusInfo } from '../../services/tmdb';

type SortOption = 'pinned' | 'rating' | 'name' | 'recent';

export default function MyListScreen() {
  const { data, loading, loadMedia, removeMedia, togglePinMedia, quickIncrementEpisode } = useMediaList();
  const { isSyncing, runSync } = useSyncStore();
  const [selectedCategory, setSelectedCategory] = useState<MediaCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('pinned');
  const [incrementingId, setIncrementingId] = useState<string | null>(null);

  const insets = useSafeAreaInsets();
  const statusBarHeight = insets.top > 0
    ? insets.top
    : (Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) : 0);
  const headerPaddingTop = statusBarHeight > 0 ? statusBarHeight + 12 : 16;

  // Reload media whenever screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadMedia();
    }, [loadMedia])
  );

  const handleSync = () => {
    runSync().then(() => loadMedia());
  };

  const handleRemove = (item: MediaListItem) => {
    Alert.alert(
      'Remover da Lista',
      `Tem certeza que deseja remover "${item.title || 'este título'}" da sua lista?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeMedia(item.tmdb_id, item.media_type);
            } catch {
              Alert.alert('Erro', 'Não foi possível remover o item da lista.');
            }
          },
        },
      ]
    );
  };

  const handleTogglePin = async (item: MediaListItem) => {
    try {
      await togglePinMedia(item.tmdb_id, item.media_type);
    } catch {
      Alert.alert('Erro', 'Não foi possível fixar/desafixar o item.');
    }
  };

  const handleQuickIncrement = async (item: MediaListItem) => {
    const key = `${item.media_type}-${item.tmdb_id}`;
    setIncrementingId(key);
    try {
      await quickIncrementEpisode(item);
    } finally {
      setTimeout(() => setIncrementingId(null), 300);
    }
  };

  // Category counts
  const counts = useMemo(() => {
    let movies = 0;
    let tv = 0;
    let anime = 0;
    data.forEach((item) => {
      if (item.is_anime) {
        anime++;
      } else if (item.media_type === 'movie') {
        movies++;
      } else {
        tv++;
      }
    });
    return {
      all: data.length,
      movie: movies,
      tv: tv,
      anime: anime,
    };
  }, [data]);

  // Filtered & sorted data
  const processedData = useMemo(() => {
    // 1. Filter by category
    let list = data;
    if (selectedCategory === 'anime') {
      list = list.filter((item) => Boolean(item.is_anime));
    } else if (selectedCategory === 'movie') {
      list = list.filter((item) => item.media_type === 'movie' && !item.is_anime);
    } else if (selectedCategory === 'tv') {
      list = list.filter((item) => item.media_type === 'tv' && !item.is_anime);
    }

    // 2. Filter by internal search query
    if (searchQuery.trim().length > 0) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((item) => {
        const title = (item.title || '').toLowerCase();
        const overview = (item.overview || '').toLowerCase();
        return title.includes(q) || overview.includes(q);
      });
    }

    // 3. Sort
    return [...list].sort((a, b) => {
      const aPinned = a.is_pinned ? 1 : 0;
      const bPinned = b.is_pinned ? 1 : 0;

      // When pinned sort option is selected, pinned ALWAYS stay at top
      if (sortBy === 'pinned') {
        if (aPinned !== bPinned) return bPinned - aPinned;
        return (b.updated_at || 0) - (a.updated_at || 0);
      }

      // If user selected another sort option, pinned can still be prioritized first
      if (aPinned !== bPinned) return bPinned - aPinned;

      if (sortBy === 'rating') {
        const aRating = a.user_rating || a.vote_average || 0;
        const bRating = b.user_rating || b.vote_average || 0;
        return bRating - aRating;
      }

      if (sortBy === 'name') {
        const aTitle = (a.title || '').toLowerCase();
        const bTitle = (b.title || '').toLowerCase();
        return aTitle.localeCompare(bTitle);
      }

      if (sortBy === 'recent') {
        return (b.updated_at || 0) - (a.updated_at || 0);
      }

      return 0;
    });
  }, [data, selectedCategory, searchQuery, sortBy]);

  const categoriesList: { key: MediaCategory; label: string; count: number }[] = [
    { key: 'all', label: 'Todos', count: counts.all },
    { key: 'movie', label: 'Filmes', count: counts.movie },
    { key: 'tv', label: 'Séries', count: counts.tv },
    { key: 'anime', label: 'Animes', count: counts.anime },
  ];

  const sortOptions: { key: SortOption; label: string; icon: string }[] = [
    { key: 'pinned', label: 'Fixados', icon: '📌' },
    { key: 'rating', label: 'Nota', icon: '⭐' },
    { key: 'name', label: 'A-Z', icon: '🔤' },
    { key: 'recent', label: 'Recentes', icon: '🕒' },
  ];

  const getStatusInfo = (status: string) => {
    switch (status) {
      case 'watching':
        return { text: '▶ Assistindo', badgeStyle: styles.statusBadgeWatching, textStyle: styles.statusTextWatching };
      case 'completed':
        return { text: '✓ Concluído', badgeStyle: styles.statusBadgeCompleted, textStyle: styles.statusTextCompleted };
      case 'plan_to_watch':
      default:
        return { text: '🔖 Quero Assistir', badgeStyle: styles.statusBadgePlan, textStyle: styles.statusTextPlan };
    }
  };

  const renderItem = ({ item }: { item: MediaListItem }) => {
    const isAnime = Boolean(item.is_anime);
    const totalEpisodes = item.episode_count || 0;
    const rawWatched = item.watched_episodes_count || 0;
    const watchedEpisodes = (totalEpisodes > 0 && rawWatched > totalEpisodes) 
      ? totalEpisodes 
      : rawWatched;
    const isCompleted = totalEpisodes > 0 && watchedEpisodes >= totalEpisodes;
    const progressPercent = totalEpisodes > 0 
      ? Math.min(100, Math.round((watchedEpisodes / totalEpisodes) * 100)) 
      : 0;

    const posterUrl = item.poster_path
      ? `https://image.tmdb.org/t/p/w200${item.poster_path}`
      : null;

    const releaseYear = item.release_date
      ? item.release_date.split('-')[0]
      : null;

    const statusInfo = getStatusInfo(item.status);
    const airStatusInfo = getMediaAirStatusInfo({
      media_type: item.media_type,
      is_anime: item.is_anime,
      air_status: item.air_status,
      next_air_date: item.next_air_date,
      next_episode_info: item.next_episode_info,
      release_date: item.release_date,
    });

    const isPinned = Boolean(item.is_pinned);
    const isInc = incrementingId === `${item.media_type}-${item.tmdb_id}`;

    return (
      <View style={[styles.card, isPinned && styles.cardPinned]}>
        <TouchableOpacity
          style={styles.cardMainTouch}
          onPress={() => router.push(`/details/${item.media_type}/${item.tmdb_id}`)}
          activeOpacity={0.7}
        >
          {posterUrl ? (
            <Image source={{ uri: posterUrl }} style={styles.cardPoster} />
          ) : (
            <View style={[styles.cardPoster, styles.cardPosterPlaceholder]}>
              <Text style={styles.cardPosterPlaceholderText}>Sem Img</Text>
            </View>
          )}

          <View style={styles.cardDetails}>
            {/* Header: Title and Top Badges */}
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {item.title}
              </Text>
            </View>

            {/* Badges Row: Category, Status, Pinned, Rating */}
            <View style={styles.cardBadgesRow}>
              {isPinned ? (
                <View style={styles.pinnedBadge}>
                  <Text style={styles.pinnedBadgeText}>📌 Fixado</Text>
                </View>
              ) : null}

              <View style={[styles.badge, isAnime ? styles.badgeAnime : item.media_type === 'movie' ? styles.badgeMovie : styles.badgeTv]}>
                <Text style={styles.badgeText}>
                  {isAnime ? '🎌 ANIME' : item.media_type === 'movie' ? '🎬 FILME' : '📺 SÉRIE'}
                </Text>
              </View>

              <View style={[styles.badge, statusInfo.badgeStyle]}>
                <Text style={[styles.badgeText, statusInfo.textStyle]}>
                  {statusInfo.text}
                </Text>
              </View>

              {releaseYear ? (
                <Text style={styles.cardYearText}>{releaseYear}</Text>
              ) : null}

              {(item.user_rating && item.user_rating > 0) ? (
                <View style={styles.userRatingBadge}>
                  <Text style={styles.userRatingText}>⭐ {item.user_rating}/10</Text>
                </View>
              ) : item.vote_average ? (
                <View style={styles.tmdbRatingBadge}>
                  <Text style={styles.tmdbRatingText}>⭐ {item.vote_average.toFixed(1)}</Text>
                </View>
              ) : null}
            </View>

            {/* Air status banner */}
            {airStatusInfo ? (
              <View style={[
                styles.cardAirStatus,
                airStatusInfo.badgeStyle === 'ended' && styles.cardAirStatusEnded,
                airStatusInfo.badgeStyle === 'scheduled' && styles.cardAirStatusScheduled,
                airStatusInfo.badgeStyle === 'ongoing' && styles.cardAirStatusOngoing,
              ]}>
                <Text style={styles.cardAirStatusIcon}>{airStatusInfo.icon}</Text>
                <Text style={styles.cardAirStatusText} numberOfLines={1}>
                  {airStatusInfo.label}
                </Text>
              </View>
            ) : null}

            {/* Episode progress bar for Series / Anime */}
            {item.media_type === 'tv' ? (
              <View style={styles.cardProgressContainer}>
                <View style={styles.cardProgressHeader}>
                  <Text style={styles.cardProgressLabel}>
                    Progresso: <Text style={styles.cardProgressValue}>{watchedEpisodes}</Text>
                    {totalEpisodes > 0 ? `/${totalEpisodes} eps` : ' eps assistidos'}
                  </Text>
                  {totalEpisodes > 0 ? (
                    <Text style={[
                      styles.cardProgressPercent, 
                      progressPercent === 100 && styles.cardProgressPercentDone
                    ]}>
                      {progressPercent === 100 ? '✓ 100%' : `${progressPercent}%`}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.cardProgressBarTrack}>
                  <View 
                    style={[
                      styles.cardProgressBarFill,
                      { width: `${progressPercent}%` },
                      progressPercent === 100 
                        ? styles.cardProgressBarFillDone 
                        : (isAnime ? styles.cardProgressBarFillAnime : styles.cardProgressBarFillTv)
                    ]} 
                  />
                </View>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>

        {/* Side Actions Column: Pin, +1 Ep, Delete */}
        <View style={styles.cardActionsColumn}>
          {/* Pin Button */}
          <TouchableOpacity
            style={[styles.actionBtn, isPinned && styles.actionBtnPinned]}
            onPress={() => handleTogglePin(item)}
            activeOpacity={0.7}
            accessibilityLabel={isPinned ? "Desafixar do topo" : "Fixar no topo"}
          >
            <Text style={[styles.actionBtnIcon, isPinned && styles.actionBtnIconPinned]}>
              {isPinned ? '📌' : '📍'}
            </Text>
          </TouchableOpacity>

          {/* Quick +1 Episode Button (TV & Anime) */}
          {item.media_type === 'tv' ? (
            <TouchableOpacity
              style={[
                styles.actionBtn, 
                styles.actionBtnAddEp, 
                isCompleted && styles.actionBtnAddEpDisabled,
                isInc && styles.actionBtnAddEpActive
              ]}
              onPress={() => !isCompleted && handleQuickIncrement(item)}
              activeOpacity={isCompleted ? 1 : 0.7}
              disabled={isInc || isCompleted}
              accessibilityLabel={isCompleted ? "Todos os episódios assistidos" : "Marcar próximo episódio assistido"}
            >
              {isInc ? (
                <ActivityIndicator size="small" color="#007AFF" />
              ) : isCompleted ? (
                <Text style={styles.actionBtnAddEpDoneText}>✓</Text>
              ) : (
                <Text style={styles.actionBtnAddEpText}>+1</Text>
              )}
            </TouchableOpacity>
          ) : null}

          {/* Delete Button */}
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnDelete]}
            onPress={() => handleRemove(item)}
            activeOpacity={0.7}
            accessibilityLabel="Remover da lista"
          >
            <Text style={styles.actionBtnDeleteText}>🗑️</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
        <View>
          <Text style={styles.headerTitle}>Minha Lista</Text>
          <Text style={styles.headerSubtitle}>
            {counts.all} {counts.all === 1 ? 'título salvo' : 'títulos salvos'}
          </Text>
        </View>

        <TouchableOpacity 
          style={styles.syncBtn} 
          onPress={handleSync} 
          disabled={isSyncing}
          activeOpacity={0.7}
        >
          {isSyncing ? (
            <ActivityIndicator size="small" color="#007AFF" />
          ) : (
            <Text style={styles.syncBtnText}>🔄 Sincronizar</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Internal Search Bar */}
      <View style={styles.searchBarWrapper}>
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Buscar na minha lista..."
            placeholderTextColor="#8E8E93"
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {searchQuery.length > 0 ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.searchClearBtn}>
              <Text style={styles.searchClearText}>✕</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Category Pills */}
      <View style={styles.categoriesBar}>
        {categoriesList.map((cat) => {
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
              <View style={[styles.catCountBadge, isActive && styles.catCountBadgeActive]}>
                <Text style={[styles.catCountText, isActive && styles.catCountTextActive]}>
                  {cat.count}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Sorting Control Bar */}
      <View style={styles.sortBar}>
        <Text style={styles.sortLabel}>Ordenar:</Text>
        <View style={styles.sortOptionsRow}>
          {sortOptions.map((opt) => {
            const isActive = sortBy === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.sortChip, isActive && styles.sortChipActive]}
                onPress={() => setSortBy(opt.key)}
                activeOpacity={0.7}
              >
                <Text style={styles.sortChipIcon}>{opt.icon}</Text>
                <Text style={[styles.sortChipText, isActive && styles.sortChipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Main List */}
      {loading && data.length === 0 ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Carregando sua lista...</Text>
        </View>
      ) : (
        <FlatList
          data={processedData}
          keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContainer,
            { paddingBottom: Math.max(insets.bottom, 16) + 32 }
          ]}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              {searchQuery.trim().length > 0 ? (
                <>
                  <Text style={styles.emptyIcon}>🔍</Text>
                  <Text style={styles.emptyTitle}>Nenhum resultado encontrado</Text>
                  <Text style={styles.emptySubtitle}>
                    Não encontramos títulos com &quot;{searchQuery}&quot; na sua lista.
                  </Text>
                  <TouchableOpacity 
                    style={styles.emptyActionBtn} 
                    onPress={() => setSearchQuery('')}
                  >
                    <Text style={styles.emptyActionBtnText}>Limpar busca</Text>
                  </TouchableOpacity>
                </>
              ) : data.length === 0 ? (
                <>
                  <Text style={styles.emptyIcon}>🍿</Text>
                  <Text style={styles.emptyTitle}>Sua lista está vazia</Text>
                  <Text style={styles.emptySubtitle}>
                    Explore filmes, séries e animes para adicionar à sua coleção e começar a acompanhar!
                  </Text>
                  <TouchableOpacity
                    style={styles.emptyActionBtn}
                    onPress={() => router.push('/search')}
                  >
                    <Text style={styles.emptyActionBtnText}>🔍 Explorar e Adicionar</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <Text style={styles.emptyIcon}>📂</Text>
                  <Text style={styles.emptyTitle}>Nenhum item nesta categoria</Text>
                  <Text style={styles.emptySubtitle}>
                    Você ainda não adicionou nenhum título nesta categoria.
                  </Text>
                </>
              )}
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
    backgroundColor: '#F2F3F8',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 2,
  },
  syncBtn: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  syncBtnText: {
    color: '#1D4ED8',
    fontSize: 13,
    fontWeight: '600',
  },
  searchBarWrapper: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  searchIcon: {
    fontSize: 15,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    padding: 0,
  },
  searchClearBtn: {
    padding: 4,
  },
  searchClearText: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '700',
  },
  categoriesBar: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 6,
  },
  catPillActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  catPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4B5563',
  },
  catPillTextActive: {
    color: '#FFFFFF',
  },
  catCountBadge: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
  },
  catCountBadgeActive: {
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  catCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4B5563',
  },
  catCountTextActive: {
    color: '#FFFFFF',
  },
  sortBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  sortLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sortOptionsRow: {
    flexDirection: 'row',
    flex: 1,
    gap: 6,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 4,
  },
  sortChipActive: {
    backgroundColor: '#1E293B',
    borderColor: '#1E293B',
  },
  sortChipIcon: {
    fontSize: 12,
  },
  sortChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4B5563',
  },
  sortChipTextActive: {
    color: '#FFFFFF',
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 40,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    overflow: 'hidden',
  },
  cardPinned: {
    borderColor: '#93C5FD',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
  },
  cardMainTouch: {
    flex: 1,
    flexDirection: 'row',
    padding: 10,
    gap: 12,
  },
  cardPoster: {
    width: 72,
    height: 104,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
  },
  cardPosterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardPosterPlaceholderText: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  cardDetails: {
    flex: 1,
    justifyContent: 'space-between',
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 20,
    flex: 1,
  },
  cardBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
    marginVertical: 4,
  },
  pinnedBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  pinnedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  badgeMovie: {
    backgroundColor: '#E0F2FE',
  },
  badgeTv: {
    backgroundColor: '#EDE9FE',
  },
  badgeAnime: {
    backgroundColor: '#FEF2F2',
  },
  statusBadgeWatching: {
    backgroundColor: '#DCFCE7',
  },
  statusTextWatching: {
    color: '#15803D',
  },
  statusBadgeCompleted: {
    backgroundColor: '#F1F5F9',
  },
  statusTextCompleted: {
    color: '#475569',
  },
  statusBadgePlan: {
    backgroundColor: '#FEF9C3',
  },
  statusTextPlan: {
    color: '#854D0E',
  },
  cardYearText: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  userRatingBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  userRatingText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#D97706',
  },
  tmdbRatingBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  tmdbRatingText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4B5563',
  },
  cardAirStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    gap: 4,
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  cardAirStatusEnded: {
    backgroundColor: '#F3F4F6',
  },
  cardAirStatusScheduled: {
    backgroundColor: '#EFF6FF',
  },
  cardAirStatusOngoing: {
    backgroundColor: '#ECFDF5',
  },
  cardAirStatusIcon: {
    fontSize: 10,
  },
  cardAirStatusText: {
    fontSize: 10,
    color: '#4B5563',
    fontWeight: '600',
  },
  cardProgressContainer: {
    marginTop: 2,
  },
  cardProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardProgressLabel: {
    fontSize: 11,
    color: '#6B7280',
  },
  cardProgressValue: {
    fontWeight: '700',
    color: '#111827',
  },
  cardProgressPercent: {
    fontSize: 11,
    fontWeight: '700',
    color: '#007AFF',
  },
  cardProgressPercentDone: {
    color: '#10B981',
  },
  cardProgressBarTrack: {
    height: 6,
    backgroundColor: '#E5E7EB',
    borderRadius: 3,
    overflow: 'hidden',
  },
  cardProgressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  cardProgressBarFillTv: {
    backgroundColor: '#007AFF',
  },
  cardProgressBarFillAnime: {
    backgroundColor: '#8B5CF6',
  },
  cardProgressBarFillDone: {
    backgroundColor: '#10B981',
  },
  cardActionsColumn: {
    width: 44,
    borderLeftWidth: 1,
    borderLeftColor: '#F3F4F6',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 6,
    backgroundColor: '#FAFAFC',
  },
  actionBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionBtnPinned: {
    backgroundColor: '#FEF3C7',
  },
  actionBtnIcon: {
    fontSize: 16,
    opacity: 0.6,
  },
  actionBtnIconPinned: {
    opacity: 1,
  },
  actionBtnAddEp: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  actionBtnAddEpActive: {
    backgroundColor: '#DBEAFE',
  },
  actionBtnAddEpDisabled: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  actionBtnAddEpText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1D4ED8',
  },
  actionBtnAddEpDoneText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#10B981',
  },
  actionBtnDelete: {
    opacity: 0.6,
  },
  actionBtnDeleteText: {
    fontSize: 14,
  },
  centerLoading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    fontSize: 14,
    color: '#6B7280',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  emptyActionBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  emptyActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
