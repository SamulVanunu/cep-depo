import { Image, StyleSheet, Text, View } from 'react-native';

import { colors } from '../../theme/tokens';

type AppIconProps = {
  title: string;
  uri?: string | null;
  size?: number;
};

export function AppIcon({ title, uri, size = 56 }: AppIconProps) {
  if (uri) {
    return <Image accessibilityLabel={`${title} ikonu`} source={{ uri }} style={[styles.image, { width: size, height: size, borderRadius: size * 0.2 }]} />;
  }

  return (
    <View accessibilityLabel={`${title} için varsayılan ikon`} style={[styles.fallback, { width: size, height: size, borderRadius: size * 0.2 }]}>
      <Text style={[styles.letter, { fontSize: size * 0.42 }]}>{title.trim().charAt(0).toUpperCase() || '?'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: colors.surfaceRaised },
  fallback: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  letter: { color: colors.background, fontWeight: '800' },
});
