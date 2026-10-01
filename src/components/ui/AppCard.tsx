import { Pressable, StyleSheet, View } from 'react-native';

import type { CatalogCard } from '../../features/catalog/catalog.types';
import { colors, radii, spacing } from '../../theme/tokens';
import { AppIcon } from './AppIcon';
import { AppText } from './AppText';

type AppCardProps = { app: CatalogCard; onPress: (app: CatalogCard) => void };

export function AppCard({ app, onPress }: AppCardProps) {
  return (
    <Pressable
      accessibilityLabel={`${app.title}, ${app.category.name}, sürüm ${app.currentVersion.name}`}
      accessibilityRole="button"
      onPress={() => onPress(app)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <AppIcon title={app.title} uri={app.iconPath} />
      <View style={styles.content}>
        <View style={styles.heading}>
          <AppText variant="label" numberOfLines={1} style={styles.title}>{app.title}</AppText>
          {app.featured ? <AppText tone="accent" variant="label">Öne çıkan</AppText> : null}
        </View>
        <AppText tone="muted" numberOfLines={2}>{app.shortDescription}</AppText>
        <AppText tone="subtle" variant="label">{app.category.name} · sürüm {app.currentVersion.name}</AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 96, flexDirection: 'row', padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, marginBottom: spacing.md },
  pressed: { opacity: 0.8 },
  content: { flex: 1, marginLeft: spacing.md, justifyContent: 'space-between' },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { flex: 1, color: colors.text },
});
