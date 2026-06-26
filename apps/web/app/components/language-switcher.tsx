'use client';

import { CheckOutlined, DownOutlined, GlobalOutlined } from '@ant-design/icons';
import { useMemo, useRef } from 'react';
import { supportedLanguages, type LanguageCode } from '../lib/i18n';
import { useI18n } from './language-provider';

export function LanguageSwitcher({ variant = 'shell' }: { variant?: 'shell' | 'auth' }) {
  const { language, setLanguage, t } = useI18n();
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const currentLanguage = useMemo(
    () => supportedLanguages.find((entry) => entry.code === language) ?? supportedLanguages[0],
    [language]
  );

  function handleSelect(nextLanguage: LanguageCode) {
    setLanguage(nextLanguage);
    menuRef.current?.removeAttribute('open');
  }

  return (
    <details className={`language-switcher language-switcher-${variant}`} ref={menuRef}>
      <summary aria-label={t('language.title')} title={t('language.title')}>
        <GlobalOutlined />
        <span className="language-switcher-label">{t('language.label')}</span>
        <strong>{currentLanguage.label}</strong>
        <DownOutlined className="language-switcher-caret" />
      </summary>
      <div className="language-switcher-menu" role="listbox">
        {supportedLanguages.map((entry) => {
          const active = entry.code === language;

          return (
            <button
              aria-selected={active}
              className={active ? 'active' : ''}
              key={entry.code}
              onClick={() => handleSelect(entry.code)}
              role="option"
              type="button"
            >
              <span>{entry.shortLabel}</span>
              <strong>{entry.label}</strong>
              {active ? <CheckOutlined aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </details>
  );
}
