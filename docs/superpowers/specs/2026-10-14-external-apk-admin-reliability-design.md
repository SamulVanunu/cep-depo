# Cep Depo Harici APK ve Admin Güvenilirlik Tasarımı

**Tarih:** 2026-10-14  
**Durum:** Kullanıcı tarafından sohbet içinde onaylanan tasarımın yazılı hali

## Amaç

Supabase Storage planını yükseltmeden büyük APK sürümlerini güvenli biçimde yayınlamak, görsel yüklemelerinden sonra manuel sayfa yenileme gereksinimini kaldırmak ve `Yayınla` işleminin uygulamayı her durumda kataloğa açmasını sağlamak.

Başarı ölçütleri:

- Admin küçük APK'ları mevcut Supabase Storage akışıyla, büyük APK'ları doğrudan HTTPS dosya bağlantısıyla hazırlayabilir.
- Harici APK'nın boyutu ve SHA-256 değeri adminin yerel dosyasından hesaplanır; mobil istemci aynı değerleri doğrulamadan kurulum başlatmaz.
- `0.3.1`, Storage ve harici HTTPS kaynaklarını açık bir kaynak türüyle destekler.
- İkon ve ekran görüntüsü yüklemeleri adminin açık sayfasında manuel yenileme olmadan görünür.
- Son `Yayınla` eylemi, uygulama daha önce arşivli olsa bile sürümü yayınlar ve uygulamayı atomik olarak aktif eder.
- Eski `0.3.0` istemcilerine desteklemedikleri harici sürüm yanlışlıkla sunulmaz.

## Önceki Tasarımla İlişki

Bu belge, `docs/superpowers/specs/2026-10-13-mobile-tv-notifications-support-design.md` içindeki `0.3.1` kapsamını genişletir. `0.3.1` artık yalnız iptal hotfix'i değildir; harici HTTPS APK kaynak desteğini de içerir.

TV kataloğu, destek bağlantıları, push bildirimleri ve Android TV ADB kurulumu bu çalışmanın kapsamına alınmaz. Bunlar önceki belgedeki sonraki sürümlerde kalır.

`docs/superpowers/plans/2026-10-13-mobile-0.3.1-cancel-hotfix.md` yeni kapsamı karşılamaz ve bu spesifikasyon için yeni plan yazılana kadar uygulanmaya devam edilmez. O plandaki tamamlanmış iptal ve sürüm commitleri korunur.

## Kapsam

### Dahil

- APK sürümü için `storage` ve `external` kaynak türleri.
- Mevcut TUS/Supabase yükleme akışının korunması.
- Harici HTTPS link modunda yerel APK seçimi, tarayıcıda boyut/hash hesaplama ve link girişi.
- Mobil katalog modelinde ve indirme katmanında açık kaynak ayrımı.
- Mobilde her iki kaynak için boyut ve SHA-256 doğrulaması.
- `0.3.1` iptal durum makinesi ve harici kaynakla regresyon kapsamı.
- Admin görsel yüklemelerinden sonra istemci görünümünün yenilenmesi.
- Yayın işleminin uygulamayı her zaman aktif etmesi.
- Harici yayınlama için güvenli rollout kapısı.

### Hariç

- Supabase ücretli plana geçiş veya global Storage limitini artırma.
- Mega, TeraBox veya indirme sayfası/HTML döndüren paylaşım bağlantıları.
- Harici APK'yı Vercel veya Supabase sunucusu üzerinden proxy etme.
- URL'den sunucu tarafında tam APK indirip hash hesaplama.
- Kullanıcıya göre sürüm veya APK kaynağı hedefleme.
- Zorunlu güncelleme sistemi, OTA dağıtımı veya eski istemciyi uzaktan yükseltme.
- TV, push bildirimleri, destek mesajları ve ADB kurulumu.

## Sürüm ve Geçiş Kararı

- Mobil sürüm `0.3.1`, Android `versionCode` 4 olarak kalır.
- İptal hardening değişiklikleri korunur.
- `0.3.1` ilk kez EAS internal APK olarak oluşturulur ve Expo artifact bağlantısı gibi uygulama dışı bir kanaldan dağıtılır.
- Mevcut `0.3.0`, harici URL kaynaklarını desteklemediği için `0.3.1` harici kaynaklı bir katalog sürümü üzerinden bootstrap edilemez.
- Hosted şema ve admin harici taslak oluşturmayı destekleyebilir; harici sürüm yayınlama server-side rollout kapısı açılana kadar reddedilir.
- Fiziksel `0.3.1` testi tamamlandıktan ve kullanıcı ayrıca onay verdikten sonra rollout kapısı açılır.
- Rollout sonrasında eski `0.3.0` kullanıcılarının harici APK sürümlerini indirememesi kabul edilen geçiş maliyetidir; dağıtım sırasında `0.3.1` artifact bağlantısı açıkça paylaşılır.

