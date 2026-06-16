export default function MiningKey() {
    return (
        <div>
            <h1 className="page-title">
                <i className="fas fa-key fa-fw text-accent" /> Mining Key
            </h1>
            <p className="muted mb-4">
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
                className="h-[80vh] w-full rounded-lg border border-black/15 bg-white"
            />
        </div>
    );
}
