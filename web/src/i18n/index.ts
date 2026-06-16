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
    interpolation: { escapeValue: false }
});

export default i18n;
