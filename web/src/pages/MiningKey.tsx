export default function MiningKey() {
    return (
        <div>
            <h1 className="page-title">Mining Key</h1>
            <p className="muted">
                Generate a wallet / mining key. The tool runs entirely in your
                browser — you can also{' '}
                <a href="/key.html" download>
                    download it for offline use
                </a>
                .
            </p>
            <iframe
                title="Mining key generator"
                src="/key.html"
                style={{
                    width: '100%',
                    height: '80vh',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    background: '#fff'
                }}
            />
        </div>
    );
}
