import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { getSupabaseClient } from '../../lib/supabase';
import { AuthScreenLayout, authScreenStyles } from './AuthScreenLayout';
import { AuthFormError, mapAuthError } from './auth.errors';
import { createAuthRepository, type AuthRepository } from './auth.repository';
import { validateEmail } from './auth.validation';

type ForgotPasswordScreenProps = { repository?: AuthRepository; onBack: () => void };

export function ForgotPasswordScreen({ repository, onBack }: ForgotPasswordScreenProps) {
  const auth = useMemo(() => repository ?? createAuthRepository(getSupabaseClient()), [repository]);
  const submitting = useRef(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (submitting.current) return;
    const validationError = validateEmail(email);
    setError(validationError);
    if (validationError) return;
    submitting.current = true;
    setLoading(true);
    try {
      await auth.requestPasswordReset(email);
      setSuccess(true);
    } catch (caught) {
      setError(caught instanceof AuthFormError ? caught.message : mapAuthError(caught).message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthScreenLayout description="E-postana güvenli bir şifre yenileme bağlantısı gönderelim." title="Şifreni sıfırla">
      {success ? (
        <AppText style={authScreenStyles.feedback}>Adres kayıtlıysa şifre sıfırlama bağlantısı gönderildi.</AppText>
      ) : (
        <View style={authScreenStyles.form}>
          <FormField autoCapitalize="none" autoCorrect={false} error={error} keyboardType="email-address" label="E-posta" onChangeText={setEmail} textContentType="emailAddress" value={email} />
          <Button label="Sıfırlama bağlantısı gönder" loading={loading} onPress={() => void submit()} />
        </View>
      )}
      <View style={authScreenStyles.actions}><Button label="Giriş ekranına dön" onPress={onBack} variant="text" /></View>
    </AuthScreenLayout>
  );
}
