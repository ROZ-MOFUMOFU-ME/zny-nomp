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
    ports?: Record<string, unknown>;
}

// Served by the new GET /api/config endpoint.
export interface AppConfig {
    stratumHost?: string;
    switching?: Record<
        string,
        { enabled?: boolean; port?: number; algorithm?: string; diff?: number }
    >;
    pools?: Record<string, AppConfigPool>;
    [k: string]: unknown;
}
