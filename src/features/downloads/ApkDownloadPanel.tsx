import { StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { colors, radii, spacing } from '../../theme/tokens';
import type { ApkDownloadDependencies, ApkDownloadInput } from './apk-download';
import { useApkDownload } from './useApkDownload';

type ApkDownloadPanelProps = Readonly<{
  action: 'download' | 'update';
  input: ApkDownloadInput;
  dependencies?: ApkDownloadDependencies;
  onInstallerOpened?: () => Promise<unknown>;
}>;

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

export function ApkDownloadPanel({
  action,
  input,
  dependencies,
  onInstallerOpened,
}: ApkDownloadPanelProps) {
  const download = useApkDownload(input, dependencies, onInstallerOpened);
  const percent = Math.round(download.progress.fraction * 100);

  if (download.phase === 'downloading') {
    return (
      <View style={styles.stack}>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent, text: `%${percent}` }}
          style={styles.progressTrack}
        >
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>
        <AppText style={styles.centered} tone="muted" variant="label">
          %{percent} · {megabytes(download.progress.bytesWritten)} / {megabytes(download.progress.totalBytes)} MB
        </AppText>
        <Button label="İptal" onPress={download.cancel} variant="secondary" />
      </View>
    );
  }

  if (download.phase === 'cancelling') {
    return (
      <AppText accessibilityRole="alert" style={styles.centered} tone="muted">
        İndirme iptal edildi. Kısmi dosya temizleniyor.
      </AppText>
    );
  }

  if (download.phase === 'installing') {
    return <Button label="Kurulum ekranı açılıyor" loading />;
  }

  if (download.phase === 'ready') {
    return (
      <View style={styles.stack}>
        {download.error ? <AppText accessibilityRole="alert" style={styles.centered} tone="danger">{download.error}</AppText> : null}
        <AppText style={styles.centered} tone="muted" variant="label">
          APK doğrulandı. Kurulum Android tarafından tamamlanır.
        </AppText>
        <Button label="TEKRAR KUR" onPress={() => void download.install()} variant="secondary" />
      </View>
    );
  }

  if (download.phase === 'error') {
    return (
      <View style={styles.stack}>
        <AppText accessibilityRole="alert" style={styles.centered} tone="danger">{download.error}</AppText>
        <Button label="TEKRAR DENE" onPress={() => void download.start()} />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <Button
        label={action === 'update' ? 'GÜNCELLE' : 'APK İNDİR'}
        onPress={() => void download.start()}
      />
      <AppText style={styles.centered} tone="subtle" variant="label">
        İndirme uygulama içinde yapılır; kurulum Android onayı gerektirir.
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.sm },
  centered: { textAlign: 'center' },
  progressTrack: {
    height: 10,
    overflow: 'hidden',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
  },
  progressFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
});
