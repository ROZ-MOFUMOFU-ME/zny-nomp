/*
 * Price providers + per-symbol fallback.
 *
 * Each provider exposes:
 *   name        unique key, also the config sub-block and coin-profile id field
 *   needsKey    true if it cannot run without an apiKey
 *   fetchPrices(idMap, vsList, opts) -> { SYMBOL: row }   (does HTTP + transform)
 * and a pure transform helper used by fetchPrices (and unit tests).
 *
 * A "row" is provider-agnostic:
 *   { id, price, prices: { usd: .., btc: .. }, vsCurrency, source,
 *     providerUpdatedAt: <ms|null>, updated: <ms> }
 *
 * collectPrices() walks providers in priority order and asks each only for the
 * symbols still missing, so a coin absent from CoinGecko can be filled in by
 * CoinPaprika (or any later provider).
 */

/* ------------------------------- types ----------------------------------- */

/** A coin's id config entry: a CoinGecko-id string, or a per-provider id map. */
export type CoinEntry = string | Record<string, string | undefined>;
export type CoinsConfig = Record<string, CoinEntry | null | undefined>;
export type CoinProfile = Record<string, unknown>;
export type CoinProfiles = Record<string, CoinProfile | null | undefined>;

export interface PriceRow {
    id: string;
    price: number;
    prices: Record<string, number>;
    vsCurrency: string;
    source: string;
    providerUpdatedAt: number | null;
    updated: number;
}

/** Minimal shape of a fetch() response we depend on (real fetch satisfies it). */
export interface FetchResponse {
    ok: boolean;
    status: number;
    json(): Promise<any>;
}
export type FetchImpl = (url: string, init?: any) => Promise<FetchResponse>;

export interface ProviderOpts {
    apiBase?: string;
    apiKey?: string;
    apiKeyHeader?: string;
    fetchImpl: FetchImpl;
    timeout?: number;
    now: number;
    concurrency?: number;
    onItemError?: (provider: string, sym: string, e: unknown) => void;
}

export interface Provider {
    name: string;
    needsKey: boolean;
    defaultBase: string;
    fetchPrices(
        idMap: Record<string, string>,
        vsList: string[],
        opts: ProviderOpts
    ): Promise<Record<string, PriceRow>>;
}

export interface CollectOpts {
    now: number;
    timeout?: number;
    fetchImpl: FetchImpl;
    onItemError?: (provider: string, sym: string, e: unknown) => void;
    onProviderError?: (provider: string, e: unknown) => void;
    providerOpts?: Record<string, Partial<ProviderOpts>>;
}

export interface CollectResult {
    rows: Record<string, PriceRow>;
    servedBy: Record<string, string>;
    errors: Array<{ provider: string; error: unknown }>;
}

/* ----------------------------- shared helpers ---------------------------- */

function stripTrailingSlash(s: string): string {
    return String(s).replace(/\/+$/, '');
}

function uniq<T>(arr: T[]): T[] {
    return [...new Set(arr)];
}

export function parseVsCurrencies(vsCurrency?: string | null): string[] {
    return String(vsCurrency || 'usd')
        .toLowerCase()
        .split(',')
        .map(function (v) {
            return v.trim();
        })
        .filter(Boolean);
}

function makeRow(
    id: string,
    prices: Record<string, number>,
    primaryVs: string,
    source: string,
    providerUpdatedAt: number | null,
    now: number
): PriceRow {
    return {
        id: id,
        price: prices[primaryVs],
        prices: prices,
        vsCurrency: primaryVs,
        source: source,
        providerUpdatedAt: providerUpdatedAt || null,
        updated: now
    };
}

interface FetchJsonOpts {
    headers?: Record<string, string>;
    timeout?: number;
}

async function fetchJson(
    fetchImpl: FetchImpl,
    url: string,
    opts?: FetchJsonOpts
): Promise<any> {
    const o = opts || {};
    const resp = await fetchImpl(url, {
        headers: o.headers || { accept: 'application/json' },
        signal: AbortSignal.timeout(o.timeout || 15000)
    });
    if (!resp || !resp.ok) {
        const e: any = new Error(
            'HTTP ' + (resp ? resp.status : 'no response')
        );
        if (resp) e.status = resp.status;
        throw e;
    }
    return resp.json();
}

/* Run `fn` over items with at most `limit` in flight; resolves when all done. */
async function mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = [];
    let next = 0;
    const runners = new Array(Math.max(1, Math.min(limit, items.length)))
        .fill(0)
        .map(async function () {
            while (next < items.length) {
                const idx = next++;
                results[idx] = await fn(items[idx], idx);
            }
        });
    await Promise.all(runners);
    return results;
}

/* --------------------------- id / symbol mapping ------------------------- */

