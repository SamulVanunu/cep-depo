import { fireEvent, render, screen } from '@testing-library/react-native';
import type { User } from '@supabase/supabase-js';

import { AccountScreen } from '../../app/(tabs)/account';
import type { AuthState } from '../../src/features/auth/auth.types';

const signedOut: AuthState = { status: 'signedOut', session: null, user: null };

function userFixture(emailConfirmedAt: string | null): User {
  return {
    id: 'user-1',
    aud: 'authenticated',
    email: 'user@example.com',
    email_confirmed_at: emailConfirmedAt ?? undefined,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: '2026-10-01T10:00:00Z',
  };
}

describe('Account route', () => {
  it('shows a loading state while the persisted session resolves', () => {
    render(
      <AccountScreen
        auth={{ status: 'loading', session: null, user: null }}
        onConfirmEmail={jest.fn()}
        onForgotPassword={jest.fn()}
        onSignIn={jest.fn()}
        onSignUp={jest.fn()}
      />,
    );

    expect(screen.getByText('Hesap yükleniyor')).toBeTruthy();
  });

  it('offers login, registration and reset without pretending the user is signed in', () => {
    const onSignIn = jest.fn();
    const onSignUp = jest.fn();
    const onForgotPassword = jest.fn();
    render(
      <AccountScreen
        auth={signedOut}
        onConfirmEmail={jest.fn()}
        onForgotPassword={onForgotPassword}
        onSignIn={onSignIn}
        onSignUp={onSignUp}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Giriş yap' }));
    fireEvent.press(screen.getByRole('button', { name: 'Hesap oluştur' }));
    fireEvent.press(screen.getByRole('button', { name: 'Şifremi unuttum' }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
    expect(onSignUp).toHaveBeenCalledTimes(1);
    expect(onForgotPassword).toHaveBeenCalledTimes(1);
  });

  it('surfaces unconfirmed email guidance while keeping the account readable', () => {
    const onConfirmEmail = jest.fn();
    const user = userFixture(null);
    render(
      <AccountScreen
        auth={{ status: 'signedIn', session: { user } as never, user }}
        onConfirmEmail={onConfirmEmail}
        onForgotPassword={jest.fn()}
        onSignIn={jest.fn()}
        onSignUp={jest.fn()}
      />,
    );

    expect(screen.getByText('E-posta doğrulaması bekleniyor.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'E-postayı doğrula' }));
    expect(onConfirmEmail).toHaveBeenCalledWith('user@example.com');
  });

  it('shows the temporary signed-in profile shell for a confirmed account', () => {
    const user = userFixture('2026-10-01T12:00:00Z');
    render(
      <AccountScreen
        auth={{ status: 'signedIn', session: { user } as never, user }}
        onConfirmEmail={jest.fn()}
        onForgotPassword={jest.fn()}
        onSignIn={jest.fn()}
        onSignUp={jest.fn()}
      />,
    );

    expect(screen.getByText('user@example.com')).toBeTruthy();
    expect(screen.getByText('Profil bilgileri yüklenmeye hazır.')).toBeTruthy();
  });
});
