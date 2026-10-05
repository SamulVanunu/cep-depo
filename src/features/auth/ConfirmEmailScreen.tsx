import { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { getSupabaseClient } from '../../lib/supabase';
import { AuthScreenLayout, authScreenStyles } from './AuthScreenLayout';
import { AuthFormError, mapAuthError } from './auth.errors';
import { createAuthRepository, type AuthRepository } from './auth.repository';

type ConfirmEmailScreenProps = {
  email: string;
  repository?: AuthRepository;
  onContinue: () => void;
};

export function ConfirmEmailScreen({ email, repository, onContinue }: ConfirmEmailScreenProps) {
  const auth = useMemo(() => repository ?? createAuthRepository(getSupabaseClient()), [repository]);
  const submitting = useRef(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function resend() {
    if (submitting.current || !email) return;
    submitting.current = true;
    setLoading(true);
    setFeedback(null);
    setError(null);
    try {
      await auth.resendConfirmation(email);
      setFeedback('Doğrulama e-postası yeniden gönderildi.');
    } catch (caught) {
      setError(caught instanceof AuthFormError ? caught.message : mapAuthError(caught).message);
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <AuthScreenLayout description="E-postadaki bağlantıyı açtıktan sonra hesabına devam edebilirsin." title="E-posta doğrulama">
      <AppText style={authScreenStyles.feedback} tone="muted">{email || 'E-posta adresin'}</AppText>
      {feedback ? <AppText style={authScreenStyles.feedback}>{feedback}</AppText> : null}
      {error ? <AppText style={authScreenStyles.feedback} tone="danger">{error}</AppText> : null}
      <View style={authScreenStyles.actions}>
        <Button disabled={!email} label="E-postayı yeniden gönder" loading={loading} onPress={() => void resend()} />
        <Button label="Hesaba devam et" onPress={onContinue} variant="secondary" />
      </View>
    </AuthScreenLayout>
  );
}
