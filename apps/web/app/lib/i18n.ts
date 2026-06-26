type LanguageDirection = 'ltr' | 'rtl';

export const supportedLanguages = [
  { code: 'zh-CN', label: '简体中文', shortLabel: '中文' },
  { code: 'zh-TW', label: '繁體中文', shortLabel: '繁中' },
  { code: 'en-US', label: 'English', shortLabel: 'EN' },
  { code: 'es-ES', label: 'Español', shortLabel: 'ES' },
  { code: 'fr-FR', label: 'Français', shortLabel: 'FR' },
  { code: 'de-DE', label: 'Deutsch', shortLabel: 'DE' },
  { code: 'pt-BR', label: 'Português', shortLabel: 'PT' },
  { code: 'ja-JP', label: '日本語', shortLabel: '日本語' },
  { code: 'ko-KR', label: '한국어', shortLabel: '한국어' },
  { code: 'ru-RU', label: 'Русский', shortLabel: 'RU' },
  { code: 'ar-EG', label: 'العربية', shortLabel: 'AR', direction: 'rtl' },
  { code: 'sw-KE', label: 'Kiswahili', shortLabel: 'SW' },
  { code: 'am-ET', label: 'አማርኛ', shortLabel: 'AM' },
  { code: 'ha-NG', label: 'Hausa', shortLabel: 'HA' },
  { code: 'yo-NG', label: 'Yorùbá', shortLabel: 'YO' },
  { code: 'ig-NG', label: 'Igbo', shortLabel: 'IG' },
  { code: 'zu-ZA', label: 'isiZulu', shortLabel: 'ZU' },
  { code: 'af-ZA', label: 'Afrikaans', shortLabel: 'AF' },
  { code: 'so-SO', label: 'Soomaali', shortLabel: 'SO' },
  { code: 'rw-RW', label: 'Kinyarwanda', shortLabel: 'RW' },
  { code: 'om-ET', label: 'Afaan Oromoo', shortLabel: 'OM' },
  { code: 'hi-IN', label: 'हिन्दी', shortLabel: 'HI' },
  { code: 'id-ID', label: 'Bahasa Indonesia', shortLabel: 'ID' },
  { code: 'tr-TR', label: 'Türkçe', shortLabel: 'TR' },
  { code: 'vi-VN', label: 'Tiếng Việt', shortLabel: 'VI' },
  { code: 'th-TH', label: 'ไทย', shortLabel: 'TH' },
  { code: 'it-IT', label: 'Italiano', shortLabel: 'IT' },
  { code: 'nl-NL', label: 'Nederlands', shortLabel: 'NL' },
  { code: 'pl-PL', label: 'Polski', shortLabel: 'PL' },
  { code: 'uk-UA', label: 'Українська', shortLabel: 'UK' },
  { code: 'ms-MY', label: 'Bahasa Melayu', shortLabel: 'MS' },
  { code: 'fa-IR', label: 'فارسی', shortLabel: 'FA', direction: 'rtl' }
] as const satisfies ReadonlyArray<{
  code: string;
  direction?: LanguageDirection;
  label: string;
  shortLabel: string;
}>;

export type LanguageCode = (typeof supportedLanguages)[number]['code'];

export const defaultLanguage: LanguageCode = 'zh-CN';
export const languageStorageKey = 'nested-relay-language';

type LanguagePack = {
  app: {
    description: string;
    merchantConsoleName: string;
    name: string;
    userConsoleName: string;
  };
  auth: {
    loginFailed: string;
    loginSubmit: string;
    loginSubmitting: string;
    loginTitle: string;
    password: string;
    registerFailed: string;
    registerLink: string;
    registerSubmit: string;
    registerSubmitting: string;
    registerTitle: string;
    toLogin: string;
    username: string;
  };
  common: {
    close: string;
    loading: string;
    logout: string;
    none: string;
    ok: string;
    refresh: string;
  };
  home: {
    announcement: string;
    closeAnnouncement: string;
    contentCount: string;
    contentUnit: string;
    defaultSubtitle: string;
    documentEntrances: string;
    documentUnit: string;
    emptyPublished: string;
    entry: {
      aiRecharge: string;
      experience: string;
      log: string;
      notificationSettings: string;
      pricing: string;
      token: string;
    };
    latestPublished: string;
    loadFailed: string;
    section: {
      announcement: string;
      updateLog: string;
      usageGuide: string;
    };
  };
  language: {
    label: string;
    title: string;
  };
  merchantNav: {
    aiRecharge: string;
    announcements: string;
    dashboard: string;
    modelConfig: string;
    primaryAria: string;
    rechargeCodes: string;
    sidebarAria: string;
    users: string;
  };
  nav: {
    account: string;
    accountAria: string;
    aiRecharge: string;
    experience: string;
    home: string;
    log: string;
    notificationSettings: string;
    pricing: string;
    primaryAria: string;
    profile: string;
    recharge: string;
    token: string;
  };
  role: {
    admin: string;
    user: string;
  };
};

type PartialLanguagePack = {
  app?: Partial<LanguagePack['app']>;
  auth?: Partial<LanguagePack['auth']>;
  common?: Partial<LanguagePack['common']>;
  home?: Partial<Omit<LanguagePack['home'], 'entry' | 'section'>> & {
    entry?: Partial<LanguagePack['home']['entry']>;
    section?: Partial<LanguagePack['home']['section']>;
  };
  language?: Partial<LanguagePack['language']>;
  merchantNav?: Partial<LanguagePack['merchantNav']>;
  nav?: Partial<LanguagePack['nav']>;
  role?: Partial<LanguagePack['role']>;
};

