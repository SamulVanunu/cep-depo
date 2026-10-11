export function storageAuthHeaders(secretKey: string): Record<string, string> {
  return secretKey.startsWith('sb_secret_')
    ? { apikey: secretKey }
    : { Authorization: `Bearer ${secretKey}` };
}
