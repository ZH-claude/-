'use client';

import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  PictureOutlined,
  ReloadOutlined,
  ShoppingOutlined,
  StopOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  createAdminAiRechargeProduct,
  deleteAdminAiRechargeProduct,
  getAdminAiRechargePageConfig,
  listAdminAiRechargeOrders,
  listAdminAiRechargeProducts,
  updateAdminAiRechargePageConfig,
  updateAdminAiRechargeOrderStatus,
  updateAdminAiRechargeProduct,
  updateAdminAiRechargeProductStatus,
  type AdminAiRechargePageConfig,
  type AdminAiRechargeOrder,
  type AdminAiRechargeOrderStatus,
  type AdminAiRechargeProduct
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';
import { formatMoneyCny } from '../../lib/billing-format';

type ProductFormState = {
  title: string;
  platform: string;
  planName: string;
  durationDays: string;
  priceCny: string;
  description: string;
  purchaseNote: string;
  deliveryNote: string;
  sortOrder: string;
  status: 'active' | 'disabled';
};

type PageConfigFormState = {
  introTitle: string;
  introContent: string;
  introImageDataUrl: string;
};

type OrderDraft = {
  status: AdminAiRechargeOrderStatus;
  merchantNote: string;
};

const EMPTY_PRODUCT_FORM: ProductFormState = {
  title: '',
  platform: 'ChatGPT',
  planName: '',
  durationDays: '30',
  priceCny: '0.00',
  description: '',
  purchaseNote: '',
  deliveryNote: '',
  sortOrder: '100',
  status: 'active'
};

const EMPTY_PAGE_CONFIG_FORM: PageConfigFormState = {
  introTitle: '',
  introContent: '',
  introImageDataUrl: ''
};

const MAX_INTRO_IMAGE_FILE_BYTES = 1_000_000;
const ALLOWED_INTRO_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

const ORDER_STATUS_OPTIONS: Array<{ value: AdminAiRechargeOrderStatus; label: string }> = [
  { value: 'pending', label: '待处理' },
  { value: 'processing', label: '处理中' },
  { value: 'fulfilled', label: '已完成' },
  { value: 'canceled', label: '已取消' },
  { value: 'failed', label: '失败' }
];

