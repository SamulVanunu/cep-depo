# Cep Depo 0.5.0 Toplu APK Güncellemesi Tasarımı

**Tarih:** 2026-10-18
**Durum:** Kullanıcı tarafından sohbet içinde onaylanan tasarımın yazılı hali

## Amaç

Cep Depo'nun APK yayınlama ve kurulum deneyimini tek public `0.5.0` sürümünde tamamlamak:

1. Her APK sürümünde Mobil ve TV desteğini bağımsız olarak yönetmek.
2. Her APK sürümünde hesap gereksinimini `Gerekmez`, `İsteğe bağlı` veya `Zorunlu` olarak göstermek.
3. Cep Depo'nun sonraki APK sürümlerini admin yayın kaynağından bulup zorunlu güncellemek.
4. TV uyumlu APK'ları telefondan aynı ağdaki Android/Google TV'ye kullanıcı kontrollü ADB ile kurmak.

Başarı ölçütleri:

- Mobil ve TV seçeneklerinden en az biri seçilir; ikisi birlikte seçilebilir.
- Hesap gereksinimi sürüm bazında tutulur ve güncel yayımlanmış sürümden gösterilir.
- Cep Depo yalnız aynı paket adı ve daha yüksek gerçek Android `versionCode` için güncelleme kapısı açar.
- Güncelleme APK'sı boyut, ZIP/APK ve SHA-256 doğrulamasından geçmeden installer açılmaz.
- Bilinen zorunlu güncelleme atlanamaz; iç akış başarısızsa doğrulanmış public HTTPS kaynak kullanıcıya sunulur.
- TV kurulumu otomatik yerel ağ keşfi ve altı haneli pairing koduyla çalışır; klasik IP/5555 yedeği korunur.
- ADB anahtarı, pairing kodu, TV adresi ve oturum verileri hiçbir zaman sunucuya veya audit kayıtlarına gönderilmez.
- Kullanıcıya yalnız bir final `0.5.0` APK'sı dağıtılır; ara doğrulamalar internal release candidate build'leriyle yapılır.

## Önceki Tasarımlarla İlişki

Bu belge, `docs/superpowers/specs/2026-10-13-mobile-tv-notifications-support-design.md` içindeki TV metadata'sı ve ADB kurulum bölümlerini günceller ve onların yerine geçer.

- Tek `supports_tv` alanı yerine bağımsız Mobil/TV alanları kullanılır.
- ADB pairing deneyimi IP ve portları ilk adımda istemek yerine otomatik NSD/mDNS keşfini tercih eder.
- Eşleşen TV, kullanıcı unutana kadar yalnız telefonda güvenli biçimde hatırlanır.
- Metadata, self-update ve ADB tek public `0.5.0` sürümünde çıkar; geliştirme ve doğrulama yine aşamalıdır.

Önceki belgedeki push bildirimleri, destek bağlantıları ve kampanya altyapısı bu çalışmanın kapsamında değildir ve ayrı bir gelecek işi olarak kalır. `docs/superpowers/specs/2026-10-14-external-apk-admin-reliability-design.md` ile getirilen Storage/harici HTTPS kaynak ayrımı, 50.000.000 bayt Storage sınırı ve bütünlük kontrolleri aynen korunur.

## Kapsam

### Dahil

- Sürüm bazlı Mobil/TV ve hesap gereksinimi metadata'sı.
- Admin draft ve yayın akışlarında yeni alanların doğrulanması ve audit'i.
- Mobil katalogda platform ve hesap rozetleri, platform filtresi ve platforma göre kurulum eylemleri.
- Cep Depo için cold-start ve foreground zorunlu sürüm kontrolü.
- Uygulama içi indirme, SHA-256 doğrulama, Android installer ve public HTTPS fallback.
- Android yerel Expo/Kotlin ADB modülü.
- Android 11+ ADB TLS pairing protokolü; TV cihazlarında üretici/Android sürümü desteğine bağlı çalışma.
- Otomatik `_adb-tls-pairing._tcp` ve `_adb-tls-connect._tcp` keşfi.
- Klasik IP/5555 bağlantısı.
- Android Keystore destekli yerel ADB kimliği ve `TV'yi unut` işlemi.
- Internal RC doğrulaması ve tek final public `0.5.0` APK dağıtımı.

