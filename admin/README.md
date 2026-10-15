# Cep Depo Yönetim Paneli

Next.js yönetim panelinin kurulum ve ortam değişkenleri için repository kökündeki [Yönetim paneli](../README.md#yönetim-paneli) bölümünü kullanın.

## APK yayınlama

Yayınlama `/publish` adresindeki 3 adımlı akıştan yapılır:

1. Mevcut uygulamayı seçin veya ad ve kısa açıklamayla yeni uygulama oluşturun. Yeni uygulama otomatik olarak korumalı `Genel` kategorisine atanır ve ilk sürüm yayınlanana kadar arşivde kalır.
2. APK, sürüm adı, pozitif sürüm kodu ve isteğe bağlı değişiklik notlarını girin. `50.000.000` bayta kadar APK dosyası Supabase Storage'a resumable olarak yüklenebilir. Daha büyük dosyalar veya isteğe bağlı harici dağıtım için yerel APK kopyasını seçip kalıcı, kimlik doğrulamasız ve doğrudan APK döndüren public HTTPS bağlantısını girin. Query string, fragment, kullanıcı adı/parola, localhost ve private ağ adresleri kabul edilmez. Mega/TeraBox gibi indirme sayfaları desteklenmez. Panel yerel dosyanın ZIP imzasını, byte boyutunu ve SHA-256 özetini doğrular. Aktif işlem iptal edilebilir; hata sonrasında aynı formdan yeniden denenebilir.
3. Uygulama, sürüm, byte boyutu ve SHA-256 özetini kontrol edin. Dosya ancak açıkça **Yayınla** seçildiğinde kataloğa çıkar.

Tamamlanmamış ve hiçbir taslağa bağlı olmayan yüklemeler `Ayarlar > Tamamlanmamış uploadlar` bölümünden temizlenir. APK’nın yerel kaynak kopyası doğrulanmış yükleme tamamlandıktan sonra silinebilir.

Harici APK taslağı oluşturma yayından bağımsızdır. Harici taslağın **Yayınla** ile kataloğa çıkarılması server-only `EXTERNAL_APK_PUBLISHING_ENABLED` bayrağına bağlıdır ve production ortamında varsayılan olarak kapalı tutulur. Bayrak yalnız fiziksel `0.3.1` doğrulaması ve ayrı rollout onayından sonra etkinleştirilir.

`0.3.0` harici kaynak sözleşmesini bilmediği için ilk `0.3.1` dağıtımı katalogdan yapılamaz. İlk kurulum, ayrı onayla üretilen EAS APK artifact'i üzerinden out-of-band yapılır; fiziksel cihaz doğrulamasından önce harici katalog sürümü yayımlanmaz.

## Operasyon sınırları

- Yerel testlerin geçmesi hosted Supabase migration izni değildir. Hosted migration için hedef proje, dry-run ve geri dönüş planı incelendikten sonra ayrıca açık onay gerekir.
- Production veya preview deployment da ayrı açık onay gerektirir. Yerel doğrulama deployment başlatmaz.
- EAS build, artifact dağıtımı ve harici APK rollout'u birbirinden ayrı açık onaylar gerektirir.
- Secret key, service-role anahtarı, parola veya kullanıcı oturumu dokümana ve Git’e yazılmaz.
