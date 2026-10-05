import { fireEvent, render, screen } from '@testing-library/react-native';

import { RatingSummary } from '../../../src/features/reviews/RatingSummary';
import { StarRatingInput } from '../../../src/features/reviews/StarRatingInput';

describe('RatingSummary', () => {
  it('shows the explicit zero-review state', () => {
    render(<RatingSummary summary={{ average: null, count: 0 }} />);
    expect(screen.getByText('Henüz puan yok')).toBeTruthy();
  });

  it('formats the average to one decimal with the review count', () => {
    render(<RatingSummary summary={{ average: 4.26, count: 12 }} />);
    expect(screen.getByText('4.3 / 5')).toBeTruthy();
    expect(screen.getByText('12 değerlendirme')).toBeTruthy();
  });
});

describe('StarRatingInput', () => {
  it('exposes five 44-point radio-like controls with checked state', () => {
    const onChange = jest.fn();
    render(<StarRatingInput onChange={onChange} value={3} />);

    const stars = screen.getAllByRole('radio');
    expect(stars).toHaveLength(5);
    expect(screen.getByRole('radio', { name: '3 yıldız' }).props.accessibilityState).toEqual(
      expect.objectContaining({ checked: true }),
    );
    expect(screen.getByRole('radio', { name: '5 yıldız' }).props.style).toEqual(
      expect.objectContaining({ minWidth: 44, minHeight: 44 }),
    );
    fireEvent.press(screen.getByRole('radio', { name: '5 yıldız' }));
    expect(onChange).toHaveBeenCalledWith(5);
  });
});
