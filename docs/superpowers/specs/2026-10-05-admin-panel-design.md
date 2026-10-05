# Cep Depo Yönetim Paneli Tasarımı

**Tarih:** 5 Ekim 2026

**Durum:** Kullanıcı tarafından bölüm bölüm onaylandı

**Kapsam:** Next.js/Vercel yönetim paneli, katalog ve APK yayınlama, moderasyon ve tam Auth kullanıcı yönetimi

## 1. Amaç

Cep Depo için yalnız mevcut admin hesabının erişebileceği, masaüstü öncelikli bir web yönetim paneli oluşturulacaktır. Panel; mobil uygulamanın kullandığı hosted Supabase projesini yönetir ve şu operasyonları tek yerde toplar:

- uygulama ve kategori kayıtlarını yönetme;
- yeni APK sürümü yükleme, doğrulama ve yayımlama;
- yorumları görünür/gizli yapma ve kontrollü silme;
- şikâyetleri inceleme, çözme veya reddetme;
- Auth kullanıcılarını görme, askıya alma, aktifleştirme, recovery başlatma ve güvenli iki aşamalı akışla silme;
- bütün kritik yönetim işlemlerini immutable audit kayıtlarında izleme.

Panel genel kullanıcıya açık bir web kataloğu değildir. Mobil katalog, anonim indirme ve topluluk deneyimi mevcut Expo uygulamasında kalır.

## 2. Kapsam sınırları

### Dahil

- Aynı repoda bağımsız `admin/` Next.js 16 App Router uygulaması
- Vercel production deployment
- Supabase e-posta/şifre admin girişi ve SSR cookie oturumu
- Tek mevcut admin hesabı için rol kontrolü
- Dashboard ve öncelikli iş kuyrukları
- Kategori, uygulama, ekran görüntüsü ve sürüm yönetimi
- Private draft APK yükleme ve public APK yayınlama
- Yorum moderasyonu
- Şikâyet çözüm akışı
- Auth kullanıcı listeleme ve güvenli yönetim işlemleri
- Admin audit log
- RLS, Storage politikaları, pgTAP, component, DAL ve Playwright testleri

### Dahil değil

- Genel kullanıma açık web katalog
- Yeni admin oluşturma veya rol yönetimi arayüzü
- Birden fazla organizasyon/tenant
- Mobil uygulamadan yayınlama
- Otomatik malware taraması veya APK imza doğrulaması
- Marketing analytics, push bildirimleri veya toplu e-posta
- SMTP sağlayıcısı kurma; panel yalnız mevcut Supabase Auth e-posta altyapısını kullanır
- Custom domain zorunluluğu; ilk yayın Vercel HTTPS adresiyle çalışabilir

## 3. Repo ve uygulama mimarisi

Panel aynı Git reposunda `admin/` altında bağımsız bir uygulamadır. Mobil Expo projesinin root bağımlılıkları ve komutları değiştirilmeden korunur.

Önerilen ana yapı:

```text
admin/
  app/
    (auth)/login/
    (dashboard)/
      page.tsx
      apps/
      reviews/
      reports/
      users/
  src/
    components/
    features/
      apps/
      reviews/
      reports/
      users/
      uploads/
    lib/
      auth/
      supabase/
      validation/
    server/
      dal/
      actions/
      audit/
    types/database.types.ts
  tests/
  package.json
  next.config.ts
```

`admin/package.json` kendi Next.js, React, Supabase SSR, validation, test ve upload bağımlılıklarını taşır. Vercel Root Directory `admin` olarak ayarlanır. Supabase migration’ları repo kökündeki canonical `supabase/migrations/` dizininde kalır. Admin database tipi aynı schema’dan üretilir; elle düzenlenmez.

UI bileşenleri, server action’lar ve DAL tek dosyada birleşmez. Feature modülleri yalnız kendi form, tablo, validator ve action sözleşmelerini içerir. Secret client yalnız `server-only` veri erişim katmanında bulunur.

