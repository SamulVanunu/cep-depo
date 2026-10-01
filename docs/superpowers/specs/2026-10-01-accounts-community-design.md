# Cep Depo Hesaplar ve Topluluk Teslimatı Tasarımı

**Tarih:** 1 Ekim 2026

**Durum:** Kullanıcı tarafından bölüm bölüm onaylandı

**Kapsam:** Mobil hesaplar, profiller, değerlendirmeler, puanlar, şikâyetler ve paylaşılabilir production APK

## 1. Amaç

Bu, Cep Depo platform planındaki beş bağımsız teslimatın ikincisidir. Mevcut anonim katalog ve APK indirme deneyimini bozmadan e-posta/şifre hesaplarını ve temel topluluk işlevlerini ekler.

Teslimat sonunda kullanıcılar:

- kullanıcı adı, e-posta ve şifreyle kayıt olabilir;
- e-posta adresini doğrulayabilir, giriş/çıkış yapabilir ve şifresini sıfırlayabilir;
- kullanıcı adını ve isteğe bağlı avatarını yönetebilir;
- bir uygulamaya 1–5 puan verip isteğe bağlı yorum yazabilir;
- kendi değerlendirmesini düzenleyebilir veya kaldırabilir;
- bir uygulama ya da belirli sürüm hakkında şikâyet gönderebilir;
- kendi değerlendirmelerini Hesap sekmesinde görebilir.

Cep Depo, Google Play’e bağımlı olmayan bağımsız bir Android uygulama kataloğu ve APK dağıtım kanalıdır. Bu teslimat, başkalarının kurup gerçek backend ile kullanabileceği imzalı production APK ve paylaşılabilir doğrudan indirme bağlantısıyla tamamlanır.

## 2. Kapsam sınırları

### Dahil

- Supabase e-posta/şifre kimlik doğrulaması
- Kayıt sırasında benzersiz kullanıcı adı
- E-posta doğrulama ve doğrulama e-postasını yeniden gönderme
- Giriş, çıkış ve şifre sıfırlama
- Auth deep link işleme
- Profil ve avatar yönetimi
- Uygulama puan özeti ve görünür değerlendirme listesi
- Tek kullanıcı/tek uygulama değerlendirmesi
- Değerlendirme oluşturma, düzenleme ve kaldırma
- Uygulama veya sürüm şikâyeti
- Topluluk RLS, Storage politikaları, grant’ler ve pgTAP testleri
- Paylaşılabilir production APK oluşturma

### Dahil değil

- Uygulama takibi, uygulama içi bildirim ve push bildirimleri
- Admin veya moderasyon arayüzü
- Mobil uygulamadan APK yayımlama
- Kullanıcıların kendi uygulamalarını doğrudan yüklemesi
- Hesap silme
- Sosyal giriş
- Google Play/AAB yayını
- Otomatik içerik veya zararlı yazılım analizi

Uygulama ve APK yayımlama, bağımsız Next.js admin paneliyle birlikte dördüncü teslimatta yapılır. Bu teslimatın moderasyon ve şikâyet veri sözleşmeleri o panele hazır olacaktır.

## 3. Mimari

Mevcut özellik odaklı mobil mimari korunur. Route dosyaları yalnız ekran bileşenlerini bağlar; Supabase erişimi repository’lerde, sunucu durumu TanStack Query kancalarında, kullanıcı etkileşimi odaklı ekran ve bileşenlerde kalır.

Yeni ana sınırlar:

- `src/features/auth`: oturum, kayıt, giriş, doğrulama, şifre sıfırlama ve deep link akışları
- `src/features/profile`: profil sorguları, kullanıcı adı ve avatar yönetimi
- `src/features/reviews`: puan özeti, listeleme ve kullanıcının değerlendirme mutation’ları
- `src/features/reports`: uygulama/sürüm şikâyeti doğrulama ve gönderme
- `src/providers/AuthProvider.tsx`: uygulama çapında oturum durumu ve auth olayları

`AuthProvider` başlangıçta mevcut oturumu yükler, auth olaylarını dinler ve React Native uygulama yaşam döngüsünde token yenilemeyi yönetir. Oturum kurulamaz veya yenilenemezse kullanıcı oturumu kapatılır; anonim katalog ve APK indirme çalışmaya devam eder.

