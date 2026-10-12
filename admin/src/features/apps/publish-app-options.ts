export type PublishAppOption = Readonly<{
  id: string;
  title: string;
  slug: string;
  status: 'active' | 'archived';
  iconPath: string | null;
  latestVersionCode: number | null;
}>;

type PublishAppRow = Readonly<{
  id: string;
  title: string;
  slug: string;
  status: 'active' | 'archived';
  icon_path: string | null;
  app_versions: readonly Readonly<{ version_code: number }>[];
}>;

export function mapPublishAppOptions(rows: readonly PublishAppRow[]): readonly PublishAppOption[] {
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    iconPath: row.icon_path,
    latestVersionCode: row.app_versions.reduce<number | null>(
      (latest, version) => latest === null ? version.version_code : Math.max(latest, version.version_code),
      null,
    ),
  }));
}
