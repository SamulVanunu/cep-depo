import { StyleSheet, View } from 'react-native';

import { AppText } from '../../components/ui/AppText';
import { Button } from '../../components/ui/Button';
import { colors, spacing } from '../../theme/tokens';
import type { CatalogVersion } from './catalog.types';

type VersionHistoryProps = {
  currentVersionId: string;
  versions: readonly CatalogVersion[];
  onReport?: (version: CatalogVersion) => void;
};

export function VersionHistory({ currentVersionId, versions, onReport }: VersionHistoryProps) {
  const ordered = [...versions].sort((left, right) => right.code - left.code);
  return (
    <View>
      {ordered.map(version => {
        const current = version.id === currentVersionId;
        return (
          <View key={version.id} style={styles.row}>
            <AppText variant="label">
              {version.name}{current ? ' · Güncel sürüm' : ''}
            </AppText>
            <AppText tone="subtle" variant="label">
              Kod {version.code}
            </AppText>
            {version.changelog ? <AppText tone="muted" style={styles.changelog}>{version.changelog}</AppText> : null}
            {onReport ? (
              <Button
                label={`${version.name} sürümünü şikâyet et`}
                onPress={() => onReport(version)}
                variant="text"
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  changelog: { marginTop: spacing.xs },
});
