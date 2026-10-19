import { Pressable, StyleSheet, View } from 'react-native';

import type { CatalogCard } from '../../features/catalog/catalog.types';
import { colors, radii, spacing } from '../../theme/tokens';
import { AppIcon } from './AppIcon';
import { AppText } from './AppText';

type AppCardProps = { app: CatalogCard; iconUri?: string | null; onPress: (app: CatalogCard) => void };

export function AppCard({ app, iconUri, onPress }: AppCardProps) {
  const accountLabel = {
    none: 'Hesap gerekmez',
    optional: 'Hesap isteğe bağlı',
    required: 'Hesap zorunlu',
  }[app.currentVersion.accountRequirement];
  const platformLabel = app.currentVersion.supportsMobile && app.currentVersion.supportsTv
    ? 'Mobil ve TV'
    : app.currentVersion.supportsMobile ? 'Mobil' : 'TV';
  return (
    <Pressable
      accessibilityLabel={`${app.title}, ${app.category.name}, sürüm ${app.currentVersion.name}, ${platformLabel}, ${accountLabel}`}
      accessibilityRole="button"
      onPress={() => onPress(app)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <AppIcon title={app.title} uri={iconUri} />
      <View style={styles.content}>
        <View style={styles.heading}>
          <AppText variant="label" numberOfLines={1} style={styles.title}>{app.title}</AppText>
          {app.featured ? <AppText tone="accent" variant="label">Öne çıkan</AppText> : null}
        </View>
        <AppText tone="muted" numberOfLines={2}>{app.shortDescription}</AppText>
        <View style={styles.badges}>
          {app.currentVersion.supportsMobile ? <AppText tone="accent" variant="label">Mobil</AppText> : null}
          {app.currentVersion.supportsTv ? <AppText tone="accent" variant="label">TV</AppText> : null}
          <AppText tone="subtle" variant="label">{accountLabel}</AppText>
        </View>
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
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  title: { flex: 1, color: colors.text },
});
