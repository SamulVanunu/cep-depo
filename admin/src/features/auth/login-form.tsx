'use client';

import { useActionState } from 'react';

import { loginAction } from '../../../app/(auth)/login/actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  const actionError = state?.ok === false ? state.error : null;
  const errorId = actionError ? 'login-error' : undefined;

  return (
    <form action={action} className="login-form" noValidate>
      {actionError ? (
        <div className="form-error" id={errorId} role="alert">
          {actionError.message}
        </div>
      ) : null}

      <label className="field">
        <span>E-posta</span>
        <input
          aria-describedby={errorId}
          autoComplete="email"
          autoFocus
          inputMode="email"
          name="email"
          required
          type="email"
        />
      </label>

      <label className="field">
        <span>Şifre</span>
        <input
          aria-describedby={errorId}
          autoComplete="current-password"
          minLength={8}
          name="password"
          required
          type="password"
        />
      </label>

      <button className="primary-button" disabled={pending} type="submit">
        {pending ? 'Giriş yapılıyor…' : 'Giriş yap'}
      </button>
    </form>
  );
}
