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
import { useI18n } from '../../../components/language-provider';
import { isAuthenticationApiError } from '../../../lib/api-error-copy';
import { getProfile, logout } from '../../../lib/auth-api';
import type { PublicUser } from '../../../lib/auth-api';
import { formatBillingCny, formatMoneyCny } from '../../../lib/billing-format';
import { applyCopyOverrides, type CopyOverrides } from '../../../lib/copy-overrides';
import type { LanguageCode } from '../../../lib/i18n';
import { pageTerm } from '../../../lib/page-copy-terms';
import { listRechargeRecords, redeemRechargeCode } from '../../../lib/recharge-api';
import type { RechargeRecord } from '../../../lib/recharge-api';

type RechargeCopy = {
  accountLabel: (username: string) => string;
  amountArrived: (amount: string) => string;
  packageArrived: (quota: string) => string;
  buyCodes: string;
  channelNotes: Record<'qq' | 'wechat', { note: string; subtitle: string; title: string }>;
  code: string;
  codePlaceholder: string;
  contactAria: string;
  empty: string;
  loadFailed: string;
  manualNote: string;
  manualSteps: string[];
  manualWarning: string;
  paymentStatuses: Record<string, string>;
  packageSource: string;
  purchaseSource: string;
  records: string;
  redeem: string;
  redeemFailed: string;
  redeeming: string;
  refresh: string;
  sourceChannel: Record<'alipay' | 'wechat', string>;
  table: {
    amount: string;
    balanceAfter: string;
    credited: string;
    source: string;
    status: string;
    time: string;
    transaction: string;
  };
  title: string;
  loading: string;
};