const englishPack: LanguagePack = {
  app: {
    description: 'Azure Planet AI API relay',
    merchantConsoleName: 'Azure Planet Merchant Console',
    name: 'Azure Planet Relay',
    userConsoleName: 'Azure Planet Relay'
  },
  auth: {
    loginFailed: 'Login failed',
    loginSubmit: 'Log in',
    loginSubmitting: 'Logging in',
    loginTitle: 'Log in to your account',
    password: 'Password',
    registerFailed: 'Registration failed',
    registerLink: 'Create new account',
    registerSubmit: 'Create account',
    registerSubmitting: 'Creating account',
    registerTitle: 'Create an account',
    toLogin: 'Already have an account? Log in',
    username: 'Username'
  },
  common: {
    close: 'Close',
    loading: 'Loading',
    logout: 'Log out',
    none: 'None',
    ok: 'Got it',
    refresh: 'Refresh'
  },
  home: {
    announcement: 'Announcement',
    closeAnnouncement: 'Close announcement',
    contentCount: 'Published content',
    contentUnit: 'items',
    defaultSubtitle: 'Smart service relay console',
    documentEntrances: 'Document entrances',
    documentUnit: 'links',
    emptyPublished: 'No published content',
    entry: {
      aiRecharge: 'AI recharge',
      experience: 'Try models',
      log: 'Logs',
      notificationSettings: 'Notifications',
      pricing: 'Model catalog',
      token: 'Tokens'
    },
    latestPublished: 'Latest publish',
    loadFailed: 'Failed to load home content',
    section: {
      announcement: 'Platform announcements',
      updateLog: 'Update log',
      usageGuide: 'Usage tips'
    }
  },
  language: {
    label: 'Language',
    title: 'Choose interface language'
  },
  merchantNav: {
    aiRecharge: 'AI recharge',
    announcements: 'Announcements/Home',
    dashboard: 'Dashboard',
    modelConfig: 'Models',
    primaryAria: 'Merchant primary navigation',
    rechargeCodes: 'Recharge codes',
    sidebarAria: 'Merchant navigation',
    users: 'User stats'
  },
  nav: {
    account: 'Account',
    accountAria: 'Account navigation',
    aiRecharge: 'AI recharge',
    experience: 'Try models',
    home: 'Home',
    log: 'Logs',
    notificationSettings: 'Notifications',
    pricing: 'Models',
    primaryAria: 'Primary navigation',
    profile: 'Profile',
    recharge: 'Top up',
    token: 'Tokens'
  },
  role: {
    admin: 'Admin',
    user: 'User'
  }
};

