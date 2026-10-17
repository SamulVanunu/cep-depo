# Cep Depo Otomatik APK Yayınlama ve Yönetim Tasarımı

**Tarih:** 2026-10-15
**Durum:** Kullanıcı tarafından sohbet içinde onaylanan tasarımın yazılı hali

## Amaç

Adminin uygulama bilgilerini ve APK'yı tek ayrıntılı akışta girmesini, APK
manifestindeki gerçek sürüm bilgisinin otomatik okunmasını ve doğrulama başarılı
olduğunda ayrıca kullanıcıya açık bir taslak/yayın adımı olmadan uygulamanın
katalogda yayınlanmasını sağlamak.

Aynı çalışma, `Uygulamalar > Yönet` ekranını uygulamanın tüm yaşam döngüsünün
tek merkezi haline getirir:

- katalog bilgilerini ve görselleri düzenleme,
- yeni APK ile güncelleme,
- geçici olarak yayından kaldırma,
- yeniden yayınlama,
- uygulamayı ve Cep Depo'da tutulan varlıklarını kalıcı silme.

Başarı ölçütleri:

- Admin yalnız görünen uygulama bilgilerini girer; `versionName`, `versionCode`
  ve paket adı yerel APK manifestinden okunur.
- Yeni uygulama veya güncelleme, doğrulama tamamlandığında tek işlem akışıyla
  yayınlanır; kullanıcıya taslak listesi veya ikinci bir `Yayınla` eylemi
  gösterilmez.
- Başarısız yeni yayın denemesi yarım katalog kaydı bırakmaz ve tekrar
  denenebilir.
- Güncellemede eski çalışan APK, yeni sürüm tamamen hazır olmadan kaldırılmaz.
- Başarılı güncellemeden sonra eski katalog sürümleri kalıcı silinir. Supabase
  Storage kaynakları temizlenir; harici GitHub dosyalarına dokunulmaz.
- Yönet ekranında düzenle, güncelle, yayından kaldır, yeniden yayınla ve kalıcı
  sil eylemleri açık ve birbirinden ayrıdır.
- Tüm mutasyonlar doğrulanmış admin oturumu, server-side rol kontrolü, audit
  kaydı ve güçlü silme onayı gerektirir.

## Önceki Tasarımla İlişki

Bu belge,
`docs/superpowers/specs/2026-10-14-external-apk-admin-reliability-design.md`
içindeki güvenlik sınırlarını korur ancak şu ürün kararlarını değiştirir:

- Ayrı kontrol ekranındaki manuel `Yayınla` eylemi kaldırılır.
- Başarılı upload/finalize işlemi artık otomatik katalog yayınıyla tamamlanır.
- Kullanıcıya açık, yeniden kullanılabilir taslak yaşam döngüsü kaldırılır.
- Sürüm adı ve sürüm kodu elle girilmez; yerel APK manifestinden okunur.
- Yeni uygulama hızlı/eksik kayıt yerine yayın için gerekli tüm katalog
  bilgileriyle hazırlanır.
- Güncelleme başarıyla tamamlandığında eski katalog sürümü saklanmaz.

Korunan kararlar:

- APK kaynakları açık `storage | external` ayrımı kullanır.
- Harici kaynak için aynı APK'nın yerel kopyası, public doğrudan HTTPS URL,
  boyut ve SHA-256 zorunludur.
- Supabase Storage yönlendirme eşiği tam `50_000_000` bayttır.
- Harici APK yayınlama server-only
  `EXTERNAL_APK_PUBLISHING_ENABLED` acil kapatma anahtarına bağlıdır.
- Mobil istemci indirme sonrasında byte boyutu, ZIP magic ve SHA-256
  doğrulamasını sürdürür.
- GitHub kimlik bilgileri yalnız yerel `gh`/OS keyring içinde kalır; admin
  sitesine GitHub tokenı eklenmez.

## Kapsam

### Dahil

