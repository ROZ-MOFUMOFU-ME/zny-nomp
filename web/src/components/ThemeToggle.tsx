import { useTranslation } from 'react-i18next';
import { useTheme } from '../lib/theme.ts';

// Header button that flips light <-> dark and persists the choice.
export default function ThemeToggle() {
    const { t } = useTranslation();
    const [theme, setTheme] = useTheme();
    const dark = theme === 'dark';
    const label = t('theme_toggle', 'Toggle light/dark theme');
    return (
        <button
            type="button"
            onClick={() => setTheme(dark ? 'light' : 'dark')}
            title={label}
            aria-label={label}
            className="inline-flex shrink-0 items-center justify-center rounded-md px-3 py-2 text-nav hover:bg-navhover hover:text-white"
        >
            <i className={`fas fa-fw ${dark ? 'fa-sun' : 'fa-moon'}`} />
        </button>
    );
}
