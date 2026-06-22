'use client';

import {
  GiftOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  WalletOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ConsoleShell } from '../../../components/console-shell';
import { getProfile, logout } from '../../../lib/auth-api';
import type { PublicUser } from '../../../lib/auth-api';
import { formatBillingCny, formatMoneyCny } from '../../../lib/billing-format';
import { listRechargeRecords, redeemRechargeCode } from '../../../lib/recharge-api';
import type { RechargeRecord } from '../../../lib/recharge-api';

const CONTACT_CHANNELS = [
  {
    id: 'wechat',
    title: '微信',
    subtitle: '扫码添加微信好友',
    image: '/contact/wechat-recharge.jpg',
    note: '支持微信好友支付后人工发放兑换码。'
  },
  {
    id: 'qq',
    title: 'QQ',
    subtitle: '扫码添加 QQ 联系核实',
    image: '/contact/qq-recharge.jpg',
    note: '可通过 QQ 提交账号、金额和付款凭证。'
  }
];

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
      const [profileResult, recordResult] = await Promise.all([getProfile(), listRechargeRecords()]);
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
      setMessage(`已到账 ${formatBillingCny(result.transaction.amountCents)}`);
      await loadRechargeData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '充值码核销失败');
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
        <div className="account-panel account-summary recharge-summary-panel">
          <div className="recharge-balance-block">
            <p className="eyebrow">余额充值</p>
            <h1>{isLoading ? '加载中' : formatBillingCny(user?.wallet.balanceCents ?? 0)}</h1>
          </div>
          <form className="summary-redeem-form" onSubmit={handleRedeem}>
            <label>
              兑换码
              <input
                autoComplete="off"
                maxLength={48}
                minLength={8}
                onChange={(event) => setCode(event.target.value)}
                placeholder="输入兑换码"
                required
                value={code}
              />
            </label>
            <button className="primary-button" disabled={isRedeeming} type="submit">
              <GiftOutlined />
              {isRedeeming ? '兑换中' : '兑换'}
            </button>
            {error ? <p className="form-error summary-redeem-message">{error}</p> : null}
            {message ? <p className="form-success summary-redeem-message">{message}</p> : null}
          </form>
          <button className="icon-button" onClick={() => void loadRechargeData()} title="刷新充值数据" type="button">
            <ReloadOutlined />
          </button>
        </div>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <QrcodeOutlined />
            <h2>购买兑换码</h2>
          </div>
          <div className="manual-recharge-layout">
            <div className="manual-recharge-copy">
              <p className="form-note">
                当前仅支持微信好友支付后人工发放兑换码。小本生意，只赚搬运费，暂未接入支付宝/微信商户自动支付，望理解。
              </p>
              <ol className="manual-recharge-steps">
                <li>扫码添加微信或 QQ，发送你的平台账号、充值金额和付款凭证。</li>
                <li>核实订单后第一时间发放兑换码。</li>
                <li>拿到兑换码后，在下方输入并兑换到账户余额。</li>
                <li>若超过 24 小时未发码，可联系申请双倍金额退还。</li>
              </ol>
              <p className="manual-recharge-warning">
                注意：扫码付款不会自动到账，只有兑换码兑换成功后余额才会增加。
                {user?.username ? ` 当前账号：${user.username}` : null}
              </p>
            </div>
            <div className="manual-contact-grid" aria-label="兑换码购买联系方式">
              {CONTACT_CHANNELS.map((channel) => (
                <article className="manual-contact-card" key={channel.id}>
                  <header>
                    <strong>{channel.title}</strong>
                    <span>{channel.subtitle}</span>
                  </header>
                  <img alt={`${channel.title} 二维码`} src={channel.image} />
                  <p>{channel.note}</p>
                </article>
              ))}
            </div>
          </div>
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
                  <th>来源</th>
                  <th>人民币金额</th>
                  <th>到账余额</th>
                  <th>充值后余额</th>
                  <th>状态</th>
                  <th>流水</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.createdAt).toLocaleString()}</td>
                    <td>{formatRechargeSource(record)}</td>
                    <td>{formatMoneyCny(record.faceValueCnyCents)}</td>
                    <td>{formatBillingCny(record.amountCents)}</td>
                    <td>{formatBillingCny(record.balanceAfterCents)}</td>
                    <td>{formatPaymentStatus(record.status)}</td>
                    <td>{record.id}</td>
                  </tr>
                ))}
                {!records.length && !isLoading ? (
                  <tr>
                    <td colSpan={7}>暂无充值记录</td>
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

function formatChannel(channel: string | null | undefined) {
  if (channel === 'alipay') {
    return '支付宝';
  }

  if (channel === 'wechat') {
    return '微信支付';
  }

  return '-';
}

function formatPaymentStatus(status: string) {
  const labels: Record<string, string> = {
    pending: '待支付',
    paid: '已支付',
    expired: '已过期',
    closed: '已关闭',
    failed: '失败',
    used: '已使用',
    unused: '未使用',
    disabled: '已禁用'
  };

  return labels[status] ?? status;
}

function formatRechargeSource(record: RechargeRecord) {
  if (record.paymentOrderNo) {
    return `${formatChannel(record.paymentChannel)}订单`;
  }

  if (record.rechargeCodeId) {
    return '充值码';
  }

  return '-';
}
