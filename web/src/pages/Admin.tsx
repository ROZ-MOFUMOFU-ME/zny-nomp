import { useState } from 'react';
import { adminPools } from '../api/client.ts';

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
            }
        } finally {
            setLoading(false);
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