const localizedCoreOverrides: Partial<Record<LanguageCode, PartialLanguagePack>> = {
  'fr-FR': {
    auth: {
      loginFailed: 'Échec de la connexion',
      loginSubmit: 'Se connecter',
      loginSubmitting: 'Connexion',
      loginTitle: 'Connectez-vous à votre compte',
      password: 'Mot de passe',
      registerFailed: 'Échec de l’inscription',
      registerLink: 'Créer un nouveau compte',
      registerSubmit: 'Créer le compte',
      registerSubmitting: 'Création',
      registerTitle: 'Créer un compte',
      toLogin: 'Vous avez déjà un compte ? Connectez-vous',
      username: 'Nom d’utilisateur'
    },
    common: { close: 'Fermer', loading: 'Chargement', logout: 'Déconnexion', none: 'Aucun', ok: 'Compris', refresh: 'Actualiser' },
    nav: { account: 'Compte', aiRecharge: 'Recharge IA', experience: 'Tester', home: 'Accueil', log: 'Journaux', notificationSettings: 'Notifications', pricing: 'Modèles', profile: 'Profil', recharge: 'Recharger', token: 'Jetons' }
  },
  'de-DE': {
    auth: {
      loginFailed: 'Anmeldung fehlgeschlagen',
      loginSubmit: 'Anmelden',
      loginSubmitting: 'Anmeldung läuft',
      loginTitle: 'Bei Ihrem Konto anmelden',
      password: 'Passwort',
      registerFailed: 'Registrierung fehlgeschlagen',
      registerLink: 'Neues Konto erstellen',
      registerSubmit: 'Konto erstellen',
      registerSubmitting: 'Wird erstellt',
      registerTitle: 'Konto erstellen',
      toLogin: 'Schon ein Konto? Anmelden',
      username: 'Benutzername'
    },
    common: { close: 'Schließen', loading: 'Lädt', logout: 'Abmelden', none: 'Keine', ok: 'Verstanden', refresh: 'Aktualisieren' },
    nav: { account: 'Konto', aiRecharge: 'KI-Aufladung', experience: 'Testen', home: 'Start', log: 'Protokolle', notificationSettings: 'Benachrichtigungen', pricing: 'Modelle', profile: 'Profil', recharge: 'Aufladen', token: 'Tokens' }
  },
  'pt-BR': {
    auth: {
      loginFailed: 'Falha ao entrar',
      loginSubmit: 'Entrar',
      loginSubmitting: 'Entrando',
      loginTitle: 'Entre na sua conta',
      password: 'Senha',
      registerFailed: 'Falha no cadastro',
      registerLink: 'Criar nova conta',
      registerSubmit: 'Criar conta',
      registerSubmitting: 'Criando',
      registerTitle: 'Criar uma conta',
      toLogin: 'Já tem uma conta? Entrar',
      username: 'Nome de usuário'
    },
    common: { close: 'Fechar', loading: 'Carregando', logout: 'Sair', none: 'Nenhum', ok: 'Entendi', refresh: 'Atualizar' },
    nav: { account: 'Conta', aiRecharge: 'Recarga IA', experience: 'Testar modelos', home: 'Início', log: 'Registros', notificationSettings: 'Notificações', pricing: 'Modelos', profile: 'Perfil', recharge: 'Recarregar', token: 'Tokens' }
  },
  'ja-JP': {
    auth: {
      loginFailed: 'ログインに失敗しました',
      loginSubmit: 'ログイン',
      loginSubmitting: 'ログイン中',
      loginTitle: 'アカウントにログイン',
      password: 'パスワード',
      registerFailed: '登録に失敗しました',
      registerLink: '新しいアカウントを作成',
      registerSubmit: 'アカウント作成',
      registerSubmitting: '作成中',
      registerTitle: 'アカウントを作成',
      toLogin: 'すでにアカウントがありますか？ログイン',
      username: 'ユーザー名'
    },
    common: { close: '閉じる', loading: '読み込み中', logout: 'ログアウト', none: 'なし', ok: '了解', refresh: '更新' },
    home: {
      announcement: 'お知らせ',
      closeAnnouncement: 'お知らせを閉じる',
      contentCount: '公開済みコンテンツ',
      contentUnit: '件',
      defaultSubtitle: 'スマートサービス中継コンソール',
      documentEntrances: 'ドキュメント入口',
      documentUnit: 'リンク',
      emptyPublished: '公開済みコンテンツはありません',
      latestPublished: '最新公開',
      loadFailed: 'ホームコンテンツの読み込みに失敗しました',
      section: {
        announcement: 'プラットフォームのお知らせ',
        updateLog: '更新履歴',
        usageGuide: '使い方のヒント'
      }
    },
    nav: { account: 'アカウント', aiRecharge: 'AIチャージ', experience: 'モデルを試す', home: 'ホーム', log: 'ログ', notificationSettings: '通知', pricing: 'モデル', profile: 'プロフィール', recharge: 'チャージ', token: 'トークン' }
  },
  'ko-KR': {
    auth: {
      loginFailed: '로그인에 실패했습니다',
      loginSubmit: '로그인',
      loginSubmitting: '로그인 중',
      loginTitle: '계정에 로그인',
      password: '비밀번호',
      registerFailed: '가입에 실패했습니다',
      registerLink: '새 계정 만들기',
      registerSubmit: '계정 만들기',
      registerSubmitting: '생성 중',
      registerTitle: '계정 만들기',
      toLogin: '이미 계정이 있나요? 로그인',
      username: '사용자 이름'
    },
    common: { close: '닫기', loading: '불러오는 중', logout: '로그아웃', none: '없음', ok: '확인', refresh: '새로고침' },
    nav: { account: '계정', aiRecharge: 'AI 충전', experience: '모델 체험', home: '홈', log: '로그', notificationSettings: '알림', pricing: '모델', profile: '프로필', recharge: '충전', token: '토큰' }
  },
  'ru-RU': {
    auth: {
      loginFailed: 'Не удалось войти',
      loginSubmit: 'Войти',
      loginSubmitting: 'Вход',
      loginTitle: 'Войдите в аккаунт',
      password: 'Пароль',
      registerFailed: 'Регистрация не удалась',
      registerLink: 'Создать новый аккаунт',
      registerSubmit: 'Создать аккаунт',
      registerSubmitting: 'Создание',
      registerTitle: 'Создать аккаунт',
      toLogin: 'Уже есть аккаунт? Войти',
      username: 'Имя пользователя'
    },
    common: { close: 'Закрыть', loading: 'Загрузка', logout: 'Выйти', none: 'Нет', ok: 'Понятно', refresh: 'Обновить' },
    nav: { account: 'Аккаунт', aiRecharge: 'Пополнение AI', experience: 'Проба моделей', home: 'Главная', log: 'Журналы', notificationSettings: 'Уведомления', pricing: 'Модели', profile: 'Профиль', recharge: 'Пополнить', token: 'Токены' }
  },
  'ar-EG': {
    auth: {
      loginFailed: 'فشل تسجيل الدخول',
      loginSubmit: 'تسجيل الدخول',
      loginSubmitting: 'جار تسجيل الدخول',
      loginTitle: 'سجل الدخول إلى حسابك',
      password: 'كلمة المرور',
      registerFailed: 'فشل التسجيل',
      registerLink: 'إنشاء حساب جديد',
      registerSubmit: 'إنشاء حساب',
      registerSubmitting: 'جار الإنشاء',
      registerTitle: 'إنشاء حساب',
      toLogin: 'لديك حساب؟ سجل الدخول',
      username: 'اسم المستخدم'
    },
    common: { close: 'إغلاق', loading: 'جار التحميل', logout: 'تسجيل الخروج', none: 'لا يوجد', ok: 'حسنا', refresh: 'تحديث' },
    nav: { account: 'الحساب', aiRecharge: 'شحن AI', experience: 'تجربة النماذج', home: 'الرئيسية', log: 'السجلات', notificationSettings: 'الإشعارات', pricing: 'النماذج', profile: 'الملف الشخصي', recharge: 'الشحن', token: 'الرموز' }
  },
  'sw-KE': makeCoreOverride('Ingia', 'Unda akaunti', 'Nenosiri', 'Jina la mtumiaji', 'Funga', 'Inapakia', 'Toka', 'Hakuna', 'Sawa', 'Sasisha', 'Nyumbani', 'Miundo', 'Jaribu miundo', 'Tokeni', 'Kumbukumbu', 'Akaunti', 'Wasifu', 'Jaza salio', 'Arifa', 'AI recharge'),
  'am-ET': makeCoreOverride('ግባ', 'መለያ ፍጠር', 'የይለፍ ቃል', 'የተጠቃሚ ስም', 'ዝጋ', 'በመጫን ላይ', 'ውጣ', 'የለም', 'እሺ', 'አድስ', 'መነሻ', 'ሞዴሎች', 'ሞዴሎችን ሞክር', 'ቶከኖች', 'መዝገቦች', 'መለያ', 'መገለጫ', 'ቀሪ ሂሳብ ሙላ', 'ማሳወቂያዎች', 'AI መሙያ'),
  'ha-NG': makeCoreOverride('Shiga', 'Kirkiri asusu', 'Kalmar sirri', 'Sunan mai amfani', 'Rufe', 'Ana lodawa', 'Fita', 'Babu', 'Na gane', 'Sabunta', 'Gida', 'Samfura', 'Gwada samfura', 'Token', 'Rajista', 'Asusu', 'Bayanan martaba', 'Cika kudi', 'Sanarwa', 'Cajin AI'),
  'yo-NG': makeCoreOverride('Wọle', 'Ṣẹda akanti', 'Ọrọigbaniwọle', 'Orukọ olumulo', 'Pa', 'N ṣajọpọ', 'Jade', 'Ko si', 'Ó ye mi', 'Tunṣe', 'Ile', 'Àwọn awoṣe', 'Dán awoṣe wò', 'Token', 'Àkọọlẹ', 'Akanti', 'Profaili', 'Fi owó kun', 'Ìfitónilétí', 'Ìsanwó AI'),
  'ig-NG': makeCoreOverride('Banye', 'Mepụta akaụntụ', 'Okwuntughe', 'Aha njirimara', 'Mechie', 'Na-ebunye', 'Pụọ', 'Ọ dịghị', 'Aghọtaram', 'Melite', 'Ụlọ', 'Ụdị', 'Nwalee ụdị', 'Token', 'Ndekọ', 'Akaụntụ', 'Profaịlụ', 'Tinye ego', 'Ọkwa', 'Nkwụnye AI'),
  'zu-ZA': makeCoreOverride('Ngena', 'Dala i-akhawunti', 'Iphasiwedi', 'Igama lomsebenzisi', 'Vala', 'Iyalayisha', 'Phuma', 'Akukho', 'Kulungile', 'Vuselela', 'Ikhaya', 'Amamodeli', 'Zama amamodeli', 'Amathokheni', 'Amalogi', 'I-akhawunti', 'Iphrofayela', 'Faka imali', 'Izaziso', 'Ukushaja AI'),
  'af-ZA': makeCoreOverride('Meld aan', 'Skep rekening', 'Wagwoord', 'Gebruikersnaam', 'Sluit', 'Laai', 'Meld af', 'Geen', 'Verstaan', 'Verfris', 'Tuis', 'Modelle', 'Toets modelle', 'Tokens', 'Logs', 'Rekening', 'Profiel', 'Herlaai', 'Kennisgewings', 'AI herlaai'),
  'so-SO': makeCoreOverride('Gal', 'Samee akoon', 'Furaha sirta', 'Magaca isticmaalaha', 'Xir', 'Waa la rarayaa', 'Ka bax', 'Ma jiro', 'Waan fahmay', 'Cusboonaysii', 'Bogga hore', 'Moodallo', 'Tijaabi moodallo', 'Tokenno', 'Diiwaanno', 'Akoon', 'Profile', 'Ku shub', 'Ogeysiisyo', 'AI ku shub'),
  'rw-RW': makeCoreOverride('Injira', 'Fungura konti', 'Ijambobanga', 'Izina ryukoresha', 'Funga', 'Birimo kwinjira', 'Sohoka', 'Nta na kimwe', 'Ndabyumvise', 'Kongera', 'Ahabanza', 'Models', 'Gerageza models', 'Tokens', 'Logs', 'Konti', 'Profile', 'Ongeramo amafaranga', 'Amatangazo', 'AI recharge'),
  'om-ET': makeCoreOverride('Seeni', 'Herrega uumi', 'Jecha icciitii', 'Maqaa fayyadamaa', 'Cufi', 'Fe’amaa jira', 'Ba’i', 'Hin jiru', 'Hubadheera', 'Haaromsi', 'Fuula duraa', 'Moodeelota', 'Moodeelota yaali', 'Tokenota', 'Galmeewwan', 'Herrega', 'Profaayila', 'Maallaqa guuti', 'Beeksisa', 'AI guuti'),
  'hi-IN': makeCoreOverride('लॉग इन', 'खाता बनाएं', 'पासवर्ड', 'उपयोगकर्ता नाम', 'बंद करें', 'लोड हो रहा है', 'लॉग आउट', 'कुछ नहीं', 'समझ गया', 'रीफ्रेश', 'होम', 'मॉडल', 'मॉडल आज़माएं', 'टोकन', 'लॉग', 'खाता', 'प्रोफ़ाइल', 'टॉप अप', 'सूचनाएं', 'AI रिचार्ज'),
  'id-ID': makeCoreOverride('Masuk', 'Buat akun', 'Kata sandi', 'Nama pengguna', 'Tutup', 'Memuat', 'Keluar', 'Tidak ada', 'Mengerti', 'Muat ulang', 'Beranda', 'Model', 'Coba model', 'Token', 'Log', 'Akun', 'Profil', 'Isi saldo', 'Notifikasi', 'Isi ulang AI'),
  'tr-TR': makeCoreOverride('Giriş yap', 'Hesap oluştur', 'Şifre', 'Kullanıcı adı', 'Kapat', 'Yükleniyor', 'Çıkış yap', 'Yok', 'Anladım', 'Yenile', 'Ana sayfa', 'Modeller', 'Modelleri dene', 'Tokenlar', 'Kayıtlar', 'Hesap', 'Profil', 'Bakiye yükle', 'Bildirimler', 'AI yükleme'),
  'vi-VN': makeCoreOverride('Đăng nhập', 'Tạo tài khoản', 'Mật khẩu', 'Tên người dùng', 'Đóng', 'Đang tải', 'Đăng xuất', 'Không có', 'Đã hiểu', 'Làm mới', 'Trang chủ', 'Mô hình', 'Thử mô hình', 'Token', 'Nhật ký', 'Tài khoản', 'Hồ sơ', 'Nạp tiền', 'Thông báo', 'Nạp AI'),
  'th-TH': makeCoreOverride('เข้าสู่ระบบ', 'สร้างบัญชี', 'รหัสผ่าน', 'ชื่อผู้ใช้', 'ปิด', 'กำลังโหลด', 'ออกจากระบบ', 'ไม่มี', 'เข้าใจแล้ว', 'รีเฟรช', 'หน้าแรก', 'โมเดล', 'ลองโมเดล', 'โทเคน', 'บันทึก', 'บัญชี', 'โปรไฟล์', 'เติมเงิน', 'การแจ้งเตือน', 'เติม AI'),
  'it-IT': makeCoreOverride('Accedi', 'Crea account', 'Password', 'Nome utente', 'Chiudi', 'Caricamento', 'Esci', 'Nessuno', 'Capito', 'Aggiorna', 'Home', 'Modelli', 'Prova modelli', 'Token', 'Log', 'Account', 'Profilo', 'Ricarica', 'Notifiche', 'Ricarica IA'),
  'nl-NL': makeCoreOverride('Inloggen', 'Account maken', 'Wachtwoord', 'Gebruikersnaam', 'Sluiten', 'Laden', 'Uitloggen', 'Geen', 'Begrepen', 'Vernieuwen', 'Home', 'Modellen', 'Modellen testen', 'Tokens', 'Logs', 'Account', 'Profiel', 'Opwaarderen', 'Meldingen', 'AI opwaarderen'),
  'pl-PL': makeCoreOverride('Zaloguj', 'Utwórz konto', 'Hasło', 'Nazwa użytkownika', 'Zamknij', 'Ładowanie', 'Wyloguj', 'Brak', 'Rozumiem', 'Odśwież', 'Start', 'Modele', 'Testuj modele', 'Tokeny', 'Logi', 'Konto', 'Profil', 'Doładuj', 'Powiadomienia', 'Doładowanie AI'),
  'uk-UA': makeCoreOverride('Увійти', 'Створити акаунт', 'Пароль', 'Ім’я користувача', 'Закрити', 'Завантаження', 'Вийти', 'Немає', 'Зрозуміло', 'Оновити', 'Головна', 'Моделі', 'Спробувати моделі', 'Токени', 'Журнали', 'Акаунт', 'Профіль', 'Поповнити', 'Сповіщення', 'Поповнення AI'),
  'ms-MY': makeCoreOverride('Log masuk', 'Cipta akaun', 'Kata laluan', 'Nama pengguna', 'Tutup', 'Memuatkan', 'Log keluar', 'Tiada', 'Faham', 'Muat semula', 'Laman utama', 'Model', 'Cuba model', 'Token', 'Log', 'Akaun', 'Profil', 'Tambah nilai', 'Pemberitahuan', 'Tambah nilai AI'),
  'fa-IR': {
    auth: {
      loginFailed: 'ورود ناموفق بود',
      loginSubmit: 'ورود',
      loginSubmitting: 'در حال ورود',
      loginTitle: 'وارد حساب خود شوید',
      password: 'رمز عبور',
      registerFailed: 'ثبت‌نام ناموفق بود',
      registerLink: 'ایجاد حساب جدید',
      registerSubmit: 'ایجاد حساب',
      registerSubmitting: 'در حال ایجاد',
      registerTitle: 'ایجاد حساب',
      toLogin: 'حساب دارید؟ وارد شوید',
      username: 'نام کاربری'
    },
    common: { close: 'بستن', loading: 'در حال بارگیری', logout: 'خروج', none: 'هیچ', ok: 'متوجه شدم', refresh: 'تازه‌سازی' },
    nav: { account: 'حساب', aiRecharge: 'شارژ AI', experience: 'آزمایش مدل‌ها', home: 'خانه', log: 'گزارش‌ها', notificationSettings: 'اعلان‌ها', pricing: 'مدل‌ها', profile: 'نمایه', recharge: 'شارژ', token: 'توکن‌ها' }
  }
};

