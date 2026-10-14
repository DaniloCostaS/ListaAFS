import React, { useState, useMemo, useCallback } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useMediaList, MediaListItem } from '../hooks/useMediaList';
import { useSyncStore } from '../store/useSyncStore';
import { useAuthStore } from '../store/useAuthStore';
import { Link, useFocusEffect } from 'expo-router';
import { MediaCategory } from '../database/schema';

export default function MainScreen() {
  const { data, loading, loadMedia } = useMediaList();
  const { isSyncing, runSync, lastSyncedAt } = useSyncStore();
  const { signOut, user } = useAuthStore();
  const [selectedCategory, setSelectedCategory] = useState<MediaCategory>('all');

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

  const getStatusText = (status: string) => {
    switch (status) {
      case 'watching':
        return 'Assistindo';
      case 'completed':
        return 'Concluído';
      case 'plan_to_watch':
        return 'Quero Assistir';
      default:
        return status;
    }
  };

  const renderItem = ({ item }: { item: MediaListItem }) => {
    const imageUrl = item.poster_path 
      ? `https://image.tmdb.org/t/p/w200${item.poster_path}` 
      : null;

    const isAnime = Boolean(item.is_anime);
    const categoryBadgeText = isAnime ? '🎌 ANIME' : item.media_type === 'movie' ? '🎬 FILME' : '📺 SÉRIE';
    const categoryBadgeStyle = isAnime ? styles.badgeAnime : item.media_type === 'movie' ? styles.badgeMovie : styles.badgeTv;
    const year = item.release_date ? item.release_date.substring(0, 4) : null;

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
              <View style={[styles.badge, styles.statusBadge]}>
                <Text style={styles.statusBadgeText}>{getStatusText(item.status)}</Text>
              </View>
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

            <Text style={styles.overview} numberOfLines={2}>
              {item.overview || 'Sem sinopse.'}
            </Text>

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
    width: 90,
    height: 135,
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
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#666',
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
});
