# Cep Depo Platform Tasarımı

**Tarih:** 1 Ekim 2026  
**Durum:** Kullanıcı tarafından bölüm bölüm onaylandı  
**Kapsam:** Çalışan Android MVP, bağımsız web admin paneli ve Supabase backend

## 1. Amaç ve başarı ölçütü

Cep Depo, kullanıcıların Android uygulamalarını keşfedebildiği, ayrıntılarını inceleyebildiği, doğrudan APK indirebildiği, yorum ve puan verebildiği koyu temalı bir uygulama mağazasıdır. Uygulama hazır şablon veya yapay zekâ üretimi hissi vermeyen, editoryal ve işlevsel bir görsel dile sahip olacaktır.

İlk teslimat, yalnızca tıklanabilir bir prototip değil; yeni bir Supabase projesine bağlanan, gerçek cihazda test edilebilen çalışan MVP olacaktır. Başarı için:

- Herkese açık katalog, arama, kategori, popüler uygulamalar ve APK indirme çalışmalıdır.
- Kayıt, giriş, e-posta doğrulama, şifre sıfırlama, kullanıcı adı ve avatar akışları çalışmalıdır.
- Yorum, puan, takip, uygulama içi bildirim ve gerçek push bildirimleri çalışmalıdır.
- Bağımsız Next.js admin panelinden uygulama, görsel, APK, sürüm, şikayet ve kullanıcı yönetilebilmelidir.
- RLS politikaları, depolama politikaları ve sunucu tarafı rol kontrolleri yetki yükseltmeyi engellemelidir.
- Üretim kontrolleri, testler ve gerçek Android development build doğrulaması geçmelidir.

## 2. Kapsam sınırları

### MVP kapsamı

- Android için Expo/React Native mobil uygulama
- Türkçe arayüz
- Next.js tabanlı bağımsız web admin paneli
- Supabase Auth, Postgres, Storage, Realtime ve Edge Functions
- E-posta/şifre tabanlı hesap sistemi
- Uygulama kataloğu, kategoriler, arama, öne çıkanlar ve popülerlik
- Uygulama detayı, ekran görüntüleri ve sürüm geçmişi
- Hesapsız APK indirme
- Hesaplı yorum, puan, takip ve şikayet
- Uygulama içi ve Expo push bildirimleri
- APK taslak yükleme, sürüm yayınlama ve arşivleme
- Temel kullanıcı askıya alma ve şikayet çözümleme
- Cep Depo APK'sı için imza kontrolü ve Play Integrity sinyali

### MVP dışında

- iOS istemcisi
- Ücretli uygulama veya ödeme sistemi
- Uygulamaların sessiz/otomatik kurulması
- Başka uygulamaların gerçekten kurulu sürümünü güvenilir biçimde okuma
- Otomatik malware analizi veya tüm APK imzalarının güvenilir yayıncı doğrulaması
- Ticari ağır anti-tamper/obfuscation ürünü
- Çoklu dil
- Gelişmiş öneri motoru ve ayrıntılı analitik

## 3. Sistem mimarisi

Mobil ve admin iki bağımsız projedir. Kaynak kod veya çalışma zamanı bağımlılığı paylaşmazlar; aynı Supabase projesini ve aynı üretilmiş veritabanı sözleşmesini kullanırlar.

### 3.1 Mobil proje

**Konum:** `/home/samuel/Belgeler/cep-depo`

- Expo ve React Native
- Expo Router ile dosya tabanlı yönlendirme
- Supabase istemcisiyle herkese açık ve kullanıcı yetkili işlemler
- Expo Notifications ile cihaz kaydı, izin ve bildirim işleme
- Development build/EAS gerektiren native özellikler
- Migration, seed, RLS testleri ve Edge Function kaynakları için kanonik `supabase/` dizini

### 3.2 Admin projesi

**Konum:** `/home/samuel/Belgeler/cep-depo-admin`

- Next.js App Router
- Bağımsız bağımlılıklar, testler ve dağıtım
- Herkese açık yalnızca giriş ve şifre sıfırlama sayfaları
- Admin rolünü hem sunucu hem veritabanı katmanında doğrulayan korumalı alanlar
- Supabase Storage'a TUS tabanlı resumable APK yükleme