const packs = {
  'zh-CN': mergePack(englishPack, {
    app: {
      description: '蔚蓝星球 AI API 中转服务',
      merchantConsoleName: '蔚蓝星球商家端',
      name: '蔚蓝星球中转站',
      userConsoleName: '蔚蓝星球中转站'
    },
    auth: {
      loginFailed: '登录失败',
      loginSubmit: '登录',
      loginSubmitting: '登录中',
      loginTitle: '登录账户',
      password: '密码',
      registerFailed: '注册失败',
      registerLink: '创建新账户',
      registerSubmit: '创建账户',
      registerSubmitting: '创建中',
      registerTitle: '创建账户',
      toLogin: '已有账户？去登录',
      username: '用户名'
    },
    common: { close: '关闭', loading: '加载中', logout: '退出', none: '暂无', ok: '我知道了', refresh: '刷新' },
    home: {
      announcement: '公告',
      closeAnnouncement: '关闭公告',
      contentCount: '已发布内容',
      contentUnit: '条',
      defaultSubtitle: '智能服务中转后台',
      documentEntrances: '文档入口',
      documentUnit: '个',
      emptyPublished: '暂无已发布内容',
      entry: {
        aiRecharge: 'AI代充',
        experience: '体验',
        log: '日志',
        notificationSettings: '通知设置',
        pricing: '模型广场',
        token: '令牌'
      },
      latestPublished: '最新发布',
      loadFailed: '首页内容加载失败',
      section: { announcement: '平台公告', updateLog: '更新日志', usageGuide: '使用建议' }
    },
    language: { label: '语言', title: '选择界面语言' },
    merchantNav: {
      aiRecharge: 'AI代充',
      announcements: '公告/首页',
      dashboard: '商家首页',
      modelConfig: '模型管理',
      primaryAria: '商家端主导航',
      rechargeCodes: '充值码',
      sidebarAria: '商家端导航',
      users: '用户统计'
    },
    nav: {
      account: '账户',
      accountAria: '账户导航',
      aiRecharge: 'AI代充',
      experience: '体验',
      home: '首页',
      log: '日志',
      notificationSettings: '通知设置',
      pricing: '模型广场',
      primaryAria: '主导航',
      profile: '个人中心',
      recharge: '余额充值',
      token: '令牌'
    },
    role: { admin: '管理员', user: '普通用户' }
  }),
  'zh-TW': mergePack(englishPack, {
    app: {
      description: '蔚藍星球 AI API 中轉服務',
      merchantConsoleName: '蔚藍星球商家端',
      name: '蔚藍星球中轉站',
      userConsoleName: '蔚藍星球中轉站'
    },
    auth: {
      loginFailed: '登入失敗',
      loginSubmit: '登入',
      loginSubmitting: '登入中',
      loginTitle: '登入帳戶',
      password: '密碼',
      registerFailed: '註冊失敗',
      registerLink: '建立新帳戶',
      registerSubmit: '建立帳戶',
      registerSubmitting: '建立中',
      registerTitle: '建立帳戶',
      toLogin: '已有帳戶？去登入',
      username: '使用者名稱'
    },
    common: { close: '關閉', loading: '載入中', logout: '登出', none: '暫無', ok: '我知道了', refresh: '重新整理' },
    home: {
      announcement: '公告',
      closeAnnouncement: '關閉公告',
      contentCount: '已發布內容',
      contentUnit: '則',
      defaultSubtitle: '智慧服務中轉後台',
      documentEntrances: '文件入口',
      documentUnit: '個',
      emptyPublished: '暫無已發布內容',
      entry: {
        aiRecharge: 'AI代充',
        experience: '體驗',
        log: '日誌',
        notificationSettings: '通知設定',
        pricing: '模型廣場',
        token: '權杖'
      },
      latestPublished: '最新發布',
      loadFailed: '首頁內容載入失敗',
      section: { announcement: '平台公告', updateLog: '更新日誌', usageGuide: '使用建議' }
    },
    language: { label: '語言', title: '選擇介面語言' },
    merchantNav: {
      aiRecharge: 'AI代充',
      announcements: '公告/首頁',
      dashboard: '商家首頁',
      modelConfig: '模型管理',
      primaryAria: '商家端主導覽',
      rechargeCodes: '儲值碼',
      sidebarAria: '商家端導覽',
      users: '使用者統計'
    },
    nav: {
      account: '帳戶',
      accountAria: '帳戶導覽',
      aiRecharge: 'AI代充',
      experience: '體驗',
      home: '首頁',
      log: '日誌',
      notificationSettings: '通知設定',
      pricing: '模型廣場',
      primaryAria: '主導覽',
      profile: '個人中心',
      recharge: '餘額儲值',
      token: '權杖'
    },
    role: { admin: '管理員', user: '一般使用者' }
  }),
  'en-US': englishPack,
  'es-ES': mergePack(englishPack, {
    auth: {
      loginFailed: 'No se pudo iniciar sesión',
      loginSubmit: 'Iniciar sesión',
      loginSubmitting: 'Iniciando sesión',
      loginTitle: 'Inicia sesión en tu cuenta',
      password: 'Contraseña',
      registerFailed: 'No se pudo registrar',
      registerLink: 'Crear cuenta nueva',
      registerSubmit: 'Crear cuenta',
      registerSubmitting: 'Creando cuenta',
      registerTitle: 'Crear una cuenta',
      toLogin: '¿Ya tienes cuenta? Inicia sesión',
      username: 'Nombre de usuario'
    },
    common: { close: 'Cerrar', loading: 'Cargando', logout: 'Salir', none: 'Ninguno', ok: 'Entendido', refresh: 'Actualizar' },
    home: {
      announcement: 'Anuncio',
      closeAnnouncement: 'Cerrar anuncio',
      contentCount: 'Contenido publicado',
      contentUnit: 'elementos',
      defaultSubtitle: 'Consola de relevo de servicios inteligentes',
      documentEntrances: 'Accesos a documentos',
      documentUnit: 'enlaces',
      emptyPublished: 'Sin publicaciones',
      entry: {
        aiRecharge: 'Recarga IA',
        experience: 'Probar modelos',
        log: 'Registros',
        notificationSettings: 'Notificaciones',
        pricing: 'Catálogo de modelos',
        token: 'Tokens'
      },
      latestPublished: 'Última publicación',
      loadFailed: 'No se pudo cargar el inicio',
      section: { announcement: 'Anuncios de la plataforma', updateLog: 'Registro de cambios', usageGuide: 'Consejos de uso' }
    },
    language: { label: 'Idioma', title: 'Elegir idioma de la interfaz' },
    merchantNav: {
      aiRecharge: 'Recarga IA',
      announcements: 'Anuncios/Inicio',
      dashboard: 'Panel',
      modelConfig: 'Modelos',
      primaryAria: 'Navegación principal comercial',
      rechargeCodes: 'Códigos de recarga',
      sidebarAria: 'Navegación comercial',
      users: 'Usuarios'
    },
    nav: {
      account: 'Cuenta',
      accountAria: 'Navegación de cuenta',
      aiRecharge: 'Recarga IA',
      experience: 'Probar modelos',
      home: 'Inicio',
      log: 'Registros',
      notificationSettings: 'Notificaciones',
      pricing: 'Modelos',
      primaryAria: 'Navegación principal',
      profile: 'Perfil',
      recharge: 'Recargar',
      token: 'Tokens'
    },
    role: { admin: 'Administrador', user: 'Usuario' }
  }),
  'fr-FR': makeCorePack('fr-FR', 'Langue', "Choisir la langue de l'interface"),
  'de-DE': makeCorePack('de-DE', 'Sprache', 'Oberflächensprache wählen'),
  'pt-BR': makeCorePack('pt-BR', 'Idioma', 'Escolher idioma da interface'),
  'ja-JP': makeCorePack('ja-JP', '言語', '表示言語を選択'),
  'ko-KR': makeCorePack('ko-KR', '언어', '인터페이스 언어 선택'),
  'ru-RU': makeCorePack('ru-RU', 'Язык', 'Выберите язык интерфейса'),
  'ar-EG': makeCorePack('ar-EG', 'اللغة', 'اختر لغة الواجهة'),
  'sw-KE': makeCorePack('sw-KE', 'Lugha', 'Chagua lugha ya kiolesura'),
  'am-ET': makeCorePack('am-ET', 'ቋንቋ', 'የበይነገጽ ቋንቋ ይምረጡ'),
  'ha-NG': makeCorePack('ha-NG', 'Harshe', 'Zaɓi harshen mu’amala'),
  'yo-NG': makeCorePack('yo-NG', 'Èdè', 'Yan ede oju-iwe'),
  'ig-NG': makeCorePack('ig-NG', 'Asụsụ', 'Họrọ asụsụ ihu'),
  'zu-ZA': makeCorePack('zu-ZA', 'Ulimi', 'Khetha ulimi lwesixhumi'),
  'af-ZA': makeCorePack('af-ZA', 'Taal', 'Kies koppelvlaktaal'),
  'so-SO': makeCorePack('so-SO', 'Luqad', 'Dooro luqadda is-dhexgalka'),
  'rw-RW': makeCorePack('rw-RW', 'Ururimi', 'Hitamo ururimi rw’imigaragarire'),
  'om-ET': makeCorePack('om-ET', 'Afaan', 'Afaan walqunnamtii filadhu'),
  'hi-IN': makeCorePack('hi-IN', 'भाषा', 'इंटरफ़ेस भाषा चुनें'),
  'id-ID': makeCorePack('id-ID', 'Bahasa', 'Pilih bahasa antarmuka'),
  'tr-TR': makeCorePack('tr-TR', 'Dil', 'Arayüz dilini seç'),
  'vi-VN': makeCorePack('vi-VN', 'Ngôn ngữ', 'Chọn ngôn ngữ giao diện'),
  'th-TH': makeCorePack('th-TH', 'ภาษา', 'เลือกภาษาของอินเทอร์เฟซ'),
  'it-IT': makeCorePack('it-IT', 'Lingua', "Scegli la lingua dell'interfaccia"),
  'nl-NL': makeCorePack('nl-NL', 'Taal', 'Kies interfacetaal'),
  'pl-PL': makeCorePack('pl-PL', 'Język', 'Wybierz język interfejsu'),
  'uk-UA': makeCorePack('uk-UA', 'Мова', 'Виберіть мову інтерфейсу'),
  'ms-MY': makeCorePack('ms-MY', 'Bahasa', 'Pilih bahasa antara muka'),
  'fa-IR': makeCorePack('fa-IR', 'زبان', 'زبان رابط را انتخاب کنید')
} satisfies Record<LanguageCode, LanguagePack>;

