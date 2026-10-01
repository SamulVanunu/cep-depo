import { ActivityIndicator, Pressable, StyleSheet, type PressableProps } from 'react-native';

import { colors, radii, spacing } from '../../theme/tokens';
import { AppText } from './AppText';

type ButtonProps = Omit<PressableProps, 'children' | 'accessibilityRole'> & {
  label: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'text';
};

export function Button({ label, loading = false, disabled = false, variant = 'primary', style, ...props }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      {...props}
      accessibilityLabel={props.accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: isDisabled }}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        typeof style === 'function' ? style({ pressed }) : style,
      ]}
    >
      {loading ? <ActivityIndicator color={variant === 'primary' ? colors.background : colors.accent} /> : <AppText tone="accent" style={variant === 'primary' ? styles.primaryLabel : undefined}>{label}</AppText>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { color: colors.background, fontWeight: '700' },
  secondary: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  text: { paddingHorizontal: spacing.sm },
  pressed: { opacity: 0.78 },
  disabled: { opacity: 0.5 },
});
