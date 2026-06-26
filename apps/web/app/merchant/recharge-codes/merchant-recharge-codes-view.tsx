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
type RechargeCodeKind = 'balance' | 'vibe_coding';
type VibeRechargePackagePreset = 'weekly' | 'daily' | 'custom';

const VIBE_RECHARGE_WEEKLY_PRESET = {
  quotaHours: '5',
  quotaPeriodDays: '7',
  tokenQuota: '50000'
};

const VIBE_RECHARGE_DAILY_PRESET = {
  quotaHours: '5',
  quotaPeriodDays: '1',
  tokenQuota: '50000'
};

export function MerchantRechargeCodesView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [codes, setCodes] = useState<AdminRechargeCode[]>([]);
  const [codeStats, setCodeStats] = useState(EMPTY_RECHARGE_STATS);
  const [createdCodes, setCreatedCodes] = useState<CreatedRechargeCode[]>([]);
  const [codeKind, setCodeKind] = useState<RechargeCodeKind>('balance');
  const [amountCny, setAmountCny] = useState('10.00');
  const [count, setCount] = useState('1');
  const [packagePreset, setPackagePreset] = useState<VibeRechargePackagePreset>('weekly');
  const [quotaHours, setQuotaHours] = useState('5');
  const [quotaPeriodDays, setQuotaPeriodDays] = useState('7');
  const [tokenQuota, setTokenQuota] = useState('50000');
  const [selectedCodeId, setSelectedCodeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadCodes();
  }, []);

  const selectedCode = useMemo(
    () => codes.find((entry) => entry.id === selectedCodeId) ?? createdCodes.find((entry) => entry.id === selectedCodeId) ?? null,
    [codes, createdCodes, selectedCodeId]
  );

  const estimatedBaseTokens = useMemo(() => {
    if (codeKind !== 'balance') {
      return null;
    }

    const cents = parseCurrencyToCentsOrNull(amountCny);
    return cents ? cnyCentsToBaseTokens(cents) : null;
  }, [amountCny, codeKind]);

  function applyVibePackagePreset(nextPreset: VibeRechargePackagePreset) {
    setPackagePreset(nextPreset);

    const presetValues =
      nextPreset === 'daily'
        ? VIBE_RECHARGE_DAILY_PRESET
        : nextPreset === 'weekly'
          ? VIBE_RECHARGE_WEEKLY_PRESET
          : null;

    if (!presetValues) {
      return;
    }

    setQuotaHours(presetValues.quotaHours);
    setQuotaPeriodDays(presetValues.quotaPeriodDays);
    setTokenQuota(presetValues.tokenQuota);
  }

  function handleCodeKindChange(nextKind: RechargeCodeKind) {
    setCodeKind(nextKind);
    if (nextKind === 'vibe_coding') {
      applyVibePackagePreset(packagePreset === 'custom' ? 'weekly' : packagePreset);
    }
  }

  async function loadCodes() {
    setIsLoading(true);
    setError('');

    try {
      const result = await listRechargeCodes();
      setCodes(result.items);
      setCodeStats(result.stats);
      syncSelectedRechargeCodeFromUrl(result.items);
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
      const createCount = parseInteger(count, '数量', 1, 100);
      const result =
        codeKind === 'vibe_coding'
          ? await createRechargeCodes({
              codeKind,
              count: createCount,
              quotaHours: parseInteger(quotaHours, 'VibeCoding 小时额度', 1, 100_000),
              quotaPeriodDays: parseInteger(quotaPeriodDays, '额度周期天数', 1, 3_650),
              tokenQuota: parseInteger(tokenQuota, 'token 配额', 1, 2_147_483_647)
            })
          : await createRechargeCodes({
              codeKind,
              amountCnyCents: parseCurrencyToCents(amountCny, '金额', { allowZero: false }),
              count: createCount
            });
      const firstCreatedId = result.items[0]?.id ?? null;
      setCreatedCodes(result.items);
      setCount('1');
      setSelectedCodeId(firstCreatedId);
      setMessage(
        codeKind === 'vibe_coding'
          ? `已生成 ${result.items.length} 张 VibeCoding 套餐码，权益 ${formatCodeQuota(result.items[0])}`
          : `已生成 ${result.items.length} 张余额充值码，每张到账 ${formatBillingUsd(result.items[0]?.amountCents ?? 0)}`
      );
      await loadCodes();
      router.replace(firstCreatedId ? `/merchant/recharge-codes?selected=${encodeURIComponent(firstCreatedId)}` : '/merchant/recharge-codes?created=1');
      window.setTimeout(() => {
        document.getElementById('merchant-recharge-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      setSelectedCodeId(codeId);
      await loadCodes();
      router.replace('/merchant/recharge-codes?disabled=1');
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

  function syncSelectedRechargeCodeFromUrl(items: AdminRechargeCode[]) {
    if (typeof window === 'undefined') {
      return;
    }

    const selectedFromUrl = new URLSearchParams(window.location.search).get('selected');
    if (!selectedFromUrl) {
      return;
    }

    if (items.some((entry) => entry.id === selectedFromUrl)) {
      setSelectedCodeId(selectedFromUrl);
    }
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
            <small>生成余额充值码或 VibeCoding 套餐码；每次生成后会留下可追踪的保存档案。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadCodes()} title="刷新充值码" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error" data-qa="merchant-recharge-feedback">{error}</p> : null}
        {message ? <p className="form-success" data-qa="merchant-recharge-feedback">{message}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="充值码总数" value={formatNumber(codeStats.total)} detail="数据库全量统计" />
          <MetricPanel label="未使用" value={formatNumber(codeStats.unused)} detail="可兑换余额或套餐" tone="green" />
          <MetricPanel label="已使用" value={formatNumber(codeStats.used)} detail="已完成入账" />
          <MetricPanel label="已禁用" value={formatNumber(codeStats.disabled)} detail="不可再兑换" tone="red" />
        </section>

        <section className="admin-panel">
          <div className="panel-title">
            <GiftOutlined />
            <h2>生成充值码</h2>
          </div>
          <form className="auth-form mapping-form" data-qa="merchant-recharge-code-form" onSubmit={handleCreate}>
            <label>
              兑换码类型
              <select data-qa="merchant-recharge-kind" onChange={(event) => handleCodeKindChange(event.target.value as RechargeCodeKind)} value={codeKind}>
                <option value="balance">余额充值码</option>
                <option value="vibe_coding">VibeCoding 套餐码</option>
              </select>
            </label>
            {codeKind === 'balance' ? (
              <label>
                金额（人民币）
                <input
                  data-qa="merchant-recharge-amount"
                  min="0.01"
                  max="2000"
                  onChange={(event) => setAmountCny(event.target.value)}
                  required
                  step="0.01"
                  type="number"
                  value={amountCny}
                />
              </label>
            ) : (
              <>
                <label>
                  套餐类型
                  <select
                    data-qa="merchant-recharge-package-preset"
                    onChange={(event) => applyVibePackagePreset(event.target.value as VibeRechargePackagePreset)}
                    value={packagePreset}
                  >
                    <option value="weekly">周包：5 小时 / 7 天</option>
                    <option value="daily">单日日包：5 小时 / 1 天</option>
                    <option value="custom">自定义用量</option>
                  </select>
                </label>
                <label>
                  小时额度
                  <input
                    data-qa="merchant-recharge-quota-hours"
                    min="1"
                    max="100000"
                    onChange={(event) => {
                      setPackagePreset('custom');
                      setQuotaHours(event.target.value);
                    }}
                    required
                    step="1"
                    type="number"
                    value={quotaHours}
                  />
                </label>
                <label>
                  周期天数
                  <input
                    data-qa="merchant-recharge-quota-period-days"
                    min="1"
                    max="3650"
                    onChange={(event) => {
                      setPackagePreset('custom');
                      setQuotaPeriodDays(event.target.value);
                    }}
                    required
                    step="1"
                    type="number"
                    value={quotaPeriodDays}
                  />
                </label>
                <label>
                  token 配额
                  <input
                    data-qa="merchant-recharge-token-quota"
                    min="1"
                    max="2147483647"
                    onChange={(event) => {
                      setPackagePreset('custom');
                      setTokenQuota(event.target.value);
                    }}
                    required
                    step="1"
                    type="number"
                    value={tokenQuota}
                  />
                </label>
              </>
            )}
            <label>
              数量
              <input
                data-qa="merchant-recharge-count"
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
              {codeKind === 'balance' ? (
                <>
                  预计每张到账：<strong>{estimatedBaseTokens ? formatBillingUsd(estimatedBaseTokens) : '-'}</strong>
                </>
              ) : (
                <>
                  套餐权益：<strong>{formatVibeRechargePackagePreset(packagePreset)} · {quotaHours || '-'}h / {quotaPeriodDays || '-'} 天 / {formatQuotaTokenInput(tokenQuota)} tokens</strong>
                </>
              )}
            </div>
            <button className="primary-button" data-qa="merchant-recharge-submit" disabled={isCreating} type="submit">
              <GiftOutlined />
              {isCreating ? '生成中' : codeKind === 'vibe_coding' ? '生成套餐码' : '生成充值码'}
            </button>
          </form>

          {createdCodes.length ? (
            <div className="one-time-key-box recharge-code-box" data-qa="merchant-recharge-created" id="merchant-recharge-created">
              <div>
                <strong>本次生成，仅显示一次</strong>
                {createdCodes.map((entry) => (
                  <code data-code-id={entry.id} data-code-kind={entry.kind} data-qa="merchant-recharge-created-item" key={entry.id}>
                    {entry.code} · {formatCodeKind(entry.kind)} · {formatCodeQuota(entry)}
                  </code>
                ))}
              </div>
              <button className="ghost-button compact-button" onClick={() => void handleCopyAll()} type="button">
                <CopyOutlined />
                复制全部
              </button>
            </div>
          ) : null}

          {selectedCode ? (
            <div
              className="one-time-key-box recharge-code-box"
              data-qa="merchant-recharge-saved"
              data-selected-code-id={selectedCode.id}
              data-selected-code-kind={selectedCode.kind ?? ''}
              data-selected-code-status={selectedCode.status ?? ''}
              id="merchant-recharge-saved"
            >
              <div>
                <strong>已保存档案</strong>
                <small>记录 ID：{selectedCode.id}</small>
                <small>类型：{formatCodeKind(selectedCode.kind)}</small>
                <small>状态：{selectedCode.status}</small>
                <small>权益：{formatCodeQuota(selectedCode)}</small>
                <small>创建时间：{formatOptionalDate(selectedCode.createdAt)}</small>
              </div>
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
                  <th>类型</th>
                  <th>金额</th>
                  <th>到账/权益</th>
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
                  <tr data-recharge-code-id={entry.id} key={entry.id}>
                    <td>{formatCodeKind(entry.kind)}</td>
                    <td>{formatMoney(entry.faceValueCnyCents)}</td>
                    <td>{entry.kind === 'vibe_coding' ? formatCodeQuota(entry) : formatBillingUsd(entry.amountCents)}</td>
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
                        onClick={() => setSelectedCodeId(entry.id)}
                        type="button"
                      >
                        查看存档
                      </button>
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
                    <td colSpan={9}>暂无真实充值码记录</td>
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

function formatCodeKind(kind: RechargeCodeKind | string | null | undefined) {
  if (kind === 'vibe_coding') {
    return 'VibeCoding 套餐码';
  }

  return '余额充值码';
}

function formatVibeRechargePackagePreset(preset: VibeRechargePackagePreset) {
  if (preset === 'daily') {
    return '单日日包';
  }

  if (preset === 'weekly') {
    return '周包';
  }

  return '自定义套餐';
}

function formatCodeQuota(code: {
  kind?: RechargeCodeKind | string | null;
  quotaHours?: number | null;
  quotaPeriodDays?: number | null;
  tokenQuota?: number | null;
}) {
  if (code.kind !== 'vibe_coding') {
    return code.kind === 'balance' ? '余额到账' : '-';
  }

  const parts = [
    code.quotaHours ? `${code.quotaHours}h` : null,
    code.quotaPeriodDays ? `${code.quotaPeriodDays} 天周期` : null,
    code.tokenQuota ? `${code.tokenQuota.toLocaleString('zh-CN')} tokens` : null
  ].filter(Boolean);

  return parts.length ? parts.join(' / ') : '未配置权益';
}

function formatQuotaTokenInput(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toLocaleString('zh-CN') : '-';
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

function parseInteger(value: string, label: string, min: number, max: number) {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < min || numericValue > max) {
    throw new Error(`${label}必须是 ${min} 到 ${max} 之间的整数`);
  }

  return numericValue;
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