Auth, profil ve topluluk işlemleri tek bir büyük servis ya da ekran dosyasında birleştirilmez. Her modül kendi domain tipini, repository sözleşmesini, query anahtarlarını ve odaklı bileşenlerini içerir.

## 4. Mobil bilgi mimarisi

### 4.1 Hesap sekmesi

Oturumsuz kullanıcı için:

- giriş formu;
- kayıt formuna geçiş;
- şifre sıfırlama isteği;
- doğrulanmamış hesap için açıklama ve doğrulama e-postasını yeniden gönderme.

Oturumlu kullanıcı için:

- avatar ve kullanıcı adı;
- kullanıcı adı düzenleme;
- galeriden avatar seçme, değiştirme ve kaldırma;
- kullanıcının değerlendirmeleri ve ilgili uygulamaya geçiş;
- çıkış yapma.

Askıya alınmış kullanıcı hesap bilgilerini ve herkese açık içeriği okuyabilir. Topluluk yazma kontrolleri devre dışı olur ve teknik ayrıntı vermeyen bir durum mesajı gösterilir.

### 4.2 Auth route’ları ve deep link’ler

Kayıt formu kullanıcı adı, e-posta, şifre ve şifre tekrarını aynı adımda alır. E-posta doğrulaması tamamlanmadan topluluk yazımı açılamaz.

Desteklenen dönüşler:

- kayıt doğrulaması için `cepdepo://auth/confirm`;
- şifre sıfırlama için `cepdepo://auth/reset-password`.

Deep link işleyici yalnız beklenen şema ve auth hedeflerini kabul eder. Callback parametreleri Supabase’in güncel mobil auth akışına göre oturuma çevrilir; hata durumunda token veya teknik sunucu mesajı ekrana/loga yazılmaz.

Şifre sıfırlama isteği, e-posta adresinin kayıtlı olup olmadığını açığa çıkarmayan aynı başarı mesajını verir. Reset callback’i geçerli oturumu kurduktan sonra yeni şifre formunu açar.

### 4.3 Uygulama detayı topluluk alanı

Mevcut uygulama detayının altına şunlar eklenir:

- görünür değerlendirmelerden hesaplanan ortalama puan ve adet;
- görünür değerlendirme listesi;
- kullanıcının mevcut değerlendirmesi veya yeni değerlendirme çağrısı;
- 1–5 puan ve isteğe bağlı yorum metni formu;
- kendi değerlendirmesini düzenleme ve kaldırma;
- uygulamayı şikâyet etme;
- sürüm geçmişindeki belirli bir sürümü şikâyet etme.

Oturumsuz kullanıcı yazma eyleminde girişe yönlendirilir. Oturumlu fakat e-postası doğrulanmamış kullanıcı doğrulama durumuna yönlendirilir. İndirme ve herkese açık topluluk okuması hesap gerektirmez.

## 5. Veri modeli

Yeni şema değişiklikleri mevcut imperative migration düzeninde ayrı migration olarak eklenir.

### 5.1 Enum’lar

- `profile_status`: `active`, `suspended`
- `review_moderation_status`: `visible`, `hidden`
- `report_reason`: `acilmiyor`, `link_bozuk`, `sahte_uygulama`, `diger`
- `report_status`: `open`, `resolved`, `dismissed`

Enum değerleri veri sözleşmesidir; arayüzde Türkçe ve aksanlı etiketlere çevrilir.

### 5.2 `profiles`

