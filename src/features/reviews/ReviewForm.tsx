import { useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { colors, radii, spacing } from '../../theme/tokens';
import { StarRatingInput } from './StarRatingInput';
import type { Review, ReviewDraft } from './review.types';

type ReviewFormProps = {
  review: Review | null;
  isPending: boolean;
  onSave(draft: ReviewDraft): Promise<void>;
  onDelete(): Promise<void>;
};

type Rating = ReviewDraft['rating'];

export function ReviewForm({ review, isPending, onSave, onDelete }: ReviewFormProps) {
  const submitting = useRef(false);
  const [rating, setRating] = useState<Rating | 0>(
    (review?.rating as Rating | undefined) ?? 0,
  );
  const [body, setBody] = useState(review?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const [localPending, setLocalPending] = useState(false);

  async function save() {
    if (submitting.current || isPending) return;
    if (rating === 0) {
      setError('Lütfen 1 ile 5 arasında bir puan seçin.');
      return;
    }
    const trimmedBody = body.trim();
    if (trimmedBody.length > 0 && trimmedBody.length < 3) {
      setError('Yorum boş bırakılmalı veya en az 3 karakter olmalıdır.');
      return;
    }
    if (trimmedBody.length > 2000) {
      setError('Yorum en fazla 2000 karakter olabilir.');
      return;
    }

    submitting.current = true;
    setLocalPending(true);
    setError(null);
    try {
      await onSave({ rating, body: trimmedBody });
    } catch {
      setError('Değerlendirme kaydedilemedi. Lütfen tekrar deneyin.');
    } finally {
      submitting.current = false;
      setLocalPending(false);
    }
  }

  async function remove() {
    if (submitting.current || isPending) return;
    submitting.current = true;
    setLocalPending(true);
    setError(null);
    try {
      await onDelete();
      setRating(0);
      setBody('');
    } catch {
      setError('Değerlendirme silinemedi. Lütfen tekrar deneyin.');
    } finally {
      submitting.current = false;
      setLocalPending(false);
    }
  }

  function confirmDelete() {
    Alert.alert('Değerlendirmeyi sil?', 'Puanın ve yorumun kalıcı olarak silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: () => void remove() },
    ]);
  }

  const pending = isPending || localPending;
  return (
    <View style={styles.form}>
      <AppText variant="label">Puanın</AppText>
      <StarRatingInput disabled={pending} onChange={setRating} value={rating} />
      <FormField
        editable={!pending}
        error={error}
        label="Yorum (isteğe bağlı)"
        multiline
        onChangeText={setBody}
        placeholder="Deneyimini paylaş"
        value={body}
      />
      <Button
        label={review ? 'Değerlendirmeyi güncelle' : 'Değerlendirmeyi kaydet'}
        loading={pending}
        onPress={() => void save()}
      />
      {review ? (
        <Button
          disabled={pending}
          label="Değerlendirmeyi sil"
          onPress={confirmDelete}
          variant="text"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
});
