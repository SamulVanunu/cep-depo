import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { ReviewForm } from '../../../src/features/reviews/ReviewForm';
import type { Review } from '../../../src/features/reviews/review.types';

const existingReview: Review = {
  id: 'review-1',
  appId: 'app-1',
  userId: 'user-1',
  username: 'User.One',
  avatarPath: null,
  rating: 4,
  body: 'Mevcut yorum',
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
};

describe('ReviewForm', () => {
  it('submits a rating without requiring review text', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<ReviewForm isPending={false} onDelete={jest.fn()} onSave={onSave} review={null} />);

    fireEvent.press(screen.getByRole('radio', { name: '5 yıldız' }));
    fireEvent.press(screen.getByRole('button', { name: 'Değerlendirmeyi kaydet' }));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ rating: 5, body: '' }));
  });

  it('validates trimmed optional body at 3–2000 characters', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<ReviewForm isPending={false} onDelete={jest.fn()} onSave={onSave} review={null} />);
    fireEvent.press(screen.getByRole('radio', { name: '4 yıldız' }));

    fireEvent.changeText(screen.getByLabelText('Yorum (isteğe bağlı)'), ' ab ');
    fireEvent.press(screen.getByRole('button', { name: 'Değerlendirmeyi kaydet' }));
    expect(screen.getByText('Yorum boş bırakılmalı veya en az 3 karakter olmalıdır.')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.changeText(screen.getByLabelText('Yorum (isteğe bağlı)'), 'a'.repeat(2001));
    fireEvent.press(screen.getByRole('button', { name: 'Değerlendirmeyi kaydet' }));
    expect(screen.getByText('Yorum en fazla 2000 karakter olabilir.')).toBeTruthy();
  });

  it('prefills an existing review for editing', () => {
    render(
      <ReviewForm
        isPending={false}
        onDelete={jest.fn()}
        onSave={jest.fn()}
        review={existingReview}
      />,
    );

    expect(screen.getByLabelText('Yorum (isteğe bağlı)').props.value).toBe('Mevcut yorum');
    expect(screen.getByRole('radio', { name: '4 yıldız' }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('button', { name: 'Değerlendirmeyi güncelle' })).toBeTruthy();
  });

  it('requires explicit confirmation before deleting', async () => {
    const onDelete = jest.fn().mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
    render(
      <ReviewForm
        isPending={false}
        onDelete={onDelete}
        onSave={jest.fn()}
        review={existingReview}
      />,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Değerlendirmeyi sil' }));
    expect(onDelete).not.toHaveBeenCalled();
    const confirm = alert.mock.calls[0]?.[2]?.find(button => button.style === 'destructive');
    await act(async () => confirm?.onPress?.());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('prevents a duplicate save while the first submission is pending', async () => {
    let resolveSave: (() => void) | undefined;
    const onSave = jest.fn(
      () => new Promise<void>(resolve => {
        resolveSave = resolve;
      }),
    );
    render(<ReviewForm isPending={false} onDelete={jest.fn()} onSave={onSave} review={null} />);
    fireEvent.press(screen.getByRole('radio', { name: '5 yıldız' }));

    fireEvent.press(screen.getByRole('button', { name: 'Değerlendirmeyi kaydet' }));
    fireEvent.press(screen.getByRole('button', { name: 'Değerlendirmeyi kaydet' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => resolveSave?.());
  });

  it('shows a Turkish safe error without leaking thrown details', async () => {
    const onSave = jest.fn().mockRejectedValue(new Error('reviews policy secret detail'));
    render(<ReviewForm isPending={false} onDelete={jest.fn()} onSave={onSave} review={null} />);
    fireEvent.press(screen.getByRole('radio', { name: '3 yıldız' }));
    fireEvent.press(screen.getByRole('button', { name: 'Değerlendirmeyi kaydet' }));

    await waitFor(() =>
      expect(screen.getByText('Değerlendirme kaydedilemedi. Lütfen tekrar deneyin.')).toBeTruthy(),
    );
    expect(screen.queryByText(/policy|secret/i)).toBeNull();
  });
});
