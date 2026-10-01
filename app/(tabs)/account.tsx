import { StyleSheet, Text, View } from 'react-native';

export default function AccountRoute() {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Hesap</Text>
      <Text style={styles.body}>Hesap özellikleri yakında eklenecek.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111315', justifyContent: 'center', padding: 24 },
  title: { color: '#F5F3ED', fontSize: 28, fontWeight: '800' },
  body: { color: '#A3A8AF', fontSize: 15, marginTop: 8 },
});
