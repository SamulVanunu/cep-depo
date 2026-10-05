import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ConfirmEmailScreen } from '../../../src/features/auth/ConfirmEmailScreen';
import { ForgotPasswordScreen } from '../../../src/features/auth/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../../../src/features/auth/ResetPasswordScreen';
import { SignInScreen } from '../../../src/features/auth/SignInScreen';
import { SignUpScreen } from '../../../src/features/auth/SignUpScreen';
import type { AuthRepository } from '../../../src/features/auth/auth.repository';

function repository(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    signUp: jest.fn().mockResolvedValue('confirmationRequired'),
    signIn: jest.fn().mockResolvedValue(undefined),
    signOut: jest.fn().mockResolvedValue(undefined),
    resendConfirmation: jest.fn().mockResolvedValue(undefined),
    requestPasswordReset: jest.fn().mockResolvedValue(undefined),
    updatePassword: jest.fn().mockResolvedValue(undefined),
    isUsernameAvailable: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe('auth screens', () => {
  it('validates sign-in fields and ignores a second submit while pending', async () => {
    let resolveSignIn: (() => void) | undefined;
    const signIn = jest.fn(
      () => new Promise<void>(resolve => {
        resolveSignIn = resolve;
      }),
    );
    render(
      <SignInScreen
        onForgotPassword={jest.fn()}
        onSignedIn={jest.fn()}
        onSignUp={jest.fn()}
        repository={repository({ signIn })}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Giriş yap' }));
    expect(screen.getByText('Geçerli bir e-posta adresi girin.')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('E-posta'), 'user@example.com');
    fireEvent.changeText(screen.getByLabelText('Şifre'), '123456');
    fireEvent.press(screen.getByRole('button', { name: 'Giriş yap' }));
    fireEvent.press(screen.getByRole('button', { name: 'Giriş yap' }));
    expect(signIn).toHaveBeenCalledTimes(1);

    await act(async () => resolveSignIn?.());
  });

  it('shows a confirmation state after successful signup', async () => {
    const onConfirmationRequired = jest.fn();
    render(
      <SignUpScreen
        onConfirmationRequired={onConfirmationRequired}
        onSignIn={jest.fn()}
        repository={repository()}
      />,
    );

    fireEvent.changeText(screen.getByLabelText('Kullanıcı adı'), 'Çağrı_Öz');
    fireEvent.changeText(screen.getByLabelText('E-posta'), 'user@example.com');
    fireEvent.changeText(screen.getByLabelText('Şifre'), '123456');
    fireEvent.changeText(screen.getByLabelText('Şifre tekrarı'), '123456');
    fireEvent.press(screen.getByRole('button', { name: 'Hesap oluştur' }));

    await waitFor(() => expect(screen.getByText('Doğrulama e-postası gönderildi.')).toBeTruthy());
    fireEvent.press(screen.getByRole('button', { name: 'Doğrulama ekranına git' }));
    expect(onConfirmationRequired).toHaveBeenCalledWith('user@example.com');
  });

  it('always shows the same password-reset request success copy', async () => {
    render(<ForgotPasswordScreen onBack={jest.fn()} repository={repository()} />);

    fireEvent.changeText(screen.getByLabelText('E-posta'), 'missing@example.com');
    fireEvent.press(screen.getByRole('button', { name: 'Sıfırlama bağlantısı gönder' }));

    await waitFor(() =>
      expect(
        screen.getByText('Adres kayıtlıysa şifre sıfırlama bağlantısı gönderildi.'),
      ).toBeTruthy(),
    );
  });

  it('resends confirmation without exposing technical errors', async () => {
    const resendConfirmation = jest.fn().mockResolvedValue(undefined);
    render(
      <ConfirmEmailScreen
        email="user@example.com"
        onContinue={jest.fn()}
        repository={repository({ resendConfirmation })}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'E-postayı yeniden gönder' }));

    await waitFor(() => expect(resendConfirmation).toHaveBeenCalledWith('user@example.com'));
    expect(screen.getByText('Doğrulama e-postası yeniden gönderildi.')).toBeTruthy();
  });

  it('rejects mismatched reset passwords then returns to Account after success', async () => {
    const updatePassword = jest.fn().mockResolvedValue(undefined);
    const onComplete = jest.fn();
    render(
      <ResetPasswordScreen
        onComplete={onComplete}
        repository={repository({ updatePassword })}
      />,
    );

    fireEvent.changeText(screen.getByLabelText('Yeni şifre'), '123456');
    fireEvent.changeText(screen.getByLabelText('Yeni şifre tekrarı'), '654321');
    fireEvent.press(screen.getByRole('button', { name: 'Şifreyi güncelle' }));
    expect(screen.getByText('Şifreler eşleşmiyor.')).toBeTruthy();
    expect(updatePassword).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('Yeni şifre tekrarı'), '123456');
    fireEvent.press(screen.getByRole('button', { name: 'Şifreyi güncelle' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  });
});
