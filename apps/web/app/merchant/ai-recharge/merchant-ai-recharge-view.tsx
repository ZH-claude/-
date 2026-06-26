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
  type AdminAiRechargeProduct,
  type TranslationMap
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';
import { formatMoneyCny } from '../../lib/billing-format';

type ProductFormState = {
  productKind: 'ai_recharge' | 'vibe_coding';
  packagePreset: 'custom' | 'weekly' | 'daily';
  title: string;
  platform: string;
  planName: string;
  durationDays: string;
  quotaHours: string;
  quotaPeriodDays: string;
  tokenQuota: string;
  priceCny: string;
  description: string;
  purchaseNote: string;
  deliveryNote: string;
  sortOrder: string;
  status: 'active' | 'disabled';
  translationsJson: string;
};

type PageConfigFormState = {
  introTitle: string;
  introContent: string;
  introImageDataUrl: string;
  translationsJson: string;
};

type OrderDraft = {
  status: AdminAiRechargeOrderStatus;
  merchantNote: string;
};

type DeletedProductArchive = Pick<
  AdminAiRechargeProduct,
  'id' | 'productKind' | 'title' | 'platform' | 'planName' | 'priceCnyCents' | 'status'
> & {
  deletedAt: string;
};

const EMPTY_PRODUCT_FORM: ProductFormState = {
  productKind: 'ai_recharge',
  packagePreset: 'custom',
  title: '',
  platform: 'ChatGPT',
  planName: '',
  durationDays: '30',
  quotaHours: '',
  quotaPeriodDays: '',
  tokenQuota: '',
  priceCny: '0.00',
  description: '',
  purchaseNote: '',
  deliveryNote: '',
  sortOrder: '100',
  status: 'active',
  translationsJson: ''
};

const VIBE_WEEKLY_PRESET = {
  durationDays: '7',
  quotaHours: '5',
  quotaPeriodDays: '7',
  tokenQuota: '50000'
};

const VIBE_DAILY_PRESET = {
  durationDays: '1',
  quotaHours: '5',
  quotaPeriodDays: '1',
  tokenQuota: '50000'
};

function applyVibePackagePreset(form: ProductFormState, packagePreset: ProductFormState['packagePreset']): ProductFormState {
  if (packagePreset === 'daily') {
    return {
      ...form,
      productKind: 'vibe_coding',
      packagePreset,
      ...VIBE_DAILY_PRESET
    };
  }

  if (packagePreset === 'weekly') {
    return {
      ...form,
      productKind: 'vibe_coding',
      packagePreset,
      ...VIBE_WEEKLY_PRESET
    };
  }

  return {
    ...form,
    packagePreset
  };
}

