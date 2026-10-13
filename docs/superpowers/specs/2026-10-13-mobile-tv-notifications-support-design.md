# Cep Depo Mobil TV, Bildirim ve Destek Tasarımı

**Tarih:** 2026-10-13  
**Durum:** Kullanıcı tarafından sohbet içinde onaylanan tasarımın yazılı hali

## Amaç

Cep Depo'nun mobil APK deneyimini üç aşamada geliştirmek:

1. APK indirme iptalinin Android native görevi kapanırken donmuş görünmesini düzeltmek.
2. TV uyumlu uygulamaları ayırt etmek, uygulama yöneticisine güvenli bir destek bağlantısıyla ulaşmak ve tüm izinli cihazlara yönetilebilir bildirim göndermek.
3. Daha sonraki ayrı bir sürümde, kullanıcının açık onayı ve Android TV kablosuz hata ayıklama eşleştirmesiyle aynı ağ üzerinden APK kurmak.

Başarı ölçütleri şunlardır:

- İptal işlemi anında görünür geri bildirim verir ve kısmi dosyayı güvenli biçimde temizler.
- Kullanıcı TV uyumlu APK'ları filtreleyebilir ve kullanım notlarını görebilir.
- Destek gerektiren uygulamalarda kullanıcı hazır mesajı kopyalayıp tanımlanan güvenli iletişim kanalını açabilir.
- Cep Depo güncellemeleri ve admin duyuruları, yalnız izin veren cihazlara güvenilir ve denetlenebilir biçimde gönderilir.
- ADB bilgileri hiçbir zaman sunucuya veya audit kayıtlarına gönderilmez.

## Sürüm Stratejisi

### `0.3.1` — İptal hotfix'i

- Android `versionCode` değeri `4` olur.
- Yalnız APK indirme iptal davranışı değişir.
- Yeni veritabanı migration'ı, push sistemi veya katalog özelliği içermez.
- Aktif indirmede `İptal` seçildiğinde arayüz anında iptal geri bildirimi gösterir.
- Native görev ve kısmi dosya temizliği tamamlanmadan aynı hedefe ikinci indirme başlatılmaz.
- Temizlik tamamlanınca `APK İNDİR` veya `GÜNCELLE` yeniden kullanılabilir olur.

### `0.4.0` — TV kataloğu, destek ve bildirimler

- Android `versionCode` değeri `5` olur.
- TV uyumluluk metadata'sı ve mobil filtreler eklenir.
- Uygulama bazlı destek bağlantısı ve hazır mesaj eklenir.
- Expo Push tabanlı cihaz kaydı, otomatik Cep Depo güncelleme bildirimi ve admin genel duyuruları eklenir.
- Hedefleme yalnız tüm izinli cihazlardır; kullanıcı segmentleri ve uygulama takipçileri kapsam dışıdır.

### `0.5.0` — Android TV'ye ağdan kurulum

- Android TV kablosuz hata ayıklama eşleştirmesi ve aynı ağdan APK kurulumu eklenir.
- Bu sürüm, native ADB protokolü ve farklı Android TV sürümleri nedeniyle ayrı spesifikasyon eki, tehdit değerlendirmesi ve fiziksel cihaz matrisi gerektirir.

## Kapsam

### Dahil

- İndirme iptalinde anında ve doğru arayüz durumu.
- Admin tarafından APK sürümü bazında TV uyumluluğu ve TV notu girişi.
- Mobil katalogda TV rozeti, filtresi ve detay notu.
- Uygulama bazında güvenli destek URL'si ve hazır mesaj.
- Bildirim izni, Expo push token kaydı ve devre dışı bırakma.
- Tüm izinli cihazlara manuel admin duyurusu.
- Cep Depo'nun kendi yeni sürümü yayınlandığında otomatik bildirim kuyruğu.
- Kampanya geçmişi, audit, retry ve geçersiz token temizliği.
- Daha sonraki aşamada kullanıcı kontrollü TV ADB eşleştirmesi.

### Hariç