/*
 * Resolve a provider-specific id for a symbol. Sources, in order:
 *   1. priceFeed.coins[SYMBOL] as an object: { coingecko: "...", coinpaprika }
 *   2. priceFeed.coins[SYMBOL] as a string: shorthand for the CoinGecko id
 *   3. the coin profile's field named after the provider (coin.coingecko, ...)
 */
export function resolveProviderId(
    providerName: string,
    symbol: string,
    coinsCfg?: CoinsConfig | null,
    coinProfiles?: CoinProfiles | null
): string | null {
    const entry = coinsCfg && coinsCfg[symbol];
    if (entry !== undefined && entry !== null) {
        if (typeof entry === 'string') {
            if (providerName === 'coingecko' && entry) return entry;
        } else if (typeof entry === 'object') {
            const id = entry[providerName];
            if (id) return id;
        }
    }
    const profile = coinProfiles && coinProfiles[symbol];
    if (profile && profile[providerName])
        return profile[providerName] as string;
    return null;
}

/* Uppercase the keys of a SYMBOL-keyed map (config coins may be lowercased). */
export function upperKeyMap<T>(
    obj?: Record<string, T> | null
): Record<string, T> {
    const out: Record<string, T> = {};
    if (obj)
        Object.keys(obj).forEach(function (k) {
            out[k.toUpperCase()] = obj[k];
        });
    return out;
}

/* All symbols resolvable by at least one of the given providers. */
export function gatherSymbols(
    providerNames: string[],
    coinsCfg?: CoinsConfig | null,
    coinProfiles?: CoinProfiles | null
): string[] {
    const set = new Set<string>();
    if (coinsCfg)
        Object.keys(coinsCfg).forEach(function (s) {
            set.add(s.toUpperCase());
        });
    if (coinProfiles)
        Object.keys(coinProfiles).forEach(function (s) {
            const profile = coinProfiles[s];
            if (
                providerNames.some(function (n) {
                    return profile && profile[n];
                })
            )
                set.add(s.toUpperCase());
        });
    return [...set].filter(function (s) {
        return providerNames.some(function (n) {
            return resolveProviderId(n, s, coinsCfg, coinProfiles);
        });
    });
}

/* { providerName: { SYMBOL: providerId } } for the resolvable symbols. */
export function buildIdMaps(
    providerNames: string[],
    symbols: string[],
    coinsCfg?: CoinsConfig | null,
    coinProfiles?: CoinProfiles | null
): Record<string, Record<string, string>> {
    const maps: Record<string, Record<string, string>> = {};
    providerNames.forEach(function (n) {
        maps[n] = {};
        symbols.forEach(function (s) {
            const id = resolveProviderId(n, s, coinsCfg, coinProfiles);
            if (id) maps[n][s] = id;
        });
    });
    return maps;
}

/* ------------------------------- providers ------------------------------- */

export const coingecko = {
    name: 'coingecko',
    needsKey: false,
    defaultBase: 'https://api.coingecko.com/api/v3',

    /* { id: { usd: 1, last_updated_at: 170... } } -> { SYMBOL: row } */
    transform(
        idMap: Record<string, string>,
        vsList: string[],
        data: any,
        now: number
    ): Record<string, PriceRow> {
        const primary = vsList[0];
        const out: Record<string, PriceRow> = {};
        Object.keys(idMap).forEach(function (sym) {
            const id = idMap[sym];
            const row = data && data[id];
            if (!row) return;
            const prices: Record<string, number> = {};
            vsList.forEach(function (v) {
                if (typeof row[v] === 'number' && isFinite(row[v]))
                    prices[v] = row[v];
            });
            if (Object.keys(prices).length === 0) return;
            out[sym] = makeRow(
                id,
                prices,
                primary,
                'coingecko',
                typeof row.last_updated_at === 'number'
                    ? row.last_updated_at * 1000
                    : null,
                now
            );
        });
        return out;
    },

    async fetchPrices(
        idMap: Record<string, string>,
        vsList: string[],
        opts: ProviderOpts
    ): Promise<Record<string, PriceRow>> {
        const base = stripTrailingSlash(opts.apiBase || this.defaultBase);
        const ids = uniq(
            Object.keys(idMap).map(function (s) {
                return idMap[s];
            })
        );
        const params = new URLSearchParams({
            ids: ids.join(','),
            vs_currencies: vsList.join(','),
            include_last_updated_at: 'true'
        });
        const headers: Record<string, string> = { accept: 'application/json' };
        if (opts.apiKey)
            headers[opts.apiKeyHeader || 'x-cg-demo-api-key'] = opts.apiKey;
        const data = await fetchJson(
            opts.fetchImpl,
            base + '/simple/price?' + params.toString(),
            { headers: headers, timeout: opts.timeout }
        );
        return this.transform(idMap, vsList, data, opts.now);
    }
};