const EMPTY_PAGE_CONFIG_FORM: PageConfigFormState = {
  introTitle: '',
  introContent: '',
  introImageDataUrl: '',
  translationsJson: ''
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
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isIntroSavedVisible, setIsIntroSavedVisible] = useState(false);
  const [deletedProductArchive, setDeletedProductArchive] = useState<DeletedProductArchive | null>(null);
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
  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId]
  );
  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) ?? null,
    [orders, selectedOrderId]
  );

  async function loadData() {
    setIsLoading(true);
    setError('');

    try {
      const [productResult, orderResult, pageConfigResult] = await Promise.allSettled([
        listAdminAiRechargeProducts(),
        listAdminAiRechargeOrders(),
        getAdminAiRechargePageConfig()
      ]);

      if (productResult.status === 'rejected') {
        throw productResult.reason;
      }
      if (orderResult.status === 'rejected') {
        throw orderResult.reason;
      }

      setProducts(productResult.value.items);
      setOrders(orderResult.value.items);
      syncSelectedProductFromUrl(productResult.value.items);
      syncSelectedOrderFromUrl(orderResult.value.items);
      setOrderDrafts(Object.fromEntries(orderResult.value.items.map((order) => [
        order.id,
        { status: order.status, merchantNote: order.merchantNote ?? '' }
      ])));

      if (pageConfigResult.status === 'fulfilled') {
        setPageConfig(pageConfigResult.value);
        setPageConfigForm(toPageConfigForm(pageConfigResult.value));
        syncSavedIntroFromUrl(pageConfigResult.value);
      } else {
        const pageConfigMessage = pageConfigResult.reason instanceof Error ? pageConfigResult.reason.message : '用户端简介配置加载失败';
        if (isAuthErrorMessage(pageConfigMessage)) {
          throw new Error(pageConfigMessage);
        }
        setError(`用户端简介配置暂时加载失败：${pageConfigMessage}`);
      }
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : 'AI 代充数据加载失败';
      setError(nextMessage);
      if (isAuthErrorMessage(nextMessage)) {
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
        introImageDataUrl: pageConfigForm.introImageDataUrl || null,
        translations: parseTranslationsJson(pageConfigForm.translationsJson, '用户端简介多语言翻译')
      });
      setPageConfig(config);
      setPageConfigForm(toPageConfigForm(config));
      setIsIntroSavedVisible(true);
      setMessage('用户端简介已保存，已生成可视化存档。');
      replaceArchiveUrl('/merchant/ai-recharge?intro=1&saved=intro');
      await loadData();
      window.setTimeout(() => {
        document.getElementById('merchant-ai-recharge-intro-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      const savedProduct = editingProductId
        ? await updateAdminAiRechargeProduct(editingProductId, payload)
        : await createAdminAiRechargeProduct(payload);
      setProducts((current) => upsertProduct(current, savedProduct));
      setSelectedProductId(savedProduct.id);
      setDeletedProductArchive(null);
      setEditingProductId(savedProduct.id);
      setForm(toProductForm(savedProduct));
      setMessage(`代充商品 ${savedProduct.title} 已保存，已生成可视化存档。`);
      replaceArchiveUrl(`/merchant/ai-recharge?products=1&selected=${encodeURIComponent(savedProduct.id)}&saved=product`);
      await loadData();
      window.setTimeout(() => {
        document.getElementById('merchant-ai-recharge-saved-product')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '代充商品保存失败');
    } finally {
      setIsSaving(false);
    }
  }

  function startEdit(product: AdminAiRechargeProduct) {
    setEditingProductId(product.id);
    setSelectedProductId(product.id);
    setDeletedProductArchive(null);
    setForm(toProductForm(product));
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
      const savedProduct = await updateAdminAiRechargeProductStatus(product.id, { status: nextStatus });
      setProducts((current) => upsertProduct(current, savedProduct));
      setSelectedProductId(savedProduct.id);
      setDeletedProductArchive(null);
      if (editingProductId === savedProduct.id) {
        setForm(toProductForm(savedProduct));
      }
      setMessage(nextStatus === 'active' ? '商品已上架' : '商品已下架');
      replaceArchiveUrl(`/merchant/ai-recharge?products=1&selected=${encodeURIComponent(savedProduct.id)}&saved=product-status`);
      await loadData();
      window.setTimeout(() => {
        document.getElementById('merchant-ai-recharge-saved-product')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
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
      setProducts((current) => current.filter((entry) => entry.id !== product.id));
      setSelectedProductId(null);
      setDeletedProductArchive(toDeletedProductArchive(product));
      if (editingProductId === product.id) {
        setEditingProductId(null);
        setForm(EMPTY_PRODUCT_FORM);
      }
      setMessage(`代充商品 ${product.title} 已删除，已生成操作存档。`);
      replaceArchiveUrl(`/merchant/ai-recharge?products=1&deleted=${encodeURIComponent(product.id)}&saved=product-delete`);
      window.setTimeout(() => {
        document.getElementById('merchant-ai-recharge-deleted-product')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
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
      const savedOrder = await updateAdminAiRechargeOrderStatus(order.id, {
        status: draft.status,
        merchantNote: draft.merchantNote || null
      });
      setOrders((current) => upsertOrder(current, savedOrder));
      setSelectedOrderId(savedOrder.id);
      setOrderDrafts((current) => ({
        ...current,
        [savedOrder.id]: {
          status: savedOrder.status,
          merchantNote: savedOrder.merchantNote ?? ''
        }
      }));
      setMessage(`订单 ${savedOrder.orderNo} 已保存，已生成可视化存档。`);
      replaceArchiveUrl(`/merchant/ai-recharge?orders=1&order=${encodeURIComponent(savedOrder.id)}&saved=order`);
      await loadData();
      window.setTimeout(() => {
        document.getElementById('merchant-ai-recharge-order-saved')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  function replaceArchiveUrl(url: string) {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', url);
    }
  }

  function isAuthErrorMessage(message: string) {
    return message.includes('401') || message.includes('认证') || message.includes('会话') || message.toLowerCase().includes('auth');
  }

  function syncSelectedProductFromUrl(items: AdminAiRechargeProduct[]) {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const selectedFromUrl = params.get('selected') || params.get('selectedProduct');
    const savedState = params.get('saved') ?? '';
    const requestedProduct = selectedFromUrl
      ? items.find((product) => product.id === selectedFromUrl)
      : null;

    if (requestedProduct && savedState) {
      setDeletedProductArchive(null);
      setEditingProductId(requestedProduct.id);
      setForm(toProductForm(requestedProduct));
      setMessage(formatProductSavedQueryMessage(savedState, requestedProduct.title));
    }

    setSelectedProductId((current) => {
      if (requestedProduct) {
        return requestedProduct.id;
      }

      return current && items.some((product) => product.id === current) ? current : null;
    });
  }

  function syncSavedIntroFromUrl(config: AdminAiRechargePageConfig | null) {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('saved') === 'intro' || params.get('intro') === '1') {
      setIsIntroSavedVisible(true);
      setMessage(`用户端简介已保存，保存时间：${config?.updatedAt ? formatDate(config.updatedAt) : '暂无'}`);
    }
  }

  function syncSelectedOrderFromUrl(items: AdminAiRechargeOrder[]) {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const selectedFromUrl = params.get('order') || params.get('selectedOrder');
    const savedState = params.get('saved') ?? '';
    const requestedOrder = selectedFromUrl
      ? items.find((order) => order.id === selectedFromUrl || order.orderNo === selectedFromUrl)
      : null;

    if (requestedOrder && savedState === 'order') {
      setMessage(`订单 ${requestedOrder.orderNo} 已保存，已恢复到订单档案。`);
    }

    setSelectedOrderId((current) => {
      if (requestedOrder) {
        return requestedOrder.id;
      }

      return current && items.some((order) => order.id === current) ? current : null;
    });
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
          <form className="auth-form ai-recharge-admin-form" data-qa="merchant-ai-recharge-intro-form" onSubmit={handlePageConfigSubmit}>
            <label>
              简介标题
              <input
                data-qa="merchant-ai-recharge-intro-title"
                maxLength={80}
                onChange={(event) => setPageConfigForm((current) => ({ ...current, introTitle: event.target.value }))}
                placeholder="例如 购买前必读"
                value={pageConfigForm.introTitle}
              />
            </label>
            <label className="wide-label">
              简介内容
              <textarea
                data-qa="merchant-ai-recharge-intro-content"
                maxLength={2000}
                onChange={(event) => setPageConfigForm((current) => ({ ...current, introContent: event.target.value }))}
                placeholder="写给用户看的代充说明、售后规则、处理时间或注意事项。"
                value={pageConfigForm.introContent}
              />
            </label>
            <label className="wide-label">
              多语言翻译 JSON
              <textarea
                data-qa="merchant-ai-recharge-intro-translations"
                onChange={(event) => setPageConfigForm((current) => ({ ...current, translationsJson: event.target.value }))}
                placeholder={`示例：\n{\n  "en-US": {"introTitle": "Recharge guide", "introContent": "English intro"},\n  "ja-JP": {"introTitle": "チャージガイド", "introContent": "日本語の説明"}\n}`}
                rows={6}
                value={pageConfigForm.translationsJson}
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
              <button className="primary-button" data-qa="merchant-ai-recharge-intro-submit" disabled={isSavingPageConfig} type="submit">
                <PictureOutlined />
                {isSavingPageConfig ? '保存中' : '保存用户端简介'}
              </button>
              {pageConfig ? <small className="table-note">上次保存：{pageConfig.updatedAt ? formatDate(pageConfig.updatedAt) : '暂无'}</small> : null}
            </div>
          </form>
          {isIntroSavedVisible && pageConfig ? (
            <div
              className="one-time-key-box recharge-code-box"
              data-page-config-saved="true"
              data-qa="merchant-ai-recharge-intro-saved"
              id="merchant-ai-recharge-intro-saved"
            >
              <div>
                <strong>已保存简介档案</strong>
                <small>标题：{pageConfig.introTitle || '-'}</small>
                <small>内容：{pageConfig.introContent || '-'}</small>
                <small>翻译：{pageConfig.translations ? `${Object.keys(pageConfig.translations).length} 种语言` : '未配置'}</small>
                <small>更新时间：{pageConfig.updatedAt ? formatDate(pageConfig.updatedAt) : '暂无'}</small>
              </div>
            </div>
          ) : null}
        </section>

        <section className="admin-panel" id="merchant-ai-recharge-form">
          <div className="panel-title">
            <ShoppingOutlined />
            <h2>{editingProductId ? '修改代充商品' : '发布代充商品'}</h2>
          </div>
          <form className="auth-form ai-recharge-admin-form" data-qa="merchant-ai-recharge-product-form" onSubmit={handleSubmit}>
            <label>
              Product type
              <select
                data-qa="merchant-ai-recharge-product-kind"
                onChange={(event) => {
                  const productKind = event.target.value as ProductFormState['productKind'];
                  setForm((current) =>
                    productKind === 'vibe_coding'
                      ? applyVibePackagePreset({ ...current, productKind }, current.packagePreset === 'daily' ? 'daily' : 'weekly')
                      : { ...current, productKind, packagePreset: 'custom' }
                  );
                }}
                value={form.productKind}
              >
                <option value="ai_recharge">AI recharge</option>
                <option value="vibe_coding">VibeCoding package</option>
              </select>
            </label>
            {form.productKind === 'vibe_coding' ? (
              <label>
                Package preset
                <select
                  data-qa="merchant-ai-recharge-package-preset"
                  onChange={(event) =>
                    setForm((current) =>
                      applyVibePackagePreset(current, event.target.value as ProductFormState['packagePreset'])
                    )
                  }
                  value={form.packagePreset}
                >
                  <option value="weekly">Weekly 5h / 7 days</option>
                  <option value="daily">Daily package / 1 day</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
            ) : null}
            <label>
              商品标题
              <input
                data-qa="merchant-ai-recharge-title"
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
                data-qa="merchant-ai-recharge-platform"
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
                data-qa="merchant-ai-recharge-plan-name"
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
                data-qa="merchant-ai-recharge-price"
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
                data-qa="merchant-ai-recharge-duration-days"
                min="1"
                onChange={(event) => setForm((current) => ({ ...current, durationDays: event.target.value }))}
                placeholder="可不填"
                step="1"
                type="number"
                value={form.durationDays}
              />
            </label>
            <label>
              Vibe hours
              <input
                data-qa="merchant-ai-recharge-quota-hours"
                min="1"
                onChange={(event) => setForm((current) => ({ ...current, quotaHours: event.target.value }))}
                placeholder="5"
                step="1"
                type="number"
                value={form.quotaHours}
              />
            </label>
            <label>
              Quota period days
              <input
                data-qa="merchant-ai-recharge-quota-period-days"
                min="1"
                onChange={(event) => setForm((current) => ({ ...current, quotaPeriodDays: event.target.value }))}
                placeholder="7"
                step="1"
                type="number"
                value={form.quotaPeriodDays}
              />
            </label>
            <label>
              Token quota
              <input
                data-qa="merchant-ai-recharge-token-quota"
                min="1"
                onChange={(event) => setForm((current) => ({ ...current, tokenQuota: event.target.value }))}
                placeholder="500000"
                step="1"
                type="number"
                value={form.tokenQuota}
              />
            </label>
            <label>
              排序
              <input
                data-qa="merchant-ai-recharge-sort-order"
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
                data-qa="merchant-ai-recharge-status"
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
                data-qa="merchant-ai-recharge-description"
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
                data-qa="merchant-ai-recharge-purchase-note"
                maxLength={1000}
                onChange={(event) => setForm((current) => ({ ...current, purchaseNote: event.target.value }))}
                placeholder="付款、核实、联系规则"
                value={form.purchaseNote}
              />
            </label>
            <label className="wide-label">
              交付说明
              <textarea
                data-qa="merchant-ai-recharge-delivery-note"
                maxLength={1000}
                onChange={(event) => setForm((current) => ({ ...current, deliveryNote: event.target.value }))}
                placeholder="预计处理时间、售后方式"
                value={form.deliveryNote}
              />
            </label>
            <label className="wide-label">
              多语言翻译 JSON
              <textarea
                onChange={(event) => setForm((current) => ({ ...current, translationsJson: event.target.value }))}
                placeholder={`示例：\n{\n  "en-US": {"title": "ChatGPT Plus", "platform": "ChatGPT", "planName": "Plus", "description": "English description", "purchaseNote": "Purchase note", "deliveryNote": "Delivery note"},\n  "ja-JP": {"title": "ChatGPT Plus", "description": "日本語の説明"}\n}`}
                rows={8}
                value={form.translationsJson}
              />
            </label>
            <div className="form-actions-row">
              <button className="primary-button" data-qa="merchant-ai-recharge-submit" disabled={isSaving} type="submit">
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
          {selectedProduct ? (
            <div
              className="one-time-key-box recharge-code-box"
              data-qa="merchant-ai-recharge-saved-product"
              data-selected-product-id={selectedProduct.id}
              data-selected-product-kind={selectedProduct.productKind}
              data-selected-product-status={selectedProduct.status}
              id="merchant-ai-recharge-saved-product"
            >
              <div>
                <strong>已保存商品档案</strong>
                <small>记录 ID：{selectedProduct.id}</small>
                <small>类型：{formatProductKind(selectedProduct.productKind)}</small>
                <small>商品：{selectedProduct.title}</small>
                <small>平台 / 套餐：{selectedProduct.platform} / {selectedProduct.planName}</small>
                <small>价格：{formatMoneyCny(selectedProduct.priceCnyCents)}</small>
                <small>权益：{formatProductQuota(selectedProduct)}</small>
                <small>状态：{formatProductStatus(selectedProduct.status)}</small>
                <small>更新时间：{formatDate(selectedProduct.updatedAt)}</small>
              </div>
              <button className="ghost-button compact-button" onClick={() => startEdit(selectedProduct)} type="button">
                <EditOutlined />
                继续修改
              </button>
            </div>
          ) : null}
          {deletedProductArchive ? (
            <div
              className="one-time-key-box recharge-code-box"
              data-deleted-product-id={deletedProductArchive.id}
              data-deleted-product-kind={deletedProductArchive.productKind}
              data-product-delete-saved="true"
              data-qa="merchant-ai-recharge-deleted-product"
              id="merchant-ai-recharge-deleted-product"
            >
              <div>
                <strong>已删除商品操作存档</strong>
                <small>记录 ID：{deletedProductArchive.id}</small>
                <small>类型：{formatProductKind(deletedProductArchive.productKind)}</small>
                <small>商品：{deletedProductArchive.title}</small>
                <small>平台 / 套餐：{deletedProductArchive.platform} / {deletedProductArchive.planName}</small>
                <small>删除前价格：{formatMoneyCny(deletedProductArchive.priceCnyCents)}</small>
                <small>删除前状态：{formatProductStatus(deletedProductArchive.status)}</small>
                <small>删除时间：{formatDate(deletedProductArchive.deletedAt)}</small>
              </div>
            </div>
          ) : null}
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
                  <tr
                    className={selectedProductId === product.id ? 'active-row' : undefined}
                    data-product-id={product.id}
                    data-qa="merchant-ai-recharge-product-row"
                    key={product.id}
                  >
                    <td>
                      <strong>{product.title}</strong>
                      <small className="table-note">{product.productKind === 'vibe_coding' ? 'VibeCoding package' : 'AI recharge'}</small>
                      <small className="table-note">排序 {product.sortOrder}</small>
                    </td>
                    <td>
                      {product.platform} / {product.planName}
                      <small className="table-note">{formatProductQuota(product)}</small>
                    </td>
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
                          data-qa="merchant-ai-recharge-product-delete"
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
          {selectedOrder ? (
            <div
              className="one-time-key-box recharge-code-box"
              data-qa="merchant-ai-recharge-order-saved"
              data-selected-order-id={selectedOrder.id}
              data-selected-order-status={selectedOrder.status}
              id="merchant-ai-recharge-order-saved"
            >
              <div>
                <strong>已保存订单档案</strong>
                <small>订单号：{selectedOrder.orderNo}</small>
                <small>商品：{selectedOrder.productTitle}</small>
                <small>用户：{selectedOrder.username ?? '-'}</small>
                <small>状态：{formatOrderStatus(selectedOrder.status)}</small>
                <small>备注：{selectedOrder.merchantNote || '-'}</small>
                <small>更新时间：{formatDate(selectedOrder.updatedAt)}</small>
              </div>
            </div>
          ) : null}
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
                    <tr
                      className={selectedOrderId === order.id ? 'active-row' : undefined}
                      data-order-id={order.id}
                      data-qa="merchant-ai-recharge-order-row"
                      key={order.id}
                    >
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
                            data-qa="merchant-ai-recharge-order-status"
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
                            data-qa="merchant-ai-recharge-order-note"
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
                          data-qa="merchant-ai-recharge-order-save"
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
    productKind: form.productKind,
    title: form.title,
    platform: form.platform,
    planName: form.planName,
    durationDays: form.durationDays ? parseInteger(form.durationDays, '时长') : null,
    priceCnyCents: parseCurrencyToCents(form.priceCny, '价格'),
    quotaHours: form.quotaHours ? parseInteger(form.quotaHours, 'vibe hours') : null,
    quotaPeriodDays: form.quotaPeriodDays ? parseInteger(form.quotaPeriodDays, 'quota period days') : null,
    tokenQuota: form.tokenQuota ? parseInteger(form.tokenQuota, 'token quota') : null,
    description: form.description,
    purchaseNote: form.purchaseNote || null,
    deliveryNote: form.deliveryNote || null,
    sortOrder: parseInteger(form.sortOrder, '排序'),
    status: form.status,
    translations: parseTranslationsJson(form.translationsJson, '代充商品多语言翻译')
  };
}

function toProductForm(product: AdminAiRechargeProduct): ProductFormState {
  return {
    productKind: product.productKind,
    packagePreset: inferPackagePreset(product),
    title: product.title,
    platform: product.platform,
    planName: product.planName,
    durationDays: product.durationDays ? String(product.durationDays) : '',
    quotaHours: product.quotaHours ? String(product.quotaHours) : '',
    quotaPeriodDays: product.quotaPeriodDays ? String(product.quotaPeriodDays) : '',
    tokenQuota: product.tokenQuota ? String(product.tokenQuota) : '',
    priceCny: (product.priceCnyCents / 100).toFixed(2),
    description: product.description,
    purchaseNote: product.purchaseNote ?? '',
    deliveryNote: product.deliveryNote ?? '',
    sortOrder: String(product.sortOrder),
    status: product.status,
    translationsJson: stringifyTranslations(product.translations)
  };
}

function inferPackagePreset(product: AdminAiRechargeProduct): ProductFormState['packagePreset'] {
  if (product.productKind !== 'vibe_coding') {
    return 'custom';
  }

  if (product.durationDays === 1 && product.quotaPeriodDays === 1) {
    return 'daily';
  }

  if (product.durationDays === 7 && product.quotaHours === 5 && product.quotaPeriodDays === 7) {
    return 'weekly';
  }

  return 'custom';
}

function toDeletedProductArchive(product: AdminAiRechargeProduct): DeletedProductArchive {
  return {
    id: product.id,
    productKind: product.productKind,
    title: product.title,
    platform: product.platform,
    planName: product.planName,
    priceCnyCents: product.priceCnyCents,
    status: product.status,
    deletedAt: new Date().toISOString()
  };
}

function upsertProduct(items: AdminAiRechargeProduct[], product: AdminAiRechargeProduct) {
  const index = items.findIndex((item) => item.id === product.id);
  if (index === -1) {
    return [product, ...items];
  }

  return items.map((item) => (item.id === product.id ? product : item));
}

function upsertOrder(items: AdminAiRechargeOrder[], order: AdminAiRechargeOrder) {
  const index = items.findIndex((item) => item.id === order.id);
  if (index === -1) {
    return [order, ...items];
  }

  return items.map((item) => (item.id === order.id ? order : item));
}

function formatProductQuota(product: AdminAiRechargeProduct) {
  const parts = [
    product.quotaHours ? `${product.quotaHours}h` : null,
    product.quotaPeriodDays ? `${product.quotaPeriodDays}d window` : null,
    product.tokenQuota ? `${product.tokenQuota.toLocaleString()} tokens` : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' / ') : 'No quota configured';
}

function formatProductKind(kind: AdminAiRechargeProduct['productKind']) {
  return kind === 'vibe_coding' ? 'VibeCoding package' : 'AI recharge';
}

function formatProductStatus(status: AdminAiRechargeProduct['status']) {
  return status === 'active' ? '上架' : '下架';
}

function formatProductSavedQueryMessage(savedState: string, title: string) {
  if (savedState === 'product-status') {
    return `代充商品 ${title} 状态已保存，已恢复到商品档案。`;
  }

  return `代充商品 ${title} 已保存，已恢复到商品档案。`;
}

function formatOrderStatus(status: AdminAiRechargeOrderStatus) {
  return ORDER_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function toPageConfigForm(config: AdminAiRechargePageConfig | null): PageConfigFormState {
  return {
    introTitle: config?.introTitle ?? '',
    introContent: config?.introContent ?? '',
    introImageDataUrl: config?.introImageDataUrl ?? '',
    translationsJson: stringifyTranslations(config?.translations)
  };
}

function parseTranslationsJson(value: string, label: string): TranslationMap | null {
  const text = value.trim();
  if (!text) {
    return null;
  }

  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label}必须是 JSON 对象`);
  }

  return parsed as TranslationMap;
}

function stringifyTranslations(value: TranslationMap | null | undefined) {
  return value ? JSON.stringify(value, null, 2) : '';
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