const translationGetters = {
  'app.name': (pack: LanguagePack) => pack.app.name,
  'app.description': (pack: LanguagePack) => pack.app.description,
  'app.documentTitle': (pack: LanguagePack) => pack.app.name,
  'app.userConsoleName': (pack: LanguagePack) => pack.app.userConsoleName,
  'app.merchantConsoleName': (pack: LanguagePack) => pack.app.merchantConsoleName,
  'common.close': (pack: LanguagePack) => pack.common.close,
  'common.loading': (pack: LanguagePack) => pack.common.loading,
  'common.logout': (pack: LanguagePack) => pack.common.logout,
  'common.none': (pack: LanguagePack) => pack.common.none,
  'common.ok': (pack: LanguagePack) => pack.common.ok,
  'common.refresh': (pack: LanguagePack) => pack.common.refresh,
  'language.label': (pack: LanguagePack) => pack.language.label,
  'language.title': (pack: LanguagePack) => pack.language.title,
  'nav.account': (pack: LanguagePack) => pack.nav.account,
  'nav.accountAria': (pack: LanguagePack) => pack.nav.accountAria,
  'nav.aiRecharge': (pack: LanguagePack) => pack.nav.aiRecharge,
  'nav.experience': (pack: LanguagePack) => pack.nav.experience,
  'nav.home': (pack: LanguagePack) => pack.nav.home,
  'nav.log': (pack: LanguagePack) => pack.nav.log,
  'nav.notificationSettings': (pack: LanguagePack) => pack.nav.notificationSettings,
  'nav.pricing': (pack: LanguagePack) => pack.nav.pricing,
  'nav.primaryAria': (pack: LanguagePack) => pack.nav.primaryAria,
  'nav.profile': (pack: LanguagePack) => pack.nav.profile,
  'nav.recharge': (pack: LanguagePack) => pack.nav.recharge,
  'nav.token': (pack: LanguagePack) => pack.nav.token,
  'merchant.nav.aiRecharge': (pack: LanguagePack) => pack.merchantNav.aiRecharge,
  'merchant.nav.announcements': (pack: LanguagePack) => pack.merchantNav.announcements,
  'merchant.nav.dashboard': (pack: LanguagePack) => pack.merchantNav.dashboard,
  'merchant.nav.modelConfig': (pack: LanguagePack) => pack.merchantNav.modelConfig,
  'merchant.nav.primaryAria': (pack: LanguagePack) => pack.merchantNav.primaryAria,
  'merchant.nav.rechargeCodes': (pack: LanguagePack) => pack.merchantNav.rechargeCodes,
  'merchant.nav.sidebarAria': (pack: LanguagePack) => pack.merchantNav.sidebarAria,
  'merchant.nav.users': (pack: LanguagePack) => pack.merchantNav.users,
  'role.admin': (pack: LanguagePack) => pack.role.admin,
  'role.user': (pack: LanguagePack) => pack.role.user,
  'auth.loginBrand': (pack: LanguagePack) => `${pack.app.name} ${pack.auth.loginSubmit}`,
  'auth.loginFailed': (pack: LanguagePack) => pack.auth.loginFailed,
  'auth.loginSubmit': (pack: LanguagePack) => pack.auth.loginSubmit,
  'auth.loginSubmitting': (pack: LanguagePack) => pack.auth.loginSubmitting,
  'auth.loginTitle': (pack: LanguagePack) => pack.auth.loginTitle,
  'auth.password': (pack: LanguagePack) => pack.auth.password,
  'auth.registerBrand': (pack: LanguagePack) => `${pack.app.name} ${pack.auth.registerTitle}`,
  'auth.registerFailed': (pack: LanguagePack) => pack.auth.registerFailed,
  'auth.registerLink': (pack: LanguagePack) => pack.auth.registerLink,
  'auth.registerSubmit': (pack: LanguagePack) => pack.auth.registerSubmit,
  'auth.registerSubmitting': (pack: LanguagePack) => pack.auth.registerSubmitting,
  'auth.registerTitle': (pack: LanguagePack) => pack.auth.registerTitle,
  'auth.toLogin': (pack: LanguagePack) => pack.auth.toLogin,
  'auth.username': (pack: LanguagePack) => pack.auth.username,
  'home.announcement': (pack: LanguagePack) => pack.home.announcement,
  'home.closeAnnouncement': (pack: LanguagePack) => pack.home.closeAnnouncement,
  'home.contentCount': (pack: LanguagePack) => pack.home.contentCount,
  'home.contentUnit': (pack: LanguagePack) => pack.home.contentUnit,
  'home.defaultSubtitle': (pack: LanguagePack) => pack.home.defaultSubtitle,
  'home.documentEntrances': (pack: LanguagePack) => pack.home.documentEntrances,
  'home.documentUnit': (pack: LanguagePack) => pack.home.documentUnit,
  'home.emptyPublished': (pack: LanguagePack) => pack.home.emptyPublished,
  'home.entry.aiRecharge': (pack: LanguagePack) => pack.home.entry.aiRecharge,
  'home.entry.experience': (pack: LanguagePack) => pack.home.entry.experience,
  'home.entry.log': (pack: LanguagePack) => pack.home.entry.log,
  'home.entry.notificationSettings': (pack: LanguagePack) => pack.home.entry.notificationSettings,
  'home.entry.pricing': (pack: LanguagePack) => pack.home.entry.pricing,
  'home.entry.token': (pack: LanguagePack) => pack.home.entry.token,
  'home.latestPublished': (pack: LanguagePack) => pack.home.latestPublished,
  'home.loadFailed': (pack: LanguagePack) => pack.home.loadFailed,
  'home.section.announcement': (pack: LanguagePack) => pack.home.section.announcement,
  'home.section.updateLog': (pack: LanguagePack) => pack.home.section.updateLog,
  'home.section.usageGuide': (pack: LanguagePack) => pack.home.section.usageGuide
} satisfies Record<string, (pack: LanguagePack) => string>;

