'use client';

import { FileTextOutlined, LeftOutlined, ReloadOutlined, RightOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { MerchantShell } from '../../components/merchant-shell';
import {
  listAdminAuditLogs,
  listSecurityAuditLogs,
  type AdminAuditLog,
  type SecurityAuditLog
} from '../../lib/admin-api';
import { logout } from '../../lib/auth-api';

const AUDIT_PAGE_LIMIT = 20;

type PaginationState = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export function MerchantAuditView({ username, role }: { username: string; role: string }) {
  const router = useRouter();
  const [adminAuditLogs, setAdminAuditLogs] = useState<AdminAuditLog[]>([]);
  const [securityAuditLogs, setSecurityAuditLogs] = useState<SecurityAuditLog[]>([]);
  const [adminPagination, setAdminPagination] = useState<PaginationState>(createPagination());
  const [securityPagination, setSecurityPagination] = useState<PaginationState>(createPagination());
  const [isLoading, setIsLoading] = useState(true);
  const [isAdminPageLoading, setIsAdminPageLoading] = useState(false);
  const [isSecurityPageLoading, setIsSecurityPageLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void loadAuditData(1, 1);
  }, []);

  const stats = useMemo(
    () => ({
      adminTotal: adminPagination.total,
      securityTotal: securityPagination.total,
      adminActions: new Set(adminAuditLogs.map((entry) => entry.action)).size,
      securityActions: new Set(securityAuditLogs.map((entry) => entry.action)).size
    }),
    [adminAuditLogs, adminPagination.total, securityAuditLogs, securityPagination.total]
  );

  async function loadAuditData(adminPage = adminPagination.page, securityPage = securityPagination.page) {
    setIsLoading(true);
    setError('');

    try {
      const [adminResult, securityResult] = await Promise.all([
        listAdminAuditLogs({ page: adminPage, limit: AUDIT_PAGE_LIMIT }),
        listSecurityAuditLogs({ page: securityPage, limit: AUDIT_PAGE_LIMIT })
      ]);
      setAdminAuditLogs(adminResult.items);
      setSecurityAuditLogs(securityResult.items);
      setAdminPagination(toPagination(adminResult));
      setSecurityPagination(toPagination(securityResult));
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '审计数据加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAdminPageChange(page: number) {
    setError('');
    setIsAdminPageLoading(true);

    try {
      const result = await listAdminAuditLogs({ page, limit: AUDIT_PAGE_LIMIT });
      setAdminAuditLogs(result.items);
      setAdminPagination(toPagination(result));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '后台审计分页加载失败');
    } finally {
      setIsAdminPageLoading(false);
    }
  }

  async function handleSecurityPageChange(page: number) {
    setError('');
    setIsSecurityPageLoading(true);

    try {
      const result = await listSecurityAuditLogs({ page, limit: AUDIT_PAGE_LIMIT });
      setSecurityAuditLogs(result.items);
      setSecurityPagination(toPagination(result));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '安全审计分页加载失败');
    } finally {
      setIsSecurityPageLoading(false);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <MerchantShell
      activePath="/merchant/audit"
      isRefreshing={isLoading}
      onLogout={handleLogout}
      onRefresh={() => void loadAuditData()}
      role={role}
      username={username}
    >
      <section className="admin-content merchant-audit-page" data-page="merchant-audit">
        <div className="admin-heading merchant-dashboard-heading">
          <div>
            <p className="eyebrow">商家工作台</p>
            <h1>审计记录</h1>
            <small>后台审计和安全审计只读展示，敏感内容由后端脱敏后返回。</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadAuditData()} title="刷新审计" type="button">
            <ReloadOutlined />
          </button>
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <section className="admin-metrics">
          <MetricPanel label="后台审计" value={formatNumber(stats.adminTotal)} detail="管理员操作记录" />
          <MetricPanel label="安全审计" value={formatNumber(stats.securityTotal)} detail="登录和安全动作" />
          <MetricPanel label="本页后台动作" value={formatNumber(stats.adminActions)} detail="当前页动作类型" />
          <MetricPanel label="本页安全动作" value={formatNumber(stats.securityActions)} detail="当前页动作类型" />
        </section>

        <section className="admin-grid">
          <section className="admin-panel">
            <div className="panel-title">
              <FileTextOutlined />
              <h2>后台审计</h2>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table audit-table">
                <thead>
                  <tr>
                    <th>动作</th>
                    <th>目标</th>
                    <th>管理员</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {adminAuditLogs.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatAuditAction(entry.action)}</td>
                      <td>
                        {formatTargetType(entry.targetType)}
                        <small className="table-note">{formatShortId(entry.targetId)}</small>
                      </td>
                      <td>{entry.admin.username}</td>
                      <td>{formatOptionalDate(entry.createdAt)}</td>
                    </tr>
                  ))}
                  {!adminAuditLogs.length && !isLoading ? (
                    <tr>
                      <td colSpan={4}>暂无真实后台审计记录</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <PaginationControls
              isLoading={isAdminPageLoading}
              onChange={(page) => void handleAdminPageChange(page)}
              pagination={adminPagination}
            />
          </section>

          <section className="admin-panel">
            <div className="panel-title">
              <FileTextOutlined />
              <h2>安全审计</h2>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table audit-table">
                <thead>
                  <tr>
                    <th>动作</th>
                    <th>目标</th>
                    <th>账号</th>
                    <th>IP</th>
                    <th>时间</th>
                  </tr>
                </thead>
                <tbody>
                  {securityAuditLogs.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatAuditAction(entry.action)}</td>
                      <td>
                        {formatTargetType(entry.targetType)}
                        <small className="table-note">{formatShortId(entry.targetId)}</small>
                      </td>
                      <td>{entry.actor?.username ?? '-'}</td>
                      <td>{entry.ipAddress ?? '-'}</td>
                      <td>{formatOptionalDate(entry.createdAt)}</td>
                    </tr>
                  ))}
                  {!securityAuditLogs.length && !isLoading ? (
                    <tr>
                      <td colSpan={5}>暂无真实安全审计记录</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <PaginationControls
              isLoading={isSecurityPageLoading}
              onChange={(page) => void handleSecurityPageChange(page)}
              pagination={securityPagination}
            />
          </section>
        </section>
      </section>
    </MerchantShell>
  );
}

