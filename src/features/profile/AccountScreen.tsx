import type { QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { ScreenState } from '../../components/ui/ScreenState';
import { colors, radii, spacing } from '../../theme/tokens';
import { ProfileEditor, type PickedAvatar, type PickImage } from './ProfileEditor';
import { profileKeys } from './profile.queries';
import type { AccountReview, Profile } from './profile.types';

type AccountScreenProps = {
  email: string;
  profile: Profile | null | undefined;
  reviews: readonly AccountReview[] | undefined;
  isLoading: boolean;
  isError: boolean;
  isReviewsLoading: boolean;
  isReviewsError: boolean;
  isUsernamePending: boolean;
  isAvatarPending: boolean;
  onRetry(): void;
  onUpdateUsername(username: string): Promise<void>;
  onUploadAvatar(avatar: PickedAvatar): Promise<void>;
  onRemoveAvatar(): Promise<void>;
  onOpenReview(slug: string): void;
  onSignOut(): Promise<void>;
  resolveAvatarUrl(path: string): string;
  pickImage: PickImage;
};

export async function signOutAndClearPrivateData(
  signOut: () => Promise<void>,
  queryClient: QueryClient,
): Promise<void> {
  await signOut();
  queryClient.removeQueries({ queryKey: profileKeys.all });
}

export function AccountScreen({
  email,
  profile,
  reviews,
  isLoading,
  isError,
  isReviewsLoading,
  isReviewsError,
  isUsernamePending,
  isAvatarPending,
  onRetry,
  onUpdateUsername,
  onUploadAvatar,
  onRemoveAvatar,
  onOpenReview,
  onSignOut,
  resolveAvatarUrl,
  pickImage,
}: AccountScreenProps) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      await onSignOut();
    } catch {
      setSignOutError('Çıkış yapılamadı. Lütfen tekrar deneyin.');
    } finally {
      setIsSigningOut(false);
    }
  }

  if (isLoading) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScreenState kind="loading" title="Profil yükleniyor" />
      </SafeAreaView>
    );
  }

  if (isError || !profile) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScreenState
          kind="error"
          message="Profil bilgilerin alınamadı."
          onRetry={onRetry}
          title="Profil yüklenemedi"
        />
      </SafeAreaView>
    );
  }

  const suspended = profile.status === 'suspended';
  const avatarUrl = profile.avatarPath ? resolveAvatarUrl(profile.avatarPath) : null;
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <AppText accessibilityRole="header" variant="display">Hesap</AppText>
        <AppText tone="muted" style={styles.email}>{email}</AppText>

        {suspended ? (
          <>
            <View style={styles.notice}>
              <AppText tone="danger" variant="title">Hesabın askıya alındı.</AppText>
              <AppText tone="muted">
                Profilini ve yorumlarını görebilirsin; topluluk değişiklikleri kapalıdır.
              </AppText>
            </View>
            <View style={styles.profileSummary}>
              {avatarUrl ? (
                <Image
                  accessibilityLabel={`${profile.username} avatarı`}
                  source={{ uri: avatarUrl }}
                  style={styles.avatar}
                />
              ) : null}
              <View style={styles.profileSummaryCopy}>
                <AppText variant="label">Kullanıcı adı</AppText>
                <AppText variant="title">{profile.username}</AppText>
              </View>
            </View>
          </>
        ) : (
          <ProfileEditor
            avatarUrl={avatarUrl}
            isAvatarPending={isAvatarPending}
            isUsernamePending={isUsernamePending}
            onRemoveAvatar={onRemoveAvatar}
            onUpdateUsername={onUpdateUsername}
            onUploadAvatar={onUploadAvatar}
            pickImage={pickImage}
            profile={profile}
          />
        )}

        <View style={styles.section}>
          <AppText accessibilityRole="header" variant="title">Yorumlarım</AppText>
          {isReviewsLoading ? <AppText tone="muted">Yorumların yükleniyor…</AppText> : null}
          {isReviewsError ? (
            <View style={styles.reviewError}>
              <AppText tone="danger">Yorumların yüklenemedi.</AppText>
              <Button label="Yorumları tekrar yükle" onPress={onRetry} variant="text" />
            </View>
          ) : null}
          {!isReviewsLoading && !isReviewsError && reviews?.length === 0 ? (
            <AppText tone="muted">Henüz yorum yapmadın.</AppText>
          ) : null}
          {reviews?.map(review => (
            <Pressable
              accessibilityLabel={`${review.appTitle} yorumunu aç`}
              accessibilityRole="link"
              key={review.id}
              onPress={() => onOpenReview(review.appSlug)}
              style={styles.review}
            >
              <View style={styles.reviewHeader}>
                <AppText variant="label">{review.appTitle}</AppText>
                <AppText tone="accent" variant="label">{review.rating}/5</AppText>
              </View>
              {review.body ? <AppText tone="muted">{review.body}</AppText> : null}
            </Pressable>
          ))}
        </View>

        {signOutError ? <AppText tone="danger">{signOutError}</AppText> : null}
        <Button
          label="Çıkış yap"
          loading={isSigningOut}
          onPress={() => void handleSignOut()}
          variant="secondary"
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: spacing.xl, padding: spacing.xl, paddingBottom: spacing.xxl },
  email: { marginTop: -spacing.lg },
  notice: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  profileSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.surfaceRaised },
  profileSummaryCopy: { flex: 1, gap: spacing.xs },
  section: { gap: spacing.md },
  reviewError: { alignItems: 'flex-start', gap: spacing.xs },
  review: {
    gap: spacing.sm,
    minHeight: 44,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
});