### 3.3 Ortak backend

- Supabase Auth: oturum, e-posta doğrulama ve şifre sıfırlama
- Postgres: katalog, sürüm, profil, yorum, takip, bildirim, şikayet ve denetim verisi
- Storage: APK, ikon, ekran görüntüsü ve avatar
- RLS: asıl erişim kontrol sınırı
- Edge Functions: sürüm yayımlama, Play Integrity doğrulama ve push gönderimi gibi ayrıcalıklı işlemler
- Realtime/yenileme: uygulama ön plandayken yeni sürüm olaylarının güncellenmesi

Her iki proje aynı şemadan `database.types.ts` üretir. Üretilen tiplerin şemayla uyuşmaması CI hatasıdır; tip dosyası elle düzenlenmez.

## 4. Görsel tasarım

Seçilen yön **Editoryal ve İşlevsel** tasarımdır.

- Arka plan: kömüre yakın koyu gri
- Metin: saf beyaz yerine sıcak kırık beyaz
- Vurgu: kontrollü limon yeşili
- Yüzeyler: az sayıda ton, ince sınırlar, ölçülü köşe yuvarlama
- Tipografi: güçlü başlık hiyerarşisi, kısa ve doğal Türkçe metinler
- Hareket: kısa, amaca yönelik geçişler; dekoratif ve sürekli animasyon yok
- Erişilebilirlik: yeterli kontrast, dokunma hedefleri, ekran okuyucu etiketleri ve yalnız renge dayanmayan durumlar

Açılış ekranı Cep Depo logosunu sade bir modern animasyonla gösterir. Animasyon gerçek başlangıç işlemlerini örter; yapay bekleme yaratmaz ve azaltılmış hareket tercihine saygı duyar.

## 5. Mobil bilgi mimarisi

Alt menü dört öğeden oluşur:

1. **Keşfet**
2. **Hesap**
3. **Bildirim**
4. **Hakkında**

Admin işlevi mobil uygulamada bulunmaz.

### 5.1 Keşfet

- Arama alanı
- Dinamik kategori filtreleri
- Öne çıkan uygulama alanı
- Popüler uygulamalar
- Son eklenen veya güncellenen uygulamalar
- Yükleniyor, boş sonuç, çevrimdışı ve hata durumları

### 5.2 Uygulama detayı

- İkon, ad, kategori, ortalama puan ve güncel sürüm
- Uzun açıklama
- Yatay ekran görüntüsü galerisi
- Sürüm adı, sürüm kodu, boyut, yayın tarihi, değişiklik notu ve SHA-256
- APK İndir/Güncelle butonu
- Güncellemeleri takip et/bırak kontrolü
- Sürüm geçmişi
- Yorum ve puan alanı
- Şikayet akışı

### 5.3 Hesap ve kimlik doğrulama

- Kayıt, giriş, e-posta doğrulama ve şifre sıfırlama
- Benzersiz kullanıcı adı
- İsteğe bağlı profil fotoğrafı
- Takip edilen uygulamalar ve kullanıcının yorumları
- Bildirim ayarları
- Çıkış yapma

Şifre sıfırlama bağlantısı `cepdepo://auth/reset-password` deep link'iyle uygulamaya döner. Oturum yenilenemezse herkese açık katalog yine açılır.

### 5.4 Bildirimler

- Yalnız kullanıcının açıkça takip ettiği uygulamaların sürüm olayları
- Okundu/okunmadı durumu
- Bildirimden uygulama detayına ve Güncelle işlemine geçiş
- Push izni kapalı veya gönderim başarısız olsa da eksiksiz uygulama içi geçmiş

### 5.5 Hakkında

- Cep Depo sürümü
- Gizlilik metni
- Kullanım koşulları
- İletişim/şikayet kanalı
- Açık kaynak bildirimleri

## 6. Admin bilgi mimarisi