## Veri Modeli

### Kaynak türü

`app_versions` kaydına açık kaynak ayrımı eklenir:

- `download_source`: `storage` veya `external`; mevcut kayıtlar için varsayılan `storage`.
- `apk_path`: Storage kaynağında mevcut kanonik yol; harici kaynakta `null`.
- `apk_url`: Harici kaynakta doğrudan HTTPS URL; Storage kaynağında `null`.
- `apk_size_bytes` ve `sha256`: iki kaynakta da zorunlu kalır.

Veritabanı constraint'i yalnız şu kombinasyonları kabul eder:

- `storage` + geçerli kanonik `apk_path` + boş `apk_url`.
- `external` + boş `apk_path` + geçerli uygulama-seviyesi kontrollerden geçmiş `apk_url`.

`apk_path` üzerindeki mevcut benzersizlik nullable kolon davranışıyla Storage nesneleri için korunur. URL'nin birden fazla sürümde tekrar kullanımını veritabanı benzersizlik kısıtı engellemez; sürüm kodu ve hash gerçek sürüm kimliğini belirlemeye devam eder.

### Katalog sözleşmesi

Katalog sorgusu ve view şu alanları birlikte sunar:

- Kaynak türü.
- Storage yolu veya harici URL'den yalnız ilgili olanı.
- Beklenen boyut ve SHA-256.

Mobil mapper, bu alanları ayrık bir union modele dönüştürür:

```ts
type ApkSource =
  | Readonly<{ kind: 'storage'; path: string }>
  | Readonly<{ kind: 'external'; url: string }>;
```

İndirme kodu URL/path biçimine bakarak kaynak tahmin etmez.

## Admin APK Akışı

### Kaynak seçimi

APK adımında iki mod bulunur:

1. `APK dosyası yükle`
2. `HTTPS APK linki kullan`

Storage modu mevcut hash, TUS upload, finalize, draft ve orphan cleanup akışını korur.

Harici link modu:

1. Admin doğrudan APK URL'sini girer.
2. Aynı APK'yı yerel dosya seçicisinden seçer.
3. Tarayıcı ilk dört byte'ın APK/ZIP magic değeri `50 4b 03 04` olduğunu doğrular.
4. Tarayıcı mevcut chunked hash yardımcı fonksiyonuyla SHA-256 hesaplar.
5. Dosyanın byte boyutu tarayıcıdaki yerel dosyadan alınır.
6. APK Supabase'e yüklenmez.
7. Server action doğrulanmış metadata ile harici draft sürüm oluşturur ve audit kaydı yazar.
8. Kontrol ekranı dosya adı, kaynak türü, alan adı, boyut, sürüm ve hash'i gösterir.
9. Admin açık `Yayınla` eylemini kullanır.

Harici URL için sunucu tam APK indirmez. Bu, Vercel süre/bant sınırlarını ve kontrolsüz büyük response riskini önler. Admin bağlantıyı yeni sekmede açıp doğrudan indirme davranışını kontrol edebilir; nihai bütünlük mobil indirme sonrasında doğrulanır.

### Boyut mesajı

Storage modunda uygulamanın kabul ettiği limit ile hosted global limit farklı kavramlardır. Production yapılandırması ücretli plan gerektirmediğinden admin arayüzü `50_000_000` byte üzerindeki dosyalarda şu yönlendirmeyi verir:

- Dosyanın Supabase Free global sınırını aşabileceğini açıklar.
- Harici HTTPS link moduna geçiş eylemi sunar.
- Kullanıcıyı başarısız TUS denemesine zorlamaz.

Tam eşik tek bir paylaşılan sabitten yönetilir ve hem görünür metin hem istemci doğrulaması aynı değeri kullanır. Harici link modu daha küçük dosyalar için de isteğe bağlı olarak seçilebilir.

## URL Güvenlik Kuralları

Harici URL:

- Yalnız `https:` kullanır.
- Geçerli ve public bir hostname içerir.
- Kullanıcı adı veya parola içermez.
- `localhost`, loopback, link-local veya private ağ IP'lerini hedefleyemez.
- Query string veya fragment içermez. Böylece token, imza, parola ya da geçici oturum bilgisi katalog verisine kaydedilemez.
- Kalıcı ve kimlik doğrulamasız doğrudan APK response'u sağlamalıdır.

