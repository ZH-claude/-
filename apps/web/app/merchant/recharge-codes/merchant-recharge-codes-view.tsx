'use client';

import {
  CopyOutlined,
  GiftOutlined,
  ReloadOutlined,
  StopOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  createRechargeCodes,
  disableRechargeCode,
  listRechargeCodes,
  type AdminRechargeCode,
  type CreatedRechargeCode
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';

export function MerchantRechargeCodesView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [codes, setCodes] = useState<AdminRechargeCode[]>([]);
  const [createdCodes, setCreatedCodes] = useState<CreatedRechargeCode[]>([]);
  const [amountCents, setAmountCents] = useState('1000');
  const [count, setCount] = useState('1');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadCodes();
  }, []);

  const stats = useMemo(() => {
    return codes.reduce(
      (current, entry) => ({
        total: current.total + 1,
        unused: current.unused + (entry.status === 'unused' ? 1 : 0),
        used: current.used + (entry.status === 'used' ? 1 : 0),
        disabled: current.disabled + (entry.status === 'disabled' ? 1 : 0)
      }),
      { total: 0, unused: 0, used: 0, disabled: 0 }
    );
  }, [codes]);

  async function loadCodes() {
    setIsLoading(true);
    setError('');

    try {
      const result = await listRechargeCodes();
      setCodes(result.items);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '充值码数据加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setCreatedCodes([]);
    setIsCreating(true);

    try {
      const result = await createRechargeCodes({
        amountCents: Number(amountCents),
        count: Number(count)
      });
      setCreatedCodes(result.items);
      setCount('1');
      setMessage(`已生成 ${result.items.length} 张充值码，明文只在本次页面状态中显示`);
      await loadCodes();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '充值码生成失败');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDisable(codeId: string) {
    setError('');
    setMessage('');
    setDisablingId(codeId);

    try {
      await disableRechargeCode(codeId);
      setMessage('未使用充值码已禁用');
      await loadCodes();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '充值码禁用失败');
    } finally {
      setDisablingId(null);
    }
  }

  async function handleCopyAll() {
    const text = createdCodes.map((entry) => entry.code).join('\n');
    await navigator.clipboard.writeText(text);
    setMessage('本次生成的充值码已复制');
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <MerchantShell
      activePath="/merchant/recharge-codes"
      isRefreshing={isLoading}
      onLogout={handleLogout}
      onRefresh={() => void loadCodes()}
      role={role}
      username={username}
    >
      <section className="admin-content merchant-recharge-page">
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>充值码管理</h1>
            <small>生成、查看状态和禁用未使用充值码；列表不返回明文码和 hash。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadCodes()} title="刷新充值码" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="充值码总数" value={formatNumber(stats.total)} detail="最近 100 条真实记录" />
          <MetricPanel label="未使用" value={formatNumber(stats.unused)} detail="可兑换余额" tone="green" />
          <MetricPanel label="已使用" value={formatNumber(stats.used)} detail="已完成入账" />
          <MetricPanel label="已禁用" value={formatNumber(stats.disabled)} detail="不可再兑换" tone="red" />
        </section>

        <section className="admin-panel">
          <div className="panel-title">
            <GiftOutlined />
            <h2>生成充值码</h2>
          </div>
          <form className="auth-form mapping-form" onSubmit={handleCreate}>
            <label>
              金额（分）
              <input
                min="1"
                max="100000000"
                onChange={(event) => setAmountCents(event.target.value)}
                required
                step="1"
                type="number"
                value={amountCents}
              />
            </label>
            <label>
              数量
              <input
                min="1"
                max="100"
                onChange={(event) => setCount(event.target.value)}
                required
                step="1"
                type="number"
                value={count}
              />
            </label>
            <button className="primary-button" disabled={isCreating} type="submit">
              <GiftOutlined />
              {isCreating ? '生成中' : '生成充值码'}
            </button>
          </form>

          {createdCodes.length ? (
            <div className="one-time-key-box recharge-code-box">
              <div>
                <strong>本次生成，仅显示一次</strong>
                {createdCodes.map((entry) => (
                  <code key={entry.id}>{entry.code}</code>
                ))}
              </div>
              <button className="ghost-button compact-button" onClick={() => void handleCopyAll()} type="button">
                <CopyOutlined />
                复制全部
              </button>
            </div>
          ) : null}
        </section>

        <section className="admin-panel">
          <div className="panel-title">
            <GiftOutlined />
            <h2>充值码状态</h2>
          </div>
          <div className="admin-table-wrap compact-table">
            <table className="admin-table recharge-code-table">
              <thead>
                <tr>
                  <th>金额</th>
                  <th>状态</th>
                  <th>创建人</th>
                  <th>使用人</th>
                  <th>使用时间</th>
                  <th>交易</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatMoney(entry.amountCents)}</td>
                    <td>
                      <span className={`status-pill ${getRechargeStatusClass(entry.status)}`}>
                        {entry.status}
                      </span>
                    </td>
                    <td>{entry.createdBy ?? '-'}</td>
                    <td>{entry.usedBy ?? '-'}</td>
                    <td>{formatOptionalDate(entry.usedAt)}</td>
                    <td>
                      {entry.walletTransactionId ? (
                        <small className="table-note">{entry.walletTransactionId}</small>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td>
                      <button
                        className="ghost-button compact-button"
                        disabled={entry.status !== 'unused' || disablingId === entry.id}
                        onClick={() => void handleDisable(entry.id)}
                        type="button"
                      >
                        <StopOutlined />
                        {disablingId === entry.id ? '禁用中' : '禁用'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!codes.length && !isLoading ? (
                  <tr>
                    <td colSpan={7}>暂无真实充值码记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </MerchantShell>
  );
}

function MetricPanel({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'green' | 'red' }) {
  return (
    <section className="metric-panel">
      <span>{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined}>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function getRechargeStatusClass(status: string) {
  if (status === 'unused') {
    return 'status-pill-success';
  }

  if (status === 'used') {
    return 'status-pill-warning';
  }

  return 'status-pill-muted';
}

function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) {
    return '-';
  }

  return `${(cents / 100).toFixed(2)} 元`;
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '-';
  }

  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatOptionalDate(value: string | null) {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false
  }).format(new Date(value));
}
