import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { getSupabaseClient } from '../../lib/supabase';
import { AuthScreenLayout, authScreenStyles } from './AuthScreenLayout';
import { AuthFormError, mapAuthError } from './auth.errors';
import { createAuthRepository, type AuthRepository } from './auth.repository';
import { validatePassword, validatePasswordConfirmation } from './auth.validation';

type ResetPasswordScreenProps = { repository?: AuthRepository; onComplete: () => void };

export function ResetPasswordScreen({ repository, onComplete }: ResetPasswordScreenProps) {
  const auth = useMemo(() => repository ?? createAuthRepository(getSupabaseClient()), [repository]);
  const submitting = useRef(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (submitting.current) return;
    const nextPasswordError = validatePassword(password);
    const nextConfirmationError = validatePasswordConfirmation(password, confirmation);
    setPasswordError(nextPasswordError);
    setConfirmationError(nextConfirmationError);
    setFormError(null);
    if (nextPasswordError || nextConfirmationError) return;
    submitting.current = true;
    setLoading(true);
    try {
      await auth.updatePassword(password);
      onComplete();
    } catch (caught) {
      setFormError(caught instanceof AuthFormError ? caught.message : mapAuthError(caught).message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthScreenLayout description="Hesabın için yeni bir şifre belirle." title="Yeni şifre">
      <View style={authScreenStyles.form}>
        <FormField autoCapitalize="none" error={passwordError} label="Yeni şifre" onChangeText={setPassword} secureTextEntry textContentType="newPassword" value={password} />
        <FormField autoCapitalize="none" error={confirmationError} label="Yeni şifre tekrarı" onChangeText={setConfirmation} secureTextEntry textContentType="newPassword" value={confirmation} />
        {formError ? <AppText tone="danger">{formError}</AppText> : null}
        <Button label="Şifreyi güncelle" loading={loading} onPress={() => void submit()} />
      </View>
    </AuthScreenLayout>
  );
}
