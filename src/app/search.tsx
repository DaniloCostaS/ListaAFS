import React, { useState, useCallback } from 'react';
import { StyleSheet, View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { searchMulti, TMDBMultiSearchResult } from '../services/tmdb';
import { useMediaList } from '../hooks/useMediaList';

export default function SearchScreen() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TMDBMultiSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { addOrUpdateMedia } = useMediaList();

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await searchMulti(query);
      setResults(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleAdd = async (item: TMDBMultiSearchResult) => {
    try {
      // For MVP, default status to 'plan_to_watch'
      await addOrUpdateMedia(item.id, item.media_type, 'plan_to_watch');
      router.back();
    } catch (err) {
      console.error(err);
    }
  };

  const renderItem = ({ item }: { item: TMDBMultiSearchResult }) => {
    const title = item.title || item.name;
    const imageUrl = item.poster_path 
      ? `https://image.tmdb.org/t/p/w200${item.poster_path}` 
      : null;

    return (
      <View style={styles.card}>
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={styles.poster} />
        ) : (
          <View style={[styles.poster, styles.posterPlaceholder]} />
        )}
        <View style={styles.cardInfo}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          <Text style={styles.subtitle}>{item.media_type.toUpperCase()}</Text>
          <Text style={styles.overview} numberOfLines={3}>{item.overview}</Text>
          
          <TouchableOpacity style={styles.addButton} onPress={() => handleAdd(item)}>
            <Text style={styles.addButtonText}>+ Adicionar à Lista</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Buscar Mídia', headerBackTitle: 'Voltar' }} />
      
      <View style={styles.searchBar}>
        <TextInput
          style={styles.input}
          placeholder="Digite o nome do filme ou série..."
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
          autoFocus
        />
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          <Text style={styles.searchButtonText}>Ir</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(item) => `${item.media_type}-${item.id}`}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={
            query.length > 0 && !loading ? (
              <Text style={styles.emptyText}>Nenhum resultado encontrado.</Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  searchBar: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  input: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginRight: 12,
    fontSize: 16,
  },
  searchButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    justifyContent: 'center',
    borderRadius: 8,
  },
  searchButtonText: {
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
    borderRadius: 8,
    marginBottom: 16,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  poster: {
    width: 100,
    height: 150,
  },
  posterPlaceholder: {
    backgroundColor: '#ddd',
  },
  cardInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  subtitle: {
    color: '#666',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 8,
  },
  overview: {
    fontSize: 12,
    color: '#444',
    flex: 1,
  },
  addButton: {
    backgroundColor: '#34C759',
    padding: 8,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  addButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 40,
    color: '#666',
  },
});
