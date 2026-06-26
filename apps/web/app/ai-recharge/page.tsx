'use client';

import { ReloadOutlined, ShoppingOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ConsoleShell } from '../components/console-shell';
import { useI18n } from '../components/language-provider';
import {
  getLocalizedAiRechargePageField,
  getLocalizedAiRechargeProductField,
  getAiRechargePageConfig,
  listAiRechargeProducts,
  type AiRechargePageConfig,
  type AiRechargeProduct
} from '../lib/ai-recharge-api';
import { getProfile, logout, type PublicUser } from '../lib/auth-api';
import { formatMoneyCny } from '../lib/billing-format';
import type { LanguageCode } from '../lib/i18n';
import { pageTerm } from '../lib/page-copy-terms';

type AiRechargeCopy = {
  deliveryNote: string;
  emptyBody: string;
  emptyTitle: string;
  heroEyebrow: string;
  heroSubtitle: string;
  heroTitle: string;
  imageAlt: string;
  loadFailed: string;
  productDays: (days: number) => string;
  productSection: string;
  purchaseNote: string;
  refresh: string;
};

const AI_RECHARGE_COPY = {
  'zh-CN': {
    deliveryNote: '交付说明',
    emptyBody: '商家在后台发布并上架后，会显示在这里。',
    emptyTitle: '暂无上架代充商品',
    heroEyebrow: '海外 AI 会员代充',
    heroSubtitle: '这里仅展示商家已上架的代充商品和简介；普通用户不能发布商品。',
    heroTitle: '会员代充商品',
    imageAlt: 'AI 代充简介',
    loadFailed: '代充商品加载失败',
    productDays: (days) => `${days} 天`,
    productSection: '可代充商品',
    purchaseNote: '购买说明',
    refresh: '刷新代充商品'
  },
  'zh-TW': {
    deliveryNote: '交付說明',
    emptyBody: '商家在後台發布並上架後，會顯示在這裡。',
    emptyTitle: '暫無上架代充商品',
    heroEyebrow: '海外 AI 會員代充',
    heroSubtitle: '這裡僅展示商家已上架的代充商品和簡介；一般使用者不能發布商品。',
    heroTitle: '會員代充商品',
    imageAlt: 'AI 代充簡介',
    loadFailed: '代充商品載入失敗',
    productDays: (days) => `${days} 天`,
    productSection: '可代充商品',
    purchaseNote: '購買說明',
    refresh: '重新整理代充商品'
  },
  'en-US': {
    deliveryNote: 'Delivery notes',
    emptyBody: 'Products will appear here after the merchant publishes and lists them.',
    emptyTitle: 'No recharge products listed',
    heroEyebrow: 'Overseas AI membership recharge',
    heroSubtitle: 'Only merchant-listed recharge products and descriptions are shown here. Regular users cannot publish products.',
    heroTitle: 'Membership recharge products',
    imageAlt: 'AI recharge introduction',
    loadFailed: 'Failed to load recharge products',
    productDays: (days) => `${days} days`,
    productSection: 'Available recharge products',
    purchaseNote: 'Purchase notes',
    refresh: 'Refresh recharge products'
  }
} satisfies Record<'zh-CN' | 'zh-TW' | 'en-US', AiRechargeCopy>;

