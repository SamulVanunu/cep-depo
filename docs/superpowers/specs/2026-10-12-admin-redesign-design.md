# Cep Depo Admin Sadeleştirme Tasarımı

**Tarih:** 2026-10-12  
**Durum:** Kullanıcı tarafından sohbet içinde onaylanan tasarımın yazılı hali

## Amaç

Admin panelini APK yayınlama işi etrafında yeniden düzenlemek. Yönetici, teknik veri modelini veya birbiriyle bağlantılı sayfaları bilmeden şu akışı tamamlayabilmelidir:

1. Mevcut uygulamayı seçmek veya temel bilgilerle yeni uygulama oluşturmak.
2. APK ve sürüm bilgilerini eklemek.
3. Dosyanın doğrulama sonucunu görmek.
4. Son kontrolün ardından açık bir `Yayınla` işlemiyle sürümü kullanıcılara açmak.

Başarı ölçütü, yeni bir uygulama ve APK yayınlamak için kategori yönetimi dahil başka bir sayfaya gitme zorunluluğunun kalmamasıdır.

## Kapsam

### Dahil

- Admin bilgi mimarisinin ve navigasyonunun sadeleştirilmesi.
- Birincil `APK Yükle` akışının tek yönlendirmeli sihirbazda birleştirilmesi.
- Kategori seçilmezse sistemin otomatik `Genel` kategorisini kullanması.
- Yeni uygulama için yalnız temel bilgilerin ilk aşamada gösterilmesi.
- Mevcut APK hash, resumable upload, doğrulama, taslak ve yayın güvenlik kurallarının korunması.
- APK yükleme ilerlemesi, iptal, tekrar deneme ve anlaşılır hata durumları.
- Yayın öncesi açık bir kontrol özeti ve kullanıcı tarafından başlatılan son `Yayınla` işlemi.
- Mevcut uygulama, yorum, rapor, kullanıcı, audit ve yetkilendirme işlevlerinin korunması.
- Kategori yönetiminin ana uygulama listesinden `Ayarlar` bölümüne taşınması.
- Masaüstü, tablet ve dar ekranlarda kullanılabilir responsive düzen.

### Hariç

- Mobil uygulama bildirimleri.
- Cep Depo OTA güncellemeleri.
- Yeni mobil APK üretimi.
- Mega, TeraBox veya başka paylaşım sayfası bağlantılarından APK alma.
- Admin panelinden ortam değişkeni, Supabase anahtarı veya başka secret düzenleme.
- Mevcut moderasyon ve kullanıcı yönetimi kurallarını değiştirme.

Bu kapsam dışı işler daha sonra ayrı spesifikasyon ve planlarla ele alınacaktır.

## Seçilen Deneyim

Görsel değerlendirmede **A — Yönlendirmeli APK yükleme** seçildi.

Ana navigasyon:

1. **APK Yükle** — varsayılan ve görsel olarak en güçlü işlem.
2. **Uygulamalar** — mevcut kayıtları arama, düzenleme ve sürüm geçmişi.
3. **Topluluk** — Yorumlar ve Raporlar bağlantılarını tek grup altında sunar; mevcut rotalar korunur.
4. **Kullanıcılar** — mevcut kullanıcı yönetimi.
5. **Ayarlar** — kategori yönetimi ve yalnız güvenli, yönetilebilir katalog ayarları.

Kontrol paneli özet bilgi göstermeye devam eder ancak birincil çağrı `APK Yükle` olur. İstatistikler ve moderasyon bağlantıları ikincil görsel ağırlıkta kalır.

## APK Yayınlama Sihirbazı

Yeni bir `/publish` rotası birleşik akışın ana giriş noktası olur. Eski `/apps/[appId]/versions/new` bağlantıları geriye dönük uyumluluk için `/publish?appId=<id>` adresine yönlendirilir.

### Adım 1 — Uygulama