export const coinpaprika = {
    name: 'coinpaprika',
    needsKey: false,
    defaultBase: 'https://api.coinpaprika.com/v1',

    /* one /tickers/{id} response -> row (or null if no usable price). */
    transformOne(
        id: string,
        vsList: string[],
        data: any,
        now: number
    ): PriceRow | null {
        if (!data || !data.quotes) return null;
        const primary = vsList[0];
        const prices: Record<string, number> = {};
        vsList.forEach(function (v) {
            const q = data.quotes[v.toUpperCase()];
            if (q && typeof q.price === 'number' && isFinite(q.price))
                prices[v] = q.price;
        });
        if (Object.keys(prices).length === 0) return null;
        const updated = data.last_updated ? Date.parse(data.last_updated) : NaN;
        return makeRow(
            id,
            prices,
            primary,
            'coinpaprika',
            isFinite(updated) ? updated : null,
            now
        );
    },

    async fetchPrices(
        idMap: Record<string, string>,
        vsList: string[],
        opts: ProviderOpts
    ): Promise<Record<string, PriceRow>> {
        const base = stripTrailingSlash(opts.apiBase || this.defaultBase);
        const quotes = uniq(
            vsList.map(function (v) {
                return v.toUpperCase();
            })
        ).join(',');
        const headers: Record<string, string> = { accept: 'application/json' };
        // Paid CoinPaprika uses an Authorization header; harmless when unset.
        if (opts.apiKey)
            headers[opts.apiKeyHeader || 'Authorization'] = opts.apiKey;
        const out: Record<string, PriceRow> = {};
        const syms = Object.keys(idMap);
        const self = this;
        await mapLimit(syms, opts.concurrency || 4, async function (sym) {
            const url =
                base +
                '/tickers/' +
                encodeURIComponent(idMap[sym]) +
                '?quotes=' +
                quotes;
            try {
                const data = await fetchJson(opts.fetchImpl, url, {
                    headers: headers,
                    timeout: opts.timeout
                });
                const row = self.transformOne(
                    idMap[sym],
                    vsList,
                    data,
                    opts.now
                );
                if (row) out[sym] = row;
            } catch (e) {
                if (opts.onItemError) opts.onItemError('coinpaprika', sym, e);
            }
        });
        return out;
    }
};

export const PROVIDERS: Record<string, Provider> = {
    coingecko: coingecko,
    coinpaprika: coinpaprika
};

export const DEFAULT_PROVIDER_ORDER = ['coingecko', 'coinpaprika'];

/*
 * Parse a raw `priceFeed:prices` HGETALL reply ({ SYMBOL: jsonString }) back
 * into { SYMBOL: row }, skipping any malformed entry rather than failing the
 * whole read. Used by the API to serve what the priceFeed worker stored.
 */
export function parsePriceHash(
    raw?: Record<string, string> | null
): Record<string, any> {
    const out: Record<string, any> = {};
    const r = raw || {};
    Object.keys(r).forEach(function (sym) {
        try {
            out[sym] = JSON.parse(r[sym]);
        } catch (_e) {
            // skip a malformed entry
        }
    });
    return out;
}

/* --------------------------- fallback orchestrator ----------------------- */

/*
 * Walk `providers` (objects, in priority order). Ask each only for symbols not
 * yet priced, merge its results, and stop early once everything is covered.
 * A provider that throws is recorded and skipped (its symbols fall through to
 * later providers). Returns { rows, servedBy, errors }.
 */
export async function collectPrices(
    providers: Provider[],
    idMaps: Record<string, Record<string, string>>,
    vsList: string[],
    opts: CollectOpts
): Promise<CollectResult> {
    const rows: Record<string, PriceRow> = {};
    const servedBy: Record<string, string> = {};
    const errors: Array<{ provider: string; error: unknown }> = [];
    for (const provider of providers) {
        const full = idMaps[provider.name] || {};
        const targets: Record<string, string> = {};
        Object.keys(full).forEach(function (sym) {
            if (!rows[sym]) targets[sym] = full[sym];
        });
        if (Object.keys(targets).length === 0) continue;

        const providerOpts: ProviderOpts = Object.assign(
            {},
            (opts.providerOpts && opts.providerOpts[provider.name]) || {},
            {
                now: opts.now,
                timeout: opts.timeout,
                fetchImpl: opts.fetchImpl,
                onItemError: opts.onItemError
            }
        );

        let got: Record<string, PriceRow> | undefined;
        try {
            got = await provider.fetchPrices(targets, vsList, providerOpts);
        } catch (e) {
            errors.push({ provider: provider.name, error: e });
            if (opts.onProviderError) opts.onProviderError(provider.name, e);
            continue;
        }
        const g = got || {};
        Object.keys(g).forEach(function (sym) {
            if (!rows[sym]) {
                rows[sym] = g[sym];
                servedBy[sym] = provider.name;
            }
        });
    }
    return { rows: rows, servedBy: servedBy, errors: errors };
}
