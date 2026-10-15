import type { ApkSource } from '../catalog/catalog.types';
import { ApkDownloadError } from './apk-error';

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
  if (words.slice(0, 6).every(word => word === 0)) return false;
  const mappedIpv4 = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff;
  if (!mappedIpv4) return true;
  return isPublicIpv4([words[6] >> 8, words[6] & 0xff, words[7] >> 8, words[7] & 0xff]);
}

function requirePublicHttpsUrl(value: string): string {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (
      value.trim() !== value ||
      url.protocol !== 'https:' ||
      !hostname ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) throw new Error();

    const ipv4 = ipv4Bytes(hostname);
    if (ipv4 && !isPublicIpv4(ipv4)) throw new Error();
    if (hostname.includes(':')) {
      const ipv6 = ipv6Words(hostname);
      if (!ipv6 || !isPublicIpv6(ipv6)) throw new Error();
    } else if (
      !ipv4 && (
        !hostname.includes('.') ||
        hostname === 'localhost' ||
        NON_PUBLIC_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
      )
    ) throw new Error();
    return value;
  } catch {
    throw new ApkDownloadError('source');
  }
}

export function resolveApkSourceUrl(
  source: ApkSource,
  publicStorageUrl: (path: string) => string,
): string {
  if (source.kind === 'external') return requirePublicHttpsUrl(source.url);
  if (
    !source.path.startsWith('apps/') ||
    !source.path.endsWith('.apk') ||
    source.path.includes('..') ||
    source.path.includes('\\') ||
    source.path.includes('?') ||
    source.path.includes('#')
  ) throw new ApkDownloadError('source');
  return requirePublicHttpsUrl(publicStorageUrl(source.path));
}
