import React, { useState, useMemo, useCallback } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  FlatList, 
  TouchableOpacity, 
  ActivityIndicator, 
  Image, 
  Modal, 
  ScrollView 
} from 'react-native';
import { useMediaList, MediaListItem } from '../hooks/useMediaList';
import { useSyncStore } from '../store/useSyncStore';
import { useAuthStore } from '../store/useAuthStore';
import { Link, useFocusEffect, router } from 'expo-router';
import { MediaCategory } from '../database/schema';
import { getMediaAirStatusInfo } from '../services/tmdb';

export default function MainScreen() {
  const { data, loading, loadMedia } = useMediaList();
  const { isSyncing, runSync, lastSyncedAt } = useSyncStore();
  const { signOut, user } = useAuthStore();
  const [selectedCategory, setSelectedCategory] = useState<MediaCategory>('all');
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);

  // Reload media whenever screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadMedia();
    }, [loadMedia])
  );

  const handleSync = () => {
    runSync().then(() => loadMedia());
  };

  const counts = useMemo(() => {
    let movies = 0;
    let tv = 0;
    let anime = 0;
    data.forEach((item) => {
      if (item.is_anime) {
        anime++;
      } else if (item.media_type === 'movie') {
        movies++;
      } else if (item.media_type === 'tv') {
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

  const filteredData = useMemo(() => {
    if (selectedCategory === 'all') return data;
    if (selectedCategory === 'anime') return data.filter((item) => Boolean(item.is_anime));
    if (selectedCategory === 'movie') return data.filter((item) => item.media_type === 'movie' && !item.is_anime);
    if (selectedCategory === 'tv') return data.filter((item) => item.media_type === 'tv' && !item.is_anime);
    return data;
  }, [data, selectedCategory]);

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

  const overallProgress = useMemo(() => {
    let totalEps = 0;
    let watchedEps = 0;
    filteredData.forEach((item) => {
      if (item.media_type === 'tv') {
        totalEps += (item.episode_count || 0);
        watchedEps += (item.watched_episodes_count || 0);
      }
    });
    const percent = totalEps > 0 ? Math.round((watchedEps / totalEps) * 100) : 0;
    return { totalEps, watchedEps, percent };
  }, [filteredData]);

  // Schedule for upcoming episodes in the user's watchlist
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

    return items.sort((a, b) => a.diffDays - b.diffDays);
  }, [data]);

  // Statistics calculation: life time spent watching
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
          totalMinutes += 110; // average 110 min per film
        }
      } else {
        const watched = item.watched_episodes_count || 0;
        totalWatchedEpisodes += watched;
        if (item.is_anime) {
          totalAnimeEpisodes += watched;
          totalMinutes += watched * 24; // 24 min per anime ep
        } else {
          totalTvEpisodes += watched;
          totalMinutes += watched * 45; // 45 min per TV ep
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
      days,
      hours,
      minutes,
      formattedTime,
      totalWatchedEpisodes,
      totalMoviesCompleted,
      totalAnimeEpisodes,
      totalTvEpisodes,
      ratedCount,
      averageRating,
    };
  }, [data]);

  const renderItem = ({ item }: { item: MediaListItem }) => {
    const imageUrl = item.poster_path 
      ? `https://image.tmdb.org/t/p/w200${item.poster_path}` 
      : null;

    const isAnime = Boolean(item.is_anime);
    const categoryBadgeText = isAnime ? '🎌 ANIME' : item.media_type === 'movie' ? '🎬 FILME' : '📺 SÉRIE';
    const categoryBadgeStyle = isAnime ? styles.badgeAnime : item.media_type === 'movie' ? styles.badgeMovie : styles.badgeTv;
    const year = item.release_date ? item.release_date.substring(0, 4) : null;

    // Progress metrics
    const totalEpisodes = item.episode_count || 0;
    const watchedEpisodes = item.watched_episodes_count || 0;
    const progressPercent = totalEpisodes > 0 
      ? Math.min(100, Math.round((watchedEpisodes / totalEpisodes) * 100)) 
      : 0;

    const statusInfo = getStatusInfo(item.status);
    const airStatusInfo = getMediaAirStatusInfo(item);

    return (
      <Link href={`/details/${item.media_type}/${item.tmdb_id}`} asChild>
        <TouchableOpacity style={styles.card} activeOpacity={0.7}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.poster} />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]}>
              <Text style={styles.posterPlaceholderText}>Sem Imagem</Text>
            </View>
          )}
          <View style={styles.cardInfo}>
            <View style={styles.badgesRow}>
              <View style={[styles.badge, categoryBadgeStyle]}>
                <Text style={styles.badgeText}>{categoryBadgeText}</Text>
              </View>
              <View style={[styles.badge, statusInfo.badgeStyle]}>
                <Text style={[styles.statusBadgeText, statusInfo.textStyle]}>{statusInfo.text}</Text>
              </View>
              {item.user_rating ? (
                <View style={[styles.badge, styles.badgeUserRating]}>
                  <Text style={styles.badgeUserRatingText}>★ {item.user_rating}/10</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.title} numberOfLines={2}>
              {item.title || `TMDB ID: ${item.tmdb_id}`}
            </Text>

            <View style={styles.metaRow}>
              {year && <Text style={styles.metaItem}>📅 {year}</Text>}
              {item.vote_average ? (
                <Text style={styles.metaItem}>⭐ {item.vote_average.toFixed(1)}</Text>
              ) : null}
              {item.season_count && item.season_count > 0 ? (
                <Text style={styles.metaItem}>📺 {item.season_count} temp.</Text>
              ) : null}
            </View>

            {item.user_notes ? (
              <View style={styles.userNotesPreview}>
                <Text style={styles.userNotesPreviewText} numberOfLines={1}>
                  📝 {item.user_notes}
                </Text>
              </View>
            ) : null}

            {/* Air status tag: e.g. Finalizado, Próximo ep, or Em exibição */}
            {airStatusInfo && (
              <View style={[
                styles.cardAirStatus,
                airStatusInfo.badgeStyle === 'ended' && styles.cardAirStatusEnded,
                airStatusInfo.badgeStyle === 'scheduled' && styles.cardAirStatusScheduled,
                airStatusInfo.badgeStyle === 'ongoing' && styles.cardAirStatusOngoing,
              ]}>
                <Text style={styles.cardAirStatusIcon}>{airStatusInfo.icon}</Text>
                <Text 
                  style={[
                    styles.cardAirStatusText,
                    airStatusInfo.badgeStyle === 'ended' && styles.cardAirStatusTextEnded,
                    airStatusInfo.badgeStyle === 'scheduled' && styles.cardAirStatusTextScheduled,
                    airStatusInfo.badgeStyle === 'ongoing' && styles.cardAirStatusTextOngoing,
                  ]}
                  numberOfLines={1}
                >
                  {airStatusInfo.label}
                </Text>
              </View>
            )}

            {/* Episode progress bar for Series / Anime */}
            {item.media_type === 'tv' && (
              <View style={styles.cardProgressContainer}>
                <View style={styles.cardProgressHeader}>
                  <Text style={styles.cardProgressLabel}>
                    Progresso: <Text style={styles.cardProgressValue}>{watchedEpisodes}</Text>
                    {totalEpisodes > 0 ? `/${totalEpisodes} eps` : ' eps assistidos'}
                  </Text>
                  {totalEpisodes > 0 && (
                    <Text style={[
                      styles.cardProgressPercent, 
                      progressPercent === 100 && styles.cardProgressPercentDone
                    ]}>
                      {progressPercent === 100 ? '✓ 100%' : `${progressPercent}%`}
                    </Text>
                  )}
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
            )}

            {item.sync_pending === 1 && (
              <Text style={styles.pendingBadge}>⏳ Sincronização Pendente</Text>
            )}
          </View>
        </TouchableOpacity>
      </Link>
    );
  };

  const categoriesList: { key: MediaCategory; label: string; count: number }[] = [
    { key: 'all', label: 'Todos', count: counts.all },
    { key: 'movie', label: 'Filmes', count: counts.movie },
    { key: 'tv', label: 'Séries', count: counts.tv },
    { key: 'anime', label: 'Animes', count: counts.anime },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Minha Lista</Text>
          <Text style={styles.headerUser}>{user?.email}</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={signOut}>
          <Text style={styles.logoutText}>Sair</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.syncRow}>
        <TouchableOpacity style={styles.syncButton} onPress={handleSync} disabled={isSyncing}>
          <Text style={styles.syncButtonText}>
            {isSyncing ? 'Sincronizando...' : '🔄 Sincronizar'}
          </Text>
        </TouchableOpacity>
        {lastSyncedAt && (
          <Text style={styles.syncDate}>
            Último sync: {new Date(lastSyncedAt).toLocaleTimeString()}
          </Text>
        )}
      </View>

      <Link href="/search" asChild>
        <TouchableOpacity style={styles.addButton}>
          <Text style={styles.addButtonText}>🔍 Buscar Filmes, Séries e Animes</Text>
        </TouchableOpacity>
      </Link>

      {/* Quick Action Toolbar: Agenda & Estatísticas */}
      <View style={styles.quickActionsRow}>
        <TouchableOpacity 
          style={styles.quickActionButton} 
          onPress={() => setShowScheduleModal(true)}
          activeOpacity={0.7}
        >
          <View style={styles.quickActionIconWrapper}>
            <Text style={styles.quickActionIcon}>📅</Text>
          </View>
          <View style={styles.quickActionContent}>
            <Text style={styles.quickActionTitle}>Agenda</Text>
            <Text style={styles.quickActionSubtitle}>
              {upcomingSchedule.length > 0 
                ? `${upcomingSchedule.length} ${upcomingSchedule.length === 1 ? 'lançamento' : 'lançamentos'}` 
                : 'Ver calendário'}
            </Text>
          </View>
          {upcomingSchedule.length > 0 && (
            <View style={styles.quickActionBadge}>
              <Text style={styles.quickActionBadgeText}>{upcomingSchedule.length}</Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.quickActionButton, styles.quickActionButtonStats]} 
          onPress={() => setShowStatsModal(true)}
          activeOpacity={0.7}
        >
          <View style={[styles.quickActionIconWrapper, styles.quickActionIconWrapperStats]}>
            <Text style={styles.quickActionIcon}>📊</Text>
          </View>
          <View style={styles.quickActionContent}>
            <Text style={styles.quickActionTitle}>Estatísticas</Text>
            <Text style={styles.quickActionSubtitle}>
              {statsData.totalMinutes > 0 ? statsData.formattedTime : '0h assistidas'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Category Tabs */}
      <View style={styles.categoriesContainer}>
        {categoriesList.map((cat) => {
          const isActive = selectedCategory === cat.key;
          return (
            <TouchableOpacity
              key={cat.key}
              style={[styles.categoryTab, isActive && styles.categoryTabActive]}
              onPress={() => setSelectedCategory(cat.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.categoryTabText, isActive && styles.categoryTabTextActive]}>
                {cat.label}
              </Text>
              <View style={[styles.categoryCountBadge, isActive && styles.categoryCountBadgeActive]}>
                <Text style={[styles.categoryCountText, isActive && styles.categoryCountTextActive]}>
                  {cat.count}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Global Collection Progress Banner */}
      {selectedCategory !== 'movie' && overallProgress.totalEps > 0 && (
        <View style={styles.overallStatsBanner}>
          <View style={styles.overallStatsHeader}>
            <Text style={styles.overallStatsTitle}>
              📊 Progresso {selectedCategory === 'anime' ? 'dos Animes' : selectedCategory === 'tv' ? 'das Séries' : 'Geral'}
            </Text>
            <Text style={styles.overallStatsPercent}>{overallProgress.percent}%</Text>
          </View>
          <View style={styles.overallProgressTrack}>
            <View style={[styles.overallProgressFill, { width: `${overallProgress.percent}%` }]} />
          </View>
          <Text style={styles.overallStatsSubtitle}>
            {overallProgress.watchedEps} de {overallProgress.totalEps} episódios assistidos
          </Text>
        </View>
      )}

      {loading && data.length === 0 ? (
        <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
      ) : (
        <FlatList
          data={filteredData}
          keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`}
          renderItem={renderItem}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {selectedCategory === 'all'
                  ? 'Nenhuma mídia na sua lista.'
                  : `Nenhum item encontrado na categoria "${categoriesList.find(c => c.key === selectedCategory)?.label}".`}
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContainer}
        />
      )}

      {/* Schedule Modal */}
      <Modal
        visible={showScheduleModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowScheduleModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>📅 Agenda de Lançamentos</Text>
                <Text style={styles.modalSubtitle}>Próximos episódios das suas séries e animes</Text>
              </View>
              <TouchableOpacity 
                style={styles.modalCloseButton} 
                onPress={() => setShowScheduleModal(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {upcomingSchedule.length === 0 ? (
              <View style={styles.modalEmptyState}>
                <Text style={styles.modalEmptyIcon}>🗓️</Text>
                <Text style={styles.modalEmptyTitle}>Nenhum episódio agendado</Text>
                <Text style={styles.modalEmptySubtitle}>
                  Quando suas séries e animes em andamento tiverem datas confirmadas de novos episódios, eles aparecerão aqui com contagem regressiva!
                </Text>
              </View>
            ) : (
              <FlatList
                data={upcomingSchedule}
                keyExtractor={(item) => `${item.item.media_type}-${item.item.tmdb_id}`}
                contentContainerStyle={styles.scheduleList}
                renderItem={({ item }) => {
                  const media = item.item;
                  const posterUrl = media.poster_path 
                    ? `https://image.tmdb.org/t/p/w200${media.poster_path}` 
                    : null;
                  const isAnime = Boolean(media.is_anime);

                  return (
                    <TouchableOpacity
                      style={styles.scheduleCard}
                      activeOpacity={0.7}
                      onPress={() => {
                        setShowScheduleModal(false);
                        router.push(`/details/${media.media_type}/${media.tmdb_id}`);
                      }}
                    >
                      {posterUrl ? (
                        <Image source={{ uri: posterUrl }} style={styles.schedulePoster} />
                      ) : (
                        <View style={[styles.schedulePoster, styles.schedulePosterPlaceholder]}>
                          <Text style={styles.schedulePosterPlaceholderText}>Sem Img</Text>
                        </View>
                      )}

                      <View style={styles.scheduleInfo}>
                        <View style={styles.scheduleTopRow}>
                          <View style={[styles.badge, isAnime ? styles.badgeAnime : styles.badgeTv]}>
                            <Text style={styles.badgeText}>{isAnime ? '🎌 ANIME' : '📺 SÉRIE'}</Text>
                          </View>
                          <View style={[
                            styles.scheduleCountdownBadge,
                            item.diffDays === 0 && styles.countdownToday,
                            item.diffDays === 1 && styles.countdownTomorrow,
                          ]}>
                            <Text style={[
                              styles.scheduleCountdownText,
                              item.diffDays === 0 && styles.countdownTodayText,
                              item.diffDays === 1 && styles.countdownTomorrowText,
                            ]}>
                              {item.badgeText}
                            </Text>
                          </View>
                        </View>

                        <Text style={styles.scheduleMediaTitle} numberOfLines={2}>
                          {media.title}
                        </Text>

                        {media.next_episode_info ? (
                          <Text style={styles.scheduleEpisodeInfo}>
                            {media.next_episode_info}
                          </Text>
                        ) : null}

                        <Text style={styles.scheduleDateText}>
                          🗓️ Exibição: <Text style={styles.scheduleDateHighlight}>{item.dateStr}</Text>
                        </Text>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Stats Modal */}
      <Modal
        visible={showStatsModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowStatsModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>📊 Minhas Estatísticas</Text>
                <Text style={styles.modalSubtitle}>Tempo de vida dedicado aos seus títulos</Text>
              </View>
              <TouchableOpacity 
                style={styles.modalCloseButton} 
                onPress={() => setShowStatsModal(false)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.statsScrollContent}>
              {/* Highlight Hero Card */}
              <View style={styles.statsHeroCard}>
                <Text style={styles.statsHeroIcon}>⏳</Text>
                <Text style={styles.statsHeroTitle}>Tempo Total Assistindo</Text>
                <View style={styles.statsHeroNumbersRow}>
                  {statsData.days > 0 && (
                    <View style={styles.statsHeroUnitBlock}>
                      <Text style={styles.statsHeroLargeNumber}>{statsData.days}</Text>
                      <Text style={styles.statsHeroUnitLabel}>DIAS</Text>
                    </View>
                  )}
                  <View style={styles.statsHeroUnitBlock}>
                    <Text style={styles.statsHeroLargeNumber}>{statsData.hours}</Text>
                    <Text style={styles.statsHeroUnitLabel}>HORAS</Text>
                  </View>
                  <View style={styles.statsHeroUnitBlock}>
                    <Text style={styles.statsHeroLargeNumber}>{statsData.minutes}</Text>
                    <Text style={styles.statsHeroUnitLabel}>MINUTOS</Text>
                  </View>
                </View>
                <Text style={styles.statsHeroDesc}>
                  Calculado a partir de filmes concluídos e episódios marcados como assistidos.
                </Text>
              </View>

              {/* Grid of Metrics */}
              <View style={styles.statsGrid}>
                <View style={styles.statsGridCard}>
                  <Text style={styles.statsGridIcon}>🎬</Text>
                  <Text style={styles.statsGridValue}>{statsData.totalMoviesCompleted}</Text>
                  <Text style={styles.statsGridLabel}>Filmes Concluídos</Text>
                </View>

                <View style={styles.statsGridCard}>
                  <Text style={styles.statsGridIcon}>📺</Text>
                  <Text style={styles.statsGridValue}>{statsData.totalTvEpisodes}</Text>
                  <Text style={styles.statsGridLabel}>Eps de Séries</Text>
                </View>

                <View style={styles.statsGridCard}>
                  <Text style={styles.statsGridIcon}>🎌</Text>
                  <Text style={styles.statsGridValue}>{statsData.totalAnimeEpisodes}</Text>
                  <Text style={styles.statsGridLabel}>Eps de Animes</Text>
                </View>

                <View style={styles.statsGridCard}>
                  <Text style={styles.statsGridIcon}>⭐</Text>
                  <Text style={styles.statsGridValue}>
                    {statsData.averageRating ? `${statsData.averageRating}` : '-'}
                  </Text>
                  <Text style={styles.statsGridLabel}>
                    {statsData.ratedCount > 0 ? `Nota Média (${statsData.ratedCount})` : 'Sem Notas'}
                  </Text>
                </View>
              </View>

              {/* Summary Breakdown Card */}
              <View style={styles.statsBreakdownCard}>
                <Text style={styles.statsBreakdownTitle}>📦 Resumo da Coleção</Text>
                
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Total de títulos na lista</Text>
                  <Text style={styles.breakdownValue}>{data.length}</Text>
                </View>
                <View style={styles.breakdownDivider} />

                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Total de episódios assistidos</Text>
                  <Text style={styles.breakdownValue}>{statsData.totalWatchedEpisodes}</Text>
                </View>
                <View style={styles.breakdownDivider} />

                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Títulos com notas pessoais</Text>
                  <Text style={styles.breakdownValue}>{statsData.ratedCount} de {data.length}</Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f6f7fb',
  },
  header: {
    padding: 20,
    paddingTop: 56,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  headerUser: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  logoutButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#fff0f0',
  },
  logoutText: {
    color: '#FF3B30',
    fontWeight: '600',
    fontSize: 13,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    justifyContent: 'space-between',
  },
  syncButton: {
    backgroundColor: '#34C759',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  syncButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  syncDate: {
    fontSize: 11,
    color: '#888',
  },
  addButton: {
    backgroundColor: '#007AFF',
    marginHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
    shadowColor: '#007AFF',
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  categoriesContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 10,
    gap: 8,
  },
  categoryTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e5eb',
  },
  categoryTabActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  categoryTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555',
    marginRight: 4,
  },
  categoryTabTextActive: {
    color: '#fff',
  },
  categoryCountBadge: {
    backgroundColor: '#edf0f5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  categoryCountBadgeActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  categoryCountText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#666',
  },
  categoryCountTextActive: {
    color: '#fff',
  },
  loader: {
    marginTop: 40,
  },
  listContainer: {
    padding: 16,
    paddingTop: 4,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 12,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
    overflow: 'hidden',
  },
  poster: {
    width: 95,
    minHeight: 140,
    backgroundColor: '#e5e5e5',
  },
  posterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  posterPlaceholderText: {
    fontSize: 11,
    color: '#999',
  },
  cardInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  statusBadge: {
    backgroundColor: '#f0f0f0',
  },
  statusBadgeWatching: {
    backgroundColor: '#007AFF16',
    borderWidth: 1,
    borderColor: '#007AFF35',
  },
  statusBadgeCompleted: {
    backgroundColor: '#34C75916',
    borderWidth: 1,
    borderColor: '#34C75935',
  },
  statusBadgePlan: {
    backgroundColor: '#FF950016',
    borderWidth: 1,
    borderColor: '#FF950035',
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#666',
  },
  statusTextWatching: {
    color: '#0066cc',
    fontWeight: '700',
  },
  statusTextCompleted: {
    color: '#248a3d',
    fontWeight: '700',
  },
  statusTextPlan: {
    color: '#b26b00',
    fontWeight: '700',
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
  metaItem: {
    fontSize: 11,
    color: '#777',
    fontWeight: '500',
  },
  cardAirStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    marginVertical: 3,
    alignSelf: 'flex-start',
    backgroundColor: '#f1f5f9',
  },
  cardAirStatusEnded: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  cardAirStatusScheduled: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  cardAirStatusOngoing: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  cardAirStatusIcon: {
    fontSize: 10,
    marginRight: 4,
  },
  cardAirStatusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#334155',
  },
  cardAirStatusTextEnded: {
    color: '#047857',
  },
  cardAirStatusTextScheduled: {
    color: '#1d4ed8',
  },
  cardAirStatusTextOngoing: {
    color: '#b45309',
  },
  cardProgressContainer: {
    marginTop: 5,
    marginBottom: 2,
    backgroundColor: '#f8fafc',
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#edf2f7',
  },
  cardProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardProgressLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '500',
  },
  cardProgressValue: {
    fontWeight: 'bold',
    color: '#1e293b',
  },
  cardProgressPercent: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  cardProgressPercentDone: {
    color: '#34C759',
  },
  cardProgressBarTrack: {
    height: 5,
    backgroundColor: '#e2e8f0',
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
    backgroundColor: '#AF52DE',
  },
  cardProgressBarFillDone: {
    backgroundColor: '#34C759',
  },
  overallStatsBanner: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e8edf5',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  overallStatsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  overallStatsTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  overallStatsPercent: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  overallProgressTrack: {
    height: 6,
    backgroundColor: '#e2e8f0',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 6,
  },
  overallProgressFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 3,
  },
  overallStatsSubtitle: {
    fontSize: 11,
    color: '#64748b',
  },
  overview: {
    color: '#555',
    fontSize: 12,
    lineHeight: 16,
  },
  pendingBadge: {
    marginTop: 6,
    color: '#FF9500',
    fontSize: 11,
    fontWeight: 'bold',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 60,
    paddingHorizontal: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 14,
  },
  badgeUserRating: {
    backgroundColor: '#FFF9C4',
    borderWidth: 1,
    borderColor: '#FBC02D55',
  },
  badgeUserRatingText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B78103',
  },
  userNotesPreview: {
    marginTop: 4,
    marginBottom: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: '#f1f5f9',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#007AFF',
  },
  userNotesPreviewText: {
    fontSize: 11,
    color: '#475569',
    fontStyle: 'italic',
  },
  quickActionsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    marginBottom: 10,
    gap: 10,
  },
  quickActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  quickActionButtonStats: {
    borderColor: '#e0e7ff',
  },
  quickActionIconWrapper: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#eff6ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  quickActionIconWrapperStats: {
    backgroundColor: '#f5f3ff',
  },
  quickActionIcon: {
    fontSize: 16,
  },
  quickActionContent: {
    flex: 1,
  },
  quickActionTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#1e293b',
  },
  quickActionSubtitle: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 1,
  },
  quickActionBadge: {
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 18,
    alignItems: 'center',
  },
  quickActionBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: 'bold',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    minHeight: '45%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderColor: '#f1f5f9',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  modalSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  modalCloseButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#64748b',
  },
  modalEmptyState: {
    alignItems: 'center',
    padding: 32,
    marginTop: 20,
  },
  modalEmptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  modalEmptyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#334155',
    marginBottom: 8,
  },
  modalEmptySubtitle: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 18,
  },
  scheduleList: {
    padding: 16,
  },
  scheduleCard: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
  },
  schedulePoster: {
    width: 75,
    minHeight: 105,
    backgroundColor: '#cbd5e1',
  },
  schedulePosterPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  schedulePosterPlaceholderText: {
    fontSize: 10,
    color: '#94a3b8',
  },
  scheduleInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  scheduleTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  scheduleCountdownBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
  },
  scheduleCountdownText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#2563eb',
  },
  countdownToday: {
    backgroundColor: '#fee2e2',
  },
  countdownTodayText: {
    color: '#dc2626',
  },
  countdownTomorrow: {
    backgroundColor: '#fef3c7',
  },
  countdownTomorrowText: {
    color: '#d97706',
  },
  scheduleMediaTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  scheduleEpisodeInfo: {
    fontSize: 12,
    color: '#0284c7',
    fontWeight: '600',
    marginBottom: 4,
  },
  scheduleDateText: {
    fontSize: 11,
    color: '#64748b',
  },
  scheduleDateHighlight: {
    fontWeight: '700',
    color: '#1e293b',
  },
  statsScrollContent: {
    padding: 20,
  },
  statsHeroCard: {
    backgroundColor: '#1e293b',
    borderRadius: 18,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  statsHeroIcon: {
    fontSize: 32,
    marginBottom: 4,
  },
  statsHeroTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  statsHeroNumbersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  statsHeroUnitBlock: {
    alignItems: 'center',
  },
  statsHeroLargeNumber: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  statsHeroUnitLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#38bdf8',
    marginTop: 1,
  },
  statsHeroDesc: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  statsGridCard: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  statsGridIcon: {
    fontSize: 22,
    marginBottom: 6,
  },
  statsGridValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 2,
  },
  statsGridLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  statsBreakdownCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statsBreakdownTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 12,
  },
  breakdownRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  breakdownLabel: {
    fontSize: 13,
    color: '#475569',
  },
  breakdownValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  breakdownDivider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 4,
  },
});
