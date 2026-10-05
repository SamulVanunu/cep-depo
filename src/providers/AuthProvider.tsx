import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { type PropsWithChildren, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';

import { AuthContext } from '../features/auth/auth-context';
import type { AuthState } from '../features/auth/auth.types';
import { getSupabaseClient } from '../lib/supabase';
import type { Database } from '../types/database.types';

type AuthProviderProps = PropsWithChildren<{
  client?: SupabaseClient<Database>;
}>;

const signedOutState: AuthState = {
  status: 'signedOut',
  session: null,
  user: null,
};

function stateFromSession(session: Session | null): AuthState {
  return session
    ? { status: 'signedIn', session, user: session.user }
    : signedOutState;
}

export function AuthProvider({ children, client: injectedClient }: AuthProviderProps) {
  const client = injectedClient ?? getSupabaseClient();
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    session: null,
    user: null,
  });

  useEffect(() => {
    let mounted = true;
    let authEventReceived = false;

    const { data } = client.auth.onAuthStateChange((_event, session) => {
      authEventReceived = true;
      if (mounted) setState(stateFromSession(session));
    });

    void client.auth
      .getSession()
      .then(({ data: sessionData, error }) => {
        if (mounted && !authEventReceived) {
          setState(error ? signedOutState : stateFromSession(sessionData.session));
        }
      })
      .catch(() => {
        if (mounted && !authEventReceived) setState(signedOutState);
      });

    const syncAutoRefresh = (nextState: string | null) => {
      if (nextState === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    };

    syncAutoRefresh(AppState.currentState);
    const appStateSubscription = AppState.addEventListener('change', syncAutoRefresh);

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      appStateSubscription.remove();
      client.auth.stopAutoRefresh();
    };
  }, [client]);

  const value = useMemo(() => state, [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
