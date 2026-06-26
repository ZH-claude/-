'use client';

import { LoginOutlined, UserAddOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { LanguageSwitcher } from '../components/language-switcher';
import { useI18n } from '../components/language-provider';
import { getAuthFlowCopy } from '../lib/auth-flow-copy';
import { register } from '../lib/auth-api';

export default function RegisterPage() {
  const router = useRouter();
  const { language, t } = useI18n();
  const authCopy = getAuthFlowCopy(language);
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      await register({
        username,
        phoneNumber: phoneNumber.trim() || undefined,
        password
      }, language);
      router.push('/account/profile');
    } catch {
      setError(t('auth.registerFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-panel-head">
          <div className="auth-brand">
            <img alt="" aria-hidden="true" className="shell-logo-image" src="/brand-mark.svg" />
            <span>{t('auth.registerBrand')}</span>
          </div>
          <LanguageSwitcher variant="auth" />
        </div>
        <h1>{t('auth.registerTitle')}</h1>
        <form className="auth-form" data-qa="register-form" onSubmit={handleSubmit}>
          <label>
            {t('auth.username')}
            <input
              autoComplete="username"
              data-qa="register-username"
              maxLength={32}
              minLength={3}
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </label>
          <label>
            {authCopy.optionalPhoneNumber}
            <input
              autoComplete="tel"
              data-qa="register-phone-number"
              maxLength={18}
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="+8613800138000"
              value={phoneNumber}
            />
          </label>
          <label>
            {t('auth.password')}
            <input
              autoComplete="new-password"
              data-qa="register-password"
              maxLength={128}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="form-error" data-qa="register-error">{error}</p> : null}
          <button className="primary-button" data-qa="register-submit" disabled={isSubmitting} type="submit">
            <UserAddOutlined />
            {isSubmitting ? t('auth.registerSubmitting') : t('auth.registerSubmit')}
          </button>
        </form>
        <Link className="secondary-link" href="/login">
          <LoginOutlined />
          {t('auth.toLogin')}
        </Link>
      </section>
    </main>
  );
}
