'use client';

import {
  LeftOutlined,
  ReloadOutlined,
  RightOutlined,
  TeamOutlined,
  UserOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  listAdminUsers,
  type AdminUser
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';
import { formatBillingUsd } from '../../lib/billing-format';

const USER_PAGE_LIMIT = 20;

type PaginationState = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function MerchantUsersView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: USER_PAGE_LIMIT,
    total: 0,
    totalPages: 1
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadData(1);
  }, []);

  const pageTotals = useMemo(
    () =>
      users.reduce(
        (totals, user) => ({
          rechargeCents: totals.rechargeCents + (user.recharge?.totalCents ?? user.wallet.totalRechargeCents ?? 0),
          spendCents: totals.spendCents + (user.usage?.spendCents ?? user.wallet.totalSpendCents ?? 0),
          totalTokens: totals.totalTokens + (user.usage?.totalTokens ?? 0),
          requestCount: totals.requestCount + (user.usage?.requestCount ?? 0)
        }),
        { rechargeCents: 0, spendCents: 0, totalTokens: 0, requestCount: 0 }
      ),
    [users]
  );

  async function loadData(page = pagination.page) {
    setIsLoading(true);
    setError('');

    try {
      const userResult = await listAdminUsers({ page, limit: USER_PAGE_LIMIT });
      setUsers(userResult.items);
      setPagination({
        page: userResult.page,
        limit: userResult.limit,
        total: userResult.total,
        totalPages: Math.max(1, Math.ceil(userResult.total / userResult.limit))
      });
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '用户管理数据加载失败';
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
    <MerchantShell
      activePath="/merchant/users"
      isRefreshing={isLoading}
      onLogout={handleLogout}
      onRefresh={() => void loadData()}
      role={role}
      username={username}
    >
      <section className="admin-content merchant-users-page">
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>用户统计</h1>
            <small>
              每页 {pagination.limit} 条，共 {pagination.total} 个真实用户；充值、消费和 token 都来自数据库聚合。
            </small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadData()} title="刷新用户列表" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="用户总数" value={formatNumber(pagination.total)} detail="未删除用户" />
          <MetricPanel label="本页兑换充值" value={formatBillingUsd(pageTotals.rechargeCents)} detail="按兑换码充值流水" tone="green" />
          <MetricPanel label="本页消费金额" value={formatBillingUsd(pageTotals.spendCents)} detail={`${formatNumber(pageTotals.requestCount)} 条用量记录`} tone="red" />
          <MetricPanel label="本页 Token" value={formatNumber(pageTotals.totalTokens)} detail="输入 + 输出 token" />
        </section>

        <section className="admin-panel">
          <div className="panel-title">
            <TeamOutlined />
            <h2>用户列表</h2>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table merchant-users-table">
              <thead>
                <tr>
                  <th>用户</th>
                  <th>状态</th>
                  <th>兑换充值</th>
                  <th>消费金额</th>
                  <th>Token 消耗</th>
                  <th>请求数 / 最近调用</th>
                  <th>当前余额 / 上次登录</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="table-identity">
                        <UserOutlined />
                        <div>
                          <strong>{user.username}</strong>
                          <small>{user.id}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`status-pill ${getUserStatusClass(user.status)}`}>
                        {user.status}
                      </span>
                      <small className="table-note">{user.role}</small>
                    </td>
                    <td>
                      {formatBillingUsd(user.recharge?.totalCents ?? user.wallet.totalRechargeCents ?? 0)}
                      <small className="table-note">{formatNumber(user.recharge?.count ?? 0)} 次兑换</small>
                    </td>
                    <td>{formatBillingUsd(user.usage?.spendCents ?? user.wallet.totalSpendCents ?? 0)}</td>
                    <td>
                      {formatNumber(user.usage?.totalTokens ?? 0)}
                      <small className="table-note">
                        输入 {formatNumber(user.usage?.promptTokens ?? 0)} / 输出 {formatNumber(user.usage?.completionTokens ?? 0)}
                      </small>
                    </td>
                    <td>
                      {formatNumber(user.usage?.requestCount ?? 0)}
                      <small className="table-note">{formatOptionalDate(user.usage?.lastUsedAt ?? null)}</small>
                    </td>
                    <td>
                      {formatBillingUsd(user.wallet.balanceCents)}
                      <small className="table-note">{formatOptionalDate(user.lastLoginAt)}</small>
                    </td>
                  </tr>
                ))}
                {!users.length && !isLoading ? (
                  <tr>
                    <td colSpan={7}>暂无真实用户记录</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="table-pagination">
            <span>
              第 {pagination.page} / {pagination.totalPages} 页，共 {pagination.total} 条用户
            </span>
            <div className="pagination-actions">
              <button
                className="ghost-button compact-button"
                disabled={isLoading || pagination.page <= 1}
                onClick={() => void loadData(pagination.page - 1)}
                type="button"
              >
                <LeftOutlined />
                上一页
              </button>
              <button
                className="ghost-button compact-button"
                disabled={isLoading || pagination.page >= pagination.totalPages || pagination.total === 0}
                onClick={() => void loadData(pagination.page + 1)}
                type="button"
              >
                下一页
                <RightOutlined />
              </button>
            </div>
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

function getUserStatusClass(status: string) {
  if (status === 'active') {
    return 'status-pill-success';
  }

  if (status === 'risk_locked') {
    return 'status-pill-warning';
  }

  return 'status-pill-danger';
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
