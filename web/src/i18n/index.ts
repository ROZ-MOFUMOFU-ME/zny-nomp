import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import translations from './translations.json';

type Dict = Record<string, string>;

const resources: Record<string, { translation: Dict }> = {};
for (const [lang, dict] of Object.entries(
    translations as Record<string, Dict>
)) {
    resources[lang] = { translation: dict };
}

export const SUPPORTED_LANGUAGES = Object.keys(resources);

const stored =
    typeof localStorage !== 'undefined' ? localStorage.getItem('lang') : null;

void i18n.use(initReactI18next).init({
    resources,
    lng: stored || navigator.language || 'en',
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    // Treat a region code (en-GB, zh-CN, pt-BR, …) as supported when only its base
    // language is in resources, so it resolves to the base (en, zh, pt) rather than
    // jumping straight to fallbackLng.
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false }
});

// Keep <html lang> synced to the active language. Chrome decides whether to offer
// auto-translation from the document language, so a stale lang="en" on a non-English page
// makes it pop the translate prompt. index.html sets an early value before first paint;
// this keeps it correct after boot and on every language switch.
const applyHtmlLang = function () {
    if (typeof document !== 'undefined')
        document.documentElement.lang =
            i18n.resolvedLanguage || i18n.language || 'en';
};
i18n.on('languageChanged', applyHtmlLang);
applyHtmlLang();

export default i18n;
