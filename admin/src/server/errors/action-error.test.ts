import { describe, expect, it } from 'vitest';

import { ActionException, toActionError } from './action-error';

describe('toActionError', () => {
  it('preserves an intentional public action failure', () => {
    expect(toActionError(new ActionException('FORBIDDEN'))).toMatchObject({
      code: 'FORBIDDEN',
      message: 'Bu işlem için yetkin bulunmuyor.',
    });
  });

  it('maps a unique conflict without exposing database details', () => {
    const error = toActionError({ code: '23505', message: 'duplicate secret row value' });

    expect(error).toMatchObject({
      code: 'CONFLICT',
      message: 'Bu bilgilerle çakışan bir kayıt zaten var.',
    });
    expect(JSON.stringify(error)).not.toContain('duplicate secret row value');
  });

  it('maps temporary upstream failures to a retryable safe error', () => {
    expect(toActionError({ status: 503, message: 'upstream internals' })).toMatchObject({
      code: 'TEMPORARY',
      message: 'İşlem geçici olarak tamamlanamadı. Lütfen yeniden dene.',
    });
  });

  it('sanitizes unknown errors and adds a correlation id', () => {
    const error = toActionError(new Error('SUPABASE_SECRET_KEY=do-not-leak'));

    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('Beklenmeyen bir hata oluştu. Lütfen yeniden dene.');
    expect(error.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(error)).not.toContain('do-not-leak');
  });
});
