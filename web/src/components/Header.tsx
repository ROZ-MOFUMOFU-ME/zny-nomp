import { Link } from 'react-router-dom';
import Nav from './Nav.tsx';
import LanguageSelect from './LanguageSelect.tsx';

export default function Header() {
    return (
        <header className="site-header">
            <Link to="/" className="brand">
                <img src="/logo.svg" alt="" />
                zny-nomp
            </Link>
            <Nav />
            <LanguageSelect />
        </header>
    );
}
