import { Pressable, StyleSheet } from 'react-native';

import { colors, radii, spacing } from '../../theme/tokens';
import type { Category } from '../../features/catalog/catalog.types';
import { AppText } from './AppText';

type CategoryChipProps = { category: Category; selected?: boolean; onPress: (category: Category) => void };

export function CategoryChip({ category, selected = false, onPress }: CategoryChipProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${category.name} kategorisi`}
      onPress={() => onPress(category)}
      style={[styles.base, selected && styles.selected]}
    >
      <AppText tone={selected ? 'primary' : 'muted'} variant="label">{category.name}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', marginRight: spacing.sm },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
});