Yönetici iki seçenekten birini kullanır:

- Aranabilir listeden mevcut uygulama seçmek.
- Yeni uygulama oluşturmak.

Yeni uygulama formunda yalnız şu alanlar görünür:

- Uygulama adı.
- Kısa açıklama.
- Uygulama ikonu (önerilir ancak ilk yayını bloke etmez).

Sistem alanları şöyle hazırlanır:

- Slug, başlıktan mevcut normalizasyon kuralıyla üretilir. Çakışma varsa kullanıcıya teknik olmayan, düzeltilebilir bir hata gösterilir ve gelişmiş alanda slug düzenlenebilir.
- Uzun açıklama başlangıçta kısa açıklamadan oluşturulur ve daha sonra uygulama düzenleme sayfasında değiştirilebilir.
- Kategori, varsayılan `Genel` kategorisidir.
- `featured` değeri `false` olur.
- Yeni kayıt, sürüm yayınlanana kadar katalogda görünmemesi için `archived` tutulur.

İkon yüklenemezse uygulama kaydı taslak/archived halde korunur; hata açıkça gösterilir ve ikon yeniden denenebilir. Yarım kayıt herkese açık kataloğa çıkmaz.

### Adım 2 — APK

Gösterilen alanlar:

- APK dosyası.
- Sürüm adı.
- Pozitif tam sayı sürüm kodu.
- İsteğe bağlı değişiklik notları.

Mevcut güvenlik ve veri bütünlüğü akışı korunur:

1. Dosya türü ve boyutu istemci ve sunucu sınırlarında doğrulanır.
2. SHA-256 tarayıcıda artımlı hesaplanır.
3. Yetkilendirilmiş TUS upload intent alınır.
4. Dosya resumable olarak Supabase Storage'a yüklenir.
5. Sunucu Storage metadata boyutunu ve beklenen nesne yolunu doğrular.
6. Sürüm yalnız doğrulama başarılıysa `draft` oluşturulur.

Ekranda hash ve upload aşamaları ayrı teknik adlar yerine tek anlaşılır ilerleme alanında gösterilir. İlerleme yüzdesi, işlenen/yüklenen MB, `İptal` ve hata halinde `Tekrar dene` bulunur. Sayfadan ayrılma uyarısı yalnız aktif işlem sırasında gösterilir.

### Adım 3 — Kontrol ve Yayın

Son ekranda şu özet gösterilir:

- Uygulama adı ve ikonu.
- Sürüm adı ve kodu.
- Dosya adı ve byte/MB boyutu.
- SHA-256 doğrulamasının başarılı olduğu bilgisi; tam değer kopyalanabilir ayrıntı olarak sunulur.
- Değişiklik notları.
- Yeni uygulamaysa otomatik `Genel` kategorisi bilgisi.

`Yayınla` işlemi kullanıcı tarafından açıkça başlatılır. Otomatik yayın yapılmaz.

Yayın başarıyla tamamlandığında:

- Taslak sürüm `published` olur.
- Aynı uygulamanın önceki yayımlanmış sürüm davranışı mevcut kurallarla korunur.
- Sihirbaz içinde oluşturulan yeni uygulama `active` yapılır.
- Audit kaydı yazılır.
- Kullanıcı uygulama detayına veya uygulamalar listesine geçebilir.

Yayın başarısız olursa draft sürüm ve yüklenmiş doğrulanmış APK korunur; kullanıcı dosyayı yeniden yüklemeden yayınlamayı tekrar deneyebilir.

## Varsayılan Genel Kategorisi

Kategori ilişkisi veritabanında zorunlu kalır. Böylece mobil katalog sorguları, filtreler ve mevcut view'lar değişmez.

Yeni migration:

