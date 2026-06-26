import type { Metadata } from 'next';
import {
  defaultPublicLanguage,
  normalizePublicLanguage,
  type PublicLanguageCode,
  type PublicRoute
} from './public-language-routing';

export {
  defaultPublicLanguage,
  normalizePublicLanguage,
  publicRoutes
} from './public-language-routing';
export type { PublicLanguageCode, PublicRoute } from './public-language-routing';

type PublicCopy = {
  announcementsDescription: string;
  announcementsTitle: string;
  announcementsSectionTitle: string;
  announcementsUpdateLogTitle: string;
  announcementsUsageGuideTitle: string;
  apiDocs: string;
  docsDescription: string;
  docsChecklistItems: string[];
  docsChecklistTitle: string;
  docsPathsTitle: string;
  docsQuickstartBody: string;
  docsTitle: string;
  homeDescription: string;
  homeTitle: string;
  modelPricing: string;
  navAnnouncements: string;
  navDocs: string;
  navHome: string;
  navPricing: string;
  navPublicAria: string;
  navStatus: string;
  pricingBillingRule: string;
  pricingDescription: string;
  pricingTitle: string;
  quickstart: string;
  announcementsEmptySection: string;
  announcementsPublishedItems: string;
  statusDescription: string;
  statusLastCheckLabel: string;
  statusMonitorBody: string;
  statusMonitorTitle: string;
  statusNotAvailable: string;
  statusOperationalBody: string;
  statusOperationalTitle: string;
  statusScopeBody: string;
  statusScopeTitle: string;
  statusServiceLabel: string;
  statusUnavailableTitle: string;
  statusTitle: string;
};

type PublicCopyTerms = {
  announcements: string;
  apiDocs: string;
  checklist: string;
  docs: string;
  docsPath: string;
  home: string;
  lastCheck: string;
  modelPricing: string;
  monitor: string;
  noItems: string;
  notAvailable: string;
  operational: string;
  pricing: string;
  publishedItems: string;
  quickstart: string;
  service: string;
  status: string;
  updateLog: string;
  usageTips: string;
};

const brandName = 'Azure Planet Relay';

const englishTerms: PublicCopyTerms = {
  announcements: 'Announcements',
  apiDocs: 'API documentation',
  checklist: 'Production checklist',
  docs: 'Docs',
  docsPath: 'OpenAI-compatible paths',
  home: 'Home',
  lastCheck: 'Last check',
  modelPricing: 'Model pricing',
  monitor: 'What to monitor',
  noItems: 'No public items in this section.',
  notAvailable: 'not available',
  operational: 'All public API checks are operational',
  pricing: 'Pricing',
  publishedItems: 'published items',
  quickstart: 'Quickstart',
  service: 'Service',
  status: 'Status',
  updateLog: 'Update log',
  usageTips: 'Usage tips'
};

