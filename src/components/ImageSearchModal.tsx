import React, { useState, useEffect } from 'react';
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
  TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import {
  searchAnimeByImage,
  TraceMoeMatch,
  formatTimestamp,
  getAnilistTitle,
} from '../services/traceMoe';
import {
  identifyMediaWithGemini,
  GeminiVisionResult,
} from '../services/geminiVision';
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
  const [engine, setEngine] = useState<'gemini' | 'tracemoe'>('gemini');
  const [selectedImageUri, setSelectedImageUri] = useState<string | null>(null);
  const [selectedBase64, setSelectedBase64] = useState<string | null>(null);
  const [selectedMimeType, setSelectedMimeType] = useState<string>('image/jpeg');
  const [selectedFileName, setSelectedFileName] = useState<string>('screenshot.jpg');
  const [searching, setSearching] = useState(false);
  const [loadingText, setLoadingText] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Gemini State
  const [geminiResult, setGeminiResult] = useState<GeminiVisionResult | null>(null);
  const [savedGeminiKey, setSavedGeminiKey] = useState<string>('');
  const [customKeyInput, setCustomKeyInput] = useState<string>('');
  const [showKeySetup, setShowKeySetup] = useState<boolean>(false);

  // trace.moe State
  const [matches, setMatches] = useState<TraceMoeMatch[]>([]);
  const [selectedMatchIndex, setSelectedMatchIndex] = useState<number>(0);

  // TMDB Common State
  const [matchedTmdb, setMatchedTmdb] = useState<{
    item: TMDBMultiSearchResult;
    detail: TMDBMediaDetail;
  } | null>(null);
  const [loadingTmdb, setLoadingTmdb] = useState(false);
  const [addingToList, setAddingToList] = useState(false);
  const [addedKey, setAddedKey] = useState<string | null>(null);

  const { addOrUpdateMedia } = useMediaList();

  // Load saved Gemini API key from SecureStore on mount
  useEffect(() => {
    SecureStore.getItemAsync('gemini_api_key')
      .then((key) => {
        if (key) {
          setSavedGeminiKey(key);
          setCustomKeyInput(key);
        }
      })
      .catch((e) => console.warn('Could not read gemini key from store:', e));
  }, []);

  const activeApiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY || savedGeminiKey;

  const resetState = () => {
    setSelectedImageUri(null);
    setSelectedBase64(null);
    setSearching(false);
    setLoadingText('');
    setErrorMessage('');
    setGeminiResult(null);
    setMatches([]);
    setSelectedMatchIndex(0);
    setMatchedTmdb(null);
    setLoadingTmdb(false);
    setAddingToList(false);
    setAddedKey(null);
    setShowKeySetup(false);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleSaveApiKey = async () => {
    const trimmed = customKeyInput.trim();
    if (!trimmed) {
      Alert.alert('Chave Vazia', 'Por favor, informe uma chave de API válida.');
      return;
    }
    try {
      await SecureStore.setItemAsync('gemini_api_key', trimmed);
      setSavedGeminiKey(trimmed);
      setShowKeySetup(false);
      Alert.alert('Sucesso', 'Chave do Google Gemini salva no app com sucesso!');
      if (selectedBase64) {
        processImage(selectedImageUri!, selectedBase64, selectedMimeType, selectedFileName, trimmed);
      }
    } catch (err) {
      console.error('Error saving API key:', err);
      Alert.alert('Erro', 'Não foi possível salvar a chave no dispositivo.');
    }
  };

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permissão necessária',
          'Precisamos de permissão para acessar a galeria e buscar a obra pelo print.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedImageUri(asset.uri);
        setSelectedBase64(asset.base64 || null);
        setSelectedMimeType(asset.mimeType || 'image/jpeg');
        setSelectedFileName(asset.fileName || 'screenshot.jpg');
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
          'Precisamos de permissão da câmera para tirar foto de telas ou TV.'
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setSelectedImageUri(asset.uri);
        setSelectedBase64(asset.base64 || null);
        setSelectedMimeType(asset.mimeType || 'image/jpeg');
        setSelectedFileName(asset.fileName || 'screenshot.jpg');
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
    fileName?: string | null,
    overrideKey?: string
  ) => {
    const keyToUse = overrideKey || activeApiKey;

    setSearching(true);
    setLoadingText(engine === 'gemini' ? 'Analisando personagens, figurino e cena com o Google Gemini...' : 'Comparando imagem com mais de 30.000 horas de animes...');
    setErrorMessage('');
    setGeminiResult(null);
    setMatches([]);
    setMatchedTmdb(null);
    setSelectedMatchIndex(0);

    if (engine === 'gemini') {
      if (!keyToUse) {
        setSearching(false);
        setShowKeySetup(true);
        return;
      }

      if (!base64) {
        setErrorMessage('Não foi possível obter os dados da imagem em base64.');
        setSearching(false);
        return;
      }

      try {
        const res = await identifyMediaWithGemini(base64, mimeType || 'image/jpeg', keyToUse);
        setGeminiResult(res);
        setErrorMessage('');
        setSearching(false);
        loadTmdbForGemini(res);
      } catch (err: any) {
        console.error('Gemini Vision error:', err);
        setErrorMessage(err?.message || 'Falha ao identificar imagem com a IA.');
        setSearching(false);
      }
    } else {
      // trace.moe engine
      try {
        const results = await searchAnimeByImage(
          uri,
          base64,
          mimeType || 'image/jpeg',
          fileName || 'screenshot.jpg'
        );

        if (!results || results.length === 0) {
          setErrorMessage('Nenhum anime correspondente encontrado para este print.');
          setSearching(false);
          return;
        }

        setMatches(results);
        setErrorMessage('');
        setSearching(false);
        loadTmdbForMatch(results[0]);
      } catch (err: any) {
        console.error('trace.moe error:', err);
        setErrorMessage(
          err?.message || 'Falha ao buscar cena de anime. Verifique sua conexão e tente novamente.'
        );
        setSearching(false);
      }
    }
  };

  const loadTmdbForGemini = async (gemini: GeminiVisionResult) => {
    setLoadingTmdb(true);
    setMatchedTmdb(null);

    const candidates = [
      gemini.title,
      gemini.original_title,
    ].filter((q): q is string => Boolean(q && q.trim().length > 0));

    try {
      let foundItem: TMDBMultiSearchResult | null = null;

      for (const query of candidates) {
        try {
          const tmdbResults = await searchMulti(query);
          if (gemini.media_type === 'anime') {
            const animeMatch = tmdbResults.find(item => checkIfAnime(item));
            if (animeMatch) {
              foundItem = animeMatch;
              break;
            }
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
      console.error('Error adding matched media to database:', err);
      Alert.alert('Erro', 'Não foi possível salvar na sua lista.');
    } finally {
      setAddingToList(false);
    }
  };

  const activeTraceMatch = matches[selectedMatchIndex] || null;
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
            <View style={{ flex: 1 }}>
              <Text style={styles.modalTitle}>📸 Busca Visual por Imagem</Text>
              <Text style={styles.modalSubtitle}>Descubra o anime, série ou filme a partir de prints</Text>
            </View>
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Engine Selector Tabs */}
          <View style={styles.engineTabs}>
            <TouchableOpacity
              style={[styles.engineTab, engine === 'gemini' && styles.engineTabActive]}
              onPress={() => {
                setEngine('gemini');
                if (selectedImageUri) {
                  processImage(selectedImageUri, selectedBase64, selectedMimeType, selectedFileName);
                }
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.engineTabText, engine === 'gemini' && styles.engineTabTextActive]}>
                ✨ IA Gemini (Recomendado)
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.engineTab, engine === 'tracemoe' && styles.engineTabActive]}
              onPress={() => {
                setEngine('tracemoe');
                if (selectedImageUri) {
                  processImage(selectedImageUri, selectedBase64, selectedMimeType, selectedFileName);
                }
              }}
              activeOpacity={0.8}
            >
              <Text style={[styles.engineTabText, engine === 'tracemoe' && styles.engineTabTextActive]}>
                🎌 trace.moe (Cena Exata)
              </Text>
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

            {/* Gemini API Key Configuration Box (if not configured or user wants to edit) */}
            {engine === 'gemini' && (!activeApiKey || showKeySetup) && (
              <View style={styles.apiKeyBox}>
                <View style={styles.apiKeyHeader}>
                  <Text style={styles.apiKeyTitle}>🔑 Chave da API do Google Gemini</Text>
                  {activeApiKey && (
                    <TouchableOpacity onPress={() => setShowKeySetup(false)}>
                      <Text style={styles.apiKeyClose}>✕ Fechar</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.apiKeyDesc}>
                  A API do Google Gemini é <Text style={{ fontWeight: 'bold', color: '#10B981' }}>100% gratuita</Text> (com até 1.500 buscas por dia) e não precisa de cartão de crédito.
                </Text>
                <TouchableOpacity
                  style={styles.getKeyBtn}
                  onPress={() => Linking.openURL('https://aistudio.google.com/app/apikey')}
                >
                  <Text style={styles.getKeyBtnText}>🔗 Gerar Chave Gratuita no Google AI Studio (30s) ↗</Text>
                </TouchableOpacity>

                <TextInput
                  style={styles.keyInput}
                  placeholder="Cole sua chave aqui (AIzaSy...)"
                  placeholderTextColor="#6B7280"
                  value={customKeyInput}
                  onChangeText={setCustomKeyInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <TouchableOpacity style={styles.saveKeyBtn} onPress={handleSaveApiKey}>
                  <Text style={styles.saveKeyBtnText}>Salvar Chave no App</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Change API Key Shortcut */}
            {engine === 'gemini' && activeApiKey && !showKeySetup && !searching && (
              <TouchableOpacity
                style={styles.keyStatusRow}
                onPress={() => setShowKeySetup(true)}
              >
                <Text style={styles.keyStatusText}>
                  🟢 Chave Gemini ativa ({savedGeminiKey ? 'Salva no App' : 'do .env'}) • <Text style={{ textDecorationLine: 'underline' }}>Alterar</Text>
                </Text>
              </TouchableOpacity>
            )}

            {/* Selected image preview or helpful tip */}
            {!selectedImageUri && !searching && (
              <View style={styles.tipBox}>
                <Text style={styles.tipTitle}>
                  {engine === 'gemini' ? '💡 Como funciona a IA Gemini?' : '💡 Como funciona o trace.moe?'}
                </Text>
                <Text style={styles.tipText}>
                  {engine === 'gemini'
                    ? '1. Envie qualquer print com personagens, lutas ou cenas (mesmo com barras pretas, player de vídeo ou legendas).'
                    : '1. Tire um print limpo da cena de anime diretamente do vídeo.'}
                </Text>
                <Text style={styles.tipText}>
                  {engine === 'gemini'
                    ? '2. A Inteligência Artificial reconhece a obra, figurino e personagens em segundos.'
                    : '2. O trace.moe tenta encontrar o quadro matemático exato na base de dados.'}
                </Text>
                <Text style={styles.tipText}>
                  3. O app exibe o card completo com sinopse em português, onde assistir no Brasil e botão para adicionar à sua lista!
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
                <Text style={styles.loadingStatusText}>{loadingText}</Text>
              </View>
            )}

            {/* Error message - only if no result was found */}
            {!searching && !!errorMessage && !geminiResult && matches.length === 0 ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMessage}</Text>
                <TouchableOpacity
                  style={styles.retryBtn}
                  onPress={() => {
                    if (selectedImageUri) {
                      processImage(selectedImageUri, selectedBase64, selectedMimeType, selectedFileName);
                    } else {
                      pickImage();
                    }
                  }}
                >
                  <Text style={styles.retryBtnText}>Tentar Novamente</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {/* GEMINI RESULTS SECTION */}
            {!searching && geminiResult && (
              <View style={styles.resultContainer}>
                {/* Confidence & Category Badge */}
                <View style={styles.matchBadgeRow}>
                  <View style={[
                    styles.confidenceBadge,
                    geminiResult.confidence === 'high' && styles.confidenceHigh,
                    geminiResult.confidence === 'medium' && styles.confidenceMed,
                  ]}>
                    <Text style={styles.confidenceText}>
                      ✨ IA Gemini: {geminiResult.confidence === 'high' ? 'Alta Certeza 🎯' : geminiResult.confidence === 'medium' ? 'Média Certeza ⚠️' : 'Baixa Certeza'}
                    </Text>
                  </View>

                  <View style={styles.episodeBadge}>
                    <Text style={styles.episodeBadgeText}>
                      {geminiResult.media_type === 'anime' ? '🎌 Anime' : geminiResult.media_type === 'movie' ? '🎬 Filme' : '📺 Série'}
                    </Text>
                  </View>
                </View>

                {/* Print Preview & AI Recognition Box */}
                <View style={styles.geminiCardBox}>
                  {selectedImageUri && (
                    <Image source={{ uri: selectedImageUri }} style={styles.previewPrintImage} />
                  )}

                  <View style={styles.aiInsights}>
                    <Text style={styles.animeMainTitle}>{geminiResult.title}</Text>
                    {geminiResult.original_title && geminiResult.original_title !== geminiResult.title && (
                      <Text style={styles.animeSubTitle}>{geminiResult.original_title}</Text>
                    )}

                    {geminiResult.characters && geminiResult.characters.length > 0 && (
                      <View style={styles.charactersRow}>
                        <Text style={styles.charactersLabel}>👥 Personagens:</Text>
                        <Text style={styles.charactersText}>{geminiResult.characters.join(' • ')}</Text>
                      </View>
                    )}

                    {geminiResult.explanation ? (
                      <View style={styles.explanationBox}>
                        <Text style={styles.explanationText}>💡 {geminiResult.explanation}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* TMDB Matched Card */}
                {loadingTmdb ? (
                  <View style={styles.tmdbLoadingBox}>
                    <ActivityIndicator size="small" color="#007AFF" />
                    <Text style={styles.tmdbLoadingText}>Buscando sinopse em português e onde assistir...</Text>
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

            {/* TRACE.MOE RESULTS SECTION */}
            {!searching && engine === 'tracemoe' && activeTraceMatch && (
              <View style={styles.resultContainer}>
                {/* Confidence & Episode Header Badge */}
                <View style={styles.matchBadgeRow}>
                  <View style={[
                    styles.confidenceBadge,
                    activeTraceMatch.similarity >= 0.87 && styles.confidenceHigh,
                    activeTraceMatch.similarity >= 0.75 && activeTraceMatch.similarity < 0.87 && styles.confidenceMed,
                  ]}>
                    <Text style={styles.confidenceText}>
                      {activeTraceMatch.similarity >= 0.87 ? '🎯 Alta Precisão' : activeTraceMatch.similarity >= 0.75 ? '⚠️ Precisão Média' : '🔍 Baixa Precisão'}: {(activeTraceMatch.similarity * 100).toFixed(1)}%
                    </Text>
                  </View>

                  <View style={styles.episodeBadge}>
                    <Text style={styles.episodeBadgeText}>
                      {activeTraceMatch.episode ? `Episódio ${activeTraceMatch.episode}` : 'Filme / Especial'}
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
                    <Image source={{ uri: activeTraceMatch.image }} style={styles.compareImage} />
                  </View>
                </View>

                {/* Scene Timestamp & Video preview link */}
                <View style={styles.sceneMetaRow}>
                  <Text style={styles.timestampText}>
                    ⏱️ Momento: <Text style={styles.timestampBold}>{formatTimestamp(activeTraceMatch.from)}</Text>
                  </Text>
                  {activeTraceMatch.video && (
                    <TouchableOpacity
                      style={styles.clipBtn}
                      onPress={() => Linking.openURL(activeTraceMatch.video)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.clipBtnText}>🎬 Ver clipe da cena ↗</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Anime Anilist Titles */}
                <View style={styles.titleContainer}>
                  <Text style={styles.animeMainTitle}>
                    {getAnilistTitle(activeTraceMatch).title}
                  </Text>
                  {getAnilistTitle(activeTraceMatch).romaji && (
                    <Text style={styles.animeSubTitle}>
                      {getAnilistTitle(activeTraceMatch).romaji}
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

                {/* Matched TMDB Card for trace.moe */}
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
    maxHeight: '94%',
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
  engineTabs: {
    flexDirection: 'row',
    backgroundColor: '#0D0F14',
    padding: 4,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    gap: 4,
  },
  engineTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  engineTabActive: {
    backgroundColor: '#1E2433',
  },
  engineTabText: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  engineTabTextActive: {
    color: '#60A5FA',
    fontWeight: '700',
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 30,
  },
  pickerActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
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
  apiKeyBox: {
    backgroundColor: '#1E1B2E',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#4338CA',
    marginBottom: 14,
  },
  apiKeyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  apiKeyTitle: {
    color: '#A5B4FC',
    fontSize: 14,
    fontWeight: '700',
  },
  apiKeyClose: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  apiKeyDesc: {
    color: '#D1D5DB',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  getKeyBtn: {
    backgroundColor: '#3730A3',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  getKeyBtnText: {
    color: '#E0E7FF',
    fontSize: 12,
    fontWeight: '600',
  },
  keyInput: {
    backgroundColor: '#0F172A',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 10,
  },
  saveKeyBtn: {
    backgroundColor: '#4F46E5',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveKeyBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  keyStatusRow: {
    alignItems: 'center',
    marginBottom: 10,
  },
  keyStatusText: {
    color: '#9CA3AF',
    fontSize: 11,
  },
  tipBox: {
    backgroundColor: '#1A2035',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2D3748',
    marginTop: 4,
  },
  tipTitle: {
    color: '#60A5FA',
    fontSize: 14,
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
    fontSize: 13,
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
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
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
  geminiCardBox: {
    backgroundColor: '#1E2230',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2A3042',
    marginBottom: 12,
  },
  previewPrintImage: {
    width: '100%',
    height: 160,
    backgroundColor: '#0F172A',
  },
  aiInsights: {
    padding: 14,
  },
  charactersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  charactersLabel: {
    color: '#9CA3AF',
    fontSize: 13,
    fontWeight: '600',
  },
  charactersText: {
    color: '#E5E7EB',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  explanationBox: {
    backgroundColor: '#161922',
    padding: 10,
    borderRadius: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#242836',
  },
  explanationText: {
    color: '#CBD5E1',
    fontSize: 12,
    lineHeight: 18,
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
