'use client';

import { useActionState } from 'react';

import type { ActionResult } from '../../server/errors/action-error';
import {
  createAppAction,
  type CatalogMutationData,
  updateAppAction,
} from './app-actions';
import type { CategoryOption } from './app-dal';

type EditableApp = Readonly<{
  id: string;
  category_id: string;
  slug: string;
  title: string;
  short_description: string;
  description: string;
  featured: boolean;
  status: 'active' | 'archived';
}>;

export function AppForm({
  categories,
  app,
}: Readonly<{ categories: readonly CategoryOption[]; app?: EditableApp }>) {
  const action = app ? updateAppAction.bind(null, app.id) : createAppAction;
  const [state, formAction, pending] = useActionState<
    ActionResult<CatalogMutationData> | null,
    FormData
  >(action, null);
  const error = state?.ok === false ? state.error : null;
  const success = state?.ok === true ? state.data : null;

  return (
    <form action={formAction} className="record-form" noValidate>
      {error ? <div className="form-error" role="alert">{error.message}</div> : null}
      {success ? (
        <div className={success.auditWarning ? 'form-warning' : 'form-success'} role="status">
          {success.auditWarning
            ? 'Kayıt güncellendi; audit kaydı geçici olarak tamamlanamadı.'
            : 'Kayıt başarıyla güncellendi.'}
        </div>
      ) : null}

      <div className="form-grid">
        <label className="field">
          <span>Kategori</span>
          <select defaultValue={app?.category_id} name="categoryId" required>
            <option value="">Kategori seç</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>{category.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Slug</span>
          <input defaultValue={app?.slug} maxLength={120} name="slug" required />
        </label>
        <label className="field form-grid-span">
          <span>Başlık</span>
          <input defaultValue={app?.title} maxLength={90} minLength={2} name="title" required />
        </label>
        <label className="field form-grid-span">
          <span>Kısa açıklama</span>
          <textarea defaultValue={app?.short_description} maxLength={180} minLength={10} name="shortDescription" required rows={3} />
        </label>
        <label className="field form-grid-span">
          <span>Açıklama</span>
          <textarea defaultValue={app?.description} maxLength={5000} minLength={10} name="description" required rows={10} />
        </label>
        <label className="field">
          <span>Durum</span>
          <select defaultValue={app?.status ?? 'active'} name="status">
            <option value="active">Aktif</option>
            <option value="archived">Arşivlenmiş</option>
          </select>
        </label>
        <label className="check-field">
          <input defaultChecked={app?.featured} name="featured" type="checkbox" />
          <span>Öne çıkar</span>
        </label>
      </div>

      <button className="primary-button" disabled={pending || categories.length === 0} type="submit">
        {pending ? 'Kaydediliyor…' : app ? 'Değişiklikleri kaydet' : 'Uygulama oluştur'}
      </button>
    </form>
  );
}