const publicCopyTerms: Record<PublicLanguageCode, PublicCopyTerms> = {
  'zh-CN': { ...englishTerms, announcements: '平台公告', apiDocs: 'API 文档', checklist: '生产检查清单', docs: '文档', docsPath: 'OpenAI 兼容路径', home: '首页', lastCheck: '最后检查', modelPricing: '模型价格', monitor: '监控重点', noItems: '此栏目暂无公开内容。', notAvailable: '暂无', operational: '所有公开 API 检查均正常', pricing: '价格', publishedItems: '条已发布内容', quickstart: '快速开始', service: '服务', status: '状态', updateLog: '更新日志', usageTips: '使用建议' },
  'zh-TW': { ...englishTerms, announcements: '平台公告', apiDocs: 'API 文件', checklist: '生產檢查清單', docs: '文件', docsPath: 'OpenAI 相容路徑', home: '首頁', lastCheck: '最後檢查', modelPricing: '模型價格', monitor: '監控重點', noItems: '此欄目暫無公開內容。', notAvailable: '暫無', operational: '所有公開 API 檢查均正常', pricing: '價格', publishedItems: '則已發布內容', quickstart: '快速開始', service: '服務', status: '狀態', updateLog: '更新日誌', usageTips: '使用建議' },
  'en-US': englishTerms,
  'es-ES': { ...englishTerms, announcements: 'Anuncios', apiDocs: 'Documentacion API', checklist: 'Lista de produccion', docs: 'Docs', docsPath: 'Rutas compatibles con OpenAI', home: 'Inicio', lastCheck: 'Ultima comprobacion', modelPricing: 'Precios de modelos', monitor: 'Que monitorear', noItems: 'No hay elementos publicos en esta seccion.', notAvailable: 'no disponible', operational: 'Todas las comprobaciones publicas de API estan operativas', pricing: 'Precios', publishedItems: 'elementos publicados', quickstart: 'Inicio rapido', service: 'Servicio', status: 'Estado', updateLog: 'Registro de cambios', usageTips: 'Consejos de uso' },
  'fr-FR': { ...englishTerms, announcements: 'Annonces', apiDocs: 'Documentation API', checklist: 'Checklist de production', docs: 'Docs', docsPath: 'Chemins compatibles OpenAI', home: 'Accueil', lastCheck: 'Derniere verification', modelPricing: 'Prix des modeles', monitor: 'A surveiller', noItems: 'Aucun element public dans cette section.', notAvailable: 'indisponible', operational: 'Toutes les verifications API publiques sont operationnelles', pricing: 'Prix', publishedItems: 'elements publies', quickstart: 'Demarrage rapide', service: 'Service', status: 'Statut', updateLog: 'Journal des mises a jour', usageTips: 'Conseils d utilisation' },
  'de-DE': { ...englishTerms, announcements: 'Ankundigungen', docs: 'Docs', home: 'Start', pricing: 'Preise', quickstart: 'Schnellstart', status: 'Status' },
  'pt-BR': { ...englishTerms, announcements: 'Avisos', docs: 'Docs', home: 'Inicio', pricing: 'Precos', quickstart: 'Inicio rapido', status: 'Status' },
  'ja-JP': { ...englishTerms, announcements: 'お知らせ', apiDocs: 'API ドキュメント', docs: 'ドキュメント', docsPath: 'OpenAI 互換パス', home: 'ホーム', modelPricing: 'モデル料金', pricing: '料金', quickstart: 'クイックスタート', status: 'ステータス', updateLog: '更新履歴', usageTips: '利用ガイド' },
  'ko-KR': { ...englishTerms, announcements: '공지', docs: '문서', home: '홈', pricing: '가격', quickstart: '빠른 시작', status: '상태' },
  'ru-RU': { ...englishTerms, announcements: 'Obyavleniya', docs: 'Dokumenty', home: 'Glavnaya', pricing: 'Ceny', quickstart: 'Bystry start', status: 'Status' },
  'ar-EG': { ...englishTerms, announcements: 'الإعلانات', docs: 'المستندات', home: 'الرئيسية', pricing: 'الأسعار', quickstart: 'بدء سريع', status: 'الحالة' },
  'sw-KE': { ...englishTerms, announcements: 'Matangazo', docs: 'Nyaraka', home: 'Nyumbani', pricing: 'Bei', quickstart: 'Anza haraka', status: 'Hali' },
  'am-ET': { ...englishTerms, announcements: 'ማስታወቂያዎች', docs: 'ሰነዶች', home: 'መነሻ', pricing: 'ዋጋ', quickstart: 'ፈጣን መጀመሪያ', status: 'ሁኔታ' },
  'ha-NG': { ...englishTerms, announcements: 'Sanarwa', docs: 'Takardu', home: 'Gida', pricing: 'Farashi', quickstart: 'Fara da sauri', status: 'Matsayi' },
  'yo-NG': { ...englishTerms, announcements: 'Awon ikede', docs: 'Iwe', home: 'Ile', pricing: 'Owo', quickstart: 'Bere ni kiakia', status: 'Ipo' },
  'ig-NG': { ...englishTerms, announcements: 'Ozi', docs: 'Akwukwo', home: 'Ulo', pricing: 'Onuahia', quickstart: 'Malite ngwa ngwa', status: 'Onodu' },
  'zu-ZA': { ...englishTerms, announcements: 'Izaziso', docs: 'Amadokhumenti', home: 'Ikhaya', pricing: 'Amanani', quickstart: 'Qalisa masinyane', status: 'Isimo' },
  'af-ZA': { ...englishTerms, announcements: 'Aankondigings', docs: 'Dokumente', home: 'Tuis', pricing: 'Pryse', quickstart: 'Vinnige begin', status: 'Status' },
  'so-SO': { ...englishTerms, announcements: 'Ogeysiisyo', docs: 'Dukumenti', home: 'Hoyga', pricing: 'Qiime', quickstart: 'Bilow degdeg ah', status: 'Xaalad' },
  'rw-RW': { ...englishTerms, announcements: 'Amatangazo', docs: 'Inyandiko', home: 'Ahabanza', pricing: 'Ibiciro', quickstart: 'Tangira vuba', status: 'Imiterere' },
  'om-ET': { ...englishTerms, announcements: 'Beeksisa', docs: 'Galmee', home: 'Mana', pricing: 'Gatii', quickstart: 'Jalqaba saffisaa', status: 'Haala' },
  'hi-IN': { ...englishTerms, announcements: 'घोषणाएं', docs: 'दस्तावेज', home: 'होम', pricing: 'मूल्य', quickstart: 'त्वरित शुरुआत', status: 'स्थिति' },
  'id-ID': { ...englishTerms, announcements: 'Pengumuman', docs: 'Dokumen', home: 'Beranda', pricing: 'Harga', quickstart: 'Mulai cepat', status: 'Status' },
  'tr-TR': { ...englishTerms, announcements: 'Duyurular', docs: 'Belgeler', home: 'Ana sayfa', pricing: 'Fiyatlar', quickstart: 'Hizli baslangic', status: 'Durum' },
  'vi-VN': { ...englishTerms, announcements: 'Thong bao', docs: 'Tai lieu', home: 'Trang chu', pricing: 'Gia', quickstart: 'Bat dau nhanh', status: 'Trang thai' },
  'th-TH': { ...englishTerms, announcements: 'ประกาศ', docs: 'เอกสาร', home: 'หน้าแรก', pricing: 'ราคา', quickstart: 'เริ่มต้นเร็ว', status: 'สถานะ' },
  'it-IT': { ...englishTerms, announcements: 'Annunci', docs: 'Documenti', home: 'Home', pricing: 'Prezzi', quickstart: 'Avvio rapido', status: 'Stato' },
  'nl-NL': { ...englishTerms, announcements: 'Aankondigingen', docs: 'Docs', home: 'Home', pricing: 'Prijzen', quickstart: 'Snelstart', status: 'Status' },
  'pl-PL': { ...englishTerms, announcements: 'Ogloszenia', docs: 'Dokumenty', home: 'Start', pricing: 'Ceny', quickstart: 'Szybki start', status: 'Status' },
  'uk-UA': { ...englishTerms, announcements: 'Оголошення', docs: 'Документи', home: 'Головна', pricing: 'Ціни', quickstart: 'Швидкий старт', status: 'Статус' },
  'ms-MY': { ...englishTerms, announcements: 'Pengumuman', docs: 'Dokumen', home: 'Laman utama', pricing: 'Harga', quickstart: 'Mula pantas', status: 'Status' },
  'fa-IR': { ...englishTerms, announcements: 'اعلان ها', docs: 'مستندات', home: 'خانه', pricing: 'قیمت ها', quickstart: 'شروع سریع', status: 'وضعیت' }
};

