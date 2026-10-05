import { mapAuthError } from '../../../src/features/auth/auth.errors';
import {
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
  validateUsername,
} from '../../../src/features/auth/auth.validation';

describe('auth validation', () => {
  it.each(['Abc', 'Çağrı_Öz', 'user.name', 'İpek34', 'a'.repeat(30)])(
    'accepts valid username %s',
    username => {
      expect(validateUsername(username)).toBeNull();
    },
  );

  it.each(['ab', 'a'.repeat(31), '.name', 'name_', 'bad..name', 'bad-_name', 'ad soyad']) (
    'rejects invalid username %s',
    username => {
      expect(validateUsername(username)).toMatch(/Kullanıcı adı/);
    },
  );

  it('validates a normalized email without exposing the original value', () => {
    expect(validateEmail('  USER@example.com ')).toBeNull();
    expect(validateEmail('not-an-email')).toBe('Geçerli bir e-posta adresi girin.');
  });

  it('validates password length and confirmation independently', () => {
    expect(validatePassword('12345')).toBe('Şifre en az 6 karakter olmalıdır.');
    expect(validatePassword('123456')).toBeNull();
    expect(validatePasswordConfirmation('123456', '654321')).toBe('Şifreler eşleşmiyor.');
    expect(validatePasswordConfirmation('123456', '123456')).toBeNull();
  });
});

describe('mapAuthError', () => {
  it('maps a duplicate username to a safe field error', () => {
    const result = mapAuthError(
      { code: '23505', message: 'duplicate key profiles_username_key https://secret.example' },
      'username',
    );

    expect(result.field).toBe('username');
    expect(result.message).toBe('Bu kullanıcı adı kullanılıyor.');
    expect(result.message).not.toContain('profiles_username_key');
    expect(result.message).not.toContain('https://');
  });

  it('maps invalid credentials without account enumeration', () => {
    const result = mapAuthError({ code: 'invalid_credentials', message: 'Invalid login' });

    expect(result.message).toBe('E-posta veya şifre hatalı.');
    expect(result.field).toBeUndefined();
  });

  it('maps rate limits, network failures and unknown errors to Turkish safe copy', () => {
    expect(mapAuthError({ status: 429, message: 'rate limit raw' }).message).toBe(
      'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.',
    );
    expect(mapAuthError(new TypeError('Failed to fetch https://secret.example')).message).toBe(
      'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.',
    );
    const unknown = mapAuthError(new Error('relation profiles does not exist'));
    expect(unknown.message).toBe('İşlem tamamlanamadı. Lütfen tekrar deneyin.');
    expect(unknown.message).not.toContain('profiles');
  });
});
