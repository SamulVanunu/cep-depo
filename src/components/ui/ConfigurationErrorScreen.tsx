import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

export function ConfigurationErrorScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <View accessibilityRole="alert" style={styles.content}>
        <Text style={styles.wordmark}>
          cep depo<Text style={styles.accent}>.</Text>
        </Text>
        <Text style={styles.title}>Bağlantı ayarı gerekiyor.</Text>
        <Text style={styles.body}>
          Supabase proje adresi veya publishable key eksik. Kurulum adımlarını README
          dosyasından tamamlayabilirsin.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#111315',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 28,
  },
  wordmark: {
    color: '#F5F3ED',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -1.2,
    marginBottom: 28,
  },
  accent: {
    color: '#C8F36A',
  },
  title: {
    color: '#F5F3ED',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 10,
  },
  body: {
    color: '#A3A8AF',
    fontSize: 15,
    lineHeight: 23,
  },
});
