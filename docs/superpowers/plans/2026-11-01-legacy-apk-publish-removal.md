# P0-2 — Legacy APK yayınlama yolunun kaldırılması

## Amaç

`admin_publish_version_replacing_previous` tek yayınlama yolu olsun. Legacy
server action ve iki legacy RPC tamamen kalksın; hiçbir istemci, UI olmadan
bu uçları çağırarak yayın kurallarını atlayamasın.

## Envanter (uygulama öncesi doğrulandı)

| Giriş | Durum | Karar |
|---|---|---|
| `publishVersionAction` (server action) | UI çağıranı yok, endpoint açık | kaldır |
| `publishVersion` (aynı `'use server'` dosyasında export) | action kaydı var, argümanı serileşmez | kaldır |
| `admin_publish_version(uuid, uuid)` | yalnız `service_role`; zayıf kurallar | drop |
| `admin_publish_version_and_activate_app(uuid, uuid)` | yalnız `service_role`; taban RPC'yi çağırır | drop |
| `publishVersionReplacingPreviousAction` | wizard'ın tek çağrısı | koru |
| `admin_publish_version_replacing_previous` | tam denetimli | tek yol |
| `publishVersionReplacingPrevious` / `withdrawVersion` (servis export) | action olarak da kayıtlı | `version-service.ts`'e taşı |

Overload kontrolü: iki legacy fonksiyonun tek imzası var (`uuid, uuid`);
`create or replace` ile son tanımları `20261014100315_external_apk_sources.sql`
ve `20261012123000_admin_default_category.sql`. Başka çağıran yok
(`grep` ile SQL, TS, e2e, script tarandı).

## Adımlar

### 1. Baseline

- [x] `git status --porcelain` ve `HEAD` kaydı; kullanıcı değişikliklerine dokunma.

### 2. RED — action yüzeyi

- [x] `version-actions.surface.test.ts`: `version-actions` modülünün yalnız
  `publishVersionReplacingPreviousAction` ve `withdrawVersionAction`
  export ettiğini doğrula; `publishVersion`, `publishVersionAction`,
  `publishVersionReplacingPrevious`, `withdrawVersion` yok.
- [x] Testi çalıştır, legacy export'lar yüzünden kırmızı olduğunu gör.

### 3. GREEN — servis/action ayrımı

- [x] `version-service.ts`: `publishVersionReplacingPrevious`, `withdrawVersion`,
  tipler, `refreshCatalogWarning`, `cleanupAssetsFromRpc`, default dependency
  factory'leri.
- [x] `version-actions.ts`: `'use server'` + iki ince action wrapper.
- [x] `publishVersion`, `PublishDependencies`, `defaultPublishDependencies`
  silinir.
- [x] Yüzey testi yeşil.

### 4. Test geçişi

- [x] Legacy `describe('publishVersion')` bloklarını sil.
- [x] Dış kaynak happy-path ve katalog yenileme testlerini replacement'a taşı.
- [x] Withdraw ve replacement testleri aynen kalsın.

### 5. SQL testleri

- [x] `admin_panel_transitions.test.sql`: legacy blok (13 assertion) çıkar,
  `plan(25)` → `plan(17)`.
- [x] `external_apk_sources.test.sql`: yayın çağrısı replacement'a çevrilir;
  fixture'a `icon_path` ve `package_name` eklenir.
- [x] Yeni `legacy_publish_removed.test.sql`: iki imza `to_regprocedure … is null`;
  `published` yazan tek `public` fonksiyon replacement; yetki kontrolleri.

### 6. Migration

- [x] `20261106130000_drop_legacy_publish_functions.sql`:
  önce `admin_publish_version_and_activate_app`, sonra
  `admin_publish_version` drop. Uygulanmaz.
  (Commit 2'ye hazırlık için `20261101210000` → `20261106130000` yeniden damgalandı.)

### 7. Database types

- [x] İki `database.types.ts` dosyasından legacy RPC girdilerini çıkar.
  Elle düzenleme raporlanır.

### 8. Doğrulama

- [x] `npx vitest run src/features/uploads` (regresyon)
- [x] `npx vitest run src/features/versions`
- [x] `npm test` (admin)
- [x] `npm run typecheck`, `npm run lint`, `npm run build` (admin)
- [x] `npm test` (kök)
- [x] pgTAP: ortam yoksa çalıştırılmadı olarak raporla. (Docker daemon ve
  Supabase CLI yok; migration hiçbir veritabanına uygulanmadı, bu yüzden
  SQL testleri yazıldı ama **çalıştırılmadı**.)

## Sonuç

- Admin: 54 dosya / 575 test geçti; `typecheck` temiz; `lint` 0 hata
  (2 önceden var olan uyarı, `catalog-json.test.ts`).
- Admin `build` başarılı.
- Kök: 53 suite / 453 test geçti; `typecheck` ve `lint` temiz.
- `git status` farkı yalnızca bu planın dosyaları: 2 değişen SQL testi,
  5 yeni dosya. Başlangıçta var olan 115 değişik/yeni dosyaya dokunulmadı.

## Kapsam dışı

- `withdrawVersionAction` (yayın değil; UI'sız ama meşru işlem).
- Publish anında APK'nın yeniden ayrıştırılması (P0-1 kararı).
- Dış APK URL doğrulamasının ötesi (P0-1 sınırı).
- `'use server'` dosyalarındaki aynı desenin diğer modüller için toplu düzeltmesi.

## Riskler

- `drop` geri alınamaz; rollback eski migration'ı yeniden uygulamaktır.
- Dağıtım sırasında eski instance legacy RPC'yi çağırırsa `TEMPORARY` ile
  kapalı yönde başarısız olur.
- Elle düzenlenen generated types, `supabase gen types` çalışana kadar drift.
- pgTAP bu ortamda çalışmıyor (Docker/Supabase CLI yok).
