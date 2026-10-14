import React, { useEffect } from 'react';
import { StyleSheet, View, Text, FlatList, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { useMediaList, MediaListItem } from '../hooks/useMediaList';
import { useSyncStore } from '../store/useSyncStore';
import { useAuthStore } from '../store/useAuthStore';
import { Link } from 'expo-router';

export default function MainScreen() {
  const { data, loading, loadMedia, addOrUpdateMedia } = useMediaList();
  const { isSyncing, runSync, lastSyncedAt } = useSyncStore();
  const { signOut, user } = useAuthStore();

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  const handleSync = () => {
    runSync().then(() => loadMedia());
  };

  const renderItem = ({ item }: { item: MediaListItem }) => {
    const imageUrl = item.poster_path 
      ? `https://image.tmdb.org/t/p/w200${item.poster_path}` 
      : null;

    return (
      <Link href={`/details/${item.media_type}/${item.tmdb_id}`} asChild>
        <TouchableOpacity style={styles.card}>
          {imageUrl ? (
            <Image source={{ uri: imageUrl }} style={styles.poster} />
          ) : (
            <View style={[styles.poster, styles.posterPlaceholder]} />
          )}
          <View style={styles.cardInfo}>
            <Text style={styles.title} numberOfLines={2}>{item.title || `TMDB ID: ${item.tmdb_id}`}</Text>
            <Text style={styles.subtitle}>
              {item.media_type.toUpperCase()} • Status: {item.status}
            </Text>
            <Text style={styles.overview} numberOfLines={2}>{item.overview}</Text>
            {item.sync_pending === 1 && (
              <Text style={styles.pendingBadge}>Sincronização Pendente</Text>
            )}
          </View>
        </TouchableOpacity>
      </Link>
    );
  };

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
            {isSyncing ? 'Sincronizando...' : 'Sincronizar Agora'}
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
          <Text style={styles.addButtonText}>🔍 Buscar Filmes e Séries</Text>
        </TouchableOpacity>
      </Link>

      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => `${item.media_type}-${item.tmdb_id}`}
          renderItem={renderItem}
          ListEmptyComponent={<Text style={styles.emptyText}>Nenhuma mídia na sua lista.</Text>}
          contentContainerStyle={styles.listContainer}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 24,
    paddingTop: 60,
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
  },
  headerUser: {
    fontSize: 12,
    color: '#666',
  },
  logoutButton: {
    padding: 8,
  },
  logoutText: {
    color: '#FF3B30',
    fontWeight: 'bold',
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    justifyContent: 'space-between',
  },
  syncButton: {
    backgroundColor: '#34C759',
    padding: 10,
    borderRadius: 8,
  },
  syncButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  syncDate: {
    fontSize: 12,
    color: '#666',
  },
  addButton: {
    backgroundColor: '#007AFF',
    marginHorizontal: 16,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  loader: {
    marginTop: 40,
  },
  listContainer: {
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cardInfo: {
    flex: 1,
    padding: 12,
  },
  poster: {
    width: 80,
    height: 120,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },
  posterPlaceholder: {
    backgroundColor: '#ddd',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    color: '#666',
    fontSize: 12,
  },
  overview: {
    marginTop: 4,
    color: '#444',
    fontSize: 12,
  },
  pendingBadge: {
    marginTop: 8,
    color: '#FF9500',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 40,
  },
});
