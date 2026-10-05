import { type Href, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { ScreenState } from '../../components/ui/ScreenState';
import { useAuth } from '../auth/auth-context';
import { useMyProfile } from '../profile/profile.queries';
import { RatingSummary } from './RatingSummary';
import { ReviewForm } from './ReviewForm';
import { ReviewList } from './ReviewList';
import {
  useDeleteReview,
  useMyReview,
  useRatingSummary,
  useSaveReview,
  useVisibleReviews,
} from './review.queries';
import { spacing } from '../../theme/tokens';

type ReviewsSectionProps = { appId: string; appSlug: string };

export function ReviewsSection({ appId, appSlug }: ReviewsSectionProps) {
  const router = useRouter();
  const auth = useAuth();
  const userId = auth.status === 'signedIn' ? auth.user?.id : undefined;
  const summary = useRatingSummary(appId);
  const visible = useVisibleReviews(appId);
  const mine = useMyReview(appId, userId);
  const profile = useMyProfile(userId);
  const save = useSaveReview(appId, userId ?? '');
  const remove = useDeleteReview(appId, userId ?? '');

  function retryPublic() {
    void summary.refetch();
    void visible.refetch();
  }

  const publicPending = summary.isPending || visible.isPending;
  const publicError = summary.isError || visible.isError;
  const confirmed = Boolean(auth.user?.email_confirmed_at);
  const activeProfile = profile.data?.status === 'active';

  return (
    <View accessibilityLabel={`${appSlug} değerlendirmeleri`} style={styles.section}>
      <AppText accessibilityRole="header" variant="title">Değerlendirmeler</AppText>

      {publicPending ? (
        <ScreenState kind="loading" title="Değerlendirmeler yükleniyor" />
      ) : publicError || !summary.data || !visible.data ? (
        <View style={styles.feedback}>
          <AppText tone="danger">Değerlendirmeler yüklenemedi.</AppText>
          <Button
            label="Değerlendirmeleri tekrar yükle"
            onPress={retryPublic}
            variant="text"
          />
        </View>
      ) : (
        <>
          <RatingSummary summary={summary.data} />
          <ReviewList reviews={visible.data} />
        </>
      )}

      {auth.status === 'signedOut' ? (
        <Button
          label="Değerlendirme yapmak için giriş yap"
          onPress={() => router.push('/auth/sign-in' as Href)}
          variant="secondary"
        />
      ) : null}

      {auth.status === 'signedIn' && !confirmed ? (
        <View style={styles.feedback}>
          <AppText tone="muted">Değerlendirme yazmak için e-postanı doğrula.</AppText>
          <Button
            label="E-postayı doğrula"
            onPress={() =>
              router.push({
                pathname: '/auth/confirm',
                params: { email: auth.user?.email ?? '' },
              } as Href)
            }
            variant="secondary"
          />
        </View>
      ) : null}

      {auth.status === 'signedIn' && confirmed && profile.isError ? (
        <View style={styles.feedback}>
          <AppText tone="danger">Profil durumu doğrulanamadı.</AppText>
          <Button label="Profili tekrar yükle" onPress={() => void profile.refetch()} variant="text" />
        </View>
      ) : null}

      {auth.status === 'signedIn' && confirmed && profile.data?.status === 'suspended' ? (
        <AppText tone="danger">
          Hesabın askıya alındığı için değerlendirme yazamazsın.
        </AppText>
      ) : null}

      {auth.status === 'signedIn' && confirmed && activeProfile ? (
        mine.isPending ? (
          <AppText tone="muted">Değerlendirmen yükleniyor…</AppText>
        ) : mine.isError ? (
          <View style={styles.feedback}>
            <AppText tone="danger">Değerlendirmen yüklenemedi.</AppText>
            <Button label="Değerlendirmeyi tekrar yükle" onPress={() => void mine.refetch()} variant="text" />
          </View>
        ) : (
          <ReviewForm
            isPending={save.isPending || remove.isPending}
            onDelete={() => remove.mutateAsync()}
            onSave={draft => save.mutateAsync(draft).then(() => undefined)}
            review={mine.data ?? null}
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.lg, marginTop: spacing.xxl },
  feedback: { alignItems: 'flex-start', gap: spacing.sm },
});