const AI_RECHARGE_COPY_BY_LANGUAGE = {
  'af-ZA': {
    deliveryNote: 'Afleweringsnotas',
    emptyBody: 'Produkte verskyn hier nadat die handelaar dit publiseer en lys.',
    emptyTitle: 'Geen herlaaiprodukte gelys nie',
    heroEyebrow: 'Oorsese AI-lidmaatskap-herlaai',
    heroSubtitle: 'Net herlaaiprodukte en beskrywings wat handelaars gelys het, word hier gewys. Gewone gebruikers kan nie produkte publiseer nie.',
    heroTitle: 'Lidmaatskap-herlaaiprodukte',
    imageAlt: 'AI-herlaai-inleiding',
    loadFailed: 'Kon herlaaiprodukte nie laai nie',
    productDays: (days) => `${days} dae`,
    productSection: 'Beskikbare herlaaiprodukte',
    purchaseNote: 'Aankoopnotas',
    refresh: 'Verfris herlaaiprodukte'
  },
  'am-ET': {
    deliveryNote: 'የማስረከቢያ ማስታወሻዎች',
    emptyBody: 'ነጋዴው ካተማመነና ከዘረዘረ በኋላ ምርቶች እዚህ ይታያሉ።',
    emptyTitle: 'የተዘረዘሩ የመሙያ ምርቶች የሉም',
    heroEyebrow: 'የውጭ አገር AI አባልነት መሙያ',
    heroSubtitle: 'እዚህ የሚታዩት ነጋዴዎች የዘረዘሯቸው የመሙያ ምርቶችና መግለጫዎች ብቻ ናቸው። መደበኛ ተጠቃሚዎች ምርቶችን ማተም አይችሉም።',
    heroTitle: 'የአባልነት መሙያ ምርቶች',
    imageAlt: 'የAI መሙያ መግቢያ',
    loadFailed: 'የመሙያ ምርቶችን መጫን አልተሳካም',
    productDays: (days) => `${days} ቀናት`,
    productSection: 'ያሉ የመሙያ ምርቶች',
    purchaseNote: 'የግዢ ማስታወሻዎች',
    refresh: 'የመሙያ ምርቶችን አድስ'
  },
  'ar-EG': {
    deliveryNote: 'ملاحظات التسليم',
    emptyBody: 'ستظهر المنتجات هنا بعد أن ينشرها التاجر ويدرجها.',
    emptyTitle: 'لا توجد منتجات شحن مدرجة',
    heroEyebrow: 'شحن عضويات الذكاء الاصطناعي الخارجية',
    heroSubtitle: 'يتم عرض منتجات الشحن والأوصاف المدرجة من التجار فقط هنا. لا يمكن للمستخدمين العاديين نشر منتجات.',
    heroTitle: 'منتجات شحن العضويات',
    imageAlt: 'مقدمة شحن الذكاء الاصطناعي',
    loadFailed: 'فشل تحميل منتجات الشحن',
    productDays: (days) => `${days} يوم`,
    productSection: 'منتجات الشحن المتاحة',
    purchaseNote: 'ملاحظات الشراء',
    refresh: 'تحديث منتجات الشحن'
  },
  'de-DE': {
    deliveryNote: 'Lieferhinweise',
    emptyBody: 'Produkte erscheinen hier, nachdem der Händler sie veröffentlicht und gelistet hat.',
    emptyTitle: 'Keine Aufladeprodukte gelistet',
    heroEyebrow: 'Auslandsaufladung für KI-Mitgliedschaften',
    heroSubtitle: 'Hier werden nur von Händlern gelistete Aufladeprodukte und Beschreibungen angezeigt. Normale Nutzer können keine Produkte veröffentlichen.',
    heroTitle: 'Mitgliedschafts-Aufladeprodukte',
    imageAlt: 'Einführung zur KI-Aufladung',
    loadFailed: 'Aufladeprodukte konnten nicht geladen werden',
    productDays: (days) => `${days} Tage`,
    productSection: 'Verfügbare Aufladeprodukte',
    purchaseNote: 'Kaufhinweise',
    refresh: 'Aufladeprodukte aktualisieren'
  },
  'en-US': AI_RECHARGE_COPY['en-US'],
  'es-ES': {
    deliveryNote: 'Notas de entrega',
    emptyBody: 'Los productos aparecerán aquí después de que el comerciante los publique y los liste.',
    emptyTitle: 'No hay productos de recarga listados',
    heroEyebrow: 'Recarga de membresías de IA en el extranjero',
    heroSubtitle: 'Aquí solo se muestran productos de recarga y descripciones publicados por comerciantes. Los usuarios normales no pueden publicar productos.',
    heroTitle: 'Productos de recarga de membresía',
    imageAlt: 'Introducción a la recarga de IA',
    loadFailed: 'No se pudieron cargar los productos de recarga',
    productDays: (days) => `${days} días`,
    productSection: 'Productos de recarga disponibles',
    purchaseNote: 'Notas de compra',
    refresh: 'Actualizar productos de recarga'
  },
  'fa-IR': {
    deliveryNote: 'یادداشت‌های تحویل',
    emptyBody: 'پس از انتشار و فهرست شدن توسط فروشنده، محصولات اینجا نمایش داده می‌شوند.',
    emptyTitle: 'هیچ محصول شارژی فهرست نشده است',
    heroEyebrow: 'شارژ عضویت هوش مصنوعی خارج از کشور',
    heroSubtitle: 'فقط محصولات شارژ و توضیحات فهرست‌شده توسط فروشندگان در اینجا نمایش داده می‌شود. کاربران عادی نمی‌توانند محصول منتشر کنند.',
    heroTitle: 'محصولات شارژ عضویت',
    imageAlt: 'معرفی شارژ هوش مصنوعی',
    loadFailed: 'بارگذاری محصولات شارژ ناموفق بود',
    productDays: (days) => `${days} روز`,
    productSection: 'محصولات شارژ موجود',
    purchaseNote: 'یادداشت‌های خرید',
    refresh: 'به‌روزرسانی محصولات شارژ'
  },
  'fr-FR': {
    deliveryNote: 'Notes de livraison',
    emptyBody: 'Les produits apparaîtront ici après publication et mise en ligne par le marchand.',
    emptyTitle: 'Aucun produit de recharge listé',
    heroEyebrow: 'Recharge d’abonnement IA à l’étranger',
    heroSubtitle: 'Seuls les produits de recharge et descriptions listés par les marchands sont affichés ici. Les utilisateurs ordinaires ne peuvent pas publier de produits.',
    heroTitle: 'Produits de recharge d’abonnement',
    imageAlt: 'Introduction à la recharge IA',
    loadFailed: 'Échec du chargement des produits de recharge',
    productDays: (days) => `${days} jours`,
    productSection: 'Produits de recharge disponibles',
    purchaseNote: 'Notes d’achat',
    refresh: 'Actualiser les produits de recharge'
  },
  'ha-NG': {
    deliveryNote: 'Bayanan isarwa',
    emptyBody: 'Kayayyaki za su bayyana a nan bayan dan kasuwa ya wallafa kuma ya jera su.',
    emptyTitle: 'Babu kayayyakin caji da aka jera',
    heroEyebrow: 'Cajin membobin AI na kasashen waje',
    heroSubtitle: 'A nan ana nuna kayayyakin caji da bayanansu da yan kasuwa suka jera kawai. Masu amfani na yau da kullum ba za su iya wallafa kaya ba.',
    heroTitle: 'Kayayyakin caji na membobinsu',
    imageAlt: 'Gabatarwar cajin AI',
    loadFailed: 'An kasa loda kayayyakin caji',
    productDays: (days) => `${days} kwanaki`,
    productSection: 'Kayayyakin caji da ake da su',
    purchaseNote: 'Bayanan saya',
    refresh: 'Sabunta kayayyakin caji'
  },
  'hi-IN': {
    deliveryNote: 'डिलीवरी नोट्स',
    emptyBody: 'व्यापारी द्वारा प्रकाशित और सूचीबद्ध किए जाने के बाद उत्पाद यहां दिखाई देंगे।',
    emptyTitle: 'कोई रिचार्ज उत्पाद सूचीबद्ध नहीं',
    heroEyebrow: 'विदेशी AI सदस्यता रिचार्ज',
    heroSubtitle: 'यहां केवल व्यापारियों द्वारा सूचीबद्ध रिचार्ज उत्पाद और विवरण दिखते हैं। सामान्य उपयोगकर्ता उत्पाद प्रकाशित नहीं कर सकते।',
    heroTitle: 'सदस्यता रिचार्ज उत्पाद',
    imageAlt: 'AI रिचार्ज परिचय',
    loadFailed: 'रिचार्ज उत्पाद लोड नहीं हो सके',
    productDays: (days) => `${days} दिन`,
    productSection: 'उपलब्ध रिचार्ज उत्पाद',
    purchaseNote: 'खरीद नोट्स',
    refresh: 'रिचार्ज उत्पाद रीफ्रेश करें'
  },
  'ig-NG': {
    deliveryNote: 'Ndetu nnyefe',
    emptyBody: 'Ngwaahịa ga-apụta ebe a mgbe onye ahịa bipụtara ma depụta ha.',
    emptyTitle: 'Enweghị ngwaahịa nchaji edepụtara',
    heroEyebrow: 'Nchaji otu AI mba ofesi',
    heroSubtitle: 'Naanị ngwaahịa nchaji na nkọwa ndị ahịa depụtara ka a na-egosi ebe a. Ndị ọrụ nkịtị enweghị ike ibipụta ngwaahịa.',
    heroTitle: 'Ngwaahịa nchaji otu',
    imageAlt: 'Mmalite nchaji AI',
    loadFailed: 'Ibudata ngwaahịa nchaji dara',
    productDays: (days) => `${days} ụbọchị`,
    productSection: 'Ngwaahịa nchaji dị',
    purchaseNote: 'Ndetu ịzụrụ',
    refresh: 'Megharịa ngwaahịa nchaji'
  },
  'id-ID': {
    deliveryNote: 'Catatan pengiriman',
    emptyBody: 'Produk akan muncul di sini setelah merchant menerbitkan dan mencantumkannya.',
    emptyTitle: 'Belum ada produk isi ulang',
    heroEyebrow: 'Isi ulang keanggotaan AI luar negeri',
    heroSubtitle: 'Hanya produk isi ulang dan deskripsi yang dicantumkan merchant yang ditampilkan di sini. Pengguna biasa tidak dapat menerbitkan produk.',
    heroTitle: 'Produk isi ulang keanggotaan',
    imageAlt: 'Pengantar isi ulang AI',
    loadFailed: 'Gagal memuat produk isi ulang',
    productDays: (days) => `${days} hari`,
    productSection: 'Produk isi ulang tersedia',
    purchaseNote: 'Catatan pembelian',
    refresh: 'Segarkan produk isi ulang'
  },
  'it-IT': {
    deliveryNote: 'Note di consegna',
    emptyBody: 'I prodotti appariranno qui dopo che il merchant li avrà pubblicati e messi in lista.',
    emptyTitle: 'Nessun prodotto di ricarica elencato',
    heroEyebrow: 'Ricarica abbonamenti IA esteri',
    heroSubtitle: 'Qui vengono mostrati solo prodotti di ricarica e descrizioni pubblicati dai merchant. Gli utenti normali non possono pubblicare prodotti.',
    heroTitle: 'Prodotti di ricarica abbonamento',
    imageAlt: 'Introduzione alla ricarica IA',
    loadFailed: 'Impossibile caricare i prodotti di ricarica',
    productDays: (days) => `${days} giorni`,
    productSection: 'Prodotti di ricarica disponibili',
    purchaseNote: 'Note di acquisto',
    refresh: 'Aggiorna prodotti di ricarica'
  },
  'ja-JP': {
    deliveryNote: '納品メモ',
    emptyBody: '加盟店が公開して掲載した商品がここに表示されます。',
    emptyTitle: '掲載中のチャージ商品はありません',
    heroEyebrow: '海外AIメンバーシップのチャージ',
    heroSubtitle: 'ここには加盟店が掲載したチャージ商品と説明のみ表示されます。通常ユーザーは商品を公開できません。',
    heroTitle: 'メンバーシップチャージ商品',
    imageAlt: 'AIチャージの紹介',
    loadFailed: 'チャージ商品の読み込みに失敗しました',
    productDays: (days) => `${days}日`,
    productSection: '利用可能なチャージ商品',
    purchaseNote: '購入メモ',
    refresh: 'チャージ商品を更新'
  },
  'ko-KR': {
    deliveryNote: '배송 메모',
    emptyBody: '판매자가 게시하고 등록한 뒤 상품이 여기에 표시됩니다.',
    emptyTitle: '등록된 충전 상품이 없습니다',
    heroEyebrow: '해외 AI 멤버십 충전',
    heroSubtitle: '판매자가 등록한 충전 상품과 설명만 여기에 표시됩니다. 일반 사용자는 상품을 게시할 수 없습니다.',
    heroTitle: '멤버십 충전 상품',
    imageAlt: 'AI 충전 소개',
    loadFailed: '충전 상품을 불러오지 못했습니다',
    productDays: (days) => `${days}일`,
    productSection: '사용 가능한 충전 상품',
    purchaseNote: '구매 메모',
    refresh: '충전 상품 새로고침'
  },
  'ms-MY': {
    deliveryNote: 'Nota penghantaran',
    emptyBody: 'Produk akan muncul di sini selepas pedagang menerbitkan dan menyenaraikannya.',
    emptyTitle: 'Tiada produk tambah nilai disenaraikan',
    heroEyebrow: 'Tambah nilai keahlian AI luar negara',
    heroSubtitle: 'Hanya produk tambah nilai dan penerangan yang disenaraikan pedagang dipaparkan di sini. Pengguna biasa tidak boleh menerbitkan produk.',
    heroTitle: 'Produk tambah nilai keahlian',
    imageAlt: 'Pengenalan tambah nilai AI',
    loadFailed: 'Gagal memuatkan produk tambah nilai',
    productDays: (days) => `${days} hari`,
    productSection: 'Produk tambah nilai tersedia',
    purchaseNote: 'Nota pembelian',
    refresh: 'Segarkan produk tambah nilai'
  },
  'nl-NL': {
    deliveryNote: 'Leveringsnotities',
    emptyBody: 'Producten verschijnen hier nadat de handelaar ze publiceert en vermeldt.',
    emptyTitle: 'Geen opwaardeerproducten vermeld',
    heroEyebrow: 'Buitenlandse AI-lidmaatschapsopwaardering',
    heroSubtitle: 'Alleen door handelaren vermelde opwaardeerproducten en beschrijvingen worden hier getoond. Gewone gebruikers kunnen geen producten publiceren.',
    heroTitle: 'Lidmaatschap-opwaardeerproducten',
    imageAlt: 'Introductie AI-opwaardering',
    loadFailed: 'Opwaardeerproducten laden mislukt',
    productDays: (days) => `${days} dagen`,
    productSection: 'Beschikbare opwaardeerproducten',
    purchaseNote: 'Aankoopnotities',
    refresh: 'Opwaardeerproducten vernieuwen'
  },
  'om-ET': {
    deliveryNote: 'Yaadannoo geejjibaa',
    emptyBody: 'Daldalaan erga maxxansee tarreesseen booda oomishoonni asitti mulatu.',
    emptyTitle: 'Oomisha guutuu tarreeffame hin jiru',
    heroEyebrow: 'Guutuu miseensummaa AI biyya alaa',
    heroSubtitle: 'Asitti kan mulatu oomisha guutuu fi ibsa daldaltoonni tarreessan qofa. Fayyadamtoonni idilee oomisha maxxansuu hin danda’an.',
    heroTitle: 'Oomisha guutuu miseensummaa',
    imageAlt: 'Seensa guutuu AI',
    loadFailed: 'Oomisha guutuu fe’uun hin milkoofne',
    productDays: (days) => `${days} guyyoota`,
    productSection: 'Oomisha guutuu jiran',
    purchaseNote: 'Yaadannoo bittaa',
    refresh: 'Oomisha guutuu haaromsi'
  },
  'pl-PL': {
    deliveryNote: 'Uwagi dotyczące dostawy',
    emptyBody: 'Produkty pojawią się tutaj po opublikowaniu i wystawieniu ich przez sprzedawcę.',
    emptyTitle: 'Brak wystawionych produktów doładowania',
    heroEyebrow: 'Zagraniczne doładowanie członkostwa AI',
    heroSubtitle: 'Tutaj wyświetlane są tylko produkty doładowania i opisy wystawione przez sprzedawców. Zwykli użytkownicy nie mogą publikować produktów.',
    heroTitle: 'Produkty doładowania członkostwa',
    imageAlt: 'Wprowadzenie do doładowania AI',
    loadFailed: 'Nie udało się załadować produktów doładowania',
    productDays: (days) => `${days} dni`,
    productSection: 'Dostępne produkty doładowania',
    purchaseNote: 'Uwagi dotyczące zakupu',
    refresh: 'Odśwież produkty doładowania'
  },
  'pt-BR': {
    deliveryNote: 'Notas de entrega',
    emptyBody: 'Os produtos aparecerão aqui depois que o comerciante os publicar e listar.',
    emptyTitle: 'Nenhum produto de recarga listado',
    heroEyebrow: 'Recarga de assinatura de IA no exterior',
    heroSubtitle: 'Aqui são exibidos apenas produtos de recarga e descrições listados por comerciantes. Usuários comuns não podem publicar produtos.',
    heroTitle: 'Produtos de recarga de assinatura',
    imageAlt: 'Introdução à recarga de IA',
    loadFailed: 'Falha ao carregar produtos de recarga',
    productDays: (days) => `${days} dias`,
    productSection: 'Produtos de recarga disponíveis',
    purchaseNote: 'Notas de compra',
    refresh: 'Atualizar produtos de recarga'
  },
  'ru-RU': {
    deliveryNote: 'Примечания к доставке',
    emptyBody: 'Товары появятся здесь после публикации и размещения продавцом.',
    emptyTitle: 'Нет размещенных товаров пополнения',
    heroEyebrow: 'Пополнение зарубежных AI-подписок',
    heroSubtitle: 'Здесь отображаются только товары пополнения и описания, размещенные продавцами. Обычные пользователи не могут публиковать товары.',
    heroTitle: 'Товары пополнения подписки',
    imageAlt: 'Описание пополнения AI',
    loadFailed: 'Не удалось загрузить товары пополнения',
    productDays: (days) => `${days} дн.`,
    productSection: 'Доступные товары пополнения',
    purchaseNote: 'Примечания к покупке',
    refresh: 'Обновить товары пополнения'
  },
  'rw-RW': {
    deliveryNote: 'Ibisobanuro byo gutanga',
    emptyBody: 'Ibicuruzwa bizagaragara hano nyuma y’uko umucuruzi abitangaje akanabishyira ku rutonde.',
    emptyTitle: 'Nta bicuruzwa byo kongera amafaranga biri ku rutonde',
    heroEyebrow: 'Kongera ubunyamuryango bwa AI bwo hanze',
    heroSubtitle: 'Hano herekanwa gusa ibicuruzwa byo kongera amafaranga n’ibisobanuro byashyizweho n’abacuruzi. Abakoresha basanzwe ntibashobora gutangaza ibicuruzwa.',
    heroTitle: 'Ibicuruzwa byo kongera ubunyamuryango',
    imageAlt: 'Intangiriro yo kongera AI',
    loadFailed: 'Gupakira ibicuruzwa byo kongera amafaranga byanze',
    productDays: (days) => `${days} iminsi`,
    productSection: 'Ibicuruzwa byo kongera amafaranga bihari',
    purchaseNote: 'Ibisobanuro byo kugura',
    refresh: 'Ongera upakire ibicuruzwa'
  },
  'so-SO': {
    deliveryNote: 'Qoraallada gaarsiinta',
    emptyBody: 'Alaabtu halkan ayay ka muuqan doontaa kadib marka ganacsaduhu daabaco oo liis gareeyo.',
    emptyTitle: 'Ma jiraan alaabo dib-u-buuxin ah oo la liis gareeyay',
    heroEyebrow: 'Dib-u-buuxinta xubinnimada AI ee dibadda',
    heroSubtitle: 'Halkan waxaa lagu muujiyaa oo keliya alaabta dib-u-buuxinta iyo sharaxaadaha ganacsatadu liis gareeyeen. Isticmaalayaasha caadiga ahi ma daabici karaan alaab.',
    heroTitle: 'Alaabta dib-u-buuxinta xubinnimada',
    imageAlt: 'Hordhac dib-u-buuxinta AI',
    loadFailed: 'Alaabta dib-u-buuxinta lama soo dejin',
    productDays: (days) => `${days} maalmood`,
    productSection: 'Alaabta dib-u-buuxinta ee la heli karo',
    purchaseNote: 'Qoraallada iibsiga',
    refresh: 'Cusbooneysii alaabta dib-u-buuxinta'
  },
  'sw-KE': {
    deliveryNote: 'Maelezo ya uwasilishaji',
    emptyBody: 'Bidhaa zitaonekana hapa baada ya mfanyabiashara kuzichapisha na kuziweka kwenye orodha.',
    emptyTitle: 'Hakuna bidhaa za kuongeza salio zilizoorodheshwa',
    heroEyebrow: 'Kuongeza uanachama wa AI wa nje ya nchi',
    heroSubtitle: 'Hapa huonyeshwa bidhaa za kuongeza salio na maelezo yaliyowekwa na wafanyabiashara pekee. Watumiaji wa kawaida hawawezi kuchapisha bidhaa.',
    heroTitle: 'Bidhaa za kuongeza uanachama',
    imageAlt: 'Utangulizi wa kuongeza salio la AI',
    loadFailed: 'Imeshindwa kupakia bidhaa za kuongeza salio',
    productDays: (days) => `${days} siku`,
    productSection: 'Bidhaa za kuongeza salio zinazopatikana',
    purchaseNote: 'Maelezo ya ununuzi',
    refresh: 'Onyesha upya bidhaa za kuongeza salio'
  },
  'th-TH': {
    deliveryNote: 'หมายเหตุการส่งมอบ',
    emptyBody: 'สินค้าจะแสดงที่นี่หลังจากร้านค้าเผยแพร่และลงรายการแล้ว',
    emptyTitle: 'ยังไม่มีสินค้าชาร์จที่ลงรายการ',
    heroEyebrow: 'ชาร์จสมาชิก AI ต่างประเทศ',
    heroSubtitle: 'ที่นี่แสดงเฉพาะสินค้าชาร์จและคำอธิบายที่ร้านค้าลงรายการไว้ ผู้ใช้ทั่วไปไม่สามารถเผยแพร่สินค้าได้',
    heroTitle: 'สินค้าชาร์จสมาชิก',
    imageAlt: 'แนะนำการชาร์จ AI',
    loadFailed: 'โหลดสินค้าชาร์จไม่สำเร็จ',
    productDays: (days) => `${days} วัน`,
    productSection: 'สินค้าชาร์จที่มีอยู่',
    purchaseNote: 'หมายเหตุการซื้อ',
    refresh: 'รีเฟรชสินค้าชาร์จ'
  },
  'tr-TR': {
    deliveryNote: 'Teslimat notları',
    emptyBody: 'Ürünler, satıcı yayınlayıp listeledikten sonra burada görünür.',
    emptyTitle: 'Listelenmiş yükleme ürünü yok',
    heroEyebrow: 'Yurt dışı AI üyelik yüklemesi',
    heroSubtitle: 'Burada yalnızca satıcıların listelediği yükleme ürünleri ve açıklamaları gösterilir. Normal kullanıcılar ürün yayınlayamaz.',
    heroTitle: 'Üyelik yükleme ürünleri',
    imageAlt: 'AI yükleme tanıtımı',
    loadFailed: 'Yükleme ürünleri yüklenemedi',
    productDays: (days) => `${days} gün`,
    productSection: 'Kullanılabilir yükleme ürünleri',
    purchaseNote: 'Satın alma notları',
    refresh: 'Yükleme ürünlerini yenile'
  },
  'uk-UA': {
    deliveryNote: 'Примітки щодо доставки',
    emptyBody: 'Товари з’являться тут після публікації та розміщення продавцем.',
    emptyTitle: 'Немає розміщених товарів поповнення',
    heroEyebrow: 'Поповнення закордонних AI-підписок',
    heroSubtitle: 'Тут показано лише товари поповнення та описи, розміщені продавцями. Звичайні користувачі не можуть публікувати товари.',
    heroTitle: 'Товари поповнення підписки',
    imageAlt: 'Опис поповнення AI',
    loadFailed: 'Не вдалося завантажити товари поповнення',
    productDays: (days) => `${days} дн.`,
    productSection: 'Доступні товари поповнення',
    purchaseNote: 'Примітки до покупки',
    refresh: 'Оновити товари поповнення'
  },
  'vi-VN': {
    deliveryNote: 'Ghi chú giao hàng',
    emptyBody: 'Sản phẩm sẽ xuất hiện tại đây sau khi người bán công bố và niêm yết.',
    emptyTitle: 'Chưa có sản phẩm nạp được niêm yết',
    heroEyebrow: 'Nạp hội viên AI ở nước ngoài',
    heroSubtitle: 'Tại đây chỉ hiển thị sản phẩm nạp và mô tả do người bán niêm yết. Người dùng thông thường không thể công bố sản phẩm.',
    heroTitle: 'Sản phẩm nạp hội viên',
    imageAlt: 'Giới thiệu nạp AI',
    loadFailed: 'Không thể tải sản phẩm nạp',
    productDays: (days) => `${days} ngày`,
    productSection: 'Sản phẩm nạp có sẵn',
    purchaseNote: 'Ghi chú mua hàng',
    refresh: 'Làm mới sản phẩm nạp'
  },
  'yo-NG': {
    deliveryNote: 'Àkọsílẹ̀ ìfijiṣẹ',
    emptyBody: 'Àwọn ọjà yóò hàn níbí lẹ́yìn tí oníṣòwò bá tẹ̀jáde tí ó sì fi sínú àtòkọ.',
    emptyTitle: 'Kò sí ọjà ìfikún tí a ṣe àtòkọ',
    heroEyebrow: 'Ìfikún ọmọ ẹgbẹ́ AI ti òkè òkun',
    heroSubtitle: 'Àwọn ọjà ìfikún àti àlàyé tí àwọn oníṣòwò ṣe àtòkọ nìkan ni a fi hàn níbí. Olùlò lasan kò le tẹ ọjà jáde.',
    heroTitle: 'Àwọn ọjà ìfikún ọmọ ẹgbẹ́',
    imageAlt: 'Ìfihàn ìfikún AI',
    loadFailed: 'Kò le kojú àwọn ọjà ìfikún',
    productDays: (days) => `${days} ọjọ́`,
    productSection: 'Àwọn ọjà ìfikún tó wà',
    purchaseNote: 'Àkọsílẹ̀ rírà',
    refresh: 'Tún àwọn ọjà ìfikún ṣe'
  },
  'zh-CN': AI_RECHARGE_COPY['zh-CN'],
  'zh-TW': AI_RECHARGE_COPY['zh-TW'],
  'zu-ZA': {
    deliveryNote: 'Amanothi okulethwa',
    emptyBody: 'Imikhiqizo izovela lapha ngemva kokuthi umthengisi eyishicilele futhi wayifaka ohlwini.',
    emptyTitle: 'Ayikho imikhiqizo yokugcwalisa esohlwini',
    heroEyebrow: 'Ukugcwalisa ubulungu be-AI baphesheya',
    heroSubtitle: 'Lapha kuboniswa kuphela imikhiqizo yokugcwalisa nezincazelo ezifakwe ohlwini ngabathengisi. Abasebenzisi abavamile abakwazi ukushicilela imikhiqizo.',
    heroTitle: 'Imikhiqizo yokugcwalisa ubulungu',
    imageAlt: 'Isingeniso sokugcwalisa i-AI',
    loadFailed: 'Yehlulekile ukulayisha imikhiqizo yokugcwalisa',
    productDays: (days) => `${days} izinsuku`,
    productSection: 'Imikhiqizo yokugcwalisa etholakalayo',
    purchaseNote: 'Amanothi okuthenga',
    refresh: 'Vuselela imikhiqizo yokugcwalisa'
  }
} satisfies Record<LanguageCode, AiRechargeCopy>;

