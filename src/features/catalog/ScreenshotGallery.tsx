import { Image, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { colors, radii, spacing } from '../../theme/tokens';
import type { CatalogScreenshot } from './catalog.types';

type ScreenshotGalleryProps = {
  screenshots: readonly CatalogScreenshot[];
  resolveAssetUrl: (path: string) => string;
};

export function ScreenshotGallery({ screenshots, resolveAssetUrl }: ScreenshotGalleryProps) {
  if (screenshots.length === 0) {
    return (
      <View style={styles.empty}>
        <AppText tone="muted">Henüz ekran görüntüsü eklenmemiş.</AppText>
      </View>
    );
  }

  const ordered = [...screenshots].sort((left, right) => left.position - right.position);
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {ordered.map((screenshot, index) => (
        <Image
          accessibilityLabel={`Ekran görüntüsü ${index + 1}/${ordered.length}: ${screenshot.altText}`}
          key={screenshot.id}
          resizeMode="cover"
          source={{ uri: resolveAssetUrl(screenshot.path) }}
          style={styles.image}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { paddingRight: spacing.lg },
  image: {
    width: 220,
    height: 390,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    marginRight: spacing.md,
  },
  empty: {
    minHeight: 120,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
});
