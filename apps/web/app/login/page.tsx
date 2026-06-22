'use client';

import { LoginOutlined, UserAddOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { login } from '../lib/auth-api';
import { getPostLoginPath } from '../lib/role-routing';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await login({ username, password });
      router.push(getPostLoginPath(result.user));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '登录失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <img alt="" aria-hidden="true" className="shell-logo-image" src="/brand-mark.svg" />
          <span>蔚蓝星球中转站登录</span>
        </div>
        <h1>登录账户</h1>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            用户名
            <input
              autoComplete="username"
              maxLength={32}
              minLength={3}
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </label>
          <label>
            密码
            <input
              autoComplete="current-password"
              maxLength={128}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" disabled={isSubmitting} type="submit">
            <LoginOutlined />
            {isSubmitting ? '登录中' : '登录'}
          </button>
        </form>
        <Link className="secondary-link" href="/register">
          <UserAddOutlined />
          注册新账户
        </Link>
      </section>
    </main>
  );
}