## 4. Kimlik doğrulama ve yetkilendirme

### 4.1 Oturum

- Panel mevcut Supabase Auth e-posta/şifre hesabını kullanır.
- `@supabase/ssr` browser/server client’ları ve secure cookie oturumu kullanılır.
- Request katmanı süresi dolmuş oturumu yeniler ve authenticated sayfaları login’e yönlendirir.
- Oturum varlığı tek başına yetki değildir.

### 4.2 Admin rolü

`user_roles` tablosuna authenticated kullanıcının yalnız kendi rol satırını okuyabildiği RLS politikası ve column/table grant eklenir. `requireAdmin()`:

1. server-side Supabase client ile JWT/claims doğrular;
2. doğrulanmış kullanıcı ID’sinin kendi `user_roles` satırında `admin` rolü olduğunu kontrol eder;
3. yalnız bundan sonra privileged DAL çağrısına izin verir.

Middleware yalnız kullanıcı deneyimi için erken yönlendirme yapar. Her Server Action, Route Handler ve privileged DAL fonksiyonu bağımsız olarak `requireAdmin()` çağırır. Server Action’lar doğrudan POST edilebilen public endpoint gibi değerlendirilir.

Panelden admin rolü eklenemez, kaldırılamaz veya başka kullanıcıya devredilemez. Mevcut/son admin silinemez ya da askıya alınamaz.

### 4.3 Secret client

Tam Auth yönetimi `SUPABASE_SECRET_KEY` gerektirir. Bu değer:

- yalnız Vercel encrypted server environment’ında bulunur;
- `NEXT_PUBLIC_*` adı taşımaz;
- `server-only` modülünden dışarı çıkmaz;
- admin doğrulamasından önce kullanılmaz;
- log, hata mesajı, audit metadata veya HTML çıktısına yazılmaz.

Public browser/server client yalnız Supabase URL ve publishable key kullanır.

## 5. Bilgi mimarisi ve görsel dil

Seçilen düzen sol menülü operasyon panelidir. Menü sırası:

1. Özet
2. Uygulamalar
3. Yorumlar
4. Şikâyetler
5. Kullanıcılar

Seçilen görsel dil koyu operasyondur. Mobil uygulamayla uyumlu koyu nötr yüzeyler, tek yeşil ana vurgu, sarı uyarı ve kırmızı yalnız destructive işlemler için kullanılır. Renkler hard-code edilmez; erişilebilir kontrast sağlayan theme token’larında tanımlanır.

### 5.1 Özet

Özet sayaçları ilgili filtreli listeye bağlanır:

- açık şikâyet sayısı;
- gizli/moderasyon gerektiren yorum sayısı;
- askıya alınmış kullanıcı sayısı;
- draft sürüm sayısı.

“Öncelikli işler” en eski açık şikâyetleri, tamamlanmamış upload/yayın taslaklarını ve son moderasyon işlemlerini gösterir. Dekoratif grafik eklenmez.

### 5.2 Liste ve detay davranışı

- Listeler server-side sayfalama, arama, sıralama ve durum filtresi kullanır.
- Filtreler URL query parametrelerinde kalır.
- Detay ve riskli işlemler ayrı route/panelde açık bağlamla gösterilir.
- Destructive mutation’lar optimistic uygulanmaz.
- Başarı toast ve güncellenmiş kayıtla doğrulanır.
- Hatalar teknik database/Auth ayrıntısı göstermeyen Türkçe mesaj ve retry sunar.

Masaüstü önceliklidir; tablet desteklenir. Telefon görünümünde inceleme yapılabilir. APK yayınlama ve kalıcı kullanıcı silme akışları dar ekranda masaüstü uyarısı gösterir.

## 6. Katalog ve sürüm yönetimi

### 6.1 Kategoriler ve uygulamalar

Admin şunları yönetebilir:

