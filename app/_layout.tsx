import '@/i18n';
import { Stack } from 'expo-router';
import { View } from 'react-native';
import { ConnectivityBanner } from '@/components/ConnectivityBanner';
import { AppProviders } from '@/providers/AppProviders';

export default function RootLayout() {
  return (
    <AppProviders>
      <View style={{ flex: 1 }}>
        <ConnectivityBanner />
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </AppProviders>
  );
}
