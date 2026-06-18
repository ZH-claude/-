import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaClient, UserRole, UserStatus } from '../src/generated/prisma/client';

type HttpResult<T = unknown> = {
  status: number;
  json: T;
  text: string;
  headers: Headers;
  cookie?: string;
};

type WebResult = {
  status: number;
  text: string;
  location: string;
  headers: Headers;
};

type LoginResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
  };
};

type AdminGroup = {
  id: string;
  code: string;
  name: string;
  multiplier: string;
  status: string;
};

type AdminUpstreamProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyPreview: string;
  status: string;
  healthStatus: string;
};

type AdminModelPrice = {
  id: string;
  model: string;
  displayName: string | null;
  inputPriceCentsPer1k: number;
  outputPriceCentsPer1k: number;
  modelMultiplier: string;
  status: string;
  groups: Array<{ id: string }>;
};

type AdminUpstreamModel = {
  id: string;
  providerId: string;
  providerName: string;
  providerKind: string;
  publicModel: string;
  upstreamModel: string;
  priority: number;
  timeoutMs: number;
  upstreamPrompt: string | null;
  routePricing: {
    pricingMode: string | null;
    inputPriceCentsPer1k: number | null;
    outputPriceCentsPer1k: number | null;
    modelMultiplier: string | null;
  } | null;
  status: string;
  supportsStream: boolean;
};

type AdminGroupsResponse = {
  items: AdminGroup[];
};

type AdminModelConfigResponse = {
  groups: Array<{
    id: string;
    code: string;
    name: string;
    multiplier: string;
    status: string;
  }>;
  models: AdminModelPrice[];
  upstreamModels: AdminUpstreamModel[];
  upstreamModelsPagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type AdminUpstreamsResponse = {
  items: AdminUpstreamProvider[];
};

type PricingResponse = {
  group: {
    code: string;
    name: string;
    multiplier: string;
  };
  models: Array<{
    model: string;
    displayName: string | null;
    inputPriceCentsPer1k: number;
    outputPriceCentsPer1k: number;
    modelMultiplier: string;
    groupMultiplier: string;
    supportsStream: boolean;
  }>;
};

type AuthMeResponse = {
  user: {
    id: string;
    username: string;
    role: string;
    status: string;
    availableModels: Array<{
      model: string;
      displayName: string | null;
      inputPriceCentsPer1k: number;
      outputPriceCentsPer1k: number;
      modelMultiplier: string;
      groupMultiplier: string;
      supportsStream: boolean;
    }>;
  };
};

type TokenCreateResponse = {
  apiKey: string;
  token: {
    id: string;
    name: string;
    keyPreview: string;
    status: string;
    modelNames: string[];
  };
};

type V1ModelsResponse = {
  object: string;
  data: Array<{
    id: string;
    object: string;
    owned_by: string;
  }>;
};

type UpstreamHealthResponse = {
  reachable: boolean;
  provider: {
    id: string;
    healthStatus: string;
    lastHealthError: string | null;
    lastHealthLatencyMs: number | null;
  };
};

type Residual = {
  users: number;
  wallets: number;
  sessions: number;
  userGroups: number;
  modelPrices: number;
  modelGroupAccesses: number;
  upstreamProviders: number;
  upstreamModels: number;
  apiTokens: number;
  apiTokenModelAccesses: number;
  adminAuditLogs: number;
  securityAuditLogs: number;
  requestLogs: number;
};

type SeededUsers = {
  adminUsername: string;
  userUsername: string;
  adminId: string;
  userId: string;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:3001';
const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'http://127.0.0.1:3000';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run the T22 merchant model-config QA script');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL })
});

const suffix = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const prefix = `q22_mcfg_${suffix}`;
const password = `qa-password-${suffix}`;
const checks: string[] = [];
let residualBefore: Residual | null = null;
let residualAfter: Residual | null = null;
let checksError: unknown;