export type TranslationKey = keyof typeof translationGetters;

const languageCodes = new Set<string>(supportedLanguages.map((language) => language.code));
const languageByNormalizedCode = new Map<Lowercase<LanguageCode>, LanguageCode>(
  supportedLanguages.map((language) => [language.code.toLowerCase() as Lowercase<LanguageCode>, language.code])
);

const languageByBaseCode: Record<string, LanguageCode> = {
  af: 'af-ZA',
  am: 'am-ET',
  ar: 'ar-EG',
  de: 'de-DE',
  en: 'en-US',
  es: 'es-ES',
  fa: 'fa-IR',
  fr: 'fr-FR',
  ha: 'ha-NG',
  hi: 'hi-IN',
  id: 'id-ID',
  ig: 'ig-NG',
  it: 'it-IT',
  ja: 'ja-JP',
  ko: 'ko-KR',
  ms: 'ms-MY',
  nl: 'nl-NL',
  om: 'om-ET',
  pl: 'pl-PL',
  pt: 'pt-BR',
  ru: 'ru-RU',
  rw: 'rw-RW',
  so: 'so-SO',
  sw: 'sw-KE',
  th: 'th-TH',
  tr: 'tr-TR',
  uk: 'uk-UA',
  vi: 'vi-VN',
  yo: 'yo-NG',
  zh: 'zh-CN',
  zu: 'zu-ZA'
};

