import { type Href, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '../../src/components/ui/AppText';
import { Button } from '../../src/components/ui/Button';
import { ScreenState } from '../../src/components/ui/ScreenState';
import { useAuth } from '../../src/features/auth/auth-context';
import type { AuthState } from '../../src/features/auth/auth.types';
import { colors, radii, spacing } from '../../src/theme/tokens';

type AccountScreenProps = {
  auth: AuthState;
  onSignIn: () => void;
  onSignUp: () => void;
  onForgotPassword: () => void;
  onConfirmEmail: (email: string) => void;
};

export function AccountScreen({ auth, onSignIn, onSignUp, onForgotPassword, onConfirmEmail }: AccountScreenProps) {
  if (auth.status === 'loading') {
    return (
      <SafeAreaView style={styles.screen}>
        <ScreenState kind="loading" title="Hesap yükleniyor" />
      </SafeAreaView>
    );
  }

  if (auth.status === 'signedOut') {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}>
          <AppText accessibilityRole="header" variant="display">Hesap</AppText>
          <AppText tone="muted" style={styles.description}>
            Yorum, puan ve şikâyet özellikleri için hesabına giriş yap.
          </AppText>
          <View style={styles.actions}>
            <Button label="Giriş yap" onPress={onSignIn} />
            <Button label="Hesap oluştur" onPress={onSignUp} variant="secondary" />
            <Button label="Şifremi unuttum" onPress={onForgotPassword} variant="text" />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const email = auth.user?.email ?? '';
  const confirmed = Boolean(auth.user?.email_confirmed_at);
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <AppText accessibilityRole="header" variant="display">Hesap</AppText>
        <View style={styles.card}>
          <AppText variant="label">E-posta</AppText>
          <AppText tone="muted">{email || 'E-posta bilgisi bulunamadı.'}</AppText>
          {confirmed ? (
            <AppText tone="accent" variant="label">Profil bilgileri yüklenmeye hazır.</AppText>
          ) : (
            <>
              <AppText tone="danger">E-posta doğrulaması bekleniyor.</AppText>
              <Button
                disabled={!email}
                label="E-postayı doğrula"
                onPress={() => onConfirmEmail(email)}
                variant="secondary"
              />
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function AccountRoute() {
  const auth = useAuth();
  const router = useRouter();
  return (
    <AccountScreen
      auth={auth}
      onConfirmEmail={email =>
        router.push({ pathname: '/auth/confirm', params: { email } } as Href)
      }
      onForgotPassword={() => router.push('/auth/forgot-password' as Href)}
      onSignIn={() => router.push('/auth/sign-in' as Href)}
      onSignUp={() => router.push('/auth/sign-up' as Href)}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xl },
  description: { marginTop: spacing.sm },
  actions: { gap: spacing.md, marginTop: spacing.xxl },
  card: {
    gap: spacing.md,
    marginTop: spacing.xxl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
});
