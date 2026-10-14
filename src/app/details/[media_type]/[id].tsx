import React, { useEffect, useState, useMemo, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, Image, ActivityIndicator, TouchableOpacity, Switch } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { getMediaDetails, getSeasonDetails, TMDBMediaDetail } from '../../../services/tmdb';
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
        setSelectedSeason(lastWatchedSeason);
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

  return (
    <ScrollView style={styles.container}>
      <Stack.Screen options={{ title: title || 'Detalhes', headerBackTitle: 'Voltar' }} />
      
      {imageUrl && <Image source={{ uri: imageUrl }} style={styles.poster} />}
      
      <View style={styles.info}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.overview}>{details.overview}</Text>
        
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
                      onPress={() => toggleEpisode(selectedSeason, ep.episode_number, !isWatched)}
                    >
                      {epImage ? (
                        <Image source={{ uri: epImage }} style={styles.episodeImage} />
                      ) : (
                        <View style={[styles.episodeImage, styles.episodeImagePlaceholder]} />
                      )}
                      
                      <View style={styles.episodeInfo}>
                        <Text style={[styles.episodeTitle, isWatched && styles.episodeTextWatched]}>
                          {ep.episode_number}. {ep.name}
                        </Text>
                        <Text style={[styles.episodeDate, isWatched && styles.episodeTextWatched]}>
                          {ep.air_date}
                        </Text>
                        <Text style={[styles.episodeOverview, isWatched && styles.episodeTextWatched]} numberOfLines={2}>
                          {ep.overview || 'Sem sinopse.'}
                        </Text>
                      </View>
                      
                      <View style={[styles.checkbox, isWatched && styles.checkboxChecked]}>
                        {isWatched && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  },
  overview: {
    fontSize: 14,
    color: '#444',
    lineHeight: 22,
  },
  movieBtn: {
    marginTop: 24,
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
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
    overflow: 'hidden',
    alignItems: 'center',
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
    backgroundColor: '#ddd',
  },
  episodeInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'center',
  },
  episodeTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  episodeDate: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  episodeOverview: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  episodeTextWatched: {
    opacity: 0.7,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#ccc',
    marginRight: 16,
    justifyContent: 'center',
    alignItems: 'center',
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
});