- Yerel APK'dan browser-side Android manifest ayrıştırma.
- Paket adı, `versionName`, `versionCode`, mümkünse min/target SDK gösterimi.
- Yeni uygulama için tam katalog formu.
- Zorunlu ikon ve isteğe bağlı çoklu ekran görüntüsü.
- Kategori seçimi ve mevcut kategori yönetiminin kullanılması.
- Storage ve external kaynaklarda otomatik yayınlama.
- Güncellemede paket kimliği ve artan sürüm kodu doğrulaması.
- Eski katalog sürümlerinin başarılı güncellemeden sonra kalıcı silinmesi.
- Supabase Storage varlıkları için güvenli, tekrar denenebilir temizleme.
- Yayından kaldırma ve yeniden yayınlama.
- Güçlü onaylı kalıcı uygulama silme.
- Mevcut Yönet ekranının eylem merkezine dönüştürülmesi.
- Veritabanı migration'ları, admin testleri ve production rollout planı.

### Hariç

- GitHub release veya asset silme.
- Admin sitesinde GitHub tokenı saklama.
- APK içinden otomatik ikon çıkarıp katalog ikonu olarak kullanma.
- Ekran görüntüsünü zorunlu tutma.
- Kullanıcılara eski APK sürümlerini seçme veya downgrade imkanı verme.
- Background worker/harici job altyapısı kurma.
- Mobil istemcinin bu çalışma dışında yeniden tasarlanması.
- Hosted migration, production deploy, mevcut production taslağını silme veya
  gerçek APK yayını için örtülü izin.

## Kullanıcı Akışı

### Yeni uygulama

`APK Yükle` akışı tek ayrıntılı form olarak çalışır. Formda şunlar bulunur:

- uygulama adı,
- otomatik türetilen fakat düzenlenebilir slug,
- zorunlu aktif kategori,
- kısa açıklama,
- detaylı açıklama,
- zorunlu PNG/JPEG/WebP ikon,
- isteğe bağlı ekran görüntüleri,
- her ekran görüntüsü için erişilebilir alt metin,
- öne çıkar seçeneği,
- APK kaynağı (`storage` veya `external`),
- yerel APK dosyası,
- external kaynakta public doğrudan HTTPS URL,
- değişiklik notları.

Yerel APK seçilince manifest ayrıştırılır ve değiştirilemeyen bir özet gösterilir:

- paket adı,
- sürüm adı,
- sürüm kodu,
- okunabiliyorsa minimum ve hedef Android SDK.

Formda elle sürüm kodu alanı bulunmaz. Manifest okunamazsa yayınlama başlamaz;
admin farklı bir APK seçmeye yönlendirilir. Parser sonucu kısmi veya heuristic
olarak işaretleniyorsa yayın için kabul edilmez.

Son eylem `APK'yı yükle ve yayınla`dır. Bu eylem:

1. bütün zorunlu alanları doğrular ve ilk hatalı alana odaklanır,
2. yerel APK magic, ZIP yapısı, manifest, boyut ve SHA-256 kontrollerini yapar,
3. geçici varlıkları yükler veya external metadata'yı hazırlar,
4. server-side yayınlama işlemini çağırır,
5. başarıda yayınlanan uygulamanın Yönet ekranına gider,
6. hata halinde oluşturulan geçici kayıt ve Storage nesnelerini temizler ve
   `Tekrar dene` sunar.

Kullanıcıya başarılı veya başarısız bir işlem sonrasında taslak listesi
gösterilmez.

### Mevcut uygulamayı güncelleme

Yönet ekranındaki `Yeni APK ile güncelle` eylemi uygulama bilgilerini korur ve
APK odaklı akışı açar. İkon/görsel/kategori bilgileri aynı ekrandaki düzenleme
işlemiyle istenirse değiştirilir.

Yeni APK:

- uygulamanın kayıtlı paket adıyla aynı olmalıdır,
- mevcut yayınlanmış sürümden daha yüksek gerçek `versionCode` taşımalıdır,
- storage/external kaynağın bütün mevcut güvenlik kontrollerini geçmelidir.