- `categories` tablosuna `is_default boolean not null default false` ekler.
- En fazla bir varsayılan kategori olmasını partial unique index ile garanti eder.
- Mevcut `genel` slug'lı kategoriyi etkinleştirip varsayılan yapar veya yoksa `Genel` kategorisini oluşturur.
- `check (not is_default or is_active)` constraint'i ile varsayılan kategorinin pasif yapılmasını veritabanında engeller.

Admin uygulama oluşturma/güncelleme action'ları boş kategori girişini varsayılan kategoriye çözer. Elle seçilen geçerli kategori her zaman önceliklidir. Varsayılan kategori bulunamazsa işlem kapalı biçimde başarısız olur; rastgele ilk kategori kullanılmaz.

`Ayarlar > Kategoriler` ekranında `Genel` kaydı varsayılan olarak işaretlenir. Bu kaydın pasif yapılması engellenir; diğer kategoriler mevcut kurallarla yönetilir.

## Sayfa Düzeni

### `/`

- Büyük `APK Yükle` çağrısı.
- Son yayınlanan uygulamalar.
- Bekleyen raporlar ve gizli yorumlar için küçük özet bağlantıları.
- Teknik metrikler ana görevin önüne geçmez.

### `/publish`

- Üç adımlı birleşik sihirbaz.
- Sorgu parametresindeki geçerli `appId`, mevcut uygulamayı önceden seçer.
- Geçersiz veya erişilemeyen kimlik güvenli hata durumuna düşer.

### `/apps`

- Arama, durum ve kategori filtresi korunur.
- Satırlar yalnız ad, mevcut sürüm, yayın durumu ve açık bir `Yönet` işlemi gösterir.
- Kategori oluşturma formları bu sayfadan kaldırılır.

### `/apps/[appId]`

- Uygulama ayrıntıları, uzun açıklama, kategori, öne çıkarma, ikon, ekran görüntüleri ve sürüm geçmişi için gelişmiş düzenleme ekranıdır.
- Birincil işlem `Yeni APK yükle` olarak `/publish?appId=<id>` adresine gider.

### `/settings`

- Kategori yönetimini içerir.
- Secret veya deployment ayarlarını göstermez ve düzenlemez.

Mevcut `/reviews`, `/reports`, `/users` ve detay rotalarının davranışları korunur; yalnız ortak navigasyon ve görsel hiyerarşiyle uyumlu hale getirilir.

## Hata ve Kurtarma Davranışı

- Doğrulama hataları ilgili alanın yanında Türkçe ve düzeltilebilir biçimde gösterilir.
- Teknik backend ayrıntıları ve Supabase hata metinleri kullanıcıya açılmaz.
- Hash sırasında iptal dosya göndermeden sonlanır. TUS upload sırasında iptal istemci task'ını durdurur; oluşmuş Storage yolu mevcut orphan temizleme mekanizmasına kaydedilir.
- Upload sonrası finalize/yayın hatasında doğrulanmış dosya ve draft sürüm korunur.
- Çift tıklama aynı uygulama, sürüm veya audit kaydını iki kez oluşturmaz.
- Aktif upload sırasında rota değişimi uyarılır; normal form adımlarında gereksiz uyarı gösterilmez.
- Yetki kaybı veya oturum süresi dolması güvenli biçimde login ekranına yönlendirir.

## Güvenlik

- Tüm mutation'lar mevcut `requireAdmin`/service-role sunucu sınırlarının arkasında kalır.
- Service-role anahtarı ve upload imzalama ayrıntıları istemci bundle'ına girmez.
- APK yol formatı, MIME allowlist'i, boyut sınırı, SHA-256 ve Storage metadata doğrulaması korunur.
- Kullanıcı tarafından gönderilen dosya adı Storage yolu olarak kullanılmaz.
- Kategori fallback'i yalnız veritabanında işaretli tek varsayılan kategoriye yapılır.
- Yayınlama açık kullanıcı eylemi gerektirir; upload tamamlanması tek başına yayın değildir.
- Audit kaydı uygulama oluşturma, asset değişikliği, sürüm oluşturma ve yayınlama işlemlerini izlemeye devam eder.

