import { StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { colors, spacing } from '../../theme/tokens';

type LogoMarkProps = { accessibilityLabel?: string };

export function LogoMark({ accessibilityLabel }: LogoMarkProps) {
  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={styles.container}>
      <AppText variant="display" style={styles.wordmark}>
        cep depo<AppText tone="accent" variant="display">.</AppText>
      </AppText>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', padding: spacing.xl },
  wordmark: { letterSpacing: -1.4 },
  rule: { width: 36, height: 3, marginTop: spacing.md, backgroundColor: colors.accent },
});
