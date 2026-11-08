import type { ReleaseMetadataInput } from '../uploads/upload-schema';

export type PublishAppOption = Readonly<{
  id: string;
  title: string;
  slug: string;
  status: 'active' | 'archived';
  iconPath: string | null;
  packageName: string | null;
  latestVersionCode: number | null;
  latestReleaseMetadata: ReleaseMetadataInput | null;
}>;

type PublishAppRow = Readonly<{
  id: string;
  title: string;
  slug: string;
  status: 'active' | 'archived';
  icon_path: string | null;
  package_name: string | null;
  app_versions: readonly Readonly<{
    version_code: number;
    status: 'draft' | 'published' | 'withdrawn';
    supports_mobile: boolean;
    supports_tv: boolean;
    account_requirement: 'none' | 'optional' | 'required';
  }>[];
}>;

export function mapPublishAppOptions(rows: readonly PublishAppRow[]): readonly PublishAppOption[] {
  return rows.map(row => {
    const latestPublished = row.app_versions.reduce<(typeof row.app_versions)[number] | null>(
      (latest, version) => version.status === 'published' && (!latest || version.version_code > latest.version_code)
        ? version
        : latest,
      null,
    );
    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      status: row.status,
      iconPath: row.icon_path,
      packageName: row.package_name,
      latestVersionCode: row.app_versions.reduce<number | null>(
        (latest, version) => latest === null ? version.version_code : Math.max(latest, version.version_code),
        null,
      ),
      latestReleaseMetadata: latestPublished ? {
        supportsMobile: latestPublished.supports_mobile,
        supportsTv: latestPublished.supports_tv,
        accountRequirement: latestPublished.account_requirement,
      } : null,
    };
  });
}