- kategori adı, slug, sıra ve aktiflik;
- uygulama kategori, slug, başlık, kısa/uzun açıklama, icon, featured ve status alanları;
- ekran görüntüleri, alt metin ve sıralama;
- uygulamayı `active` veya `archived` yapma.

Slug, metin uzunluğu, path ve enum kuralları istemci validation’ı yanında mevcut database constraint’leriyle korunur. `download_count` formdan düzenlenmez.

### 6.2 Sürüm durumları

- `draft`: APK hazırlanıyor veya metadata düzenleniyor; public katalogda görünmez.
- `published`: public katalog ve download akışında görünür.
- `withdrawn`: daha önce yayımlanmış fakat geri çekilmiş sürüm; `published_at` korunur.

Published sürüm doğrudan silinmez. Önce withdrawn yapılır. Aynı uygulamada aynı `version_code` oluşturulamaz. Mobil katalog mevcut davranışıyla en yüksek published version code’u güncel sürüm kabul eder.

## 7. APK upload ve yayın pipeline’ı

### 7.1 Upload

- Kabul edilen dosya uzantısı `.apk`’dır.
- MIME allow-list `application/vnd.android.package-archive` ve `application/octet-stream` ile sınırlıdır.
- Başlangıç üst sınırı 500 MiB’dır; Storage bucket migration’ıyla değiştirilebilir.
- Browser dosyayı parçalı okuyarak incremental SHA-256 hesaplar.
- Upload, Vercel function body’sinden geçmez; resumable upload ile doğrudan private `apk-drafts` bucket’ına gider.
- Draft object path admin veya form girdisinden türetilmez; server tarafından oluşturulan upload kimliği/path kullanılır.

Upload wizard adımları:

1. dosya ve sürüm metadata’sı;
2. SHA-256 hesaplama;
3. resumable upload ve ilerleme;
4. doğrulama ve yayın özeti.

Kesilen upload devam ettirilebilir. Sayfadan çıkışta aktif upload uyarısı gösterilir.

### 7.2 Finalize ve yayın

Finalize işlemi:

- authenticated admini yeniden doğrular;
- draft object’ın beklenen path/bucket’ta olduğunu kontrol eder;
- object size ve MIME metadata’sını doğrular;
- dosyanın ilk byte’larında ZIP/APK `PK` magic signature kontrolü yapar;
- app/version ID’lerinden canonical path üretir;
- `app_versions` draft satırını güvenli biçimde oluşturur.

Yayınlama işlemi object’ı canonical `apps/<app-id>/versions/<version-id>.apk` yoluyla public `apks` bucket’ına taşır/kopyalar ve database durumunu published yapar. Storage ile database tek transaction olamadığı için işlem yeniden çalıştırılabilir/idempotent tasarlanır:

- public object hazır fakat DB mutation başarısızsa retry aynı object’ı kullanır;
- DB draft korunur ve yanlışlıkla published görünmez;
- orphan draft/public object’lar admin cleanup listesinde gösterilir;
- hata halinde object veya kayıt sessizce silinmez.

SHA-256 trusted adminin seçtiği source file’dan incremental hesaplanır ve metadata ile saklanır. Otomatik malware veya imza analizi bu teslimatın dışında kalır.

## 8. Moderasyon

### 8.1 Yorumlar

Admin görünür ve gizli yorumları kullanıcı, uygulama, tarih ve puana göre filtreleyebilir.

- `visible → hidden`: public listeden ve puan özetinden çıkarır.
- `hidden → visible`: yeniden public yapar.
- Kalıcı silme yalnız yorum hidden durumundayken ayrı onayla yapılır.

Audit kaydı önceki/yeni moderation status ile hedef review ID’yi taşır; yorum body’si audit metadata’ya kopyalanmaz.

### 8.2 Şikâyetler

Admin açık şikâyetleri uygulama/sürüm, sebep, kullanıcı ve tarihe göre filtreler.

