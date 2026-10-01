import * as Linking from 'expo-linking';

type PublicLinkSource = Readonly<Record<string, string | undefined>>;

export type PublicLinks = Readonly<{
  privacy: string | null;
  terms: string | null;
  contact: string | null;
}>;

function defaultSource(): PublicLinkSource {
  return {
    EXPO_PUBLIC_PRIVACY_URL: process.env.EXPO_PUBLIC_PRIVACY_URL,
    EXPO_PUBLIC_TERMS_URL: process.env.EXPO_PUBLIC_TERMS_URL,
    EXPO_PUBLIC_CONTACT_URL: process.env.EXPO_PUBLIC_CONTACT_URL,
  };
}

function validHttps(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function validContact(value: string | undefined): string | null {
  const https = validHttps(value);
  if (https) return https;
  if (!value) return null;
  const normalized = value.trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(normalized)) return normalized;
  return null;
}

export function getPublicLinks(source: PublicLinkSource = defaultSource()): PublicLinks {
  return Object.freeze({
    privacy: validHttps(source.EXPO_PUBLIC_PRIVACY_URL),
    terms: validHttps(source.EXPO_PUBLIC_TERMS_URL),
    contact: validContact(source.EXPO_PUBLIC_CONTACT_URL),
  });
}

export async function openPublicLink(url: string): Promise<void> {
  if (!validHttps(url) && !validContact(url)) {
    throw new Error('Desteklenmeyen bağlantı adresi.');
  }
  await Linking.openURL(url);
}
