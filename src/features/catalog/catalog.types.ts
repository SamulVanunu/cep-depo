export type Category = Readonly<{
  id: string;
  slug: string;
  name: string;
}>;

export type CatalogVersion = Readonly<{
  id: string;
  name: string;
  code: number;
  changelog: string;
  apkPath: string;
  apkSizeBytes: number;
  sha256: string;
  publishedAt: string;
}>;

export type CatalogCard = Readonly<{
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  iconPath: string | null;
  category: Category;
  featured: boolean;
  downloadCount: number;
  currentVersion: CatalogVersion;
}>;

export type CatalogScreenshot = Readonly<{
  id: string;
  path: string;
  altText: string;
  position: number;
}>;

export type CatalogApp = CatalogCard &
  Readonly<{
    description: string;
    screenshots: readonly CatalogScreenshot[];
    versions: readonly CatalogVersion[];
  }>;

export type CatalogFilters = Readonly<{
  query: string;
  categorySlug: string | null;
  sort: 'popular' | 'newest';
}>;