- `open → resolved`
- `open → dismissed`

Her kapanışta kırpılmış, boş olmayan admin notu ve `resolved_at` zorunludur. Kapanmış şikâyetin yeniden açılması MVP’de yoktur; yanlış karar yeni bir explicit follow-up audit işlemiyle düzeltilir.

## 9. Tam Auth kullanıcı yönetimi

Kullanıcı listesi server-side Auth Admin API ve `profiles` verisini birleştirir:

- e-posta ve doğrulama durumu;
- oluşturulma ve son giriş zamanı;
- username, avatar ve profil status;
- ban/askı durumu;
- yorum/şikâyet özet sayıları.

### 9.1 Askıya alma ve aktifleştirme

Askıya alma, Auth ban ve `profiles.status=suspended` işlemlerini koordine eder. İki sistemden biri başarısız olursa kayıt kısmi durum olarak audit/operasyon uyarısında görünür ve idempotent retry sunulur. Aktifleştirme ban’i kaldırır ve profili active yapar.

Mevcut admin kendi hesabını veya son admini askıya alamaz.

### 9.2 Recovery ve doğrulama

Admin kullanıcı parolasını göremez veya doğrudan belirlemez. Yalnız recovery e-postası başlatır. Hosted SMTP sağlıklı değilse bu kontrol disabled olur ve bilinen altyapı sorunu gösterilir. E-posta doğrulamasını adminin doğrudan doğru kabul etmesi MVP kapsamı dışındadır.

### 9.3 Kalıcı silme

Kalıcı silme için:

1. hedef admin değildir;
2. hedef daha önce suspended durumuna alınmıştır;
3. admin hedef username’i elle yazar;
4. arayüz bağlı profil/yorum/şikâyet verilerinin geri alınamayacağını açıklar;
5. Auth Admin API hard delete çağrısı yapılır;
6. avatar cleanup best-effort uygulanır;
7. audit satırı FK olmadan target UUID’yi korur.

Silme işlemi geri alınamaz. Audit log şifre, token, e-posta içeriği veya silinen topluluk metinlerini saklamaz.

## 10. Audit modeli

Yeni `admin_audit_logs` tablosu en az şu alanları içerir:

- `id uuid primary key`
- `actor_id uuid not null`
- `action text/enum not null`
- `target_type text/enum not null`
- `target_id text not null`
- `metadata jsonb not null default '{}'`
- `created_at timestamptz not null default now()`

Audit log istemci rollerine insert/update/delete açmaz. Satırlar yalnız güvenilir server mutation’ından yazılır; update/delete grant verilmez. Aktör kimliği server-side doğrulanmış session’dan alınır. Metadata allow-list ile oluşturulur ve secret/kişisel içerik taşımaz.

İlk aksiyon seti:

- app create/update/archive
- version draft/publish/withdraw
- review hide/show/delete
- report resolve/dismiss
- user suspend/activate/delete/recovery-request

## 11. Erişilebilirlik ve güvenli etkileşim

- Semantik heading, nav, table, form ve button yapıları kullanılır.
- Bütün işlemler klavye ile tamamlanabilir.
- Focus görünürdür ve modal/panel açılış-kapanışında doğru taşınır.
- Form submit hataları alanla ilişkilendirilir ve özet bağlantısı sunar.
- Status yalnız renkle anlatılmaz; metin etiketi bulunur.
- Upload ilerlemesi screen reader için duyurulur.
- Destructive onaylar varsayılan focus’u tehlikeli butona vermez.
- Loading skeleton içeriğin yapısını taklit eder; sonsuz spinner kullanılmaz.

## 12. Hata yönetimi ve gözlemlenebilirlik

Server hataları istemciye sanitize edilmiş kod/mesaj döndürür. Supabase internal message, SQL, policy adı, secret, JWT veya SMTP credential gösterilmez.

Loglar şunları içerir:

