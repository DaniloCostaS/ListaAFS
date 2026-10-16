import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Platform,
  StatusBar as RNStatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMediaList, MediaListItem } from '../../hooks/useMediaList';
import { useSyncStore } from '../../store/useSyncStore';
import { useAuthStore } from '../../store/useAuthStore';
import { router, useFocusEffect } from 'expo-router';
import { discoverMedia, TMDBMultiSearchResult } from '../../services/tmdb';

export default function HomeScreen() {
  const { data, loadMedia, quickIncrementEpisode } = useMediaList();
  const { isSyncing, runSync } = useSyncStore();
  const { signOut, user } = useAuthStore();
  const [recommendations, setRecommendations] = useState<TMDBMultiSearchResult[]>([]);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [incrementingId, setIncrementingId] = useState<string | null>(null);

  const insets = useSafeAreaInsets();
  const statusBarHeight = insets.top > 0
    ? insets.top
    : (Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) : 0);
  const headerPaddingTop = statusBarHeight > 0 ? statusBarHeight + 12 : 16;

  // Reload media when tab comes into focus
  useFocusEffect(
    useCallback(() => {
      loadMedia();
    }, [loadMedia])
  );

  // Load recommendations once
  useEffect(() => {
    let isMounted = true;
    discoverMedia({ category: 'all', sortBy: 'popularity.desc' })
      .then((res) => {
        if (isMounted) {
          setRecommendations(res.slice(0, 10));
        }
      })
      .catch((err) => console.error('Error fetching recommendations:', err))
      .finally(() => {
        if (isMounted) setLoadingRecs(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSync = () => {
    runSync().then(() => loadMedia());
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

  // Find the primary "Continue Watching / Last Watched" item
  const lastWatchedItem = useMemo(() => {
    if (data.length === 0) return null;

    // 1. Prioritize TV / Anime currently watching with episodes remaining
    const watchingItem = data.find(
      (i) => i.status === 'watching' && (i.episode_count ? (i.watched_episodes_count || 0) < i.episode_count : true)
    );
    if (watchingItem) return watchingItem;

    // 2. Or any item with watched episodes
    const itemWithProgress = data.find(
      (i) => i.media_type === 'tv' && (i.watched_episodes_count || 0) > 0 && i.status !== 'completed'
    );
    if (itemWithProgress) return itemWithProgress;

    // 3. Fallback to the most recently updated item
    return data[0];
  }, [data]);

  // Overall collection progress
  const overallProgress = useMemo(() => {
    let totalEps = 0;
    let watchedEps = 0;
    let totalMovies = 0;
    let completedMovies = 0;

    data.forEach((item) => {
      if (item.media_type === 'tv') {
        totalEps += (item.episode_count || 0);
        watchedEps += (item.watched_episodes_count || 0);
      } else {
        totalMovies++;
        if (item.status === 'completed') {
          completedMovies++;
        }
      }
    });

    const percent = totalEps > 0 ? Math.round((watchedEps / totalEps) * 100) : 0;
    return { totalEps, watchedEps, percent, totalMovies, completedMovies };
  }, [data]);

  // Upcoming Schedule
  const upcomingSchedule = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const items: {
      item: MediaListItem;
      dateStr: string;
      diffDays: number;
      badgeText: string;
    }[] = [];

    data.forEach((item) => {
      if (item.media_type === 'tv' && item.next_air_date) {
        const parts = item.next_air_date.split('-');
        if (parts.length === 3) {
          const y = parseInt(parts[0], 10);
          const m = parseInt(parts[1], 10);
          const d = parseInt(parts[2], 10);
          const airDate = new Date(y, m - 1, d);
          airDate.setHours(0, 0, 0, 0);

          const diffTime = airDate.getTime() - today.getTime();
          const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

          if (diffDays >= 0) {
            let badgeText = `Em ${diffDays} dias`;
            if (diffDays === 0) badgeText = 'Hoje! 🔥';
            else if (diffDays === 1) badgeText = 'Amanhã! ⏰';

            items.push({
              item,
              dateStr: `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`,
              diffDays,
              badgeText,
            });
          }
        }
      }
    });

    return items.sort((a, b) => a.diffDays - b.diffDays).slice(0, 5);
  }, [data]);

  // Statistics
  const statsData = useMemo(() => {
    let totalMinutes = 0;
    let totalWatchedEpisodes = 0;
    let totalMoviesCompleted = 0;
    let totalAnimeEpisodes = 0;
    let totalTvEpisodes = 0;
    let ratedCount = 0;
    let ratingSum = 0;

    data.forEach((item) => {
      if (item.user_rating && item.user_rating > 0) {
        ratedCount++;
        ratingSum += item.user_rating;
      }

      if (item.media_type === 'movie') {
        if (item.status === 'completed') {
          totalMoviesCompleted++;
          totalMinutes += 110; // average 110 min
        }
      } else {
        const watched = item.watched_episodes_count || 0;
        totalWatchedEpisodes += watched;
        if (item.is_anime) {
          totalAnimeEpisodes += watched;
          totalMinutes += watched * 24; // 24 min per anime
        } else {
          totalTvEpisodes += watched;
          totalMinutes += watched * 45; // 45 min per TV
        }
      }
    });

    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    let formattedTime = '';
    if (days > 0) {
      formattedTime = `${days}d ${hours}h`;
    } else if (hours > 0) {
      formattedTime = `${hours}h ${minutes}m`;
    } else {
      formattedTime = `${minutes}m`;
    }

    const averageRating = ratedCount > 0 ? (ratingSum / ratedCount).toFixed(1) : null;

    return {
      totalMinutes,
      formattedTime,
      totalMoviesCompleted,
      totalWatchedEpisodes,
      totalAnimeEpisodes,
      totalTvEpisodes,
      averageRating,
      ratedCount,
    };
  }, [data]);

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>🍿 ListaAFS</Text>
          <Text style={styles.headerUser} numberOfLines={1}>{user?.email || 'Minha Coleção'}</Text>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity 
            style={styles.syncBtn} 
            onPress={handleSync} 
            disabled={isSyncing}
            activeOpacity={0.7}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color="#007AFF" />
            ) : (
              <Text style={styles.syncBtnText}>🔄 Sync</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutBtn} onPress={signOut} activeOpacity={0.7}>
            <Text style={styles.logoutBtnText}>Sair</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView 
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 32 }
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Continue Watching / Last Watched Hero Card */}
        {lastWatchedItem ? (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>
                {lastWatchedItem.status === 'watching' ? '▶ Continuar Assistindo' : '⏱️ Último Assistido'}
              </Text>
              <TouchableOpacity onPress={() => router.push('/list')}>
                <Text style={styles.sectionLink}>Ver lista ›</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.heroCard}
              onPress={() => router.push(`/details/${lastWatchedItem.media_type}/${lastWatchedItem.tmdb_id}`)}
              activeOpacity={0.85}
            >
              {lastWatchedItem.poster_path ? (
                <Image 
                  source={{ uri: `https://image.tmdb.org/t/p/w300${lastWatchedItem.poster_path}` }} 
                  style={styles.heroPoster} 
                />
              ) : (
                <View style={[styles.heroPoster, styles.heroPosterPlaceholder]}>
                  <Text style={styles.heroPosterPlaceholderText}>Sem Img</Text>
                </View>
              )}

              <View style={styles.heroInfo}>
                <View style={styles.heroBadgeRow}>
                  <View style={[
                    styles.heroBadge, 
                    lastWatchedItem.is_anime ? styles.badgeAnime : lastWatchedItem.media_type === 'movie' ? styles.badgeMovie : styles.badgeTv
                  ]}>
                    <Text style={styles.heroBadgeText}>
                      {lastWatchedItem.is_anime ? '🎌 ANIME' : lastWatchedItem.media_type === 'movie' ? '🎬 FILME' : '📺 SÉRIE'}
                    </Text>
                  </View>

                  {lastWatchedItem.is_pinned && (
                    <View style={styles.heroPinnedBadge}>
                      <Text style={styles.heroPinnedBadgeText}>📌 Fixado</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.heroTitle} numberOfLines={2}>
                  {lastWatchedItem.title}
                </Text>

                {lastWatchedItem.media_type === 'tv' && (
                  <View style={styles.heroProgressBlock}>
                    <View style={styles.heroProgressHeader}>
                      <Text style={styles.heroProgressText}>
                        Episódio {lastWatchedItem.watched_episodes_count || 0}
                        {lastWatchedItem.episode_count ? ` de ${lastWatchedItem.episode_count}` : ''}
                      </Text>
                      {lastWatchedItem.episode_count ? (
                        <Text style={styles.heroProgressPercent}>
                          {Math.min(100, Math.round(((lastWatchedItem.watched_episodes_count || 0) / lastWatchedItem.episode_count) * 100))}%
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.heroProgressBarTrack}>
                      <View 
                        style={[
                          styles.heroProgressBarFill,
                          {
                            width: `${lastWatchedItem.episode_count 
                              ? Math.min(100, Math.round(((lastWatchedItem.watched_episodes_count || 0) / lastWatchedItem.episode_count) * 100)) 
                              : 0}%`
                          }
                        ]} 
                      />
                    </View>

                    {/* Quick +1 Episode Button */}
                    <TouchableOpacity
                      style={styles.heroAddEpBtn}
                      onPress={() => handleQuickIncrement(lastWatchedItem)}
                      disabled={incrementingId === `${lastWatchedItem.media_type}-${lastWatchedItem.tmdb_id}`}
                      activeOpacity={0.8}
                    >
                      {incrementingId === `${lastWatchedItem.media_type}-${lastWatchedItem.tmdb_id}` ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.heroAddEpBtnText}>+1 Episódio Assistido</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Upcoming Schedule Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>📅 Próximos Lançamentos</Text>
            {upcomingSchedule.length > 0 && (
              <View style={styles.scheduleBadge}>
                <Text style={styles.scheduleBadgeText}>{upcomingSchedule.length}</Text>
              </View>
            )}
          </View>

          {upcomingSchedule.length > 0 ? (
            <View style={styles.scheduleList}>
              {upcomingSchedule.map(({ item, dateStr, diffDays, badgeText }) => {
                const isToday = diffDays === 0;
                const isTomorrow = diffDays === 1;

                return (
                  <TouchableOpacity
                    key={`${item.media_type}-${item.tmdb_id}`}
                    style={[styles.scheduleCard, isToday && styles.scheduleCardToday]}
                    onPress={() => router.push(`/details/${item.media_type}/${item.tmdb_id}`)}
                    activeOpacity={0.7}
                  >
                    {item.poster_path ? (
                      <Image
                        source={{ uri: `https://image.tmdb.org/t/p/w200${item.poster_path}` }}
                        style={styles.schedulePoster}
                      />
                    ) : (
                      <View style={[styles.schedulePoster, styles.heroPosterPlaceholder]}>
                        <Text style={styles.heroPosterPlaceholderText}>Sem Img</Text>
                      </View>
                    )}

                    <View style={styles.scheduleInfo}>
                      <View style={styles.scheduleBadgeRow}>
                        <View style={[
                          styles.scheduleCountdown,
                          isToday && styles.countdownToday,
                          isTomorrow && styles.countdownTomorrow,
                        ]}>
                          <Text style={[
                            styles.countdownText,
                            isToday && styles.countdownTodayText,
                            isTomorrow && styles.countdownTomorrowText,
                          ]}>
                            {badgeText}
                          </Text>
                        </View>
                        <Text style={styles.scheduleDateText}>{dateStr}</Text>
                      </View>

                      <Text style={styles.scheduleTitle} numberOfLines={1}>
                        {item.title}
                      </Text>

                      {item.next_episode_info && (
                        <Text style={styles.scheduleEpInfo}>
                          {item.next_episode_info}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardIcon}>✨</Text>
              <Text style={styles.emptyCardText}>
                Nenhum novo episódio agendado para os próximos dias na sua lista.
              </Text>
            </View>
          )}
        </View>

        {/* Global Collection Progress Banner */}
        {overallProgress.totalEps > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📊 Progresso da Coleção</Text>
            <View style={styles.progressCard}>
              <View style={styles.progressHeader}>
                <Text style={styles.progressLabel}>Episódios Assistidos</Text>
                <Text style={styles.progressPercent}>{overallProgress.percent}%</Text>
              </View>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${overallProgress.percent}%` }]} />
              </View>
              <Text style={styles.progressSubtitle}>
                {overallProgress.watchedEps} de {overallProgress.totalEps} episódios concluídos
              </Text>
            </View>
          </View>
        )}

        {/* Account Statistics Grid */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>📈 Suas Estatísticas</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={styles.statIcon}>⏱️</Text>
              <Text style={styles.statValue}>
                {statsData.totalMinutes > 0 ? statsData.formattedTime : '0h'}
              </Text>
              <Text style={styles.statLabel}>Tempo Assistido</Text>
            </View>

            <View style={styles.statBox}>
              <Text style={styles.statIcon}>🎬</Text>
              <Text style={styles.statValue}>{statsData.totalMoviesCompleted}</Text>
              <Text style={styles.statLabel}>Filmes Vistos</Text>
            </View>

            <View style={styles.statBox}>
              <Text style={styles.statIcon}>📺</Text>
              <Text style={styles.statValue}>{statsData.totalTvEpisodes}</Text>
              <Text style={styles.statLabel}>Eps de Séries</Text>
            </View>

            <View style={styles.statBox}>
              <Text style={styles.statIcon}>🎌</Text>
              <Text style={styles.statValue}>{statsData.totalAnimeEpisodes}</Text>
              <Text style={styles.statLabel}>Eps de Animes</Text>
            </View>
          </View>
        </View>

        {/* Recommendations Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>✨ Sugestões para Você</Text>
            <TouchableOpacity onPress={() => router.push('/search')}>
              <Text style={styles.sectionLink}>Buscar mais ›</Text>
            </TouchableOpacity>
          </View>

          {loadingRecs ? (
            <ActivityIndicator size="small" color="#007AFF" style={{ marginVertical: 20 }} />
          ) : recommendations.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recsScroll}>
              {recommendations.map((rec) => {
                const title = rec.title || rec.name;
                const posterUrl = rec.poster_path 
                  ? `https://image.tmdb.org/t/p/w200${rec.poster_path}` 
                  : null;

                return (
                  <TouchableOpacity
                    key={`${rec.media_type}-${rec.id}`}
                    style={styles.recCard}
                    onPress={() => router.push(`/details/${rec.media_type}/${rec.id}`)}
                    activeOpacity={0.8}
                  >
                    {posterUrl ? (
                      <Image source={{ uri: posterUrl }} style={styles.recPoster} />
                    ) : (
                      <View style={[styles.recPoster, styles.heroPosterPlaceholder]}>
                        <Text style={styles.heroPosterPlaceholderText}>Sem Img</Text>
                      </View>
                    )}
                    <Text style={styles.recTitle} numberOfLines={2}>
                      {title}
                    </Text>
                    {rec.vote_average ? (
                      <Text style={styles.recRating}>⭐ {rec.vote_average.toFixed(1)}</Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      </ScrollView>
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
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
  },
  headerUser: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  syncBtn: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  syncBtnText: {
    color: '#1D4ED8',
    fontSize: 12,
    fontWeight: '600',
  },
  logoutBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  logoutBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
  },
  sectionLink: {
    fontSize: 13,
    fontWeight: '600',
    color: '#007AFF',
  },
  heroCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  heroPoster: {
    width: 88,
    height: 130,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  heroPosterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroPosterPlaceholderText: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  heroInfo: {
    flex: 1,
    justifyContent: 'space-between',
  },
  heroBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  heroBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  heroBadgeText: {
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
  heroPinnedBadge: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  heroPinnedBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
  },
  heroTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
    marginVertical: 4,
    lineHeight: 22,
  },
  heroProgressBlock: {
    marginTop: 4,
  },
  heroProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  heroProgressText: {
    fontSize: 12,
    color: '#6B7280',
    fontWeight: '600',
  },
  heroProgressPercent: {
    fontSize: 12,
    color: '#007AFF',
    fontWeight: '700',
  },
  heroProgressBarTrack: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 8,
  },
  heroProgressBarFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 3,
  },
  heroAddEpBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  heroAddEpBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  scheduleBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  scheduleBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1D4ED8',
  },
  scheduleList: {
    gap: 8,
  },
  scheduleCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  scheduleCardToday: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FFF8F8',
  },
  schedulePoster: {
    width: 44,
    height: 64,
    borderRadius: 6,
    backgroundColor: '#E5E7EB',
  },
  scheduleInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  scheduleBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  scheduleCountdown: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  countdownToday: {
    backgroundColor: '#FEE2E2',
  },
  countdownTomorrow: {
    backgroundColor: '#FEF3C7',
  },
  countdownText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#4B5563',
  },
  countdownTodayText: {
    color: '#DC2626',
  },
  countdownTomorrowText: {
    color: '#D97706',
  },
  scheduleDateText: {
    fontSize: 11,
    color: '#9CA3AF',
    fontWeight: '600',
  },
  scheduleTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
  },
  scheduleEpInfo: {
    fontSize: 11,
    color: '#007AFF',
    fontWeight: '600',
    marginTop: 2,
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  emptyCardIcon: {
    fontSize: 24,
    marginBottom: 6,
  },
  emptyCardText: {
    fontSize: 13,
    color: '#6B7280',
    textAlign: 'center',
    lineHeight: 18,
  },
  progressCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  progressPercent: {
    fontSize: 13,
    fontWeight: '800',
    color: '#007AFF',
  },
  progressTrack: {
    height: 8,
    backgroundColor: '#E5E7EB',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 4,
  },
  progressSubtitle: {
    fontSize: 12,
    color: '#6B7280',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statBox: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    alignItems: 'center',
  },
  statIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  statLabel: {
    fontSize: 11,
    color: '#6B7280',
    marginTop: 2,
    textAlign: 'center',
  },
  recsScroll: {
    gap: 10,
    paddingRight: 16,
  },
  recCard: {
    width: 100,
  },
  recPoster: {
    width: 100,
    height: 145,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    marginBottom: 6,
  },
  recTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1F2937',
    lineHeight: 16,
  },
  recRating: {
    fontSize: 11,
    fontWeight: '700',
    color: '#D97706',
    marginTop: 2,
  },
});
