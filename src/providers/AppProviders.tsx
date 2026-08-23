import type { PropsWithChildren } from 'react';
import { AuthProvider } from './AuthProvider';
import { ConnectivityProvider } from './ConnectivityProvider';
import { OrganizationProvider } from './OrganizationProvider';
import { SyncStatusProvider } from './SyncStatusProvider';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ConnectivityProvider>
      <SyncStatusProvider>
        <AuthProvider>
          <OrganizationProvider>{children}</OrganizationProvider>
        </AuthProvider>
      </SyncStatusProvider>
    </ConnectivityProvider>
  );
}
