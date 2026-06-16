import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

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
                    <i className={`fas ${l.icon} fa-fw`} />
                    <span>{t(l.key, l.fallback)}</span>
                </NavLink>
            ))}
        </nav>
    );
}
