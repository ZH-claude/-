'use client';

import {
  ApiOutlined,
  BellOutlined,
  CloudServerOutlined,
  ExperimentOutlined,
  FileTextOutlined,
  GiftOutlined,
  LeftOutlined,
  RightOutlined,
  SendOutlined,
  TeamOutlined
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { MerchantShell } from '../components/merchant-shell';
import {
  assignUserGroup,
  checkUpstreamHealth,
  createAnnouncement,
  createModelPrice,
  createRechargeCodes,
  createUpstreamModel,
  createUpstreamProvider,
  createUserGroup,
  disableRechargeCode,
  listAdminAuditLogs,
  listAdminUsers,
  listAnnouncements,
  listModelConfiguration,
  listRechargeCodes,
  listSecurityAuditLogs,
  listUpstreamProviders
} from '../lib/admin-api';
import type {
  AdminAuditLog,
  AdminGroup,
  AdminModelPrice,
  AdminRechargeCode,
  AdminUser,
  Announcement,
  AnnouncementCategory,
  CreatedRechargeCode,
  SecurityAuditLog,
  UpstreamModelMapping,
  UpstreamProvider
} from '../lib/admin-api';
import { logout } from '../lib/auth-api';

const UPSTREAM_MAPPING_PAGE_LIMIT = 100;
const DEFAULT_UPSTREAM_MODEL_PAGINATION = {
  page: 1,
  limit: UPSTREAM_MAPPING_PAGE_LIMIT,
  total: 0,
  totalPages: 1
};

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [upstreams, setUpstreams] = useState<UpstreamProvider[]>([]);
  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [models, setModels] = useState<AdminModelPrice[]>([]);
  const [upstreamModels, setUpstreamModels] = useState<UpstreamModelMapping[]>([]);
  const [rechargeCodes, setRechargeCodes] = useState<AdminRechargeCode[]>([]);
  const [adminAuditLogs, setAdminAuditLogs] = useState<AdminAuditLog[]>([]);
  const [securityAuditLogs, setSecurityAuditLogs] = useState<SecurityAuditLog[]>([]);
  const [createdRechargeCodes, setCreatedRechargeCodes] = useState<CreatedRechargeCode[]>([]);
  const [upstreamModelPagination, setUpstreamModelPagination] = useState(DEFAULT_UPSTREAM_MODEL_PAGINATION);
  const [totalUsers, setTotalUsers] = useState(0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('announcement');
  const [status, setStatus] = useState<'draft' | 'published'>('published');
  const [upstreamName, setUpstreamName] = useState('');
  const [upstreamBaseUrl, setUpstreamBaseUrl] = useState('');
  const [upstreamApiKey, setUpstreamApiKey] = useState('');
  const [upstreamStatus, setUpstreamStatus] = useState<'active' | 'disabled'>('active');
  const [groupCode, setGroupCode] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupMultiplier, setGroupMultiplier] = useState('1.0000');
  const [groupStatus, setGroupStatus] = useState<'active' | 'disabled'>('active');
  const [assignUserId, setAssignUserId] = useState('');
  const [assignGroupId, setAssignGroupId] = useState('');
  const [modelName, setModelName] = useState('');
  const [modelDisplayName, setModelDisplayName] = useState('');
  const [inputPriceCentsPer1k, setInputPriceCentsPer1k] = useState('0');
  const [outputPriceCentsPer1k, setOutputPriceCentsPer1k] = useState('0');
  const [modelMultiplier, setModelMultiplier] = useState('1.0000');
  const [modelStatus, setModelStatus] = useState<'active' | 'disabled'>('active');
  const [modelGroupIds, setModelGroupIds] = useState<string[]>([]);
  const [upstreamModelProviderId, setUpstreamModelProviderId] = useState('');
  const [upstreamPublicModel, setUpstreamPublicModel] = useState('');
  const [upstreamModelName, setUpstreamModelName] = useState('');
  const [upstreamModelStatus, setUpstreamModelStatus] = useState<'active' | 'disabled'>('active');
  const [supportsStream, setSupportsStream] = useState(true);
  const [rechargeAmountCents, setRechargeAmountCents] = useState('1000');
  const [rechargeCodeCount, setRechargeCodeCount] = useState('1');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUpstreamSubmitting, setIsUpstreamSubmitting] = useState(false);
  const [isGroupSubmitting, setIsGroupSubmitting] = useState(false);
  const [isModelSubmitting, setIsModelSubmitting] = useState(false);
  const [isMappingSubmitting, setIsMappingSubmitting] = useState(false);
  const [isRechargeSubmitting, setIsRechargeSubmitting] = useState(false);
  const [isMappingPageLoading, setIsMappingPageLoading] = useState(false);
  const [isAssigningGroup, setIsAssigningGroup] = useState(false);
  const [checkingUpstreamId, setCheckingUpstreamId] = useState<string | null>(null);

  useEffect(() => {
    void loadAdminData();
  }, []);

  async function loadAdminData() {
    setIsLoading(true);
    setError('');

    try {
      const [
        userResult,
        announcementResult,
        upstreamResult,
        modelConfigResult,
        rechargeCodeResult,
        adminAuditResult,
        securityAuditResult
      ] = await Promise.all([
        listAdminUsers(),
        listAnnouncements(),
        listUpstreamProviders(),
        listModelConfiguration({
          upstreamModelsPage: 1,
          upstreamModelsLimit: UPSTREAM_MAPPING_PAGE_LIMIT
        }),
        listRechargeCodes(),
        listAdminAuditLogs({ limit: 10 }),
        listSecurityAuditLogs({ limit: 10 })
      ]);
      setUsers(userResult.items);
      setTotalUsers(userResult.total);
      setAnnouncements(announcementResult.items);
      setUpstreams(upstreamResult.items);
      applyModelConfiguration(modelConfigResult, upstreamResult.items);
      setRechargeCodes(rechargeCodeResult.items);
      setAdminAuditLogs(adminAuditResult.items);
      setSecurityAuditLogs(securityAuditResult.items);
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '后台数据加载失败';
      setError(nextMessage);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      setIsLoading(false);
    }
  }

  function applyModelConfiguration(
    result: Awaited<ReturnType<typeof listModelConfiguration>>,
    providerOptions: UpstreamProvider[] = upstreams
  ) {
    setGroups(result.groups);
    setModels(result.models);
    setUpstreamModels(result.upstreamModels);
    setUpstreamModelPagination(result.upstreamModelsPagination);
    setAssignGroupId((current) => current || result.groups[0]?.id || '');
    setModelGroupIds((current) => (current.length ? current : result.groups[0] ? [result.groups[0].id] : []));
    setUpstreamModelProviderId((current) => current || providerOptions[0]?.id || '');
    setUpstreamPublicModel((current) => current || result.models[0]?.model || '');
  }

  async function refreshModelConfiguration(page = upstreamModelPagination.page) {
    const modelConfigResult = await listModelConfiguration({
      upstreamModelsPage: page,
      upstreamModelsLimit: UPSTREAM_MAPPING_PAGE_LIMIT
    });
    applyModelConfiguration(modelConfigResult);
  }

  async function handleUpstreamModelPageChange(page: number) {
    setError('');
    setMessage('');
    setIsMappingPageLoading(true);

    try {
      await refreshModelConfiguration(page);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '上游模型映射分页加载失败');
    } finally {
      setIsMappingPageLoading(false);
    }
  }

  async function handleCreateAnnouncement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsSubmitting(true);

    try {
      await createAnnouncement({ title, content, category, status });
      setTitle('');
      setContent('');
      setCategory('announcement');
      setStatus('published');
      setMessage('公告已保存');
      const announcementResult = await listAnnouncements();
      setAnnouncements(announcementResult.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '公告保存失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCreateUpstream(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsUpstreamSubmitting(true);

    try {
      await createUpstreamProvider({
        name: upstreamName,
        baseUrl: upstreamBaseUrl,
        apiKey: upstreamApiKey,
        status: upstreamStatus
      });
      setUpstreamName('');
      setUpstreamBaseUrl('');
      setUpstreamApiKey('');
      setUpstreamStatus('active');
      setMessage('上游配置已保存');
      const upstreamResult = await listUpstreamProviders();
      setUpstreams(upstreamResult.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '上游配置保存失败');
    } finally {
      setIsUpstreamSubmitting(false);
    }
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsGroupSubmitting(true);

    try {
      await createUserGroup({
        code: groupCode,
        name: groupName,
        multiplier: groupMultiplier,
        status: groupStatus
      });
      setGroupCode('');
      setGroupName('');
      setGroupMultiplier('1.0000');
      setGroupStatus('active');
      setMessage('分组已保存');
      await refreshModelConfiguration();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '分组保存失败');
    } finally {
      setIsGroupSubmitting(false);
    }
  }

  async function handleAssignUserGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsAssigningGroup(true);

    try {
      const updatedUser = await assignUserGroup(assignUserId, { groupId: assignGroupId });
      setUsers((currentUsers) => currentUsers.map((user) => (user.id === updatedUser.id ? updatedUser : user)));
      setAssignUserId('');
      setMessage('用户分组已更新');
      await refreshModelConfiguration();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '用户分组更新失败');
    } finally {
      setIsAssigningGroup(false);
    }
  }

  async function handleCreateModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsModelSubmitting(true);

    try {
      await createModelPrice({
        model: modelName,
        displayName: modelDisplayName || undefined,
        inputPriceCentsPer1k: Number(inputPriceCentsPer1k),
        outputPriceCentsPer1k: Number(outputPriceCentsPer1k),
        modelMultiplier,
        status: modelStatus,
        groupIds: modelGroupIds
      });
      setModelName('');
      setModelDisplayName('');
      setInputPriceCentsPer1k('0');
      setOutputPriceCentsPer1k('0');
      setModelMultiplier('1.0000');
      setModelStatus('active');
      setMessage('模型价格已保存');
      await refreshModelConfiguration();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '模型价格保存失败');
    } finally {
      setIsModelSubmitting(false);
    }
  }

  async function handleCreateUpstreamModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setIsMappingSubmitting(true);

    try {
      await createUpstreamModel({
        providerId: upstreamModelProviderId,
        publicModel: upstreamPublicModel,
        upstreamModel: upstreamModelName,
        status: upstreamModelStatus,
        supportsStream
      });
      setUpstreamModelName('');
      setUpstreamModelStatus('active');
      setSupportsStream(true);
      setMessage('上游模型映射已保存');
      await refreshModelConfiguration(1);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '上游模型映射保存失败');
    } finally {
      setIsMappingSubmitting(false);
    }
  }

  async function handleCreateRechargeCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');
    setCreatedRechargeCodes([]);
    setIsRechargeSubmitting(true);

    try {
      const result = await createRechargeCodes({
        amountCents: Number(rechargeAmountCents),
        count: Number(rechargeCodeCount)
      });
      setCreatedRechargeCodes(result.items);
      setRechargeCodeCount('1');
      setMessage(`已生成 ${result.items.length} 张兑换码`);
      const rechargeCodeResult = await listRechargeCodes();
      setRechargeCodes(rechargeCodeResult.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '兑换码生成失败');
    } finally {
      setIsRechargeSubmitting(false);
    }
  }

  async function handleDisableRechargeCode(codeId: string) {
    setError('');
    setMessage('');

    try {
      await disableRechargeCode(codeId);
      setMessage('兑换码已禁用');
      const rechargeCodeResult = await listRechargeCodes();
      setRechargeCodes(rechargeCodeResult.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '兑换码禁用失败');
    }
  }

  async function handleCopyRechargeCode(code: string) {
    await navigator.clipboard.writeText(code);
    setMessage('兑换码已复制');
  }

  async function handleCheckUpstream(providerId: string) {
    setError('');
    setMessage('');
    setCheckingUpstreamId(providerId);

    try {
      const result = await checkUpstreamHealth(providerId);
      setUpstreams((currentUpstreams) =>
        currentUpstreams.map((upstream) => (upstream.id === providerId ? result.provider : upstream))
      );
      setMessage(result.reachable ? '上游连通性验证通过' : '上游连通性验证失败');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '上游连通性验证失败');
    } finally {
      setCheckingUpstreamId(null);
    }
  }

  async function handleLogout() {
    await logout().catch(() => undefined);
    router.replace('/login');
  }

  return (
    <MerchantShell activePath="/admin" isRefreshing={isLoading} onLogout={handleLogout} onRefresh={() => void loadAdminData()}>
      <section className="admin-content">
        <div className="admin-heading" id="merchant-dashboard">
          <div>
            <p className="eyebrow">管理后台</p>
            <h1>用户与公告</h1>
          </div>
        </div>

          {error ? <p className="form-error">{error}</p> : null}
          {message ? <p className="form-success">{message}</p> : null}

          <div className="admin-metrics">
            <section className="metric-panel">
              <span>用户总数</span>
              <strong>{isLoading ? '-' : totalUsers}</strong>
              <small>最多显示最近 100 个用户</small>
            </section>
            <section className="metric-panel">
              <span>公告数量</span>
              <strong>{isLoading ? '-' : announcements.length}</strong>
              <small>包含草稿和已发布</small>
            </section>
            <section className="metric-panel">
              <span>Upstreams</span>
              <strong>{isLoading ? '-' : upstreams.length}</strong>
              <small>configured provider connections</small>
            </section>
            <section className="metric-panel">
              <span>Models</span>
              <strong>{isLoading ? '-' : models.length}</strong>
              <small>{groups.length} groups configured</small>
            </section>
          </div>

          <section className="admin-panel" id="merchant-recharge-codes">
            <div className="panel-title">
              <GiftOutlined />
              <h2>兑换码</h2>
            </div>
            <form className="auth-form mapping-form" onSubmit={handleCreateRechargeCodes}>
              <label>
                金额
                <input
                  min="1"
                  max="100000000"
                  onChange={(event) => setRechargeAmountCents(event.target.value)}
                  required
                  step="1"
                  type="number"
                  value={rechargeAmountCents}
                />
              </label>
              <label>
                数量
                <input
                  min="1"
                  max="100"
                  onChange={(event) => setRechargeCodeCount(event.target.value)}
                  required
                  step="1"
                  type="number"
                  value={rechargeCodeCount}
                />
              </label>
              <button className="primary-button" disabled={isRechargeSubmitting} type="submit">
                <GiftOutlined />
                {isRechargeSubmitting ? '生成中' : '生成兑换码'}
              </button>
            </form>

            {createdRechargeCodes.length ? (
              <div className="one-time-key-box recharge-code-box">
                <div>
                  <strong>本次生成</strong>
                  {createdRechargeCodes.map((entry) => (
                    <code key={entry.id}>{entry.code}</code>
                  ))}
                </div>
                <button
                  className="ghost-button compact-button"
                  onClick={() => void handleCopyRechargeCode(createdRechargeCodes.map((entry) => entry.code).join('\n'))}
                  type="button"
                >
                  复制全部
                </button>
              </div>
            ) : null}

            <div className="admin-table-wrap compact-table">
              <table className="admin-table recharge-code-table">
                <thead>
                  <tr>
                    <th>金额</th>
                    <th>状态</th>
                    <th>创建人</th>
                    <th>使用人</th>
                    <th>使用时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rechargeCodes.map((entry) => (
                    <tr key={entry.id}>
                      <td>{formatCents(entry.amountCents)}</td>
                      <td>
                        <span className={`status-pill ${getRechargeStatusClass(entry.status)}`}>
                          {entry.status}
                        </span>
                      </td>
                      <td>{entry.createdBy ?? '-'}</td>
                      <td>{entry.usedBy ?? '-'}</td>
                      <td>{formatOptionalDate(entry.usedAt)}</td>
                      <td>
                        <button
                          className="ghost-button compact-button"
                          disabled={entry.status !== 'unused'}
                          onClick={() => void handleDisableRechargeCode(entry.id)}
                          type="button"
                        >
                          禁用
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!rechargeCodes.length && !isLoading ? (
                    <tr>
                      <td colSpan={6}>暂无兑换码</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-grid" id="merchant-models">
            <section className="admin-panel" id="merchant-groups">
              <div className="panel-title">
                <TeamOutlined />
                <h2>分组配置</h2>
              </div>
              <form className="auth-form compact-form" onSubmit={handleCreateGroup}>
                <label>
                  Code
                  <input
                    maxLength={40}
                    minLength={2}
                    onChange={(event) => setGroupCode(event.target.value)}
                    placeholder="输入分组代码"
                    required
                    value={groupCode}
                  />
                </label>
                <label>
                  名称
                  <input
                    maxLength={80}
                    minLength={2}
                    onChange={(event) => setGroupName(event.target.value)}
                    required
                    value={groupName}
                  />
                </label>
                <label>
                  分组倍率
                  <input
                    min="0.0001"
                    max="100"
                    onChange={(event) => setGroupMultiplier(event.target.value)}
                    required
                    step="0.0001"
                    type="number"
                    value={groupMultiplier}
                  />
                </label>
                <label>
                  状态
                  <select
                    onChange={(event) => setGroupStatus(event.target.value as 'active' | 'disabled')}
                    value={groupStatus}
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                </label>
                <button className="primary-button" disabled={isGroupSubmitting} type="submit">
                  <TeamOutlined />
                  {isGroupSubmitting ? 'Saving' : 'Save group'}
                </button>
              </form>
              <div className="admin-table-wrap compact-table">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Multiplier</th>
                      <th>Status</th>
                      <th>Users</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr key={group.id}>
                        <td>{group.code}</td>
                        <td>{group.name}</td>
                        <td>{group.multiplier}</td>
                        <td>{group.status}</td>
                        <td>{group.userCount}</td>
                      </tr>
                    ))}
                    {!groups.length && !isLoading ? (
                      <tr>
                        <td colSpan={5}>暂无分组</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="admin-panel" id="merchant-model-prices">
              <div className="panel-title">
                <ApiOutlined />
                <h2>模型价格</h2>
              </div>
              <form className="auth-form compact-form" onSubmit={handleCreateModel}>
                <label>
                  Public model
                  <input
                    maxLength={120}
                    minLength={2}
                    onChange={(event) => setModelName(event.target.value)}
                    placeholder="输入公开模型名"
                    required
                    value={modelName}
                  />
                </label>
                <label>
                  Display name
                  <input
                    maxLength={120}
                    onChange={(event) => setModelDisplayName(event.target.value)}
                    value={modelDisplayName}
                  />
                </label>
                <div className="form-row">
                  <label>
                    Input / 1K
                    <input
                      min="0"
                      onChange={(event) => setInputPriceCentsPer1k(event.target.value)}
                      required
                      step="1"
                      type="number"
                      value={inputPriceCentsPer1k}
                    />
                  </label>
                  <label>
                    Output / 1K
                    <input
                      min="0"
                      onChange={(event) => setOutputPriceCentsPer1k(event.target.value)}
                      required
                      step="1"
                      type="number"
                      value={outputPriceCentsPer1k}
                    />
                  </label>
                </div>
                <label>
                  模型倍率
                  <input
                    min="0.0001"
                    max="100"
                    onChange={(event) => setModelMultiplier(event.target.value)}
                    required
                    step="0.0001"
                    type="number"
                    value={modelMultiplier}
                  />
                </label>
                <label>
                  可见分组
                  <select
                    className="multi-select"
                    multiple
                    onChange={(event) =>
                      setModelGroupIds(Array.from(event.currentTarget.selectedOptions, (option) => option.value))
                    }
                    required
                    value={modelGroupIds}
                  >
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name} ({group.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  状态
                  <select
                    onChange={(event) => setModelStatus(event.target.value as 'active' | 'disabled')}
                    value={modelStatus}
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                </label>
                <button className="primary-button" disabled={isModelSubmitting} type="submit">
                  <ApiOutlined />
                  {isModelSubmitting ? 'Saving' : 'Save model'}
                </button>
              </form>
              <div className="admin-table-wrap compact-table">
                <table className="admin-table model-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>Price</th>
                      <th>Groups</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {models.map((model) => (
                      <tr key={model.id}>
                        <td>
                          {model.model}
                          {model.displayName ? <small className="table-note">{model.displayName}</small> : null}
                        </td>
                        <td>
                          {model.inputPriceCentsPer1k}/{model.outputPriceCentsPer1k}
                          <small className="table-note">x {model.modelMultiplier}</small>
                        </td>
                        <td>{model.groups.map((group) => group.code).join(', ') || '-'}</td>
                        <td>{model.status}</td>
                      </tr>
                    ))}
                    {!models.length && !isLoading ? (
                      <tr>
                        <td colSpan={4}>No models configured</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <section className="admin-panel" id="merchant-upstream-models">
            <div className="panel-title">
              <ExperimentOutlined />
              <h2>上游模型映射</h2>
            </div>
            <form className="auth-form mapping-form" onSubmit={handleCreateUpstreamModel}>
              <label>
                Provider
                <select
                  onChange={(event) => setUpstreamModelProviderId(event.target.value)}
                  required
                  value={upstreamModelProviderId}
                >
                  <option value="">Select provider</option>
                  {upstreams.map((upstream) => (
                    <option key={upstream.id} value={upstream.id}>
                      {upstream.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Public model
                <select
                  onChange={(event) => setUpstreamPublicModel(event.target.value)}
                  required
                  value={upstreamPublicModel}
                >
                  <option value="">Select model</option>
                  {models.map((model) => (
                    <option key={model.id} value={model.model}>
                      {model.model}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Upstream model
                <input
                  maxLength={120}
                  minLength={2}
                  onChange={(event) => setUpstreamModelName(event.target.value)}
                  placeholder="输入上游实际模型名"
                  required
                  value={upstreamModelName}
                />
              </label>
              <label>
                状态
                <select
                  onChange={(event) => setUpstreamModelStatus(event.target.value as 'active' | 'disabled')}
                  value={upstreamModelStatus}
                >
                  <option value="active">active</option>
                  <option value="disabled">disabled</option>
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  checked={supportsStream}
                  onChange={(event) => setSupportsStream(event.target.checked)}
                  type="checkbox"
                />
                Stream
              </label>
              <button className="primary-button" disabled={isMappingSubmitting} type="submit">
                <ExperimentOutlined />
                {isMappingSubmitting ? 'Saving' : 'Save mapping'}
              </button>
            </form>
            <div className="admin-table-wrap">
              <table className="admin-table model-table">
                <thead>
                  <tr>
                    <th>Public</th>
                    <th>Upstream</th>
                    <th>Provider</th>
                    <th>Status</th>
                    <th>Stream</th>
                  </tr>
                </thead>
                <tbody>
                  {upstreamModels.map((mapping) => (
                    <tr key={mapping.id}>
                      <td>{mapping.publicModel}</td>
                      <td>{mapping.upstreamModel}</td>
                      <td>
                        {mapping.providerName}
                        <small className="table-note">{mapping.providerStatus}</small>
                      </td>
                      <td>{mapping.status}</td>
                      <td>{mapping.supportsStream ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                  {!upstreamModels.length && !isLoading ? (
                    <tr>
                      <td colSpan={5}>No mappings configured</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span>
                第 {upstreamModelPagination.page} / {upstreamModelPagination.totalPages} 页，共{' '}
                {upstreamModelPagination.total} 条映射
              </span>
              <div className="pagination-actions">
                <button
                  className="ghost-button compact-button"
                  disabled={isMappingPageLoading || upstreamModelPagination.page <= 1}
                  onClick={() => void handleUpstreamModelPageChange(upstreamModelPagination.page - 1)}
                  type="button"
                >
                  <LeftOutlined />
                  上一页
                </button>
                <button
                  className="ghost-button compact-button"
                  disabled={
                    isMappingPageLoading ||
                    upstreamModelPagination.page >= upstreamModelPagination.totalPages ||
                    upstreamModelPagination.total === 0
                  }
                  onClick={() => void handleUpstreamModelPageChange(upstreamModelPagination.page + 1)}
                  type="button"
                >
                  下一页
                  <RightOutlined />
                </button>
              </div>
            </div>
          </section>

          <section className="admin-grid" id="merchant-upstreams">
            <section className="admin-panel">
              <div className="panel-title">
                <CloudServerOutlined />
                <h2>Upstream config</h2>
              </div>
              <form className="auth-form compact-form" onSubmit={handleCreateUpstream}>
                <label>
                  Name
                  <input
                    maxLength={80}
                    minLength={2}
                    onChange={(event) => setUpstreamName(event.target.value)}
                    required
                    value={upstreamName}
                  />
                </label>
                <label>
                  Base URL
                  <input
                    maxLength={2048}
                    minLength={8}
                    onChange={(event) => setUpstreamBaseUrl(event.target.value)}
                    placeholder="输入上游 Base URL"
                    required
                    type="url"
                    value={upstreamBaseUrl}
                  />
                </label>
                <label>
                  API Key
                  <input
                    autoComplete="off"
                    maxLength={512}
                    minLength={8}
                    onChange={(event) => setUpstreamApiKey(event.target.value)}
                    required
                    type="password"
                    value={upstreamApiKey}
                  />
                </label>
                <label>
                  Status
                  <select
                    onChange={(event) => setUpstreamStatus(event.target.value as 'active' | 'disabled')}
                    value={upstreamStatus}
                  >
                    <option value="active">active</option>
                    <option value="disabled">disabled</option>
                  </select>
                </label>
                <button className="primary-button" disabled={isUpstreamSubmitting} type="submit">
                  <ApiOutlined />
                  {isUpstreamSubmitting ? 'Saving' : 'Save upstream'}
                </button>
              </form>
            </section>

            <section className="admin-panel" id="merchant-service-status">
              <div className="panel-title">
                <ExperimentOutlined />
                <h2>Health check</h2>
              </div>
              <div className="admin-table-wrap">
                <table className="admin-table upstream-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Base URL</th>
                      <th>Key</th>
                      <th>Health</th>
                      <th>Last check</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upstreams.map((upstream) => (
                      <tr key={upstream.id}>
                        <td>{upstream.name}</td>
                        <td>{upstream.baseUrl}</td>
                        <td>{upstream.apiKeyPreview}</td>
                        <td>
                          <span className={`status-pill ${getHealthClass(upstream.healthStatus)}`}>
                            {formatHealthStatus(upstream.healthStatus)}
                          </span>
                          {upstream.lastHealthError ? <small className="table-note">{upstream.lastHealthError}</small> : null}
                        </td>
                        <td>
                          {formatOptionalDate(upstream.lastHealthCheckAt)}
                          {upstream.lastHealthLatencyMs !== null ? (
                            <small className="table-note">{upstream.lastHealthLatencyMs}ms</small>
                          ) : null}
                        </td>
                        <td>
                          <button
                            className="ghost-button compact-button"
                            disabled={checkingUpstreamId === upstream.id}
                            onClick={() => void handleCheckUpstream(upstream.id)}
                            type="button"
                          >
                            <ExperimentOutlined />
                            {checkingUpstreamId === upstream.id ? 'Checking' : 'Check'}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {!upstreams.length && !isLoading ? (
                      <tr>
                        <td colSpan={6}>No upstream configured</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <section className="admin-panel" id="merchant-users">
            <div className="panel-title">
              <TeamOutlined />
              <h2>用户列表</h2>
            </div>
            <form className="auth-form mapping-form" onSubmit={handleAssignUserGroup}>
              <label>
                User
                <select onChange={(event) => setAssignUserId(event.target.value)} required value={assignUserId}>
                  <option value="">Select user</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.username}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Group
                <select onChange={(event) => setAssignGroupId(event.target.value)} required value={assignGroupId}>
                  <option value="">Select group</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name} ({group.code})
                    </option>
                  ))}
                </select>
              </label>
              <button className="primary-button" disabled={isAssigningGroup} type="submit">
                <TeamOutlined />
                {isAssigningGroup ? 'Saving' : 'Assign group'}
              </button>
            </form>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>用户名</th>
                    <th>角色</th>
                    <th>状态</th>
                    <th>分组</th>
                    <th>余额</th>
                    <th>上次登录</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.username}</td>
                      <td>{user.role}</td>
                      <td>{user.status}</td>
                      <td>{user.group.name}</td>
                      <td>{formatCents(user.wallet.balanceCents)}</td>
                      <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '-'}</td>
                    </tr>
                  ))}
                  {!users.length && !isLoading ? (
                    <tr>
                      <td colSpan={6}>暂无用户</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-grid" id="merchant-announcements">
            <section className="admin-panel">
              <div className="panel-title">
                <SendOutlined />
                <h2>发布公告</h2>
              </div>
              <form className="auth-form compact-form" onSubmit={handleCreateAnnouncement}>
                <label>
                  标题
                  <input
                    maxLength={120}
                    minLength={3}
                    onChange={(event) => setTitle(event.target.value)}
                    required
                    value={title}
                  />
                </label>
                <label>
                  内容
                  <textarea
                    maxLength={5000}
                    onChange={(event) => setContent(event.target.value)}
                    required
                    rows={6}
                    value={content}
                  />
                </label>
                <label>
                  分类
                  <select
                    onChange={(event) => setCategory(event.target.value as AnnouncementCategory)}
                    value={category}
                  >
                    <option value="announcement">平台公告</option>
                    <option value="update_log">更新日志</option>
                    <option value="usage_guide">使用建议</option>
                  </select>
                </label>
                <label>
                  状态
                  <select onChange={(event) => setStatus(event.target.value as 'draft' | 'published')} value={status}>
                    <option value="published">发布</option>
                    <option value="draft">草稿</option>
                  </select>
                </label>
                <button className="primary-button" disabled={isSubmitting} type="submit">
                  <SendOutlined />
                  {isSubmitting ? '保存中' : '保存公告'}
                </button>
              </form>
            </section>

            <section className="admin-panel">
              <div className="panel-title">
                <BellOutlined />
                <h2>公告记录</h2>
              </div>
              <div className="announcement-list">
                {announcements.map((announcement) => (
                  <article className="announcement-item" key={announcement.id}>
                    <div>
                      <strong>{announcement.title}</strong>
                      <span>{formatAnnouncementCategory(announcement.category)} · {announcement.status}</span>
                    </div>
                    <p>{announcement.content}</p>
                    <small>
                      {announcement.publishedAt
                        ? `发布时间 ${new Date(announcement.publishedAt).toLocaleString()}`
                        : '未发布'}
                    </small>
                  </article>
                ))}
                {!announcements.length && !isLoading ? <p className="empty-state">暂无公告</p> : null}
              </div>
            </section>
          </section>

          <section className="admin-grid" id="merchant-audit">
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
                        <td>{entry.action}</td>
                        <td>
                          {entry.targetType}
                          <small className="table-note">{entry.targetId ?? '-'}</small>
                        </td>
                        <td>{entry.admin.username}</td>
                        <td>{formatOptionalDate(entry.createdAt)}</td>
                      </tr>
                    ))}
                    {!adminAuditLogs.length && !isLoading ? (
                      <tr>
                        <td colSpan={4}>暂无后台审计</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
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
                        <td>{entry.action}</td>
                        <td>
                          {entry.targetType}
                          <small className="table-note">{entry.targetId ?? '-'}</small>
                        </td>
                        <td>{entry.actor?.username ?? '-'}</td>
                        <td>{entry.ipAddress ?? '-'}</td>
                        <td>{formatOptionalDate(entry.createdAt)}</td>
                      </tr>
                    ))}
                    {!securityAuditLogs.length && !isLoading ? (
                      <tr>
                        <td colSpan={5}>暂无安全审计</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
      </section>
    </MerchantShell>
  );
}

function formatOptionalDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

function formatHealthStatus(status: string) {
  if (status === 'healthy') {
    return 'healthy';
  }

  if (status === 'unhealthy') {
    return 'unhealthy';
  }

  return 'unknown';
}

function formatAnnouncementCategory(category: AnnouncementCategory) {
  const labels: Record<AnnouncementCategory, string> = {
    announcement: '平台公告',
    update_log: '更新日志',
    usage_guide: '使用建议'
  };

  return labels[category] ?? category;
}

function getHealthClass(status: string) {
  if (status === 'healthy') {
    return 'status-pill-success';
  }

  if (status === 'unhealthy') {
    return 'status-pill-danger';
  }

  return 'status-pill-muted';
}

function getRechargeStatusClass(status: string) {
  if (status === 'unused') {
    return 'status-pill-success';
  }

  if (status === 'used') {
    return 'status-pill-muted';
  }

  return 'status-pill-danger';
}

function formatCents(value: number) {
  return `${(value / 100).toFixed(2)} 元`;
}
