import { fireEvent, render } from '@testing-library/react-native';

import { ScreenState } from '../../../src/components/ui/ScreenState';

describe('ScreenState', () => {
  it('renders an error state with a named retry action', () => {
    const onRetry = jest.fn();
    const rendered = render(
      <ScreenState
        kind="error"
        title="Uygulamalar yüklenemedi."
        message="Bağlantını kontrol edip yeniden deneyebilirsin."
        onRetry={onRetry}
      />,
    );

    expect(rendered.getByText('Uygulamalar yüklenemedi.')).toBeTruthy();
    fireEvent.press(rendered.getByRole('button', { name: 'Tekrar dene' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('announces loading without rendering a retry action', () => {
    const rendered = render(<ScreenState kind="loading" title="Katalog yükleniyor" />);

    expect(rendered.getByRole('progressbar', { name: 'Katalog yükleniyor' })).toBeTruthy();
    expect(rendered.queryByRole('button')).toBeNull();
  });
});
