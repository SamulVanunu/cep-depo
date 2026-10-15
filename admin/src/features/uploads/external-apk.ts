import { HOSTED_STORAGE_MAX_BYTES } from './upload-schema';

export { HOSTED_STORAGE_MAX_BYTES };

const INVALID_EXTERNAL_APK_URL = 'Geçerli bir herkese açık HTTPS APK bağlantısı gir.';
const INVALID_LOCAL_APK = 'Seçilen dosya geçerli bir APK değil.';
const NON_PUBLIC_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.home.arpa',
  '.corp',
  '.private',
  '.test',
  '.invalid',
  '.onion',
] as const;

function invalidUrl(): never {
  throw new Error(INVALID_EXTERNAL_APK_URL);
}

function ipv4Bytes(hostname: string): readonly number[] | null {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) return null;
  const bytes = parts.map(Number);
  return bytes.every(byte => byte >= 0 && byte <= 255) ? bytes : null;
}

function isPublicIpv4(bytes: readonly number[]): boolean {
  const [a, b] = bytes;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function ipv6Words(hostname: string): readonly number[] | null {
  const value = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!value.includes(':') || value.includes('%')) return null;
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (halves.length === 1 && left.length !== 8) return null;
  if (halves.length === 2 && left.length + right.length >= 8) return null;
  const missing = halves.length === 2 ? 8 - left.length - right.length : 0;
  const words = [...left, ...Array.from({ length: missing }, () => '0'), ...right];
  if (words.length !== 8 || words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.map(word => Number.parseInt(word, 16));
}

function isPublicIpv6(words: readonly number[]): boolean {
  const [first, second] = words;
  if ((first & 0xfe00) === 0xfc00) return false;
  if ((first & 0xffc0) === 0xfe80) return false;
  if ((first & 0xff00) === 0xff00) return false;
  if (first === 0x2001 && second === 0x0db8) return false;

  const firstSixAreZero = words.slice(0, 6).every(word => word === 0);
  if (firstSixAreZero) return false;

  const mappedIpv4 = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
  if (mappedIpv4) {
    const bytes = [words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff];
    return isPublicIpv4(bytes);
  }
  return true;
}

function publicHostname(rawHostname: string): string {
  const hostname = rawHostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  const ipv4 = ipv4Bytes(hostname);
  if (ipv4) return isPublicIpv4(ipv4) ? hostname : invalidUrl();
  if (hostname.includes(':')) {
    const ipv6 = ipv6Words(hostname);
    return ipv6 && isPublicIpv6(ipv6) ? hostname : invalidUrl();
  }
  if (
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    NON_PUBLIC_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
  ) invalidUrl();
  return hostname;
}

export function parseExternalApkUrl(raw: string): Readonly<{ url: string; hostname: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return invalidUrl();
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) invalidUrl();

  const hostname = publicHostname(url.hostname);
  if (!url.hostname.includes(':')) url.hostname = hostname;
  return Object.freeze({ url: url.toString(), hostname });
}

export async function verifyLocalApkMagic(file: Blob): Promise<void> {
  const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (
    bytes.length !== 4 ||
    bytes[0] !== 0x50 ||
    bytes[1] !== 0x4b ||
    bytes[2] !== 0x03 ||
    bytes[3] !== 0x04
  ) {
    throw new Error(INVALID_LOCAL_APK);
  }
}
