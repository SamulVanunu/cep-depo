import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import { AppState, Text } from 'react-native';

import { useAuth } from '../../src/features/auth/auth-context';
import { AuthProvider } from '../../src/providers/AuthProvider';
import type { Database } from '../../src/types/database.types';

type AuthClient = SupabaseClient<Database>;

const user = { id: 'user-1', email: 'user@example.test' } as User;
const session = { access_token: 'access', refresh_token: 'refresh', user } as Session;

function createClient(initialSession: Session | null = session) {
  let authListener: ((event: string, nextSession: Session | null) => void) | undefined;
  const unsubscribe = jest.fn();
  const getSession = jest.fn().mockResolvedValue({
    data: { session: initialSession },
    error: null,
  });
  const onAuthStateChange = jest.fn((listener: typeof authListener) => {
    authListener = listener;
    return { data: { subscription: { unsubscribe } } };
  });
  const startAutoRefresh = jest.fn();
  const stopAutoRefresh = jest.fn();

  return {
    client: {
      auth: { getSession, onAuthStateChange, startAutoRefresh, stopAutoRefresh },
    } as unknown as AuthClient,
    emit(nextSession: Session | null) {
      authListener?.(nextSession ? 'SIGNED_IN' : 'SIGNED_OUT', nextSession);
    },
    getSession,
    onAuthStateChange,
    startAutoRefresh,
    stopAutoRefresh,
    unsubscribe,
  };
}

function AuthProbe() {
  const auth = useAuth();
  return (
    <>
      <Text>{auth.status}</Text>
      <Text>{auth.user?.email ?? 'anonymous'}</Text>
    </>
  );
}

describe('AuthProvider', () => {
  const originalCurrentState = AppState.currentState;
  let appStateListener: ((state: 'active' | 'background' | 'inactive') => void) | undefined;
  let removeAppStateListener: jest.Mock;

  beforeEach(() => {
    appStateListener = undefined;
    removeAppStateListener = jest.fn();
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateListener = listener as typeof appStateListener;
      return { remove: removeAppStateListener } as never;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(AppState, 'currentState', {
      configurable: true,
      value: originalCurrentState,
    });
  });

  it('loads the persisted session without hiding public children', async () => {
    const auth = createClient();

    render(
      <AuthProvider client={auth.client}>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(screen.getByText('loading')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('signedIn')).toBeTruthy());
    expect(screen.getByText('user@example.test')).toBeTruthy();
    expect(auth.getSession).toHaveBeenCalledTimes(1);
  });

  it('tracks auth events and unsubscribes on unmount', async () => {
    const auth = createClient();
    const view = render(
      <AuthProvider client={auth.client}>
        <AuthProbe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByText('signedIn')).toBeTruthy());

    act(() => auth.emit(null));

    expect(screen.getByText('signedOut')).toBeTruthy();
    expect(screen.getByText('anonymous')).toBeTruthy();
    view.unmount();
    expect(auth.unsubscribe).toHaveBeenCalledTimes(1);
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });

  it('runs token refresh only while the app is active', async () => {
    const auth = createClient(null);

    render(
      <AuthProvider client={auth.client}>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    act(() => appStateListener?.('background'));
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    act(() => appStateListener?.('active'));
    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.getByText('signedOut')).toBeTruthy());
  });

  it('falls back to signed out when persisted-session loading fails', async () => {
    const auth = createClient();
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new Error('sensitive refresh failure'),
    });

    render(
      <AuthProvider client={auth.client}>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('signedOut')).toBeTruthy());
    expect(screen.getByText('anonymous')).toBeTruthy();
  });
});
