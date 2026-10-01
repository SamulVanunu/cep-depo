import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '../../theme/tokens';

type SkeletonProps = { width?: number | `${number}%`; height?: number; radius?: number };

export function Skeleton({ width = '100%', height = 16, radius = radii.sm }: SkeletonProps) {
  return <View accessibilityLabel="İçerik yükleniyor" style={[styles.base, { width, height, borderRadius: radius }]} />;
}

const styles = StyleSheet.create({ base: { backgroundColor: colors.surfaceRaised, marginBottom: spacing.sm } });
