'use client';

import { LoginOutlined, UserAddOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { register, storeToken } from '../lib/auth-api';

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const result = await register({
        username,
        password,
        inviteCode: inviteCode.trim() || undefined
      });
      storeToken(result.token);
      router.push('/account');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '注册失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <div className="auth-brand">
          <span className="shell-logo-mark">R</span>
          <span>Relay Console</span>
        </div>
        <h1>注册账户</h1>
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
              autoComplete="new-password"
              maxLength={128}
              minLength={8}
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          <label>
            邀请码
            <input
              autoComplete="off"
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="可选"
              value={inviteCode}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" disabled={isSubmitting} type="submit">
            <UserAddOutlined />
            {isSubmitting ? '注册中' : '注册并进入账户'}
          </button>
        </form>
        <Link className="secondary-link" href="/login">
          <LoginOutlined />
          已有账户，去登录
        </Link>
      </section>
    </main>
  );
}
