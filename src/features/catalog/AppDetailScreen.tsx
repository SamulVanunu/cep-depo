import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppIcon } from '../../components/ui/AppIcon';
import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { ScreenState } from '../../components/ui/ScreenState';
import { getPublicAssetUrl } from '../../lib/supabase';
import { colors, radii, spacing } from '../../theme/tokens';
import { ApkDownloadPanel } from '../downloads/ApkDownloadPanel';
import { getDownloadAction } from '../downloads/download-history';
import { useDownloadedVersion } from '../downloads/useDownloadedVersion';
import { ReviewsSection } from '../reviews/ReviewsSection';
import { ReportSheet } from '../reports/ReportSheet';
import type { ReportTarget } from '../reports/report.types';
import { ScreenshotGallery } from './ScreenshotGallery';
import { VersionHistory } from './VersionHistory';
import { useCatalogApp } from './catalog.queries';
import type { CatalogApp } from './catalog.types';

type AppDetailScreenProps = {
  slug: string;
  resolveAssetUrl?: (path: string) => string;
  renderDownloadAction?: (app: CatalogApp) => ReactNode;
};

function formatFileSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function AppDetailScreen({
  slug,
  resolveAssetUrl = getPublicAssetUrl,
  renderDownloadAction,
}: AppDetailScreenProps) {
  const router = useRouter();
  const normalizedSlug = slug.trim();
  const query = useCatalogApp(normalizedSlug);
  const downloadHistory = useDownloadedVersion(query.data?.id ?? null);
  const [reportTarget, setReportTarget] = useState<ReportTarget | null>(null);

  if (!normalizedSlug || (!query.isPending && !query.isError && !query.data)) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScreenState
          kind="empty"
          message="Bu kayıt kaldırılmış veya hiç yayımlanmamış olabilir."
          title="Uygulama bulunamadı."
        />
      </SafeAreaView>
    );
  }
  if (query.isPending) {
    return <SafeAreaView style={styles.screen}><ScreenState kind="loading" title="Uygulama yükleniyor" /></SafeAreaView>;
  }
  if (query.isError || !query.data) {
    return (
      <SafeAreaView style={styles.screen}>
        <ScreenState
          kind="error"
          message="Bağlantını kontrol edip yeniden deneyebilirsin."
          onRetry={() => void query.refetch()}
          title="Uygulama yüklenemedi."
        />
      </SafeAreaView>
    );
  }

  const app = query.data;
  const iconUri = app.iconPath ? resolveAssetUrl(app.iconPath) : null;
  const downloadAction = getDownloadAction(
    app.currentVersion.code,
    downloadHistory.downloadedVersion,
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          accessibilityLabel="Kataloğa dön"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => router.back()}
          style={styles.back}
        >
          <AppText tone="accent" variant="label">← Geri</AppText>
        </Pressable>

        <View style={styles.hero}>
          <AppIcon size={80} title={app.title} uri={iconUri} />
          <View style={styles.heroText}>
            <AppText accessibilityLabel={app.title} accessibilityRole="header" variant="title">
              {app.title}
            </AppText>
            <AppText tone="muted">{app.category.name} · sürüm {app.currentVersion.name}</AppText>
            <AppText tone="subtle" variant="label">
              {formatFileSize(app.currentVersion.apkSizeBytes)}
            </AppText>
          </View>
        </View>

        <View style={styles.download}>
          {renderDownloadAction ? (
            renderDownloadAction(app)
          ) : (
            <ApkDownloadPanel
              action={downloadAction}
              input={{
                appId: app.id,
                versionId: app.currentVersion.id,
                versionCode: app.currentVersion.code,
                apkSource: app.currentVersion.apkSource,
                apkSizeBytes: app.currentVersion.apkSizeBytes,
                sha256: app.currentVersion.sha256,
              }}
              onInstallerOpened={downloadHistory.refresh}
            />
          )}
        </View>

        <AppText variant="title" style={styles.sectionTitle}>Hakkında</AppText>
        <AppText tone="muted">{app.description}</AppText>
        <Button
          label="Uygulamayı şikâyet et"
          onPress={() =>
            setReportTarget({
              appId: app.id,
              appTitle: app.title,
              versionId: null,
              versionName: null,
            })
          }
          variant="text"
        />

        <AppText variant="title" style={styles.sectionTitle}>Ekran görüntüleri</AppText>
        <ScreenshotGallery resolveAssetUrl={resolveAssetUrl} screenshots={app.screenshots} />

        <View style={styles.hashCard}>
          <AppText variant="label">SHA-256</AppText>
          <AppText selectable tone="subtle" style={styles.hash}>{app.currentVersion.sha256}</AppText>
          <Button
            accessibilityLabel="SHA-256 değerini kopyala"
            label="Kopyala"
            onPress={() => void Clipboard.setStringAsync(app.currentVersion.sha256)}
            variant="text"
          />
        </View>

        <AppText variant="title" style={styles.sectionTitle}>Sürüm geçmişi</AppText>
        <VersionHistory
          currentVersionId={app.currentVersion.id}
          onReport={version =>
            setReportTarget({
              appId: app.id,
              appTitle: app.title,
              versionId: version.id,
              versionName: version.name,
            })
          }
          versions={app.versions}
        />

        <ReviewsSection appId={app.id} appSlug={app.slug} />
      </ScrollView>
      {reportTarget ? (
        <ReportSheet
          key={`${reportTarget.appId}:${reportTarget.versionId ?? 'app'}`}
          onDismiss={() => setReportTarget(null)}
          target={reportTarget}
          visible
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  back: { minWidth: 44, minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center' },
  hero: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg },
  heroText: { flex: 1, marginLeft: spacing.lg, gap: spacing.xs },
  download: { marginTop: spacing.xl },
  sectionTitle: { marginTop: spacing.xxl, marginBottom: spacing.md },
  hashCard: { marginTop: spacing.xl, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface },
  hash: { marginTop: spacing.sm, fontFamily: 'monospace', fontSize: 12 },
});
