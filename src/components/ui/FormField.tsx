import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radii, spacing } from '../../theme/tokens';
import { AppText } from './AppText';

type FormFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  error?: string | null;
  hint?: string;
};

export function FormField({ label, error, hint, ...inputProps }: FormFieldProps) {
  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <TextInput
        accessibilityHint={error ?? hint}
        accessibilityLabel={label}
        placeholderTextColor={colors.textSubtle}
        style={[styles.input, error ? styles.inputError : undefined]}
        {...inputProps}
      />
      {error ? (
        <AppText accessibilityLiveRegion="polite" tone="danger" variant="label">
          {error}
        </AppText>
      ) : hint ? (
        <AppText tone="subtle" variant="label">{hint}</AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.sm },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
  },
  inputError: { borderColor: colors.danger },
});
