import { Routes, Route, Navigate } from 'react-router-dom';
import Header from './components/Header.tsx';
import Footer from './components/Footer.tsx';
import Home from './pages/Home.tsx';
import Stats from './pages/Stats.tsx';
import Workers from './pages/Workers.tsx';
import MinerStats from './pages/MinerStats.tsx';
import Payments from './pages/Payments.tsx';
import TabStats from './pages/TabStats.tsx';
import GettingStarted from './pages/GettingStarted.tsx';
import ApiDocs from './pages/ApiDocs.tsx';
import Admin from './pages/Admin.tsx';
import MiningKey from './pages/MiningKey.tsx';

export default function App() {
    return (
        <div className="app-frame">
            <Header />
            <main className="app-main">
                <Routes>
                    <Route path="/" element={<Home />} />
                    <Route
                        path="/getting_started"
                        element={<GettingStarted />}
                    />
                    <Route path="/stats" element={<Stats />} />
                    <Route path="/workers" element={<Workers />} />
                    <Route path="/workers/:address" element={<MinerStats />} />
                    <Route path="/payments" element={<Payments />} />
                    <Route path="/tbs" element={<TabStats />} />
                    <Route path="/api" element={<ApiDocs />} />
                    <Route path="/mining_key" element={<MiningKey />} />
                    <Route path="/admin" element={<Admin />} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </main>
            <Footer />
        </div>
    );
}