async function main() {
  let seededUsers: SeededUsers | null = null;
  let adminCookie = '';
  let userCookie = '';
  const created: {
    groupId: string;
    modelName: string;
    upstreamProviderId: string;
    upstreamModelId: string;
    upstreamProviderName: string;
    upstreamApiKey: string;
    blockedUpstreamProviderIds: string[];
  } = {
    groupId: '',
    modelName: `${prefix}_model`,
    upstreamProviderId: '',
    upstreamModelId: '',
    upstreamProviderName: `${prefix}_provider`,
    upstreamApiKey: `qa-upstream-key-${suffix}`,
    blockedUpstreamProviderIds: []
  };

  try {
    seededUsers = await seedUsers();
    checks.push('seeded_admin_and_user_rows_with_wallets');

    const adminLogin = await login(seededUsers.adminUsername);
    assert(adminLogin.status >= 200 && adminLogin.status < 300, `admin login failed with ${adminLogin.status}`);
    adminCookie = adminLogin.cookie ?? '';
    assert(adminCookie.length > 0, 'admin login did not return session cookie');
    assert(adminLogin.json.user.role.toLowerCase() === UserRole.ADMIN.toLowerCase(), 'admin login role mismatch');

    const userLogin = await login(seededUsers.userUsername);
    assert(userLogin.status >= 200 && userLogin.status < 300, `user login failed with ${userLogin.status}`);
    userCookie = userLogin.cookie ?? '';
    assert(userCookie.length > 0, 'user login did not return session cookie');
    assert(userLogin.json.user.role.toLowerCase() === UserRole.USER.toLowerCase(), 'user login role mismatch');

    const adminMerchantEntry = await requestWebPage('/merchant', adminCookie);
    assert(adminMerchantEntry.status >= 200 && adminMerchantEntry.status < 300, '/merchant should render for admin');
    checks.push('admin_can_access_merchant_entry');

    const adminModelConfigPage = await requestWebPage('/merchant/model-config', adminCookie);
    if (adminModelConfigPage.status === 404) {
      checks.push('merchant_model_config_web_route_not_present_in_frontend');
    } else {
      assert(
        adminModelConfigPage.status >= 200 && adminModelConfigPage.status < 300,
        `merchant /merchant/model-config should be accessible for admin, got ${adminModelConfigPage.status}`
      );
      assertMerchantModelConfigHtml(adminModelConfigPage.text);
      checks.push('admin_can_open_merchant_model_config_page');
    }

    const adminModelRoutesPage = await requestWebPage('/merchant/model-routes', adminCookie);
    if (adminModelRoutesPage.status === 404) {
      checks.push('merchant_model_routes_web_route_not_present_in_frontend');
    } else {
      assert(
        adminModelRoutesPage.status >= 200 && adminModelRoutesPage.status < 300,
        `merchant /merchant/model-routes should be accessible for admin, got ${adminModelRoutesPage.status}`
      );
      assertMerchantModelRoutesHtml(adminModelRoutesPage.text);
      checks.push('admin_can_open_merchant_model_routes_page');
    }

    const adminProfile = await get<AuthMeResponse>('/auth/me', adminCookie);
    assert(adminProfile.status >= 200 && adminProfile.status < 300, '/auth/me for admin should pass');

    const ordinaryMerchantEntry = await requestWebPage('/merchant', userCookie);
    assertRedirectTo(ordinaryMerchantEntry, '/account/profile', 'ordinary user /merchant redirect');
    checks.push('ordinary_user_is_redirected_away_from_merchant_entry');

    const ordinaryAdminGroups = await get<AdminGroupsResponse>('/admin/groups', userCookie);
    assert(ordinaryAdminGroups.status === 403, `ordinary user /admin/groups should be 403, got ${ordinaryAdminGroups.status}`);

    const ordinaryCreateModel = await post<unknown>(
      '/admin/models',
      {
        model: `${prefix}_forbidden_model`,
        groupIds: [seededUsers.adminId]
      },
      userCookie
    );
    assert(
      ordinaryCreateModel.status === 403,
      `ordinary user /admin/models create should be 403, got ${ordinaryCreateModel.status}`
    );

    const ordinaryUpdateModel = await post<unknown>(
      '/admin/models/00000000-0000-0000-0000-000000000000/update',
      {
        model: `${prefix}_forbidden_model`,
        groupIds: [seededUsers.adminId]
      },
      userCookie
    );
    assert(
      ordinaryUpdateModel.status === 403,
      `ordinary user /admin/models update should be 403, got ${ordinaryUpdateModel.status}`
    );

    const ordinaryCreateUpstream = await post<unknown>(
      '/admin/upstreams',
      {
        name: `${prefix}_forbidden_provider`,
        baseUrl: 'https://example.invalid',
        apiKey: 'forbidden-api-key'
      },
      userCookie
    );
    assert(
      ordinaryCreateUpstream.status === 403,
      `ordinary user /admin/upstreams create should be 403, got ${ordinaryCreateUpstream.status}`
    );

    const ordinaryCreateUpstreamModel = await post<unknown>(
      '/admin/upstream-models',
      {
        providerId: '00000000-0000-0000-0000-000000000000',
        publicModel: `${prefix}_forbidden_model`,
        upstreamModel: `${prefix}_forbidden_upstream_model`
      },
      userCookie
    );
    assert(
      ordinaryCreateUpstreamModel.status === 403,
      `ordinary user /admin/upstream-models create should be 403, got ${ordinaryCreateUpstreamModel.status}`
    );

    const modelConfigFromOrdinary = await get<AdminModelConfigResponse>('/admin/model-config', userCookie);
    assert(
      modelConfigFromOrdinary.status === 403,
      `ordinary user /admin/model-config should be 403, got ${modelConfigFromOrdinary.status}`
    );

    checks.push('ordinary_user_cannot_access_admin_interfaces');

    const createdGroup = await post<AdminGroup>(
      '/admin/groups',
      {
        code: `${prefix}_group`,
        name: `${prefix} QA Group`,
        multiplier: '1.3500'
      },
      adminCookie
    );
    assert(createdGroup.status >= 200 && createdGroup.status < 300, `admin create group failed with ${createdGroup.status}`);
    created.groupId = createdGroup.json.id;
    checks.push('admin_created_group_via_api');

    const modelCreate = await post<AdminModelPrice>(
      '/admin/models',
      {
        model: created.modelName,
        displayName: `${prefix} QA Model`,
        groupIds: [created.groupId]
      },
      adminCookie
    );
    assert(modelCreate.status >= 200 && modelCreate.status < 300, `admin create model failed with ${modelCreate.status}`);
    assert(modelCreate.json.model === created.modelName, 'created model name mismatch');
    checks.push('admin_created_customer_model_without_route_pricing_via_api');

    const updatedModelName = `${created.modelName}_edited`;
    const modelUpdate = await post<AdminModelPrice>(
      `/admin/models/${modelCreate.json.id}/update`,
      {
        model: updatedModelName,
        displayName: `${prefix} QA Model Edited`,
        status: 'active',
        groupIds: [created.groupId]
      },
      adminCookie
    );
    assert(modelUpdate.status >= 200 && modelUpdate.status < 300, `admin update model failed with ${modelUpdate.status}`);
    assert(modelUpdate.json.model === updatedModelName, 'updated model name mismatch');
    assert(modelUpdate.json.displayName === `${prefix} QA Model Edited`, 'updated model display name mismatch');
    created.modelName = updatedModelName;
    checks.push('admin_updated_customer_model_without_route_pricing_via_api');

    const upstreamCreate = await post<AdminUpstreamProvider>(
      '/admin/upstreams',
      {
        name: created.upstreamProviderName,
        baseUrl: `https://${created.upstreamProviderName}.example.invalid`,
        apiKey: created.upstreamApiKey
      },
      adminCookie
    );
    assert(upstreamCreate.status >= 200 && upstreamCreate.status < 300, `admin create upstream failed with ${upstreamCreate.status}`);
    created.upstreamProviderId = upstreamCreate.json.id;
    checks.push('admin_created_upstream_provider_via_api');

    const initialUpstreamKey = created.upstreamApiKey;
    const updatedUpstreamName = `${created.upstreamProviderName}_edited`;
    const updatedUpstreamKey = `${created.upstreamApiKey}-edited`;
    const upstreamUpdate = await post<AdminUpstreamProvider>(
      `/admin/upstreams/${created.upstreamProviderId}/update`,
      {
        name: updatedUpstreamName,
        baseUrl: `https://${updatedUpstreamName}.example.invalid`,
        apiKey: updatedUpstreamKey,
        status: 'active'
      },
      adminCookie
    );
    assert(upstreamUpdate.status >= 200 && upstreamUpdate.status < 300, `admin update upstream failed with ${upstreamUpdate.status}`);
    assert(upstreamUpdate.json.id === created.upstreamProviderId, 'updated upstream id mismatch');
    assert(upstreamUpdate.json.name === updatedUpstreamName, 'updated upstream name mismatch');
    assert(upstreamUpdate.json.baseUrl === `https://${updatedUpstreamName}.example.invalid`, 'updated upstream baseUrl mismatch');
    assert(upstreamUpdate.json.healthStatus === 'unknown', 'updated upstream health should reset after key/url change');
    created.upstreamProviderName = updatedUpstreamName;
    created.upstreamApiKey = updatedUpstreamKey;
    checks.push('admin_updated_upstream_provider_via_api');

    const encryptedAfterKeyUpdate = await prisma.upstreamProvider.findUniqueOrThrow({
      where: { id: created.upstreamProviderId },
      select: { encryptedApiKey: true }
    });
    const renameOnlyUpstreamName = `${created.upstreamProviderName}_rename_only`;
    const upstreamRenameOnly = await post<AdminUpstreamProvider>(
      `/admin/upstreams/${created.upstreamProviderId}/update`,
      {
        name: renameOnlyUpstreamName,
        baseUrl: `https://${created.upstreamProviderName}.example.invalid`,
        status: 'active'
      },
      adminCookie
    );
    assert(
      upstreamRenameOnly.status >= 200 && upstreamRenameOnly.status < 300,
      `admin rename-only upstream update failed with ${upstreamRenameOnly.status}`
    );
    const encryptedAfterRenameOnly = await prisma.upstreamProvider.findUniqueOrThrow({
      where: { id: created.upstreamProviderId },
      select: { encryptedApiKey: true }
    });
    assert(
      encryptedAfterRenameOnly.encryptedApiKey === encryptedAfterKeyUpdate.encryptedApiKey,
      'upstream key should be preserved when update omits apiKey'
    );
    created.upstreamProviderName = renameOnlyUpstreamName;
    checks.push('admin_updated_upstream_provider_without_replacing_key');

    const upstreamModelCreate = await post<AdminUpstreamModel>(
      '/admin/upstream-models',
      {
        providerId: created.upstreamProviderId,
        publicModel: created.modelName,
        upstreamModel: `${created.modelName}-mapped`,
        priority: 1,
        timeoutMs: 5000,
        upstreamPrompt: 'QA prompt',
        pricingMode: 'manual',
        inputPriceCentsPer1k: 17,
        outputPriceCentsPer1k: 31,
        modelMultiplier: '1.7500',
        supportsStream: true
      },
      adminCookie
    );
    assert(
      upstreamModelCreate.status >= 200 && upstreamModelCreate.status < 300,
      `admin create upstream-model failed with ${upstreamModelCreate.status}`
    );
    created.upstreamModelId = upstreamModelCreate.json.id;
    assert(upstreamModelCreate.json.routePricing?.pricingMode === 'manual', 'created upstream-model route pricing mode mismatch');
    assert(upstreamModelCreate.json.routePricing.inputPriceCentsPer1k === 17, 'created upstream-model input route pricing mismatch');
    assert(upstreamModelCreate.json.routePricing.outputPriceCentsPer1k === 31, 'created upstream-model output route pricing mismatch');
    assert(Number(upstreamModelCreate.json.routePricing.modelMultiplier) === 1.75, 'created upstream-model multiplier mismatch');
    checks.push('admin_created_upstream_model_mapping_via_api');

    const upstreamModelUpdate = await post<AdminUpstreamModel>(
      `/admin/upstream-models/${created.upstreamModelId}/update`,
      {
        providerId: created.upstreamProviderId,
        publicModel: created.modelName,
        upstreamModel: `${created.modelName}-mapped-edited`,
        priority: 1,
        timeoutMs: 7000,
        upstreamPrompt: 'QA prompt edited',
        pricingMode: 'manual',
        inputPriceCentsPer1k: 19,
        outputPriceCentsPer1k: 37,
        modelMultiplier: '2.0000',
        status: 'active',
        supportsStream: false
      },
      adminCookie
    );
    assert(
      upstreamModelUpdate.status >= 200 && upstreamModelUpdate.status < 300,
      `admin update upstream-model failed with ${upstreamModelUpdate.status}`
    );
    assert(upstreamModelUpdate.json.id === created.upstreamModelId, 'updated upstream-model id mismatch');
    assert(upstreamModelUpdate.json.providerId === created.upstreamProviderId, 'updated upstream-model provider mismatch');
    assert(upstreamModelUpdate.json.publicModel === created.modelName, 'updated upstream-model public model mismatch');
    assert(upstreamModelUpdate.json.upstreamModel === `${created.modelName}-mapped-edited`, 'updated upstream-model name mismatch');
    assert(upstreamModelUpdate.json.timeoutMs === 7000, 'updated upstream-model timeout mismatch');
    assert(upstreamModelUpdate.json.upstreamPrompt === 'QA prompt edited', 'updated upstream-model prompt mismatch');
    assert(upstreamModelUpdate.json.supportsStream === false, 'updated upstream-model stream flag mismatch');
    assert(upstreamModelUpdate.json.routePricing?.pricingMode === 'manual', 'updated upstream-model route pricing mode mismatch');
    assert(upstreamModelUpdate.json.routePricing.inputPriceCentsPer1k === 19, 'updated upstream-model route input pricing mismatch');
    assert(upstreamModelUpdate.json.routePricing.outputPriceCentsPer1k === 37, 'updated upstream-model route output pricing mismatch');
    assert(Number(upstreamModelUpdate.json.routePricing.modelMultiplier) === 2, 'updated upstream-model route multiplier mismatch');
    checks.push('admin_updated_upstream_model_mapping_via_api');

    const createText = JSON.stringify({
      group: createdGroup.json,
      model: modelCreate.json,
      upstream: upstreamCreate.json,
      upstreamUpdate: upstreamUpdate.json,
      upstreamRenameOnly: upstreamRenameOnly.json,
      upstreamModel: upstreamModelCreate.json,
      upstreamModelUpdate: upstreamModelUpdate.json
    });
    assert(!createText.includes(initialUpstreamKey), 'initial plaintext api key leaked in create/update response');
    assert(!createText.includes(created.upstreamApiKey), 'updated plaintext api key leaked in create/update response');
    assert(!createText.includes('encryptedApiKey'), 'encrypted api key leaked in create responses');
    checks.push('create_responses_do_not_leak_plain_upstream_api_key');

    const dbProvider = await prisma.upstreamProvider.findUniqueOrThrow({
      where: { id: created.upstreamProviderId },
      select: {
        id: true,
        apiKeyPreview: true,
        encryptedApiKey: true,
        name: true
      }
    });
    assert(dbProvider.apiKeyPreview.length > 0, 'apiKeyPreview should be stored for upstream provider');
    assert(dbProvider.encryptedApiKey !== created.upstreamApiKey, 'encryptedApiKey should not equal plaintext');
    checks.push('stored_upstream_key_is_encrypted_in_db_and_previewized');

    const groupList = await get<AdminGroupsResponse>('/admin/groups', adminCookie);
    assert(groupList.status >= 200 && groupList.status < 300, '/admin/groups failed for admin');
    assert(groupList.json.items.some((group) => group.id === created.groupId), 'created group missing in /admin/groups');

    const upstreamList = await get<AdminUpstreamsResponse>('/admin/upstreams', adminCookie);
    assert(upstreamList.status >= 200 && upstreamList.status < 300, '/admin/upstreams failed for admin');
    assert(
      upstreamList.json.items.some((provider) => provider.id === created.upstreamProviderId),
      'created upstream missing in /admin/upstreams'
    );
    const upstreamListText = JSON.stringify(upstreamList.json);
    assert(!upstreamListText.includes(created.upstreamApiKey), 'admin upstream list leaked plain upstream key');

    const modelConfig = await get<AdminModelConfigResponse>('/admin/model-config', adminCookie);
    assert(modelConfig.status >= 200 && modelConfig.status < 300, '/admin/model-config should be available for admin');
    assert(
      modelConfig.json.models.some((item) => item.model === created.modelName),
      'created model missing in /admin/model-config models'
    );
    assert(
      modelConfig.json.upstreamModels.some((mapping) => mapping.publicModel === created.modelName),
      'created mapping missing in /admin/model-config upstreamModels'
    );
    assert(
      modelConfig.json.upstreamModels.some(
        (mapping) =>
          mapping.id === created.upstreamModelId &&
          mapping.routePricing?.pricingMode === 'manual' &&
          mapping.routePricing.inputPriceCentsPer1k === 19 &&
          mapping.routePricing.outputPriceCentsPer1k === 37
      ),
      'created mapping route pricing missing in /admin/model-config upstreamModels'
    );
    assert(modelConfig.json.groups.some((group) => group.id === created.groupId), 'created group missing in /admin/model-config groups');
    const modelConfigText = JSON.stringify(modelConfig.json);
    assert(!modelConfigText.includes(created.upstreamApiKey), 'admin model config payload leaked plain upstream key');
    assert(!modelConfigText.includes('encryptedApiKey'), 'admin model config payload leaked encryptedApiKey');
    checks.push('admin_model_config_api_lists_created_entities_without_sensitive_fields');

    const assignGroup = await post<{ group: { id: string } }>(
      `/admin/users/${userLogin.json.user.id}/group`,
      {
        groupId: created.groupId
      },
      adminCookie
    );
    assert(assignGroup.status >= 200 && assignGroup.status < 300, `assign user group failed with ${assignGroup.status}`);
    assert(assignGroup.json.group.id === created.groupId, 'assign user group response mismatch');

    const assignedUser = await prisma.user.findUniqueOrThrow({
      where: { id: userLogin.json.user.id },
      select: { groupId: true }
    });
    assert(assignedUser.groupId === created.groupId, 'user groupId was not persisted in DB after assign');
    checks.push('admin_assigned_user_to_new_group_via_api_and_persisted');

    const pricing = await get<PricingResponse>('/pricing/models', userCookie);
    assert(pricing.status === 200, `/pricing/models for user failed with ${pricing.status}`);
    assert(
      pricing.json.models.some((model) => model.model === created.modelName),
      'new model not visible in /pricing/models after group assignment'
    );
    assert(pricing.json.group.code === `${prefix}_group`, 'pricing group code should be the created group');
    checks.push('user_visible_models_reflect_real_group_access_after_assignment');

    const authMe = await get<AuthMeResponse>('/auth/me', userCookie);
    assert(authMe.status === 200, `/auth/me for user failed with ${authMe.status}`);
    assert(
      authMe.json.user.availableModels.some((model) => model.model === created.modelName),
      '/auth/me should include assigned model in availableModels'
    );
    checks.push('user_auth_me_shows_real_available_models');

    const tokenCreate = await post<TokenCreateResponse>('/tokens', {
      name: `${prefix}_token`,
      modelNames: [created.modelName]
    }, userCookie);
    assert(tokenCreate.status >= 200 && tokenCreate.status < 300, `create token failed with ${tokenCreate.status}`);
    assert(
      tokenCreate.json.token.modelNames.includes(created.modelName),
      'token model scope should contain created model'
    );
    checks.push('user_can_create_scoped_api_token_for_created_model');

    const v1Models = await getV1Models(tokenCreate.json.apiKey);
    assert(v1Models.status === 200, `/v1/models with token failed with ${v1Models.status}`);
    assert(v1Models.json.object === 'list', 'v1 models response should be object=list');
    assert(v1Models.json.data.some((entry) => entry.id === created.modelName), 'new model missing from /v1/models');
    checks.push('scoped_token_limits_v1_models_to_real_available_model');

    const blocked = [
      { baseUrl: `http://localhost:4567`, label: 'localhost' },
      { baseUrl: `http://127.0.0.1:4567`, label: 'loopback-ip' },
      { baseUrl: `http://metadata.google.internal`, label: 'metadata' }
    ];
    for (const item of blocked) {
      const blockedProvider = await post<AdminUpstreamProvider>('/admin/upstreams', {
        name: `${prefix}_${item.label}_provider`,
        baseUrl: item.baseUrl,
        apiKey: `qa-${item.label}-${suffix}`
      }, adminCookie);
      assert(
        blockedProvider.status >= 200 && blockedProvider.status < 300,
        `blocked ${item.label} upstream create failed with ${blockedProvider.status}`
      );
      created.blockedUpstreamProviderIds.push(blockedProvider.json.id);

      const healthCheck = await post<UpstreamHealthResponse>(`/admin/upstreams/${blockedProvider.json.id}/health-check`, undefined, adminCookie);
      assert(
        healthCheck.status >= 200 && healthCheck.status < 300,
        `/admin/upstreams/${blockedProvider.json.id}/health-check status ${healthCheck.status}`
      );
      assert(healthCheck.json.reachable === false, `blocked ${item.label} upstream should be unreachable by policy`);
      assert(
        healthCheck.json.provider.healthStatus === 'unhealthy',
        `blocked ${item.label} upstream health status should be unhealthy`
      );
      const errorText = (healthCheck.json.provider.lastHealthError ?? '').toLowerCase();
      assert(
        errorText.includes('private or local upstream address is not allowed') || errorText.includes('upstream host could not be resolved'),
        `blocked ${item.label} provider should report private/blocked error, got ${healthCheck.json.provider.lastHealthError}`
      );
    }
    checks.push('private_dns_and_local_upstream_addresses_are_blocked_by_health_check');

    residualBefore = await countResidual();
    checks.push('residual_counts_sampled_before_cleanup');

    console.log(JSON.stringify({ ok: true, suffix, checks, residualBefore }, null, 2));
  } catch (error) {
    checksError = error;
  } finally {
    await cleanup();
    residualAfter = await countResidual();
    await prisma.$disconnect();
  }

  console.log(
    JSON.stringify(
      {
        ok: checksError === undefined,
        suffix,
        checks,
        residualBefore,
        residualAfter
      },
      null,
      2
    )
  );

  if (checksError) {
    throw checksError;
  }

  assertResidualZero(residualAfter);
}

