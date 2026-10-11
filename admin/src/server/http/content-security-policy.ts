function connectionOrigins(supabaseUrl: string): string[] {
  const url = new URL(supabaseUrl);
  const origins = [url.origin];
  if (url.hostname.endsWith('.supabase.co')) {
    const project = url.hostname.split('.')[0];
    origins.push(`https://${project}.storage.supabase.co`);
  }
  return origins;
}

export function contentSecurityPolicy(
  nonce: string,
  supabaseUrl: string,
  development: boolean,
): string {
  const origins = connectionOrigins(supabaseUrl);
  const developmentScript = development ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${developmentScript}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${origins[0]}`,
    `connect-src 'self' ${origins.join(' ')}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}
