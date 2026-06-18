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
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadData(1);
  }, []);

  const activeUsers = useMemo(() => users.filter((entry) => entry.status === 'active').length, [users]);
  const disabledUsers = useMemo(() => users.filter((entry) => entry.status !== 'active').length, [users]);

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
            <h1>用户管理</h1>
            <small>
              每页 {pagination.limit} 条，共 {pagination.total} 个真实用户；余额和状态来自真实数据库。
            </small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadData()} title="刷新用户列表" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {message ? <p className="form-success">{message}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="用户总数" value={formatNumber(pagination.total)} detail="未删除用户" />
          <MetricPanel label="本页活跃" value={formatNumber(activeUsers)} detail="当前页 active 用户" tone="green" />
          <MetricPanel label="本页非活跃" value={formatNumber(disabledUsers)} detail="禁用或风控用户" tone="red" />
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
                  <th>角色</th>
                  <th>状态</th>
                  <th>客户额度 / 累计扣费</th>
                  <th>上次登录</th>
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
                      <span className={`status-pill ${user.role === 'admin' ? 'status-pill-warning' : 'status-pill-muted'}`}>
                        {user.role}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill ${getUserStatusClass(user.status)}`}>
                        {user.status}
                      </span>
                    </td>
                    <td>
                      {formatMoney(user.wallet.balanceCents)}
                      <small className="table-note">累计 {formatMoney(user.wallet.totalSpendCents ?? 0)}</small>
                    </td>
                    <td>{formatOptionalDate(user.lastLoginAt)}</td>
                  </tr>
                ))}
                {!users.length && !isLoading ? (
                  <tr>
                    <td colSpan={5}>暂无真实用户记录</td>
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

function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) {
    return '-';
  }

  return `¥${(cents / 100).toFixed(2)}`;
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