## Erişilebilirlik ve Responsive Davranış

- Sihirbaz adımları semantik liste ve `aria-current="step"` kullanır.
- İlerleme alanı `progressbar`, canlı durum metni ise uygun `aria-live` davranışı kullanır.
- Tüm işlemler klavye ile tamamlanabilir; drag-and-drop tek dosya seçme yöntemi değildir.
- Focus, adım geçişlerinde yeni başlığa taşınır; hata halinde ilk geçersiz alana gider.
- Renk tek başına durum bildirmez.
- Dar ekranda sidebar açılır menüye dönüşür; APK upload tamamen kapatılmaz.
- Tehlikeli kullanıcı silme gibi mevcut masaüstü kısıtları bu kapsamda değiştirilmez.

## Test Stratejisi

### Birim ve bileşen testleri

- Boş kategori girişinin varsayılan `Genel` kategorisine çözülmesi.
- Elle seçilen kategorinin korunması.
- Varsayılan kategori yoksa güvenli hata.
- Yeni uygulama temel alanlarının normalize edilmesi ve archived kayıt oluşturması.
- Mevcut uygulama seçimi ve geçersiz `appId` davranışı.
- Sihirbaz adım geçişleri, alan hataları, çift gönderim koruması.
- Hash/upload ilerlemesi, iptal, retry ve finalize hatası.
- Kontrol özeti ve açık yayın onayı.
- Yayın başarısında yeni uygulamanın aktive edilmesi.
- Klavye, focus ve erişilebilir ad/rol kontrolleri.

### Veritabanı testleri

- Tek varsayılan kategori kuralı.
- Migration'ın mevcut `genel` kategorisini veri kaybetmeden kullanması.
- Varsayılan kategorinin pasif yapılamaması.
- Mevcut katalog view ve RLS sonuçlarının değişmemesi.

### E2E

- Sıfır kategoriyle başlayan ortamda otomatik `Genel` ve yeni uygulama + APK yayınlama.
- Mevcut uygulamaya yeni sürüm yükleme ve yayınlama.
- Upload iptal/retry.
- Yayın hatasından dosyayı yeniden yüklemeden kurtarma.
- Mevcut yorum, rapor, kullanıcı ve admin self-protection akışlarının regresyonu.
- Masaüstü ve dar ekran temel navigasyonu.
- Tarayıcı console/page error bulunmaması.

## Dağıtım ve Geri Alma

1. Migration yerelde uygulanır ve pgTAP ile doğrulanır.
2. Admin test, typecheck, lint, production build ve Playwright geçer.
3. Preview deployment üzerinde fiziksel APK upload/yayın smoke testi yapılır.
4. Hosted migration için ayrıca açık onay alınır.
5. Production Vercel deployment için ayrıca açık onay alınır.

Geri alma sırasında yeni admin deployment önceki Vercel deployment'a döndürülebilir. `is_default` kolonu additive olduğundan eski admin kodunu bozmaz; migration geri alınmaz. Varsayılan `Genel` kategorisi normal katalog verisi olarak güvenle kalabilir.

## Kabul Kriterleri

- Yönetici kategori oluşturmadan yeni uygulama ve APK yayınlayabilir.
- Yeni uygulama otomatik `Genel` kategorisini kullanır.
- Yeni uygulama ve sürüm, son `Yayınla` onayından önce mobil katalogda görünmez.
- APK upload ilerlemesi anlaşılırdır ve iptal/retry destekler.
- Hash, boyut ve Storage doğrulaması kaldırılmaz veya zayıflatılmaz.
- Mevcut moderasyon, kullanıcı yönetimi, yetkilendirme ve audit davranışları korunur.
- Admin ana navigasyonu APK yüklemeyi birincil görev olarak gösterir.
- Mobil bildirim, OTA ve APK release işleri bu değişikliğe karışmaz.
