import { createContext, useContext } from 'react';

import type { AuthContextValue } from './auth.types';

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);

  if (!value) {
    throw new Error('useAuth, AuthProvider içinde kullanılmalıdır.');
  }

  return value;
}
