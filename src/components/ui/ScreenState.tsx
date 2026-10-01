import { StyleSheet, View } from 'react-native';

import { colors, spacing } from '../../theme/tokens';
import { AppText } from './AppText';
import { Button } from './Button';

type ScreenStateProps = {
  kind: 'loading' | 'error' | 'empty';
  title: string;
  message?: string;
  onRetry?: () => void;
};

export function ScreenState({ kind, title, message, onRetry }: ScreenStateProps) {
  return (
    <View style={styles.container}>
      {kind === 'loading' ? <View accessible accessibilityLabel={title} accessibilityRole="progressbar" style={styles.progress} /> : null}
      <AppText accessibilityRole="header" style={styles.title}>{title}</AppText>
      {message ? <AppText tone="muted" style={styles.message}>{message}</AppText> : null}
      {kind === 'error' && onRetry ? <Button label="Tekrar dene" onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, minHeight: 180 },
  progress: { width: 48, height: 4, borderRadius: 2, backgroundColor: colors.accent, marginBottom: spacing.lg },
  title: { textAlign: 'center' },
  message: { textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.lg },
});