const languageByAfricanRegion: Record<string, LanguageCode> = {
  AO: 'pt-BR',
  BF: 'fr-FR',
  BI: 'fr-FR',
  BJ: 'fr-FR',
  BW: 'en-US',
  CD: 'fr-FR',
  CF: 'fr-FR',
  CG: 'fr-FR',
  CI: 'fr-FR',
  CM: 'fr-FR',
  CV: 'pt-BR',
  DJ: 'so-SO',
  DZ: 'ar-EG',
  EG: 'ar-EG',
  ER: 'am-ET',
  ET: 'am-ET',
  GA: 'fr-FR',
  GH: 'en-US',
  GM: 'en-US',
  GN: 'fr-FR',
  GW: 'pt-BR',
  KE: 'sw-KE',
  KM: 'fr-FR',
  LR: 'en-US',
  LS: 'en-US',
  LY: 'ar-EG',
  MA: 'ar-EG',
  MG: 'fr-FR',
  ML: 'fr-FR',
  MR: 'ar-EG',
  MU: 'en-US',
  MW: 'en-US',
  MZ: 'pt-BR',
  NA: 'en-US',
  NE: 'fr-FR',
  NG: 'ha-NG',
  RW: 'rw-RW',
  SC: 'en-US',
  SD: 'ar-EG',
  SL: 'en-US',
  SN: 'fr-FR',
  SO: 'so-SO',
  SS: 'en-US',
  ST: 'pt-BR',
  TD: 'fr-FR',
  TG: 'fr-FR',
  TN: 'ar-EG',
  TZ: 'sw-KE',
  UG: 'sw-KE',
  ZA: 'zu-ZA',
  ZM: 'en-US',
  ZW: 'en-US'
};

