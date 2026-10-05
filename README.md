# Cep Depo

Cep Depo, bağımsız Android uygulamalarını keşfetmek ve yayımlanmış APK dosyalarını hesap açmadan indirmek için geliştirilen Expo/React Native kataloğudur. Hesap açan ve e-postasını doğrulayan kullanıcılar profil/avatar yönetimi, puanlama, yorum ve uygulama/sürüm şikâyeti özelliklerini de kullanabilir.

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

Supabase publishable anahtarı istemcide kullanılmak üzere public bir değerdir; güvenlik RLS ve sınırlı grant'lerle sağlanır. Uygulama yalnız `sb_publishable_...` biçimini kabul eder. **Service-role, secret key, veritabanı parolası veya başka bir ayrıcalıklı anahtarı mobil uygulamaya ya da `EXPO_PUBLIC_*` değişkenlerine eklemeyin.**

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
- Yerel Auth e-postaları Mailpit'te `http://127.0.0.1:56324` adresinden görülebilir. Kayıt ve şifre sıfırlama testlerinde e-postadaki `cepdepo://auth/confirm` veya `cepdepo://auth/reset-password` bağlantısını cihazda açın.

### Hosted Supabase kontrol listesi

Hosted projeye migration uygulamak dış sistem değişikliğidir; operatör doğru proje ve yedek/geri dönüş planını doğrulamadan çalıştırmayın.

```bash
npx supabase link --project-ref PROJECT_REF
npx supabase migration list
npx supabase db push --dry-run
```

1. `supabase/.temp/linked-project.json` içindeki `ref` değerinin hedef `PROJECT_REF` ile birebir aynı olduğunu doğrulayın. `.temp` içeriğini commit etmeyin.
2. `migration list` ve `db push --dry-run` çıktısında yalnız beklenen migration'ların bulunduğunu inceleyin.
3. Açık onaydan sonra `npx supabase db push` çalıştırın; ardından pgTAP/advisor kontrollerini uygun ortamda tekrarlayın.
4. Auth URL Configuration içinde `cepdepo://auth/confirm` ve `cepdepo://auth/reset-password` redirect adreslerini allow-list'e ekleyin; e-posta doğrulamayı açık tutun.
5. Production için doğrulanmış gönderen alan adına sahip özel SMTP yapılandırın. Supabase'in varsayılan SMTP servisini gerçek kullanıcı dağıtımı için kullanmayın; kayıt, yeniden gönderim ve şifre sıfırlama teslimatını fiziksel cihazda doğrulayın.
6. `avatars` bucket'ının public okuma, kullanıcıya ait klasörde yazma ve 5 MB MIME sınırlarını migration ile aldığını doğrulayın.

Project ref, veritabanı parolası, SMTP parolası, service-role/secret key, EAS token ve Android imzalama anahtarı dokümana, Git'e veya `EXPO_PUBLIC_*` değerlerine yazılmaz.

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

## Hesap ve topluluk davranışı

- Katalog, uygulama detayı, puan özeti ve görünür yorumlar giriş yapmadan okunabilir.
- Kayıt kullanıcı adı, e-posta ve şifre alır; yorum/puan/şikâyet yazmak için e-posta doğrulaması gerekir.
- Kullanıcı adı 3–30 karakterdir; Türkçe harfler, sayı, nokta ve alt çizgi desteklenir.
- Avatar yalnız PNG, JPEG veya WebP olabilir, en fazla 5 MB'dır ve `<user-id>/avatar.<uzantı>` yoluna yüklenir.
- Her kullanıcı bir uygulamaya tek değerlendirme bırakabilir. Puan zorunlu 1–5, yorum metni isteğe bağlıdır; doluysa kırpılmış 3–2000 karakter olmalıdır.
- Şikâyet uygulamanın tamamını veya yüklenmiş belirli bir sürümü hedefler. Açıklama isteğe bağlıdır; doluysa 3–1000 karakterdir. Aynı kullanıcı/hedef için yalnız bir açık şikâyet bulunabilir.
- Askıya alınmış hesap profilini ve geçmişini okuyabilir ancak profil, avatar, yorum veya şikâyet yazamaz.
- Kimlik ve sahiplik mobil form alanlarından alınmaz. `auth.uid()`, column-scoped grant'ler, RLS ve Storage policy'leri başka kullanıcı adına yazmayı engeller. Mobil istemcideki kontroller güvenlik sınırı değildir.

## Android APK derleme

`eas.json` içindeki `release` profili internal dağıtım için APK üretir.

```bash
npx eas-cli login
npx eas-cli build:configure
npx eas-cli build --platform android --profile release
```

EAS `production` ortamına `.env.example` içindeki gerekli `EXPO_PUBLIC_*` değerlerini ekleyin. Service-role/secret key eklemeyin. İlk üretim derlemesinde oluşturulan Android imzalama anahtarını ve `com.cepdepo.app` paket adını sonraki sürümlerde koruyun. Her sürümde `app.json` içindeki `version` ve `android.versionCode` değerlerini artırın.

Release öncesinde hosted Auth redirect'leri, SMTP teslimatı, migration durumu ve EAS production public değişkenleri fiziksel cihazla doğrulanmalıdır. `release` profili doğrudan paylaşılabilir APK üretir; Google Play/AAB bu teslimatın parçası değildir.

JavaScript export'u kurulabilir APK değildir. Yerel Android bundle doğrulaması için:

```bash
npx expo export --platform android
```

## Bu teslimatın kapsamı

Mevcut teslimat şunları içerir:

- dört sekmeli Expo Router kabuğu;
- anonim keşfetme, arama, kategori ve sıralama;
- uygulama detayı, ekran görüntüleri ve yayımlanmış sürüm geçmişi;
- HTTPS APK açma, cihaz içi sürüm geçmişi ve anonim metrik;
- yapılandırma hatası, loading, empty, error ve retry durumları;
- e-posta/şifre hesabı, doğrulama ve şifre sıfırlama;
- profil, kullanıcı adı ve avatar yönetimi;
- puan özeti, herkese açık yorumlar ve kullanıcının kendi değerlendirmesini yönetmesi;
- uygulama ve sürüm şikâyetleri;
- Supabase migration, seed, RLS, Storage policy'leri ve pgTAP testleri.

Takip, gerçek push bildirimleri, Next.js yönetim paneli, kullanıcıya açık uygulama yayınlama iş akışı ve mağaza dağıtımı sonraki teslimatlardadır. Bildirim sekmesi bu nedenle işlev varmış gibi davranmaz.