Mega/TeraBox gibi HTML indirme sayfaları desteklenmez. Başlangıç sürümünde harici host allowlist'i tutulmaz; admin yetkili bir yayıncıdır ve mobil hash doğrulaması içerik bütünlüğünü zorunlu kılar.

URL'nin tamamı public katalog verisinde bulunur. Audit metadata'sı tam URL'yi tekrar kopyalamaz; yalnız kaynak türü ve normalize hostname kaydeder.

## Mobil İndirme Akışı

`ApkDownloadInput`, `apkPath` yerine ayrık `ApkSource` taşır.

- `storage`: Supabase public Storage URL'si mevcut helper ile oluşturulur.
- `external`: doğrulanmış HTTPS URL doğrudan indirme görevine verilir.

Her iki kaynakta ortak akış:

1. Hedef cache dosyası hazırlanır.
2. Native görev indirmeyi başlatır ve ilerlemeyi bildirir.
3. Kullanıcı iptal ederse UI hemen `cancelling` durumuna geçer; ikinci indirme temizlik tamamlanana kadar engellenir.
4. İndirme tamamlanınca gerçek byte boyutu ve SHA-256 kontrol edilir.
5. Doğrulama başarısızsa dosya silinir ve installer açılmaz.
6. Doğrulama başarılıysa Android installer açılır.

Harici kaynakta başlangıç URL'si güvenlik kurallarını sağlamıyorsa native görev oluşturulmaz. Ağ/HTTP hatası, boyut uyuşmazlığı ve hash uyuşmazlığı kullanıcıya aynı genel güvenlik mesajına düşmek yerine ayrıştırılabilir anlaşılır mesajlarla gösterilir; hassas URL ayrıntısı log veya UI'ya yazılmaz.

## Görsel Yenileme Düzeltmesi

### Uygulama yönetim sayfası

Mevcut `revalidatePath` sunucu cache'ini geçersiz kılar ancak açık client route'u yeniden render etmez. İkon veya ekran görüntüsü mutation'ı başarıyla tamamlandığında client `router.refresh()` çağırır.

- Refresh yalnız database mutation başarılıysa yapılır.
- Upload başarılı fakat metadata mutation başarısızsa başarı mesajı gösterilmez.
- Refresh başarısız olsa bile yükleme geri alınmış gibi gösterilmez; kullanıcı görünümün yenilenemediği konusunda bilgilendirilir.
- Ekran görüntüsü formu başarılı işlemden sonra temizlenir.

### Yayın sihirbazı

İkon upload helper'ı kaydedilen public path'i döndürür. `AppStep`, oluşturulan uygulamanın `iconPath` değerini bu sonuçla günceller ve güncel `SelectedPublishApp` nesnesini sonraki adıma taşır.

Kontrol ekranı yüklenen ikonu gösterir. Retry başarılı olduğunda da aynı güncel state kullanılır; yeni uygulama kaydı ikinci kez oluşturulmaz.

## Yayınlama ve Arşiv Davranışı

Kontrol ekranındaki açık `Yayınla` eylemi korunur; upload/finalize tamamlanması otomatik yayın değildir.

Wizard ve sürüm yönetimi dahil tüm yayın giriş noktaları, uygulamanın `isNew` veya mevcut durumuna bakmadan aynı atomik yayınla-etkinleştir RPC'sini kullanır:

1. Storage kaynağında draft nesne kanonik bucket'a doğrulanarak taşınır/kopyalanır.
2. Harici kaynakta Storage kopyası atlanır; draft metadata doğrulanır.
3. Sürüm `published` yapılır.
4. Aynı transaction içinde uygulama `active` yapılır.
5. Audit kaydı kaynak türünü ve aktivasyonu belirtir.

Manuel arşivleme kaldırılmaz. Uygulama yönetim ekranında bir uygulamayı katalogdan geçici olarak gizlemek için güvenlik/operasyon aracı olarak kalır. Ancak yeni sürüm yayınlamak, arşivli uygulamayı ayrıca aktifleştirme adımı istemeden tekrar aktif eder.

## Rollout Kapısı

Harici draft oluşturma ile harici sürüm yayınlama ayrılır.

- Server-side `EXTERNAL_APK_PUBLISHING_ENABLED` ortam ayarı varsayılan olarak `false` kabul edilir ve harici yayını kapalı tutar.
- Kapalıyken harici draft korunur, `Yayınla` anlaşılır rollout mesajıyla reddedilir.
- Storage sürümleri normal yayınlanmaya devam eder.
- Fiziksel `0.3.1` testi ve açık kullanıcı onayından sonra ortam ayarı etkinleştirilir ve admin yeniden deploy edilir.
- Ortam ayarı istemci bundle'ına veya public `NEXT_PUBLIC_*` değişkenine konmaz.