- Genel bakış ve temel mağaza metrikleri
- Uygulama listesi, oluşturma, düzenleme ve arşivleme
- Sürüm taslakları, APK yükleme, ön izleme ve yayınlama
- Kategori sıralama ve etkinlik yönetimi
- Şikayet kuyruğu, öncelik, işlem notu ve durum
- Kullanıcı arama, yorum görüntüleme ve hesap askıya alma
- Hassas admin işlemleri için denetim kayıtları

Yeni sürüm yayınlama dört adımdır:

1. Sürüm adı, artan `version_code` ve değişiklik notu
2. Resumable APK yükleme ve dosya özeti
3. Mağaza ön izlemesi ve doğrulama
4. Atomik yayınlama ve takipçi bildirimi

## 7. Veri modeli

### Kimlik ve yetki

- `profiles`: `user_id`, benzersiz kullanıcı adı, avatar yolu, hesap durumu, zaman damgaları
- `user_roles`: kullanıcı ve rol; MVP rolü `admin`
- `push_devices`: kullanıcı, cihaz kimliği, Expo push tokenı, etkinlik ve son görülme

### Katalog

- `categories`: ad, slug, sıra ve aktiflik
- `apps`: slug, ad, kısa/uzun açıklama, kategori, ikon yolu, öne çıkarma ve `active/archived` durumu
- `app_screenshots`: uygulama, Storage yolu, sıra ve alt metin
- `app_versions`: uygulama, `version_name`, artan `version_code`, değişiklik notu, APK yolu, boyut, SHA-256, durum, yayın zamanı ve oluşturan admin

Uygulama ile sürüm ayrı tutulur. Yayındaki güncel sürüm, en yüksek yayımlanmış `version_code` değeridir. Aynı uygulamada sürüm kodu tekrarlanamaz.

### Topluluk ve operasyon

- `reviews`: uygulama, kullanıcı, puan, metin, moderasyon durumu ve zaman damgaları
- `app_follows`: kullanıcı ve uygulama; benzersiz çift
- `release_events`: yayımlanan her sürüm için tek olay
- `notification_reads`: kullanıcı ve sürüm olayı için okundu kaydı
- `reports`: bildiren, uygulama, isteğe bağlı sürüm, neden, açıklama, durum ve admin notu
- `download_events`: uygulama/sürüm, isteğe bağlı kullanıcı, yerel kurulum UUID'si ve zaman
- `audit_logs`: admin, eylem, hedef, güvenli metadata ve zaman

Şikayet nedenleri `açılmıyor`, `link_bozuk`, `sahte_uygulama` ve `diğer` ile sınırlandırılır. Aynı kullanıcının kısa sürede aynı hedefe tekrar şikayet göndermesi sınırlandırılır.

## 8. APK ve Storage tasarımı

Bucket ayrımı:

- `apk-drafts`: özel, yalnız admin yazabilir/okuyabilir
- `apks`: yayımlanan dosyalar, herkese açık okuma, yalnız sunucu yayınlama işlemi yazabilir
- `app-assets`: herkese açık ikon ve ekran görüntüleri, yalnız admin yazabilir
- `avatars`: herkese açık okuma, kullanıcı yalnız kendi yoluna doğrulanmış görsel yazabilir

Büyük APK yüklemeleri Supabase TUS resumable endpoint'i ve doğrudan Storage alan adı üzerinden yapılır. Parça boyutu Supabase'in gerektirdiği 6 MB olarak tutulur. Uygulamada keyfî düşük bir boyut sınırı olmaz; gerçek sınır Supabase proje/plan ayarıdır ve admin arayüzünde gösterilir.

APK yolu uygulama ve sürüm kimliğiyle oluşturulur, kullanıcı dosya adı doğrudan yol olarak kullanılmaz. Yayımlanan APK değiştirilemez; düzeltme yeni bir `version_code` gerektirir. Yayınlama işlemi taslağın varlığını, boyutunu, özetini ve artan sürüm kodunu doğrular.

## 9. İndirme ve güncelleme davranışı

