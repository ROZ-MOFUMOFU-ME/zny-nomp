// Unit tests for the price-feed pure logic + multi-provider fallback.
// Run: node --test test/   (or: node --test test/priceFeed.test.ts)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import {
    parseVsCurrencies,
    resolveProviderId,
    upperKeyMap,
    gatherSymbols,
    buildIdMaps,
    coingecko,
    coinpaprika,
    PROVIDERS,
    collectPrices,
    parsePriceHash
} from '../src/priceProviders.ts';

const jsonResponse = (obj: any, ok = true, status = 200) => ({
    ok,
    status,
    json: async () => obj
});

test('parseVsCurrencies splits, lowercases, trims', () => {
    assert.deepEqual(parseVsCurrencies('usd'), ['usd']);
    assert.deepEqual(parseVsCurrencies('USD, BTC ,eur'), ['usd', 'btc', 'eur']);
    assert.deepEqual(parseVsCurrencies(''), ['usd']);
    assert.deepEqual(parseVsCurrencies(undefined), ['usd']);
});

test('resolveProviderId: string shorthand maps only to coingecko', () => {
    const coins = upperKeyMap({ btc: 'bitcoin' });
    assert.equal(resolveProviderId('coingecko', 'BTC', coins, {}), 'bitcoin');
    assert.equal(resolveProviderId('coinpaprika', 'BTC', coins, {}), null);
});

test('resolveProviderId: object form + coin-profile fallback', () => {
    const coins = upperKeyMap({
        BTC: { coingecko: 'bitcoin', coinpaprika: 'btc-bitcoin' }
    });
    assert.equal(
        resolveProviderId('coinpaprika', 'BTC', coins, {}),
        'btc-bitcoin'
    );

    const profiles = { MONA: { symbol: 'MONA', coingecko: 'monacoin' } };
    assert.equal(
        resolveProviderId('coingecko', 'MONA', {}, profiles),
        'monacoin'
    );
    assert.equal(resolveProviderId('coinpaprika', 'MONA', {}, profiles), null);
});

test('gatherSymbols + buildIdMaps across providers', () => {
    const coins = upperKeyMap({
        BTC: { coingecko: 'bitcoin', coinpaprika: 'btc-bitcoin' },
        MONA: { coingecko: 'monacoin' },
        FOO: { coinpaprika: 'foo-coin' }
    });
    const order = ['coingecko', 'coinpaprika'];
    const symbols = gatherSymbols(order, coins, {});
    assert.deepEqual(symbols.sort(), ['BTC', 'FOO', 'MONA']);

    const maps = buildIdMaps(order, symbols, coins, {});
    assert.deepEqual(maps.coingecko, { BTC: 'bitcoin', MONA: 'monacoin' });
    assert.deepEqual(maps.coinpaprika, { BTC: 'btc-bitcoin', FOO: 'foo-coin' });
});

test('gatherSymbols drops symbols no provider can resolve', () => {
    // a coin profile present but with no provider id field is ignored
    const profiles = { BAR: { symbol: 'BAR' } };
    assert.deepEqual(gatherSymbols(['coingecko'], {}, profiles), []);
});

test('coingecko.transform picks numeric prices and scales timestamp', () => {
    const idMap = { BTC: 'bitcoin', MONA: 'monacoin', GHOST: 'ghost' };
    const data = {
        bitcoin: { usd: 65000, btc: 1, last_updated_at: 1700000000 },
        monacoin: { usd: 'nope' } // non-numeric -> skipped
        // ghost absent -> skipped
    };
    const rows = coingecko.transform(idMap, ['usd', 'btc'], data, 111);
    assert.deepEqual(Object.keys(rows), ['BTC']);
    assert.equal(rows.BTC.price, 65000);
    assert.deepEqual(rows.BTC.prices, { usd: 65000, btc: 1 });
    assert.equal(rows.BTC.source, 'coingecko');
    assert.equal(rows.BTC.providerUpdatedAt, 1700000000 * 1000);
    assert.equal(rows.BTC.updated, 111);
});

test('coinpaprika.transformOne reads uppercase quotes + ISO timestamp', () => {
    const data = {
        id: 'btc-bitcoin',
        quotes: { USD: { price: 64950 }, BTC: { price: 1 } },
        last_updated: '2023-11-14T00:00:00Z'
    };
    const row = coinpaprika.transformOne(
        'btc-bitcoin',
        ['usd', 'btc'],
        data,
        222
    )!;
    assert.equal(row.price, 64950);
    assert.deepEqual(row.prices, { usd: 64950, btc: 1 });
    assert.equal(row.source, 'coinpaprika');
    assert.equal(row.providerUpdatedAt, Date.parse('2023-11-14T00:00:00Z'));
    assert.equal(
        coinpaprika.transformOne('x', ['usd'], { quotes: {} }, 1),
        null
    );
    assert.equal(coinpaprika.transformOne('x', ['usd'], null, 1), null);
});

