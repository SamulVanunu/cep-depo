import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { getSupabaseClient } from '../../lib/supabase';
import { AuthScreenLayout, authScreenStyles } from './AuthScreenLayout';
import { AuthFormError, mapAuthError } from './auth.errors';
import { createAuthRepository, type AuthRepository } from './auth.repository';
import { validateEmail, validatePassword, validatePasswordConfirmation, validateUsername } from './auth.validation';

type SignUpScreenProps = {
  repository?: AuthRepository;
  onConfirmationRequired: (email: string) => void;
  onSignIn: () => void;
};

export function SignUpScreen({ repository, onConfirmationRequired, onSignIn }: SignUpScreenProps) {
  const auth = useMemo(() => repository ?? createAuthRepository(getSupabaseClient()), [repository]);
  const submitting = useRef(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  async function submit() {
    if (submitting.current) return;
    const nextErrors = {
      username: validateUsername(username),
      email: validateEmail(email),
      password: validatePassword(password),
      confirmation: validatePasswordConfirmation(password, confirmation),
    };
    setErrors(nextErrors);
    setFormError(null);
    if (Object.values(nextErrors).some(Boolean)) return;

    submitting.current = true;
    setLoading(true);
    try {
      await auth.signUp({ username, email, password });
      setSubmittedEmail(email.trim().toLowerCase());
    } catch (error) {
      const mapped = error instanceof AuthFormError ? error : mapAuthError(error);
      if (mapped.field) setErrors(current => ({ ...current, [mapped.field!]: mapped.message }));
      else setFormError(mapped.message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  if (submittedEmail) {
    return (
      <AuthScreenLayout description="Topluluk özelliklerini açmak için e-posta adresini doğrula." title="E-postanı kontrol et">
        <AppText style={authScreenStyles.feedback}>Doğrulama e-postası gönderildi.</AppText>
        <View style={authScreenStyles.actions}>
          <Button label="Doğrulama ekranına git" onPress={() => onConfirmationRequired(submittedEmail)} />
          <Button label="Giriş ekranına dön" onPress={onSignIn} variant="text" />
        </View>
      </AuthScreenLayout>
    );
  }

  return (
    <AuthScreenLayout description="Yorum, puan ve şikâyet özellikleri için hesabını oluştur." title="Hesap oluştur">
      <View style={authScreenStyles.form}>
        <FormField autoCapitalize="none" autoCorrect={false} error={errors.username} label="Kullanıcı adı" onChangeText={setUsername} value={username} />
        <FormField autoCapitalize="none" autoCorrect={false} error={errors.email} keyboardType="email-address" label="E-posta" onChangeText={setEmail} textContentType="emailAddress" value={email} />
        <FormField autoCapitalize="none" error={errors.password} label="Şifre" onChangeText={setPassword} secureTextEntry textContentType="newPassword" value={password} />
        <FormField autoCapitalize="none" error={errors.confirmation} label="Şifre tekrarı" onChangeText={setConfirmation} secureTextEntry textContentType="newPassword" value={confirmation} />
        {formError ? <AppText tone="danger">{formError}</AppText> : null}
        <Button label="Hesap oluştur" loading={loading} onPress={() => void submit()} />
      </View>
      <View style={authScreenStyles.actions}><Button label="Zaten hesabım var" onPress={onSignIn} variant="text" /></View>
    </AuthScreenLayout>
  );
}
