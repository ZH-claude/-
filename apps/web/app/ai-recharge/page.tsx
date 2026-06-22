'use client';

import { ReloadOutlined, ShoppingOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import {
  getAiRechargePageConfig,
  listAiRechargeProducts,
  type AiRechargePageConfig,
  type AiRechargeProduct
} from '../lib/ai-recharge-api';
import { getProfile, logout, type PublicUser } from '../lib/auth-api';
import { formatMoneyCny } from '../lib/billing-format';

export default function AiRechargePage() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [products, setProducts] = useState<AiRechargeProduct[]>([]);
  const [pageConfig, setPageConfig] = useState<AiRechargePageConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError('');

    try {
      const [profileResult, productResult, configResult] = await Promise.all([
        getProfile(),
        listAiRechargeProducts(),
        getAiRechargePageConfig()
      ]);
      setUser(profileResult.user);
      setProducts(productResult.items);
      setPageConfig(configResult);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '代充商品加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <ConsoleShell
      activePath="/ai-recharge"
      isRefreshing={isLoading}
      onLogout={() => void handleLogout()}
      onRefresh={() => void loadData()}
      username={user?.username ?? null}
    >
      <section className="console-content-grid ai-recharge-page">
        <section className="account-panel account-summary ai-recharge-hero">
          <div>
            <p className="eyebrow">海外 AI 会员代充</p>
            <h1>会员代充商品</h1>
            <small>这里仅展示商家已上架的代充商品和简介；普通用户不能发布商品。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadData()} title="刷新代充商品" type="button">
            <ReloadOutlined />
          </button>
        </section>

        {error ? <p className="form-error wide-panel">{error}</p> : null}

        {pageConfig && (pageConfig.introTitle || pageConfig.introContent || pageConfig.introImageDataUrl) ? (
          <section className="account-panel wide-panel ai-recharge-intro">
            <div className="ai-recharge-intro-copy">
              {pageConfig.introTitle ? <h2>{pageConfig.introTitle}</h2> : null}
              {pageConfig.introContent ? <p>{pageConfig.introContent}</p> : null}
            </div>
            {pageConfig.introImageDataUrl ? (
              <img alt={pageConfig.introTitle ?? 'AI 代充简介'} src={pageConfig.introImageDataUrl} />
            ) : null}
          </section>
        ) : null}

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <ShoppingOutlined />
            <h2>可代充商品</h2>
          </div>
          <div className="ai-recharge-product-grid">
            {products.map((product) => (
              <article className="ai-recharge-product-card" key={product.id}>
                <header>
                  <span>{product.platform}</span>
                  <strong>{product.title}</strong>
                </header>
                <div>
                  <b>{formatMoneyCny(product.priceCnyCents)}</b>
                  <small>{product.planName}{product.durationDays ? ` · ${product.durationDays} 天` : ''}</small>
                </div>
                <p>{product.description}</p>
                {product.purchaseNote ? (
                  <p className="ai-recharge-note">
                    <strong>购买说明</strong>
                    {product.purchaseNote}
                  </p>
                ) : null}
                {product.deliveryNote ? (
                  <p className="ai-recharge-note">
                    <strong>交付说明</strong>
                    {product.deliveryNote}
                  </p>
                ) : null}
              </article>
            ))}
            {!products.length && !isLoading ? (
              <div className="empty-state-card">
                <ShoppingOutlined />
                <strong>暂无上架代充商品</strong>
                <span>商家在后台发布并上架后，会显示在这里。</span>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </ConsoleShell>
  );
}
