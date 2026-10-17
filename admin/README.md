# Cep Depo Yönetim Paneli

Next.js yönetim panelinin kurulum ve ortam değişkenleri için repository kökündeki [Yönetim paneli](../README.md#yönetim-paneli) bölümünü kullanın.

## APK yayınlama

Yayınlama için oturum açan hesabın `admin` rolü olmalıdır. `/publish` adresindeki iki adımlı akış kullanılır:

1. Mevcut uygulamayı seçin veya yeni uygulamanın ad, slug, kategori, kısa açıklama, ayrıntılı açıklama ve zorunlu ilk ikonunu girin. Ekran görüntüleri isteğe bağlıdır; eklenen her ekran görüntüsü için erişilebilir alt metin zorunludur. Yeni kayıt, ilk APK başarıyla yayınlanana kadar public katalogda görünmez.
2. APK kaynağını seçin ve isteğe bağlı değişiklik notunu girin. Paket adı, sürüm adı ve pozitif sürüm kodu APK manifestinden salt okunur olarak çıkarılır; elle girilemez. **APK'yı yükle ve yayınla** işlemi kaynağı doğrular ve başarılıysa ayrıca bir taslak inceleme/yayın adımı göstermeden kataloğa yayınlar.

`50.000.000` bayta kadar APK dosyası Supabase Storage'a resumable olarak yüklenebilir. Daha büyük dosyalar veya isteğe bağlı harici dağıtım için aynı APK'nın yerel kopyasını seçip kalıcı, kimlik doğrulamasız ve doğrudan APK döndüren public HTTPS bağlantısını girin. Query string, fragment, kullanıcı adı/parola, localhost ve private ağ adresleri kabul edilmez. Mega/TeraBox gibi indirme sayfaları desteklenmez. Panel yerel dosyanın ZIP/manifest yapısını, byte boyutunu ve SHA-256 özetini doğrular. Aktif işlem iptal edilebilir; hata sonrasında yeniden denenebilir.

Mevcut bir uygulama **Yeni APK ile güncelle** üzerinden güncellendiğinde APK paket adı uygulamanın kayıtlı paket adıyla aynı, gerçek manifest `versionCode` değeri de mevcut yayından büyük olmalıdır. Yeni sürüm önce transaction içinde yayınlanır; ardından eski katalog sürümleri kaldırılır. Eski Cep Depo Storage dosyaları temizlenir veya dayanıklı temizleme kuyruğuna alınır. Harici GitHub Releases dosyaları Cep Depo tarafından hiçbir zaman silinmez.

Tamamlanmamış ve hiçbir taslağa bağlı olmayan yüklemeler `Ayarlar > Tamamlanmamış uploadlar` bölümünden temizlenir. APK’nın yerel kaynak kopyası doğrulanmış yükleme tamamlandıktan sonra silinebilir.

Harici APK yayınlama server-only `EXTERNAL_APK_PUBLISHING_ENABLED` bayrağına bağlıdır ve production ortamında varsayılan olarak kapalı tutulur. Kapalıyken işlem kalıcı harici taslak bırakmadan reddedilir. Rollback için bayrağı tekrar `false` yapıp admin deployment'ını geri alın; bu işlem daha önce GitHub'a yüklenmiş dosyaları silmez.

Yönetim sayfasındaki **Yayından kaldır** uygulamayı katalogdan gizler, veriyi silmez; **Tekrar yayınla** aynı mevcut sürümü görünür yapar. **Kalıcı sil** uygulama adının birebir yazılmasını ister ve katalog verisini geri döndürülemez biçimde siler. Başarılı yayın veya silme sonrasında “bazı dosyalar temizleme bekliyor” uyarısı görünürse katalog işlemi tamamlanmıştır; işlemi tekrarlamak yerine cleanup kuyruğunu inceleyin.

`0.3.0` harici kaynak sözleşmesini bilmediği için ilk `0.3.1` dağıtımı katalogdan yapılamaz. İlk kurulum, ayrı onayla üretilen EAS APK artifact'i üzerinden out-of-band yapılır; fiziksel cihaz doğrulamasından önce harici katalog sürümü yayımlanmaz.

## Operasyon sınırları

- Yerel testlerin geçmesi hosted Supabase migration izni değildir. Hosted migration için hedef proje, dry-run ve geri dönüş planı incelendikten sonra ayrıca açık onay gerekir.
- Production veya preview deployment da ayrı açık onay gerektirir. Yerel doğrulama deployment başlatmaz.
- EAS build, artifact dağıtımı ve harici APK rollout'u birbirinden ayrı açık onaylar gerektirir.
- Secret key, service-role anahtarı, parola veya kullanıcı oturumu dokümana ve Git’e yazılmaz.
