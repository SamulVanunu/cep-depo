import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { colors, radii, spacing } from '../../theme/tokens';
import type { ReviewDraft } from './review.types';

type Rating = ReviewDraft['rating'];

type StarRatingInputProps = {
  value: Rating | 0;
  onChange(value: Rating): void;
  disabled?: boolean;
};

const ratings: readonly Rating[] = [1, 2, 3, 4, 5];

export function StarRatingInput({ value, onChange, disabled = false }: StarRatingInputProps) {
  return (
    <View accessibilityLabel="Puan" accessibilityRole="radiogroup" style={styles.group}>
      {ratings.map(rating => {
        const checked = rating === value;
        return (
          <Pressable
            accessibilityLabel={`${rating} yıldız`}
            accessibilityRole="radio"
            accessibilityState={{ checked, disabled }}
            disabled={disabled}
            key={rating}
            onPress={() => onChange(rating)}
            style={styles.star}
          >
            <AppText tone={rating <= value ? 'accent' : 'subtle'} variant="title">
              {rating <= value ? '★' : '☆'}
            </AppText>
            <AppText tone="subtle" variant="label">{rating}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', gap: spacing.xs },
  star: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
});
