import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  ScrollView, 
  Image, 
  ActivityIndicator, 
  TouchableOpacity, 
  Switch, 
  Modal, 
  Linking,
  Share,
  TextInput,
  Alert,
  Platform,
  StatusBar as RNStatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useFocusEffect, router } from 'expo-router';
import { 
  getMediaDetails, 
  getSeasonDetails, 
  findBestTrailer, 
  checkIfAnime,
  getMediaAirStatusInfo,
  getWatchProviders,
  WatchProvidersData,
  TMDBMediaDetail 
} from '../../../services/tmdb';
import { useMediaDetails } from '../../../hooks/useMediaDetails';
import { getDb } from '../../../database/useDatabase';
import { useMediaList } from '../../../hooks/useMediaList';

export default function DetailsScreen() {
  const { media_type, id } = useLocalSearchParams();
  const tmdb_id = parseInt(id as string, 10);
  
  const [details, setDetails] = useState<TMDBMediaDetail | null>(null);
  const [loading, setLoading] = useState(true);
  
  // For Season selection
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [seasonData, setSeasonData] = useState<any>(null);
  const [loadingSeason, setLoadingSeason] = useState(false);
  const [hideWatched, setHideWatched] = useState(false);
  const hasAutoSelectedSeasonRef = useRef(false);

  // For Episode detail modal
  const [selectedEpisodeForModal, setSelectedEpisodeForModal] = useState<any | null>(null);

  // For overall media status & reviews
  const [overallStatus, setOverallStatus] = useState<string | null>(null);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [userNotes, setUserNotes] = useState<string>('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSavedSuccess, setNotesSavedSuccess] = useState(false);

  // Watch providers in Brazil
  const [watchProviders, setWatchProviders] = useState<WatchProvidersData | null>(null);

  const { addOrUpdateMedia, updateUserReview, removeMedia } = useMediaList();
  const { episodes, loadEpisodes, toggleEpisode, toggleSeasonEpisodes } = useMediaDetails(tmdb_id);

  const insets = useSafeAreaInsets();
  const statusBarHeight = insets.top > 0
    ? insets.top
    : (Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) : 0);
  const backButtonTop = statusBarHeight > 0 ? statusBarHeight + 10 : 16;

  const loadLocalStatusAndReview = useCallback(async () => {
    if (!tmdb_id || isNaN(tmdb_id) || !media_type) return;
    try {
      const db = await getDb();
      const localItem = await db.getFirstAsync<{ status: string; user_rating?: number | null; user_notes?: string | null }>(
        'SELECT status, user_rating, user_notes FROM sync_queue WHERE tmdb_id = $tmdb_id AND media_type = $media_type',
        { $tmdb_id: Number(tmdb_id), $media_type: String(media_type) }
      );
      if (localItem) {
        setOverallStatus(localItem.status);
        setUserRating(localItem.user_rating ?? null);
        setUserNotes(localItem.user_notes ?? '');
      }
    } catch (e) {
      console.error('Error loading local status and review:', e);
    }
  }, [tmdb_id, media_type]);

  useFocusEffect(
    useCallback(() => {
      loadLocalStatusAndReview();
    }, [loadLocalStatusAndReview])
  );

  // Initial Data Load
  useEffect(() => {
    if (!tmdb_id || isNaN(tmdb_id) || !media_type) return;

    const fetchInitialData = async () => {
      try {
        const [tmdbData, providersData] = await Promise.all([
          getMediaDetails(media_type as 'movie' | 'tv', tmdb_id),
          getWatchProviders(media_type as 'movie' | 'tv', tmdb_id),
        ]);
        setDetails(tmdbData);
        setWatchProviders(providersData);
        await loadLocalStatusAndReview();
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchInitialData();
    loadEpisodes();
  }, [media_type, tmdb_id, loadEpisodes, loadLocalStatusAndReview]);

  // Intelligence: Auto-select last watched season ONLY ONCE on initial load
  useEffect(() => {
    if (hasAutoSelectedSeasonRef.current) return;

    if (episodes.length > 0 && details?.seasons) {
      // Find the highest watched episode
      const watchedEps = episodes.filter(e => Boolean(e.watched));
      if (watchedEps.length > 0) {
        // Sort by season descending, then episode descending
        watchedEps.sort((a, b) => {
          if (b.season_number !== a.season_number) return b.season_number - a.season_number;
          return b.episode_number - a.episode_number;
        });
        
        const lastWatchedSeason = watchedEps[0].season_number;
        setTimeout(() => {
          setSelectedSeason(lastWatchedSeason);
        }, 0);
      }
      hasAutoSelectedSeasonRef.current = true;
    }
  }, [episodes, details]);

  // Fetch season specific details when selectedSeason changes
  useEffect(() => {
    if (media_type !== 'tv' || !tmdb_id || isNaN(tmdb_id)) return;

    const fetchSeason = async () => {
      setLoadingSeason(true);
      try {
        const data = await getSeasonDetails(tmdb_id, selectedSeason);
        setSeasonData(data);
      } catch (err) {
        console.error('Error fetching season details', err);
      } finally {
        setLoadingSeason(false);
      }
    };
    fetchSeason();
  }, [selectedSeason, tmdb_id, media_type]);

  const toggleMovieWatched = async () => {
    const newStatus = overallStatus === 'completed' ? 'watching' : 'completed';
    await addOrUpdateMedia(tmdb_id, 'movie', newStatus);
    setOverallStatus(newStatus);
  };

  const seasonEpisodes: any[] = useMemo(() => {
    return seasonData?.episodes || [];
  }, [seasonData]);

  const watchedEpisodesCountInSeason = useMemo(() => {
    return seasonEpisodes.filter((ep: any) =>
      Boolean(episodes.find(e => e.season_number === selectedSeason && e.episode_number === ep.episode_number)?.watched)
    ).length;
  }, [seasonEpisodes, episodes, selectedSeason]);

  const allSeasonEpisodesWatched = seasonEpisodes.length > 0 && watchedEpisodesCountInSeason === seasonEpisodes.length;

  const handleToggleSeason = async () => {
    if (seasonEpisodes.length === 0) return;
    const epNumbers = seasonEpisodes.map((ep: any) => ep.episode_number);
    const nextWatched = !allSeasonEpisodesWatched;
    await toggleSeasonEpisodes(selectedSeason, epNumbers, nextWatched);
    if (nextWatched && overallStatus === 'plan_to_watch') {
      setOverallStatus('watching');
    }
  };

  const isAnime = details ? checkIfAnime(details) : false;
  const totalShowEpisodes = useMemo(() => {
    return details?.number_of_episodes || details?.seasons?.reduce((acc, s) => s.season_number > 0 ? acc + (s.episode_count || 0) : acc, 0) || 0;
  }, [details]);

  const totalWatchedEpisodes = useMemo(() => {
    return episodes.filter(e => Boolean(e.watched)).length;
  }, [episodes]);

  const totalProgressPercent = totalShowEpisodes > 0 
    ? Math.min(100, Math.round((totalWatchedEpisodes / totalShowEpisodes) * 100)) 
    : 0;

  const airStatusInfo = details ? getMediaAirStatusInfo({
    media_type: media_type as string,
    is_anime: isAnime,
    air_status: details.status,
    next_air_date: details.next_episode_to_air?.air_date,
    next_episode_info: details.next_episode_to_air ? `T${details.next_episode_to_air.season_number} E${details.next_episode_to_air.episode_number}` : null,
    release_date: details.release_date || details.first_air_date,
  }) : null;

  if (loading || !details) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  const title = details.title || details.name;
  const imageUrl = details.poster_path 
    ? `https://image.tmdb.org/t/p/w500${details.poster_path}` 
    : null;

  const validSeasons = details.seasons?.filter(s => s.season_number > 0) || [];
  const trailerKey = details ? findBestTrailer(details.videos?.results || []) : null;

  const handleOpenTrailer = () => {
    if (!trailerKey) return;
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

  const handleSetRating = async (rating: number) => {
    const nextRating = userRating === rating ? null : rating;
    setUserRating(nextRating);
    try {
      await updateUserReview(tmdb_id, media_type as 'movie' | 'tv', nextRating, userNotes);
    } catch (e) {
      console.error('Failed to update rating:', e);
    }
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await updateUserReview(tmdb_id, media_type as 'movie' | 'tv', userRating, userNotes);
      setNotesSavedSuccess(true);
      setTimeout(() => setNotesSavedSuccess(false), 2500);
    } catch (e) {
      console.error('Failed to update notes:', e);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleShareMedia = async () => {
    if (!details) return;
    try {
      const flatrate = watchProviders?.flatrate?.map(p => p.provider_name).join(', ');
      let text = `🍿 ${title}\n`;
      text += isAnime ? '🎌 Anime' : media_type === 'movie' ? '🎬 Filme' : '📺 Série';
      if (userRating) text += `\n⭐ Minha Nota: ${userRating}/10`;
      if (media_type === 'tv' && totalShowEpisodes > 0) {
        text += `\n📺 Progresso: ${totalWatchedEpisodes}/${totalShowEpisodes} episódios (${totalProgressPercent}%)`;
      }
      if (flatrate) {
        text += `\n📡 Onde Assistir: ${flatrate}`;
      }
      text += `\n\nAcompanhado pelo app ListaAFS!`;

      await Share.share({
        title: title || 'ListaAFS',
        message: text,
      });
    } catch (err) {
      console.error('Error sharing:', err);
    }
  };

  const handleRemoveFromList = () => {
    Alert.alert(
      'Remover da Lista',
      `Tem certeza que deseja remover "${title || 'este título'}" da sua lista?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Remover',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeMedia(tmdb_id, media_type as 'movie' | 'tv');
              router.back();
            } catch {
              Alert.alert('Erro', 'Não foi possível remover da lista.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.screenWrapper}>
      <TouchableOpacity
        style={[styles.floatingBackButton, { top: backButtonTop }]}
        onPress={() => router.back()}
        activeOpacity={0.8}
        accessibilityLabel="Voltar"
      >
        <Text style={styles.floatingBackButtonText}>‹ Voltar</Text>
      </TouchableOpacity>

      <ScrollView style={styles.container}>
        <Stack.Screen options={{ title: title || 'Detalhes', headerBackTitle: 'Voltar' }} />
        
        {imageUrl && <Image source={{ uri: imageUrl }} style={styles.poster} />}
        
        <View style={styles.info}>
          <Text style={styles.title}>{title}</Text>

          {/* Header Badges: Category & Watch Status */}
          <View style={styles.headerBadgesRow}>
            <View style={[styles.badge, isAnime ? styles.badgeAnime : media_type === 'movie' ? styles.badgeMovie : styles.badgeTv]}>
              <Text style={styles.badgeText}>{isAnime ? '🎌 ANIME' : media_type === 'movie' ? '🎬 FILME' : '📺 SÉRIE'}</Text>
            </View>
            {overallStatus && (
              <View style={[
                styles.badge, 
                overallStatus === 'watching' ? styles.statusBadgeWatching : overallStatus === 'completed' ? styles.statusBadgeCompleted : styles.statusBadgePlan
              ]}>
                <Text style={[
                  styles.statusBadgeText,
                  overallStatus === 'watching' ? styles.statusTextWatching : overallStatus === 'completed' ? styles.statusTextCompleted : styles.statusTextPlan
                ]}>
                  {overallStatus === 'watching' ? '▶ Assistindo' : overallStatus === 'completed' ? '✓ Concluído' : '🔖 Quero Assistir'}
                </Text>
              </View>
            )}
          </View>

          {/* Air Status / Next Episode Banner */}
          {airStatusInfo && (
            <View style={[
              styles.detailsAirStatus,
              airStatusInfo.badgeStyle === 'ended' && styles.detailsAirStatusEnded,
              airStatusInfo.badgeStyle === 'scheduled' && styles.detailsAirStatusScheduled,
              airStatusInfo.badgeStyle === 'ongoing' && styles.detailsAirStatusOngoing,
            ]}>
              <Text style={styles.detailsAirStatusIcon}>{airStatusInfo.icon}</Text>
              <Text style={[
                styles.detailsAirStatusText,
                airStatusInfo.badgeStyle === 'ended' && styles.detailsAirStatusTextEnded,
                airStatusInfo.badgeStyle === 'scheduled' && styles.detailsAirStatusTextScheduled,
                airStatusInfo.badgeStyle === 'ongoing' && styles.detailsAirStatusTextOngoing,
              ]}>
                {airStatusInfo.label}
              </Text>
            </View>
          )}

          {/* Overall Series / Anime Progress Card */}
          {media_type === 'tv' && (
            <View style={styles.overallSeriesProgressCard}>
              <View style={styles.overallSeriesProgressHeader}>
                <Text style={styles.overallSeriesProgressTitle}>Progresso Total</Text>
                <Text style={[styles.overallSeriesProgressPercent, totalProgressPercent === 100 && styles.overallSeriesProgressPercentDone]}>
                  {totalProgressPercent === 100 ? '✓ 100%' : `${totalProgressPercent}%`}
                </Text>
              </View>
              <View style={styles.overallSeriesProgressTrack}>
                <View 
                  style={[
                    styles.overallSeriesProgressFill, 
                    { width: `${totalProgressPercent}%` },
                    totalProgressPercent === 100 
                      ? styles.overallSeriesProgressFillDone 
                      : (isAnime ? styles.overallSeriesProgressFillAnime : styles.overallSeriesProgressFillTv)
                  ]} 
                />
              </View>
              <Text style={styles.overallSeriesProgressSub}>
                {totalWatchedEpisodes} de {totalShowEpisodes > 0 ? totalShowEpisodes : '?'} episódios assistidos
              </Text>
            </View>
          )}

          <Text style={styles.overview}>{details.overview || 'Sem sinopse disponível.'}</Text>

          {/* Watch Providers Section (Onde Assistir no Brasil) */}
          <View style={styles.providersCard}>
            <View style={styles.providersHeaderRow}>
              <Text style={styles.providersCardTitle}>📡 Onde Assistir no Brasil</Text>
              {watchProviders?.link && (
                <TouchableOpacity onPress={() => Linking.openURL(watchProviders.link!)}>
                  <Text style={styles.justWatchLink}>Ver opções ↗</Text>
                </TouchableOpacity>
              )}
            </View>

            {watchProviders?.flatrate && watchProviders.flatrate.length > 0 ? (
              <View style={styles.providersSubSection}>
                <Text style={styles.providersSubLabel}>Streaming por Assinatura:</Text>
                <View style={styles.providersGrid}>
                  {watchProviders.flatrate.map((prov) => (
                    <View key={prov.provider_id} style={styles.providerItem}>
                      <Image 
                        source={{ uri: `https://image.tmdb.org/t/p/w92${prov.logo_path}` }} 
                        style={styles.providerLogo} 
                      />
                      <Text style={styles.providerName} numberOfLines={1}>{prov.provider_name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : watchProviders?.free && watchProviders.free.length > 0 ? (
              <View style={styles.providersSubSection}>
                <Text style={styles.providersSubLabel}>Gratuito com Anúncios:</Text>
                <View style={styles.providersGrid}>
                  {watchProviders.free.map((prov) => (
                    <View key={prov.provider_id} style={styles.providerItem}>
                      <Image 
                        source={{ uri: `https://image.tmdb.org/t/p/w92${prov.logo_path}` }} 
                        style={styles.providerLogo} 
                      />
                      <Text style={styles.providerName} numberOfLines={1}>{prov.provider_name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : watchProviders?.rent && watchProviders.rent.length > 0 ? (
              <View style={styles.providersSubSection}>
                <Text style={styles.providersSubLabel}>Aluguel Digital:</Text>
                <View style={styles.providersGrid}>
                  {watchProviders.rent.slice(0, 4).map((prov) => (
                    <View key={prov.provider_id} style={styles.providerItem}>
                      <Image 
                        source={{ uri: `https://image.tmdb.org/t/p/w92${prov.logo_path}` }} 
                        style={styles.providerLogo} 
                      />
                      <Text style={styles.providerName} numberOfLines={1}>{prov.provider_name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              <Text style={styles.noProvidersText}>
                Nenhum serviço de streaming oficial reportado no Brasil atualmente.
              </Text>
            )}
          </View>

          {/* User Review & Rating Card */}
          <View style={styles.userReviewCard}>
            <View style={styles.userReviewHeader}>
              <Text style={styles.userReviewTitle}>⭐ Minha Avaliação</Text>
              {userRating ? (
                <Text style={styles.userRatingBadge}>
                  {userRating}/10 {userRating >= 9 ? '🏆 Obra-prima' : userRating >= 7 ? '👍 Muito bom' : userRating >= 5 ? '👌 Regular' : '👎 Não curti'}
                </Text>
              ) : (
                <Text style={styles.userRatingHint}>Toque para avaliar</Text>
              )}
            </View>

            {/* 10 Stars selector */}
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((star) => {
                const isFilled = userRating != null && userRating >= star;
                return (
                  <TouchableOpacity
                    key={star}
                    style={styles.starTouchArea}
                    onPress={() => handleSetRating(star)}
                    hitSlop={{ top: 6, bottom: 6, left: 3, right: 3 }}
                  >
                    <Text style={[styles.starIcon, isFilled && styles.starIconFilled]}>
                      ★
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Notes field */}
            <View style={styles.notesSection}>
              <Text style={styles.notesLabel}>Minhas Anotações Privadas:</Text>
              <TextInput
                style={styles.notesInput}
                placeholder="Escreva seus pensamentos sobre esta obra..."
                placeholderTextColor="#999"
                value={userNotes}
                onChangeText={setUserNotes}
                multiline
                numberOfLines={3}
              />
              <View style={styles.notesActionRow}>
                {notesSavedSuccess && (
                  <Text style={styles.notesSavedMessage}>✓ Anotação salva com sucesso!</Text>
                )}
                <TouchableOpacity 
                  style={[styles.notesSaveBtn, savingNotes && styles.notesSaveBtnDisabled]}
                  onPress={handleSaveNotes}
                  disabled={savingNotes}
                >
                  <Text style={styles.notesSaveBtnText}>
                    {savingNotes ? 'Salvando...' : 'Salvar Anotação'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          
          {/* Action Buttons: Trailer & Native Share */}
          <View style={styles.actionButtonsRow}>
            {trailerKey && (
              <TouchableOpacity 
                style={styles.trailerActionBtn}
                onPress={handleOpenTrailer}
                activeOpacity={0.8}
              >
                <Text style={styles.trailerActionBtnText}>▶ Ver Trailer</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity 
              style={[styles.shareActionBtn, !trailerKey && { flex: 1 }]}
              onPress={handleShareMedia}
              activeOpacity={0.8}
            >
              <Text style={styles.shareActionBtnText}>📤 Compartilhar</Text>
            </TouchableOpacity>
          </View>

          {/* MOVIE ACTIONS */}
          {media_type === 'movie' && (
            <TouchableOpacity 
              style={[styles.movieBtn, overallStatus === 'completed' && styles.movieBtnWatched]}
              onPress={toggleMovieWatched}
            >
              <Text style={[styles.movieBtnText, overallStatus === 'completed' && styles.movieBtnTextWatched]}>
                {overallStatus === 'completed' ? '✓ Filme Assistido' : 'Marcar como Assistido'}
              </Text>
            </TouchableOpacity>
          )}

          {/* TV SHOW ACTIONS */}
          {media_type === 'tv' && validSeasons.length > 0 && (
            <View style={styles.seasonsSection}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Temporadas</Text>
                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Ocultar assistidos</Text>
                  <Switch 
                    value={hideWatched} 
                    onValueChange={setHideWatched} 
                    trackColor={{ false: '#ddd', true: '#34C759' }}
                  />
                </View>
              </View>
              
              {/* Season Selector (Chips) */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.seasonSelector}>
                {validSeasons.map(season => {
                  const isSelected = selectedSeason === season.season_number;
                  return (
                    <TouchableOpacity
                      key={season.id}
                      style={[styles.seasonChip, isSelected && styles.seasonChipActive]}
                      onPress={() => {
                        hasAutoSelectedSeasonRef.current = true;
                        setSelectedSeason(season.season_number);
                      }}
                    >
                      <Text style={[styles.seasonChipText, isSelected && styles.seasonChipTextActive]}>
                        Temporada {season.season_number}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              {/* Season Batch Action & Progress Bar */}
              {!loadingSeason && seasonEpisodes.length > 0 && (
                <View style={styles.seasonActionBar}>
                  <View style={styles.seasonProgressInfo}>
                    <Text style={styles.seasonProgressText}>
                      {watchedEpisodesCountInSeason} de {seasonEpisodes.length} assistidos
                    </Text>
                    {watchedEpisodesCountInSeason === seasonEpisodes.length && (
                      <Text style={styles.seasonCompletedBadge}>✓ Concluída</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.seasonBatchBtn,
                      allSeasonEpisodesWatched && styles.seasonBatchBtnWatched,
                    ]}
                    onPress={handleToggleSeason}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.seasonBatchBtnText,
                        allSeasonEpisodesWatched && styles.seasonBatchBtnTextWatched,
                      ]}
                    >
                      {allSeasonEpisodesWatched ? 'Desmarcar temporada' : 'Marcar temporada toda'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Episode List for Selected Season */}
              <View style={styles.episodesContainer}>
                {loadingSeason ? (
                  <ActivityIndicator size="small" color="#007AFF" style={{ marginTop: 20 }} />
                ) : (
                  seasonData?.episodes?.filter((ep: any) => {
                    if (!hideWatched) return true;
                    const isWatched = Boolean(
                      episodes.find(
                        e => e.season_number === selectedSeason && e.episode_number === ep.episode_number
                      )?.watched
                    );
                    return !isWatched;
                  }).map((ep: any) => {
                    const isWatched = Boolean(
                      episodes.find(
                        e => e.season_number === selectedSeason && e.episode_number === ep.episode_number
                      )?.watched
                    );

                    const epImage = ep.still_path ? `https://image.tmdb.org/t/p/w200${ep.still_path}` : null;

                    return (
                      <TouchableOpacity
                        key={ep.id}
                        style={[styles.episodeRow, isWatched && styles.episodeRowWatched]}
                        onPress={() => setSelectedEpisodeForModal(ep)}
                        activeOpacity={0.7}
                      >
                        {epImage ? (
                          <Image source={{ uri: epImage }} style={styles.episodeImage} />
                        ) : (
                          <View style={[styles.episodeImage, styles.episodeImagePlaceholder]}>
                            <Text style={styles.episodeImagePlaceholderText}>Ep {ep.episode_number}</Text>
                          </View>
                        )}
                        
                        <View style={styles.episodeInfo}>
                          <Text style={[styles.episodeTitle, isWatched && styles.episodeTextWatched]}>
                            {ep.episode_number}. {ep.name}
                          </Text>
                          <View style={styles.episodeMetaInline}>
                            {ep.air_date ? (
                              <Text style={[styles.episodeDate, isWatched && styles.episodeTextWatched]}>
                                📅 {ep.air_date}
                              </Text>
                            ) : null}
                            {ep.runtime ? (
                              <Text style={[styles.episodeRuntime, isWatched && styles.episodeTextWatched]}>
                                ⏱ {ep.runtime} min
                              </Text>
                            ) : null}
                          </View>
                          <Text style={[styles.episodeOverview, isWatched && styles.episodeTextWatched]} numberOfLines={2}>
                            {ep.overview || 'Toque no card para ver detalhes completos.'}
                          </Text>
                        </View>
                        
                        {/* Bolinha: clicar aqui marca como assistido */}
                        <TouchableOpacity
                          style={styles.checkboxTouchArea}
                          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                          activeOpacity={0.6}
                          onPress={(e) => {
                            e.stopPropagation?.();
                            const nextWatched = !isWatched;
                            toggleEpisode(selectedSeason, ep.episode_number, nextWatched);
                            if (nextWatched && overallStatus === 'plan_to_watch') {
                              setOverallStatus('watching');
                            }
                          }}
                        >
                          <View style={[styles.checkbox, isWatched && styles.checkboxChecked]}>
                            {isWatched && <Text style={styles.checkmark}>✓</Text>}
                          </View>
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>
          )}

          {/* Action to Remove from Watchlist */}
          {overallStatus && (
            <View style={styles.removeSection}>
              <TouchableOpacity
                style={styles.removeDetailsBtn}
                onPress={handleRemoveFromList}
                activeOpacity={0.8}
              >
                <Text style={styles.removeDetailsBtnText}>🗑️ Remover da Minha Lista</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Episode Details Modal */}
      {selectedEpisodeForModal && (() => {
        const isEpWatched = Boolean(
          episodes.find(
            e => e.season_number === selectedSeason && e.episode_number === selectedEpisodeForModal.episode_number
          )?.watched
        );
        const modalEpImage = selectedEpisodeForModal.still_path
          ? `https://image.tmdb.org/t/p/w500${selectedEpisodeForModal.still_path}`
          : null;

        return (
          <Modal
            visible={true}
            animationType="slide"
            transparent={true}
            onRequestClose={() => setSelectedEpisodeForModal(null)}
          >
            <View style={styles.modalOverlay}>
              <TouchableOpacity 
                style={styles.modalBackdrop} 
                activeOpacity={1} 
                onPress={() => setSelectedEpisodeForModal(null)} 
              />
              <View style={styles.modalSheet}>
                <View style={styles.modalHeader}>
                  <View style={styles.modalHeaderInfo}>
                    <Text style={styles.modalSeasonBadge}>
                      Temporada {selectedSeason} • Episódio {selectedEpisodeForModal.episode_number}
                    </Text>
                    <Text style={styles.modalTitle} numberOfLines={2}>
                      {selectedEpisodeForModal.name}
                    </Text>
                  </View>
                  <TouchableOpacity 
                    style={styles.modalCloseBtn}
                    onPress={() => setSelectedEpisodeForModal(null)}
                  >
                    <Text style={styles.modalCloseText}>✕</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                  {modalEpImage && (
                    <Image source={{ uri: modalEpImage }} style={styles.modalImage} />
                  )}

                  <View style={styles.modalStatsRow}>
                    {selectedEpisodeForModal.air_date ? (
                      <View style={styles.modalStatItem}>
                        <Text style={styles.modalStatLabel}>Lançamento</Text>
                        <Text style={styles.modalStatValue}>{selectedEpisodeForModal.air_date}</Text>
                      </View>
                    ) : null}
                    {selectedEpisodeForModal.runtime ? (
                      <View style={styles.modalStatItem}>
                        <Text style={styles.modalStatLabel}>Duração</Text>
                        <Text style={styles.modalStatValue}>{selectedEpisodeForModal.runtime} min</Text>
                      </View>
                    ) : null}
                    {selectedEpisodeForModal.vote_average ? (
                      <View style={styles.modalStatItem}>
                        <Text style={styles.modalStatLabel}>Avaliação</Text>
                        <Text style={styles.modalStatValue}>⭐ {selectedEpisodeForModal.vote_average.toFixed(1)}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={styles.modalSynopsisSection}>
                    <Text style={styles.modalSynopsisTitle}>Sinopse Completa</Text>
                    <Text style={styles.modalSynopsisText}>
                      {selectedEpisodeForModal.overview || 'Nenhuma sinopse disponível para este episódio.'}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.modalActionBtn,
                      isEpWatched ? styles.modalActionBtnWatched : styles.modalActionBtnUnwatched
                    ]}
                    onPress={() => {
                      const nextWatched = !isEpWatched;
                      toggleEpisode(selectedSeason, selectedEpisodeForModal.episode_number, nextWatched);
                      if (nextWatched && overallStatus === 'plan_to_watch') {
                        setOverallStatus('watching');
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={[
                      styles.modalActionBtnText,
                      isEpWatched && styles.modalActionBtnTextWatched
                    ]}>
                      {isEpWatched ? '✓ Marcado como Assistido (Toque para desmarcar)' : 'Marcar Episódio como Assistido'}
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </View>
          </Modal>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  floatingBackButton: {
    position: 'absolute',
    left: 16,
    zIndex: 99,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  floatingBackButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  screenWrapper: {
    flex: 1,
    backgroundColor: '#fff',
  },
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  poster: {
    width: '100%',
    height: 400,
    resizeMode: 'cover',
  },
  info: {
    padding: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#1a1a1a',
  },
  headerBadgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
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
    fontSize: 11,
    fontWeight: '700',
    color: '#333',
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
    fontSize: 11,
    fontWeight: '600',
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
  detailsAirStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 12,
    alignSelf: 'flex-start',
    backgroundColor: '#f1f5f9',
  },
  detailsAirStatusEnded: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  detailsAirStatusScheduled: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  detailsAirStatusOngoing: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  detailsAirStatusIcon: {
    fontSize: 12,
    marginRight: 6,
  },
  detailsAirStatusText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  detailsAirStatusTextEnded: {
    color: '#047857',
  },
  detailsAirStatusTextScheduled: {
    color: '#1d4ed8',
  },
  detailsAirStatusTextOngoing: {
    color: '#b45309',
  },
  overallSeriesProgressCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#edf2f7',
  },
  overallSeriesProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  overallSeriesProgressTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  overallSeriesProgressPercent: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#007AFF',
  },
  overallSeriesProgressPercentDone: {
    color: '#34C759',
  },
  overallSeriesProgressTrack: {
    height: 7,
    backgroundColor: '#e2e8f0',
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 6,
  },
  overallSeriesProgressFill: {
    height: '100%',
    borderRadius: 4,
  },
  overallSeriesProgressFillTv: {
    backgroundColor: '#007AFF',
  },
  overallSeriesProgressFillAnime: {
    backgroundColor: '#AF52DE',
  },
  overallSeriesProgressFillDone: {
    backgroundColor: '#34C759',
  },
  overallSeriesProgressSub: {
    fontSize: 11,
    color: '#64748b',
  },
  overview: {
    fontSize: 14,
    color: '#444',
    lineHeight: 22,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  trailerActionBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF0000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  trailerActionBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  shareActionBtn: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#007AFF',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  shareActionBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  providersCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  providersHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  providersCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  justWatchLink: {
    fontSize: 11,
    color: '#007AFF',
    fontWeight: '600',
  },
  providersSubSection: {
    marginBottom: 6,
  },
  providersSubLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginBottom: 6,
  },
  providersGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  providerItem: {
    alignItems: 'center',
    width: 55,
  },
  providerLogo: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: '#cbd5e1',
    marginBottom: 4,
  },
  providerName: {
    fontSize: 9,
    color: '#475569',
    textAlign: 'center',
    fontWeight: '500',
  },
  noProvidersText: {
    fontSize: 12,
    color: '#94a3b8',
    fontStyle: 'italic',
  },
  userReviewCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  userReviewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  userReviewTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  userRatingBadge: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#d97706',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  userRatingHint: {
    fontSize: 11,
    color: '#94a3b8',
  },
  starsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 2,
    marginBottom: 8,
  },
  starTouchArea: {
    padding: 2,
  },
  starIcon: {
    fontSize: 24,
    color: '#cbd5e1',
  },
  starIconFilled: {
    color: '#f59e0b',
  },
  notesSection: {
    marginTop: 4,
  },
  notesLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    marginBottom: 4,
  },
  notesInput: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    fontSize: 12,
    color: '#1e293b',
    minHeight: 60,
    textAlignVertical: 'top',
  },
  notesActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  notesSavedMessage: {
    fontSize: 11,
    color: '#16a34a',
    fontWeight: '600',
  },
  notesSaveBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    alignSelf: 'flex-end',
    marginLeft: 'auto',
  },
  notesSaveBtnDisabled: {
    opacity: 0.6,
  },
  notesSaveBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  movieBtn: {
    marginTop: 16,
    padding: 16,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  movieBtnWatched: {
    backgroundColor: '#34C759',
    borderColor: '#248A3D',
  },
  movieBtnText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  movieBtnTextWatched: {
    color: '#fff',
  },
  seasonsSection: {
    marginTop: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  switchLabel: {
    fontSize: 12,
    color: '#666',
    marginRight: 8,
  },
  seasonSelector: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  seasonChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 20,
    marginRight: 8,
  },
  seasonChipActive: {
    backgroundColor: '#007AFF',
  },
  seasonChipText: {
    color: '#333',
    fontWeight: '600',
  },
  seasonChipTextActive: {
    color: '#fff',
  },
  episodesContainer: {
    marginTop: 8,
  },
  episodeRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
    overflow: 'hidden',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 3,
    elevation: 1,
  },
  episodeRowWatched: {
    backgroundColor: '#f0f9f0',
    borderColor: '#ccebd6',
  },
  episodeImage: {
    width: 100,
    height: 80,
    resizeMode: 'cover',
  },
  episodeImagePlaceholder: {
    width: 100,
    height: 80,
    backgroundColor: '#eee',
    justifyContent: 'center',
    alignItems: 'center',
  },
  episodeImagePlaceholderText: {
    fontSize: 11,
    color: '#999',
    fontWeight: 'bold',
  },
  episodeInfo: {
    flex: 1,
    padding: 10,
    justifyContent: 'center',
  },
  episodeTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  episodeMetaInline: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
    marginBottom: 2,
  },
  episodeDate: {
    fontSize: 11,
    color: '#888',
  },
  episodeRuntime: {
    fontSize: 11,
    color: '#888',
  },
  episodeOverview: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  episodeTextWatched: {
    opacity: 0.7,
  },
  checkboxTouchArea: {
    padding: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#ccc',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  checkboxChecked: {
    backgroundColor: '#34C759',
    borderColor: '#34C759',
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  seasonActionBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  seasonProgressInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  seasonProgressText: {
    fontSize: 13,
    color: '#495057',
    fontWeight: '500',
  },
  seasonCompletedBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#34C759',
    backgroundColor: '#e8f8ed',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 6,
  },
  seasonBatchBtn: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  seasonBatchBtnWatched: {
    backgroundColor: '#e0e0e0',
  },
  seasonBatchBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  seasonBatchBtnTextWatched: {
    color: '#555',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalBackdrop: {
    flex: 1,
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    paddingBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  modalHeaderInfo: {
    flex: 1,
    marginRight: 12,
  },
  modalSeasonBadge: {
    fontSize: 12,
    fontWeight: '700',
    color: '#007AFF',
    marginBottom: 2,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseText: {
    fontSize: 14,
    color: '#666',
    fontWeight: 'bold',
  },
  modalScroll: {
    padding: 16,
  },
  modalImage: {
    width: '100%',
    height: 180,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: '#e5e5e5',
  },
  modalStatsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  modalStatItem: {
    flex: 1,
    backgroundColor: '#f8f9fa',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
  },
  modalStatLabel: {
    fontSize: 10,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  modalStatValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#222',
  },
  modalSynopsisSection: {
    marginBottom: 20,
  },
  modalSynopsisTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 6,
  },
  modalSynopsisText: {
    fontSize: 13,
    color: '#555',
    lineHeight: 20,
  },
  modalActionBtn: {
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  modalActionBtnUnwatched: {
    backgroundColor: '#34C759',
  },
  modalActionBtnWatched: {
    backgroundColor: '#f0f2f5',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  modalActionBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 15,
  },
  modalActionBtnTextWatched: {
    color: '#555',
  },
  removeSection: {
    marginTop: 24,
    marginBottom: 40,
  },
  removeDetailsBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ff3b30',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#ff3b30',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 1,
  },
  removeDetailsBtnText: {
    color: '#ff3b30',
    fontSize: 15,
    fontWeight: '700',
  },
});
