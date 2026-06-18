'use client';

import {
  GiftOutlined,
  ReloadOutlined,
  WalletOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ConsoleShell } from '../../../components/console-shell';
import { getProfile, logout } from '../../../lib/auth-api';
import type { PublicUser } from '../../../lib/auth-api';
import {
  listRechargeRecords,
  redeemRechargeCode
} from '../../../lib/recharge-api';
import type { RechargeRecord } from '../../../lib/recharge-api';

export default function RechargePage() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [records, setRecords] = useState<RechargeRecord[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRedeeming, setIsRedeeming] = useState(false);

  useEffect(() => {
    void loadRechargeData();
  }, [router]);

  async function loadRechargeData() {
    setIsLoading(true);
    setError('');

    try {
      const [profileResult, recordResult] = await Promise.all([
        getProfile(),
        listRechargeRecords()
      ]);
      setUser(profileResult.user);
      setRecords(recordResult.items);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '充值数据加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleRedeem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsRedeeming(true);

    try {
      const result = await redeemRechargeCode({ code });
      setCode('');
      setMessage(`已充值 ${formatCents(result.transaction.amountCents)}`);
      await loadRechargeData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '兑换码核销失败');
    } finally {
      setIsRedeeming(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <ConsoleShell
      activePath="/account/topup/recharge"
      isRefreshing={isLoading}
      onLogout={() => void handleLogout()}
      onRefresh={() => void loadRechargeData()}
      username={user?.username ?? null}
    >
      <section className="console-content-grid">
        <div className="account-panel account-summary">
          <div>
            <p className="eyebrow">余额充值</p>
            <h1>{isLoading ? '加载中' : formatCents(user?.wallet.balanceCents ?? 0)}</h1>
          </div>
          <button className="icon-button" onClick={() => void loadRechargeData()} title="刷新充值数据" type="button">
            <ReloadOutlined />
          </button>
        </div>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <GiftOutlined />
            <h2>兑换码</h2>
          </div>
          <form className="auth-form compact-form" onSubmit={handleRedeem}>
            <label>
              兑换码
              <input
                autoComplete="off"
                maxLength={48}
                minLength={8}
                onChange={(event) => setCode(event.target.value)}
                required
                value={code}
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            {message ? <p className="form-success">{message}</p> : null}
            <button className="primary-button" disabled={isRedeeming} type="submit">
              <GiftOutlined />
              {isRedeeming ? '核销中' : '核销兑换码'}
            </button>
          </form>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <WalletOutlined />
            <h2>充值记录</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table recharge-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>金额</th>
                  <th>充值后余额</th>
                  <th>状态</th>
                  <th>流水</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.createdAt).toLocaleString()}</td>
                    <td>{formatCents(record.amountCents)}</td>
                    <td>{formatCents(record.balanceAfterCents)}</td>
                    <td>{record.status}</td>
                    <td>{record.id}</td>
                  </tr>
                ))}
                {!records.length && !isLoading ? (
                  <tr>
                    <td colSpan={5}>暂无充值记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </ConsoleShell>
  );
}

function formatCents(value: number) {
  return `$${(value / 100).toFixed(2)}`;
}
