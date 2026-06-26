'use client';

import { ConfigProvider } from 'antd';
import arEG from 'antd/locale/ar_EG';
import deDE from 'antd/locale/de_DE';
import enUS from 'antd/locale/en_US';
import esES from 'antd/locale/es_ES';
import faIR from 'antd/locale/fa_IR';
import frFR from 'antd/locale/fr_FR';
import hiIN from 'antd/locale/hi_IN';
import idID from 'antd/locale/id_ID';
import itIT from 'antd/locale/it_IT';
import jaJP from 'antd/locale/ja_JP';
import koKR from 'antd/locale/ko_KR';
import msMY from 'antd/locale/ms_MY';
import nlNL from 'antd/locale/nl_NL';
import plPL from 'antd/locale/pl_PL';
import ptBR from 'antd/locale/pt_BR';
import ruRU from 'antd/locale/ru_RU';
import thTH from 'antd/locale/th_TH';
import trTR from 'antd/locale/tr_TR';
import ukUA from 'antd/locale/uk_UA';
import viVN from 'antd/locale/vi_VN';
import zhCN from 'antd/locale/zh_CN';
import zhTW from 'antd/locale/zh_TW';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import {
  defaultLanguage,
  detectPreferredLanguage,
  getLanguageDirection,
  isLanguageCode,
  languageStorageKey,
  translate,
  type LanguageCode,
  type TranslationKey
} from '../lib/i18n';

type I18nContextValue = {
  language: LanguageCode;
  setLanguage: (language: LanguageCode) => void;
  t: (key: TranslationKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const antdLocales = {
  'af-ZA': enUS,
  'am-ET': enUS,
  'ar-EG': arEG,
  'de-DE': deDE,
  'en-US': enUS,
  'es-ES': esES,
  'fa-IR': faIR,
  'fr-FR': frFR,
  'ha-NG': enUS,
  'hi-IN': hiIN,
  'ig-NG': enUS,
  'id-ID': idID,
  'it-IT': itIT,
  'ja-JP': jaJP,
  'ko-KR': koKR,
  'ms-MY': msMY,
  'nl-NL': nlNL,
  'om-ET': enUS,
  'pl-PL': plPL,
  'pt-BR': ptBR,
  'ru-RU': ruRU,
  'rw-RW': enUS,
  'so-SO': enUS,
  'sw-KE': enUS,
  'th-TH': thTH,
  'tr-TR': trTR,
  'uk-UA': ukUA,
  'vi-VN': viVN,
  'yo-NG': enUS,
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'zu-ZA': enUS
} satisfies Record<LanguageCode, typeof zhCN>;

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguageCode>(defaultLanguage);

  useEffect(() => {
    const requestedLanguage = getRequestedLanguageFromUrl();
    if (requestedLanguage) {
      setLanguageState(requestedLanguage);
      persistLanguage(requestedLanguage);
      return;
    }

    try {
      const storedLanguage = window.localStorage.getItem(languageStorageKey);
      if (isLanguageCode(storedLanguage)) {
        setLanguageState(storedLanguage);
        return;
      } else if (storedLanguage) {
        window.localStorage.removeItem(languageStorageKey);
      }
    } catch {
      // Continue with browser detection when storage is unavailable.
    }

    const languageCandidates =
      window.navigator.languages?.length ? window.navigator.languages : [window.navigator.language].filter(Boolean);
    let timeZone: string | undefined;

    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      timeZone = undefined;
    }

    setLanguageState(detectPreferredLanguage(languageCandidates, timeZone));
  }, []);

  useEffect(() => {
    const syncRequestedLanguage = () => {
      const requestedLanguage = getRequestedLanguageFromUrl();
      if (!requestedLanguage) {
        return;
      }

      setLanguageState((currentLanguage) => {
        if (currentLanguage === requestedLanguage) {
          return currentLanguage;
        }
        persistLanguage(requestedLanguage);
        return requestedLanguage;
      });
    };

    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    const notifyUrlChange = () => window.dispatchEvent(new Event('relay-language-url-change'));
    let currentHref = window.location.href;
    const syncWhenHrefChanges = () => {
      if (window.location.href === currentHref) {
        return;
      }
      currentHref = window.location.href;
      syncRequestedLanguage();
    };

    window.history.pushState = function pushStateWithLanguageSync(...args) {
      const result = originalPushState.apply(this, args);
      notifyUrlChange();
      return result;
    };
    window.history.replaceState = function replaceStateWithLanguageSync(...args) {
      const result = originalReplaceState.apply(this, args);
      notifyUrlChange();
      return result;
    };

    syncRequestedLanguage();
    const urlSyncInterval = window.setInterval(syncWhenHrefChanges, 250);
    window.addEventListener('popstate', syncRequestedLanguage);
    window.addEventListener('pageshow', syncRequestedLanguage);
    window.addEventListener('focus', syncWhenHrefChanges);
    window.addEventListener('relay-language-url-change', syncRequestedLanguage);

    return () => {
      window.clearInterval(urlSyncInterval);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      window.removeEventListener('popstate', syncRequestedLanguage);
      window.removeEventListener('pageshow', syncRequestedLanguage);
      window.removeEventListener('focus', syncWhenHrefChanges);
      window.removeEventListener('relay-language-url-change', syncRequestedLanguage);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = getLanguageDirection(language);
    document.title = translate(language, 'app.documentTitle');
  }, [language]);

  const setLanguage = useCallback((nextLanguage: LanguageCode) => {
    setLanguageState(nextLanguage);
    persistLanguage(nextLanguage);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key) => translate(language, key)
    }),
    [language, setLanguage]
  );

  return (
    <I18nContext.Provider value={value}>
      <ConfigProvider direction={getLanguageDirection(language)} locale={antdLocales[language]}>
        {children}
      </ConfigProvider>
    </I18nContext.Provider>
  );
}

function getRequestedLanguageFromUrl(): LanguageCode | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const searchParams = new URLSearchParams(window.location.search);
  const rawLanguage =
    searchParams.get('language') ?? searchParams.get('lang') ?? searchParams.get('locale');
  const normalizedLanguage = rawLanguage?.trim().replace(/_/g, '-');
  if (!normalizedLanguage) {
    return null;
  }
  if (isLanguageCode(normalizedLanguage)) {
    return normalizedLanguage;
  }

  const detectedLanguage = detectPreferredLanguage([normalizedLanguage]);
  if (detectedLanguage !== defaultLanguage || normalizedLanguage.toLowerCase().startsWith('zh')) {
    return detectedLanguage;
  }
  return null;
}

function persistLanguage(nextLanguage: LanguageCode) {
  try {
    window.localStorage.setItem(languageStorageKey, nextLanguage);
  } catch {
    // The UI should still switch for the current session if persistence fails.
  }
}

export function useI18n() {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error('useI18n must be used inside LanguageProvider');
  }

  return context;
}
