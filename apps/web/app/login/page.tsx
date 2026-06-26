'use client';

import { LoginOutlined, PhoneOutlined, UserAddOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { LanguageSwitcher } from '../components/language-switcher';
import { useI18n } from '../components/language-provider';
import { getAuthFlowCopy } from '../lib/auth-flow-copy';
import { login, phoneLogin, requestPasswordRecovery, resetPasswordByPhone } from '../lib/auth-api';
import { getPostLoginPath } from '../lib/role-routing';

export default function LoginPage() {
  const router = useRouter();
  const { language, t } = useI18n();
  const authCopy = getAuthFlowCopy(language);
  const [loginMode, setLoginMode] = useState<'username' | 'phone'>('username');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryDebugCode, setRecoveryDebugCode] = useState('');
  const [error, setError] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecoverySubmitting, setIsRecoverySubmitting] = useState(false);
  const [recoveryRequested, setRecoveryRequested] = useState(false);

  function clearRecoveryState() {
    setRecoveryRequested(false);
    setRecoveryMessage('');
    setRecoveryDebugCode('');
    setVerificationCode('');
    setRecoveryPassword('');
    setError('');
  }

  function switchMode(nextMode: 'username' | 'phone') {
    setLoginMode(nextMode);
    clearRecoveryState();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = loginMode === 'phone'
        ? await phoneLogin({ phoneNumber, password }, language)
        : await login({ username, password }, language);
      router.push(getPostLoginPath(result.user));
    } catch {
      setError(t('auth.loginFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handlePasswordRecovery() {
    const recoveryPhone = phoneNumber.trim();
    if (!recoveryPhone) {
      setError(authCopy.enterPhoneFirst);
      return;
    }

    setError('');
    setRecoveryMessage('');
    setRecoveryDebugCode('');
    setIsRecoverySubmitting(true);

    try {
      const result = await requestPasswordRecovery({ phoneNumber: recoveryPhone }, language);
      if (!result.ok) {
        setError(authCopy.sendVerificationCodeFailed);
        return;
      }
      setRecoveryRequested(true);
      setRecoveryMessage(authCopy.recoveryCodeSent);
      setRecoveryDebugCode(result.debugCode ?? '');
      setVerificationCode('');
      setRecoveryPassword('');
    } catch {
      setError(authCopy.passwordRecoveryRequestFailed);
    } finally {
      setIsRecoverySubmitting(false);
    }
  }

  async function handlePasswordReset() {
    const recoveryPhone = phoneNumber.trim();
    if (!recoveryPhone) {
      setError(authCopy.enterPhoneFirst);
      return;
    }
    if (!verificationCode.trim()) {
      setError(authCopy.enterVerificationCode);
      return;
    }
    if (!recoveryPassword.trim()) {
      setError(authCopy.enterNewPassword);
      return;
    }

    setError('');
    setRecoveryMessage('');
    setIsRecoverySubmitting(true);

    try {
      const result = await resetPasswordByPhone({
        phoneNumber: recoveryPhone,
        verificationCode: verificationCode.trim(),
        newPassword: recoveryPassword
      }, language);
      if (!result.ok) {
        setError(authCopy.passwordResetFailed);
        return;
      }

      setRecoveryRequested(false);
      setRecoveryMessage(authCopy.passwordResetSuccessful);
      setRecoveryPassword('');
      setVerificationCode('');
    } catch {
      setError(authCopy.passwordResetFailed);
    } finally {
      setIsRecoverySubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-panel-head">
          <div className="auth-brand">
            <img alt="" aria-hidden="true" className="shell-logo-image" src="/brand-mark.svg" />
            <span>{t('auth.loginBrand')}</span>
          </div>
          <LanguageSwitcher variant="auth" />
        </div>
        <h1>{t('auth.loginTitle')}</h1>
        <form className="auth-form" data-qa="login-form" onSubmit={handleSubmit}>
          <div className="segmented-control">
            <button
              className={loginMode === 'username' ? 'active' : ''}
              data-qa="login-username-mode"
              onClick={() => switchMode('username')}
              type="button"
            >
              {t('auth.username')}
            </button>
            <button
              className={loginMode === 'phone' ? 'active' : ''}
              data-qa="login-phone-mode"
              onClick={() => switchMode('phone')}
              type="button"
            >
              <PhoneOutlined />
              {authCopy.phone}
            </button>
          </div>
          <label>
            {loginMode === 'phone' ? authCopy.phoneNumber : t('auth.username')}
            {loginMode === 'phone' ? (
              <input
                autoComplete="tel"
                data-qa="login-phone-number"
                maxLength={18}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="+8613800138000"
                required
                value={phoneNumber}
              />
            ) : (
              <input
                autoComplete="username"
                data-qa="login-username"
                maxLength={32}
                minLength={3}
                onChange={(event) => setUsername(event.target.value)}
                required
                value={username}
              />
            )}
          </label>
          {loginMode === 'phone' && recoveryRequested ? (
            <>
              <label>
                {authCopy.verificationCode}
                <input
                  autoComplete="one-time-code"
                  data-qa="login-recovery-code"
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(event) => setVerificationCode(event.target.value)}
                  required
                  value={verificationCode}
                />
              </label>
              <label>
                {authCopy.newPassword}
                <input
                  autoComplete="new-password"
                  data-qa="login-recovery-new-password"
                  maxLength={128}
                  minLength={8}
                  onChange={(event) => setRecoveryPassword(event.target.value)}
                  required
                  type="password"
                  value={recoveryPassword}
                />
              </label>
              {recoveryDebugCode ? <p className="form-success" data-qa="login-recovery-debug-code">{authCopy.debugCode}: {recoveryDebugCode}</p> : null}
              <button className="primary-button" data-qa="login-recovery-reset" disabled={isRecoverySubmitting} type="button" onClick={() => void handlePasswordReset()}>
                {isRecoverySubmitting ? authCopy.resetting : authCopy.resetPassword}
              </button>
              <button
                className="ghost-button"
                data-qa="login-recovery-resend"
                disabled={isRecoverySubmitting}
                onClick={() => void handlePasswordRecovery()}
                type="button"
              >
                {authCopy.resendVerificationCode}
              </button>
              <button
                className="ghost-button"
                data-qa="login-recovery-return"
                onClick={() => {
                  setRecoveryRequested(false);
                  setRecoveryMessage('');
                  setRecoveryDebugCode('');
                }}
                type="button"
              >
                {authCopy.returnToSignIn}
              </button>
            </>
          ) : (
            <>
              <label>
                {t('auth.password')}
                <input
                  autoComplete="current-password"
                  data-qa="login-password"
                  maxLength={128}
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
              <button className="primary-button" data-qa="login-submit" disabled={isSubmitting} type="submit">
                <LoginOutlined />
                {isSubmitting ? t('auth.loginSubmitting') : t('auth.loginSubmit')}
              </button>
              {loginMode === 'phone' ? (
                <button
                  className="ghost-button"
                  data-qa="login-recovery-request"
                  disabled={isRecoverySubmitting}
                  onClick={() => void handlePasswordRecovery()}
                  type="button"
                >
                  {isRecoverySubmitting ? authCopy.requestingCode : authCopy.requestPasswordRecovery}
                </button>
              ) : null}
            </>
          )}
          {error ? <p className="form-error" data-qa="login-error">{error}</p> : null}
          {recoveryMessage ? <p className="form-success" data-qa="login-recovery-message">{recoveryMessage}</p> : null}
        </form>
        <Link className="secondary-link" href="/register">
          <UserAddOutlined />
          {t('auth.registerLink')}
        </Link>
      </section>
    </main>
  );
}