function MetricPanel({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="metric-panel">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function PaginationControls({
  pagination,
  isLoading,
  onChange
}: {
  pagination: PaginationState;
  isLoading: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <div className="table-pagination">
      <span>
        第 {pagination.page} / {pagination.totalPages} 页，共 {pagination.total} 条记录
      </span>
      <div className="pagination-actions">
        <button
          className="ghost-button compact-button"
          disabled={isLoading || pagination.page <= 1}
          onClick={() => onChange(pagination.page - 1)}
          type="button"
        >
          <LeftOutlined />
          上一页
        </button>
        <button
          className="ghost-button compact-button"
          disabled={isLoading || pagination.page >= pagination.totalPages || pagination.total === 0}
          onClick={() => onChange(pagination.page + 1)}
          type="button"
        >
          下一页
          <RightOutlined />
        </button>
      </div>
    </div>
  );
}

function createPagination(): PaginationState {
  return {
    page: 1,
    limit: AUDIT_PAGE_LIMIT,
    total: 0,
    totalPages: 1
  };
}

function toPagination(result: { page: number; limit: number; total: number }) {
  return {
    page: result.page,
    limit: result.limit,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / result.limit))
  };
}

function formatAuditAction(action: string) {
  const labels: Record<string, string> = {
    announcement_created: '创建公告',
    api_token_created: '创建令牌',
    api_token_deleted: '删除令牌',
    api_token_disabled: '禁用令牌',
    api_token_reset: '重置令牌',
    recharge_code_created: '生成充值码',
    recharge_code_disabled: '禁用充值码',
    upstream_model_created: '创建模型映射',
    upstream_provider_created: '创建上游',
    upstream_provider_health_checked: '检查上游',
    user_group_assigned: '调整用户归属',
    user_group_created: '创建默认归属',
    user_login_succeeded: '登录成功',
    user_logged_out: '退出登录',
    user_password_changed: '修改密码',
    user_registered: '注册账号'
  };

  return labels[action] ?? action.replace(/_/g, ' ');
}

function formatTargetType(targetType: string) {
  const labels: Record<string, string> = {
    announcement: '公告',
    api_token: '令牌',
    recharge_code: '充值码',
    upstream_model: '模型映射',
    upstream_provider: '上游',
    user: '用户',
    user_group: '用户归属'
  };

  return labels[targetType] ?? targetType.replace(/_/g, ' ');
}

function formatShortId(value: string | null) {
  if (!value) {
    return '-';
  }

  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-6)}`;
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
