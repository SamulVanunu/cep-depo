import { StyleSheet, Text, View } from 'react-native';

export default function DiscoverRoute() {
  return (
    <View style={styles.screen}>
      <Text style={styles.wordmark}>
        cep depo<Text style={styles.accent}>.</Text>
      </Text>
      <Text style={styles.title}>Uygulamanı keşfet.</Text>
      <Text style={styles.body}>Katalog bir sonraki adımda burada olacak.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111315', padding: 24, paddingTop: 72 },
  wordmark: { color: '#F5F3ED', fontSize: 24, fontWeight: '800' },
  accent: { color: '#C8F36A' },
  title: { color: '#F5F3ED', fontSize: 34, fontWeight: '800', marginTop: 44 },
  body: { color: '#A3A8AF', fontSize: 15, marginTop: 10 },
});
