import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { getConfig } from '../api/client.ts';
import type { AppConfigNavLink } from '../api/types.ts';

const LINKS: Array<{
    to: string;
    key: string;
    fallback: string;
    icon: string;
}> = [
    {
        to: '/getting_started',
        key: 'getting_started',
        fallback: 'Getting Started',
        icon: 'fa-rocket'
    },
    {
        to: '/stats',
        key: 'pool_stats',
        fallback: 'Pool Stats',
        icon: 'fa-chart-bar'
    },
    {
        to: '/workers',
        key: 'workers_stats',
        fallback: 'Workers',
        icon: 'fa-cogs'
    },
    { to: '/tbs', key: 'tab_stats', fallback: 'Tab Stats', icon: 'fa-table' },
    {
        to: '/payments',
        key: 'payments',
        fallback: 'Payments',
        icon: 'fa-money-bill'
    },
    { to: '/api', key: 'api', fallback: 'API', icon: 'fa-code' }
];

// shrink-0 + whitespace-nowrap so items keep full text and overflow to the
// right (the nav scrolls horizontally) instead of wrapping to a second row.
const navClass =
    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm text-nav hover:bg-navhover hover:text-white hover:no-underline';

// A header dropdown (e.g. "Pools") linking to sibling sites. The menu is
// rendered in a portal (fixed-positioned) so the nav's horizontal overflow
// doesn't clip it; it closes on outside click, scroll, or resize.
function NavDropdown({ link }: { link: AppConfigNavLink }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
    const btnRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (
                btnRef.current?.contains(e.target as Node) ||
                menuRef.current?.contains(e.target as Node)
            )
                return;
            setOpen(false);
        };
        const onMove = () => setOpen(false);
        document.addEventListener('mousedown', onDown);
        window.addEventListener('scroll', onMove, true);
        window.addEventListener('resize', onMove);
        return () => {
            document.removeEventListener('mousedown', onDown);
            window.removeEventListener('scroll', onMove, true);
            window.removeEventListener('resize', onMove);
        };
    }, [open]);
    const children = (link.children ?? []).filter((c) => c && c.url && c.label);
    if (!children.length) return null;
    const toggle = () => {
        if (!open && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
        }
        setOpen((v) => !v);
    };
    return (
        <>
            <button
                ref={btnRef}
                type="button"
                aria-expanded={open}
                title={link.label}
                onClick={toggle}
                className={navClass}
            >
                {link.icon && <i className={`${link.icon} fa-fw`} />}
                <span>{link.label}</span>
                <i
                    className={`fas fa-chevron-down text-xs transition-transform ${
                        open ? 'rotate-180' : ''
                    }`}
                />
            </button>
            {open &&
                pos &&
                createPortal(
                    <div
                        ref={menuRef}
                        style={{
                            position: 'fixed',
                            top: pos.top,
                            right: pos.right
                        }}
                        className="z-50 min-w-[170px] rounded-md border border-white/10 bg-bg py-1 text-white shadow-lg"
                    >
                        {children.map((c) => (
                            <a
                                key={c.url}
                                href={c.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 px-4 py-2 text-sm text-nav hover:bg-navhover hover:text-white hover:no-underline"
                            >
                                {c.icon && <i className={`${c.icon} fa-fw`} />}
                                <span>{c.label}</span>
                            </a>
                        ))}
                    </div>,
                    document.body
                )}
        </>
    );
}

export default function Nav() {
    const { t } = useTranslation();
    const config = useQuery({ queryKey: ['config'], queryFn: getConfig });
    const navLinks = config.data?.branding?.navLinks;
    const extra = (Array.isArray(navLinks) ? navLinks : []).filter(
        (l) => l && l.label && (l.url || Array.isArray(l.children))
    );
    return (
        <nav className="flex flex-wrap items-center gap-1 lg:ml-auto lg:min-w-0 lg:flex-nowrap lg:overflow-x-auto lg:[-ms-overflow-style:none] lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
            {LINKS.map((l) => {
                const label = t(l.key, l.fallback);
                return (
                    <NavLink
                        key={l.to}
                        to={l.to}
                        title={label}
                        className={({ isActive }) =>
                            `inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-navhover hover:text-white hover:no-underline ${
                                isActive ? 'bg-navhover text-white' : 'text-nav'
                            }`
                        }
                    >
                        <i className={`fas ${l.icon} fa-fw`} />
                        <span>{label}</span>
                    </NavLink>
                );
            })}
            {extra.map((l, i) =>
                Array.isArray(l.children) ? (
                    <NavDropdown key={l.label + i} link={l} />
                ) : (
                    <a
                        key={l.url}
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        title={l.label}
                        className={navClass}
                    >
                        <i
                            className={`${l.icon || 'fas fa-up-right-from-square'} fa-fw`}
                        />
                        <span>{l.label}</span>
                    </a>
                )
            )}
        </nav>
    );
}
