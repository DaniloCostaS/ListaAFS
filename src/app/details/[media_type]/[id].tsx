import React, { useEffect, useState, useMemo, useRef } from 'react';
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
  Linking 
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getMediaDetails, getSeasonDetails, findBestTrailer, TMDBMediaDetail } from '../../../services/tmdb';
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

  // For overall media status (Movies)
  const [overallStatus, setOverallStatus] = useState<string | null>(null);
  const { addOrUpdateMedia } = useMediaList();

  const { episodes, loadEpisodes, toggleEpisode, toggleSeasonEpisodes } = useMediaDetails(tmdb_id);

  // Initial Data Load
  useEffect(() => {
    if (!tmdb_id || isNaN(tmdb_id) || !media_type) return;

    const fetchInitialData = async () => {
      try {
        const [tmdbData, db] = await Promise.all([
          getMediaDetails(media_type as 'movie' | 'tv', tmdb_id),
          getDb()
        ]);
        setDetails(tmdbData);

        // Fetch local status
        const localItem = await db.getFirstAsync<{ status: string }>(
          'SELECT status FROM sync_queue WHERE tmdb_id = $tmdb_id AND media_type = $media_type',
          { $tmdb_id: Number(tmdb_id), $media_type: String(media_type) }
        );
        if (localItem) {
          setOverallStatus(localItem.status);
        }

      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchInitialData();
    loadEpisodes();
  }, [media_type, tmdb_id, loadEpisodes]);

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
    await toggleSeasonEpisodes(selectedSeason, epNumbers, !allSeasonEpisodesWatched);
  };

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

  return (
    <View style={styles.screenWrapper}>
      <ScrollView style={styles.container}>
        <Stack.Screen options={{ title: title || 'Detalhes', headerBackTitle: 'Voltar' }} />
        
        {imageUrl && <Image source={{ uri: imageUrl }} style={styles.poster} />}
        
        <View style={styles.info}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.overview}>{details.overview || 'Sem sinopse disponível.'}</Text>
          
          {/* Trailer Button if available */}
          {trailerKey && (
            <TouchableOpacity 
              style={styles.trailerActionBtn}
              onPress={handleOpenTrailer}
              activeOpacity={0.8}
            >
              <Text style={styles.trailerActionBtnText}>▶ Assistir Trailer Oficial no YouTube</Text>
            </TouchableOpacity>
          )}

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
                            toggleEpisode(selectedSeason, ep.episode_number, !isWatched);
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
                      toggleEpisode(selectedSeason, selectedEpisodeForModal.episode_number, !isEpWatched);
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
  overview: {
    fontSize: 14,
    color: '#444',
    lineHeight: 22,
  },
  trailerActionBtn: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF0000',
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 3,
  },
  trailerActionBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
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
});