- `user_id uuid primary key references auth.users(id) on delete cascade`
- `username extensions.citext not null unique`
- `avatar_path text null`
- `status profile_status not null default 'active'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Kullanıcı adı normalize edilmiş biçimde 3–30 karakterdir ve yalnız harf, sayı, nokta ve alt çizgi kabul eder. Başta/sonda nokta veya alt çizgi ve art arda ayraç kabul edilmez. Görüntülenen kullanıcı adı büyük/küçük harf bakımından kullanıcının seçimini koruyabilir; benzersizlik `citext` ile büyük/küçük harfe duyarsızdır.

`auth.users` insert trigger’ı kayıt metadata’sındaki kullanıcı adını yeniden doğrular ve profil satırını aynı transaction içinde oluşturur. `raw_user_meta_data` yalnız bu başlangıç girdisi için kullanılır; sahiplik, hesap durumu veya rol kararı için kullanılmaz. Trigger hataları kaydı durdurabileceğinden duplicate ve validation senaryoları pgTAP ile sınanır.

### 5.3 `reviews`

- `id uuid primary key default gen_random_uuid()`
- `app_id uuid not null references apps(id) on delete cascade`
- `user_id uuid not null references profiles(user_id) on delete cascade`
- `rating smallint not null check (rating between 1 and 5)`
- `body text null`
- `moderation_status review_moderation_status not null default 'visible'`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `unique (app_id, user_id)`

Yorum metni isteğe bağlıdır. Boş veya yalnız whitespace metin `null` olarak saklanır; dolu metin 3–2000 karakterdir. Kullanıcı yalnız kendi değerlendirmesini oluşturabilir, güncelleyebilir ve kaldırabilir. Kullanıcı `moderation_status` değerini değiştiremez.

Yeni değerlendirmeler MVP’de hemen `visible` olur. Admin teslimatı görünür kaydı `hidden` yapabilir. Anonim ve authenticated kullanıcılar yalnız aktif uygulamaların `visible` değerlendirmelerini okuyabilir. Puan ortalaması ve adet yalnız bu satırlardan hesaplanır.

### 5.4 `reports`

- `id uuid primary key default gen_random_uuid()`
- `reporter_id uuid not null references profiles(user_id) on delete cascade`
- `app_id uuid not null references apps(id) on delete cascade`
- `version_id uuid null`
- `reason report_reason not null`
- `description text null`
- `status report_status not null default 'open'`
- `admin_note text null`
- `created_at timestamptz not null default now()`
- `resolved_at timestamptz null`

`version_id` verilirse sürümün `app_id` ile eşleşmesi bileşik foreign key ile garanti edilir. Açıklama isteğe bağlıdır; doluysa 3–1000 karakterdir. Aynı kullanıcı aynı uygulama/sürüm hedefi için bir açık şikâyete sahip olabilir. Partial unique index hem tekrar dokunmayı hem açık şikâyet spam’ini engeller.

Kullanıcı kendi şikâyetini oluşturabilir ve gönderim sonucunu görebilir; `status` veya `admin_note` değiştiremez. Admin işleme davranışı dördüncü teslimata bırakılır.

### 5.5 Puan özeti

Puan özeti, `security_invoker` kullanan ve yalnız aktif uygulamaların görünür değerlendirmelerini toplayan bir view veya eşdeğer typed sorgu sözleşmesi üzerinden okunur. Uygulama başına ortalama ve adet birlikte döner. Ortalama istemcide farklı satırlardan yeniden hesaplanmaz.

Sorgu yolları için en az şu indeksler bulunur:

- görünür değerlendirmeleri uygulama ve tarihe göre listeleme;
- kullanıcının değerlendirmelerini tarihe göre listeleme;
- şikâyetleri bildiren kullanıcı ve tarihe göre listeleme;
- foreign key’in referencing tarafındaki topluluk sütunları.

## 6. Yetkilendirme ve RLS

Yeni public tablolar için RLS zorunludur. Data API’nin 2026 auto-exposure değişikliğine güvenilmez; gereken `SELECT/INSERT/UPDATE/DELETE` ve sequence grant’leri açıkça verilir, gerekmeyen yetkiler verilmez.

Topluluk yazma politikaları şu koşulların tümünü ister:

1. `(select auth.uid())` satır sahibidir;
2. kullanıcının e-postası doğrulanmıştır;
3. profil durumu `active` değerindedir;
4. hedef uygulama aktiftir;
5. hedef sürüm verilmişse ilgili uygulamaya aittir ve yayımlanmıştır.

E-posta doğrulama ve profil durumunu denetleyen yardımcı, metadata/JWT kullanıcı girdisine güvenmez. Karmaşık kontrol için `security definer` gerekirse exposed olmayan private şemada tutulur, sabit boş `search_path` kullanır, çağıran `auth.uid()` değerini açıkça doğrular ve doğrudan execute yetkisi public rollere verilmez.

UPDATE politikalarında hem `USING` hem `WITH CHECK` bulunur. RLS’de kullanılan sahiplik ve ilişki sütunları indekslenir. `TO authenticated` tek başına yetkilendirme sayılmaz.

Service-role/secret anahtarı mobil pakete, `EXPO_PUBLIC_*` değişkenlerine veya repository’ye girmez.

## 7. Avatar Storage tasarımı

`avatars` bucket’ı public read olarak kullanılabilir; kullanıcı yazımı RLS ile kendi UUID klasörüne sınırlandırılır. Yol biçimi kullanıcı girdisinden türetilmez:

`<auth-user-id>/avatar.<validated-extension>`

İzin verilen MIME türleri PNG, JPEG ve WebP; üst sınır 5 MB’tır. İstemci dosya türü ve boyutunu yüklemeden önce doğrular, fakat güvenlik sınırı bucket yapılandırması ve Storage politikalarıdır.

Deterministik avatar değişimi Storage upsert gerektirdiği için ilgili kullanıcıya yalnız kendi yolunda gereken `INSERT`, `SELECT` ve `UPDATE` politikaları verilir. Kaldırma için yalnız kendi yolunda `DELETE` verilir.

Avatar yükleme tamamlanır fakat profil güncellemesi başarısız olursa yeni nesne temizlenmeye çalışılır. Eski avatar, profil güncellemesi başarıyla tamamlanmadan silinmez. Uygulama, avatar hatasında profil ve topluluk metnini göstermeye devam eder.

## 8. Veri akışı ve cache

- Auth oturum durumu React context içinde tutulur; sunucu verisi TanStack Query’ye aittir.
- Repository’ler Supabase satırlarını UI domain tiplerine mapper’lar aracılığıyla çevirir.
- Değerlendirme mutation’ları başarıdan sonra ilgili uygulamanın değerlendirme listesi, puan özeti, kullanıcının değerlendirmesi ve Hesap geçmişi query’lerini invalidate eder.
- Profil mutation’ı profil ve görünür değerlendirmelerdeki profil gösterimini yeniler.
- Şikâyet mutation’ı yalnız ilgili hedefin gönderim durumunu yeniler.
- Auth çıkışında kullanıcıya özel query verisi temizlenir; anonim katalog cache’i korunabilir.

Optimistic update kullanılmaz. Constraint ve RLS son otorite olduğu için mutation önce sunucuda tamamlanır, ardından hedefli cache yenilemesi yapılır. Gönder butonları işlem sırasında devre dışıdır ve çift dokunma engellenir.

## 9. Hata yönetimi

- Alan doğrulama hataları ilgili alanın yanında kısa Türkçe metinle gösterilir.
- Supabase’in teknik hata, constraint, tablo veya policy adları kullanıcıya gösterilmez.
- Kullanıcı adı çakışması anlaşılır bir alan hatasına çevrilir; kayıt yarışı durumunda veritabanı unique constraint son otoritedir.
- Auth e-posta işlemleri hesap varlığını açığa çıkarmaz.
- Ağ ve beklenmeyen sunucu hataları yeniden deneme seçeneği sunar.
- Oturum hatası anonim kataloğu engellemez.
- Avatar yükleme hatası profil metnini veya uygulama kullanımını engellemez.
- Şikâyet tekrarı yeni kayıt oluşturmaz ve mevcut açık bildirim kullanıcıya açıklanır.
- Loglarda token, şifre, auth callback parçaları veya kişisel veri tutulmaz.

## 10. Bağımlılıklar ve yapılandırma

Yalnız Expo SDK ile uyumlu `expo-image-picker` yeni product dependency olarak eklenir ve `npx expo install` kullanılır. Mevcut Supabase JS, TanStack Query ve AsyncStorage korunur.

Hosted Supabase Auth ayarlarında e-posta doğrulaması açık olmalı; `cepdepo://auth/confirm` ve `cepdepo://auth/reset-password` izin verilen redirect URL’lerine eklenmelidir. E-posta gönderimi için üretim SMTP yapılandırması dağıtım kontrol listesinde doğrulanır; varsayılan geliştirme gönderim limitlerine güvenilmez.

