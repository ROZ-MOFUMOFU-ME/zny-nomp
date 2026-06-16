import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

const LINKS: Array<{ to: string; key: string; fallback: string }> = [
    {
        to: '/getting_started',
        key: 'getting_started',
        fallback: 'Getting Started'
    },
    { to: '/stats', key: 'pool_stats', fallback: 'Pool Stats' },
    { to: '/workers', key: 'workers_stats', fallback: 'Workers' },
    { to: '/tbs', key: 'tab_stats', fallback: 'Tab Stats' },
    { to: '/payments', key: 'payments', fallback: 'Payments' },
    { to: '/api', key: 'api', fallback: 'API' }
];

export default function Nav() {
    const { t } = useTranslation();
    return (
        <nav className="site-nav">
            {LINKS.map((l) => (
                <NavLink
                    key={l.to}
                    to={l.to}
                    className={({ isActive }) => (isActive ? 'active' : '')}
                >
                    {t(l.key, l.fallback)}
                </NavLink>
            ))}
        </nav>
    );
}
