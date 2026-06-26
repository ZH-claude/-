export type AdminUser = {
  id: string;
  username: string;
  role: string;
  status: string;
  timezone: string;
  group: {
    id: string;
    code: string;
    name: string;
  };
  wallet: {
    balanceCents: number;
    totalSpendCents?: number;
    totalRechargeCents?: number;
  };
  usage?: {
    spendCents: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requestCount: number;
    lastUsedAt: string | null;
  };
  recharge?: {
    totalCents: number;
    count: number;
    lastRechargedAt: string | null;
  };
  lastLoginAt: string | null;
  createdAt: string;
};

export type DashboardUserStats = {
  id: string;
  username: string;
  role: string;
  status: string;
  wallet: {
    balanceCents: number;
    totalSpendCents: number;
    totalRechargeCents: number;
  };
  usage: {
    spendCents: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requestCount: number;
    lastUsedAt: string | null;
  };
  recharge: {
    totalCents: number;
    count: number;
    lastRechargedAt: string | null;
  };
  lastLoginAt: string | null;
  createdAt: string;
};

export type Announcement = {
  id: string;
  title: string;
  content: string;
  category: AnnouncementCategory;
  status: string;
  isPinned: boolean;
  scheduledAt: string | null;
  publishedAt: string | null;
  translations?: TranslationMap | null;
  translationWorkflow?: AnnouncementTranslationWorkflow | null;
  createdBy?: string;
  createdByAdminId?: string;
  createdAt: string;
  updatedAt?: string;
};

export type TranslationMap = Record<string, Record<string, string | boolean>>;

export type AnnouncementTranslationWorkflowEntry = {
  language: string;
  status: string;
  locked: boolean;
  source: string | null;
  hasTitle: boolean;
  hasContent: boolean;
  updatedAt: string | null;
};

export type AnnouncementTranslationWorkflow = {
  languages: string[];
  counts: {
    total: number;
    machineDraft: number;
    humanReviewed: number;
    manualLocked: number;
    locked: number;
    untranslated: number;
  };
  entries: AnnouncementTranslationWorkflowEntry[];
};

