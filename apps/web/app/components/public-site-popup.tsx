'use client';

import { useState } from 'react';

type PublicSitePopupProps = {
  accentColor: string;
  closeLabel: string;
  content: string;
  fontFamily: string;
  textColor: string;
  title: string;
};

export function PublicSitePopup({
  accentColor,
  closeLabel,
  content,
  fontFamily,
  textColor,
  title
}: PublicSitePopupProps) {
  const [isOpen, setIsOpen] = useState(Boolean(title && content));

  if (!isOpen) {
    return null;
  }

  return (
    <div className="site-announcement-backdrop" data-qa="public-site-popup" role="presentation">
      <section
        aria-labelledby="public-site-popup-title"
        aria-modal="true"
        className="site-announcement-modal"
        role="dialog"
        style={{
          borderColor: accentColor,
          color: textColor,
          fontFamily: toCssFontFamily(fontFamily)
        }}
      >
        <button
          aria-label={closeLabel}
          className="site-announcement-close"
          onClick={() => setIsOpen(false)}
          type="button"
        >
          x
        </button>
        <h2 id="public-site-popup-title" style={{ color: accentColor }}>
          {title}
        </h2>
        <p>{content}</p>
        <button className="primary-button" onClick={() => setIsOpen(false)} type="button">
          {closeLabel}
        </button>
      </section>
    </div>
  );
}

function toCssFontFamily(fontFamily: string) {
  if (fontFamily === 'serif') {
    return 'Georgia, "Times New Roman", serif';
  }
  if (fontFamily === 'rounded') {
    return '"Trebuchet MS", "Segoe UI", sans-serif';
  }
  if (fontFamily === 'mono') {
    return '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
  }
  return 'inherit';
}
