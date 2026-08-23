import type { PropsWithChildren } from 'react';
import { AuthProvider } from './AuthProvider';
import { ConnectivityProvider } from './ConnectivityProvider';
import { OrganizationProvider } from './OrganizationProvider';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ConnectivityProvider>
      <AuthProvider>
        <OrganizationProvider>{children}</OrganizationProvider>
      </AuthProvider>
    </ConnectivityProvider>
  );
}
