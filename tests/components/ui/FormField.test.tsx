import { fireEvent, render, screen } from '@testing-library/react-native';

import { FormField } from '../../../src/components/ui/FormField';

describe('FormField', () => {
  it('associates its visible label, hint and error with the input', () => {
    const onChangeText = jest.fn();
    const view = render(
      <FormField
        error="E-posta gerekli."
        hint="Hesabında kullandığın adres"
        keyboardType="email-address"
        label="E-posta"
        onChangeText={onChangeText}
        value=""
      />,
    );

    const input = screen.getByLabelText('E-posta');
    expect(input.props.accessibilityHint).toBe('E-posta gerekli.');
    expect(input.props.keyboardType).toBe('email-address');
    expect(screen.getByText('E-posta gerekli.')).toBeTruthy();
    fireEvent.changeText(input, 'user@example.com');
    expect(onChangeText).toHaveBeenCalledWith('user@example.com');
    expect(view.toJSON()).toBeTruthy();
  });

  it('supports secure password entry metadata', () => {
    render(
      <FormField
        autoCapitalize="none"
        label="Şifre"
        secureTextEntry
        textContentType="password"
        value="secret"
      />,
    );

    const input = screen.getByLabelText('Şifre');
    expect(input.props.secureTextEntry).toBe(true);
    expect(input.props.textContentType).toBe('password');
    expect(input.props.autoCapitalize).toBe('none');
  });
});
