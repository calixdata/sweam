import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AuthProvider, useAuth } from '../lib/auth';
import { registerForPush } from '../lib/push';
import { colors } from '../lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <AuthProvider>
        <StatusBar style="light" />
        <PushManager />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="record"
            options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="watch/[episodeId]" options={{ animation: 'fade' }} />
          <Stack.Screen name="t/[slug]" options={{ headerShown: false }} />
          <Stack.Screen name="c/[handle]" />
          <Stack.Screen name="search" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="signin" options={{ presentation: 'modal' }} />
          <Stack.Screen name="signup" options={{ presentation: 'modal' }} />
        </Stack>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Registers the device for push once signed in, and routes a tapped
 * notification to the matching screen. Rendered inside AuthProvider so it can
 * read the auth state.
 */
function PushManager() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user) void registerForPush();
  }, [user]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const link = response.notification.request.content.data?.link;
      if (typeof link !== 'string') return;
      if (link.startsWith('/c/')) router.push(`/c/${link.slice(3)}`);
      else if (link.startsWith('/t/')) router.push(`/t/${link.slice(3)}`);
      else if (link.startsWith('/watch/')) router.push(`/watch/${link.slice(7)}`);
      else router.push('/notifications');
    });
    return () => sub.remove();
  }, [router]);

  return null;
}