const RECHARGE_COPY = {
  'zh-CN': {
    accountLabel: (username) => ` 当前账号：${username}`,
    amountArrived: (amount) => `已到账 ${amount}`,
    packageArrived: (quota) => `VibeCoding 套餐已兑换：${quota}`,
    buyCodes: '购买兑换码',
    channelNotes: {
      qq: { note: '可通过 QQ 提交账号、金额和付款凭证。', subtitle: '扫码添加 QQ 联系核实', title: 'QQ' },
      wechat: { note: '支持微信好友支付后人工发放兑换码。', subtitle: '扫码添加微信好友', title: '微信' }
    },
    code: '兑换码',
    codePlaceholder: '输入兑换码',
    contactAria: '兑换码购买联系方式',
    empty: '暂无充值记录',
    loadFailed: '充值数据加载失败',
    loading: '加载中',
    manualNote: '当前仅支持微信好友支付后人工发放兑换码。小本生意，只赚搬运费，暂未接入支付宝/微信商户自动支付，望理解。',
    manualSteps: [
      '扫码添加微信或 QQ，发送你的平台账号、充值金额和付款凭证。',
      '核实订单后第一时间发放兑换码。',
      '拿到兑换码后，在下方输入并兑换到账户余额。',
      '若超过 24 小时未发码，可联系申请双倍金额退还。'
    ],
    manualWarning: '注意：扫码付款不会自动到账，只有兑换码兑换成功后余额才会增加。',
    paymentStatuses: {
      closed: '已关闭',
      disabled: '已禁用',
      expired: '已过期',
      failed: '失败',
      paid: '已支付',
      pending: '待支付',
      unused: '未使用',
      used: '已使用'
    },
    packageSource: 'VibeCoding 套餐码',
    purchaseSource: '订单',
    records: '充值记录',
    redeem: '兑换',
    redeemFailed: '充值码核销失败',
    redeeming: '兑换中',
    refresh: '刷新充值数据',
    sourceChannel: { alipay: '支付宝', wechat: '微信支付' },
    table: { amount: '人民币金额', balanceAfter: '充值后余额', credited: '到账余额', source: '来源', status: '状态', time: '时间', transaction: '流水' },
    title: '余额充值'
  },
  'zh-TW': {
    accountLabel: (username) => ` 目前帳號：${username}`,
    amountArrived: (amount) => `已到帳 ${amount}`,
    packageArrived: (quota) => `VibeCoding 套餐已兌換：${quota}`,
    buyCodes: '購買兌換碼',
    channelNotes: {
      qq: { note: '可透過 QQ 提交帳號、金額和付款憑證。', subtitle: '掃碼新增 QQ 聯絡核實', title: 'QQ' },
      wechat: { note: '支援微信好友支付後人工發放兌換碼。', subtitle: '掃碼新增微信好友', title: '微信' }
    },
    code: '兌換碼',
    codePlaceholder: '輸入兌換碼',
    contactAria: '兌換碼購買聯絡方式',
    empty: '暫無充值記錄',
    loadFailed: '充值資料載入失敗',
    loading: '載入中',
    manualNote: '目前僅支援微信好友支付後人工發放兌換碼。小本生意，只賺搬運費，暫未接入支付寶/微信商戶自動支付，敬請理解。',
    manualSteps: [
      '掃碼新增微信或 QQ，發送你的平台帳號、充值金額和付款憑證。',
      '核實訂單後第一時間發放兌換碼。',
      '拿到兌換碼後，在下方輸入並兌換到帳戶餘額。',
      '若超過 24 小時未發碼，可聯絡申請雙倍金額退還。'
    ],
    manualWarning: '注意：掃碼付款不會自動到帳，只有兌換碼兌換成功後餘額才會增加。',
    paymentStatuses: {
      closed: '已關閉',
      disabled: '已停用',
      expired: '已過期',
      failed: '失敗',
      paid: '已支付',
      pending: '待支付',
      unused: '未使用',
      used: '已使用'
    },
    packageSource: 'VibeCoding 套餐碼',
    purchaseSource: '訂單',
    records: '充值記錄',
    redeem: '兌換',
    redeemFailed: '充值碼核銷失敗',
    redeeming: '兌換中',
    refresh: '重新整理充值資料',
    sourceChannel: { alipay: '支付寶', wechat: '微信支付' },
    table: { amount: '人民幣金額', balanceAfter: '充值後餘額', credited: '到帳餘額', source: '來源', status: '狀態', time: '時間', transaction: '流水' },
    title: '餘額充值'
  },
  'en-US': {
    accountLabel: (username) => ` Current account: ${username}`,
    amountArrived: (amount) => `Credited ${amount}`,
    packageArrived: (quota) => `VibeCoding package redeemed: ${quota}`,
    buyCodes: 'Buy recharge codes',
    channelNotes: {
      qq: { note: 'Use QQ to submit your account, amount, and payment proof.', subtitle: 'Scan to contact us on QQ', title: 'QQ' },
      wechat: { note: 'Manual recharge codes are issued after WeChat friend payment.', subtitle: 'Scan to add WeChat', title: 'WeChat' }
    },
    code: 'Recharge code',
    codePlaceholder: 'Enter recharge code',
    contactAria: 'Recharge code purchase contacts',
    empty: 'No recharge records',
    loadFailed: 'Failed to load recharge data',
    loading: 'Loading',
    manualNote: 'Manual recharge codes are currently issued after WeChat friend payment. Automatic Alipay/WeChat merchant payment is not connected yet.',
    manualSteps: [
      'Scan WeChat or QQ, then send your platform account, recharge amount, and payment proof.',
      'After the order is verified, the recharge code will be issued as soon as possible.',
      'Enter the recharge code below to redeem it into your account balance.',
      'If no code is issued after 24 hours, contact us to request a double refund.'
    ],
    manualWarning: 'Important: scan-to-pay does not credit automatically. Your balance increases only after the recharge code is redeemed.',
    paymentStatuses: {
      closed: 'Closed',
      disabled: 'Disabled',
      expired: 'Expired',
      failed: 'Failed',
      paid: 'Paid',
      pending: 'Pending',
      unused: 'Unused',
      used: 'Used'
    },
    packageSource: 'VibeCoding package code',
    purchaseSource: 'order',
    records: 'Recharge records',
    redeem: 'Redeem',
    redeemFailed: 'Failed to redeem recharge code',
    redeeming: 'Redeeming',
    refresh: 'Refresh recharge data',
    sourceChannel: { alipay: 'Alipay', wechat: 'WeChat Pay' },
    table: { amount: 'CNY amount', balanceAfter: 'Balance after', credited: 'Credited balance', source: 'Source', status: 'Status', time: 'Time', transaction: 'Transaction' },
    title: 'Balance top-up'
  }
} satisfies Record<'zh-CN' | 'zh-TW' | 'en-US', RechargeCopy>;

