import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { getPublicAvatarUrl } from '../../lib/supabase';
import { colors, radii, spacing } from '../../theme/tokens';
import type { Review } from './review.types';

type ReviewListProps = {
  reviews: readonly Review[];
  resolveAvatarUrl?: (path: string) => string;
};

export function ReviewList({ reviews, resolveAvatarUrl = getPublicAvatarUrl }: ReviewListProps) {
  if (reviews.length === 0) return <AppText tone="muted">Henüz yorum yok.</AppText>;

  return (
    <View style={styles.list}>
      {reviews.map(review => (
        <View key={review.id} style={styles.card}>
          <View style={styles.header}>
            {review.avatarPath ? (
              <Image
                accessibilityLabel={`${review.username} avatarı`}
                source={{ uri: resolveAvatarUrl(review.avatarPath) }}
                style={styles.avatar}
              />
            ) : (
              <View accessible accessibilityLabel={`${review.username} için avatar yok`} style={styles.avatarPlaceholder} />
            )}
            <View style={styles.identity}>
              <AppText variant="label">{review.username}</AppText>
              <AppText tone="accent" variant="label">{review.rating}/5</AppText>
            </View>
          </View>
          {review.body ? <AppText tone="muted">{review.body}</AppText> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised },
  avatarPlaceholder: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceRaised },
  identity: { flex: 1, gap: spacing.xs },
});
