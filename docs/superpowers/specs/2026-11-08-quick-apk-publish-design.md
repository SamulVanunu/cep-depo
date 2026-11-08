# Hızlı APK yayını ve otomatik katalog JSON aktarımı

Tarih: 2026-11-08
Durum: Tasarım onaylandı, uygulama planı bekliyor

## Amaç

Panelde APK dosyasını bırakmak yeterli olsun: sistem uygulamayı ve sürümü oluşturup
yayınlasın, ardından statik katalog JSON'unu GitHub'a göndererek uygulamanın mobilde
görünmesini sağlasın. Bugün APK yayını iki adımlı sihirbazda elle doldurulan formlara
bağlı ve JSON aktarımı ayrı bir Ayarlar düğmesiyle yapılıyor.

## Kapsam dışı

- Ekran görüntüleri ve açıklama metni otomatik üretilmez; onay ekranında elle girilir.
- `resources.arsc` çözümlemesi yapılmaz; ikon seçimi ZIP girdileri üzerinden sezgiseldir.
- Mevcut iki adımlı sihirbaz kaldırılmaz; gelişmiş yayın yolu olarak kalır.
- APK imza doğrulaması, güncelleme kaynakları ve APK saklama/silme politikaları değişmez.

## Akış

Sayfa: `admin/app/(dashboard)/publish/page.tsx` (APK Yükle). Sayfanın üstüne
`QuickPublish` bölümü eklenir; altındaki `PublishWizard` aynen kalır.

1. Kullanıcı APK dosyasını sürükleyip bırakır veya seçer (`accept=".apk"`, `APK_MAX_BYTES`).
2. Tarayıcı dosyayı `blobByteSource` üzerinden okur ve şunları çıkarır:
   - `parseApkManifest` (mevcut): paket adı, sürüm adı, sürüm kodu, minSdk, targetSdk.
   - `extractLauncherIcon` (yeni): launcher ikonu baytları ve MIME türü.
3. Türetilen değerler:
   - `title`: paket adının son parçası, ilk harfi büyütülür (`com.ornek.vizyona` → `Vizyona`).
   - `slug`: başlıktan `slugSchema` ile üretilir; çakışırsa `-2`, `-3` soneki denenir.
   - `shortDescription` / `description`: `<Title> Android uygulaması.` ile ön doldurulur
     (şema en az 10 karakter ister), düzenlenebilir.
4. Tek onay ekranı gösterilir: başlık, kategori (tek seçim, zorunlu), kısa açıklama,
   açıklama, ikon önizlemesi (değiştirilebilir), sürüm bilgisi (salt okunur) ve
   "Yayınla" düğmesi. Slug varsayılan olarak kapalı bir "Gelişmiş" bölümünde
   düzenlenebilir. Ekran görüntüleri hızlı akışta istenmez; yayın sonrası
   "Uygulamayı yönet" bağlantısıyla mevcut varlık yöneticisinden elle eklenir.
5. Onayda sırasıyla:
   1. Paket adı eşleşmesi kontrol edilir (bkz. aşağı).
   2. Yeni uygulama gerekiyorsa `createPublishingAppAction` çağrılır.
   3. İkon varsa mevcut `uploadAsset` yoluyla yüklenir.
   4. APK, mevcut `createUploadIntentAction` → TUS → `finalizeUploadAction` yoluyla yüklenir.
   5. Sürüm, mevcut `publishVersionReplacingPreviousAction` ile yayınlanır.
   6. `refreshCatalog` adımı hem DB/Storage JSON'unu hem de statik GitHub setini günceller.

Hızlı akışın varsayılanları: `supportsMobile = true`, `supportsTv = false`,
`accountRequirement = 'none'`, `changelog = '<versionName> sürümü.'`. Onay ekranında
salt okunur özet olarak gösterilir; TV desteği tek bir onay kutusuyla açılabilir.

## Paket adı eşleşmesi

`apps.package_name` ve `app_versions.package_name` alanları mevcut.

- APK'nın paket adıyla eşleşen ve `status = 'active'` olan bir uygulama varsa yeni
  uygulama oluşturulmaz; o uygulamaya yeni sürüm eklenir. Başlık/kategori/ikon alanları
  gizlenir, yalnızca sürüm ve açıklama alanları gösterilir.
- Eşleşen uygulama `archived` ise akış durur ve "Bu paket adı arşivlenmiş bir uygulamaya
  ait" hatası gösterilir; kullanıcı Uygulamalar sayfasından durumu değiştirebilir.
- Aynı paket adıyla birden fazla uygulama dönerse (olmaması gerekir) akış durur ve hata verir.

Paket adı sorgusu `dal` katmanında tek bir sorgu ile yapılır:
`.select('id, title, status').eq('package_name', pkg)`; `app_status` yalnızca
`active` ve `archived` değerlerini alır.

## İkon çıkarma

Yeni modül: `admin/src/features/uploads/apk-icon.ts`.

