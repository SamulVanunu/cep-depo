'use client';

import { useActionState } from 'react';

import type { ActionResult } from '../../server/errors/action-error';
import {
  createCategoryAction,
  type CatalogMutationData,
  updateCategoryAction,
} from './app-actions';
import type { CategoryOption } from './app-dal';

function CategoryForm({ category }: Readonly<{ category?: CategoryOption }>) {
  const action = category ? updateCategoryAction.bind(null, category.id) : createCategoryAction;
  const [state, formAction, pending] = useActionState<
    ActionResult<CatalogMutationData> | null,
    FormData
  >(action, null);

  return (
    <form action={formAction} className="category-row">
      <label className="visually-hidden" htmlFor={`category-name-${category?.id ?? 'new'}`}>Kategori adı</label>
      <input defaultValue={category?.name} id={`category-name-${category?.id ?? 'new'}`} name="name" placeholder="Kategori adı" required />
      <label className="visually-hidden" htmlFor={`category-slug-${category?.id ?? 'new'}`}>Kategori slug</label>
      <input defaultValue={category?.slug} id={`category-slug-${category?.id ?? 'new'}`} name="slug" placeholder="kategori-slug" required />
      <label className="visually-hidden" htmlFor={`category-position-${category?.id ?? 'new'}`}>Sıra</label>
      <input defaultValue={category?.position ?? 0} id={`category-position-${category?.id ?? 'new'}`} min={0} name="position" type="number" />
      <label className="check-field compact-check">
        <input defaultChecked={category?.isActive ?? true} name="isActive" type="checkbox" />
        <span>Aktif</span>
      </label>
      <button className="secondary-button" disabled={pending} type="submit">
        {category ? 'Güncelle' : 'Ekle'}
      </button>
      {state?.ok === false ? <span className="inline-error" role="alert">{state.error.message}</span> : null}
    </form>
  );
}

export function CategoryManager({ categories }: Readonly<{ categories: readonly CategoryOption[] }>) {
  return (
    <section aria-labelledby="categories-heading" className="panel-section">
      <div className="section-heading">
        <div>
          <h2 id="categories-heading">Kategoriler</h2>
          <p className="muted">Ad, slug, sıralama ve katalog görünürlüğünü yönet.</p>
        </div>
      </div>
      <div className="category-list">
        <CategoryForm />
        {categories.map(category => <CategoryForm category={category} key={category.id} />)}
      </div>
    </section>
  );
}