export function MerchantAiRechargeView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [products, setProducts] = useState<AdminAiRechargeProduct[]>([]);
  const [orders, setOrders] = useState<AdminAiRechargeOrder[]>([]);
  const [pageConfig, setPageConfig] = useState<AdminAiRechargePageConfig | null>(null);
  const [pageConfigForm, setPageConfigForm] = useState<PageConfigFormState>(EMPTY_PAGE_CONFIG_FORM);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [orderDrafts, setOrderDrafts] = useState<Record<string, OrderDraft>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPageConfig, setIsSavingPageConfig] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadData();
  }, []);

  const activeProductCount = useMemo(() => products.filter((product) => product.status === 'active').length, [products]);
  const pendingOrderCount = useMemo(
    () => orders.filter((order) => order.status === 'pending' || order.status === 'processing').length,
    [orders]
  );

  async function loadData() {
    setIsLoading(true);
    setError('');

    try {
      const [productResult, orderResult, pageConfigResult] = await Promise.all([
        listAdminAiRechargeProducts(),
        listAdminAiRechargeOrders(),
        getAdminAiRechargePageConfig()
      ]);
      setProducts(productResult.items);
      setOrders(orderResult.items);
      setPageConfig(pageConfigResult);
      setPageConfigForm(toPageConfigForm(pageConfigResult));
      setOrderDrafts(Object.fromEntries(orderResult.items.map((order) => [
        order.id,
        { status: order.status, merchantNote: order.merchantNote ?? '' }
      ])));
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : 'AI 代充数据加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handlePageConfigSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSavingPageConfig(true);

    try {
      const config = await updateAdminAiRechargePageConfig({
        introTitle: pageConfigForm.introTitle || null,
        introContent: pageConfigForm.introContent || null,
        introImageDataUrl: pageConfigForm.introImageDataUrl || null
      });
      setPageConfig(config);
      setPageConfigForm(toPageConfigForm(config));
      setMessage('用户端简介已保存');
      await loadData();
      router.replace('/merchant/ai-recharge?intro=1');
      router.refresh();
      window.setTimeout(() => {
        document.getElementById('merchant-ai-recharge-intro')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '用户端简介保存失败');
    } finally {
      setIsSavingPageConfig(false);
    }
  }

  async function handleIntroImageFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    setError('');
    setMessage('');

    try {
      if (!ALLOWED_INTRO_IMAGE_TYPES.has(file.type)) {
        throw new Error('简介图片只支持 PNG、JPG、WEBP 或 GIF');
      }
      if (file.size > MAX_INTRO_IMAGE_FILE_BYTES) {
        throw new Error('简介图片不能超过 1MB');
      }

      const dataUrl = await readFileAsDataUrl(file);
      setPageConfigForm((current) => ({ ...current, introImageDataUrl: dataUrl }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '简介图片读取失败');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSaving(true);

    try {
      const payload = toProductPayload(form);
      if (editingProductId) {
        await updateAdminAiRechargeProduct(editingProductId, payload);
        setMessage('代充商品已更新');
      } else {
        await createAdminAiRechargeProduct(payload);
        setMessage('代充商品已发布');
      }
      setForm(EMPTY_PRODUCT_FORM);
      setEditingProductId(null);
      await loadData();
      router.replace('/merchant/ai-recharge?products=1');
      router.refresh();
      window.setTimeout(() => {
        document.getElementById('merchant-ai-recharge-products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '代充商品保存失败');
    } finally {
      setIsSaving(false);
    }
  }

  function startEdit(product: AdminAiRechargeProduct) {
    setEditingProductId(product.id);
    setForm({
      title: product.title,
      platform: product.platform,
      planName: product.planName,
      durationDays: product.durationDays ? String(product.durationDays) : '',
      priceCny: (product.priceCnyCents / 100).toFixed(2),
      description: product.description,
      purchaseNote: product.purchaseNote ?? '',
      deliveryNote: product.deliveryNote ?? '',
      sortOrder: String(product.sortOrder),
      status: product.status
    });
    window.setTimeout(() => {
      document.getElementById('merchant-ai-recharge-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  }

  async function handleStatus(product: AdminAiRechargeProduct) {
    setError('');
    setMessage('');
    setBusyId(product.id);
    const nextStatus = product.status === 'active' ? 'disabled' : 'active';

    try {
      await updateAdminAiRechargeProductStatus(product.id, { status: nextStatus });
      setMessage(nextStatus === 'active' ? '商品已上架' : '商品已下架');
      await loadData();
      router.replace('/merchant/ai-recharge?products=1');
      router.refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '商品状态更新失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(product: AdminAiRechargeProduct) {
    if (!window.confirm(`确定删除代充商品「${product.title}」？已有订单的商品会被后端拦截。`)) {
      return;
    }

    setError('');
    setMessage('');
    setBusyId(product.id);

    try {
      await deleteAdminAiRechargeProduct(product.id);
      setMessage('代充商品已删除');
      await loadData();
      router.replace('/merchant/ai-recharge?products=1');
      router.refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '代充商品删除失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleOrderSave(order: AdminAiRechargeOrder) {
    const draft = orderDrafts[order.id] ?? { status: order.status, merchantNote: order.merchantNote ?? '' };
    setError('');
    setMessage('');
    setBusyId(order.id);

    try {
      await updateAdminAiRechargeOrderStatus(order.id, {
        status: draft.status,
        merchantNote: draft.merchantNote || null
      });
      setMessage(`订单 ${order.orderNo} 已更新`);
      await loadData();
      router.replace('/merchant/ai-recharge?orders=1');
      router.refresh();
      window.setTimeout(() => {
        document.getElementById('merchant-ai-recharge-orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '订单状态更新失败');
    } finally {
      setBusyId(null);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <MerchantShell
      activePath="/merchant/ai-recharge"
      isRefreshing={isLoading}
      onLogout={handleLogout}
      onRefresh={() => void loadData()}
      role={role}
      username={username}
    >
      <section className="admin-content merchant-ai-recharge-page">
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>海外AI会员代充</h1>
            <small>发布用户可见的代充商品，并处理用户提交的人工代充订单。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadData()} title="刷新代充数据" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="代充商品" value={String(products.length)} detail={`上架 ${activeProductCount}`} />
          <MetricPanel label="订单需求" value={String(orders.length)} detail={`待处理 ${pendingOrderCount}`} tone={pendingOrderCount ? 'red' : undefined} />
          <MetricPanel label="已完成" value={String(orders.filter((order) => order.status === 'fulfilled').length)} detail="人工履约完成" tone="green" />
        </section>

        <section className="admin-panel" id="merchant-ai-recharge-intro">
          <div className="panel-title">
            <PictureOutlined />
            <h2>用户端简介</h2>
          </div>
          <p className="form-note">
            这里配置用户端“会员代充商品”和“可代充商品”之间的说明区域。普通用户只能看到内容和图片，不能编辑。
          </p>
          <form className="auth-form ai-recharge-admin-form" onSubmit={handlePageConfigSubmit}>
            <label>
              简介标题
              <input
                maxLength={80}
                onChange={(event) => setPageConfigForm((current) => ({ ...current, introTitle: event.target.value }))}
                placeholder="例如 购买前必读"
                value={pageConfigForm.introTitle}
              />
            </label>
            <label className="wide-label">
              简介内容
              <textarea
                maxLength={2000}
                onChange={(event) => setPageConfigForm((current) => ({ ...current, introContent: event.target.value }))}
                placeholder="写给用户看的代充说明、售后规则、处理时间或注意事项。"
                value={pageConfigForm.introContent}
              />
            </label>
            <label className="wide-label">
              简介图片
              <input accept="image/png,image/jpeg,image/webp,image/gif" onChange={handleIntroImageFile} type="file" />
            </label>
            {pageConfigForm.introImageDataUrl ? (
              <div className="ai-recharge-intro-preview wide-label">
                <img alt={pageConfigForm.introTitle || '用户端简介图片预览'} src={pageConfigForm.introImageDataUrl} />
                <button
                  className="ghost-button compact-button"
                  onClick={() => setPageConfigForm((current) => ({ ...current, introImageDataUrl: '' }))}
                  type="button"
                >
                  移除图片
                </button>
              </div>
            ) : null}
            <div className="form-actions-row">
              <button className="primary-button" disabled={isSavingPageConfig} type="submit">
                <PictureOutlined />
                {isSavingPageConfig ? '保存中' : '保存用户端简介'}
              </button>
              {pageConfig ? <small className="table-note">上次保存：{pageConfig.updatedAt ? formatDate(pageConfig.updatedAt) : '暂无'}</small> : null}
            </div>
          </form>
        </section>

        <section className="admin-panel" id="merchant-ai-recharge-form">
          <div className="panel-title">
            <ShoppingOutlined />
            <h2>{editingProductId ? '修改代充商品' : '发布代充商品'}</h2>
          </div>
          <form className="auth-form ai-recharge-admin-form" onSubmit={handleSubmit}>
            <label>
              商品标题
              <input
                maxLength={80}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder="例如 ChatGPT Plus 月卡"
                required
                value={form.title}
              />
            </label>
            <label>
              平台
              <input
                maxLength={60}
                onChange={(event) => setForm((current) => ({ ...current, platform: event.target.value }))}
                placeholder="ChatGPT / Claude / Midjourney"
                required
                value={form.platform}
              />
            </label>
            <label>
              套餐名称
              <input
                maxLength={80}
                onChange={(event) => setForm((current) => ({ ...current, planName: event.target.value }))}
                placeholder="Plus / Pro / Standard"
                required
                value={form.planName}
              />
            </label>
            <label>
              价格（人民币）
              <input
                min="0"
                onChange={(event) => setForm((current) => ({ ...current, priceCny: event.target.value }))}
                required
                step="0.01"
                type="number"
                value={form.priceCny}
              />
            </label>
            <label>
              时长（天）
              <input
                min="1"
                onChange={(event) => setForm((current) => ({ ...current, durationDays: event.target.value }))}
                placeholder="可不填"
                step="1"
                type="number"
                value={form.durationDays}
              />
            </label>
            <label>
              排序
              <input
                min="0"
                onChange={(event) => setForm((current) => ({ ...current, sortOrder: event.target.value }))}
                required
                step="1"
                type="number"
                value={form.sortOrder}
              />
            </label>
            <label>
              状态
              <select
                onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as ProductFormState['status'] }))}
                value={form.status}
              >
                <option value="active">上架</option>
                <option value="disabled">下架</option>
              </select>
            </label>
            <label className="wide-label">
              商品介绍
              <textarea
                maxLength={1000}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                placeholder="给用户看的服务说明、适用范围和限制"
                required
                value={form.description}
              />
            </label>
            <label className="wide-label">
              购买说明
              <textarea
                maxLength={1000}
                onChange={(event) => setForm((current) => ({ ...current, purchaseNote: event.target.value }))}
                placeholder="付款、核实、联系规则"
                value={form.purchaseNote}
              />
            </label>
            <label className="wide-label">
              交付说明
              <textarea
                maxLength={1000}
                onChange={(event) => setForm((current) => ({ ...current, deliveryNote: event.target.value }))}
                placeholder="预计处理时间、售后方式"
                value={form.deliveryNote}
              />
            </label>
            <div className="form-actions-row">
              <button className="primary-button" disabled={isSaving} type="submit">
                <ShoppingOutlined />
                {isSaving ? '保存中' : editingProductId ? '保存修改' : '发布商品'}
              </button>
              {editingProductId ? (
                <button
                  className="ghost-button"
                  onClick={() => {
                    setEditingProductId(null);
                    setForm(EMPTY_PRODUCT_FORM);
                  }}
                  type="button"
                >
                  取消修改
                </button>
              ) : null}
            </div>
          </form>
        </section>

        <section className="admin-panel" id="merchant-ai-recharge-products">
          <div className="panel-title">
            <ShoppingOutlined />
            <h2>代充商品</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>商品</th>
                  <th>平台 / 套餐</th>
                  <th>价格</th>
                  <th>状态</th>
                  <th>订单</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <strong>{product.title}</strong>
                      <small className="table-note">排序 {product.sortOrder}</small>
                    </td>
                    <td>{product.platform} / {product.planName}</td>
                    <td>{formatMoneyCny(product.priceCnyCents)}</td>
                    <td><span className={`status-pill ${product.status === 'active' ? 'status-pill-success' : 'status-pill-muted'}`}>{product.status === 'active' ? '上架' : '下架'}</span></td>
                    <td>{product.orderCount ?? 0}</td>
                    <td>
                      <div className="table-action-row">
                        <button className="ghost-button compact-button" onClick={() => startEdit(product)} type="button">
                          <EditOutlined />
                          修改
                        </button>
                        <button
                          className="ghost-button compact-button"
                          disabled={busyId === product.id}
                          onClick={() => void handleStatus(product)}
                          type="button"
                        >
                          {product.status === 'active' ? <StopOutlined /> : <CheckCircleOutlined />}
                          {product.status === 'active' ? '下架' : '上架'}
                        </button>
                        <button
                          className="danger-button compact-button"
                          disabled={busyId === product.id}
                          onClick={() => void handleDelete(product)}
                          type="button"
                        >
                          <DeleteOutlined />
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!products.length && !isLoading ? (
                  <tr>
                    <td colSpan={6}>暂无代充商品</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="admin-panel" id="merchant-ai-recharge-orders">
          <div className="panel-title">
            <CheckCircleOutlined />
            <h2>代充订单</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table ai-recharge-orders-table">
              <thead>
                <tr>
                  <th>订单</th>
                  <th>用户</th>
                  <th>商品</th>
                  <th>账号 / 联系方式</th>
                  <th>金额</th>
                  <th>处理</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const draft = orderDrafts[order.id] ?? { status: order.status, merchantNote: order.merchantNote ?? '' };

                  return (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.orderNo}</strong>
                        <small className="table-note">{formatDate(order.createdAt)}</small>
                      </td>
                      <td>{order.username ?? '-'}</td>
                      <td>
                        <strong>{order.productTitle}</strong>
                        <small className="table-note">{order.platform} / {order.planName}</small>
                      </td>
                      <td>
                        <strong>{order.customerAccount}</strong>
                        <small className="table-note">{order.customerContact}</small>
                        {order.customerNote ? <small className="table-note">{order.customerNote}</small> : null}
                      </td>
                      <td>{formatMoneyCny(order.amountCnyCents)}</td>
                      <td>
                        <div className="order-status-editor">
                          <select
                            onChange={(event) => setOrderDrafts((current) => ({
                              ...current,
                              [order.id]: { ...draft, status: event.target.value as AdminAiRechargeOrderStatus }
                            }))}
                            value={draft.status}
                          >
                            {ORDER_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                          <input
                            maxLength={1000}
                            onChange={(event) => setOrderDrafts((current) => ({
                              ...current,
                              [order.id]: { ...draft, merchantNote: event.target.value }
                            }))}
                            placeholder="商家备注"
                            value={draft.merchantNote}
                          />
                        </div>
                      </td>
                      <td>
                        <button
                          className="primary-button compact-button"
                          disabled={busyId === order.id}
                          onClick={() => void handleOrderSave(order)}
                          type="button"
                        >
                          保存
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!orders.length && !isLoading ? (
                  <tr>
                    <td colSpan={7}>暂无代充订单</td>
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

function toProductPayload(form: ProductFormState) {
  return {
    title: form.title,
    platform: form.platform,
    planName: form.planName,
    durationDays: form.durationDays ? parseInteger(form.durationDays, '时长') : null,
    priceCnyCents: parseCurrencyToCents(form.priceCny, '价格'),
    description: form.description,
    purchaseNote: form.purchaseNote || null,
    deliveryNote: form.deliveryNote || null,
    sortOrder: parseInteger(form.sortOrder, '排序'),
    status: form.status
  };
}

function toPageConfigForm(config: AdminAiRechargePageConfig | null): PageConfigFormState {
  return {
    introTitle: config?.introTitle ?? '',
    introContent: config?.introContent ?? '',
    introImageDataUrl: config?.introImageDataUrl ?? ''
  };
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('简介图片读取失败'));
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('简介图片读取失败'));
    };
    reader.readAsDataURL(file);
  });
}

function parseCurrencyToCents(value: string, label: string) {
  const numericValue = Number(value);
  const cents = Math.round(numericValue * 100);

  if (!Number.isFinite(numericValue) || !Number.isInteger(cents) || cents < 0) {
    throw new Error(`${label}必须是大于等于 0 的人民币金额`);
  }
  if (Math.abs(cents / 100 - numericValue) > 0.000001) {
    throw new Error(`${label}最多保留两位小数`);
  }
  return cents;
}

function parseInteger(value: string, label: string) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new Error(`${label}必须是大于等于 0 的整数`);
  }
  return numericValue;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'short',
    timeStyle: 'medium',
    hour12: false
  }).format(new Date(value));
}
