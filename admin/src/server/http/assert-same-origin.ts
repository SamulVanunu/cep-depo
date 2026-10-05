import { ActionException } from '../errors/action-error';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function assertSameOrigin(request: Request, siteUrl: string): void {
  if (safeMethods.has(request.method.toUpperCase())) return;

  try {
    const configuredOrigin = new URL(siteUrl).origin;
    const requestOrigin = new URL(request.headers.get('origin') ?? '').origin;

    if (requestOrigin === configuredOrigin) return;
  } catch {
    // Invalid and missing origins fail closed below.
  }

  throw new ActionException('FORBIDDEN');
}
