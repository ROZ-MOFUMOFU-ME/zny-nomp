// Shapes of the zny-nomp JSON API (see libs/api.ts + libs/stats.ts). Many
// numeric fields arrive as strings (raw Redis HGETALL), so most are widened to
// `number | string` and coerced in lib/format.ts.

export interface PriceRow {
    id: string;
    price: number;
    prices: Record<string, number>;
    vsCurrency: string;
    source: string;
    providerUpdatedAt: number | null;
    updated: number;
}

export interface PricesPayload {
    updated: number | null;
    count: number;
    prices: Record<string, PriceRow>;
    error?: string;
}

export interface WorkerEntry {
    name?: string;
    diff?: number;
    shares?: number;
    invalidshares?: number;
    currRoundShares?: number;
    currRoundTime?: number;
    hashrate?: number;
    hashrateString?: string;
    luckDays?: string;
    luckHours?: string;
    luckMinute?: string;
    paid?: number;
    balance?: number;
    [k: string]: unknown;
}

export interface PoolStatsInner {
    validShares?: number | string;
    validBlocks?: number | string;
    invalidShares?: number | string;
    totalPaid?: number | string;
    networkBlocks?: number | string;
    networkHash?: number | string;
    networkHashString?: string;
    networkDiff?: number | string;
    networkConnections?: number | string;
    networkVersion?: string | number;
    networkProtocolVersion?: number | string;
    [k: string]: unknown;
}

export interface PaymentRow {
    time: number;
    blocks?: string[] | number;
    txid?: string;
    miners?: number;
    shares?: number;
    amounts?: Record<string, number>;
    paid?: number;
    [k: string]: unknown;
}

export interface PoolBlocks {
    pending: number;
    confirmed: number;
    orphaned: number;
}

export interface PoolEntry {
    name: string;
    symbol?: string;
    algorithm?: string;
    blockTime?: number;
    hashrate?: number;
    hashrateString?: string;
    luckDays?: string;
    luckHours?: string;
    luckMinute?: string;
    minerCount?: number;
    workerCount?: number;
    shareCount?: number;
    maxRoundTime?: number;
    maxRoundTimeString?: string;
    poolStats?: PoolStatsInner;
    marketStats?: Record<string, unknown>;
    blocks?: PoolBlocks;
    workers?: Record<string, WorkerEntry>;
    miners?: Record<string, WorkerEntry>;
    pending?: { blocks: string[]; confirms: Record<string, number> };
    confirmed?: { blocks: string[] };
    payments?: PaymentRow[];
    [k: string]: unknown;
}

export interface AlgoEntry {
    workers: number;
    hashrate: number;
    hashrateString?: string;
}

export interface Stats {
    time: number;
    global?: { workers: number; hashrate: number };
    algos: Record<string, AlgoEntry>;
    pools: Record<string, PoolEntry>;
    prices?: PricesPayload;
    address?: string;
    [k: string]: unknown;
}

export interface PoolHistoryPoint {
    time: number;
    pools: Record<
        string,
        { hashrate: number; workerCount: number; blocks: PoolBlocks }
    >;
}

export interface WorkerStats {
    miner: string;
    totalHash: number;
    totalShares: number;
    networkHash?: number;
    immature: number;
    balance: number;
    paid: number;
    workers: Record<string, WorkerEntry>;
    history: Record<string, Array<{ time: number; hashrate: number }>>;
    result?: string;
}

export interface PoolPayments {
    name: string;
    pending: { blocks: string[]; confirms: Record<string, number> };
    payments: PaymentRow[];
}

export interface ExplorerLinks {
    blockURL?: string;
    txURL?: string;
    address?: string;
}

export interface MiningTool {
    name?: string;
    url: string;
}

export interface AppConfigPortVarDiff {
    minDiff?: number | string;
    maxDiff?: number | string;
    targetTime?: number | string;
    retargetTime?: number | string;
    variancePercent?: number | string;
}

