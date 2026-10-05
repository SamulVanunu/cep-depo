import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { type Href, useRouter } from 'expo-router';
import { type ReactNode, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '../../src/components/ui/AppText';
import { Button } from '../../src/components/ui/Button';
import { ScreenState } from '../../src/components/ui/ScreenState';
import { useAuth } from '../../src/features/auth/auth-context';
import { createAuthRepository } from '../../src/features/auth/auth.repository';
import type { AuthState } from '../../src/features/auth/auth.types';
import {
  AccountScreen as ProfileAccountScreen,
  signOutAndClearPrivateData,
} from '../../src/features/profile/AccountScreen';
import { removeAvatar, uploadAvatar } from '../../src/features/profile/avatar-upload';
import {
  profileKeys,
  useMyProfile,
  useMyReviews,
  useUpdateUsername,
} from '../../src/features/profile/profile.queries';
import { createProfileRepository } from '../../src/features/profile/profile.repository';
import { getPublicAvatarUrl, getSupabaseClient } from '../../src/lib/supabase';
import { colors, spacing } from '../../src/theme/tokens';

type AccountScreenProps = {
  auth: AuthState;
  onSignIn: () => void;
  onSignUp: () => void;
  onForgotPassword: () => void;
  onConfirmEmail: (email: string) => void;
  signedInContent?: ReactNode;
};

export function addAvatarRevision(url: string, revision: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}v=${revision}`;
}

export function AccountScreen({
  auth,
  onSignIn,
  onSignUp,
  onForgotPassword,
  onConfirmEmail,
  signedInContent,
}: AccountScreenProps) {
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
  if (confirmed) return signedInContent ?? null;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <AppText accessibilityRole="header" variant="display">Hesap</AppText>
        <View style={styles.card}>
          <AppText variant="label">E-posta</AppText>
          <AppText tone="muted">{email || 'E-posta bilgisi bulunamadı.'}</AppText>
          <AppText tone="danger">E-posta doğrulaması bekleniyor.</AppText>
          <Button
            disabled={!email}
            label="E-postayı doğrula"
            onPress={() => onConfirmEmail(email)}
            variant="secondary"
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function SignedInAccount({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const client = getSupabaseClient();
  const repository = useMemo(() => createProfileRepository(client), [client]);
  const profileQuery = useMyProfile(userId);
  const reviewsQuery = useMyReviews(userId);
  const usernameMutation = useUpdateUsername(userId);
  const [isAvatarPending, setIsAvatarPending] = useState(false);
  const [avatarRevision, setAvatarRevision] = useState(0);

  const avatarDependencies = useMemo(() => {
    const storage = client.storage.from('avatars');
    return {
      fetchFile: (uri: string) => fetch(uri),
      storage: {
        upload: (path: string, data: ArrayBuffer, options: { contentType: string; upsert: true }) =>
          storage.upload(path, data, options),
        remove: (paths: string[]) => storage.remove(paths),
      },
      profile: repository,
    };
  }, [client, repository]);

  async function refreshProfileDisplays() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: profileKeys.mine(userId) }),
      queryClient.invalidateQueries({ queryKey: ['reviews'] }),
    ]);
  }

  async function handleUploadAvatar(input: {
    uri: string;
    mimeType: string;
    size: number;
  }) {
    setIsAvatarPending(true);
    try {
      await uploadAvatar(
        { userId, ...input, previousAvatarPath: profileQuery.data?.avatarPath },
        avatarDependencies,
      );
      setAvatarRevision(current => current + 1);
      await refreshProfileDisplays();
    } finally {
      setIsAvatarPending(false);
    }
  }

  async function handleRemoveAvatar() {
    const currentPath = profileQuery.data?.avatarPath;
    if (!currentPath) return;
    setIsAvatarPending(true);
    try {
      await removeAvatar(userId, currentPath, avatarDependencies);
      await refreshProfileDisplays();
    } finally {
      setIsAvatarPending(false);
    }
  }

  function retry() {
    void profileQuery.refetch();
    void reviewsQuery.refetch();
  }

  return (
    <ProfileAccountScreen
      email={email}
      isAvatarPending={isAvatarPending}
      isError={profileQuery.isError}
      isLoading={profileQuery.isLoading}
      isReviewsError={reviewsQuery.isError}
      isReviewsLoading={reviewsQuery.isLoading}
      isUsernamePending={usernameMutation.isPending}
      onOpenReview={slug => router.push(`/apps/${slug}` as Href)}
      onRemoveAvatar={handleRemoveAvatar}
      onRetry={retry}
      onSignOut={() =>
        signOutAndClearPrivateData(
          () => createAuthRepository(client).signOut(),
          queryClient,
        )
      }
      onUpdateUsername={username => usernameMutation.mutateAsync(username).then(() => undefined)}
      onUploadAvatar={handleUploadAvatar}
      pickImage={options => ImagePicker.launchImageLibraryAsync(options)}
      profile={profileQuery.data}
      resolveAvatarUrl={path => addAvatarRevision(getPublicAvatarUrl(path), avatarRevision)}
      reviews={reviewsQuery.data}
    />
  );
}

export default function AccountRoute() {
  const auth = useAuth();
  const router = useRouter();
  const signedInContent =
    auth.status === 'signedIn' && auth.user ? (
      <SignedInAccount email={auth.user.email ?? ''} userId={auth.user.id} />
    ) : null;
  return (
    <AccountScreen
      auth={auth}
      onConfirmEmail={email =>
        router.push({ pathname: '/auth/confirm', params: { email } } as Href)
      }
      onForgotPassword={() => router.push('/auth/forgot-password' as Href)}
      onSignIn={() => router.push('/auth/sign-in' as Href)}
      onSignUp={() => router.push('/auth/sign-up' as Href)}
      signedInContent={signedInContent}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xl },
  description: { marginTop: spacing.sm },
  actions: { gap: spacing.md, marginTop: spacing.xxl },
  card: { gap: spacing.md, marginTop: spacing.xxl },
});
