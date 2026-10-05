export type AuthField = 'username' | 'email' | 'password';

export class AuthFormError extends Error {
  readonly code: 'duplicate' | 'credentials' | 'rateLimit' | 'network' | 'unknown';
  readonly field?: AuthField;

  constructor(
    message: string,
    options: {
      code: AuthFormError['code'];
      field?: AuthField;
    },
  ) {
    super(message);
    this.name = 'AuthFormError';
    this.code = options.code;
    this.field = options.field;
  }
}

function errorProperties(error: unknown): { code?: string; status?: number } {
  if (!error || typeof error !== 'object') return {};
  const candidate = error as { code?: unknown; status?: unknown };
  return {
    code: typeof candidate.code === 'string' ? candidate.code : undefined,
    status: typeof candidate.status === 'number' ? candidate.status : undefined,
  };
}

export function mapAuthError(error: unknown, field?: AuthField): AuthFormError {
  const { code, status } = errorProperties(error);

  if (field === 'username' && code === '23505') {
    return new AuthFormError('Bu kullanıcı adı kullanılıyor.', {
      code: 'duplicate',
      field: 'username',
    });
  }

  if (code === 'invalid_credentials') {
    return new AuthFormError('E-posta veya şifre hatalı.', { code: 'credentials' });
  }

  if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return new AuthFormError('Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.', {
      code: 'rateLimit',
      field,
    });
  }

  if (error instanceof TypeError || code === 'network_error') {
    return new AuthFormError('Bağlantı kurulamadı. İnternet bağlantınızı kontrol edin.', {
      code: 'network',
      field,
    });
  }

  return new AuthFormError('İşlem tamamlanamadı. Lütfen tekrar deneyin.', {
    code: 'unknown',
    field,
  });
}