## Hata Yönetimi

- Geçersiz URL draft oluşturmadan reddedilir.
- Yerel dosya olmadan harici draft oluşturulamaz; boyut/hash manuel metin alanından kabul edilmez.
- Harici URL erişilemezse mobil indirme başarısız olur, kısmi dosya temizlenir ve tekrar deneme sunulur.
- Boyut veya hash uyuşmazlığı güvenlik hatasıdır; installer açılmaz ve metrik yazılmaz.
- Rollout kapısı kapalıysa yayın işlemi draftı silmez.
- Görsel upload başarılı ancak görünüm refresh'i başarısızsa mutation sonucu korunur ve doğru durum kullanıcıya açıklanır.
- Yayın RPC'si başarısızsa draft ve doğrulanmış metadata yeniden deneme için korunur.

## Test Stratejisi

### Veritabanı / pgTAP

- Mevcut kayıtların `storage` kaynağına dönüşmesi.
- Storage ve external geçerli kolon kombinasyonları.
- İki kaynağın karışık veya eksik kombinasyonlarının reddedilmesi.
- RLS ile yalnız aktif uygulamanın yayımlanmış sürümünün okunması.
- Katalog view'ında kaynak alanları.
- Arşivli uygulamanın yayınla-etkinleştir RPC'siyle atomik aktif olması.
- Harici sürümde Storage nesnesi varsayımının yapılmaması.

### Admin Vitest

- Kaynak modu seçimi.
- 50 MB üzerindeki dosyanın harici moda yönlendirilmesi.
- Harici modda yerel chunked hash ve byte boyutu.
- Harici modda yerel APK/ZIP magic kontrolü.
- URL güvenlik doğrulaması.
- Harici draft payload'ı ve audit hostname'i.
- Rollout kapısının external publish'i reddedip storage publish'i etkilememesi.
- Görsel başarısından sonra route refresh.
- Wizard ikon path state'i ve retry davranışı.
- Tüm yayın giriş noktalarında aktivasyon RPC'si.

### Admin Playwright

- İkon ve ekran görüntüsünün manuel browser reload olmadan görünmesi.
- Storage APK'nın mevcut akışla yayınlanması.
- Harici APK taslağının yerel dosya + HTTPS URL ile hazırlanması.
- Kapalı rollout durumunun güvenli mesajı.
- Açık rollout durumunda arşivli uygulamanın aktif yayınlanması.

### Mobil Jest

- Storage path çözümleme.
- Harici HTTPS URL çözümleme.
- HTTP, credential içeren, localhost ve private IP URL reddi.
- Her iki kaynakta boyut/hash doğrulaması.
- Harici ağ hatasında temizlik ve installer/metric çağrılmaması.
- Harici indirmede iptal, tek native cancel ve temizlik bitene kadar retry engeli.
- Katalog mapper'ın ayrık union üretmesi.

### Tam doğrulama

- Mobil Jest, TypeScript, lint, Expo Doctor ve Android export.
- Admin Vitest, TypeScript, lint, production build ve Playwright.
- Supabase reset, pgTAP ve lint/advisor kontrolleri.
- Fiziksel Android cihazda EAS `0.3.1` ile Storage ve harici HTTPS APK indirme, iptal, hash reddi ve installer testi.

## Operasyon ve Onay Kapıları

Şu işlemler birbirinden ayrı açık kullanıcı onayı gerektirir:

1. Hosted migration uygulama.
2. Admin production deploy.
3. EAS `0.3.1` build başlatma.
4. Expo artifact bağlantısını dağıtma veya katalogda yayınlama.
5. Harici APK rollout ayarını production'da etkinleştirme ve yeniden deploy.

APK artifact'i, signing materyali veya `.memory/CURRENT.md` açık onay olmadan commitlenmez. Harici URL içinde secret bulunmaz.

## Onaylanan Kararlar

- Supabase planı yükseltilmeyecek.
- Harici kaynak yalnız doğrudan HTTPS APK linki olacak.
- Mega/TeraBox sayfaları desteklenmeyecek.
- Harici APK'nın hash ve boyutu adminin yerel dosyasından hesaplanacak.
- Storage ve harici link desteği `0.3.1` içinde birlikte teslim edilecek.
- İlk `0.3.1` geçişi EAS artifact gibi uygulama dışı bir kanaldan yapılacak.
- `Yayınla` sürümü yayınlayıp uygulamayı her durumda aktif edecek.
- Manuel arşivleme yalnız sonradan gizleme/operasyon aracı olarak kalacak.
- Görseller hem uygulama yönetim sayfasında hem yayınlama sihirbazında manuel yenileme istemeyecek.
