# Cep Depo Yönetim Paneli

Next.js yönetim panelinin kurulum ve ortam değişkenleri için repository kökündeki [Yönetim paneli](../README.md#yönetim-paneli) bölümünü kullanın.

## APK yayınlama

Yayınlama `/publish` adresindeki 3 adımlı akıştan yapılır:

1. Mevcut uygulamayı seçin veya ad ve kısa açıklamayla yeni uygulama oluşturun. Yeni uygulama otomatik olarak korumalı `Genel` kategorisine atanır ve ilk sürüm yayınlanana kadar arşivde kalır.
2. APK, sürüm adı, pozitif sürüm kodu ve isteğe bağlı değişiklik notlarını girin. Panel SHA-256 hesaplar, dosyayı resumable olarak yükler ve Storage metadata’sını doğrular. Aktif işlem iptal edilebilir; hata sonrasında aynı formdan yeniden denenebilir.
3. Uygulama, sürüm, byte boyutu ve SHA-256 özetini kontrol edin. Dosya ancak açıkça **Yayınla** seçildiğinde kataloğa çıkar.

Tamamlanmamış ve hiçbir taslağa bağlı olmayan yüklemeler `Ayarlar > Tamamlanmamış uploadlar` bölümünden temizlenir. APK’nın yerel kaynak kopyası doğrulanmış yükleme tamamlandıktan sonra silinebilir.

## Operasyon sınırları

- Yerel testlerin geçmesi hosted Supabase migration izni değildir. Hosted migration için hedef proje, dry-run ve geri dönüş planı incelendikten sonra ayrıca açık onay gerekir.
- Production veya preview deployment da ayrı açık onay gerektirir. Yerel doğrulama deployment başlatmaz.
- Secret key, service-role anahtarı, parola veya kullanıcı oturumu dokümana ve Git’e yazılmaz.
