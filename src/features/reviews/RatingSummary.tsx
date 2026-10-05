import { StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { colors, radii, spacing } from '../../theme/tokens';
import type { RatingSummary as RatingSummaryValue } from './review.types';

export function RatingSummary({ summary }: { summary: RatingSummaryValue }) {
  if (summary.count === 0 || summary.average === null) {
    return (
      <View style={styles.card}>
        <AppText tone="muted">Henüz puan yok</AppText>
      </View>
    );
  }

  return (
    <View accessible accessibilityLabel={`${summary.average.toFixed(1)} puan, ${summary.count} değerlendirme`} style={styles.card}>
      <AppText tone="accent" variant="title">{summary.average.toFixed(1)} / 5</AppText>
      <AppText tone="muted">{summary.count} değerlendirme</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.xs,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
});