const publicCopies = Object.fromEntries(
  Object.entries(publicCopyTerms).map(([language, terms]) => [language, buildPublicCopy(terms)])
) as Record<PublicLanguageCode, PublicCopy>;

const spanishPublicCopy: PublicCopy = {
  ...publicCopies['es-ES'],
  announcementsDescription: `Anuncios, registro de cambios y consejos de uso para ${brandName}.`,
  docsChecklistItems: [
    'Crea un token dedicado para cada aplicacion.',
    'Configura alertas de saldo y limites de solicitudes antes del lanzamiento publico.',
    'Revisa los precios de modelos antes de mover trafico.',
    'Usa los registros para conciliar volumen de solicitudes y gasto de tokens.'
  ],
  docsDescription: `Documentacion API para acceso de relevo compatible con OpenAI en ${brandName}.`,
  docsQuickstartBody:
    'Usa el endpoint compatible con OpenAI con tu clave API. Mantén las claves en el servidor, rota claves filtradas y revisa los registros de uso despues de cada cambio de integracion.',
  homeDescription: `${brandName} ofrece acceso de relevo API de IA compatible con OpenAI, precios de modelos, tokens, registros y recargas.`,
  navPublicAria: 'Navegacion publica',
  pricingBillingRule: 'La entrada y la salida se facturan por separado.',
  pricingDescription: `Precios de modelos, reglas de facturacion por tokens y ejemplos de integracion API para ${brandName}.`,
  statusDescription: `Estado y senales operativas de ${brandName}.`,
  statusMonitorBody:
    'Supervisa fallos de upstream, eventos de facturacion fallidos, volumen anormal de solicitudes y picos de gasto de tokens antes del lanzamiento.',
  statusOperationalBody:
    'La salud publica cubre alcance de API, disponibilidad de enrutamiento y capacidad de servir datos de la consola de clientes.',
  statusScopeBody:
    'La salud publica cubre alcance de API, disponibilidad de enrutamiento y capacidad de servir datos de la consola de clientes.',
  statusScopeTitle: 'Alcance operativo'
};