### Hariç

- Sessiz, kullanıcıdan gizli veya sistem onayı olmadan APK kurulumu.
- TV geliştirici seçeneklerini ya da kablosuz hata ayıklamayı otomatik açma.
- Root, USB üzerinden telefon-TV bağlantısı veya uzaktaki/internet üzerindeki ADB hedefleri.
- Split APK, XAPK veya APKS katalog desteği; bu sürüm yalnız tek APK kurar.
- ADB shell'i genel amaçlı olarak JavaScript'e veya kullanıcıya açma.
- ADB pairing kodu, IP, anahtar ya da oturumu Supabase'e gönderme.
- Push bildirimleri, destek sohbeti veya uygulama yöneticisi iletişim akışı.
- Expo OTA/EAS Update ile native APK güncelleme; güncelleme Android APK installer üzerinden yapılır.
- Production migration, deploy, EAS build veya gerçek APK yayınının otomatik yapılması.

## Tek Public Sürüm Stratejisi

Final sürüm adı `0.5.0` olur ve Android `versionCode` değeri mevcut `4` değerinden büyük seçilir. Kesin final kodu implementation planında RC build numaralarıyla çakışmayacak biçimde belirlenir.

Kullanıcıya birden fazla ara APK gönderilmez. Geliştirme sırası:

1. Şema ve admin metadata temeli yerelde tamamlanır.
2. Self-update motoru internal RC1/RC2 ve staging/local backend ile doğrulanır.
3. ADB native dependency spike'ı ve fiziksel cihaz matrisi tamamlanır.
4. Bütün özellikler tek final `0.5.0` release APK'sında birleştirilir.

Mevcut `0.3.1` self-update motoru içermediği için `0.5.0` kullanıcıya son kez mevcut harici yöntemle kurdurulur. `0.5.0` sonrasındaki Cep Depo sürümleri admin yayın kaynağından zorunlu güncellenir.

ADB doğrulaması tamamlanmazsa eksik özellikli public sürüm çıkarmak yerine `0.5.0` bekletilir. Internal aşamalar public sürüm vaadi veya production rollout izni değildir.

## Veri Modeli

### Hesap gereksinimi enum'u

Yeni enum:

```sql
public.account_requirement = ('none', 'optional', 'required')
```

Türkçe kullanıcı karşılıkları sırasıyla `Gerekmez`, `İsteğe bağlı`, `Zorunlu` olur. Veritabanı ve uygulama sözleşmesinde kararlı İngilizce değerler kullanılır.

### `app_versions`

Her APK sürümüne şu alanlar eklenir:

- `supports_mobile boolean not null default true`
- `supports_tv boolean not null default false`
- `account_requirement public.account_requirement not null default 'none'`

Constraint, `supports_mobile or supports_tv` koşulunu zorunlu tutar. Mevcut satırlar `Mobil=true`, `TV=false`, `Gerekmez` ile geriye uyumlu olur.

Metadata draft oluşturulurken yazılır. Yayımlanmış sürüm metadata'sı yerinde düzenlenmez; yanlış bilgi yeni bir draft ve daha yüksek gerçek `versionCode` ile düzeltilir. Yeni draft formu, önceki yayımlanmış sürümün değerlerini kullanıcıya varsayılan olarak sunar ancak açıkça değiştirilebilir.

### Paket kimliği

`apps.package_name` dolu değerler için benzersiz yapılır. Migration öncesi production verisinde çakışma preflight'ı zorunludur. Mevcut paket biçimi kontrolleri ve bir uygulamanın sonraki sürümlerinde paket adını değiştirmeme kuralı korunur.

Bu benzersizlik, `com.cepdepo.app` için yalnız bir katalog uygulamasının self-update kaynağı olmasını garanti eder.

### Public katalog sözleşmesi

`catalog_app_cards`, detay sorgusu ve ilgili generated type'lar güncel yayımlanmış sürüm için üç metadata alanını taşır. Eski istemciler yeni kolonları okumadığı için çalışmaya devam eder.

