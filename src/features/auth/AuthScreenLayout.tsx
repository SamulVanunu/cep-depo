import type { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '../../components/ui/AppText';
import { colors, spacing } from '../../theme/tokens';

type AuthScreenLayoutProps = PropsWithChildren<{
  title: string;
  description: string;
}>;

export function AuthScreenLayout({ title, description, children }: AuthScreenLayoutProps) {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <AppText accessibilityRole="header" variant="display">{title}</AppText>
        <AppText tone="muted" style={styles.description}>{description}</AppText>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export const authScreenStyles = StyleSheet.create({
  form: { gap: spacing.lg, marginTop: spacing.xxl },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
  feedback: { marginTop: spacing.lg },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.xl, paddingBottom: spacing.xxl },
  description: { marginTop: spacing.sm },
});
