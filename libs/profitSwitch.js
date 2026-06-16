import net from 'net';
import async from 'async';
import * as Stratum from 'stratum-pool';
import * as StratumUtil from 'stratum-pool/lib/util.js';
import { createRedisClient } from './redisUtil.js';
import { parsePriceHash } from './priceProviders.ts';
import { rankProfitability, decideSwitches } from './profitSwitchLogic.ts';

/*
 * Profit switching, driven by the live price feed.
 *
 * Replaces the removed exchange-price modules (Bittrex/Poloniex/...). Each
 * cycle it reads coin prices from Redis (priceFeed:prices, populated by the
 * priceFeed worker), asks each candidate coin's daemon for the current network
 * difficulty and block reward, scores every coin by expected value per unit of
 * hashrate, and switches each enabled `switching` entry to the most profitable
 * coin of its algorithm via the validated CLI `coinswitch` path.
 *
 * Disabled by default; needs portalConfig.profitSwitch.enabled AND the price
 * feed running. Safe no-op when prices or daemons are unavailable.
 */

// difficulty-1 target (matches stratum-pool/lib/algoProperties.js diff1).
const DIFF1 = BigInt(
    '0x00000000ffff0000000000000000000000000000000000000000000000000000'
);

export default function (logger) {
    const portalConfig = JSON.parse(process.env.portalConfig);
    const poolConfigs = JSON.parse(process.env.pools);
    const logSystem = 'Profit';
    const cfg = portalConfig.profitSwitch || {};

    // Switchable algorithms = algorithms of enabled `switching` entries.
    const switching = portalConfig.switching || {};
    const switchAlgos = new Set();
    Object.keys(switching).forEach(function (name) {
        if (switching[name] && switching[name].enabled)
            switchAlgos.add(switching[name].algorithm);
    });
    if (switchAlgos.size === 0) {
        logger.debug(
            logSystem,
            'Config',
            'No enabled switching entries; profit switching disabled.'
        );
        return;
    }

    // Candidate coins = pool coins whose algorithm is switchable.
    const coinsByAlgo = {};
    const coinMeta = {};
    Object.keys(poolConfigs).forEach(function (name) {
        const coin = poolConfigs[name].coin;
        if (!coin || !switchAlgos.has(coin.algorithm)) return;
        (coinsByAlgo[coin.algorithm] = coinsByAlgo[coin.algorithm] || []).push(
            name
        );
        coinMeta[name] = {
            symbol: coin.symbol ? String(coin.symbol).toUpperCase() : null,
            algorithm: coin.algorithm,
            daemon:
                poolConfigs[name].paymentProcessing &&
                poolConfigs[name].paymentProcessing.daemon
        };
    });
    const activeAlgos = Object.keys(coinsByAlgo).filter(function (a) {
        return coinsByAlgo[a].length >= 2;
    });
    if (activeAlgos.length === 0) {
        logger.debug(
            logSystem,
            'Config',
            'No algorithm has 2+ coins to switch between; profit switching disabled.'
        );
        return;
    }

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

    const updateInterval = Math.max(30, cfg.updateInterval || 600) * 1000;
    const threshold = cfg.threshold || 1.0;
    const cliPort = portalConfig.cliPort;

    const getDaemonInfo = function (name, callback) {
        const meta = coinMeta[name];
        if (!meta.daemon) {
            callback(null, null);
            return;
        }
        const daemon = new Stratum.daemon.interface([meta.daemon], function (
            severity,
            message
        ) {
            logger[severity](logSystem, name, message);
        });
        daemon.cmd(
            'getblocktemplate',
            [{ capabilities: ['coinbasetxn', 'workid', 'coinbase/append'] }],
            function (result) {
                if (
                    !result ||
                    !result[0] ||
                    result[0].error ||
                    !result[0].response
                ) {
                    logger.warning(
                        logSystem,
                        name,
                        'getblocktemplate failed: ' +
                            JSON.stringify(
                                result && result[0] && result[0].error
                            )
                    );
                    callback(null, null); // tolerate per-coin failure
                    return;
                }
                const resp = result[0].response;
                let target;
                try {
                    target = resp.target
                        ? BigInt('0x' + resp.target)
                        : StratumUtil.bignumFromBitsHex(resp.bits);
                } catch (_e) {
                    callback(null, null);
                    return;
                }
                if (!(target > 0n)) {
                    callback(null, null);
                    return;
                }
                callback(null, {
                    difficulty: Number(DIFF1) / Number(target),
                    reward: (resp.coinbasevalue || 0) / 1e8
                });
            }
        );
    };

    // Trigger a switch through the validated CLI path (processCoinSwitchCommand
    // in init.js broadcasts the coinswitch IPC to the pool workers).
    const sendSwitch = function (coin, algo) {
        const payload =
            JSON.stringify({
                command: 'coinswitch',
                params: [coin],
                options: { algorithm: algo }
            }) + '\n';
        const client = net.connect(cliPort, '127.0.0.1', function () {
            client.write(payload);
        });
        client.on('data', function (d) {
            logger.debug(
                logSystem,
                'Switch',
                'coinswitch ' + coin + ' (' + algo + '): ' + d.toString().trim()
            );
            client.end();
        });
        client.on('error', function (e) {
            logger.error(
                logSystem,
                'Switch',
                'Failed to reach CLI port ' + cliPort + ': ' + (e && e.message)
            );
        });
    };

    const roundScores = function (scores) {
        const o = {};
        Object.keys(scores).forEach(function (k) {
            o[k] = Number(scores[k].toPrecision(6));
        });
        return o;
    };

    this.runOnce = function (done) {
        done = done || function () {};
        redis
            .hGetAll('priceFeed:prices')
            .then(function (raw) {
                const prices = parsePriceHash(raw);
                if (Object.keys(prices).length === 0)
                    logger.warning(
                        logSystem,
                        'Prices',
                        'priceFeed:prices is empty — is the priceFeed worker enabled?'
                    );
                return redis.hGetAll('proxyState').then(function (state) {
                    const currentByAlgo = state || {};
                    const names = [];
                    activeAlgos.forEach(function (a) {
                        coinsByAlgo[a].forEach(function (n) {
                            names.push(n);
                        });
                    });
                    async.map(
                        names,
                        function (name, cb) {
                            getDaemonInfo(name, function (_e, info) {
                                cb(null, { name: name, info: info });
                            });
                        },
                        function (_err, results) {
                            const table = {};
                            results.forEach(function (r) {
                                if (!r.info) return;
                                const meta = coinMeta[r.name];
                                const row = meta.symbol
                                    ? prices[meta.symbol]
                                    : null;
                                const price =
                                    row && typeof row.price === 'number'
                                        ? row.price
                                        : null;
                                (table[meta.algorithm] =
                                    table[meta.algorithm] || {})[r.name] = {
                                    symbol: meta.symbol,
                                    difficulty: r.info.difficulty,
                                    reward: r.info.reward,
                                    price: price
                                };
                            });

                            const ranking = rankProfitability(table);
                            Object.keys(ranking).forEach(function (algo) {
                                logger.debug(
                                    logSystem,
                                    'Rank',
                                    algo +
                                        ' best=' +
                                        ranking[algo].coin +
                                        ' scores=' +
                                        JSON.stringify(
                                            roundScores(ranking[algo].scores)
                                        )
                                );
                            });

                            const actions = decideSwitches(
                                ranking,
                                currentByAlgo,
                                switching,
                                threshold
                            );
                            if (actions.length === 0) {
                                logger.debug(
                                    logSystem,
                                    'Switch',
                                    'No profitable switch this cycle.'
                                );
                            } else {
                                actions.forEach(function (a) {
                                    logger.info(
                                        logSystem,
                                        'Switch',
                                        'Switching ' +
                                            a.switchName +
                                            ' (' +
                                            a.algo +
                                            ') to ' +
                                            a.coin
                                    );
                                    sendSwitch(a.coin, a.algo);
                                });
                            }
                            done();
                        }
                    );
                });
            })
            .catch(function (err) {
                logger.error(
                    logSystem,
                    'Redis',
                    'Read failed: ' + (err && err.message)
                );
                done(err);
            });
    };

    const self = this;
    logger.debug(
        logSystem,
        'Config',
        'Profit switching active for [' +
            activeAlgos.join(', ') +
            '] every ' +
            updateInterval / 1000 +
            's (threshold ' +
            threshold +
            ')'
    );
    this.runOnce();
    this._timer = setInterval(function () {
        self.runOnce();
    }, updateInterval);
}