test('parsePriceHash parses JSON values and skips malformed entries', () => {
    const raw = {
        BTC: JSON.stringify({ price: 65000, source: 'coingecko' }),
        MONA: JSON.stringify({ price: 0.5, source: 'coinpaprika' }),
        BAD: '{not valid json'
    };
    const out = parsePriceHash(raw);
    assert.deepEqual(Object.keys(out).sort(), ['BTC', 'MONA']);
    assert.equal(out.BTC.price, 65000);
    assert.equal(out.MONA.source, 'coinpaprika');
    assert.deepEqual(parsePriceHash({}), {});
    assert.deepEqual(parsePriceHash(undefined), {});
});

test('collectPrices: per-symbol fallback fills CoinGecko gaps from CoinPaprika', async () => {
    const coins = upperKeyMap({
        BTC: { coingecko: 'bitcoin', coinpaprika: 'btc-bitcoin' },
        MONA: { coingecko: 'monacoin' },
        FOO: { coinpaprika: 'foo-coin' }
    });
    const order = ['coingecko', 'coinpaprika'];
    const symbols = gatherSymbols(order, coins, {});
    const idMaps = buildIdMaps(order, symbols, coins, {});

    const gecko: Record<string, any> = {
        bitcoin: { usd: 65000, last_updated_at: 1700000000 },
        monacoin: { usd: 0.5, last_updated_at: 1700000000 }
    };
    const paprika: Record<string, any> = {
        'btc-bitcoin': { quotes: { USD: { price: 64950 } } },
        'foo-coin': { quotes: { USD: { price: 1.23 } } }
    };
    const fetchImpl = async (url: string) => {
        if (url.includes('/simple/price')) {
            const ids = (new URL(url).searchParams.get('ids') ?? '').split(',');
            const out: Record<string, any> = {};
            ids.forEach((id) => {
                if (gecko[id]) out[id] = gecko[id];
            });
            return jsonResponse(out);
        }
        if (url.includes('/tickers/')) {
            const id = decodeURIComponent(
                new URL(url).pathname.split('/tickers/')[1]
            );
            return paprika[id]
                ? jsonResponse(paprika[id])
                : jsonResponse({ error: 'x' }, false, 404);
        }
        throw new Error('unexpected url ' + url);
    };

    const { rows, servedBy, errors } = await collectPrices(
        order.map((n) => PROVIDERS[n]),
        idMaps,
        ['usd'],
        { now: 123, timeout: 1000, fetchImpl, providerOpts: {} }
    );

    assert.equal(errors.length, 0);
    assert.equal(rows.BTC.price, 65000);
    assert.equal(servedBy.BTC, 'coingecko'); // first provider wins
    assert.equal(servedBy.MONA, 'coingecko');
    assert.equal(rows.FOO.price, 1.23);
    assert.equal(servedBy.FOO, 'coinpaprika'); // gap filled by fallback
});

test('collectPrices: a provider that throws falls through to the next', async () => {
    const coins = upperKeyMap({
        BTC: { coingecko: 'bitcoin', coinpaprika: 'btc-bitcoin' },
        MONA: { coingecko: 'monacoin' } // coingecko-only
    });
    const order = ['coingecko', 'coinpaprika'];
    const symbols = gatherSymbols(order, coins, {});
    const idMaps = buildIdMaps(order, symbols, coins, {});

    const fetchImpl = async (url: string) => {
        if (url.includes('/simple/price')) throw new Error('network down');
        if (url.includes('/tickers/')) {
            const id = decodeURIComponent(
                new URL(url).pathname.split('/tickers/')[1]
            );
            return id === 'btc-bitcoin'
                ? jsonResponse({ quotes: { USD: { price: 64950 } } })
                : jsonResponse({ error: 'x' }, false, 404);
        }
        throw new Error('unexpected url ' + url);
    };

    const seenErrors: Array<[string, string]> = [];
    const { rows, servedBy, errors } = await collectPrices(
        order.map((n) => PROVIDERS[n]),
        idMaps,
        ['usd'],
        {
            now: 1,
            timeout: 1000,
            fetchImpl,
            providerOpts: {},
            onProviderError: (name, e) =>
                seenErrors.push([name, (e as Error).message])
        }
    );

    assert.equal(errors.length, 1);
    assert.equal(errors[0].provider, 'coingecko');
    assert.deepEqual(seenErrors, [['coingecko', 'network down']]);
    assert.equal(rows.BTC.price, 64950);
    assert.equal(servedBy.BTC, 'coinpaprika'); // fell through
    assert.equal(rows.MONA, undefined); // coingecko-only, stays unresolved
});