const languageByTimeZone: Record<string, LanguageCode> = {
  'Africa/Abidjan': 'fr-FR',
  'Africa/Accra': 'en-US',
  'Africa/Addis_Ababa': 'am-ET',
  'Africa/Algiers': 'ar-EG',
  'Africa/Asmara': 'am-ET',
  'Africa/Cairo': 'ar-EG',
  'Africa/Casablanca': 'ar-EG',
  'Africa/Ceuta': 'es-ES',
  'Africa/Johannesburg': 'zu-ZA',
  'Africa/Kigali': 'rw-RW',
  'Africa/Lagos': 'ha-NG',
  'Africa/Mogadishu': 'so-SO',
  'Africa/Nairobi': 'sw-KE',
  'America/New_York': 'en-US',
  'America/Sao_Paulo': 'pt-BR',
  'Asia/Baghdad': 'ar-EG',
  'Asia/Bangkok': 'th-TH',
  'Asia/Ho_Chi_Minh': 'vi-VN',
  'Asia/Jakarta': 'id-ID',
  'Asia/Kolkata': 'hi-IN',
  'Asia/Seoul': 'ko-KR',
  'Asia/Shanghai': 'zh-CN',
  'Asia/Taipei': 'zh-TW',
  'Asia/Tehran': 'fa-IR',
  'Asia/Tokyo': 'ja-JP',
  'Asia/Kuala_Lumpur': 'ms-MY',
  'Europe/Amsterdam': 'nl-NL',
  'Europe/Berlin': 'de-DE',
  'Europe/Istanbul': 'tr-TR',
  'Europe/Kiev': 'uk-UA',
  'Europe/Lisbon': 'pt-BR',
  'Europe/London': 'en-US',
  'Europe/Madrid': 'es-ES',
  'Europe/Moscow': 'ru-RU',
  'Europe/Paris': 'fr-FR',
  'Europe/Rome': 'it-IT',
  'Europe/Warsaw': 'pl-PL'
};

export function isLanguageCode(value: string | null | undefined): value is LanguageCode {
  return Boolean(value && languageCodes.has(value));
}

export function detectPreferredLanguage(languageCandidates: readonly string[], timeZone?: string | null): LanguageCode {
  const timeZoneLanguage = timeZone ? languageByTimeZone[timeZone] : undefined;
  const languageMatch = getLanguageFromCandidates(languageCandidates, timeZoneLanguage);

  return languageMatch ?? timeZoneLanguage ?? defaultLanguage;
}

export function translate(language: LanguageCode, key: TranslationKey) {
  return translationGetters[key](packs[language] ?? packs[defaultLanguage]);
}

export function getLanguageDirection(language: LanguageCode): LanguageDirection {
  const entry = supportedLanguages.find((nextEntry) => nextEntry.code === language);
  return entry && 'direction' in entry ? entry.direction : 'ltr';
}

export function getLanguageLabel(language: LanguageCode) {
  return supportedLanguages.find((entry) => entry.code === language)?.label ?? language;
}

function makeCoreOverride(
  loginSubmit: string,
  registerSubmit: string,
  password: string,
  username: string,
  close: string,
  loading: string,
  logout: string,
  none: string,
  ok: string,
  refresh: string,
  home: string,
  pricing: string,
  experience: string,
  token: string,
  log: string,
  account: string,
  profile: string,
  recharge: string,
  notificationSettings: string,
  aiRecharge: string
): PartialLanguagePack {
  return {
    auth: {
      loginFailed: loginSubmit,
      loginSubmit,
      loginSubmitting: loading,
      loginTitle: loginSubmit,
      password,
      registerFailed: registerSubmit,
      registerLink: registerSubmit,
      registerSubmit,
      registerSubmitting: loading,
      registerTitle: registerSubmit,
      toLogin: loginSubmit,
      username
    },
    common: { close, loading, logout, none, ok, refresh },
    nav: {
      account,
      aiRecharge,
      experience,
      home,
      log,
      notificationSettings,
      pricing,
      profile,
      recharge,
      token
    }
  };
}

function makeCorePack(language: LanguageCode, label: string, title: string): LanguagePack {
  const override = localizedCoreOverrides[language] ?? {};
  const pack = mergePack(englishPack, {
    ...override,
    language: { label, title }
  });

  return mergePack(pack, {
    home: {
      entry: {
        aiRecharge: pack.nav.aiRecharge,
        experience: pack.nav.experience,
        log: pack.nav.log,
        notificationSettings: pack.nav.notificationSettings,
        pricing: pack.nav.pricing,
        token: pack.nav.token
      }
    }
  });
}

function getLanguageFromCandidates(languageCandidates: readonly string[], timeZoneLanguage?: LanguageCode) {
  for (const candidate of languageCandidates) {
    const parsed = parseLocale(candidate);
    if (!parsed) {
      continue;
    }

    if (timeZoneLanguage && parsed.base === 'en' && timeZoneLanguage !== 'en-US') {
      return timeZoneLanguage;
    }

    const exactMatch = languageByNormalizedCode.get(parsed.normalized as Lowercase<LanguageCode>);
    if (exactMatch) {
      return exactMatch;
    }

    if (parsed.base === 'zh') {
      return parsed.script === 'hant' || ['HK', 'MO', 'TW'].includes(parsed.region ?? '') ? 'zh-TW' : 'zh-CN';
    }

    const baseLanguage = languageByBaseCode[parsed.base];
    if (baseLanguage && parsed.base !== 'en') {
      return baseLanguage;
    }

    if (parsed.region && languageByAfricanRegion[parsed.region]) {
      return languageByAfricanRegion[parsed.region];
    }

    if (baseLanguage) {
      return baseLanguage;
    }
  }

  return undefined;
}

function parseLocale(value: string | null | undefined) {
  const normalized = value?.trim().replace(/_/g, '-').toLowerCase();
  if (!normalized) {
    return null;
  }

  const parts = normalized.split('-').filter(Boolean);
  return {
    base: parts[0] ?? '',
    normalized,
    region: parts.find((part) => part.length === 2)?.toUpperCase(),
    script: parts.find((part) => part.length === 4)
  };
}

function mergePack(base: LanguagePack, override: PartialLanguagePack): LanguagePack {
  return {
    app: { ...base.app, ...override.app },
    auth: { ...base.auth, ...override.auth },
    common: { ...base.common, ...override.common },
    home: {
      ...base.home,
      ...override.home,
      entry: { ...base.home.entry, ...override.home?.entry },
      section: { ...base.home.section, ...override.home?.section }
    },
    language: { ...base.language, ...override.language },
    merchantNav: { ...base.merchantNav, ...override.merchantNav },
    nav: { ...base.nav, ...override.nav },
    role: { ...base.role, ...override.role }
  };
}