## 11. Test stratejisi

### Veritabanı ve Storage

pgTAP testleri:

- profil trigger’ı ve kullanıcı adı doğrulaması;
- büyük/küçük harfe duyarsız kullanıcı adı benzersizliği;
- explicit grant’ler ve varsayılan erişimin kapalı olması;
- anon, doğrulanmamış, doğrulanmış, başka kullanıcı ve askıya alınmış kullanıcı RLS senaryoları;
- değerlendirme sahipliği, tek değerlendirme ve moderasyon alanı koruması;
- yalnız görünür değerlendirmelerin ortalama/listeye girmesi;
- uygulama/sürüm şikâyeti ilişkisi ve tek açık şikâyet;
- avatar bucket tür/boyut/yol ve sahiplik politikaları;
- service-role yönetim erişimi.

Migration temiz veritabanına sıfırdan uygulanır. Üretilen `database.types.ts` migration sonrasında yenilenir ve elle düzenlenmez.

### Mobil birim ve bileşen testleri

- auth repository ve oturum provider yaşam döngüsü;
- deep link ayrıştırma ve geçersiz callback reddi;
- kayıt, giriş, şifre sıfırlama ve profil form doğrulaması;
- auth/constraint hatalarının güvenli Türkçe mesajlara çevrilmesi;
- avatar seçim ve upload orchestration’ı;
- değerlendirme ve şikâyet repository/mapper/query davranışı;
- hedefli query invalidation;
- oturumsuz, doğrulanmamış, aktif ve askıya alınmış Hesap ekranı;
- değerlendirme yükleniyor, boş, hata ve başarı durumları;
- değerlendirme oluşturma, düzenleme ve kaldırma;
- uygulama ve sürüm şikâyeti akışı;
- mevcut anonim katalog, detay ve indirme regresyonları.