const RECHARGE_COPY_BY_LANGUAGE: Partial<Record<LanguageCode, CopyOverrides<RechargeCopy>>> = {
  'es-ES': {
    accountLabel: (username) => ` Cuenta actual: ${username}`,
    amountArrived: (amount) => `Saldo acreditado ${amount}`,
    buyCodes: 'Comprar codigos de recarga',
    channelNotes: {
      qq: {
        note: 'Usa QQ para enviar tu cuenta, importe de recarga y comprobante de pago.',
        subtitle: 'Escanea para contactarnos por QQ',
        title: 'QQ'
      },
      wechat: {
        note: 'Los codigos de recarga manuales se emiten despues del pago por WeChat.',
        subtitle: 'Escanea para agregar WeChat',
        title: 'WeChat'
      }
    },
    code: 'Codigo de recarga',
    codePlaceholder: 'Ingresa el codigo de recarga',
    contactAria: 'Contactos para comprar codigos de recarga',
    empty: 'Sin registros de recarga',
    manualNote:
      'Actualmente los codigos de recarga se emiten manualmente despues del pago por WeChat. El pago automatico de Alipay o WeChat comerciante aun no esta conectado.',
    manualSteps: [
      'Escanea WeChat o QQ y envia tu cuenta de la plataforma, importe de recarga y comprobante de pago.',
      'Despues de verificar el pedido, emitiremos el codigo de recarga lo antes posible.',
      'Ingresa el codigo de recarga abajo para canjearlo al saldo de tu cuenta.',
      'Si no recibes el codigo despues de 24 horas, contactanos para solicitar un reembolso doble.'
    ],
    manualWarning:
      'Importante: el pago por codigo QR no acredita automaticamente. Tu saldo aumenta solo despues de canjear correctamente el codigo de recarga.',
    packageArrived: (quota) => `Paquete VibeCoding canjeado: ${quota}`,
    packageSource: 'Codigo de paquete VibeCoding',
    purchaseSource: 'pedido',
    records: 'Registros de recarga',
    redeem: 'Canjear',
    redeemFailed: 'No se pudo canjear el codigo de recarga',
    redeeming: 'Canjeando',
    refresh: 'Actualizar datos de recarga',
    sourceChannel: { alipay: 'Alipay', wechat: 'WeChat Pay' },
    table: {
      amount: 'Importe CNY',
      balanceAfter: 'Saldo despues',
      credited: 'Saldo acreditado',
      source: 'Origen',
      status: 'Estado',
      time: 'Hora',
      transaction: 'Transaccion'
    },
    title: 'Recargar saldo'
  },
  'ja-JP': {
    accountLabel: (username) => ` 現在のアカウント: ${username}`,
    amountArrived: (amount) => `${amount} を入金しました`,
    buyCodes: 'チャージコードを購入',
    channelNotes: {
      qq: { note: 'QQでアカウント、金額、支払い証明を送ってください。', subtitle: 'QRコードでQQに連絡', title: 'QQ' },
      wechat: { note: 'WeChat友だち決済後に手動でチャージコードを発行します。', subtitle: 'QRコードでWeChatを追加', title: 'WeChat' }
    },
    code: 'チャージコード',
    codePlaceholder: 'チャージコードを入力',
    contactAria: 'チャージコード購入の連絡先',
    empty: 'チャージ記録はありません',
    loadFailed: 'チャージデータの読み込みに失敗しました',
    loading: '読み込み中',
    manualNote: '現在はWeChat友だち決済後に手動でチャージコードを発行しています。Alipay/WeChatの自動加盟店決済はまだ接続していません。',
    manualSteps: [
      'WeChatまたはQQをスキャンし、プラットフォームアカウント、チャージ金額、支払い証明を送ってください。',
      '注文確認後、できるだけ早くチャージコードを発行します。',
      '受け取ったチャージコードを下で入力し、アカウント残高へ交換してください。',
      '24時間以内にコードが届かない場合は、連絡して返金を申請できます。'
    ],
    manualWarning: '注意: QR決済だけでは自動入金されません。チャージコードの交換成功後に残高が増えます。',
    paymentStatuses: {
      closed: '終了',
      disabled: '無効',
      expired: '期限切れ',
      failed: '失敗',
      paid: '支払い済み',
      pending: '保留中',
      unused: '未使用',
      used: '使用済み'
    },
    purchaseSource: '注文',
    records: 'チャージ記録',
    redeem: '交換',
    redeemFailed: 'チャージコードの交換に失敗しました',
    redeeming: '交換中',
    refresh: 'チャージデータを更新',
    sourceChannel: { alipay: 'Alipay', wechat: 'WeChat Pay' },
    table: { amount: 'CNY金額', balanceAfter: 'チャージ後残高', credited: '入金残高', source: 'ソース', status: 'ステータス', time: '時間', transaction: '取引' },
    title: '残高チャージ'
  }
};

