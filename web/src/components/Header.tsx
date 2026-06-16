import { Link } from 'react-router-dom';
import Nav from './Nav.tsx';
import LanguageSelect from './LanguageSelect.tsx';

export default function Header() {
    return (
        <header className="flex flex-wrap items-center gap-2 bg-bg px-4 py-3 text-white">
            <Link
                to="/"
                className="flex items-center gap-2 text-xl font-bold text-white hover:no-underline"
            >
                <img src="/logo.svg" alt="" className="h-7" />
                zny-nomp
            </Link>
            <Nav />
            <LanguageSelect />
        </header>
    );
}