export type AnnouncementPreview = {
  id: string;
  language: string;
  title: string;
  content: string;
  fallback: boolean;
  source: {
    title: string;
    content: string;
  };
  translation: {
    language: string | null;
    status: string;
    locked: boolean;
    source: string | null;
    hasTitle: boolean;
    hasContent: boolean;
    updatedAt: string | null;
  };
  category: AnnouncementCategory;
  status: string;
  isPinned: boolean;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PrepareAnnouncementTranslationsResponse = Announcement & {
  preparedTranslationLanguages: string[];
  translationErrors: string[];
  changed: boolean;
};

export type TranslationGlossaryTerm = {
  id: string;
  sourceTerm: string;
  replacementTerm: string;
  note: string | null;
  isActive: boolean;
  createdByAdminId: string | null;
  updatedByAdminId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TranslationGlossaryListResponse = {
  items: TranslationGlossaryTerm[];
};

export type SiteFontFamily = 'system' | 'serif' | 'rounded' | 'mono';

export type SiteContentConfig = {
  id: string;
  home: {
    title: string;
    subtitle: string;
    content: string | null;
    fontFamily: SiteFontFamily;
    textColor: string;
    accentColor: string;
  };
  popup: {
    enabled: boolean;
    title: string | null;
    content: string | null;
    fontFamily: SiteFontFamily;
    textColor: string;
    accentColor: string;
  };
  translations?: TranslationMap | null;
  updatedAt: string | null;
};

export type SiteContentPayload = {
  homeTitle?: string | null;
  homeSubtitle?: string | null;
  homeContent?: string | null;
  homeFontFamily: SiteFontFamily;
  homeTextColor: string;
  homeAccentColor: string;
  popupEnabled: boolean;
  popupTitle?: string | null;
  popupContent?: string | null;
  popupFontFamily: SiteFontFamily;
  popupTextColor: string;
  popupAccentColor: string;
  translations?: TranslationMap | null;
};

export type DashboardAlert = {
  id: string;
  type: string;
  severity: string;
  title: string;
  detail: string;
  createdAt: string;
};

export type DashboardUsersSummary = {
  total: number;
  active: number;
  disabled: number;
  riskLocked: number;
  admins: number;
  ordinary: number;
  newToday: number;
  newYesterday: number;
  newTodayDelta: number;
};

export type DashboardWalletSummary = {
  totalBalanceCents: number;
  totalSpendCents: number;
};

export type DashboardUsageSummary = {
  callCount: number;
  spendCents: number;
  totalTokens: number;
  activeUsers: number;
  rechargeCents: number;
  rechargeCount: number;
  statusCounts: Record<string, number>;
};

export type DashboardPerformanceSummary = {
  windowStart: string;
  requestCount: number;
  errorCount: number;
  errorRatePercent: number;
  averageLatencyMs: number;
  averageUpstreamLatencyMs: number;
};

export type DashboardUpstreamSummary = {
  total: number;
  active: number;
  disabled: number;
  health: Record<string, number>;
};

export type DashboardModelsSummary = {
  total: number;
  active: number;
  disabled: number;
  upstreamMappings: {
    total: number;
    active: number;
    disabled: number;
  };
};

export type DashboardRechargeSummary = {
  total: number;
  unused: number;
  used: number;
  disabled: number;
};

export type DashboardTotalsSummary = {
  rechargeCents: number;
  rechargeCount: number;
  spendCents: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
};

export type DashboardSummary = {
  generatedAt: string;
  window: {
    todayStart: string;
    monthStart: string;
    last24HoursStart: string;
  };
  users: DashboardUsersSummary;
  wallets: DashboardWalletSummary;
  today: DashboardUsageSummary;
  performance: DashboardPerformanceSummary;
  month: DashboardUsageSummary & {
    windowStart: string;
    newUsers: number;
    performance: DashboardPerformanceSummary;
  };
  upstreams: DashboardUpstreamSummary;
  models: DashboardModelsSummary;
  rechargeCodes: DashboardRechargeSummary;
  totals: DashboardTotalsSummary;
  topUsers: DashboardUserStats[];
  recentAlerts: DashboardAlert[];
};

export type DailyConsumptionDay = {
  date: string;
  windowStart: string;
  windowEnd: string;
  callCount: number;
  spendCents: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  activeUsers: number;
  rechargeCents: number;
  rechargeCount: number;
  requestLogCount: number;
  errorRequestCount: number;
  errorRatePercent: number;
  averageLatencyMs: number;
  averageUpstreamLatencyMs: number;
  statusCounts: Record<string, number>;
};

export type DailyUserCostAlert = {
  date: string;
  userId: string;
  username: string;
  spendCents: number;
  totalTokens: number;
  requestCount: number;
  thresholdCents: number;
  lastUsedAt: string | null;
};

export type DailyConsumptionReport = {
  generatedAt: string;
  window: {
    days: number;
    start: string;
    end: string;
    timezone: string;
  };
  costAlert: {
    userDailyThresholdCents: number;
    alerts: DailyUserCostAlert[];
  };
  totals: {
    callCount: number;
    spendCents: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    activeUserDays: number;
    rechargeCents: number;
    rechargeCount: number;
    requestLogCount: number;
    errorRequestCount: number;
    errorRatePercent: number;
  };
  days: DailyConsumptionDay[];
};

export type AnnouncementCategory = 'announcement' | 'update_log' | 'usage_guide';

export type UpstreamProvider = {
  id: string;
  name: string;
  kind: 'generic' | 'deepseek' | 'relay';
  baseUrl: string;
  apiKeyPreview: string;
  status: string;
  maxConcurrency: number | null;
  consecutiveFailures: number;
  circuitOpenedUntil: string | null;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  healthStatus: string;
  lastHealthCheckAt: string | null;
  lastHealthLatencyMs: number | null;
  lastHealthError: string | null;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type RoutePricing = {
  pricingMode: 'manual' | 'deepseek_base' | 'relay_price' | null;
  inputPriceCentsPer1k: number | null;
  outputPriceCentsPer1k: number | null;
  modelMultiplier: string | null;
  upstreamInputPricePerMillion: string | null;
  upstreamOutputPricePerMillion: string | null;
  upstreamCurrency: 'CNY' | 'USD' | null;
  upstreamExchangeRate: string | null;
  marginPercent: string | null;
};

export type AdminGroup = {
  id: string;
  code: string;
  name: string;
  multiplier: string;
  status: string;
  userCount: number;
  modelAccessCount: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminModelPrice = {
  id: string;
  model: string;
  displayName: string | null;
  translations?: TranslationMap | null;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  pricingMode: 'manual' | 'deepseek_base' | 'relay_price';
  upstreamInputPricePerMillion: string | null;
  upstreamOutputPricePerMillion: string | null;
  upstreamCurrency: 'CNY' | 'USD' | null;
  upstreamExchangeRate: string | null;
  marginPercent: string | null;
  status: string;
  groups: Array<{
    id: string;
    code: string;
    name: string;
  }>;
  upstreamMappings: Array<{
    id: string;
    providerId: string;
    providerName: string;
    providerKind: 'generic' | 'deepseek' | 'relay';
    providerStatus: string;
    upstreamModel: string;
    priority: number;
    timeoutMs: number;
    upstreamPrompt: string | null;
    routePricing: RoutePricing | null;
    status: string;
    supportsStream: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type UpstreamModelMapping = {
  id: string;
  providerId: string;
  providerName: string;
  providerKind: 'generic' | 'deepseek' | 'relay';
  providerStatus: string;
  publicModel: string;
  displayName: string | null;
  upstreamModel: string;
  priority: number;
  timeoutMs: number;
  upstreamPrompt: string | null;
  routePricing: RoutePricing | null;
  status: string;
  supportsStream: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AdminRechargeCode = {
  id: string;
  kind: 'balance' | 'vibe_coding';
  amountCents: number;
  amountBaseTokens: number;
  faceValueCnyCents: number;
  quotaHours: number | null;
  quotaPeriodDays: number | null;
  tokenQuota: number | null;
  vibeCodingPackage?: {
    quotaHours: number | null;
    quotaPeriodDays: number | null;
    tokenQuota: number | null;
  } | null;
  status: string;
  createdBy?: string;
  usedBy?: string | null;
  usedByUserId?: string | null;
  usedAt: string | null;
  walletTransactionId?: string | null;
  createdAt: string;
};

export type AdminAuditLog = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  admin: {
    id: string;
    username: string;
  };
  createdAt: string;
};

export type SecurityAuditLog = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actor: {
    id: string;
    username: string;
  } | null;
  ipAddress: string | null;
  createdAt: string;
};

export type AdminRequestLogStatusFilter = 'all' | 'success' | 'error';

export type AdminRequestLog = {
  id: string;
  requestId: string;
  method: string;
  path: string;
  model: string | null;
  statusCode: number | null;
  errorCode: string | null;
  latencyMs: number | null;
  upstreamLatencyMs: number | null;
  upstreamStatusCode: number | null;
  upstreamStatus: string | null;
  createdAt: string;
  completedAt: string | null;
  user: {
    id: string;
    username: string;
  } | null;
  token: {
    id: string;
    name: string;
    keyPreview: string;
  } | null;
  upstreamProvider: {
    id: string;
    name: string;
    status: string;
    healthStatus: string;
  } | null;
};

export type AdminImageTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type AdminImageTask = {
  id: string;
  externalTaskId: string;
  platform: string;
  kind: 'image';
  status: AdminImageTaskStatus;
  model: string | null;
  prompt: string | null;
  progress: number | null;
  result: unknown;
  errorMessage: string | null;
  submittedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    username: string;
  };
  upstreamProvider: {
    id: string;
    name: string;
    status: string;
    healthStatus: string;
  } | null;
};

export type AdminAiRechargeProduct = {
  id: string;
  productKind: 'ai_recharge' | 'vibe_coding';
  title: string;
  platform: string;
  planName: string;
  durationDays: number | null;
  quotaHours: number | null;
  quotaPeriodDays: number | null;
  tokenQuota: number | null;
  priceCnyCents: number;
  description: string;
  purchaseNote: string | null;
  deliveryNote: string | null;
  sortOrder: number;
  status: 'active' | 'disabled';
  translations?: TranslationMap | null;
  createdBy?: string;
  orderCount?: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminAiRechargePageConfig = {
  id: string;
  introTitle: string | null;
  introContent: string | null;
  introImageDataUrl: string | null;
  translations?: TranslationMap | null;
  updatedAt: string | null;
};

export type AdminAiRechargeOrderStatus = 'pending' | 'processing' | 'fulfilled' | 'canceled' | 'failed';

export type AdminAiRechargeOrder = {
  id: string;
  orderNo: string;
  userId: string;
  username?: string;
  productId: string;
  productTitle: string;
  currentProductTitle?: string;
  currentProductStatus?: string;
  platform: string;
  planName: string;
  amountCnyCents: number;
  customerAccount: string;
  customerContact: string;
  customerNote: string | null;
  merchantNote: string | null;
  status: AdminAiRechargeOrderStatus;
  createdAt: string;
  updatedAt: string;
};

export type CreatedRechargeCode = {
  id: string;
  code: string;
  kind: 'balance' | 'vibe_coding';
  amountCents: number;
  amountBaseTokens: number;
  faceValueCnyCents: number;
  quotaHours: number | null;
  quotaPeriodDays: number | null;
  tokenQuota: number | null;
  vibeCodingPackage?: {
    quotaHours: number | null;
    quotaPeriodDays: number | null;
    tokenQuota: number | null;
  } | null;
  status: string;
  createdAt: string;
};

type UserListResponse = {
  items: AdminUser[];
  total: number;
  page: number;
  limit: number;
};

type GroupListResponse = {
  items: AdminGroup[];
};

type AnnouncementListResponse = {
  items: Announcement[];
};

type UpstreamProviderListResponse = {
  items: UpstreamProvider[];
};

type ModelConfigurationResponse = {
  groups: AdminGroup[];
  models: AdminModelPrice[];
  upstreamModels: UpstreamModelMapping[];
  upstreamModelsPagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type UpstreamHealthCheckResponse = {
  reachable: boolean;
  checkedAt: string;
  provider: UpstreamProvider;
};

type RechargeCodeListResponse = {
  stats: {
    total: number;
    unused: number;
    used: number;
    disabled: number;
  };
  items: AdminRechargeCode[];
};

type CreateRechargeCodesResponse = {
  items: CreatedRechargeCode[];
};

type AdminAuditLogListResponse = {
  items: AdminAuditLog[];
  total: number;
  page: number;
  limit: number;
};

type SecurityAuditLogListResponse = {
  items: SecurityAuditLog[];
  total: number;
  page: number;
  limit: number;
};

type AdminRequestLogListResponse = {
  items: AdminRequestLog[];
  summary: {
    total: number;
    successCount: number;
    errorCount: number;
  };
  total: number;
  page: number;
  limit: number;
};

type AdminImageTaskListResponse = {
  items: AdminImageTask[];
  summary: {
    total: number;
    statusCounts: Record<AdminImageTaskStatus, number>;
  };
  filters: {
    platforms: string[];
    models: string[];
    statuses: AdminImageTaskStatus[];
  };
  capabilities: {
    imageSubmissionSupported: boolean;
    statusSyncSupported: boolean;
  };
  total: number;
  page: number;
  limit: number;
};

type AdminAiRechargeProductListResponse = {
  items: AdminAiRechargeProduct[];
};

type AdminAiRechargePageConfigResponse = AdminAiRechargePageConfig;

type AdminAiRechargeOrderListResponse = {
  items: AdminAiRechargeOrder[];
};

const API_BASE_URL = '/api';

export async function listAdminUsers(options: { page?: number; limit?: number } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('limit', String(options.limit ?? 100));
  return request<UserListResponse>(`/admin/users?${params.toString()}`);
}

export async function listAnnouncements() {
  return request<AnnouncementListResponse>('/admin/announcements');
}

export async function getAdminSiteContentConfig() {
  return request<SiteContentConfig>('/admin/site-content');
}

export async function updateAdminSiteContentConfig(payload: SiteContentPayload) {
  return request<SiteContentConfig>('/admin/site-content', {
    method: 'POST',
    body: payload
  });
}

export async function createAnnouncement(payload: {
  title: string;
  content: string;
  category: AnnouncementCategory;
  status: 'draft' | 'published' | 'archived';
  isPinned?: boolean;
  scheduledAt?: string | null;
  translations?: TranslationMap | null;
}) {
  return request<Announcement>('/admin/announcements', {
    method: 'POST',
    body: payload
  });
}

export async function updateAnnouncement(announcementId: string, payload: {
  title?: string;
  content?: string;
  category?: AnnouncementCategory;
  status?: 'draft' | 'published' | 'archived';
  isPinned?: boolean;
  scheduledAt?: string | null;
  translations?: TranslationMap | null;
}) {
  return request<Announcement>(`/admin/announcements/${encodeURIComponent(announcementId)}/update`, {
    method: 'POST',
    body: payload,
    retryOnNetworkError: true
  });
}

export async function previewAnnouncement(announcementId: string, language: string) {
  const params = new URLSearchParams({ language });
  return request<AnnouncementPreview>(`/admin/announcements/${encodeURIComponent(announcementId)}/preview?${params.toString()}`);
}

export async function prepareAnnouncementTranslations(announcementId: string, payload: { targetLanguages?: string[] } = {}) {
  return request<PrepareAnnouncementTranslationsResponse>(
    `/admin/announcements/${encodeURIComponent(announcementId)}/prepare-translations`,
    {
      method: 'POST',
      body: payload
    }
  );
}

export async function listTranslationGlossaryTerms() {
  return request<TranslationGlossaryListResponse>('/admin/translation-glossary');
}

export async function createTranslationGlossaryTerm(payload: {
  sourceTerm: string;
  replacementTerm: string;
  note?: string | null;
  isActive?: boolean;
}) {
  return request<TranslationGlossaryTerm>('/admin/translation-glossary', {
    method: 'POST',
    body: payload
  });
}

export async function updateTranslationGlossaryTerm(termId: string, payload: {
  sourceTerm?: string;
  replacementTerm?: string;
  note?: string | null;
  isActive?: boolean;
}) {
  return request<TranslationGlossaryTerm>(`/admin/translation-glossary/${encodeURIComponent(termId)}/update`, {
    method: 'POST',
    body: payload
  });
}

export async function listUpstreamProviders() {
  return request<UpstreamProviderListResponse>('/admin/upstreams');
}

export async function listModelConfiguration(options: { upstreamModelsPage?: number; upstreamModelsLimit?: number } = {}) {
  const params = new URLSearchParams();
  if (options.upstreamModelsPage) {
    params.set('upstreamModelsPage', String(options.upstreamModelsPage));
  }
  if (options.upstreamModelsLimit) {
    params.set('upstreamModelsLimit', String(options.upstreamModelsLimit));
  }

  const queryString = params.toString();
  return request<ModelConfigurationResponse>(`/admin/model-config${queryString ? `?${queryString}` : ''}`);
}

export async function createUpstreamProvider(payload: {
  name: string;
  kind?: 'generic' | 'deepseek' | 'relay';
  baseUrl: string;
  apiKey: string;
  status: 'active' | 'disabled';
  maxConcurrency?: number | null;
}) {
  return request<UpstreamProvider>('/admin/upstreams', {
    method: 'POST',
    body: payload
  });
}

export async function updateUpstreamProvider(providerId: string, payload: {
  name: string;
  kind?: 'generic' | 'deepseek' | 'relay';
  baseUrl: string;
  apiKey?: string;
  status: 'active' | 'disabled';
  maxConcurrency?: number | null;
}) {
  return request<UpstreamProvider>(`/admin/upstreams/${encodeURIComponent(providerId)}/update`, {
    method: 'POST',
    body: payload
  });
}

export async function createUserGroup(payload: {
  code: string;
  name: string;
  multiplier: string;
  status: 'active' | 'disabled';
}) {
  return request<AdminGroup>('/admin/groups', {
    method: 'POST',
    body: payload
  });
}

export async function listUserGroups() {
  return request<GroupListResponse>('/admin/groups');
}

export async function assignUserGroup(userId: string, payload: { groupId: string }) {
  return request<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/group`, {
    method: 'POST',
    body: payload
  });
}

export async function deleteAdminUserData(userId: string) {
  return request<{ id: string; username: string; deleted: true }>(`/admin/users/${encodeURIComponent(userId)}/delete`, {
    method: 'POST'
  });
}

export async function createModelPrice(payload: {
  model: string;
  displayName?: string;
  translations?: TranslationMap | null;
  pricingMode?: 'manual' | 'deepseek_base' | 'relay_price';
  inputPriceCentsPer1k?: number;
  outputPriceCentsPer1k?: number;
  modelMultiplier?: string;
  upstreamInputPricePerMillion?: string;
  upstreamOutputPricePerMillion?: string;
  upstreamCurrency?: 'CNY' | 'USD';
  upstreamExchangeRate?: string;
  marginPercent?: string;
  status: 'active' | 'disabled';
  groupIds: string[];
}) {
  return request<AdminModelPrice>('/admin/models', {
    method: 'POST',
    body: payload
  });
}

export async function updateModelPrice(modelPriceId: string, payload: {
  model: string;
  displayName?: string;
  translations?: TranslationMap | null;
  pricingMode?: 'manual' | 'deepseek_base' | 'relay_price';
  inputPriceCentsPer1k?: number;
  outputPriceCentsPer1k?: number;
  modelMultiplier?: string;
  upstreamInputPricePerMillion?: string;
  upstreamOutputPricePerMillion?: string;
  upstreamCurrency?: 'CNY' | 'USD';
  upstreamExchangeRate?: string;
  marginPercent?: string;
  status: 'active' | 'disabled';
  groupIds: string[];
}) {
  return request<AdminModelPrice>(`/admin/models/${encodeURIComponent(modelPriceId)}/update`, {
    method: 'POST',
    body: payload
  });
}

export async function updateModelPriceStatus(modelPriceId: string, payload: {
  status: 'active' | 'disabled';
}) {
  return request<AdminModelPrice>(`/admin/models/${encodeURIComponent(modelPriceId)}/status`, {
    method: 'POST',
    body: payload
  });
}

export async function deleteModelPrice(modelPriceId: string) {
  return request<{ id: string; model: string; deleted: true }>(`/admin/models/${encodeURIComponent(modelPriceId)}/delete`, {
    method: 'POST'
  });
}

export async function createUpstreamModel(payload: {
  providerId: string;
  publicModel: string;
  upstreamModel: string;
  priority: number;
  timeoutMs: number;
  upstreamPrompt?: string;
  pricingMode?: 'manual' | 'deepseek_base' | 'relay_price';
  inputPriceCentsPer1k?: number;
  outputPriceCentsPer1k?: number;
  modelMultiplier?: string;
  upstreamInputPricePerMillion?: string;
  upstreamOutputPricePerMillion?: string;
  upstreamCurrency?: 'CNY' | 'USD';
  upstreamExchangeRate?: string;
  marginPercent?: string;
  status: 'active' | 'disabled';
  supportsStream: boolean;
}) {
  return request<UpstreamModelMapping>('/admin/upstream-models', {
    method: 'POST',
    body: payload
  });
}

export async function updateUpstreamModel(mappingId: string, payload: {
  providerId: string;
  publicModel: string;
  upstreamModel: string;
  priority: number;
  timeoutMs: number;
  upstreamPrompt?: string;
  pricingMode?: 'manual' | 'deepseek_base' | 'relay_price';
  inputPriceCentsPer1k?: number;
  outputPriceCentsPer1k?: number;
  modelMultiplier?: string;
  upstreamInputPricePerMillion?: string;
  upstreamOutputPricePerMillion?: string;
  upstreamCurrency?: 'CNY' | 'USD';
  upstreamExchangeRate?: string;
  marginPercent?: string;
  status: 'active' | 'disabled';
  supportsStream: boolean;
}) {
  return request<UpstreamModelMapping>(`/admin/upstream-models/${encodeURIComponent(mappingId)}/update`, {
    method: 'POST',
    body: payload
  });
}

export async function checkUpstreamHealth(providerId: string) {
  return request<UpstreamHealthCheckResponse>(`/admin/upstreams/${encodeURIComponent(providerId)}/health-check`, {
    method: 'POST'
  });
}

export async function listRechargeCodes() {
  return request<RechargeCodeListResponse>('/admin/recharge-codes');
}

export async function listAdminAuditLogs(options: { page?: number; limit?: number } = {}) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 10;
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  return request<AdminAuditLogListResponse>(`/admin/audit-logs?${params.toString()}`);
}

export async function listSecurityAuditLogs(options: { page?: number; limit?: number } = {}) {
  const page = options.page ?? 1;
  const limit = options.limit ?? 10;
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('limit', String(limit));
  return request<SecurityAuditLogListResponse>(`/admin/security-audit-logs?${params.toString()}`);
}

export async function listAdminRequestLogs(options: {
  page?: number;
  limit?: number;
  status?: AdminRequestLogStatusFilter;
  model?: string;
} = {}) {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('limit', String(options.limit ?? 20));
  if (options.status && options.status !== 'all') {
    params.set('status', options.status);
  }
  if (options.model) {
    params.set('model', options.model);
  }
  return request<AdminRequestLogListResponse>(`/admin/request-logs?${params.toString()}`);
}

export async function listAdminImageTasks(options: {
  page?: number;
  limit?: number;
  status?: AdminImageTaskStatus | '';
  platform?: string;
  model?: string;
} = {}) {
  const params = new URLSearchParams();
  params.set('page', String(options.page ?? 1));
  params.set('limit', String(options.limit ?? 20));
  if (options.status) {
    params.set('status', options.status);
  }
  if (options.platform) {
    params.set('platform', options.platform);
  }
  if (options.model) {
    params.set('model', options.model);
  }
  return request<AdminImageTaskListResponse>(`/admin/image-tasks?${params.toString()}`);
}

export async function getDashboardSummary() {
  return request<DashboardSummary>('/admin/dashboard-summary');
}

export async function getDailyConsumptionReport(options: { days?: number; userCostAlertCents?: number } = {}) {
  const params = new URLSearchParams();
  params.set('days', String(options.days ?? 14));
  if (options.userCostAlertCents !== undefined) {
    params.set('userCostAlertCents', String(options.userCostAlertCents));
  }

  return request<DailyConsumptionReport>(`/admin/daily-consumption-report?${params.toString()}`);
}

export async function listAdminAiRechargeProducts() {
  return request<AdminAiRechargeProductListResponse>('/admin/ai-recharge/products');
}

export async function getAdminAiRechargePageConfig() {
  return request<AdminAiRechargePageConfigResponse>('/admin/ai-recharge/page-config');
}

export async function updateAdminAiRechargePageConfig(payload: {
  introTitle?: string | null;
  introContent?: string | null;
  introImageDataUrl?: string | null;
  translations?: TranslationMap | null;
}) {
  return request<AdminAiRechargePageConfigResponse>('/admin/ai-recharge/page-config', {
    method: 'POST',
    body: payload
  });
}

export async function createAdminAiRechargeProduct(payload: {
  productKind: 'ai_recharge' | 'vibe_coding';
  title: string;
  platform: string;
  planName: string;
  durationDays?: number | null;
  quotaHours?: number | null;
  quotaPeriodDays?: number | null;
  tokenQuota?: number | null;
  priceCnyCents: number;
  description: string;
  purchaseNote?: string | null;
  deliveryNote?: string | null;
  sortOrder: number;
  status: 'active' | 'disabled';
  translations?: TranslationMap | null;
}) {
  return request<AdminAiRechargeProduct>('/admin/ai-recharge/products', {
    method: 'POST',
    body: payload
  });
}

export async function updateAdminAiRechargeProduct(productId: string, payload: {
  productKind: 'ai_recharge' | 'vibe_coding';
  title: string;
  platform: string;
  planName: string;
  durationDays?: number | null;
  quotaHours?: number | null;
  quotaPeriodDays?: number | null;
  tokenQuota?: number | null;
  priceCnyCents: number;
  description: string;
  purchaseNote?: string | null;
  deliveryNote?: string | null;
  sortOrder: number;
  status: 'active' | 'disabled';
  translations?: TranslationMap | null;
}) {
  return request<AdminAiRechargeProduct>(`/admin/ai-recharge/products/${encodeURIComponent(productId)}/update`, {
    method: 'POST',
    body: payload
  });
}

export async function updateAdminAiRechargeProductStatus(productId: string, payload: { status: 'active' | 'disabled' }) {
  return request<AdminAiRechargeProduct>(`/admin/ai-recharge/products/${encodeURIComponent(productId)}/status`, {
    method: 'POST',
    body: payload
  });
}

export async function deleteAdminAiRechargeProduct(productId: string) {
  return request<{ id: string; deleted: true }>(`/admin/ai-recharge/products/${encodeURIComponent(productId)}/delete`, {
    method: 'POST'
  });
}

export async function listAdminAiRechargeOrders() {
  return request<AdminAiRechargeOrderListResponse>('/admin/ai-recharge/orders');
}

export async function updateAdminAiRechargeOrderStatus(orderId: string, payload: {
  status: AdminAiRechargeOrderStatus;
  merchantNote?: string | null;
}) {
  return request<AdminAiRechargeOrder>(`/admin/ai-recharge/orders/${encodeURIComponent(orderId)}/status`, {
    method: 'POST',
    body: payload
  });
}

export async function createRechargeCodes(payload: {
  amountCnyCents?: number;
  codeKind?: 'balance' | 'vibe_coding';
  count: number;
  quotaHours?: number;
  quotaPeriodDays?: number;
  tokenQuota?: number;
}) {
  return request<CreateRechargeCodesResponse>('/admin/recharge-codes', {
    method: 'POST',
    body: payload
  });
}

export async function disableRechargeCode(codeId: string) {
  return request<AdminRechargeCode>(`/admin/recharge-codes/${encodeURIComponent(codeId)}/disable`, {
    method: 'POST'
  });
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    retryOnNetworkError?: boolean;
  } = {}
) {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const method = options.method ?? 'GET';
  const response = await fetchWithAdminRetry(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    body: options.body ? JSON.stringify(options.body) : undefined
  }, method, options.retryOnNetworkError ?? false);

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String((data as { message: unknown }).message)
        : `请求失败：${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

async function fetchWithAdminRetry(url: string, init: RequestInit, method: 'GET' | 'POST', retryOnNetworkError = false) {
  const maxAttempts = method === 'GET' || retryOnNetworkError ? 3 : 1;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (method !== 'GET' || !isRetryableAdminNetworkError(error) || attempt >= maxAttempts) {
        throw error;
      }
      await delay(150 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}

function isRetryableAdminNetworkError(error: unknown) {
  return error instanceof TypeError && /fetch|network|failed|load/i.test(error.message);
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
