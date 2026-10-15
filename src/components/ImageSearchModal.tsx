import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  ScrollView,
  Linking,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  searchAnimeByImage,
  TraceMoeMatch,
  formatTimestamp,
  getAnilistTitle,
} from '../services/traceMoe';
import {
  searchMulti,
  getMediaDetails,
  checkIfAnime,
  findBestTrailer,
  TMDBMultiSearchResult,
  TMDBMediaDetail,
} from '../services/tmdb';
import { useMediaList } from '../hooks/useMediaList';

interface ImageSearchModalProps {
  visible: boolean;
  onClose: () => void;
  existingIds: Set<string>;
  onItemAdded?: (itemKey: string) => void;
}

export default function ImageSearchModal({
  visible,
  onClose,
  existingIds,
  onItemAdded,
}: ImageSearchModalProps) {
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [matches, setMatches] = useState<TraceMoeMatch[]>([]);
  const [selectedMatchIndex, setSelectedMatchIndex] = useState<number>(0);
  const [matchedTmdb, setMatchedTmdb] = useState<{
    item: TMDBMultiSearchResult;
    detail: TMDBMediaDetail;
  } | null>(null);
  const [loadingTmdb, setLoadingTmdb] = useState(false);
  const [addingToList, setAddingToList] = useState(false);
  const [addedKey, setAddedKey] = useState<string | null>(null);

  const { addOrUpdateMedia } = useMediaList();

  const resetState = () => {
    setSelectedImageUri(null);
    setSearching(false);
    setStatusMessage('');
    setMatches([]);
    setSelectedMatchIndex(0);
    setMatchedTmdb(null);
    setLoadingTmdb(false);
    setAddingToList(false);
    setAddedKey(null);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permissão necessária',
          'Precisamos de permissão para acessar a galeria e buscar o anime pelo print.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.85,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedImageUri(asset.uri);
        processImage(asset.uri, asset.base64, asset.mimeType, asset.fileName);
      }
    } catch (err) {
      console.error('Error picking image from library:', err);
      Alert.alert('Erro', 'Não foi possível carregar a imagem da galeria.');
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permissão necessária',
          'Precisamos de permissão da câmera para tirar foto de telas ou mangás.'
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.85,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedImageUri(asset.uri);
        processImage(asset.uri, asset.base64, asset.mimeType, asset.fileName);
      }
    } catch (err) {
      console.error('Error taking photo:', err);
      Alert.alert('Erro', 'Não foi possível capturar a foto com a câmera.');
    }
  };

  const processImage = async (
    uri: string,
    base64?: string | null,
    mimeType?: string | null,
    fileName?: string | null
  ) => {
    setSearching(true);
    setMatches([]);
    setMatchedTmdb(null);
    setSelectedMatchIndex(0);
    setStatusMessage('Comparando imagem com mais de 30.000 horas de animes...');

    try {
      const results = await searchAnimeByImage(
        uri,
        base64,
        mimeType || 'image/jpeg',
        fileName || 'screenshot.jpg'
      );

      if (!results || results.length === 0) {
        setStatusMessage('Nenhum anime correspondente encontrado para este print.');
        setSearching(false);
        return;
      }

      setMatches(results);
      setStatusMessage('');
      setSearching(false);

      // Automatically search TMDB for the best match
      loadTmdbForMatch(results[0]);
    } catch (err: any) {
      console.error('trace.moe error:', err);
      setStatusMessage(
        err?.message || 'Falha ao buscar cena de anime. Verifique sua conexão e tente novamente.'
      );
      setSearching(false);
    }
  };

  const loadTmdbForMatch = async (match: TraceMoeMatch) => {
    setLoadingTmdb(true);
    setMatchedTmdb(null);

    try {
      const titleInfo = getAnilistTitle(match);
      const searchQueries = [
        titleInfo.title,
        titleInfo.romaji,
        titleInfo.native,
      ].filter((q): q is string => Boolean(q && q.trim().length > 0));

      let foundItem: TMDBMultiSearchResult | null = null;

      for (const query of searchQueries) {
        try {
          const tmdbResults = await searchMulti(query);
          // Prioritize anime / animation results
          const animeMatch = tmdbResults.find(item => checkIfAnime(item));
          if (animeMatch) {
            foundItem = animeMatch;
            break;
          }
          if (tmdbResults.length > 0 && !foundItem) {
            foundItem = tmdbResults[0];
          }
        } catch (e) {
          console.warn('TMDB lookup error for query:', query, e);
        }
      }

      if (foundItem) {
        const detail = await getMediaDetails(foundItem.media_type, foundItem.id);
        setMatchedTmdb({ item: foundItem, detail });
      }
    } catch (e) {
      console.warn('Could not match with TMDB:', e);
    } finally {
      setLoadingTmdb(false);
    }
  };

  const handleSelectMatch = (index: number) => {
    setSelectedMatchIndex(index);
    if (matches[index]) {
      loadTmdbForMatch(matches[index]);
    }
  };

  const handleAddMatchedToDatabase = async () => {
    if (!matchedTmdb) return;
    const { item, detail } = matchedTmdb;
    const key = `${item.media_type}-${item.id}`;

    setAddingToList(true);
    try {
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

      setAddedKey(key);
      if (onItemAdded) {
        onItemAdded(key);
      }
    } catch (err) {
      console.error('Error adding matched anime to database:', err);
      Alert.alert('Erro', 'Não foi possível salvar na sua lista.');
    } finally {
      setAddingToList(false);
    }
  };

  const activeMatch = matches[selectedMatchIndex] || null;
  const similarityPercent = activeMatch ? (activeMatch.similarity * 100).toFixed(1) : '0';
  const isHighConfidence = activeMatch ? activeMatch.similarity >= 0.87 : false;
  const isMedConfidence = activeMatch ? activeMatch.similarity >= 0.75 && activeMatch.similarity < 0.87 : false;

  const currentKey = matchedTmdb ? `${matchedTmdb.item.media_type}-${matchedTmdb.item.id}` : null;
  const isAlreadyInList = currentKey ? existingIds.has(currentKey) || addedKey === currentKey : false;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalTitle}>📸 Busca por Imagem</Text>
              <Text style={styles.modalSubtitle}>Identifique animes a partir de prints de redes sociais</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {/* Action Buttons to Pick Image */}
            <View style={styles.pickerActionRow}>
              <TouchableOpacity style={styles.pickerBtn} onPress={pickImage} activeOpacity={0.8}>
                <Text style={styles.pickerBtnIcon}>🖼️</Text>
                <Text style={styles.pickerBtnText}>Escolher Print</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.pickerBtn} onPress={takePhoto} activeOpacity={0.8}>
                <Text style={styles.pickerBtnIcon}>📸</Text>
                <Text style={styles.pickerBtnText}>Tirar Foto</Text>
              </TouchableOpacity>
            </View>

            {/* Selected image preview or helpful tip */}
            {!selectedImageUri && !searching && (
              <View style={styles.tipBox}>
                <Text style={styles.tipTitle}>💡 Como funciona?</Text>
                <Text style={styles.tipText}>
                  1. Tire um print daquela cena ou luta épica no Instagram, TikTok ou Twitter.
                </Text>
                <Text style={styles.tipText}>
                  2. Toque em &apos;Escolher Print&apos; e envie aqui.
                </Text>
                <Text style={styles.tipText}>
                  3. O app encontra o anime exato, o episódio, o minuto da cena e até onde assistir!
                </Text>
              </View>
            )}

            {/* Loading Indicator */}
            {searching && (
              <View style={styles.loadingContainer}>
                {selectedImageUri && (
                  <Image source={{ uri: selectedImageUri }} style={styles.thumbnailPreview} />
                )}
                <ActivityIndicator size="large" color="#007AFF" style={{ marginVertical: 14 }} />
                <Text style={styles.loadingStatusText}>{statusMessage}</Text>
              </View>
            )}

            {/* Error or Empty message */}
            {!searching && statusMessage ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{statusMessage}</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={pickImage}>
                  <Text style={styles.retryBtnText}>Tentar Outro Print</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Results Section */}
            {!searching && activeMatch && (
              <View style={styles.resultContainer}>
                {/* Confidence & Episode Header Badge */}
                <View style={styles.matchBadgeRow}>
                  <View style={[
                    styles.confidenceBadge,
                    isHighConfidence && styles.confidenceHigh,
                    isMedConfidence && styles.confidenceMed,
                  ]}>
                    <Text style={styles.confidenceText}>
                      {isHighConfidence ? '🎯 Alta Precisão' : isMedConfidence ? '⚠️ Precisão Média' : '🔍 Baixa Precisão'}: {similarityPercent}%
                    </Text>
                  </View>

                  <View style={styles.episodeBadge}>
                    <Text style={styles.episodeBadgeText}>
                      {activeMatch.episode ? `Episódio ${activeMatch.episode}` : 'Filme / Especial'}
                    </Text>
                  </View>
                </View>

                {/* Side-by-side or comparison images */}
                <View style={styles.comparisonBox}>
                  <View style={styles.imageColumn}>
                    <Text style={styles.imageColumnTitle}>Seu Print</Text>
                    {selectedImageUri ? (
                      <Image source={{ uri: selectedImageUri }} style={styles.compareImage} />
                    ) : (
                      <View style={[styles.compareImage, styles.imagePlaceholder]} />
                    )}
                  </View>

                  <View style={styles.imageColumn}>
                    <Text style={styles.imageColumnTitle}>Cena do Anime</Text>
                    <Image source={{ uri: activeMatch.image }} style={styles.compareImage} />
                  </View>
                </View>

                {/* Scene Timestamp & Video preview link */}
                <View style={styles.sceneMetaRow}>
                  <Text style={styles.timestampText}>
                    ⏱️ Momento: <Text style={styles.timestampBold}>{formatTimestamp(activeMatch.from)}</Text>
                  </Text>
                  {activeMatch.video && (
                    <TouchableOpacity
                      style={styles.clipBtn}
                      onPress={() => Linking.openURL(activeMatch.video)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.clipBtnText}>🎬 Ver clipe da cena ↗</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Anime Anilist Titles */}
                <View style={styles.titleContainer}>
                  <Text style={styles.animeMainTitle}>
                    {getAnilistTitle(activeMatch).title}
                  </Text>
                  {getAnilistTitle(activeMatch).romaji && (
                    <Text style={styles.animeSubTitle}>
                      {getAnilistTitle(activeMatch).romaji}
                    </Text>
                  )}
                </View>

                {/* Other Candidates Tabs */}
                {matches.length > 1 && (
                  <View style={styles.candidatesSection}>
                    <Text style={styles.candidatesLabel}>Outros episódios ou cenas correspondentes:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.candidatesScroll}>
                      {matches.slice(0, 5).map((m, idx) => {
                        const isSelected = idx === selectedMatchIndex;
                        return (
                          <TouchableOpacity
                            key={`${m.filename}-${idx}`}
                            style={[styles.candidateChip, isSelected && styles.candidateChipActive]}
                            onPress={() => handleSelectMatch(idx)}
                          >
                            <Text style={[styles.candidateChipText, isSelected && styles.candidateChipTextActive]}>
                              Ep {m.episode || '?'} ({(m.similarity * 100).toFixed(0)}%)
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                )}

                {/* Matched TMDB Card */}
                {loadingTmdb ? (
                  <View style={styles.tmdbLoadingBox}>
                    <ActivityIndicator size="small" color="#007AFF" />
                    <Text style={styles.tmdbLoadingText}>Carregando sinopse em português e onde assistir...</Text>
                  </View>
                ) : matchedTmdb ? (
                  <View style={styles.tmdbCard}>
                    <View style={styles.tmdbHeader}>
                      {matchedTmdb.detail.poster_path ? (
                        <Image
                          source={{ uri: `https://image.tmdb.org/t/p/w200${matchedTmdb.detail.poster_path}` }}
                          style={styles.tmdbPoster}
                        />
                      ) : null}
                      <View style={styles.tmdbMeta}>
                        <Text style={styles.tmdbTitle} numberOfLines={2}>
                          {matchedTmdb.detail.name || matchedTmdb.detail.title}
                        </Text>
                        <View style={styles.tmdbRatingRow}>
                          {matchedTmdb.detail.vote_average ? (
                            <Text style={styles.tmdbRating}>⭐ {matchedTmdb.detail.vote_average.toFixed(1)}</Text>
                          ) : null}
                          {matchedTmdb.detail.number_of_seasons ? (
                            <Text style={styles.tmdbSeasons}>
                              {matchedTmdb.detail.number_of_seasons} temp{matchedTmdb.detail.number_of_seasons > 1 ? 's' : ''}
                            </Text>
                          ) : null}
                        </View>
                        <Text style={styles.tmdbOverview} numberOfLines={3}>
                          {matchedTmdb.detail.overview || 'Sem sinopse disponível em português.'}
                        </Text>
                      </View>
                    </View>

                    {/* Watch Providers (Onde Assistir no Brasil) */}
                    {matchedTmdb.detail.watch_providers?.flatrate && matchedTmdb.detail.watch_providers.flatrate.length > 0 ? (
                      <View style={styles.tmdbProvidersRow}>
                        <Text style={styles.tmdbProvidersLabel}>📡 Onde Assistir:</Text>
                        <View style={styles.tmdbProvidersList}>
                          {matchedTmdb.detail.watch_providers.flatrate.slice(0, 4).map(prov => (
                            <Image
                              key={prov.provider_id}
                              source={{ uri: `https://image.tmdb.org/t/p/w92${prov.logo_path}` }}
                              style={styles.tmdbProviderLogo}
                            />
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {/* Add to List Button */}
                    <TouchableOpacity
                      style={[
                        styles.addBtn,
                        isAlreadyInList && styles.addBtnInList,
                        addingToList && styles.addBtnDisabled,
                      ]}
                      onPress={handleAddMatchedToDatabase}
                      disabled={addingToList}
                      activeOpacity={0.8}
                    >
                      {addingToList ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.addBtnText}>
                          {isAlreadyInList ? '✓ Na sua lista (Salvo)' : '+ Adicionar à Minha Lista'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#16181F',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '92%',
    paddingBottom: 24,
    borderWidth: 1,
    borderColor: '#242836',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#242836',
  },
  modalTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: '#8E8E93',
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#242836',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    color: '#8E8E93',
    fontSize: 16,
    fontWeight: '600',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 30,
  },
  pickerActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  pickerBtn: {
    flex: 1,
    backgroundColor: '#1E2230',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A3042',
    gap: 8,
  },
  pickerBtnIcon: {
    fontSize: 18,
  },
  pickerBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  tipBox: {
    backgroundColor: '#1A2035',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2D3748',
    marginTop: 8,
  },
  tipTitle: {
    color: '#60A5FA',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  tipText: {
    color: '#D1D5DB',
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 4,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  thumbnailPreview: {
    width: 140,
    height: 90,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#007AFF',
  },
  loadingStatusText: {
    color: '#9CA3AF',
    fontSize: 14,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: '#2A1818',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#5C2222',
    alignItems: 'center',
    marginTop: 10,
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },
  retryBtn: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  retryBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  resultContainer: {
    marginTop: 4,
  },
  matchBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  confidenceBadge: {
    backgroundColor: '#374151',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  confidenceHigh: {
    backgroundColor: '#065F46',
  },
  confidenceMed: {
    backgroundColor: '#92400E',
  },
  confidenceText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  episodeBadge: {
    backgroundColor: '#1E293B',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  episodeBadgeText: {
    color: '#93C5FD',
    fontSize: 12,
    fontWeight: '600',
  },
  comparisonBox: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  imageColumn: {
    flex: 1,
  },
  imageColumnTitle: {
    color: '#9CA3AF',
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  compareImage: {
    width: '100%',
    height: 115,
    borderRadius: 8,
    backgroundColor: '#1F2937',
  },
  imagePlaceholder: {
    borderWidth: 1,
    borderColor: '#374151',
  },
  sceneMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E2230',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
  },
  timestampText: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  timestampBold: {
    color: '#fff',
    fontWeight: '700',
  },
  clipBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#2A3042',
  },
  clipBtnText: {
    color: '#60A5FA',
    fontSize: 12,
    fontWeight: '600',
  },
  titleContainer: {
    marginBottom: 12,
  },
  animeMainTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  animeSubTitle: {
    color: '#9CA3AF',
    fontSize: 13,
    marginTop: 2,
  },
  candidatesSection: {
    marginBottom: 14,
  },
  candidatesLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    marginBottom: 6,
  },
  candidatesScroll: {
    flexDirection: 'row',
  },
  candidateChip: {
    backgroundColor: '#1E2230',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#2A3042',
  },
  candidateChipActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  candidateChipText: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '500',
  },
  candidateChipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  tmdbLoadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  tmdbLoadingText: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  tmdbCard: {
    backgroundColor: '#1A1F2C',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2E384D',
    marginTop: 6,
  },
  tmdbHeader: {
    flexDirection: 'row',
    gap: 12,
  },
  tmdbPoster: {
    width: 65,
    height: 95,
    borderRadius: 6,
  },
  tmdbMeta: {
    flex: 1,
  },
  tmdbTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  tmdbRatingRow: {
    flexDirection: 'row',
    gap: 10,
    marginVertical: 4,
  },
  tmdbRating: {
    color: '#FBBF24',
    fontSize: 12,
    fontWeight: '600',
  },
  tmdbSeasons: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  tmdbOverview: {
    color: '#9CA3AF',
    fontSize: 12,
    lineHeight: 16,
  },
  tmdbProvidersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#242C3F',
    gap: 8,
  },
  tmdbProvidersLabel: {
    color: '#9CA3AF',
    fontSize: 12,
    fontWeight: '600',
  },
  tmdbProvidersList: {
    flexDirection: 'row',
    gap: 6,
  },
  tmdbProviderLogo: {
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  addBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  addBtnInList: {
    backgroundColor: '#10B981',
  },
  addBtnDisabled: {
    opacity: 0.6,
  },
  addBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
