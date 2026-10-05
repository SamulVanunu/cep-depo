import { type Href, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { colors, radii, spacing } from '../../theme/tokens';
import { useAuth } from '../auth/auth-context';
import { useMyProfile } from '../profile/profile.queries';
import { ReportRepositoryError } from './report.repository';
import { useOpenReport, useSubmitReport } from './report.queries';
import type { ReportReason, ReportTarget } from './report.types';
import { reportReasonOptions, validateReportDescription } from './report.validation';

type ReportSheetProps = {
  target: ReportTarget;
  visible: boolean;
  onDismiss(): void;
};

export function ReportSheet({ target, visible, onDismiss }: ReportSheetProps) {
  const router = useRouter();
  const auth = useAuth();
  const userId = auth.status === 'signedIn' ? auth.user?.id : undefined;
  const profile = useMyProfile(userId);
  const open = useOpenReport(target);
  const submit = useSubmitReport(target);
  const submitting = useRef(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [localPending, setLocalPending] = useState(false);

  async function send() {
    if (submitting.current || submit.isPending || open.alreadyOpen) return;
    if (!reason) {
      setError('Lütfen bir şikâyet nedeni seçin.');
      return;
    }
    const descriptionError = validateReportDescription(description);
    if (descriptionError) {
      setError(descriptionError);
      return;
    }
    submitting.current = true;
    setLocalPending(true);
    setError(null);
    try {
      await submit.mutateAsync({ reason, description });
      setSuccess(true);
    } catch (caught) {
      setError(
        caught instanceof ReportRepositoryError && caught.code === 'alreadyOpen'
          ? 'Bu hedef için açık bir şikâyetin zaten var.'
          : 'Şikâyet gönderilemedi. Lütfen tekrar deneyin.',
      );
    } finally {
      submitting.current = false;
      setLocalPending(false);
    }
  }

  const confirmed = Boolean(auth.user?.email_confirmed_at);
  const active = profile.data?.status === 'active';
  const pending = localPending || submit.isPending;

  return (
    <Modal
      animationType="slide"
      onRequestClose={onDismiss}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <AppText accessibilityRole="header" variant="title">Şikâyet bildir</AppText>
            <AppText>{target.appTitle}</AppText>
            <AppText tone="muted">
              {target.versionName ? `Sürüm ${target.versionName}` : 'Uygulama geneli'}
            </AppText>
          </View>
          <Button
            accessibilityLabel="Şikâyet penceresini kapat"
            label="Kapat"
            onPress={onDismiss}
            variant="text"
          />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {auth.status === 'signedOut' ? (
            <Button
              label="Şikâyet için giriş yap"
              onPress={() => router.push('/auth/sign-in' as Href)}
            />
          ) : null}

          {auth.status === 'signedIn' && !confirmed ? (
            <View style={styles.feedback}>
              <AppText tone="muted">Şikâyet göndermek için e-postanı doğrula.</AppText>
              <Button
                label="E-postayı doğrula"
                onPress={() =>
                  router.push({
                    pathname: '/auth/confirm',
                    params: { email: auth.user?.email ?? '' },
                  } as Href)
                }
                variant="secondary"
              />
            </View>
          ) : null}

          {auth.status === 'signedIn' && confirmed && profile.data?.status === 'suspended' ? (
            <AppText tone="danger">Hesabın askıya alındığı için şikâyet gönderemezsin.</AppText>
          ) : null}

          {auth.status === 'signedIn' && confirmed && active ? (
            open.isPending ? (
              <AppText tone="muted">Açık şikâyet kontrol ediliyor…</AppText>
            ) : open.alreadyOpen ? (
              <AppText tone="muted">Bu hedef için açık bir şikâyetin zaten var.</AppText>
            ) : success ? (
              <View style={styles.feedback}>
                <AppText tone="accent" variant="title">Şikâyetin alındı.</AppText>
                <Button label="Kapat" onPress={onDismiss} variant="secondary" />
              </View>
            ) : (
              <View style={styles.form}>
                <AppText variant="label">Neden</AppText>
                {reportReasonOptions.map(option => {
                  const checked = reason === option.value;
                  return (
                    <Pressable
                      accessibilityLabel={option.label}
                      accessibilityRole="radio"
                      accessibilityState={{ checked, disabled: pending }}
                      disabled={pending}
                      key={option.value}
                      onPress={() => {
                        setReason(option.value);
                        setError(null);
                      }}
                      style={[styles.reason, checked ? styles.reasonSelected : undefined]}
                    >
                      <AppText tone={checked ? 'accent' : 'primary'}>{option.label}</AppText>
                    </Pressable>
                  );
                })}
                <FormField
                  editable={!pending}
                  error={error}
                  label="Açıklama (isteğe bağlı)"
                  multiline
                  onChangeText={setDescription}
                  value={description}
                />
                <Button label="Şikâyeti gönder" loading={pending} onPress={() => void send()} />
              </View>
            )
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerCopy: { flex: 1, gap: spacing.xs },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  feedback: { gap: spacing.md },
  form: { gap: spacing.md },
  reason: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  reasonSelected: { borderColor: colors.accent },
});
