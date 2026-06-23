import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Nav from './Nav.tsx';
import LanguageSelect from './LanguageSelect.tsx';
import ThemeToggle from './ThemeToggle.tsx';
import { getConfig } from '../api/client.ts';

export default function Header() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const config = useQuery({ queryKey: ['config'], queryFn: getConfig });
    const branding = config.data?.branding;
    const siteName = branding?.siteName || 'zny-nomp';
    const logo = branding?.logo || '/logo.svg';
    const tagline = branding?.tagline;
    return (
        <header className="bg-bg text-white">
            <div className="mx-auto flex w-full max-w-[1280px] items-center gap-2 px-5 py-3">
                <Link
                    to="/"
                    onClick={() => setOpen(false)}
                    className="flex shrink-0 items-center gap-2 text-xl font-bold text-white hover:no-underline"
                >
                    <img src={logo} alt="" className="h-7" />
                    {siteName}
                </Link>
                {tagline && (
                    <span className="hidden shrink-0 text-sm text-nav lg:inline">
                        {tagline}
                    </span>
                )}
                {/* Inline links on desktop; collapsed into the dropdown below
                    on mobile (Nav hides itself under lg). */}
                <Nav />
                <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">
                    <ThemeToggle />
                    <div className="hidden lg:block">
                        <LanguageSelect />
                    </div>
                    <button
                        type="button"
                        onClick={() => setOpen((v) => !v)}
                        aria-label={t('nav_menu', 'Menu')}
                        aria-expanded={open}
                        className="inline-flex shrink-0 items-center justify-center rounded-md px-3 py-2 text-nav hover:bg-navhover hover:text-white lg:hidden"
                    >
                        <i
                            className={`fas fa-fw ${open ? 'fa-xmark' : 'fa-bars'}`}
                        />
                    </button>
                </div>
            </div>
            {open && (
                <div className="border-t border-white/10 px-5 pb-3 pt-2 lg:hidden">
                    <Nav mobile onNavigate={() => setOpen(false)} />
                    <div className="mt-2">
                        <LanguageSelect />
                    </div>
                </div>
            )}
        </header>
    );
}