const simplifiedChinesePublicCopy: PublicCopy = {
  ...publicCopies['zh-CN'],
  announcementsDescription: `${brandName} 的平台公告、更新日志和使用建议。`,
  docsChecklistItems: [
    '为每个应用创建独立令牌。',
    '公开发布前配置余额提醒和请求限制。',
    '切换流量前复核模型价格。',
    '使用日志核对请求量和 token 消耗。'
  ],
  docsDescription: `${brandName} 的 OpenAI 兼容中转 API 文档。`,
  docsQuickstartBody:
    '使用 OpenAI 兼容端点和你的 API Key。密钥只放在服务端，泄漏后立即轮换，并在每次集成变更后检查使用日志。',
  homeDescription: `${brandName} 提供 OpenAI 兼容的 AI API 中转访问、模型价格、令牌、日志和充值流程。`,
  navPublicAria: '公开站导航',
  pricingBillingRule: '输入和输出分开计费。',
  pricingDescription: `${brandName} 的模型价格、token 计费规则和 API 集成示例。`,
  statusDescription: `${brandName} 的状态和运行信号。`,
  statusMonitorBody: '上线前监控上游失败、失败计费事件、异常请求量和 token 消耗峰值。',
  statusOperationalBody: '公开健康状态覆盖 API 可达性、路由可用性，以及服务客户控制台数据的能力。',
  statusScopeBody: '公开健康状态覆盖 API 可达性、路由可用性，以及服务客户控制台数据的能力。',
  statusScopeTitle: '运行范围'
};