Yeni sürüm tamamen doğrulanıp yayınlanmadan eski sürüme dokunulmaz. Başarıdan
sonra eski `app_versions` kayıtları kalıcı silinir. Eski kaynak `storage` ise
ilgili APK nesnesi temizlenir. Kaynak `external` ise katalog kaydı silinir,
GitHub release/asset yerinde kalır.

### Yönet ekranı

Yönet ekranı şu grupları açıkça gösterir:

- `Bilgileri düzenle`: başlık, slug, kategori, kısa/detaylı açıklama, ikon,
  ekran görüntüleri ve öne çıkar durumu.
- `Yeni APK ile güncelle`: manifest doğrulamalı yeni sürüm akışı.
- `Yayından kaldır`: uygulamayı katalogdan gizler, veriyi korur.
- `Tekrar yayınla`: mevcut geçerli yayınlanmış sürümü yeniden katalogda açar.
- `Kalıcı sil`: uygulama ve Cep Depo tarafından yönetilen ilişkili varlıkları
  siler.

`Kalıcı sil`, uygulama adının birebir yazılmasını ve ikinci bir onayı gerektirir.
Yayından kaldırma, kalıcı silmenin alternatifi olarak normal/güvenli eylemdir;
kalıcı silme ayrı tehlikeli alanda yer alır.

## APK Manifest Ayrıştırma

APK manifest ayrıştırması bir adapter arkasında istemci tarafında çalışır. UI
seçilen parser paketini doğrudan import etmez. Adapter şu sözleşmeyi döndürür:

```ts
type ParsedApkManifest = Readonly<{
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdkVersion?: number;
  targetSdkVersion?: number;
}>;
```

Kurallar:

- `packageName` geçerli Android paket adı biçiminde olmalıdır.
- `versionName` boş olamaz ve mevcut 40 karakter katalog sınırını aşamaz.
- `versionCode` pozitif güvenli tam sayı olmalı ve PostgreSQL `integer`
  sınırına sığmalıdır.
- Parser yalnız kesin manifest sonucu döndürdüğünde işlem devam eder.
- MD5 hesaplanmaz; mevcut chunked SHA-256 akışı tek bütünlük özeti olarak kalır.
- Büyük APK'nın tamamını manifest için gereksiz yere belleğe alan parser kabul
  edilmez.
- Parser hataları kullanıcıya güvenli Türkçe mesaj olarak gösterilir; raw binary
  içerik veya stack trace loglanmaz.

Browser-side ayrıştırma admin kullanım hatasını önler ancak tek başına kötü
niyetli admin için güven sınırı değildir. Server action tipleri, admin rolü,
paket sürekliliği, artan sürüm kodu, boyut/hash ve kaynak kurallarını yeniden
doğrular. External APK'nın tamamı Vercel üzerinden indirilmez; nihai byte/hash
doğrulaması mobil istemcide sürer.

Parser bağımlılığı implementation planı hazırlanırken `dependencies` iş akışıyla
lisans, bakım durumu, browser/Next.js uyumu, bundle etkisi ve gerçek APK fixture
sonuçları açısından değerlendirilecek ve exact lockfile ile sabitlenecektir.

## Veri Modeli

### Uygulama paket kimliği

`apps` tablosuna nullable `package_name` eklenir. Yeni otomatik yayınlama
akışında zorunludur. Mevcut uygulamalarda ilk başarılı manifest-doğrulamalı
güncelleme paket kimliğini kurar. Sonraki güncellemeler birebir aynı paket adını
gerektirir.

Migration mevcut kayıtlar için tahminde bulunmaz ve var olan APK'ları yeniden
indirmez. `package_name` için biçim ve uzunluk constraint'i eklenir; yeni RPC
paket kimliği olmadan yeni uygulama yayınına izin vermez.

### Geçici yayın işlemi

Kullanıcıya açık `draft` yerine kısa ömürlü bir yayın işlemi kimliği kullanılır.
Geçici Storage yolları uygulama/sürüm kaydı olarak katalogda görünmez. İşlem
başarıyla finalize edilince kanonik yollar ve yayınlanmış kayıtlar oluşturulur.

İşlem başarısızsa:

- yeni uygulama/sürüm katalogda görünmez,
- geçici Storage nesneleri silinir,
- silinemeyen nesneler temizleme kaydına eklenir,
- aynı form verileriyle yeniden deneme yapılabilir.

Mevcut `app_versions.status = draft` şema değeri geriye dönük uyumluluk için ilk
migration'da kaldırılmak zorunda değildir. Yeni UI başarılı işlem sonucu kalıcı
draft üretmez veya listelemez. Eski production draft'ları migration sırasında
otomatik silinmez.

### Temizleme kayıtları

Storage ile PostgreSQL tek transaction paylaşmadığı için sınırlı bir cleanup
kaydı gerekir. Kayıt yalnız şu güvenli metadata'yı taşır:

- bucket,
- doğrulanmış kanonik/geçici path,
- işlem kimliği,
- hedef türü,
- deneme sayısı ve son hata zamanı.

Secret, signed URL, token veya external APK URL'si cleanup kaydına yazılmaz.
Temizleme idempotenttir; olmayan nesne başarı kabul edilir. Admin işlemleri
bekleyen cleanup kayıtlarını kontrollü biçimde yeniden deneyebilir. Public
katalog hiçbir zaman cleanup bekleyen eski Storage nesnesine işaret etmez.

## Sunucu İşlemleri ve Atomiklik

### Yeni uygulama yayınlama

Yeni server orchestration:

1. admin kimliğini ve rolünü doğrular,
2. katalog alanlarını server-side schema ile doğrular,
3. kategori aktifliğini kontrol eder,
4. manifest metadata, APK kaynak union'ı, boyut ve SHA-256 değerini doğrular,
5. external kaynakta rollout flag ve URL güvenlik kurallarını kontrol eder,
6. Storage kaynakta hedef nesnenin metadata'sını doğrular,
7. tek veritabanı transaction'ında uygulamayı aktif, sürümü published ve
   görsel kayıtlarını bağlı olarak oluşturur,
8. audit kayıtlarını aynı transaction'da yazar.

Server/Storage sınırındaki başarısızlıkta compensation cleanup çalışır. Başarı
cevabı yalnız katalog transaction'ı tamamlandıktan sonra döner.

### Güncelleme

Güncelleme RPC'si hedef uygulama satırını kilitler ve:

- paket adını karşılaştırır,
- mevcut en yüksek published `versionCode` değerinden büyük olmasını ister,
- yeni sürümü published yapar,
- uygulamayı active yapar,
- eski sürüm kayıtlarını siler,
- eski Storage yollarını cleanup çıktısı olarak döndürür,
- audit kaydına eski/yeni sürüm kodunu ve kaynak türünü yazar.

Eski Storage nesneleri transaction sonrasında silinir. Silme başarısızlığı yeni
yayını geri almaz; eski nesne public katalogdan erişilemez ve cleanup kaydına
alınır. Bu sıra, yeni yayın hazır olmadan çalışan APK'nın silinmesini önler.

### Yayından kaldırma ve yeniden yayınlama

- Yayından kaldırma `apps.status = archived` yapar; sürüm ve varlıkları korur.
- Yeniden yayınlama, en az bir geçerli published sürüm ve zorunlu ikon varsa
  `apps.status = active` yapar.
- Her iki işlem idempotent ve audit kayıtlıdır.

### Kalıcı silme

Kalıcı silme RPC'si admin rolünü, uygulama kimliğini ve yazılı uygulama adı
onayını doğrular. Uygulamayı silmeden önce Cep Depo'nun yönettiği Storage
yollarını güvenli cleanup çıktısı olarak toplar. Veritabanı transaction'ı:

- uygulamayı,
- sürümleri,
- ekran görüntüsü kayıtlarını,
- indirme kayıtlarını,
- FK/cascade politikasına göre yorum, takip ve rapor ilişkilerini

kalıcı kaldırır ve audit kaydı oluşturur. Migration, mevcut FK'lerin silmeyi
engellemediğini pgTAP ile doğrular; gerekli açık cascade/set-null değişiklikleri
ayrıca tanımlar.

