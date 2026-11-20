import { useLayoutEffect, type PropsWithChildren } from 'react';
import { activateClientLocale } from '@/i18n';
import { Stack, usePathname } from 'expo-router';
import HomeScreen from './index';
import { useAuth } from '@/providers/AuthProvider';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppShell } from '@/components/AppShell';
import { AppProviders } from '@/providers/AppProviders';
import { OwnerSetupGate } from '@/components/OwnerSetupGate';

function NavigationLayout({ children }: PropsWithChildren) {
  const { user } = useAuth();
  const pathname = usePathname();
  // The auth lifecycle may still restore a session after its fallback settles.
  // Show the existing sign-in flow without discarding the requested URL.
  if (!user && pathname !== '/') return <HomeScreen />;
  return <OwnerSetupGate><AppShell>{children}</AppShell></OwnerSetupGate>;
}

export default function RootLayout() {
  useLayoutEffect(activateClientLocale, []);
  return (
    <AppProviders>
      <SafeAreaProvider>
        {/* Keep navigation state mounted while session, membership and shell hydrate. */}
        <Stack layout={NavigationLayout} screenOptions={{ headerShown: false }} />
      </SafeAreaProvider>
    </AppProviders>
  );
}
