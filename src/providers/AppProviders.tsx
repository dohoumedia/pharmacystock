import type { PropsWithChildren } from 'react';
import { NotificationProvider } from './NotificationProvider';
import { AuthProvider } from './AuthProvider';
import { ConnectivityProvider } from './ConnectivityProvider';
import { OrganizationProvider } from './OrganizationProvider';
import { SyncStatusProvider } from './SyncStatusProvider';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ConnectivityProvider>
      <AuthProvider>
        <SyncStatusProvider>
          <OrganizationProvider><NotificationProvider>{children}</NotificationProvider></OrganizationProvider>
        </SyncStatusProvider>
      </AuthProvider>
    </ConnectivityProvider>
  );
}