- Girdi: `ApkByteSource` (mevcut arayüz). Çıktı: `{ bytes: Uint8Array; mimeType: 'image/png' | 'image/webp' } | null`.
- ZIP merkezi dizini mevcut sabitlerle okunur (`MAX_CENTRAL_DIRECTORY_BYTES`, `MAX_ZIP_ENTRIES`).
- Adaylar: `res/mipmap-*/` ve `res/mipmap-anydpi-v26/` altındaki `ic_launcher*.png|webp`
  ve `res/drawable-*/` altındaki aynı adlı dosyalar.
- Seçim sırası: en yüksek yoğunluk (`xxxhdpi > xxhdpi > xhdpi > hdpi > mdpi > anydpi`),
  eşitlikte en büyük sıkıştırılmamış boyut.
- Hiç aday yoksa `res/mipmap-*` altındaki en büyük `.png`/`.webp` dosyası kullanılır.
- Tek dosya için üst sınır 2 MB; aşan aday atlanır.
- Adaptive icon (`ic_launcher.xml`) çözümlenmez; raster katman varsa o kullanılır, yoksa sonuç `null`.
- Sonuç `null` ise onay ekranında "İkon bulunamadı, elle yükle" uyarısı çıkar; yayın ikonsuz devam edebilir
  (`apps.icon_path` nullable).

## Katalog JSON otomasyonu

Mevcut `refreshCatalog` adımı (`version-service.ts` → `createCatalogRefreshAction`)
genişletilir:

- DB/Storage JSON yayını aynen korunur.
- Ek olarak, `CATALOG_JSON_REPO` ve `CATALOG_JSON_GITHUB_TOKEN` tanımlıysa statik set
  `buildStaticCatalogForAdmin` ile üretilip `publishStaticCatalog` ile GitHub'a gönderilir.
- Statik gönderim başarısız olursa sürüm yayını geri alınmaz; `catalogWarning` döner ve
  panelde "Katalog JSON güncellenemedi" uyarısı ile "Yeniden dene" düğmesi gösterilir.
- Aynı yol sürüm geri çekmede (`withdrawVersion`) de kullanılır.
- Ayarlar sayfasındaki elle "GitHub'a aktar" düğmesi acil durum yolu olarak kalır.

## Hata durumları

| Durum | Davranış |
| --- | --- |
| Manifest okunamaz | Dosya reddedilir, mevcut Türkçe hata metni gösterilir |
| İkon bulunamaz | Uyarı, ikon alanı elle doldurulabilir, yayın engellenmez |
| Paket adı arşivli uygulamada | Akış durur, yönlendirici hata |
| Slug çakışması | Sonek ile otomatik çözülür |
| APK yükleme/doğrulama hatası | Mevcut hata yolları ve telafi (compensation) mantığı kullanılır |
| Statik JSON aktarımı hatası | Yayın sürer, uyarı + yeniden dene |

## Dosyalar

- `admin/src/features/uploads/apk-icon.ts` (yeni) + `apk-icon.test.ts`
- `admin/src/features/uploads/apk-manifest.ts` (ZIP dizini ve girdi okuma yardımcıları dışa açılır)
- `admin/src/features/uploads/fixtures/manifest-apk.ts` (ikon girdili APK fixture'ı)
- `admin/src/features/publishing/quick-publish.tsx` (yeni) + `quick-publish.test.tsx`
- `admin/src/features/publishing/quick-publish-model.ts` (yeni, türetme/eşleştirme saf fonksiyonları) + test
- `admin/src/features/publishing/upload-asset.ts` (yeni, sihirbazdaki ortak varlık yükleme)
- `admin/src/features/publishing/publish-wizard.tsx` (ortak varlık modülünü kullanır)
- `admin/app/(dashboard)/publish/page.tsx` (bölüm eklenir)
- `admin/src/features/apps/publish-app-options.ts` ve `app-dal.ts` (`packageName` alanı)
- `admin/src/features/apps/app-schema.ts` (`normalizeSlug` dışa açılır)
- `admin/src/features/catalog/static-json/refresh.ts` (yeni, statik yayın sarmalayıcısı) + test
- `admin/src/features/catalog/catalog-json.ts` (başarılı DB yayınından sonra statik yayın)
- `admin/src/features/versions/version-service.ts` (uyarı akışı doğrulanır)

## Test planı

- `apk-icon`: fixture ZIP'lerle yoğunluk seçimi, aday yokluğu, 2 MB sınırı, bozuk ZIP.
- `quick-publish-model`: başlık/slug türetme, slug çakışması, paket adı eşleşmesi dalları.
- `quick-publish`: dosya seçimi → onay ekranı → yayın çağrı sırası (mock action'lar).
- `catalog-json`: statik yayın çağrılır, hata `catalogWarning`'e dönüşür.
- Mevcut `publish-wizard`, `apk-step`, `version-service` testleri bozulmadan geçer.
- `npx tsc --noEmit`, `npx vitest run` (admin).

## Geri alma

- Yeni bölüm yalnızca `QuickPublish` bileşenidir; kaldırılması mevcut sihirbazı etkilemez.
- Statik JSON otomasyonu env ile kapalıyken devre dışı kalır (`CATALOG_JSON_REPO` boş).
- Elle "GitHub'a aktar" düğmesi her durumda kullanılabilir.
