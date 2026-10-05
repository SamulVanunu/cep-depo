import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { getSupabaseClient } from '../../lib/supabase';
import { AuthScreenLayout, authScreenStyles } from './AuthScreenLayout';
import { AuthFormError, mapAuthError } from './auth.errors';
import { createAuthRepository, type AuthRepository } from './auth.repository';
import { validateEmail, validatePassword } from './auth.validation';

type SignInScreenProps = {
  repository?: AuthRepository;
  onSignedIn: () => void;
  onSignUp: () => void;
  onForgotPassword: () => void;
};

export function SignInScreen({ repository, onSignedIn, onSignUp, onForgotPassword }: SignInScreenProps) {
  const auth = useMemo(() => repository ?? createAuthRepository(getSupabaseClient()), [repository]);
  const submitting = useRef(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (submitting.current) return;
    const nextEmailError = validateEmail(email);
    const nextPasswordError = validatePassword(password);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setFormError(null);
    if (nextEmailError || nextPasswordError) return;

    submitting.current = true;
    setLoading(true);
    try {
      await auth.signIn(email, password);
      onSignedIn();
    } catch (error) {
      setFormError(error instanceof AuthFormError ? error.message : mapAuthError(error).message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthScreenLayout description="Hesabına eriş ve topluluk özelliklerini kullan." title="Giriş yap">
      <View style={authScreenStyles.form}>
        <FormField autoCapitalize="none" autoCorrect={false} keyboardType="email-address" label="E-posta" onChangeText={setEmail} textContentType="emailAddress" value={email} error={emailError} />
        <FormField autoCapitalize="none" label="Şifre" onChangeText={setPassword} secureTextEntry textContentType="password" value={password} error={passwordError} />
        {formError ? <AppText tone="danger">{formError}</AppText> : null}
        <Button label="Giriş yap" loading={loading} onPress={() => void submit()} />
      </View>
      <View style={authScreenStyles.actions}>
        <Button label="Hesap oluştur" onPress={onSignUp} variant="text" />
        <Button label="Şifremi unuttum" onPress={onForgotPassword} variant="text" />
      </View>
    </AuthScreenLayout>
  );
}