Transaction sonrasında yalnız Supabase tarafından yönetilen ikon, screenshot ve
APK yolları silinir. External URL'lere HTTP DELETE gönderilmez ve GitHub API
çağrılmaz.

## Görseller

- İkon ilk yayın için zorunludur.
- İkon PNG, JPEG veya WebP ve mevcut boyut limitleriyle doğrulanır.
- Ekran görüntüleri isteğe bağlıdır.
- Eklenen her ekran görüntüsü 2–180 karakter erişilebilir alt metin gerektirir.
- Görsel kayıtları yayın finalize işleminin parçası olur; başarısız yayında
  geçici görseller temizlenir.
- Yönet ekranında ekleme, alt metin/pozisyon düzenleme ve silme devam eder.
- Başarılı görsel mutation sonrasında mevcut `router.refresh()` davranışı
  korunur.

## Yetkilendirme ve Güvenlik

- Tüm yönetim sayfaları doğrulanmış oturum gerektirir.
- Tüm server action/RPC çağrıları yalnız UI korumasına güvenmez;
  `requireAdmin`/`private.require_admin_actor` kontrolü yapar.
- Service-role istemcisi yalnız server-side modüllerde kalır.
- External URL kuralları HTTPS, credentials/query/fragment yasağı ve
  localhost/private/special-use host reddini korur.
- APK filename, slug, Storage path ve screenshot path kullanıcı girdisinden
  doğrudan birleştirilmez; kanonik server-generated yollar kullanılır.
- Kalıcı silme CSRF'ye dayanıklı server action, yazılı ad onayı ve pending
  duplicate-submit koruması kullanır.
- Audit metadata'ya token, tam external URL, dosya içeriği veya secret yazılmaz.
- Raw parser, `gh`, Storage veya database hataları son kullanıcıya sızdırılmaz.

## Hata Yönetimi

- Manifest okunamazsa hiçbir upload/yayın işlemi başlamaz.
- Eksik kategori, açıklama veya ikon ilgili alanda düzeltilir; işlem kaydı
  oluşmaz.
- Upload/hash iptalinde geçici nesneler temizlenir ve tekrar deneme açılır.
- Otomatik yayın başarısızsa kullanıcıya taslak sunulmaz; compensation cleanup
  sonucu izlenir.
- Güncelleme başarısızsa mevcut published sürüm ve aktif uygulama korunur.
- Yeni yayın başarılı fakat eski Storage nesnesi silinemezse katalog yeniyi
  göstermeye devam eder; cleanup bekleyen durum operatöre uyarı olarak sunulur.
- Kalıcı silmede database transaction başarısızsa Storage nesneleri önceden
  silinmez.
- Rollout flag kapalıysa external otomatik yayın başlamadan güvenli hata verir;
  kalıcı external draft bırakılmaz.

## Mevcut Production Verisi

Ekran görüntüsünde görülen `tivimate · Kod 5 · draft` kaydı yeni tasarım için
güvenilir manifest metadata taşımıyor olabilir. Migration bu kaydı sessizce
yayınlamaz veya silmez.

Rollout öncesinde ayrı, açık onayla:

1. kayıt ve ilişkili Storage yolu/harici URL incelenir,
2. mevcut draft kalıcı silinir veya yalnız arşiv kanıtı olarak korunur,
3. TiviMate APK yeni manifest-doğrulamalı akıştan yeniden geçirilir.

Bu veri işlemi kod migration'ından ayrı bir production side effect'tir.

## Test Stratejisi

### APK parser

- Gerçek, küçük ve dağıtıma uygun olmayan APK fixture'ından paket/sürüm okuma.
- Binary manifest eksikliği, bozuk ZIP, eksik alan ve taşan sürüm kodu reddi.
- Büyük dosyada gereksiz tam-buffer/MD5 davranışının kullanılmaması.
- Parser'ın yalnız kesin sonucu kabul etmesi.

### Admin Vitest