Katalog ve APK indirme için hesap gerekmez. İndirme doğrudan yayımlanmış Storage nesnesine gider. Android kurulumu kullanıcı tarafından ve işletim sisteminin bilinmeyen kaynak uyarıları üzerinden yapılır; sessiz kurulum yoktur.

Mobil uygulama, bu cihazda son indirilen uygulama ve `version_code` değerini yerel geçmişte tutar. Son yayımlanan sürüm daha yüksekse buton **Güncelle** olur. Bu kayıt indirmenin başlatıldığını gösterir; APK'nın gerçekten kurulduğunu kanıtlamaz.

Popülerlik için kişisel veri veya IP saklanmadan sınırlı indirme olayları kullanılır. Bu metrik güvenlik kararı için kullanılmaz ve kötüye kullanıma karşı kaba tekrar azaltma uygulanır.

## 10. Yorum ve puan davranışı

- Yorum ve puan için doğrulanmış hesap gerekir.
- Kullanıcı bir uygulama için tek değerlendirme yazar ve bunu düzenleyebilir.
- Yorumda profilin güncel kullanıcı adı ve avatarı gösterilir.
- Ortalama yalnız görünür/moderasyonu geçen yorumlardan hesaplanır.
- Kullanıcı kendi yorumunu kaldırabilir; admin moderasyon işlemi yapabilir.
- React metin düğümleri kullanılır; kullanıcı HTML'i çalıştırılmaz.

## 11. Bildirim akışı

Takip için giriş gerekir. Push izni isteğe bağlıdır; izin vermeyen kullanıcı da takip ettiği uygulamaların güncellemelerini uygulama içi akışta görür. Yeni sürüm yayınlandığında:

1. Sürüm atomik olarak `published` durumuna geçer.
2. Tek bir `release_event` oluşturulur.
3. Takip eden kullanıcılar uygulama içi akışta olayı görür.
4. Edge Function takipçilerin etkin cihazlarını bulur ve Expo push mesajlarını gruplar halinde yollar.
5. Geçersiz tokenlar devre dışı bırakılır; geçici hatalar sınırlı olarak yeniden denenir.

Push hatası sürüm yayınını geri almaz. Android uzaktan push bildirimleri Expo Go'da değil, development/production build üzerinde test edilir.

## 12. Yetkilendirme ve güvenlik

- Service-role ve secret anahtarları mobil veya tarayıcı paketine girmez.
- Sayfa/sekme gizleme yetkilendirme sayılmaz; her hassas işlem RLS ve sunucu rol kontrolünden geçer.
- Her public tabloda RLS açıktır ve varsayılan erişim kapalıdır.
- Anon rolü yalnız aktif katalog, yayımlanmış sürümler, görünür yorumlar ve herkese açık dosyaları okuyabilir.
- Kullanıcı yalnız kendi profili, takibi, cihaz tokenı, yorumu, okundu kaydı ve şikayeti üzerinde izinli işlemleri yapabilir.
- Askıya alınmış kullanıcıların topluluk yazma işlemleri reddedilir.
- Admin rolü yalnız veritabanı tarafından doğrulanır; istemci metadata'sından alınmaz.
- Yayınlama, kullanıcı askıya alma ve şikayet kapatma işlemleri denetim kaydı üretir.
- URL, dosya yolu, MIME türü, görsel boyutu ve metin uzunlukları hem istemci hem backend katmanında doğrulanır.
- Hassas Edge Function çağrılarında oran sınırlama ve yapılandırılmış hata yanıtları kullanılır.

## 13. Cep Depo APK modlama koruması

APK'yı tamamen modlanamaz yapmak mümkün değildir. Tasarımın güvenlik hedefi, değiştirilmiş istemcinin sunucu veya admin ayrıcalığı kazanmasını önlemek ve resmî paketin doğrulanabilmesini sağlamaktır.