- Sessiz veya kullanıcı onayı olmadan APK kurulumu.
- TV geliştirici seçeneklerini veya kablosuz hata ayıklamayı otomatik açma.
- ADB eşleştirme kodu, IP, anahtar veya oturumunu sunucuda saklama.
- Kullanıcı segmentleri, uygulama takipçileri veya tek kullanıcıya push gönderimi.
- Cep Depo içi destek sohbeti ya da adminin panelden kullanıcıya cevap vermesi.
- Bildirim içinde HTML, script veya serbest harici yönlendirme.
- SMS, e-posta veya Telegram botuyla toplu bildirim.
- `0.3.1` içinde `0.4.0` özelliklerini erken dağıtma.

## `0.3.1` İndirme İptal Akışı

Mevcut sorun, native indirme görevi iptal çağrısını aldıktan sonra `downloadAsync()` promise'inin Android tarafından geç kapatılabilmesidir. Arayüz yalnız bu promise sonuçlanınca `idle` durumuna döndüğü için buton donmuş görünür.

Yeni akış:

1. Kullanıcı `İptal` düğmesine basar.
2. Hook native göreve yalnız bir iptal çağrısı yollar.
3. İlerleme alanı anında kapanır ve `İndirme iptal edildi` geri bildirimi gösterilir.
4. Native promise ve kısmi dosya temizliği arka planda tamamlanır.
5. Temizlik sürerken yeni indirme aynı dosya hedefiyle başlatılmaz.
6. Temizlik tamamlanınca ana indirme eylemi yeniden etkinleşir.
7. Ekran bu sırada kapanırsa native görev ikinci kez güvenli biçimde iptal edilebilir; metrik veya indirme geçmişi yazılmaz.

İptal, hata olarak gösterilmez. Gerçek ağ, doğrulama veya dosya hataları mevcut `TEKRAR DENE` akışına gider.

## TV Uyumluluk Deneyimi

### Admin

APK yayınlama formunda şu alanlar bulunur:

- `Android TV uyumlu` seçeneği; varsayılan `false`.
- Seçenek açıksa isteğe bağlı kısa `TV kullanım notu`.

TV uyumluluğu admin tarafından doğrulanır; APK manifestinden otomatik tahmin yapılmaz. Bilgi sürüm bazında tutulur çünkü uyumluluk yeni APK sürümlerinde değişebilir.

### Mobil

- Keşfet filtrelerine `TV uyumlu` seçeneği eklenir.
- Kart ve detay ekranı, güncel yayımlanmış sürüm TV uyumluysa rozet gösterir.
- TV notu yalnız doluysa detay ekranında görünür.
- TV filtresi, yayımlanmış ve TV uyumlu güncel sürümü olmayan uygulamaları dışarıda bırakır.

## Uygulama Yöneticisiyle İletişim

Admin uygulama kaydında iki isteğe bağlı alan yönetir:

- `Destek bağlantısı`: yalnız kullanıcı bilgisi içermeyen güvenli `https://` URL. `https://t.me/...`, `https://wa.me/...` ve normal web destek sayfaları kabul edilir.
- `Hazır mesaj`: kullanıcı adı, parola, token veya başka secret içermeyen, uzunluğu sınırlandırılmış düz metin şablonu.

Mobil detay ekranında iki alan da mevcutsa `Yöneticiyle iletişime geç` eylemi gösterilir:

1. Hazır mesaj kullanıcıya önizlenir.
2. Kullanıcı mesajı panoya kopyalayabilir ve gerekirse değiştirebilir.
3. Güvenli destek bağlantısı işletim sisteminde açılır.
4. Bağlantı açılamazsa uygulama çökmez; kullanıcıya kopyalanmış mesaj ve tekrar deneme seçeneği kalır.

Cep Depo mesajı otomatik göndermez ve üçüncü taraf hesaba kullanıcı adına giriş yapmaz.

## Bildirim Deneyimi

### Mobil izin ve cihaz kaydı

- İlk uygun açılışta bildirimlerin Cep Depo güncellemeleri ve önemli hizmet duyuruları için kullanılacağı açıklanır.
- İşletim sistemi izni yalnız kullanıcı kabul ederse istenir.
- Reddedilen izin uygulamanın diğer özelliklerini engellemez; ayarlardan daha sonra açılabilir.
- İzin verildiğinde EAS project kimliğiyle Expo push token alınır ve dar kapsamlı server sınırından kaydedilir.
- Token, kurulum kimliği ve platformla ilişkilendirilir. Kullanıcı hesabı zorunlu değildir.
- Token yenilenirse aynı kurulum kaydı güncellenir. Kullanıcı bildirimleri kapatırsa kayıt pasifleştirilir.

