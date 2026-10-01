import { fireEvent, render } from '@testing-library/react-native';

import { Button } from '../../../src/components/ui/Button';

describe('Button', () => {
  it('prevents duplicate presses while loading', () => {
    const onPress = jest.fn();
    const rendered = render(<Button label="APK İNDİR" loading onPress={onPress} />);

    fireEvent.press(rendered.getByRole('button'));

    expect(onPress).not.toHaveBeenCalled();
    expect(rendered.getByRole('button').props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });
  });

  it('announces and invokes an enabled action', () => {
    const onPress = jest.fn();
    const rendered = render(<Button label="Tekrar dene" onPress={onPress} />);

    fireEvent.press(rendered.getByRole('button', { name: 'Tekrar dene' }));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
