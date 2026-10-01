# Cep Depo

Cep Depo, bağımsız Android uygulamalarını keşfetmek ve yayımlanmış APK dosyalarını hesap açmadan indirmek için geliştirilen Expo/React Native kataloğudur. Bu teslimat; anonim katalog, arama, kategoriler, uygulama detayı, sürüm geçmişi ve güvenli indirme açma akışını içerir.

## Gereksinimler

- Node.js 22
- npm 10
- Docker Engine veya Docker Desktop
- Android geliştirme için Android Studio/emülatör ya da fiziksel cihaz
- Dağıtım için Expo ve EAS hesabı
- Mobil uygulama için HTTPS adresli bir Supabase projesi

## Kurulum

```bash
npm install
cp .env.example .env
```

`.env` içinde aşağıdaki public değerleri doldurun:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
EXPO_PUBLIC_PRIVACY_URL=https://example.com/privacy
EXPO_PUBLIC_TERMS_URL=https://example.com/terms
EXPO_PUBLIC_CONTACT_URL=mailto:support@example.com
```

Supabase publishable/anon anahtarları istemcide kullanılmak üzere public değerlerdir; güvenlik RLS ve sınırlı grant'lerle sağlanır. **Service-role, secret key, veritabanı parolası veya başka bir ayrıcalıklı anahtarı mobil uygulamaya ya da `EXPO_PUBLIC_*` değişkenlerine eklemeyin.**

Gizlilik ve kullanım koşulları yalnız HTTPS kabul eder. İletişim değeri HTTPS veya `mailto:` olabilir. Eksik veya geçersiz bağlantılar uygulamada `Yapılandırılmadı` olarak görünür.

## Yerel Supabase

Yerel veritabanı şema geliştirme ve test içindir. Mobil uygulama yapılandırması HTTPS Supabase proje adresi bekler.

```bash
npm run db:start
npm run db:reset
npm run db:test
npm run db:types
```

- Canonical migration'lar `supabase/migrations/` altındadır.
- `npm run db:reset`, migration'ları temiz veritabanına uygular ve `supabase/seed.sql` verisini yükler.
- `npm run db:test`, anonim erişim, RLS, Storage sınırları, arama ve indirme metriği pgTAP testlerini çalıştırır.
- `npm run db:types`, yerel şemadan `src/types/database.types.ts` üretir. Şema değişikliğinden sonra bu dosyayı yeniden üretin.

Hosted projeye migration uygulamadan önce Supabase CLI ile doğru project ref'i bağlayın ve değişiklikleri inceleyin:

```bash
npx supabase link --project-ref PROJECT_REF
npx supabase db push
```

## Geliştirme

```bash
npm start
```

Ardından Expo geliştirme ekranından Android emülatörü veya cihazı açın. Yapılandırma değişikliklerinden sonra Metro önbelleğini temizlemek için `npx expo start --clear` kullanabilirsiniz.

Kalite kontrolleri:

```bash
npm test
npm run typecheck
npm run lint
npm run db:test
npx expo-doctor
```

## APK indirme davranışı

- APK URL'si yalnız Supabase'in public `apks` bucket'ından oluşturulur ve HTTPS değilse açılmaz.
- Platform URL'yi başarıyla açmadan yerel geçmiş veya indirme metriği yazılmaz.
- Yerel geçmiş, açılan en yüksek `version_code` değerini bu cihazda saklar.
- `GÜNCELLE`, yalnız katalogdaki sürüm kodu yerel geçmişten büyük olduğunda görünür.
- URL'nin açılması dosyanın indirildiğini veya kurulduğunu kanıtlamaz; uygulama bu konuda iddiada bulunmaz.
- Anonim metrik, installation UUID + sürüm için idempotenttir ve kullanıcı hesabı gerektirmez.

## Android APK derleme

`eas.json` içindeki `release` profili internal dağıtım için APK üretir.

```bash
npx eas-cli login
npx eas-cli build:configure
npx eas-cli build --platform android --profile release
```

EAS `production` ortamına `.env.example` içindeki gerekli `EXPO_PUBLIC_*` değerlerini ekleyin. Service-role/secret key eklemeyin. İlk üretim derlemesinde oluşturulan Android imzalama anahtarını ve `com.cepdepo.app` paket adını sonraki sürümlerde koruyun. Her sürümde `app.json` içindeki `version` ve `android.versionCode` değerlerini artırın.

JavaScript export'u kurulabilir APK değildir. Yerel Android bundle doğrulaması için:

```bash
npx expo export --platform android
```

## Bu teslimatın kapsamı

Mevcut foundation teslimatı şunları içerir:

- dört sekmeli Expo Router kabuğu;
- anonim keşfetme, arama, kategori ve sıralama;
- uygulama detayı, ekran görüntüleri ve yayımlanmış sürüm geçmişi;
- HTTPS APK açma, cihaz içi sürüm geçmişi ve anonim metrik;
- yapılandırma hatası, loading, empty, error ve retry durumları;
- Supabase migration, seed, RLS ve pgTAP testleri.

Hesap/auth, yorumlar, puanlama, raporlama, takip, gerçek push bildirimleri, Next.js yönetim paneli, yayınlama iş akışı ve bütünlük sertleştirmesi sonraki teslimat planlarındadır. Hesap ve Bildirim sekmeleri bu nedenle işlev varmış gibi davranmaz.
