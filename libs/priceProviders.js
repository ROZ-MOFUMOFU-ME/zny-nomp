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

/* ----------------------------- shared helpers ---------------------------- */

function stripTrailingSlash(s) {
    return String(s).replace(/\/+$/, '');
}

function uniq(arr) {
    return [...new Set(arr)];
}

export function parseVsCurrencies(vsCurrency) {
    return String(vsCurrency || 'usd')
        .toLowerCase()
        .split(',')
        .map(function (v) {
            return v.trim();
        })
        .filter(Boolean);
}

function makeRow(id, prices, primaryVs, source, providerUpdatedAt, now) {
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

async function fetchJson(fetchImpl, url, opts) {
    opts = opts || {};
    const resp = await fetchImpl(url, {
        headers: opts.headers || { accept: 'application/json' },
        signal: AbortSignal.timeout(opts.timeout || 15000)
    });
    if (!resp || !resp.ok) {
        const e = new Error('HTTP ' + (resp ? resp.status : 'no response'));
        if (resp) e.status = resp.status;
        throw e;
    }
    return resp.json();
}

/* Run `fn` over items with at most `limit` in flight; resolves when all done. */
async function mapLimit(items, limit, fn) {
    const results = [];
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
    providerName,
    symbol,
    coinsCfg,
    coinProfiles
) {
    const entry = coinsCfg && coinsCfg[symbol];
    if (entry !== undefined && entry !== null) {
        if (typeof entry === 'string') {
            if (providerName === 'coingecko' && entry) return entry;
        } else if (typeof entry === 'object' && entry[providerName]) {
            return entry[providerName];
        }
    }
    const profile = coinProfiles && coinProfiles[symbol];
    if (profile && profile[providerName]) return profile[providerName];
    return null;
}

/* Uppercase the keys of a SYMBOL-keyed map (config coins may be lowercased). */
export function upperKeyMap(obj) {
    const out = {};
    if (obj)
        Object.keys(obj).forEach(function (k) {
            out[k.toUpperCase()] = obj[k];
        });
    return out;
}

/* All symbols resolvable by at least one of the given providers. */
export function gatherSymbols(providerNames, coinsCfg, coinProfiles) {
    const set = new Set();
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
export function buildIdMaps(providerNames, symbols, coinsCfg, coinProfiles) {
    const maps = {};
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
    transform(idMap, vsList, data, now) {
        const primary = vsList[0];
        const out = {};
        Object.keys(idMap).forEach(function (sym) {
            const id = idMap[sym];
            const row = data && data[id];
            if (!row) return;
            const prices = {};
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

    async fetchPrices(idMap, vsList, opts) {
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
        const headers = { accept: 'application/json' };
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
    transformOne(id, vsList, data, now) {
        if (!data || !data.quotes) return null;
        const primary = vsList[0];
        const prices = {};
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

    async fetchPrices(idMap, vsList, opts) {
        const base = stripTrailingSlash(opts.apiBase || this.defaultBase);
        const quotes = uniq(
            vsList.map(function (v) {
                return v.toUpperCase();
            })
        ).join(',');
        const headers = { accept: 'application/json' };
        // Paid CoinPaprika uses an Authorization header; harmless when unset.
        if (opts.apiKey)
            headers[opts.apiKeyHeader || 'Authorization'] = opts.apiKey;
        const out = {};
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

export const PROVIDERS = {
    coingecko: coingecko,
    coinpaprika: coinpaprika
};

export const DEFAULT_PROVIDER_ORDER = ['coingecko', 'coinpaprika'];

/*
 * Parse a raw `priceFeed:prices` HGETALL reply ({ SYMBOL: jsonString }) back
 * into { SYMBOL: row }, skipping any malformed entry rather than failing the
 * whole read. Used by the API to serve what the priceFeed worker stored.
 */
export function parsePriceHash(raw) {
    const out = {};
    Object.keys(raw || {}).forEach(function (sym) {
        try {
            out[sym] = JSON.parse(raw[sym]);
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
export async function collectPrices(providers, idMaps, vsList, opts) {
    const rows = {};
    const servedBy = {};
    const errors = [];
    for (const provider of providers) {
        const full = idMaps[provider.name] || {};
        const targets = {};
        Object.keys(full).forEach(function (sym) {
            if (!rows[sym]) targets[sym] = full[sym];
        });
        if (Object.keys(targets).length === 0) continue;

        const providerOpts = Object.assign(
            {},
            (opts.providerOpts && opts.providerOpts[provider.name]) || {},
            {
                now: opts.now,
                timeout: opts.timeout,
                fetchImpl: opts.fetchImpl,
                onItemError: opts.onItemError
            }
        );

        let got;
        try {
            got = await provider.fetchPrices(targets, vsList, providerOpts);
        } catch (e) {
            errors.push({ provider: provider.name, error: e });
            if (opts.onProviderError) opts.onProviderError(provider.name, e);
            continue;
        }
        Object.keys(got || {}).forEach(function (sym) {
            if (!rows[sym]) {
                rows[sym] = got[sym];
                servedBy[sym] = provider.name;
            }
        });
    }
    return { rows: rows, servedBy: servedBy, errors: errors };
}