export interface AppConfigPort {
    diff?: number | string;
    tls?: boolean;
    varDiff?: AppConfigPortVarDiff;
}

export interface AppConfigPool {
    coin: {
        name: string;
        symbol?: string;
        algorithm?: string;
        explorer?: ExplorerLinks;
        // Per-coin mining-software links from coins/<coin>.json `miningTools`.
        // Each entry may be { name, url } or a bare URL string.
        miningTools?: Array<MiningTool | string>;
    };
    ports?: Record<string, AppConfigPort>;
}

export interface AppConfigNavLink {
    label: string;
    // Omitted for dropdown parents (use children instead).
    url?: string;
    // Optional FontAwesome class for an icon, e.g. "fas fa-map-marker-alt".
    icon?: string;
    // Dropdown sub-links (one level). When set, this entry is a toggle menu
    // (e.g. "Pools" linking to sibling coin sites).
    children?: AppConfigNavLink[];
}

export interface AppConfigSection {
    title?: string;
    // Operator-authored HTML (config.json is a trusted source). Rendered with
    // dangerouslySetInnerHTML on the home page — keep it operator-only.
    html: string;
}

// A server feature row: a bare string (rendered with a check icon) or an
// object with a custom FontAwesome icon.
export type AppConfigServerFeature = string | { icon?: string; text: string };

export interface AppConfigServer {
    region?: string;
    country?: string;
    city?: string;
    // ISO 3166-1 alpha-2 code for flag-icons, e.g. "sg".
    flag?: string;
    // CORS-enabled endpoint; round-trip latency is measured client-side.
    pingUrl?: string;
    // Direct stratum connection URI, shown with a copy button.
    uri?: string;
    features?: AppConfigServerFeature[];
}

export interface AppConfigServers {
    title?: string;
    list?: AppConfigServer[];
}

// A hero highlight badge: a bare string (check icon) or { icon, text }.
export type AppConfigHighlight = string | { icon?: string; text: string };

export interface AppConfigAnalyticsScript {
    src: string;
    async?: boolean;
    defer?: boolean;
    attributes?: Record<string, string>;
}

export interface AppConfigAnalytics {
    // GA4 shortcut: loads gtag.js + init for this measurement id (G-XXXX).
    googleAnalyticsId?: string;
    // Arbitrary <script> tags appended to <head> (Plausible, Matomo, …).
    scripts?: AppConfigAnalyticsScript[];
}

// Operator branding from config.json `website.branding` (see GET /api/config).
// All fields are optional and free-form so a deployment can rebrand without
// code changes; the home hero renders only the facts the operator filled in.
export interface AppConfigBranding {
    siteName?: string;
    logo?: string;
    favicon?: string;
    // Short text shown next to the site name in the header.
    tagline?: string;
    // Extra external links appended to the header nav.
    navLinks?: AppConfigNavLink[];
    home?: {
        // Hero logo, independent of the header/site logo above; falls back to
        // branding.logo when unset.
        logo?: string;
        // Free-form hero heading; takes priority over the {{coin}} template.
        // Use this for multi-coin pools (no single coin to name).
        title?: string;
        coin?: string;
        minPayout?: string;
        paymentInterval?: string;
        poolFee?: string;
        paymentMethod?: string;
        // Custom HTML content blocks rendered below the hero.
        sections?: AppConfigSection[];
        // Structured "mining servers" cards with client-side ping.
        servers?: AppConfigServers;
        // Hero highlight badges (e.g. No KYC). Omit for built-in defaults,
        // [] to hide.
        highlights?: AppConfigHighlight[];
    };
    analytics?: AppConfigAnalytics;
}

// Served by the new GET /api/config endpoint.
export interface AppConfig {
    stratumHost?: string;
    branding?: AppConfigBranding;
    switching?: Record<
        string,
        { enabled?: boolean; port?: number; algorithm?: string; diff?: number }
    >;
    pools?: Record<string, AppConfigPool>;
    [k: string]: unknown;
}