### Otomatik Cep Depo güncelleme bildirimi

Cep Depo'nun katalogdaki uygulama kimliği server-only yapılandırmada tutulur. Admin bu uygulamanın yeni APK sürümünü başarıyla yayınladığında:

1. APK yayın işlemi tamamlanır.
2. Aynı sürüm için idempotent otomatik kampanya kuyruğa eklenir.
3. Kuyruk ekleme başarısızsa APK yayını geri alınmaz; admin uyarı görür ve bildirimi tekrar kuyruğa alabilir.
4. Bildirime dokunmak Cep Depo güncelleme ekranına veya ilgili uygulama detayına gider.

Diğer uygulamaların sürümleri otomatik genel bildirim üretmez.

### Admin genel duyurusu

Admin navigasyonunda `Bildirimler` ekranı bulunur. Form şunları içerir:

- Başlık.
- Düz metin mesaj.
- İsteğe bağlı Cep Depo içi uygulama hedefi.
- Gönderim önizlemesi.
- Açık son onay.

Admin yalnız tüm aktif ve izinli cihazlara gönderim yapabilir. Kampanya geçmişinde `bekliyor`, `gönderiliyor`, `gönderildi`, `kısmi hata` ve `başarısız` durumları; oluşturucu, zaman ve sayısal sonuç özeti gösterilir. Push token değerleri hiçbir admin ekranında gösterilmez.

## Veri Modeli

Kesin kolon adları implementation planında mevcut şema kurallarına göre doğrulanır. Tasarım düzeyindeki kayıtlar:

### `app_versions`

- `supports_tv boolean not null default false`
- `tv_notes text null` ve sınırlı uzunluk kontrolü

### `apps`

- `support_url text null` ve HTTPS biçim kontrolü
- `support_message text null` ve sınırlı uzunluk kontrolü

### `push_devices`

- Sunucu tarafından üretilen kimlik.
- Benzersiz kurulum kimliği.
- Benzersiz Expo push tokenı.
- Platform ve aktiflik.
- Oluşturulma, son görülme ve pasifleştirilme zamanları.

Anon/authenticated roller tokenları okuyamaz veya listeleyemez. Kayıt ve yenileme yalnız doğrulamalı, rate-limit uygulanmış RPC veya Edge Function üzerinden yapılır.

### `notification_campaigns`

- `manual` veya `client_update` türü.
- Başlık, mesaj ve isteğe bağlı iç uygulama hedefi.
- Durum, idempotency anahtarı, oluşturan admin ve zamanlar.
- Toplam, başarılı, başarısız ve geçersiz token sayıları.

### Bildirim outbox/delivery kayıtları

- Kampanya ile batch ilişkisi.
- Sınırlı deneme sayısı ve sonraki deneme zamanı.
- Expo ticket/receipt sonucu; token veya kullanıcıya ait gizli veri audit metadata'sına kopyalanmaz.

## Push Gönderim Mimarisi

- Admin server action veya yayın sonrası action yalnız kampanya/outbox kaydı oluşturur.
- Ayrı Supabase Edge Function/worker bekleyen kayıtları küçük batch'ler halinde Expo Push API'ye gönderir.
- Geçici ağ ve `5xx` hataları sınırlı exponential backoff ile yeniden denenir.
- Kalıcı `DeviceNotRegistered` receipt'i cihazı pasifleştirir.
- Idempotency anahtarı aynı Cep Depo sürümünün veya manuel kampanyanın iki kez gönderilmesini engeller.
- Worker secretları yalnız server ortamında tutulur; mobil bundle, admin HTML'i, log veya audit metadata'sına girmez.

## Yetkilendirme ve Güvenlik

