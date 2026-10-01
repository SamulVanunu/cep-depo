# Cep Depo — Android APK kataloğu

Kullanıcılar APK kayıtlarını inceleyip yayıncının kullandığı servisteki indirme bağlantısını açar. İndirme için Cep Depo hesabı gerekmez; yorum ve puan için hesap gerekir. Yayınlama, yeni sürüm ve kaldırma yalnızca yönetici hesabındadır. IPTV uygulamaları için kategori bulunur. Harici hesap isteyen uygulamalarda hesap isteme bağlantısı gösterilebilir.

## İlk kurulum

1. `npm install` çalıştır. `.env.example` dosyasını `.env` olarak kopyalayıp Project URL ve publishable key değerlerini doldur. Secret/service role anahtarını uygulamaya koyma.
2. Supabase SQL Editor içinde `supabase/schema.sql` dosyasını çalıştır. Bu şema mevcut projede zaten kuruluysa yeniden çalıştırma.
3. Supabase Authentication içinde kendi hesabını oluştur. Hesabının UUID değerini `public.admins` tablosuna ekle: `insert into public.admins(user_id) values ('UUID') on conflict do nothing;`.
4. `npm start` ile Expo Go'da aç.

## Mevcut projeyi güncelleme

Mevcut Supabase projesinde sırasıyla `supabase/link_source_migration.sql` ve `supabase/release_events_migration.sql` dosyalarını SQL Editor'da çalıştır. Ardından güncel `App.tsx`, `src/api.ts`, `assets` ve `package.json`/`package-lock.json` dosyalarını kullanıp `npm install` çalıştır. `.env` dosyanı koru.

## İndirme ve sürüm takibi

Yönetim ekranında HTTPS indirme bağlantısı ve sürüm yayınlanır. Kullanıcı `APK indir` düğmesine bastığında dış servis açılır. TeraBox gibi bir paylaşım sayfasında dosyayı indirme adımını servis yönetir; Cep Depo servis sayfasını doğrudan APK dosyasına dönüştüremez.

Geçmiş, bağlantısı açılan uygulamaların sürümünü yalnızca bu cihazda tutar. Dosyanın indirildiğini veya kurulduğunu doğrulamaz. Yeni sürümde sürüm numarasını değiştirmen gerekir. Yayınlar ve yeni sürümler uygulama içindeki Bildirimler alanında, uygulama açıldığında ya da ön plana geldiğinde görünür. Bu sürümde telefonun durum çubuğuna uygulama kapalıyken **push bildirim gönderilmez**. Android Expo Go SDK 57 push bildirim desteklemez; bunun için özel Android derlemesi ve sunucu bildirim altyapısı gerekir.

## Uygulama hataları

Ekran çizilirken beklenmeyen bir hata olursa kullanıcıya yeniden deneme ekranı gösterilir. Bozuk yerel geçmiş verisi sıfırlanır. Bu koruma Android'in kendi içinde kapanan uygulamayı, bellek yetersizliğini veya ağ bağlantısı hatalarını otomatik çözmez. Yayınlamadan önce farklı Android cihazlarda gerçek APK derlemesini dene. Bir kapanma tekrarlanıyorsa cihaz modeli, Android sürümü ve kapanma adımlarını kaydet; üretim ortamı için ayrıca hata raporlama servisi kurmak gerekir. Expo Go testi gerçek APK davranışını garanti etmez.

## Android APK yayınlama

Bu proje doğrudan bağlantıyla dağıtılacak Android APK için `release` profili içerir. APK üretmek için Expo hesabı ve uygulamanın bağlı olduğu Supabase projesinin **Project URL** ile **publishable/anon key** değerleri gerekir. `.env.example` içindeki örnek değerlerle yayınlama yapma. **Service role/secret key** ekleme.

1. Proje klasöründe `npm install` ve `npx eas-cli login` çalıştır.
2. İlk derlemede `npx eas-cli build:configure` ile projeyi kendi Expo hesabına bağla. `app.json` ve `eas.json` içindeki mevcut Android ayarlarını koru.
3. Expo projenin ortam değişkenleri ekranında **production** ortamına `EXPO_PUBLIC_SUPABASE_URL` ve `EXPO_PUBLIC_SUPABASE_ANON_KEY` değerlerini ekle. Bunlar derlemenin içine gömülür; Supabase RLS kuralları açık olmalı.
4. `npx eas-cli build --platform android --profile release` çalıştır. Sorulduğunda Android imzalama anahtarını EAS'ın oluşturmasına izin ver ve anahtar yönetimini aynı Expo hesabında sürdür. Biten derlemenin APK bağlantısını önce kendi cihazında dene, sonra paylaş.
5. Sonraki APK sürümünde `app.json` içindeki `version` ve `android.versionCode` değerlerini artır. Aynı paket adı ve imzalama anahtarı korunmazsa kullanıcı mevcut uygulamanın üzerine güncelleme kuramaz.

Bu profil APK üretir; Google Play yüklemesi için AAB ve mağaza süreçleri ayrıca gerekir. Expo Go veya JavaScript dışa aktarımı kurulabilir APK değildir. Bu pakette Supabase bilgileri bulunmadığından burada işlevsel APK üretilmedi.

## Başkaları için GitHub'da yayınlama

1. GitHub'da herkese açık bir `cep-depo` deposu oluştur ve **proje klasörünün içindekileri** depoya yükle. `.env`, imzalama anahtarı, `node_modules` ve APK dosyasını kaynak kod deposuna ekleme. Kaynak kodunu açık lisansla paylaşmak istiyorsan ayrıca seçtiğin lisansı ekle.
2. Yukarıdaki adımlarla `release` profili kullanarak APK oluştur. Expo derleme sayfasından APK'yı indir, kendi telefonunda kur ve katalog, giriş, indirme bağlantıları ile yönetici erişimini gerçek APK üzerinde doğrula.
3. GitHub deposunda **Releases → Draft a new release** aç. Etiket olarak `v0.1.0` yaz, derlediğin APK'yı **Assets** alanına yükle; örneğin `cep-depo-v0.1.0.apk`. Ardından sürümü yayımla ve insanlarla **Release bağlantısını** paylaş. GitHub'ın otomatik oluşturduğu “Source code (zip)” uygulama değildir.
4. Yeni sürüm çıkarırken `version` ve `android.versionCode` değerlerini artırıp **aynı Expo projesinin aynı Android imzalama anahtarını** kullan. Yeni etiket ve yeni APK ile yeni Release oluştur. APK dosyasını GitHub deposuna commit etme.

**Önemli:** Bu sürümde yalnızca APK bağlantısını GitHub'a koymak, Cep Depo'nun kullanıcı telefonlarına otomatik uygulama güncellemesi bildirmesini sağlamaz. Şu anki “Güncelle” düğmesi katalogdaki uygulamalar içindir; Cep Depo'nun kendisi için değildir. Yeni Cep Depo sürümünü ayrıca duyurman gerekir.
