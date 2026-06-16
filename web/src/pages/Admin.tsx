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
                <h1 className="page-title">Admin</h1>
                <div className="card">
                    <form
                        className="lookup-form"
                        onSubmit={(e) => {
                            e.preventDefault();
                            login();
                        }}
                    >
                        <input
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
                            {loading ? 'Logging in…' : 'Login'}
                        </button>
                    </form>
                    {loginError !== null && (
                        <div className="error">{loginError}</div>
                    )}
                    <p className="muted">
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
            <h1 className="page-title">Admin</h1>
            <div className="card">
                <button className="btn" type="button" onClick={logout}>
                    Log out
                </button>
                <p className="muted">
                    Pool configuration (read-only). This reflects the live
                    pool_configs as seen by the portal.
                </p>
            </div>

            {Object.keys(pools).length === 0 ? (
                <div className="card">
                    <p className="muted">No pools configured.</p>
                </div>
            ) : (
                Object.entries(pools).map(([poolKey, value]) => (
                    <div className="card" key={poolKey}>
                        <h2>{poolKey}</h2>
                        <pre>{JSON.stringify(value, null, 2)}</pre>
                    </div>
                ))
            )}
        </div>
    );
}
