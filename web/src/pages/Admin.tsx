import { useState } from 'react';
import {
    adminPools,
    getAnnouncement,
    adminSetAnnouncement
} from '../api/client.ts';

// Password-gated admin center at /admin. The backend only implements
// POST /api/admin/pools, which echoes back the (large, nested) pool config map
// on a correct password — so this page is read-only: log in, view the config,
// log out. The password is remembered in localStorage so a refresh keeps you in.
export default function Admin() {
    const [password, setPassword] = useState(
        () => localStorage.getItem('admin_password') || ''
    );
    const [loginError, setLoginError] = useState<string | null>(null);
    const [result, setResult] = useState<unknown>(null);
    const [loading, setLoading] = useState(false);
    const [announcement, setAnnouncement] = useState('');
    const [annStatus, setAnnStatus] = useState<
        'idle' | 'saving' | 'saved' | 'error'
    >('idle');

    async function login() {
        setLoading(true);
        setLoginError(null);
        try {
            const response = await adminPools(password);
            if (response.error) {
                setLoginError(response.error);
                localStorage.removeItem('admin_password');
            } else {
                localStorage.setItem('admin_password', password);
                setResult(response.result ?? null);
                try {
                    const ann = await getAnnouncement();
                    setAnnouncement(ann.announcement || '');
                } catch {
                    /* leave the editor empty if the fetch fails */
                }
            }
        } finally {
            setLoading(false);
        }
    }

    async function saveAnnouncement() {
        setAnnStatus('saving');
        try {
            const resp = await adminSetAnnouncement(password, announcement);
            setAnnStatus(resp.error ? 'error' : 'saved');
        } catch {
            setAnnStatus('error');
        }
    }

    function logout() {
        setResult(null);
        setPassword('');
        setLoginError(null);
        localStorage.removeItem('admin_password');
    }

    if (result === null) {
        return (
            <div>
                <h1 className="page-title">
                    <i className="fas fa-lock fa-fw text-accent" /> Admin
                </h1>
                <div className="card">
                    <form
                        className="flex flex-wrap gap-2"
                        onSubmit={(e) => {
                            e.preventDefault();
                            login();
                        }}
                    >
                        <input
                            className="field min-w-[240px] flex-1"
                            type="password"
                            placeholder="Admin password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                            className="btn"
                            type="submit"
                            disabled={loading}
                        >
                            <i className="fas fa-right-to-bracket fa-fw" />{' '}
                            {loading ? 'Logging in…' : 'Login'}
                        </button>
                    </form>
                    {loginError !== null && (
                        <div className="error">{loginError}</div>
                    )}
                    <p className="muted mt-3">
                        The admin center must be enabled in the portal config
                        before you can log in.
                    </p>
                </div>
            </div>
        );
    }

    const pools = result as Record<string, unknown>;

    return (
        <div>
            <h1 className="page-title">
                <i className="fas fa-lock-open fa-fw text-accent" /> Admin
            </h1>
            <div className="card">
                <button className="btn" type="button" onClick={logout}>
                    <i className="fas fa-right-from-bracket fa-fw" /> Log out
                </button>
                <p className="muted mt-3">
                    Pool configuration (read-only). This reflects the live
                    pool_configs as seen by the portal.
                </p>
            </div>

            <div className="card mt-4">
                <div className="mb-2 font-semibold">
                    <i className="fas fa-bullhorn fa-fw text-accent" /> Top
                    Announcement
                </div>
                <p className="muted mb-2 text-sm">
                    Shown as a banner at the top of the home page. Leave empty
                    to hide it.
                </p>
                <textarea
                    className="field min-h-[120px] w-full"
                    value={announcement}
                    maxLength={2000}
                    placeholder="Announcement text…"
                    onChange={(e) => {
                        setAnnouncement(e.target.value);
                        setAnnStatus('idle');
                    }}
                />
                <div className="mt-2 flex items-center gap-3">
                    <button
                        className="btn"
                        type="button"
                        onClick={saveAnnouncement}
                        disabled={annStatus === 'saving'}
                    >
                        <i className="fas fa-floppy-disk fa-fw" />{' '}
                        {annStatus === 'saving' ? 'Saving…' : 'Save'}
                    </button>
                    {annStatus === 'saved' && (
                        <span className="text-sm text-green-600">Saved.</span>
                    )}
                    {annStatus === 'error' && (
                        <span className="error">Failed to save.</span>
                    )}
                </div>
            </div>

            {Object.keys(pools).length === 0 ? (
                <div className="card mt-4">
                    <p className="muted">No pools configured.</p>
                </div>
            ) : (
                Object.entries(pools).map(([poolKey, value]) => (
                    <div className="card mt-4" key={poolKey}>
                        <h2 className="mb-2 text-lg font-bold">{poolKey}</h2>
                        <pre className="overflow-x-auto rounded-md bg-black/5 p-3 text-xs">
                            {JSON.stringify(value, null, 2)}
                        </pre>
                    </div>
                ))
            )}
        </div>
    );
}
