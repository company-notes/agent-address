import { useEffect, useSyncExternalStore } from 'react';

export type LanguageCode = 'zh-Hant' | 'zh-Hans' | 'en';

type LanguageService = {
  current(): LanguageCode;
  t(english: string): string;
  subscribe(listener: () => void): () => void;
  change(language: LanguageCode): void;
};

declare global {
  interface Window {
    NuwaLanguage: LanguageService;
  }
}

/** The public OAuth page and Portal share one language implementation and catalog. */
export function usePortalLanguage() {
  const service = window.NuwaLanguage;
  const locale = useSyncExternalStore(
    (listener) => service.subscribe(listener),
    () => service.current(),
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return {
    locale,
    t: (english: string): string => service.t(english),
    setLanguage: (language: LanguageCode): void => service.change(language),
  };
}

export function PortalLanguagePicker() {
  const { locale, setLanguage } = usePortalLanguage();

  return (
    <div className="portal-language">
      <label htmlFor="portal-language">語言 / Language</label>
      <select
        id="portal-language"
        aria-label="Language"
        value={locale}
        onChange={(event) => setLanguage(event.target.value as LanguageCode)}
      >
        <option value="zh-Hant">繁體中文</option>
        <option value="zh-Hans">简体中文</option>
        <option value="en">English</option>
      </select>
    </div>
  );
}
