import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n/index.ts';

const LANG_LABELS: Record<string, string> = {
    en: '🇬🇧 English',
    'en-US': '🇺🇸 English (US)',
    ja: '🇯🇵 日本語',
    zh: '🇨🇳 中文',
    'zh-TW': '🇹🇼 中文 (繁)',
    'zh-HK': '🇭🇰 中文 (港)',
    ko: '🇰🇷 한국어',
    fr: '🇫🇷 Français',
    es: '🇪🇸 Español',
    de: '🇩🇪 Deutsch',
    pt: '🇵🇹 Português',
    it: '🇮🇹 Italiano',
    ru: '🇷🇺 Русский',
    hi: '🇮🇳 हिन्दी',
    ar: '🇸🇦 العربية',
    tl: '🇵🇭 Tagalog',
    id: '🇮🇩 Indonesia',
    ms: '🇲🇾 Melayu',
    vi: '🇻🇳 Tiếng Việt',
    tr: '🇹🇷 Türkçe'
};

export default function LanguageSelect() {
    const { t, i18n } = useTranslation();
    return (
        <select
            className="rounded-md border border-navhover bg-bg px-2 py-1.5 text-sm text-white"
            aria-label={t('common_language')}
            value={i18n.resolvedLanguage}
            onChange={(e) => {
                void i18n.changeLanguage(e.target.value);
                localStorage.setItem('lang', e.target.value);
            }}
        >
            {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                    {LANG_LABELS[l] || l}
                </option>
            ))}
        </select>
    );
}
