'use client';

import { useActionState } from 'react';

import type { ActionResult } from '../../server/errors/action-error';
import {
  type CatalogMutationData,
  setAppStatusFormAction,
} from './app-actions';

export function AppStatusPanel({ appId, status }: Readonly<{
  appId: string;
  status: 'active' | 'archived';
}>) {
  const nextStatus = status === 'active' ? 'archived' : 'active';
  const [state, action, pending] = useActionState<
    ActionResult<CatalogMutationData> | null,
    FormData
  >(setAppStatusFormAction.bind(null, appId, nextStatus), null);

  return (
    <section aria-labelledby="status-heading" className={nextStatus === 'archived' ? 'danger-panel' : 'panel-section'}>
      <h2 id="status-heading">{nextStatus === 'archived' ? 'Uygulamayı arşivle' : 'Uygulamayı yeniden etkinleştir'}</h2>
      <p className="muted">
        {nextStatus === 'archived'
          ? 'Arşivlenen uygulama public katalogda gösterilmez. Bu işlem silme değildir.'
          : 'Uygulama yeniden katalogda görünür duruma gelir.'}
      </p>
      <form action={action}>
        <button className={nextStatus === 'archived' ? 'danger-button' : 'primary-button'} disabled={pending} type="submit">
          {pending ? 'İşleniyor…' : nextStatus === 'archived' ? 'Arşivlemeyi onayla' : 'Etkinleştir'}
        </button>
      </form>
      {state?.ok === false ? <p className="inline-error" role="alert">{state.error.message}</p> : null}
    </section>
  );
}
