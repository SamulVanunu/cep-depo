import Constants from 'expo-constants';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '../../src/components/ui/AppText';
import {
  getPublicLinks,
  openPublicLink,
  type PublicLinks,
} from '../../src/lib/public-links';
import { colors, radii, spacing } from '../../src/theme/tokens';

type LinkRowProps = { label: string; url: string | null };

function LinkRow({ label, url }: LinkRowProps) {
  if (!url) {
    return (
      <View style={styles.row}>
        <AppText>{label}</AppText>
        <AppText tone="subtle" variant="label">Yapılandırılmadı</AppText>
      </View>
    );
  }
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="link"
      onPress={() => void openPublicLink(url)}
      style={styles.row}
    >
      <AppText>{label}</AppText>
      <AppText tone="accent" variant="label">Aç ↗</AppText>
    </Pressable>
  );
}

type AboutScreenProps = { links: PublicLinks };

export function AboutScreen({ links }: AboutScreenProps) {
  const version = Constants.expoConfig?.version ?? 'Bilinmiyor';
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <AppText variant="title">cep depo<AppText tone="accent" variant="title">.</AppText></AppText>
        <AppText accessibilityRole="header" variant="display" style={styles.title}>Hakkında</AppText>
        <AppText tone="muted">
          Android uygulamalarını keşfetmenin sade, editoryal ve işlevsel yolu.
        </AppText>
        <AppText tone="subtle" variant="label" style={styles.version}>Sürüm {version}</AppText>

        <View style={styles.card}>
          <LinkRow label="Gizlilik" url={links.privacy} />
          <LinkRow label="Kullanım koşulları" url={links.terms} />
          <LinkRow label="İletişim" url={links.contact} />
        </View>

        <View style={styles.openSource}>
          <AppText variant="title">Açık kaynak</AppText>
          <AppText tone="muted" style={styles.openSourceBody}>
            Cep Depo; Expo, React Native, TanStack Query ve Supabase dahil açık kaynak
            bileşenler kullanır. Paket lisansları dağıtım kaynaklarıyla birlikte sunulur.
          </AppText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function AboutRoute() {
  return <AboutScreen links={getPublicLinks()} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.xl, paddingBottom: spacing.xxl },
  title: { marginTop: spacing.xxl, marginBottom: spacing.sm },
  version: { marginTop: spacing.md },
  card: { marginTop: spacing.xxl, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  row: { minHeight: 56, paddingHorizontal: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.border },
  openSource: { marginTop: spacing.xxl },
  openSourceBody: { marginTop: spacing.sm },
});
