import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import Nav from './Nav.tsx';
import LanguageSelect from './LanguageSelect.tsx';
import { getConfig } from '../api/client.ts';

export default function Header() {
    const config = useQuery({ queryKey: ['config'], queryFn: getConfig });
    const branding = config.data?.branding;
    const siteName = branding?.siteName || 'zny-nomp';
    const logo = branding?.logo || '/logo.svg';
    const tagline = branding?.tagline;
    return (
        <header className="bg-bg text-white">
            <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center gap-2 px-5 py-3 lg:flex-nowrap">
                <Link
                    to="/"
                    className="flex shrink-0 items-center gap-2 text-xl font-bold text-white hover:no-underline"
                >
                    <img src={logo} alt="" className="h-7" />
                    {siteName}
                </Link>
                {tagline && (
                    <span className="shrink-0 text-sm text-nav">{tagline}</span>
                )}
                <Nav />
                <LanguageSelect />
            </div>
        </header>
    );
}