Dar kapsamlı public self-update RPC'si, istenen paket adı için yalnız aktif uygulamanın en yüksek `published` sürümünü döndürür:

- uygulama ve sürüm kimliği;
- paket adı;
- `version_name` ve `version_code`;
- düz metin `changelog`;
- `download_source` ile yalnız ilgili `apk_path` veya `apk_url`;
- `apk_size_bytes` ve `sha256`.

RPC taslak, withdrawn veya arşivlenmiş uygulama sürümünü döndürmez. `anon` ve `authenticated` yalnız bu güvenli dönüş tipini çalıştırabilir; mutation yetkisi kazanmaz.

## Admin Yayınlama Deneyimi

APK draft/yayın adımında zorunlu alanlar:

- `Mobil` checkbox;
- `TV` checkbox;
- `Hesap gereksinimi` select: `Gerekmez`, `İsteğe bağlı`, `Zorunlu`.

Mobil ve TV aynı anda seçilebilir. İkisinin de kapalı olması hem Zod/form sınırında hem veritabanında reddedilir. Alanlar final yayın özetinde açıkça gösterilir.

Yeni alanlar mevcut admin mutation sınırlarından geçer:

- `requireAdmin(..., { mutation: true })` korunur;
- manifestten `packageName`, `versionName`, `versionCode` okuma kaldırılmaz;
- aynı paket ve daha yüksek gerçek `versionCode` zorunluluğu korunur;
- ikon, ekran görüntüsü alt metni, Storage/harici kaynak, boyut ve SHA-256 kuralları korunur;
- audit metadata'sına yalnız enum/boolean değerleri yazılır; URL, hash veya secret eklenmez.

Uygulama oluşturma ve sürüm yayınlama atomikliği mevcut yaklaşımı izler. Metadata doğrulama hatası APK'yı yayınlamaz veya mevcut yayımlanmış sürümü değiştirmez.

## Mobil Katalog Deneyimi

### Rozetler ve filtre

Kart ve detay ekranı güncel yayımlanmış sürüm için:

- `Mobil` rozeti;
- `TV` rozeti;
- hesap gereksinimi etiketi gösterir.

Platform filtresi `Tümü`, `Mobil`, `TV` seçeneklerinden oluşur. Hem Mobil hem TV destekleyen sürüm iki platform filtresinde de görünür. Filtre server-side katalog sorgusuna taşınır; istemcide eksik sayfa üzerinde sonradan filtre uygulanmaz.

### Kurulum eylemleri

- Yalnız `supports_mobile=true`: **Telefona kur**.
- Yalnız `supports_tv=true`: **TV'ye kur**.
- İkisi de `true`: iki eylem de görünür.
- Web veya Android dışındaki platformlarda APK kurulum eylemleri desteklenmiyor durumunu açıkça gösterir.

Hesap gereksinimi yalnız katalog bilgisidir; Cep Depo üçüncü taraf uygulama adına hesap oluşturmaz, kullanıcı parolası istemez ve zorunlu hesap bilgisini Cep Depo oturumuyla karıştırmaz.

## Zorunlu Cep Depo Self-Update

### Sürüm kaynağı

İstemci kendi kurulu paket ve sürümünü native runtime'dan okur:

- Paket: Android application ID.
- Sürüm kodu: `expo-application` içindeki native build version.

`app.json` değeri, JavaScript bundle sabiti veya yerel indirme geçmişi kurulu sürümün kanıtı sayılmaz.

İstemci dar RPC'yi kendi paket adıyla çağırır. Dönen paket adı native application ID ile birebir aynı değilse veri reddedilir. Yalnız server `version_code > nativeBuildVersion` olduğunda zorunlu güncelleme oluşur.

### Kontrol zamanları

- Release build cold start.
- Uygulamanın background'dan foreground'a dönmesi.
- Güncelleme ekranındaki açık `Tekrar kontrol et` eylemi.

Development, test ve Expo Go ortamları production zorunlu güncelleme kapısına girmez. Bu bypass yalnız build channel/runtime kontrolüyle sınırlıdır ve production APK içinde kullanıcı tarafından açılamaz.