const CONTACT_CHANNELS = [
  { id: 'wechat', image: '/contact/wechat-recharge-20260623.jpg' },
  { id: 'qq', image: '/contact/qq-recharge.jpg' }
] satisfies Array<{ id: keyof RechargeCopy['channelNotes']; image: string }>;

function getRechargeCopy(language: LanguageCode) {
  if (language === 'zh-CN' || language === 'zh-TW') {
    return RECHARGE_COPY[language];
  }

  return applyCopyOverrides(RECHARGE_COPY['en-US'], getRechargeCommonOverrides(language), RECHARGE_COPY_BY_LANGUAGE[language]);
}

function getRechargeCommonOverrides(language: LanguageCode): CopyOverrides<RechargeCopy> | null {
  if (language === 'en-US') {
    return null;
  }

  return {
    buyCodes: pageTerm(language, 'recharge'),
    code: pageTerm(language, 'rechargeCode'),
    codePlaceholder: pageTerm(language, 'rechargeCode'),
    contactAria: pageTerm(language, 'records'),
    empty: pageTerm(language, 'emptyRecords'),
    loadFailed: `${pageTerm(language, 'loading')} ${pageTerm(language, 'failed')}`,
    loading: pageTerm(language, 'loading'),
    paymentStatuses: {
      closed: pageTerm(language, 'disabled'),
      disabled: pageTerm(language, 'disabled'),
      expired: pageTerm(language, 'expired'),
      failed: pageTerm(language, 'failed'),
      paid: pageTerm(language, 'charged'),
      pending: pageTerm(language, 'loading'),
      unused: pageTerm(language, 'active'),
      used: pageTerm(language, 'charged')
    },
    purchaseSource: pageTerm(language, 'records'),
    records: pageTerm(language, 'records'),
    redeem: pageTerm(language, 'apply'),
    redeemFailed: `${pageTerm(language, 'apply')} ${pageTerm(language, 'failed')}`,
    redeeming: pageTerm(language, 'loading'),
    refresh: pageTerm(language, 'refresh'),
    table: {
      amount: pageTerm(language, 'balance'),
      balanceAfter: pageTerm(language, 'balance'),
      credited: pageTerm(language, 'charged'),
      source: pageTerm(language, 'records'),
      status: pageTerm(language, 'status'),
      time: pageTerm(language, 'time'),
      transaction: pageTerm(language, 'records')
    },
    title: pageTerm(language, 'recharge')
  };
}

