import type { PropsWithChildren } from 'react';
import { AuthProvider } from './AuthProvider';
import { OrganizationProvider } from './OrganizationProvider';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <AuthProvider>
      <OrganizationProvider>{children}</OrganizationProvider>
    </AuthProvider>
  );
}
