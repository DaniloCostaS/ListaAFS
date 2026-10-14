import { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { useAuthStore } from '../store/useAuthStore';
import { useDatabase } from '../database/useDatabase';
import { View, Text, ActivityIndicator } from 'react-native';

export default function RootLayout() {
  const { session, isInitialized, setInitialized } = useAuthStore();
  const { isReady, error } = useDatabase();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    // Basic startup initialization
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!isInitialized || !isReady) return;

    const inAuthGroup = segments[0] === 'auth';

    if (
      // If the user is not signed in and the initial segment is not anything in the auth group.
      !session &&
      !inAuthGroup
    ) {
      // Redirect to the sign-in page.
      router.replace('/auth');
    } else if (session && inAuthGroup) {
      // Redirect away from the sign-in page.
      router.replace('/');
    }
  }, [session, isInitialized, isReady, segments]);

  if (!isInitialized || !isReady) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Erro ao iniciar banco de dados: {error.message}</Text>
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