## 12. Production APK ve dağıtım

Google Play yayını yapılmaz. Mevcut `eas.json` içindeki `release` profili production ortamı ve internal APK dağıtımı için kullanılır.

Dağıtım öncesinde:

1. Hosted Supabase migration’ları doğru project ref’e uygulanır.
2. Auth redirect URL’leri ve üretim e-posta gönderimi doğrulanır.
3. EAS production environment’a yalnız public Supabase URL/publishable key ve diğer public bağlantılar eklenir.
4. `app.json` sürümü ve Android `versionCode` artırılır.
5. Android package adı `com.cepdepo.app` ve mevcut kalıcı imza anahtarı korunur.
6. Test, typecheck, lint, veritabanı testleri ve Expo Doctor geçer.
7. `npx eas-cli build --platform android --profile release` ile imzalı APK üretilir.
8. Paylaşılabilir EAS HTTPS indirme bağlantısı ve sürüm bilgisi teslim edilir.

APK bağlantısını alan kullanıcı, Android’in bilinmeyen kaynak uyarısını kabul ederek Cep Depo’yu kurabilir. Uygulama gerçek hosted Supabase projesine bağlanır. EAS veya Supabase için gereken hesap erişimi kullanıcı tarafından sağlanır; credential ve secret değerler belgeye ya da kaynak koda yazılmaz.

## 13. Doğrulama ve kabul ölçütleri

Kod tesliminden önce şu kontroller çalıştırılır:

```bash
npm test
npm run typecheck
npm run lint
npm run db:reset
npm run db:test
npm run db:types
npx expo-doctor
```

Başarı ölçütleri:

- Yeni kullanıcı kayıt olup e-postasını doğrulayabilir.
- Doğrulanmış kullanıcı giriş/çıkış ve şifre sıfırlama yapabilir.
- Kullanıcı profilini ve avatarını yalnız kendi hesabı için yönetebilir.
- Aktif, doğrulanmış hesap uygulama başına tek puan/değerlendirme oluşturabilir, düzenleyebilir ve kaldırabilir.
- Yorum metni olmadan yalnız puan gönderilebilir.
- Anonim kullanıcı görünür değerlendirmeleri ve doğru puan özetini okuyabilir.
- Doğrulanmış aktif hesap uygulama veya yayımlanmış sürüm için şikâyet gönderebilir; aynı hedefte ikinci açık şikâyet oluşturamaz.
- Doğrulanmamış veya askıya alınmış hesap topluluk yazımı yapamaz.
- Hiçbir kullanıcı başka kullanıcının profilini, değerlendirmesini, avatarını veya şikâyetini değiştiremez.
- Anonim katalog ve APK indirme davranışı gerilemez.
- İmzalı production APK paylaşılabilir HTTPS bağlantısından başka cihazlara kurulabilir ve hosted backend ile çalışır.
