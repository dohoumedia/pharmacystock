import type { PropsWithChildren } from 'react';
import { AuthProvider } from './AuthProvider';

export function AppProviders({ children }: PropsWithChildren) {
  return <AuthProvider>{children}</AuthProvider>;
}
