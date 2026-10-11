export function resumableUploadEndpoint(supabaseUrl: string): string {
  const url = new URL(supabaseUrl);
  const suffix = '/storage/v1/upload/resumable/sign';
  if (!url.hostname.endsWith('.supabase.co')) return `${url.origin}${suffix}`;
  const project = url.hostname.split('.')[0];
  return `https://${project}.storage.supabase.co${suffix}`;
}