async function seedUsers(): Promise<SeededUsers> {
  const adminUsername = `${prefix}_admin`;
  const userUsername = `${prefix}_user`;
  const passwordHash = await bcrypt.hash(password, 12);

  const created = await prisma.$transaction(async (tx) => {
    const group = await tx.userGroup.upsert({
      where: { code: 'default' },
      update: {},
      create: {
        code: 'default',
        name: 'Default Group'
      }
    });

    const admin = await tx.user.create({
      data: {
        username: adminUsername,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${prefix}_admin_invite`
      }
    });

    const user = await tx.user.create({
      data: {
        username: userUsername,
        passwordHash,
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        groupId: group.id,
        inviteCode: `${prefix}_user_invite`
      }
    });

    await tx.wallet.createMany({
      data: [{ userId: admin.id }, { userId: user.id }]
    });

    return { adminId: admin.id, userId: user.id };
  });

  return {
    adminUsername,
    userUsername,
    adminId: created.adminId,
    userId: created.userId
  };
}

async function login(username: string) {
  return request<LoginResponse>('POST', '/auth/login', { username, password }, undefined);
}

async function get<T>(path: string, cookie?: string): Promise<HttpResult<T>> {
  return request<T>('GET', path, undefined, cookie);
}

async function post<T>(path: string, body: unknown, cookie?: string): Promise<HttpResult<T>> {
  return request<T>('POST', path, body, cookie);
}

async function request<T>(method: string, path: string, body?: unknown, cookie?: string): Promise<HttpResult<T>> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      accept: 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let json: T = {} as T;

  if (text) {
    try {
      json = JSON.parse(text) as T;
    } catch {
      json = {} as T;
    }
  }

  return {
    status: response.status,
    json,
    text,
    headers: response.headers,
    cookie: response.headers.get('set-cookie')?.split(';')[0]
  };
}

async function requestWebPage(path: string, cookie?: string): Promise<WebResult> {
  const response = await fetch(`${WEB_BASE_URL}${path}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
    redirect: 'manual'
  });

  return {
    status: response.status,
    text: await response.text(),
    location: response.headers.get('location') ?? '',
    headers: response.headers
  };
}

async function getV1Models(apiKey: string) {
  const response = await fetch(`${API_BASE_URL}/v1/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json'
    }
  });
  const text = await response.text();
  let json: V1ModelsResponse = { object: 'list', data: [] };

  if (text) {
    try {
      json = JSON.parse(text) as V1ModelsResponse;
    } catch {
      json = { object: 'list', data: [] };
    }
  }

  return {
    status: response.status,
    json,
    text,
    headers: response.headers
  };
}

function assertRedirectTo(response: WebResult, expectedPath: string, label: string) {
  assert(response.status >= 300 && response.status < 400, `${label} should redirect, got ${response.status}`);
  assert(
    response.location === expectedPath || response.location.endsWith(expectedPath),
    `${label} should redirect to ${expectedPath}, got ${response.location}`
  );
}

function assertMerchantModelConfigHtml(text: string) {
  const structuralMarkers = [
    'merchant-model-config-page',
    'data-page="merchant-model-config"',
    'id="merchant-model-publish"'
  ];
  const missingStructuralMarkers = structuralMarkers.filter((marker) => !text.includes(marker));
  assert(
    missingStructuralMarkers.length === 0,
    `merchant model-config page missing structural markers: ${missingStructuralMarkers.join(', ')}`
  );

  const markerGroups: string[][] = [
    ['merchant-shell-page'],
    ['模型发布'],
    ['第一步发布客户模型', '第一步：发布客户模型'],
    ['已发布客户模型']
  ];
  const found = markerGroups.filter((group) => group.some((marker) => text.includes(marker))).length;
  assert(found >= 4, `merchant model-config page missing expected merchant markers, found ${found}`);
  assert(!text.includes('id="merchant-model-routes"'), 'merchant model-config should not render route binding form');
  assert(!text.includes('第二步：给客户模型绑定上游线路'), 'merchant model-config should not include route binding copy');
  const forbiddenUserMarkers = ['个人中心', '余额充值', '通知设置', '令牌入口'];
  const leakedMarkers = forbiddenUserMarkers.filter((marker) => text.includes(marker));
  assert(leakedMarkers.length === 0, `merchant model-config leaked user-site markers: ${leakedMarkers.join(', ')}`);
}

function assertMerchantModelRoutesHtml(text: string) {
  const structuralMarkers = [
    'merchant-model-config-page',
    'data-page="merchant-model-routes"',
    'id="merchant-model-routes"'
  ];
  const missingStructuralMarkers = structuralMarkers.filter((marker) => !text.includes(marker));
  assert(
    missingStructuralMarkers.length === 0,
    `merchant model-routes page missing structural markers: ${missingStructuralMarkers.join(', ')}`
  );

  const markerGroups: string[][] = [
    ['merchant-shell-page'],
    ['模型线路绑定'],
    ['第二步绑定上游线路', '第二步：给客户模型绑定上游线路'],
    ['真实上游模型名']
  ];
  const found = markerGroups.filter((group) => group.some((marker) => text.includes(marker))).length;
  assert(found >= 4, `merchant model-routes page missing expected merchant markers, found ${found}`);
  assert(!text.includes('id="merchant-model-publish"'), 'merchant model-routes should not render model publishing form');
  assert(!text.includes('客户看到的模型名'), 'merchant model-routes should not include model publishing fields');
  const forbiddenUserMarkers = ['个人中心', '余额充值', '通知设置', '令牌入口'];
  const leakedMarkers = forbiddenUserMarkers.filter((marker) => text.includes(marker));
  assert(leakedMarkers.length === 0, `merchant model-routes leaked user-site markers: ${leakedMarkers.join(', ')}`);
}

async function countResidual() {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: prefix } },
    select: { id: true }
  });
  const userIds = users.map((user) => user.id);

  const groups = await prisma.userGroup.findMany({
    where: { code: { startsWith: `${prefix}_group` } },
    select: { id: true }
  });
  const groupIds = groups.map((group) => group.id);

  const modelPrices = await prisma.modelPrice.findMany({
    where: { model: { startsWith: `${prefix}_` } },
    select: { id: true, model: true }
  });
  const modelPriceIds = modelPrices.map((model) => model.id);
  const modelNames = modelPrices.map((model) => model.model);

  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: `${prefix}_` } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);

  const upstreamModels = await prisma.upstreamModel.findMany({
    where: {
      OR: [
        { publicModel: { startsWith: `${prefix}_` } },
        { providerId: { in: providerIds } }
      ]
    },
    select: { id: true }
  });
  const upstreamModelIds = upstreamModels.map((mapping) => mapping.id);

  const tokenIds = userIds.length
    ? await prisma.apiToken.findMany({
        where: { userId: { in: userIds } },
        select: { id: true }
      })
    : [];
  const tokenIdList = tokenIds.map((token) => token.id);
  const wallets = userIds.length ? await prisma.wallet.count({ where: { userId: { in: userIds } } }) : 0;
  const sessions = userIds.length ? await prisma.session.count({ where: { userId: { in: userIds } } }) : 0;
  const modelGroupAccesses = await prisma.modelGroupAccess.count({
    where: {
      OR: [{ groupId: { in: groupIds } }, { modelPriceId: { in: modelPriceIds } }]
    }
  });
  const apiTokenModelAccesses = await prisma.apiTokenModelAccess.count({
    where: {
      OR: [{ apiTokenId: { in: tokenIdList } }, { model: { in: modelNames } }]
    }
  });
  const adminAuditLogs = userIds.length
    ? await prisma.adminAuditLog.count({
        where: {
          OR: [
            { adminUserId: { in: userIds } },
            { targetId: { in: modelPriceIds } },
            { targetId: { in: providerIds } },
            { targetId: { in: upstreamModelIds } }
          ]
        }
      })
    : 0;
  const securityAuditLogs = userIds.length
    ? await prisma.securityAuditLog.count({
        where: {
          OR: [
            { actorUserId: { in: userIds } },
            { targetId: { in: userIds } },
            { targetId: { in: modelPriceIds } },
            { targetId: { in: providerIds } },
            { targetId: { in: upstreamModelIds } }
          ]
        }
      })
    : 0;
  const requestLogs =
    userIds.length || providerIds.length
      ? await prisma.requestLog.count({
          where: {
            OR: [
              { userId: { in: userIds } },
              { tokenId: { in: tokenIdList } },
              { upstreamProviderId: { in: providerIds } },
              { model: { startsWith: `${prefix}_` } }
            ]
          }
        })
      : 0;

  return {
    users: users.length,
    wallets,
    sessions,
    userGroups: groups.length,
    modelPrices: modelPrices.length,
    modelGroupAccesses,
    upstreamProviders: providers.length,
    upstreamModels: upstreamModels.length,
    apiTokens: tokenIdList.length,
    apiTokenModelAccesses,
    adminAuditLogs,
    securityAuditLogs,
    requestLogs
  };
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { username: { startsWith: prefix } }, select: { id: true } });
  const userIds = users.map((user) => user.id);
  const groups = await prisma.userGroup.findMany({
    where: { code: { startsWith: `${prefix}_group` } },
    select: { id: true, code: true }
  });
  const groupIds = groups.map((group) => group.id);
  const providers = await prisma.upstreamProvider.findMany({
    where: { name: { startsWith: `${prefix}_` } },
    select: { id: true }
  });
  const providerIds = providers.map((provider) => provider.id);
  const modelPrices = await prisma.modelPrice.findMany({
    where: { model: { startsWith: `${prefix}_` } },
    select: { id: true, model: true }
  });
  const modelPriceIds = modelPrices.map((model) => model.id);
  const modelNames = modelPrices.map((model) => model.model);

  const upstreamModels = await prisma.upstreamModel.findMany({
    where: {
      OR: [
        { publicModel: { in: modelNames } },
        { providerId: { in: providerIds } }
      ]
    },
    select: { id: true }
  });
  const upstreamModelIds = upstreamModels.map((mapping) => mapping.id);
  const tokenIds = userIds.length
    ? await prisma.apiToken.findMany({
        where: { userId: { in: userIds } },
        select: { id: true }
      })
    : [];
  const tokenIdList = tokenIds.map((token) => token.id);

  if (userIds.length) {
    await prisma.adminAuditLog.deleteMany({
      where: {
        OR: [
          { adminUserId: { in: userIds } },
          { targetId: { in: userIds } },
          { targetId: { in: modelPriceIds } },
          { targetId: { in: providerIds } },
          { targetId: { in: upstreamModelIds } }
        ]
      }
    });

    await prisma.securityAuditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: { in: userIds } },
          { targetId: { in: userIds } },
          { targetId: { in: modelPriceIds } },
          { targetId: { in: providerIds } },
          { targetId: { in: upstreamModelIds } }
        ]
      }
    });
  }

  await prisma.requestLog.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenId: { in: tokenIdList } },
        { upstreamProviderId: { in: providerIds } },
        { model: { startsWith: `${prefix}_` } }
      ]
    }
  });
  await prisma.usageEvent.deleteMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { tokenId: { in: tokenIdList } },
        { upstreamProviderId: { in: providerIds } },
        { model: { startsWith: `${prefix}_` } }
      ]
    }
  });
  await prisma.walletTransaction.deleteMany({
    where: {
      OR: [{ userId: { in: userIds } }]
    }
  });

  await prisma.apiTokenModelAccess.deleteMany({
    where: {
      OR: [{ apiTokenId: { in: tokenIdList } }]
    }
  });
  await prisma.apiToken.deleteMany({ where: { id: { in: tokenIdList } } });

  await prisma.modelGroupAccess.deleteMany({
    where: {
      OR: [{ modelPriceId: { in: modelPriceIds } }, { groupId: { in: groupIds } }]
    }
  });

  await prisma.upstreamModel.deleteMany({
    where: {
      OR: [
        { id: { in: upstreamModelIds } },
        { publicModel: { startsWith: `${prefix}_` } },
        { providerId: { in: providerIds } }
      ]
    }
  });

  await prisma.modelPrice.deleteMany({ where: { id: { in: modelPriceIds } } });
  await prisma.upstreamProvider.deleteMany({ where: { id: { in: providerIds } } });

  await prisma.wallet.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.userGroup.deleteMany({ where: { id: { in: groupIds } } });
}

function assertResidualZero(result: Residual | null) {
  if (!result) {
    return;
  }

  assert(result.users === 0, `residual users should be 0, got ${result.users}`);
  assert(result.wallets === 0, `residual wallets should be 0, got ${result.wallets}`);
  assert(result.sessions === 0, `residual sessions should be 0, got ${result.sessions}`);
  assert(result.userGroups === 0, `residual userGroups should be 0, got ${result.userGroups}`);
  assert(result.modelPrices === 0, `residual modelPrices should be 0, got ${result.modelPrices}`);
  assert(result.modelGroupAccesses === 0, `residual modelGroupAccesses should be 0, got ${result.modelGroupAccesses}`);
  assert(result.upstreamProviders === 0, `residual upstreamProviders should be 0, got ${result.upstreamProviders}`);
  assert(result.upstreamModels === 0, `residual upstreamModels should be 0, got ${result.upstreamModels}`);
  assert(result.apiTokens === 0, `residual apiTokens should be 0, got ${result.apiTokens}`);
  assert(result.apiTokenModelAccesses === 0, `residual apiTokenModelAccesses should be 0, got ${result.apiTokenModelAccesses}`);
  assert(result.adminAuditLogs === 0, `residual adminAuditLogs should be 0, got ${result.adminAuditLogs}`);
  assert(result.securityAuditLogs === 0, `residual securityAuditLogs should be 0, got ${result.securityAuditLogs}`);
  assert(result.requestLogs === 0, `residual requestLogs should be 0, got ${result.requestLogs}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

main();
