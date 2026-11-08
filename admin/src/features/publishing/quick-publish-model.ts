import { normalizeSlug } from '../apps/app-schema';
import type { PublishAppOption } from '../apps/publish-app-options';

export type PackageMatch =
  | Readonly<{ kind: 'new' }>
  | Readonly<{ kind: 'existing'; app: PublishAppOption }>
  | Readonly<{ kind: 'archived'; app: PublishAppOption }>
  | Readonly<{ kind: 'ambiguous'; count: number }>;

/** Karar yalnızca paket adına dayanır; aynı paket iki uygulamada varsa durur. */
export function matchPackage(
  packageName: string,
  apps: readonly PublishAppOption[],
): PackageMatch {
  const matches = apps.filter(app => app.packageName === packageName);
  if (matches.length === 0) return { kind: 'new' };
  if (matches.length > 1) return { kind: 'ambiguous', count: matches.length };
  const app = matches[0]!;
  return app.status === 'active'
    ? { kind: 'existing', app }
    : { kind: 'archived', app };
}

/** `com.ornek.vizyona` → `Vizyona`; son parça 2 karakterden kısaysa paket adı kalır. */
export function deriveTitle(packageName: string): string {
  const segments = packageName.split('.').filter(Boolean);
  const last = (segments.at(-1) ?? packageName).replace(/[_-]+/g, ' ').trim();
  if (last.length < 2) return packageName.slice(0, 90);
  const titled = last.charAt(0).toLocaleUpperCase('tr-TR') + last.slice(1);
  return titled.slice(0, 90);
}

/** Çakışmada `-2`, `-3`, … sonekini dener. */
export function uniqueSlug(base: string, taken: readonly string[]): string {
  const normalized = normalizeSlug(base) || 'uygulama';
  const takenSet = new Set(taken);
  if (!takenSet.has(normalized)) return normalized;
  for (let suffix = 2; suffix <= 9999; suffix += 1) {
    const candidate = `${normalized.slice(0, 115)}-${suffix}`;
    if (!takenSet.has(candidate)) return candidate;
  }
  return `${normalized.slice(0, 108)}-${Date.now().toString(36)}`;
}

/** Operatörün düzenleyeceği başlangıç metinleri; boş bırakılan alan yok. */
export function deriveDescriptions(
  title: string,
  packageName: string,
): Readonly<{ shortDescription: string; description: string }> {
  return {
    shortDescription: `${title} Android uygulaması.`.slice(0, 180),
    description: `${title} Android uygulaması.\n\nPaket adı: ${packageName}`.slice(0, 5000),
  };
}