### Zorunlu kapı

Yeni sürüm bilindiğinde tam ekran update gate katalog ve hesap rotalarını kapatır. Android geri tuşu, deep link veya oturum değişikliği kapıyı atlayamaz.

Akış:

1. Sürüm bilgisi ve changelog özeti gösterilir.
2. APK mevcut indirme katmanıyla indirilir.
3. Byte boyutu, ZIP/APK biçimi ve SHA-256 doğrulanır.
4. Android sistem installer'ı açılır.
5. Kullanıcı kurulumu iptal eder veya uygulamaya geri dönerse kapı açık kalır.
6. Yeni APK kurulduktan sonra uygulama yeniden açıldığında native build code tekrar okunur ve kapı kapanır.

Cep Depo sessiz kurulum yapmaz ve Android'in kullanıcı onayını atlamaz.

### Ağ ve önbellek davranışı

Doğrulanmış daha yüksek sürüm metadata'sı secretsiz, şemalı yerel cache'e yazılır.

- Daha yeni sürüm daha önce biliniyorsa ağ kesildiğinde zorunlu kapı devam eder.
- Uygulama daha yeni sürüm bilgisi hiç almamışsa ilk ağ/Supabase hatası kataloğu kilitlemez; foreground'da tekrar dener.
- Sunucu authoritative olarak artık daha yüksek yayımlanmış sürüm olmadığını bildirirse withdrawn hedefe ait cache temizlenebilir.
- Bozuk veya parse edilemeyen cache yok sayılır ve yeniden alınır.

### Fallback bağlantısı

İç indirme veya installer başlatma akışı hata verirse kapı şu eylemleri sunar:

- `Tekrar dene`;
- admin tarafından yayın kaydında doğrulanmış aynı public HTTPS kaynak için `Tarayıcıda indir`;
- güvenli tanılama kaydını görüntüleme/kopyalama.

Fallback URL yeni bir kullanıcı girdisinden oluşmaz; yalnız katalogdaki Storage public URL veya doğrulanmış external URL kullanılır. Bağlantı açılması güncellemeyi tamamlanmış saymaz ve zorunlu kapıyı kaldırmaz.

## TV'ye ADB Kurulum Deneyimi

### Önkoşullar

- Telefon ve TV aynı yerel ağdadır.
- TV'de geliştirici seçenekleri ve ilgili ADB/kablosuz hata ayıklama modu kullanıcı tarafından açılmıştır.
- Android 11+ protokol desteği cihaz üreticisine bağlıdır; resmî Android TV kablosuz debugging desteği pratikte Android 13+ cihazlarda beklenir.
- Klasik IP/5555 yalnız TV bu modu zaten destekliyor ve açmışsa kullanılabilir.

Cep Depo bu ayarları otomatik açmaya veya güvenlik onaylarını aşmaya çalışmaz.

### Otomatik pairing-code akışı

1. Kullanıcı **TV'ye kur** seçer.
2. APK telefona indirilir ve tamamen doğrulanır; başarısızsa hiçbir ADB bağlantısı açılmaz.
3. Cep Depo, özelliğin yerel ağ ve geliştirici modu gerektirdiğini açıklar; gerekli izin yalnız bu anda istenir.
4. Kullanıcı TV'de `Eşleştirme koduyla eşleştir` ekranını açar.
5. Cep Depo `_adb-tls-pairing._tcp` servislerini keşfeder.
6. Bulunan TV'ler cihaz adıyla listelenir; Android 17 ve sonrasında mümkün olduğunda sistemin gizlilik korumalı NSD cihaz seçicisi kullanılır.
7. Kullanıcı TV'yi seçer ve yalnız altı haneli pairing kodunu girer.
8. Pairing tamamlanınca `_adb-tls-connect._tcp` hizmeti keşfedilir ve TLS bağlantısı kurulur.
9. Keşif başarısızsa ayrı **Elle bağlan** akışı IP, pairing portu ve connect portunu ister.

Android 16/17 yerel ağ izin modeli target SDK'ya göre uygulanır. İzin reddi katalog veya telefona kurulumu engellemez; yalnız TV özelliği kullanılamaz olur.

