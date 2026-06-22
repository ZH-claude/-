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
import { formatBillingUsd } from '../../lib/billing-format';

const RECHARGE_RATE_CNY_CENTS = 100;
const RECHARGE_RATE_BASE_TOKENS = 1_000_000;
const EMPTY_RECHARGE_STATS = { total: 0, unused: 0, used: 0, disabled: 0 };

export function MerchantRechargeCodesView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [codes, setCodes] = useState<AdminRechargeCode[]>([]);
  const [codeStats, setCodeStats] = useState(EMPTY_RECHARGE_STATS);
  const [createdCodes, setCreatedCodes] = useState<CreatedRechargeCode[]>([]);
  const [amountCny, setAmountCny] = useState('10.00');
  const [count, setCount] = useState('1');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadCodes();
  }, []);

  const estimatedBaseTokens = useMemo(() => {
    const cents = parseCurrencyToCentsOrNull(amountCny);
    return cents ? cnyCentsToBaseTokens(cents) : null;
  }, [amountCny]);

  async function loadCodes() {
    setIsLoading(true);
    setError('');

    try {
      const result = await listRechargeCodes();
      setCodes(result.items);
      setCodeStats(result.stats);
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
      const rechargeAmountCents = parseCurrencyToCents(amountCny, '金额', { allowZero: false });
      const result = await createRechargeCodes({
        amountCnyCents: rechargeAmountCents,
        count: Number(count)
      });
      setCreatedCodes(result.items);
      setCount('1');
      setMessage(`已生成 ${result.items.length} 张充值码，每张到账 ${formatBillingUsd(result.items[0]?.amountCents ?? 0)}`);
      await loadCodes();
      router.replace('/merchant/recharge-codes?created=1');
      router.refresh();
      window.setTimeout(() => {
        document.getElementById('merchant-recharge-created')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
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
      router.replace('/merchant/recharge-codes?disabled=1');
      router.refresh();
      window.setTimeout(() => {
        document.getElementById('merchant-recharge-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
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
            <small>按人民币生成充值码，用户兑换后得到人民币余额；页面上的 token 只用于展示实际用量。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadCodes()} title="刷新充值码" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="充值码总数" value={formatNumber(codeStats.total)} detail="数据库全量统计" />
          <MetricPanel label="未使用" value={formatNumber(codeStats.unused)} detail="可兑换余额" tone="green" />
          <MetricPanel label="已使用" value={formatNumber(codeStats.used)} detail="已完成入账" />
          <MetricPanel label="已禁用" value={formatNumber(codeStats.disabled)} detail="不可再兑换" tone="red" />
        </section>

        <section className="admin-panel">
          <div className="panel-title">
            <GiftOutlined />
            <h2>生成充值码</h2>
          </div>
          <form className="auth-form mapping-form" onSubmit={handleCreate}>
            <label>
              金额（人民币）
              <input
                min="0.01"
                max="2000"
                onChange={(event) => setAmountCny(event.target.value)}
                required
                step="0.01"
                type="number"
                value={amountCny}
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
            <div className="form-help">
              预计每张到账：<strong>{estimatedBaseTokens ? formatBillingUsd(estimatedBaseTokens) : '-'}</strong>
            </div>
            <button className="primary-button" disabled={isCreating} type="submit">
              <GiftOutlined />
              {isCreating ? '生成中' : '生成充值码'}
            </button>
          </form>

          {createdCodes.length ? (
            <div className="one-time-key-box recharge-code-box" id="merchant-recharge-created">
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
          <div className="admin-table-wrap compact-table" id="merchant-recharge-list">
            <table className="admin-table recharge-code-table">
              <thead>
                <tr>
                  <th>金额</th>
                  <th>到账额度</th>
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
                    <td>{formatMoney(entry.faceValueCnyCents)}</td>
                    <td>{formatBillingUsd(entry.amountCents)}</td>
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
                    <td colSpan={8}>暂无真实充值码记录</td>
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

  return `¥${(cents / 100).toFixed(2)}`;
}

function parseCurrencyToCents(value: string, label: string, options: { allowZero: boolean }) {
  const numericValue = Number(value);
  const cents = Math.round(numericValue * 100);

  if (!Number.isFinite(numericValue) || !Number.isInteger(cents) || cents < 0 || (!options.allowZero && cents === 0)) {
    throw new Error(`${label}必须是${options.allowZero ? '大于等于 0' : '大于 0'}的人民币金额`);
  }

  if (Math.abs(cents / 100 - numericValue) > 0.000001) {
    throw new Error(`${label}最多保留两位小数`);
  }

  return cents;
}

function parseCurrencyToCentsOrNull(value: string) {
  const numericValue = Number(value);
  const cents = Math.round(numericValue * 100);

  if (!Number.isFinite(numericValue) || !Number.isInteger(cents) || cents <= 0) {
    return null;
  }

  return cents;
}

function cnyCentsToBaseTokens(cents: number) {
  return Math.round((cents * RECHARGE_RATE_BASE_TOKENS) / RECHARGE_RATE_CNY_CENTS);
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