- Tam yeni uygulama formu ve alan odaklama.
- Kategori, kısa/detaylı açıklama ve ikon zorunluluğu.
- Ekran görüntüsünün isteğe bağlı olması; eklenirse alt metin zorunluluğu.
- Manifest alanlarının read-only gösterimi ve payload'a doğru taşınması.
- Paket uyuşmazlığı ve eşit/düşük sürüm kodu reddi.
- Otomatik yayın başarısı, cleanup başarısızlık uyarısı ve tekrar deneme.
- Güncelleme/yayından kaldırma/yeniden yayınlama/kalıcı silme UI durumları.
- Duplicate submit ve güvenli hata mesajları.

### PostgreSQL pgTAP

- `package_name` constraint'i ve mevcut nullable kayıt geçişi.
- Admin dışı RPC çağrılarının reddi.
- Yeni uygulama + published version + active status atomikliği.
- Güncellemede paket adı ve artan version code zorunluluğu.
- Başarılı güncellemede eski version kayıtlarının silinmesi.
- Başarısız yeni sürümde eski sürümün korunması.
- Archive/activate idempotency.
- Kalıcı silmede tüm beklenen FK/cascade davranışı.
- Audit action ve secret içermeyen metadata.
- Cleanup kaydı path/bucket doğrulaması ve idempotency.

### Playwright

- Admin girişi olmadan yayın/yönetim erişiminin reddi.
- Yeni Storage uygulamasının tek akışta yayınlanması.
- Yeni external uygulamanın yerel APK + URL ile otomatik yayınlanması.
- Zorunlu ikon ve isteğe bağlı screenshot davranışı.
- Mevcut uygulamaya yeni APK güncellemesi ve eski sürümün listeden kalkması.
- Yayından kaldırma ve yeniden yayınlama.
- Yazılı ad onaylı kalıcı silme.
- Başarısız yayın sonrası kullanıcıya taslak gösterilmemesi.

### Tam doğrulama

- Supabase reset ve bütün pgTAP dosyaları.
- Hosted olmayan local migration lint.
- Admin Vitest, TypeScript, ESLint ve production Next.js build.
- Admin Playwright.
- Bağımlılık/lisans incelemesi.
- Güvenlik, erişilebilirlik ve final code review.

## Rollout ve Geri Alma

Her dış işlem ayrı açık onay gerektirir:

1. Hosted database migration.
2. Mevcut production draft'ın silinmesi veya değiştirilmesi.
3. Admin production deploy.
4. `EXTERNAL_APK_PUBLISHING_ENABLED=true` production ortam değişikliği.
5. Onaylı tek bir gerçek APK ile production smoke yayını.
6. Katalog/uygulama rollout kararları.

Önerilen sıra:

1. Yerel migration ve bütün testler tamamlanır.
2. Hosted migration uygulanır; şema/lint doğrulanır.
3. Yeni admin deploy edilir ancak external flag mevcut durumda tutulur.
4. Storage kaynaklı non-production fixture ile yönetim akışı doğrulanır.
5. Ayrı onayla external flag açılır ve yeni deployment oluşturulur.
6. Tek onaylı APK manifest/hash/size bilgisiyle smoke edilir.
7. Fiziksel `0.3.1` cihazında indirme, hash ve installer doğrulanır.

Geri alma:

- External sorununda flag yeniden `false` yapılır ve admin yeniden deploy edilir.
- UI sorunu için önceki Vercel deployment alias'ı geri alınır.
- Migration additive tasarlanır; eski admin deploy'u yeni nullable kolonları yok
  sayabilir.
- Veri silen production işlemleri geri alınamaz; bu nedenle mevcut draft ve
  gerçek uygulama silmeleri rollout'tan ayrı açık onay ister.

## Dokümantasyon

Admin README ve operatör dokümanı şunları açıklayacak:

- admin hesabı/rol gereksinimi,
- zorunlu ve isteğe bağlı katalog alanları,
- APK manifestinden sürüm okuma,
- Storage ile external kaynak farkı,
- otomatik yayınlama ve rollback flag'i,
- güncellemede eski katalog sürümünün silinmesi,
- GitHub dosyalarının otomatik silinmemesi,
- yayından kaldırma ile kalıcı silme farkı,
- cleanup uyarısında operatörün izleyeceği adımlar.