- TV ve destek metadata'sı yazma işlemleri mevcut admin mutation sınırından geçer.
- Kampanya oluşturma, yeniden deneme ve iptal server tarafında `requireAdmin(..., { mutation: true })` ile korunur.
- Bildirim içeriği düz metin ve uzunluk sınırlarıyla doğrulanır.
- Bildirim hedefi yalnız mevcut uygulama kimliği olabilir; serbest deep link veya harici URL kabul edilmez.
- Destek URL'si HTTPS ve kullanıcı bilgisi içermeyen URL olarak doğrulanır.
- Push tokenları hassas cihaz tanımlayıcısı kabul edilir; RLS deny-by-default olur.
- Cihaz kayıt endpoint'i kötüye kullanıma karşı payload doğrulama, oran sınırlama ve token biçim kontrolü uygular.
- ADB pairing kodu, IP ve anahtarlar `0.5.0` aşamasında yalnız cihaz üzerinde, gerekli süre boyunca tutulur; analytics ve crash loglarına yazılmaz.

## Hata Yönetimi

- Push servisinin kesilmesi katalog yayınının başarısını değiştirmez.
- Kuyruğa alma hatası admin için görünür ve tekrar denenebilirdir.
- Batch kısmi başarıları kaybolmaz; yalnız başarısız teslimatlar yeniden denenir.
- Mobil token kaydı başarısızsa uygulama çalışmaya devam eder ve daha sonra sessizce tekrar deneyebilir.
- Destek bağlantısı açılamazsa hazır mesaj kullanılabilir kalır.
- TV metadata'sı eksikse uygulama normal mobil uygulama gibi gösterilir.
- ADB aşamasında yanlış kod, bağlantı reddi, ağ kopması ve kurulum reddi ayrı ve anlaşılır durumlar olur.

## Test Stratejisi

### `0.3.1`

- Hook testi native iptal promise'i beklemede kalırken arayüzün anında geri bildirim verdiğini doğrular.
- Native task yalnız bir kez iptal edilir.
- Kısmi dosya temizliği, ekran kapatma ve iptal sonrası history/metric yazılmaması test edilir.
- Tam Jest, TypeScript, lint ve Expo Doctor çalıştırılır.
- Fiziksel Android cihazda yavaş indirme üzerinde iptal ve yeniden başlatma test edilir.

### `0.4.0`

- pgTAP: yeni constraintler, RLS, admin kampanya yetkisi, outbox ve idempotency.
- Admin Vitest: TV/destek doğrulaması, kampanya önizleme, onay ve retry.
- Admin Playwright: sürüm yayınlama metadata'sı, manuel kampanya ve yetkisiz erişim.
- Mobil Jest: izin akışı, token yenileme/pasifleştirme, bildirim deep link'i, TV filtresi ve destek eylemi.
- Edge Function testleri: batch, retry, receipt ve geçersiz token.
- Fiziksel Android: foreground, background ve kapalı uygulamada bildirim; Android 13+ izin reddi/kabulü.

### `0.5.0`

- En az iki Android TV/Google TV sürümü.
- Doğru/yanlış pairing kodu, iptal, zaman aşımı ve ağ kopması.
- APK indirme doğrulaması ve TV kurulum reddi.
- Eşleştirme verisinin uygulama kapanışı/bağlantı kaldırma sonrası temizliği.

## Operasyon ve Dağıtım Kapıları

- `0.3.1`, `0.4.0` ve `0.5.0` ayrı build ve doğrulama kapılarına sahiptir.
- Hosted migration, Edge Function secret/config, Edge Function deploy, admin deploy, EAS build ve mobil yayın birbirinden ayrı açık onay ister.
- `0.4.0` push sistemi production'a çıkmadan önce Expo project kimliği ve Cep Depo katalog uygulama kimliği server-side doğrulanır.
- Rollback, eski admin ve mobil istemcilerin yeni nullable/default alanlarla çalışmasını korur.
- `.memory/CURRENT.md` durum için güncellenir ancak açık onay olmadan commitlenmez.

## Onaylanan Kararlar

- Aşamalı sürüm yaklaşımı kullanılacak.
- TV uyumluluğunu otomatik APK analizi değil admin belirleyecek.
- TV kataloğu `0.4.0`, doğrudan ADB kurulumu `0.5.0` kapsamındadır.
- ADB eşleştirmesi TV'de geliştirici seçenekleri ve kablosuz hata ayıklama açılmasını gerektirebilir.
- Bildirim hedefi yalnız tüm izinli cihazlardır.
- Destek iletişimi Cep Depo içi sohbet değil, serbest güvenli bağlantı ve hazır mesajdır.
- Cep Depo güncelleme bildirimi otomatik; diğer duyurular admin onaylı manueldir.
