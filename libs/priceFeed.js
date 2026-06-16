import { createRedisClient, execCommands } from './redisUtil.ts';
import {
    PROVIDERS,
    DEFAULT_PROVIDER_ORDER,
    parseVsCurrencies,
    upperKeyMap,
    gatherSymbols,
    buildIdMaps,
    collectPrices
} from './priceProviders.ts';

/*
 * Real-time price feed worker.
 *
 * Polls one or more price providers (CoinGecko, CoinPaprika, ...) on an
 * interval, with per-symbol fallback, and stores the latest prices in Redis so
 * the rest of the portal (stats, website, profit switching, payout-time price
 * recording) reads a single source of truth:
 *
 *   priceFeed:prices       HASH   SYMBOL -> JSON row (see priceProviders.js)
 *   priceFeed:lastUpdated  STRING epoch-ms of the last successful store
 *
 * Disabled by default; configured via the `priceFeed` block in the portal
 * config. Coins map to provider ids via priceFeed.coins or a provider-named
 * field on a coin profile (coin.coingecko / coin.coinpaprika).
 */
export default function (logger) {
    const _this = this;
    const portalConfig = JSON.parse(process.env.portalConfig);
    const poolConfigs = JSON.parse(process.env.pools);
    const logSystem = 'PriceFeed';
    const cfg = portalConfig.priceFeed || {};

    // Provider priority order: configured (or default), filtered to providers
    // we know and that have a key if they require one.
    const order = (
        Array.isArray(cfg.providers) && cfg.providers.length
            ? cfg.providers
            : DEFAULT_PROVIDER_ORDER
    ).filter(function (n) {
        const p = PROVIDERS[n];
        if (!p) {
            logger.warning(
                logSystem,
                'Config',
                'Unknown price provider "' + n + '" ignored'
            );
            return false;
        }
        if (p.needsKey && !(cfg[n] && cfg[n].apiKey)) {
            logger.warning(
                logSystem,
                'Config',
                'Provider "' + n + '" needs an apiKey; skipped'
            );
            return false;
        }
        return true;
    });
    if (order.length === 0) {
        logger.warning(
            logSystem,
            'Config',
            'No usable price providers configured; price feed idle.'
        );
        return;
    }

    // SYMBOL -> coin profile (so coin.coingecko / coin.coinpaprika are usable).
    const coinProfiles = {};
    Object.keys(poolConfigs).forEach(function (coin) {
        const c = poolConfigs[coin] && poolConfigs[coin].coin;
        if (c && c.symbol) coinProfiles[String(c.symbol).toUpperCase()] = c;
    });

    const coinsCfg = upperKeyMap(cfg.coins);
    const vsList = parseVsCurrencies(cfg.vsCurrency || 'usd');
    const symbols = gatherSymbols(order, coinsCfg, coinProfiles);
    if (symbols.length === 0) {
        logger.warning(
            logSystem,
            'Config',
            'No coins mapped to a provider id (set priceFeed.coins or a coin profile id field); price feed idle.'
        );
        return;
    }
    const idMaps = buildIdMaps(order, symbols, coinsCfg, coinProfiles);
    const orderedProviders = order.map(function (n) {
        return PROVIDERS[n];
    });

    const updateInterval = Math.max(30, cfg.updateInterval || 300) * 1000;
    const timeout = cfg.timeout || 15000;

    const redisConfig =
        portalConfig.redis ||
        (portalConfig.defaultPoolConfigs &&
            portalConfig.defaultPoolConfigs.redis);
    const redis = createRedisClient(redisConfig, function (err) {
        logger.error(
            logSystem,
            'Redis',
            'Connection error: ' + (err && err.message)
        );
    });

    this.update = async function () {
        const now = Date.now();
        const result = await collectPrices(orderedProviders, idMaps, vsList, {
            now: now,
            timeout: timeout,
            fetchImpl: globalThis.fetch,
            providerOpts: cfg,
            onProviderError: function (name, e) {
                logger.warning(
                    logSystem,
                    name,
                    'Provider request failed: ' + (e && e.message)
                );
            },
            onItemError: function (name, sym, e) {
                logger.debug(
                    logSystem,
                    name,
                    sym + ' fetch failed: ' + (e && e.message)
                );
            }
        });

        const rows = result.rows;
        const syms = Object.keys(rows);
        if (syms.length === 0) {
            logger.warning(
                logSystem,
                'Update',
                'No prices retrieved from any provider' +
                    (result.errors.length
                        ? ' (' +
                          result.errors
                              .map(function (e) {
                                  return e.provider;
                              })
                              .join(', ') +
                          ' failed)'
                        : '')
            );
            return;
        }

        const hset = ['hset', 'priceFeed:prices'];
        syms.forEach(function (s) {
            hset.push(s, JSON.stringify(rows[s]));
        });
        try {
            await execCommands(redis, [
                hset,
                ['set', 'priceFeed:lastUpdated', String(now)]
            ]);
        } catch (e) {
            logger.error(
                logSystem,
                'Redis',
                'Failed to store prices: ' + (e && e.message)
            );
            return;
        }

        // Summarise: how many from each provider, and anything still missing.
        const bySrc = {};
        syms.forEach(function (s) {
            const src = result.servedBy[s];
            (bySrc[src] = bySrc[src] || []).push(s);
        });
        const unresolved = symbols.filter(function (s) {
            return !rows[s];
        });
        logger.debug(
            logSystem,
            'Update',
            'Stored ' +
                syms.length +
                ' price(s) [' +
                Object.keys(bySrc)
                    .map(function (p) {
                        return p + ': ' + bySrc[p].length;
                    })
                    .join(', ') +
                ']' +
                (unresolved.length
                    ? '; unresolved: ' + unresolved.join(', ')
                    : '')
        );
    };

    logger.debug(
        logSystem,
        'Config',
        'Providers [' +
            order.join(' > ') +
            '] tracking ' +
            symbols.length +
            ' coin(s) in ' +
            vsList.join('/') +
            ' every ' +
            updateInterval / 1000 +
            's'
    );
    this.update();
    this._timer = setInterval(function () {
        _this.update();
    }, updateInterval);
}
