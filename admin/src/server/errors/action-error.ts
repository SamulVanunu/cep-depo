export type ActionErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'READ_ONLY'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'TEMPORARY'
  | 'INTERNAL';

export type ActionError = Readonly<{
  code: ActionErrorCode;
  message: string;
  correlationId: string;
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
}>;

export type ActionResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; error: ActionError }>;

const publicMessages: Readonly<Record<ActionErrorCode, string>> = {
  UNAUTHENTICATED: 'Devam etmek için yeniden giriş yapmalısın.',
  FORBIDDEN: 'Bu işlem için yetkin bulunmuyor.',
  READ_ONLY: 'Bu ortamda değişiklik yapma işlemleri kapalı.',
  VALIDATION: 'Gönderilen bilgiler geçerli değil.',
  CONFLICT: 'Bu bilgilerle çakışan bir kayıt zaten var.',
  NOT_FOUND: 'İstenen kayıt bulunamadı.',
  TEMPORARY: 'İşlem geçici olarak tamamlanamadı. Lütfen yeniden dene.',
  INTERNAL: 'Beklenmeyen bir hata oluştu. Lütfen yeniden dene.',
};

function correlationId(): string {
  return crypto.randomUUID();
}

export class ActionException extends Error {
  readonly code: ActionErrorCode;
  readonly correlationId: string;
  readonly fieldErrors?: Readonly<Record<string, readonly string[]>>;

  constructor(
    code: ActionErrorCode,
    options: Readonly<{
      correlationId?: string;
      fieldErrors?: Readonly<Record<string, readonly string[]>>;
    }> = {},
  ) {
    super(publicMessages[code]);
    this.name = 'ActionException';
    this.code = code;
    this.correlationId = options.correlationId ?? correlationId();
    this.fieldErrors = options.fieldErrors;
  }
}

type UnknownServiceError = Readonly<{
  code?: unknown;
  status?: unknown;
}>;

function serviceErrorCode(error: unknown): ActionErrorCode {
  if (!error || typeof error !== 'object') return 'INTERNAL';

  const candidate = error as UnknownServiceError;
  if (candidate.code === '23505' || candidate.status === 409) return 'CONFLICT';
  if (candidate.code === 'PGRST116' || candidate.status === 404) return 'NOT_FOUND';
  if (candidate.status === 400 || candidate.status === 422) return 'VALIDATION';
  if (candidate.status === 401) return 'UNAUTHENTICATED';
  if (candidate.status === 403) return 'FORBIDDEN';
  if (
    candidate.status === 429 ||
    candidate.status === 502 ||
    candidate.status === 503 ||
    candidate.status === 504
  ) {
    return 'TEMPORARY';
  }

  return 'INTERNAL';
}

export function toActionError(error: unknown): ActionError {
  if (error instanceof ActionException) {
    return {
      code: error.code,
      message: error.message,
      correlationId: error.correlationId,
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
    };
  }

  const code = serviceErrorCode(error);
  return {
    code,
    message: publicMessages[code],
    correlationId: correlationId(),
  };
}