### Klasik IP/5555

Gelişmiş seçenek, private/local IP ve varsayılan `5555` portunu alır. TV RSA güven onayı gösterirse kullanıcı TV kumandasıyla kabul eder. Uygulama internet adreslerine, hostname ile yönlendirilebilen belirsiz hedeflere veya public IP'lere ADB bağlantısı kurmaz.

### APK kurulumu

ADB bağlantısından bağımsız olarak APK önce telefonda mevcut indirme motoruyla indirilir ve tamamen doğrulanır. Native modül yalnız app-private cache'teki doğrulanmış tek APK tanıtıcısını kabul eder.

Durum makinesi:

`downloading → verifying → discovering → pairing → connecting → installing → success/error`

İndirme zaten doğrulanmışsa bağlantı yeniden kurulurken dosya tekrar indirilmeyebilir. Kurulum `-r` semantiğiyle mevcut aynı paket uygulamasını güncelleyebilir; imza veya sürüm uyuşmazlığını TV Package Manager reddeder. Başarı yalnız Package Manager kesin `Success` sonucu döndürürse gösterilir.

Yanlış kod, pairing zaman aşımı, RSA reddi, farklı/izole ağ, connect port değişimi, bağlantı kopması, imza uyuşmazlığı, düşük sürüm ve yetersiz TV depolaması ayrı kullanıcı hata sınıflarına eşlenir. Ham shell/Package Manager çıktısı kullanıcıya veya loglara kopyalanmaz.

### TV'yi hatırlama

Başarılı pairing sonrası:

- kullanıcı tarafından görülen TV adı ve gerekli bağlantı kimliği app-private depoda tutulur;
- ADB RSA özel anahtarı doğrudan düz metin saklanmaz; Android Keystore anahtarıyla şifrelenir;
- pairing kodu işlem biter bitmez bellekten atılır ve saklanmaz;
- değişebilen TLS connect portu her kurulumda yeniden keşfedilir;
- `TV'yi unut` yerel cihaz kaydını ve anahtarı siler, ayrıca kullanıcıya TV'nin `Eşleşmiş cihazlar` listesinden Cep Depo'yu kaldırmasını söyler.

Hiçbir ADB bilgisi Supabase, admin audit, analytics, tanılama kopyası veya crash loguna girmez.

## Native Modül Sınırı

Expo managed JavaScript çalışma zamanı ADB host protokolünü tek başına karşılamaz. `0.5.0`, Android için yerel Expo/Kotlin modülü ve EAS development/release build gerektirir.

JavaScript'e yalnız tipli yüzey açılır:

- `discoverPairingDevices()`
- `pairDevice(selection, pairingCode)`
- `connectRememberedDevice(deviceId)`
- `connectClassic(privateIp, port)`
- `installVerifiedApk(deviceId, localArtifactId)`
- `cancelCurrentOperation()`
- `forgetDevice(deviceId)`

Genel `shell(command)`, dosya sistemi yolu, key export veya key import API'si sunulmaz.

Tercih edilen başlangıç bağımlılığı Apache-2.0 lisanslı, API 24+, TLS pairing ve streaming package install destekli saf Kotlin `adb-kt` kütüphanesidir. Kütüphane genç olduğu için product dependency olarak eklenmeden önce ayrı spike şu kanıtları üretir:

- sabit sürüm ve dependency/lock doğrulaması;
- lisans ve transitive dependency incelemesi;
- gerçek Android/Google TV TLS pairing;
- klasik 5555 RSA onayı;
- tek APK streaming install ve `-r` güncelleme;
- coroutine iptali, socket kapanışı ve timeout;
- private key'in Keystore destekli sağlayıcıyla kullanılabilmesi;
- release build küçültme/ProGuard uyumluluğu.

Spike başarısızsa kendi SPAKE2/TLS/ADB kriptografimizi yazmaya geçilmez. Mimari yeniden değerlendirilir ve kullanıcı onayı alınır.

## Güvenlik ve Gizlilik

