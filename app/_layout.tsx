import '@/i18n';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppShell } from '@/components/AppShell';
import { AppProviders } from '@/providers/AppProviders';

export default function RootLayout() {
  return (
    <AppProviders>
      <SafeAreaProvider>
        <AppShell>
          <Stack screenOptions={{ headerShown: false }} />
        </AppShell>
      </SafeAreaProvider>
    </AppProviders>
  );
}