const traditionalChinesePublicCopy: PublicCopy = {
  ...publicCopies['zh-TW'],
  announcementsDescription: `${brandName} 的平台公告、更新日誌和使用建議。`,
  docsChecklistItems: [
    '為每個應用建立獨立令牌。',
    '公開發布前設定餘額提醒和請求限制。',
    '切換流量前複核模型價格。',
    '使用日誌核對請求量和 token 消耗。'
  ],
  docsDescription: `${brandName} 的 OpenAI 相容中轉 API 文件。`,
  docsQuickstartBody:
    '使用 OpenAI 相容端點和你的 API Key。金鑰只放在伺服端，洩漏後立即輪換，並在每次整合變更後檢查使用日誌。',
  homeDescription: `${brandName} 提供 OpenAI 相容的 AI API 中轉存取、模型價格、令牌、日誌和充值流程。`,
  navPublicAria: '公開站導覽',
  pricingBillingRule: '輸入和輸出分開計費。',
  pricingDescription: `${brandName} 的模型價格、token 計費規則和 API 整合範例。`,
  statusDescription: `${brandName} 的狀態和運行訊號。`,
  statusMonitorBody: '上線前監控上游失敗、失敗計費事件、異常請求量和 token 消耗峰值。',
  statusOperationalBody: '公開健康狀態涵蓋 API 可達性、路由可用性，以及服務客戶控制台資料的能力。',
  statusScopeBody: '公開健康狀態涵蓋 API 可達性、路由可用性，以及服務客戶控制台資料的能力。',
  statusScopeTitle: '運行範圍'
};

const japanesePublicCopy: PublicCopy = {
  ...publicCopies['ja-JP'],
  announcementsDescription: `${brandName} のお知らせ、更新履歴、利用ガイド。`,
  docsChecklistItems: [
    'アプリごとに専用トークンを作成します。',
    '公開前に残高アラートとリクエスト制限を設定します。',
    'トラフィックを切り替える前にモデル料金を確認します。',
    'ログでリクエスト量と token 消費を照合します。'
  ],
  docsDescription: `${brandName} の OpenAI 互換 API リレー用ドキュメント。`,
  docsChecklistTitle: '本番チェックリスト',
  docsQuickstartBody:
    'OpenAI 互換エンドポイントを API キーと一緒に使用します。キーはサーバー側だけに保管し、漏えいしたキーはローテーションし、連携変更後は使用ログを確認します。',
  homeDescription: `${brandName} は OpenAI 互換の AI API リレー、モデル料金、トークン、ログ、チャージ機能を提供します。`,
  navPublicAria: '公開サイトナビゲーション',
  pricingBillingRule: '入力と出力は別々に課金されます。',
  pricingDescription: `${brandName} のモデル料金、token 課金ルール、API 連携例。`,
  statusDescription: `${brandName} のステータスと運用シグナル。`,
  statusLastCheckLabel: '最終確認',
  statusMonitorBody: '公開前に上流障害、課金失敗イベント、異常なリクエスト量、token 消費の急増を監視します。',
  statusMonitorTitle: '監視項目',
  statusNotAvailable: '利用不可',
  statusOperationalBody: '公開ヘルスは API 到達性、ルーティング可用性、顧客コンソールデータを提供する能力を確認します。',
  statusOperationalTitle: '公開 API は正常です',
  statusScopeBody: '公開ヘルスは API 到達性、ルーティング可用性、顧客コンソールデータを提供する能力を確認します。',
  statusScopeTitle: '運用範囲',
  statusServiceLabel: 'サービス',
  statusUnavailableTitle: 'ステータス 利用不可'
};

const readablePublicCopyOverrides: Partial<Record<PublicLanguageCode, PublicCopy>> = {
  'es-ES': spanishPublicCopy,
  'zh-CN': simplifiedChinesePublicCopy,
  'zh-TW': traditionalChinesePublicCopy,
  'ja-JP': japanesePublicCopy
};