- Admin mutation'ları mevcut server-side admin kontrolünü kullanır.
- Public istemci yalnız publishable Supabase anahtarı kullanır; secret/service-role anahtarı bundle'a girmez.
- Self-update yalnız benzersiz native paket adı ve daha yüksek native build code ile tetiklenir.
- APK bütünlük doğrulamaları hiçbir hata çözümü için gevşetilmez.
- External URL public HTTPS, credentialsiz ve mevcut uzunluk/biçim kurallarına uygun kalır.
- ADB yalnız kullanıcı eylemiyle ve private/local hedefe bağlanır.
- Pairing kodu altı rakamla, port `1..65535` ile, IP canonical private/local aralıkla doğrulanır.
- Pairing kodu, IP, port, ADB key, URL query, hash ve ham native hata tanılama/audit içinde yer almaz.
- Yerel ağ izni yalnız TV kurulumu bağlamında istenir ve reddedilmesi güvenli biçimde kapanır.
- Native modül key export, key logging veya arbitrary shell sağlamaz.
- İptal bütün coroutine, stream ve socket kaynaklarını kapatır; yarım işlem başarı sayılmaz.

## Hata Yönetimi

- Metadata eksik/geçersizse katalog mapper güvenli hata verir; yayın constraint'i bozuk satırı engeller.
- Self-update kontrol hatası, bilinen güncelleme yoksa uygulamayı kullanılmaz yapmaz; güvenli retry uygular.
- Bilinen zorunlu güncelleme indirme veya installer hatasında kalkmaz.
- Withdrawn bozuk hedef authoritative server kontrolünden sonra cache'ten kaldırılabilir.
- APK doğrulama hatasında installer veya ADB çağrılmaz.
- NSD discovery boşsa manuel giriş sunulur; izin reddedildiyse neden ve ayarlara gitme seçeneği gösterilir.
- Pairing başarısızlığı kaydedilmiş sağlam anahtarı bozmaz; yeni cihaz kaydı yalnız başarıdan sonra atomik yazılır.
- ADB kurulum bağlantısı koparsa kullanıcı tekrar bağlanıp yeniden deneyebilir; başarı iddiası yapılmaz.
- Native bağımlılık desteklenmeyen cihazda çökerse değil, açık `unsupported` sonucu döndürür.

## Test Stratejisi

### Veritabanı ve pgTAP

- Enum ve üç yeni kolonun varsayılanları.
- En az bir platform constraint'i.
- Eski satırların geriye uyumlu backfill'i.
- Paket adı benzersizliği ve production preflight çakışma testi.
- Draft/published/withdrawn görünürlüğü.
- Self-update RPC dönüş alanları, en yüksek versionCode ve anon/authenticated grant'leri.
- RLS ve admin mutation/audit davranışı.
- Mobil ve TV katalog filtreleri.

### Admin Vitest ve Playwright

- Mobil, TV ve ikisinin birlikte seçilmesi.
- İkisinin de kapalı olmasının form ve server sınırında reddi.
- Üç hesap gereksinimi seçeneği.
- Önceki yayımlanmış sürümden varsayılan taşıma.
- Yayın özetinde metadata görünümü.
- Manifest, package, versionCode, SHA-256 ve 50.000.000 bayt regresyonları.
- Yetkisiz ve read-only mutation reddi.

### Mobil Jest

- Katalog mapper ve rozet/filtre davranışı.
- Platforma göre telefon/TV eylemleri.
- Native build code parse ve karşılaştırma sınırları.
- Cold-start/foreground deduplication.
- Bilinen update cache'i, offline blok ve authoritative withdrawal temizliği.
- Download/verifying/installing/fallback durumları.
- İptal veya installer dönüşünde zorunlu kapının açık kalması.
- Development/test bypass'ının release build'e sızmaması.
- ADB native hata kodlarının güvenli kullanıcı mesajlarına eşlenmesi.

### Kotlin/native testleri

- Private/local IP, port ve pairing code doğrulaması.
- NSD service filtreleme ve Android sürüm dalları.
- Keystore destekli key create/load/delete.
- Pair/connect/install timeout ve cancellation cleanup.
- Arbitrary shell veya key export yüzeyi olmadığının sözleşme testi.
- App-private doğrulanmış artifact dışındaki URI/path reddi.
- Ham native hataların sanitize edilmesi.