function getAiRechargeCopy(language: LanguageCode) {
  return AI_RECHARGE_COPY_BY_LANGUAGE[language] ?? AI_RECHARGE_COPY['en-US'];
}

export default function AiRechargePage() {
  const router = useRouter();
  const { language } = useI18n();
  const copy = getAiRechargeCopy(language);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [products, setProducts] = useState<AiRechargeProduct[]>([]);
  const [pageConfig, setPageConfig] = useState<AiRechargePageConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const requestSequenceRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    setIsLoading(true);
    setError('');

    async function loadDataForLanguage() {
      try {
        const [profileResult, productResult, configResult] = await Promise.all([
          getProfile(language),
          listAiRechargeProducts(language),
          getAiRechargePageConfig(language)
        ]);
        if (!cancelled && requestSequenceRef.current === requestId) {
          setUser(profileResult.user);
          setProducts(productResult.items);
          setPageConfig(configResult);
        }
      } catch (nextError) {
        const nextMessage = nextError instanceof Error ? nextError.message : '';
        if (!cancelled && requestSequenceRef.current === requestId) {
          setError(copy.loadFailed);
        }
        if (
          requestSequenceRef.current === requestId &&
          (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话'))
        ) {
          router.replace('/login');
        }
      } finally {
        if (!cancelled && requestSequenceRef.current === requestId) {
          setIsLoading(false);
        }
      }
    }

    void loadDataForLanguage();

    return () => {
      cancelled = true;
    };
  }, [copy.loadFailed, language, router]);

  const loadData = useCallback(async () => {
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    setIsLoading(true);
    setError('');

    try {
      const [profileResult, productResult, configResult] = await Promise.all([
        getProfile(language),
        listAiRechargeProducts(language),
        getAiRechargePageConfig(language)
      ]);
      if (requestSequenceRef.current === requestId) {
        setUser(profileResult.user);
        setProducts(productResult.items);
        setPageConfig(configResult);
      }
    } catch (nextError) {
      const nextMessage = nextError instanceof Error ? nextError.message : '';
      if (requestSequenceRef.current !== requestId) {
        return;
      }

      setError(copy.loadFailed);
      if (nextMessage.includes('401') || nextMessage.includes('认证') || nextMessage.includes('会话')) {
        router.replace('/login');
      }
    } finally {
      if (requestSequenceRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [copy.loadFailed, language, router]);

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
            <p className="eyebrow">{copy.heroEyebrow}</p>
            <h1>{copy.heroTitle}</h1>
            <small>{copy.heroSubtitle}</small>
          </div>
          <button className="icon-button" disabled={isLoading} onClick={() => void loadData()} title={copy.refresh} type="button">
            <ReloadOutlined />
          </button>
        </section>

        {error ? <p className="form-error wide-panel">{error}</p> : null}

        {pageConfig &&
        (pageConfig.introTitle ||
          pageConfig.introContent ||
          pageConfig.introImageDataUrl ||
          getLocalizedAiRechargePageField(pageConfig, 'introTitle', language) ||
          getLocalizedAiRechargePageField(pageConfig, 'introContent', language)) ? (
          <section className="account-panel wide-panel ai-recharge-intro">
            <div className="ai-recharge-intro-copy">
              {getLocalizedAiRechargePageField(pageConfig, 'introTitle', language) ? (
                <h2>{getLocalizedAiRechargePageField(pageConfig, 'introTitle', language)}</h2>
              ) : null}
              {getLocalizedAiRechargePageField(pageConfig, 'introContent', language) ? (
                <p>{getLocalizedAiRechargePageField(pageConfig, 'introContent', language)}</p>
              ) : null}
            </div>
            {pageConfig.introImageDataUrl ? (
              <img
                alt={getLocalizedAiRechargePageField(pageConfig, 'introTitle', language) ?? copy.imageAlt}
                src={pageConfig.introImageDataUrl}
              />
            ) : null}
          </section>
        ) : null}

        <section className="account-panel wide-panel">
          <div className="panel-title">
            <ShoppingOutlined />
            <h2>{copy.productSection}</h2>
          </div>
          <div className="ai-recharge-product-grid">
            {products.map((product) => {
              const platform = getLocalizedAiRechargeProductField(product, 'platform', language);
              const title = getLocalizedAiRechargeProductField(product, 'title', language);
              const planName = getLocalizedAiRechargeProductField(product, 'planName', language);
              const description = getLocalizedAiRechargeProductField(product, 'description', language);
              const purchaseNote = getLocalizedAiRechargeProductField(product, 'purchaseNote', language);
              const deliveryNote = getLocalizedAiRechargeProductField(product, 'deliveryNote', language);
              const packagePreset = getVibePackagePreset(product);
              const packageLabel = getVibePackageLabel(product, language);
              const quotaLabel = formatProductQuota(product, copy, language);

              return (
                <article
                  className="ai-recharge-product-card"
                  data-product-id={product.id}
                  data-product-kind={product.productKind}
                  data-package-preset={packagePreset}
                  data-qa="user-ai-recharge-product-card"
                  data-quota-hours={product.quotaHours ?? ''}
                  data-quota-period-days={product.quotaPeriodDays ?? ''}
                  data-token-quota={product.tokenQuota ?? ''}
                  key={product.id}
                >
                  <header>
                    <span>{product.productKind === 'vibe_coding' ? 'VibeCoding' : platform}</span>
                    <strong>{title}</strong>
                  </header>
                  <div>
                    <b>{formatMoneyCny(product.priceCnyCents)}</b>
                    <small>
                      {planName}
                      {product.durationDays ? ` · ${copy.productDays(product.durationDays)}` : ''}
                    </small>
                    {packageLabel ? <small data-qa="user-ai-recharge-package-label">{packageLabel}</small> : null}
                    <small>{quotaLabel}</small>
                  </div>
                  <p>{description}</p>
                  {purchaseNote ? (
                    <p className="ai-recharge-note">
                      <strong>{copy.purchaseNote}</strong>
                      {purchaseNote}
                    </p>
                  ) : null}
                  {deliveryNote ? (
                    <p className="ai-recharge-note">
                      <strong>{copy.deliveryNote}</strong>
                      {deliveryNote}
                    </p>
                  ) : null}
                </article>
              );
            })}
            {!products.length && !isLoading ? (
              <div className="empty-state-card">
                <ShoppingOutlined />
                <strong>{copy.emptyTitle}</strong>
                <span>{copy.emptyBody}</span>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </ConsoleShell>
  );
}

type VibePackagePreset = 'daily' | 'weekly' | 'custom' | '';

const VIBE_PACKAGE_LABELS: Partial<Record<LanguageCode, Record<Exclude<VibePackagePreset, ''>, string>>> = {
  'af-ZA': { custom: 'Pasgemaakte pakket', daily: 'Daaglikse pakket', weekly: 'Weeklikse pakket' },
  'am-ET': { custom: 'Custom package', daily: 'Daily package', weekly: 'Weekly package' },
  'ar-EG': { custom: 'باقة مخصصة', daily: 'باقة يومية', weekly: 'باقة أسبوعية' },
  'de-DE': { custom: 'Individuelles Paket', daily: 'Tagespaket', weekly: 'Wochenpaket' },
  'en-US': { custom: 'Custom package', daily: 'Daily package', weekly: 'Weekly package' },
  'es-ES': { custom: 'Paquete personalizado', daily: 'Paquete diario', weekly: 'Paquete semanal' },
  'fa-IR': { custom: 'بسته سفارشی', daily: 'بسته روزانه', weekly: 'بسته هفتگی' },
  'fr-FR': { custom: 'Forfait personnalise', daily: 'Forfait journalier', weekly: 'Forfait hebdomadaire' },
  'ha-NG': { custom: 'Kunshin alada', daily: 'Kunshin rana', weekly: 'Kunshin mako' },
  'hi-IN': { custom: 'कस्टम पैकेज', daily: 'दैनिक पैकेज', weekly: 'साप्ताहिक पैकेज' },
  'id-ID': { custom: 'Paket kustom', daily: 'Paket harian', weekly: 'Paket mingguan' },
  'ig-NG': { custom: 'Ngwugwu ahaziri', daily: 'Ngwugwu kwa ubochi', weekly: 'Ngwugwu izu' },
  'it-IT': { custom: 'Pacchetto personalizzato', daily: 'Pacchetto giornaliero', weekly: 'Pacchetto settimanale' },
  'ja-JP': { custom: 'カスタムパッケージ', daily: '1日パッケージ', weekly: '週間パッケージ' },
  'ko-KR': { custom: '사용자 지정 패키지', daily: '일일 패키지', weekly: '주간 패키지' },
  'ms-MY': { custom: 'Pakej tersuai', daily: 'Pakej harian', weekly: 'Pakej mingguan' },
  'nl-NL': { custom: 'Aangepast pakket', daily: 'Dagpakket', weekly: 'Weekpakket' },
  'om-ET': { custom: 'Paakeejii dhuunfaa', daily: 'Paakeejii guyyaa', weekly: 'Paakeejii torban' },
  'pl-PL': { custom: 'Pakiet niestandardowy', daily: 'Pakiet dzienny', weekly: 'Pakiet tygodniowy' },
  'pt-BR': { custom: 'Pacote personalizado', daily: 'Pacote diario', weekly: 'Pacote semanal' },
  'ru-RU': { custom: 'Индивидуальный пакет', daily: 'Дневной пакет', weekly: 'Недельный пакет' },
  'rw-RW': { custom: 'Ipaki yihariye', daily: 'Ipaki ya buri munsi', weekly: 'Ipaki ya buri cyumweru' },
  'so-SO': { custom: 'Xirmo gaar ah', daily: 'Xirmo maalinle ah', weekly: 'Xirmo toddobaadle ah' },
  'sw-KE': { custom: 'Kifurushi maalum', daily: 'Kifurushi cha siku', weekly: 'Kifurushi cha wiki' },
  'th-TH': { custom: 'แพ็กเกจกำหนดเอง', daily: 'แพ็กเกจรายวัน', weekly: 'แพ็กเกจรายสัปดาห์' },
  'tr-TR': { custom: 'Ozel paket', daily: 'Gunluk paket', weekly: 'Haftalik paket' },
  'uk-UA': { custom: 'Індивідуальний пакет', daily: 'Денний пакет', weekly: 'Тижневий пакет' },
  'vi-VN': { custom: 'Goi tuy chinh', daily: 'Goi hang ngay', weekly: 'Goi hang tuan' },
  'yo-NG': { custom: 'Package adani', daily: 'Package ojoojumo', weekly: 'Package ose' },
  'zh-CN': { custom: '自定义套餐', daily: '单日日包', weekly: '周包' },
  'zh-TW': { custom: '自訂套餐', daily: '單日日包', weekly: '週包' },
  'zu-ZA': { custom: 'Iphakheji yangokwezifiso', daily: 'Iphakheji yansuku zonke', weekly: 'Iphakheji yeviki' }
};

function getVibePackagePreset(product: AiRechargeProduct): VibePackagePreset {
  if (product.productKind !== 'vibe_coding') {
    return '';
  }

  if (product.durationDays === 1 && product.quotaPeriodDays === 1) {
    return 'daily';
  }

  if (product.durationDays === 7 && product.quotaPeriodDays === 7) {
    return 'weekly';
  }

  return 'custom';
}

function getVibePackageLabel(product: AiRechargeProduct, language: LanguageCode) {
  const preset = getVibePackagePreset(product);
  if (!preset) {
    return '';
  }

  return (VIBE_PACKAGE_LABELS[language] ?? VIBE_PACKAGE_LABELS['en-US'])?.[preset] ?? preset;
}

function formatProductQuota(product: AiRechargeProduct, copy: AiRechargeCopy, language: LanguageCode) {
  const parts = [
    product.quotaHours ? `${product.quotaHours}h` : null,
    product.quotaPeriodDays ? copy.productDays(product.quotaPeriodDays) : null,
    product.tokenQuota ? `${product.tokenQuota.toLocaleString(language)} ${pageTerm(language, 'token')}` : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' / ') : `${pageTerm(language, 'quota')}: ${pageTerm(language, 'notConfigured')}`;
}
