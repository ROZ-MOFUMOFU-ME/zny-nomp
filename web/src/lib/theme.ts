import { useEffect, useState } from 'react';

// Light/dark theme handling. The active theme is a `.dark` class on <html>;
// the no-flash script in index.html applies it before first paint, and the
// same resolution logic lives here so React stays in sync. A stored choice
// (localStorage) wins; otherwise we follow the OS `prefers-color-scheme`.
export type Theme = 'light' | 'dark';

const KEY = 'theme';

export function getStoredTheme(): Theme | null {
    try {
        const v = localStorage.getItem(KEY);
        return v === 'light' || v === 'dark' ? v : null;
    } catch {
        return null;
    }
}

export function systemTheme(): Theme {
    return typeof window !== 'undefined' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
}

export function resolveTheme(): Theme {
    return getStoredTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme): void {
    document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function setTheme(theme: Theme): void {
    try {
        localStorage.setItem(KEY, theme);
    } catch {
        /* private mode / storage disabled — still apply for this session */
    }
    applyTheme(theme);
}

// React binding for the toggle: tracks the active theme and, while the user
// hasn't made an explicit choice, follows live OS theme changes.
export function useTheme(): [Theme, (t: Theme) => void] {
    const [theme, setThemeState] = useState<Theme>(() => resolveTheme());
    useEffect(() => {
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => {
            if (getStoredTheme()) return;
            const next = systemTheme();
            setThemeState(next);
            applyTheme(next);
        };
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);
    return [
        theme,
        (t: Theme) => {
            setTheme(t);
            setThemeState(t);
        }
    ];
}