export default function RechargePage() {
  const router = useRouter();
  const { language } = useI18n();
  const copy = getRechargeCopy(language);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [records, setRecords] = useState<RechargeRecord[]>([]);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRedeeming, setIsRedeeming] = useState(false);

  useEffect(() => {
    void loadRechargeData();
  }, [language, router]);

  async function loadRechargeData() {
    setIsLoading(true);
    setError('');

    try {
      const [profileResult, recordResult] = await Promise.all([getProfile(language), listRechargeRecords(language)]);
      setUser(profileResult.user);
      setRecords(recordResult.items);
    } catch (nextError) {
      setError(copy.loadFailed);
      if (isAuthenticationApiError(nextError)) {
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
      const result = await redeemRechargeCode({ code }, language);
      setCode('');
      setMessage(
        result.recharge.kind === 'vibe_coding'
          ? copy.packageArrived(formatVibeCodeQuota(result.recharge, language))
          : copy.amountArrived(formatBillingCny(result.transaction.amountCents))
      );
      await loadRechargeData();
    } catch {
      setError(copy.redeemFailed);
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
            <p className="eyebrow">{copy.title}</p>
            <h1>{isLoading ? copy.loading : formatBillingCny(user?.wallet.balanceCents ?? 0)}</h1>
          </div>
          <form className="summary-redeem-form" onSubmit={handleRedeem}>
            <label>
              {copy.code}
              <input
                autoComplete="off"
                maxLength={48}
                minLength={8}
                onChange={(event) => setCode(event.target.value)}
                placeholder={copy.codePlaceholder}
                required
                value={code}
              />
            </label>
            <button className="primary-button" disabled={isRedeeming} type="submit">
              <GiftOutlined />
              {isRedeeming ? copy.redeeming : copy.redeem}
            </button>
            {error ? <p className="form-error summary-redeem-message">{error}</p> : null}
            {message ? <p className="form-success summary-redeem-message">{message}</p> : null}
          </form>
          <button className="icon-button" onClick={() => void loadRechargeData()} title={copy.refresh} type="button">
            <ReloadOutlined />
          </button>
        </div>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <QrcodeOutlined />
            <h2>{copy.buyCodes}</h2>
          </div>
          <div className="manual-recharge-layout">
            <div className="manual-recharge-copy">
              <p className="form-note">
                {copy.manualNote}
              </p>
              <ol className="manual-recharge-steps">
                {copy.manualSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p className="manual-recharge-warning">
                {copy.manualWarning}
                {user?.username ? copy.accountLabel(user.username) : null}
              </p>
            </div>
            <div className="manual-contact-grid" aria-label={copy.contactAria}>
              {CONTACT_CHANNELS.map((channel) => (
                <article className="manual-contact-card" key={channel.id}>
                  <header>
                    <strong>{copy.channelNotes[channel.id].title}</strong>
                    <span>{copy.channelNotes[channel.id].subtitle}</span>
                  </header>
                  <img alt={copy.channelNotes[channel.id].title} src={channel.image} />
                  <p>{copy.channelNotes[channel.id].note}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <WalletOutlined />
            <h2>{copy.records}</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table recharge-table">
              <thead>
                <tr>
                  <th>{copy.table.time}</th>
                  <th>{copy.table.source}</th>
                  <th>{copy.table.amount}</th>
                  <th>{copy.table.credited}</th>
                  <th>{copy.table.balanceAfter}</th>
                  <th>{copy.table.status}</th>
                  <th>{copy.table.transaction}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{new Date(record.createdAt).toLocaleString(language)}</td>
                    <td>{formatRechargeSource(record, copy)}</td>
                    <td>{formatMoneyCny(record.faceValueCnyCents)}</td>
                    <td>{record.rechargeCodeKind === 'vibe_coding' ? formatVibeCodeQuota(record, language) : formatBillingCny(record.amountCents)}</td>
                    <td>{formatBillingCny(record.balanceAfterCents)}</td>
                    <td>{formatPaymentStatus(record.status, copy)}</td>
                    <td>{record.id}</td>
                  </tr>
                ))}
                {!records.length && !isLoading ? (
                  <tr>
                    <td colSpan={7}>{copy.empty}</td>
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

function formatChannel(channel: string | null | undefined, copy: RechargeCopy) {
  if (channel === 'alipay') {
    return copy.sourceChannel.alipay;
  }

  if (channel === 'wechat') {
    return copy.sourceChannel.wechat;
  }

  return '-';
}

function formatPaymentStatus(status: string, copy: RechargeCopy) {
  return copy.paymentStatuses[status] ?? status;
}

function formatRechargeSource(record: RechargeRecord, copy: RechargeCopy) {
  if (record.rechargeCodeKind === 'vibe_coding') {
    return copy.packageSource;
  }

  if (record.paymentOrderNo) {
    return `${formatChannel(record.paymentChannel, copy)} ${copy.purchaseSource}`;
  }

  if (record.rechargeCodeId) {
    return copy.code;
  }

  return '-';
}

function formatVibeCodeQuota(record: {
  quotaHours?: number | null;
  quotaPeriodDays?: number | null;
  tokenQuota?: number | null;
}, language: LanguageCode) {
  const parts = [
    record.quotaHours ? `${record.quotaHours}h` : null,
    record.quotaPeriodDays ? `${record.quotaPeriodDays}d` : null,
    record.tokenQuota ? `${record.tokenQuota.toLocaleString(language)} ${pageTerm(language, 'token')}` : null
  ].filter(Boolean);

  return parts.length ? parts.join(' / ') : `${pageTerm(language, 'quota')}: ${pageTerm(language, 'notConfigured')}`;
}