- Tüm üretim sürümleri aynı korunan EAS/Android imzalama anahtarıyla imzalanır.
- Uygulama, çalışma zamanında beklenen paket adını ve imza sertifikası parmak izini kontrol eder.
- Resmî dağıtım sayfası her APK için SHA-256 ve sertifika parmak izi yayımlar.
- Play Integrity tokenı sunucuda doğrulanır; istemci sonucu güvenlik kararı olarak kabul edilmez.
- Doğrudan yüklenen resmî APK, Google Play tarafından `UNRECOGNIZED_VERSION` döndürebileceği için bu sonuç MVP'de tek başına engelleme nedeni olmaz; risk ve denetim sinyali olarak kaydedilir.
- Google Play tarafından `PLAY_RECOGNIZED` olan dağıtımda uygulama bütünlüğü daha sıkı uygulanabilir.
- Mobil uygulamada admin kodu, admin navigasyonu veya ayrıcalıklı anahtar bulunmaz.
- Hermes üretim derlemesi, minification ve Android R8 tersine mühendisliği zorlaştırır fakat güvenlik sınırı sayılmaz.
- Ticari ağır anti-tamper aracı MVP'ye dahil değildir.

## 14. Hata yönetimi

- Ağ ekranlarında skeleton, boş durum, çevrimdışı mesajı ve yeniden deneme bulunur.
- Oturum hatası public kataloğu engellemez; yetkili işlem kullanıcıdan yeniden giriş ister.
- Yarım kalan TUS yüklemesi önceki fingerprint ile devam ettirilir.
- Yayınlama idempotenttir; tekrar çağrı ikinci sürüm olayı üretmez.
- Taslak yükleme tamamlanıp veritabanı kaydı oluşmazsa nesne yetim taslak temizliğine aday olur.
- Push başarısızlığı yayın durumunu bozmaz.
- Bozuk yerel indirme geçmişi güvenli biçimde sıfırlanır.
- Kullanıcıya teknik hata/anahtar bilgisi gösterilmez; loglarda token ve kişisel veri maskelenir.

## 15. Test ve doğrulama stratejisi

### Veritabanı

- Migration sıfırdan uygulanabilme testi
- RLS için anon, normal kullanıcı, başka kullanıcı, askıya alınmış kullanıcı ve admin senaryoları
- Storage bucket ve yol politikaları
- Artan sürüm kodu, tek yorum, tek takip ve idempotent yayınlama kısıtları
- Şikayet tekrar sınırı ve audit log üretimi

### Mobil

- Servis ve durum kancaları için birim testleri
- React Native Testing Library ile yükleniyor/boş/hata/başarı ekran durumları
- Kimlik doğrulama, yorum, takip ve indirme geçmişi etkileşim testleri
- Deep link ve bildirim yönlendirme testleri
- Gerçek Android development build üzerinde push, APK indirme, imza kontrolü ve geri dönüş akışı

### Admin

- Form doğrulama ve rol koruma testleri
- Resumable upload hata/devam senaryoları
- Uygulama oluşturma, sürüm taslağı, yayınlama, arşivleme ve şikayet çözme için Playwright akışları
- Admin olmayan kullanıcının hem sayfa hem backend seviyesinde reddedilmesi

### Tamamlama kapısı

- Typecheck
- Lint
- Birim/entegrasyon testleri
- RLS güvenlik testleri
- Mobil Android production build
- Admin production build
- Gerçek cihaz smoke testi

Bu kontrollerin çıktısı görülmeden MVP tamamlandı veya güvenli kabul edilmez.

## 16. Uygulama sırası

1. Mevcut mobil taslağı koruyarak yeni klasör yapısını ve araç zincirini kurmak
2. Yeni Supabase şeması, RLS, Storage ve seed verisini oluşturmak
3. Mobil tasarım sistemi, navigasyon ve public katalog
4. Auth, profil, yorum, puan ve şikayet akışları
5. İndirme geçmişi, takip, uygulama içi bildirim ve push
6. Bağımsız Next.js admin projesi
7. Resumable APK yükleme ve atomik sürüm yayınlama
8. Modlama koruması, Play Integrity sinyali ve production build yapılandırması
9. Uçtan uca güvenlik, cihaz ve yayın doğrulaması

Her aşama küçük, test edilebilir teslimlere bölünecek; eski tek dosyalı taslak ancak eşdeğer yeni akış doğrulandıktan sonra kaldırılacaktır.
