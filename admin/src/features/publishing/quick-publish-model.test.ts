import { describe, expect, it } from 'vitest';

import type { PublishAppOption } from '../apps/publish-app-options';
import {
  deriveDescriptions,
  deriveTitle,
  matchPackage,
  uniqueSlug,
} from './quick-publish-model';

function app(overrides: Partial<PublishAppOption> = {}): PublishAppOption {
  return {
    id: 'a1000000-0000-4000-8000-000000000001',
    title: 'Cep Araç',
    slug: 'cep-arac',
    status: 'active',
    iconPath: null,
    packageName: 'com.example.cep',
    latestVersionCode: 7,
    latestReleaseMetadata: null,
    ...overrides,
  };
}

describe('matchPackage', () => {
  it('treats an unknown package as a new app', () => {
    expect(matchPackage('com.example.yeni', [app()])).toEqual({ kind: 'new' });
  });

  it('matches an active app by package name', () => {
    const existing = app();
    expect(
      matchPackage('com.example.cep', [existing, app({ id: 'other', packageName: 'com.example.baska' })]),
    ).toEqual({ kind: 'existing', app: existing });
  });

  it('reports an archived app instead of publishing into it', () => {
    const archived = app({ status: 'archived' });
    expect(matchPackage('com.example.cep', [archived])).toEqual({ kind: 'archived', app: archived });
  });

  it('reports how many apps share the package name', () => {
    const apps = [app(), app({ id: 'a1000000-0000-4000-8000-000000000002' })];
    expect(matchPackage('com.example.cep', apps)).toEqual({ kind: 'ambiguous', count: 2 });
  });

  it('ignores apps without a package name', () => {
    expect(matchPackage('com.example.cep', [app({ packageName: null })])).toEqual({ kind: 'new' });
  });
});

describe('deriveTitle', () => {
  it('title-cases the last package segment', () => {
    expect(deriveTitle('com.ornek.vizyona')).toBe('Vizyona');
  });

  it('turns underscores into spaces', () => {
    expect(deriveTitle('com.ornek.my_app')).toBe('My app');
  });

  it('keeps the package name when the last segment is too short', () => {
    expect(deriveTitle('a.b')).toBe('a.b');
  });

  it('caps the derived title', () => {
    expect(deriveTitle(`com.ornek.${'a'.repeat(200)}`).length).toBe(90);
  });
});

describe('uniqueSlug', () => {
  it('normalizes Turkish characters', () => {
    expect(uniqueSlug('Çöp Kutusu', [])).toBe('cop-kutusu');
  });

  it('suffixes a taken slug until it is free', () => {
    expect(uniqueSlug('vizyona', ['vizyona'])).toBe('vizyona-2');
    expect(uniqueSlug('vizyona', ['vizyona', 'vizyona-2'])).toBe('vizyona-3');
  });

  it('falls back to a generic slug when nothing survives normalization', () => {
    expect(uniqueSlug('***', [])).toBe('uygulama');
    expect(uniqueSlug('***', ['uygulama'])).toBe('uygulama-2');
  });
});

describe('deriveDescriptions', () => {
  it('builds an operator-editable description pair', () => {
    const { shortDescription, description } = deriveDescriptions('Vizyona', 'com.ornek.vizyona');

    expect(shortDescription).toBe('Vizyona Android uygulaması.');
    expect(description).toContain('Vizyona Android uygulaması.');
    expect(description).toContain('com.ornek.vizyona');
  });

  it('keeps the descriptions inside their limits', () => {
    const { shortDescription, description } = deriveDescriptions('a'.repeat(300), 'b'.repeat(6000));

    expect(shortDescription.length).toBeLessThanOrEqual(180);
    expect(description.length).toBeLessThanOrEqual(5000);
  });
});