### Fiziksel cihaz matrisi

- En az bir Android telefon.
- En az bir Android/Google TV 13+ pairing-code cihazı.
- Mümkünse ikinci üretici/Android TV sürümü.
- Klasik IP/5555 destekleyen cihaz veya kontrollü test hedefi.
- Doğru/yanlış pairing kodu, discovery fallback ve izin reddi.
- Ağ kopması, port değişimi ve yeniden bağlantı.
- Temiz kurulum, `-r` güncelleme, imza uyuşmazlığı ve düşük versionCode reddi.
- Cep Depo internal RC1 → RC2 zorunlu self-update zinciri.
- Final release APK'nın temiz kurulum ve mevcut `0.3.1` üzerine kurulumu.

## Dağıtım Kapıları

Her biri ayrı açık kullanıcı onayı gerektirir:

1. Hosted Supabase migration.
2. Admin production deployment.
3. EAS internal/native RC build'leri.
4. Final EAS `0.5.0` APK build'i.
5. Cep Depo `0.5.0` gerçek katalog kaydı ve APK yayını.
6. Kullanıcılara final APK dağıtımı.

Yerel test, migration reset, staging veya internal build hiçbir production kapısını otomatik açmaz.

Production rollout sırası:

1. Paket adı çakışma preflight'ı.
2. Hosted migration ve pgTAP/advisor doğrulaması.
3. Admin deploy ve yalnız draft metadata smoke testi.
4. Internal RC self-update ve ADB fiziksel matrisinin tamamlanması.
5. Final `0.5.0` build, package/version/hash doğrulaması.
6. Ayrı onayla Cep Depo kaydı ve final APK yayını.
7. `0.3.1` kullanıcılarına son manuel bootstrap dağıtımı.

## Rollback ve Düzeltme

- Migration geri alınmaz; eski istemcilerle uyumlu forward-fix migration kullanılır.
- Admin hatasında doğrulanmış önceki Vercel deployment'a rollback yapılabilir.
- Yayımlanmış bozuk hedef henüz kurulmadıysa sürüm withdrawn edilir; istemci online authoritative kontrol sonrası o hedefin cached zorunlu kapısını temizler.
- Bozuk sürüm kurulmuşsa Android downgrade yapılmaz; aynı paket ve daha yüksek `versionCode` ile düzeltme yayınlanır.
- Aynı `versionCode` farklı APK için yeniden kullanılmaz.
- ADB native spike başarısızsa production dependency veya yarım özellik yayınlanmaz.
- Self-update zorunluluğu kullanıcı tarafından atlanamaz; operasyonel geri dönüş yalnız bozuk hedefi withdraw etmek veya daha yüksek doğrulanmış düzeltme sürümü yayınlamaktır.

## Onaylanan Kararlar

- Kullanıcıya tek public `0.5.0` APK'sı çıkar; geliştirme internal aşamalıdır.
- Mobil/TV ve hesap gereksinimi sürüm bazındadır.
- Mobil ve TV bağımsızdır, birlikte seçilebilir ve en az biri zorunludur.
- Platform metadata'sı kurulum düğmelerini belirler.
- Zorunlu update, bilinen yeni sürümde offline olsa da devam eder; ilk kontrol hatası fail-open olur.
- Cep Depo update kaynağı benzersiz `com.cepdepo.app` paket kaydıdır.
- Android gerçek build code native runtime'dan okunur.
- TV discovery önce otomatiktir; kullanıcı normal akışta yalnız TV'yi ve altı haneli kodu seçer.
- Manuel pairing alanları ve klasik IP/5555 fallback olarak korunur.
- TV ve ADB kimliği yalnız telefonda, Keystore destekli biçimde hatırlanır.
- ADB için arbitrary shell yüzeyi açılmaz.
- Manifest, package, versionCode, boyut, SHA-256, admin auth, audit, ikon ve alt metin kontrolleri korunur.
- Production migration, deploy, build, yayın ve dağıtım ayrı açık onay kapılarıdır.