function buildPublicCopy(terms: PublicCopyTerms): PublicCopy {
  return {
    announcementsDescription: `${terms.announcements}, ${terms.updateLog}, and ${terms.usageTips} for ${brandName}.`,
    announcementsEmptySection: terms.noItems,
    announcementsPublishedItems: terms.publishedItems,
    announcementsSectionTitle: terms.announcements,
    announcementsTitle: `${terms.announcements} - ${brandName}`,
    announcementsUpdateLogTitle: terms.updateLog,
    announcementsUsageGuideTitle: terms.usageTips,
    apiDocs: terms.apiDocs,
    docsChecklistItems: [
      'Create a dedicated token for each application.',
      'Set balance alerts and request limits before public release.',
      'Review model prices before switching traffic.',
      'Use logs to reconcile request volume and token spend.'
    ],
    docsChecklistTitle: terms.checklist,
    docsDescription: `${terms.apiDocs} for OpenAI-compatible API relay access on ${brandName}.`,
    docsPathsTitle: terms.docsPath,
    docsQuickstartBody:
      'Use the OpenAI-compatible endpoint with your API key. Keep keys server-side, rotate leaked keys, and monitor usage logs after every integration change.',
    docsTitle: `${terms.docs} - ${brandName}`,
    homeDescription: `${brandName} provides OpenAI-compatible AI API relay access with model pricing, tokens, logs, and recharge workflows.`,
    homeTitle: brandName,
    modelPricing: terms.modelPricing,
    navAnnouncements: terms.announcements,
    navDocs: terms.docs,
    navHome: terms.home,
    navPricing: terms.pricing,
    navPublicAria: 'Public navigation',
    navStatus: terms.status,
    pricingBillingRule: 'Input and output are billed separately.',
    pricingDescription: `${terms.modelPricing}, token billing rules, and API integration examples for ${brandName}.`,
    pricingTitle: `${terms.modelPricing} - ${brandName}`,
    quickstart: terms.quickstart,
    statusDescription: `${terms.status} and operational signals for ${brandName}.`,
    statusLastCheckLabel: terms.lastCheck,
    statusMonitorBody:
      'Monitor upstream failures, failed billing events, abnormal request volume, and token spend spikes before launch.',
    statusMonitorTitle: terms.monitor,
    statusNotAvailable: terms.notAvailable,
    statusOperationalBody:
      'Public health covers API reachability, routing availability, and the ability to serve customer console data.',
    statusOperationalTitle: terms.operational,
    statusScopeBody:
      'Public health covers API reachability, routing availability, and the ability to serve customer console data.',
    statusScopeTitle: 'Operational scope',
    statusServiceLabel: terms.service,
    statusTitle: `${terms.status} - ${brandName}`,
    statusUnavailableTitle: `${terms.status} ${terms.notAvailable}`
  };
}

export function getPublicSiteUrl() {
  return (process.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_WEB_URL ?? 'https://newaicode.com').replace(/\/+$/, '');
}

export function getPublicCopy(language: PublicLanguageCode) {
  return readablePublicCopyOverrides[language] ?? publicCopies[language] ?? publicCopies[defaultPublicLanguage];
}

export function buildPublicUrl(route: PublicRoute, language?: PublicLanguageCode) {
  const url = new URL(buildPublicHref(route, language ?? defaultPublicLanguage), getPublicSiteUrl());
  return url.toString();
}

export function buildPublicHref(route: PublicRoute, language?: PublicLanguageCode) {
  const normalizedRoute = route === '/' ? '/' : route;
  if (!language || language === defaultPublicLanguage) {
    return normalizedRoute;
  }

  const separator = normalizedRoute.includes('?') ? '&' : '?';
  return `${normalizedRoute}${separator}language=${encodeURIComponent(language)}`;
}

export function publicPageMetadata(route: PublicRoute, language: PublicLanguageCode, title: string, description: string): Metadata {
  void route;
  void language;

  return {
    description,
    title
  };
}

export function publicNavItems(language: PublicLanguageCode) {
  const copy = getPublicCopy(language);
  return [
    { href: buildPublicHref('/', language), label: copy.navHome },
    { href: buildPublicHref('/pricing', language), label: copy.navPricing },
    { href: buildPublicHref('/docs', language), label: copy.navDocs },
    { href: buildPublicHref('/status', language), label: copy.navStatus },
    { href: buildPublicHref('/announcements', language), label: copy.navAnnouncements }
  ];
}
