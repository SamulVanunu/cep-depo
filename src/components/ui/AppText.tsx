import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, typography } from '../../theme/tokens';

type AppTextProps = TextProps & {
  tone?: 'primary' | 'muted' | 'subtle' | 'accent' | 'danger';
  variant?: 'body' | 'label' | 'title' | 'display';
};

export function AppText({ tone = 'primary', variant = 'body', style, ...props }: AppTextProps) {
  return <Text style={[styles.base, styles[variant], { color: colors[toneColor[tone]] }, style]} {...props} />;
}

const toneColor = {
  primary: 'text',
  muted: 'textMuted',
  subtle: 'textSubtle',
  accent: 'accent',
  danger: 'danger',
} as const;

const styles = StyleSheet.create({
  base: { fontWeight: '400' },
  body: { fontSize: typography.body, lineHeight: typography.bodyLineHeight },
  label: { fontSize: typography.label, lineHeight: 18, fontWeight: '600' },
  title: { fontSize: typography.title, lineHeight: 30, fontWeight: '700' },
  display: { fontSize: typography.display, lineHeight: 40, fontWeight: '800' },
});