- request/correlation ID;
- operation adı;
- actor UUID;
- target türü/UUID;
- başarı/hata sınıfı ve süre.

Loglar parola, token, secret, APK içeriği, yorum body’si veya şikâyet açıklaması içermez. Kullanıcıya retry verilebilen geçici hata ile validation/authorization hatası ayrılır.

Upload ve çok adımlı Auth işlemleri idempotent operation ID kullanır. Kısmi durumlar dashboard operasyon uyarısına düşer.

## 13. Test stratejisi

### Database/pgTAP

- kullanıcı yalnız kendi `user_roles` kaydını okuyabilir;
- non-admin admin tablolarını veya Storage draft’larını yönetemez;
- audit satırları API rollerince değiştirilemez;
- 500 MiB/MIME/bucket/path kuralları uygulanır;
- report resolution ve version publication invariant’ları korunur;
- mevcut mobil RLS davranışı gerilemez.

### Unit ve component

- form validator’ları ve normalize davranışları;
- state transition ve path üretimi;
- hata sanitizasyonu;
- login/admin gate;
- filtreli listeler ve URL state;
- destructive confirmation;
- upload hash/progress/retry;
- keyboard ve accessible name davranışları.

### Server/DAL

- signed-out, non-admin ve doğrudan Server Action çağrısı reddedilir;
- service client admin doğrulamasından önce kullanılmaz;
- self/last-admin suspend-delete engellenir;
- audit başarılı mutation ile üretilir;
- partial Auth/profile ve Storage/DB failure retry edilir.

### Playwright

- admin login/logout;
- uygulama ve draft sürüm oluşturma;
- APK upload/finalize/publish;
- yorum hide/show;
- şikâyet resolve/dismiss;
- kullanıcı suspend/activate;
- silme bariyerleri.

Release gate: admin unit/component/E2E, typecheck, lint, Next production build, full pgTAP, Supabase advisor ve migration dry-run.

## 14. Vercel ve ortamlar

Vercel projesi `admin` root directory’sini kullanır.

Production environment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY` (encrypted secret)

Preview deployment production veritabanına mutation yapmaz. İlk tercih ayrı Supabase preview branch’tir; bu yoksa preview ortamı read-only feature flag ile açılır ve mutation action’ları server tarafında reddedilir.

Production deploy sırası:

1. local migration ve pgTAP;
2. generated type eşitliği;
3. hosted project-ref doğrulama;
4. migration list ve dry-run;
5. açık onayla migration push;
6. Vercel production env kontrolü;
7. production deploy;
8. fiziksel smoke test ve audit doğrulama.

## 15. Geri dönüş ve operasyon

- Web hatasında Vercel önceki deployment’a döndürülür.
- Migration’lar destructive değildir; schema rollback yerine forward-fix uygulanır.
- Published sürüm geri çekme `withdrawn` durumuyla yapılır; APK hemen kalıcı silinmez.
- Draft temizliği manuel ve audit’li başlar; otomatik cron MVP dışında kalır.
- Kalıcı kullanıcı silme geri alınamaz.
- Service secret rotate edilirse Vercel env güncellenir ve yeniden deploy edilir.

## 16. Teslimat aşamaları

1. **Admin auth ve güvenlik temeli:** Next.js uygulaması, SSR session, `requireAdmin`, self-role RLS, server-only client, audit tablosu.
2. **Katalog ve APK pipeline:** kategori/app CRUD, screenshots, draft/resumable upload, finalize, publish/withdraw.
3. **Moderasyon:** yorum görünürlüğü/silme ve şikâyet çözümü.
4. **Tam Auth yönetimi:** liste, suspend/activate, recovery ve güvenli hard delete.
5. **Release:** E2E, full regression, hosted migration, Vercel production deploy ve runbook.

Her aşama kendi hedefli testleri ve full relevant gate’i geçmeden sonraki aşamaya ilerlemez.
