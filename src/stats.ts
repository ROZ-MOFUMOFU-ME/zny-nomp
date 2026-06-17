import async from 'async';
import algos from 'stratum-pool/src/algoProperties.ts';
import type { Logger } from './logUtil.ts';
import { createRedisClient } from './redisUtil.ts';
import { parsePriceHash } from './priceProviders.ts';
import {
    sortObjectByProperty,
    roundTo,
    readableSeconds,
    readableHashRateString,
    sortBlocks,
    sortWorkersByHashrate
} from './statsUtil.ts';

export default function (
    this: any,
    logger: Logger,
    portalConfig: any,
    poolConfigs: any
) {
    var _this: any = this;

    var logSystem = 'Stats';

    var redisClients: any[] = [];
    var redisStats: any;

    this.statHistory = [];
    this.statPoolHistory = [];

    this.stats = {};
    this.statsString = '';

    // Latest coin prices, cached from the price feed (priceFeed:prices) on its
    // own timer and attached to each stats snapshot. Empty until the priceFeed
    // worker is enabled.
    this.priceData = { updated: null, count: 0, prices: {} };

    setupStatsRedis();
    gatherStatHistory();

    this.updatePriceData = function () {
        redisStats
            .hGetAll('priceFeed:prices')
            .then(function (raw: any) {
                return redisStats.get('priceFeed:lastUpdated').then(function (
                    ts: any
                ) {
                    var prices = parsePriceHash(raw);
                    _this.priceData = {
                        updated: ts ? parseInt(ts, 10) : null,
                        count: Object.keys(prices).length,
                        prices: prices
                    };
                });
            })
            .catch(function (err: any) {
                logger.error(
                    logSystem,
                    'Prices',
                    'price feed read failed: ' + (err && err.message)
                );
            });
    };
    this.updatePriceData();
    setInterval(
        function () {
            _this.updatePriceData();
        },
        Math.max(
            30,
            (portalConfig.priceFeed && portalConfig.priceFeed.updateInterval) ||
                300
        ) * 1000
    );

    var canDoStats = true;

    Object.keys(poolConfigs).forEach(function (coin) {
        if (!canDoStats) return;

        var poolConfig = poolConfigs[coin];
        var redisConfig = poolConfig.redis;

        for (var i = 0; i < redisClients.length; i++) {
            var client = redisClients[i];
            if (
                client.port === redisConfig.port &&
                client.host === redisConfig.host
            ) {
                client.coins.push(coin);
                return;
            }
        }
        redisClients.push({
            coins: [coin],
            host: redisConfig.host,
            port: redisConfig.port,
            client: createRedisClient(redisConfig, function (err: any) {
                logger.error(
                    logSystem,
                    'Redis',
                    'Stats redis client error: ' + JSON.stringify(err.message)
                );
            })
        });
    });

    function setupStatsRedis() {
        redisStats = createRedisClient(portalConfig.redis, function (err: any) {
            logger.error(
                logSystem,
                'Historics',
                'Redis client error: ' + JSON.stringify(err.message)
            );
        });
    }

    this.getBlocks = function (cback: (data: any) => void) {
        var allBlocks: any = {};
        async.each(
            _this.stats.pools,
            function (pool: any, pcb: any) {
                if (
                    _this.stats.pools[pool.name].pending &&
                    _this.stats.pools[pool.name].pending.blocks
                )
                    for (
                        var i = 0;
                        i < _this.stats.pools[pool.name].pending.blocks.length;
                        i++
                    )
                        allBlocks[
                            pool.name +
                                '-' +
                                _this.stats.pools[pool.name].pending.blocks[
                                    i
                                ].split(':')[2]
                        ] = _this.stats.pools[pool.name].pending.blocks[i];

                if (
                    _this.stats.pools[pool.name].confirmed &&
                    _this.stats.pools[pool.name].confirmed.blocks
                )
                    for (
                        var i = 0;
                        i <
                        _this.stats.pools[pool.name].confirmed.blocks.length;
                        i++
                    )
                        allBlocks[
                            pool.name +
                                '-' +
                                _this.stats.pools[pool.name].confirmed.blocks[
                                    i
                                ].split(':')[2]
                        ] = _this.stats.pools[pool.name].confirmed.blocks[i];

                pcb();
            },
            function (err: any) {
                cback(allBlocks);
            }
        );
    };

    function gatherStatHistory() {
        var retentionTime = (
            (Date.now() / 1000 -
                portalConfig.website.stats.historicalRetention) |
            0
        ).toString();
        redisStats
            .zRangeByScore('statHistory', retentionTime, '+inf')
            .then(function (replies: any) {
                for (var i = 0; i < replies.length; i++) {
                    _this.statHistory.push(JSON.parse(replies[i]));
                }
                _this.statHistory = _this.statHistory.sort(function (
                    a: any,
                    b: any
                ) {
                    return a.time - b.time;
                });
                _this.statHistory.forEach(function (stats: any) {
                    addStatPoolHistory(stats);
                });
            })
            .catch(function (err: any) {
                logger.error(
                    logSystem,
                    'Historics',
                    'Error when trying to grab historical stats ' +
                        JSON.stringify(err.message)
                );
            });
    }

    function getWorkerStats(address: any) {
        // NOTE: `statHistory`, `history`, `workers` and `stats` are referenced
        // below but never declared in scope — this function is dead code (never
        // assigned to `this`/called). Declared here as `any` so the file
        // type-checks under strict mode without altering runtime behavior.
        var statHistory: any, history: any, workers: any, stats: any;
        address = address.split('.')[0];
        if (address.length > 0 && address.startsWith('t')) {
            for (var h in statHistory) {
                for (var pool in statHistory[h].pools) {
                    statHistory[h].pools[pool].workers.sort(
                        sortWorkersByHashrate
                    );

                    for (var w in statHistory[h].pools[pool].workers) {
                        if (w.startsWith(address)) {
                            if (history[w] == null) {
                                history[w] = [];
                            }
                            if (
                                workers[w] == null &&
                                stats.pools[pool].workers[w] != null
                            ) {
                                workers[w] = stats.pools[pool].workers[w];
                            }
                            if (
                                statHistory[h].pools[pool].workers[w].hashrate
                            ) {
                                history[w].push({
                                    time: statHistory[h].time,
                                    hashrate:
                                        statHistory[h].pools[pool].workers[w]
                                            .hashrate
                                });
                            }
                        }
                    }
                }
            }
            return JSON.stringify({ workers: workers, history: history });
        }
        return null;
    }

    function addStatPoolHistory(stats: any) {
        var data: any = {
            time: stats.time,
            pools: {}
        };
        for (var pool in stats.pools) {
            data.pools[pool] = {
                hashrate: stats.pools[pool].hashrate,
                workerCount: stats.pools[pool].workerCount,
                blocks: stats.pools[pool].blocks
            };
        }
        _this.statPoolHistory.push(data);
    }

    var magnitude = 100000000;
    var coinPrecision = magnitude.toString().length - 1;

    var satoshisToCoins = function (satoshis: any) {
        return roundTo(satoshis / magnitude, coinPrecision);
    };

    var coinsToSatoshies = function (coins: any) {
        return Math.round(coins * magnitude);
    };

    function coinsRound(number: any) {
        return roundTo(number, coinPrecision);
    }

    this.getCoins = function (cback: () => void) {
        _this.stats.coins = redisClients[0].coins;
        cback();
    };

    this.getPayout = function (address: any, cback: (data: any) => void) {
        async.waterfall(
            [
                function (callback: any) {
                    _this.getBalanceByAddress(address, function () {
                        callback(null, 'test');
                    });
                }
            ],
            function (err: any, total: any) {
                cback(coinsRound(total).toFixed(8));
            }
        );
    };

    this.getTotalSharesByAddress = function (
        address: any,
        cback: (data: any) => void
    ) {
        var a = address.split('.')[0];
        var client = redisClients[0].client;

        var pools = _this.stats.pools;
        if (!pools || Object.keys(pools).length === 0) {
            // Stats not gathered yet (e.g. just after startup) — nothing to sum.
            cback(0);
            return;
        }

        var totalShares = parseFloat('0' as any);
        async.each(
            pools,
            function (pool: any, pcb: any) {
                var coin = String(pools[pool.name].name);
                client
                    .hScan(coin + ':shares:roundCurrent', '0', {
                        MATCH: a + '*',
                        COUNT: 1000
                    })
                    .then(function (result: any) {
                        var shares = 0;
                        result.entries.forEach(function (entry: any) {
                            shares += parseFloat(entry.value);
                        });
                        if (shares > 0) {
                            totalShares = shares;
                        }
                        pcb();
                    })
                    .catch(function (error: any) {
                        pcb(error);
                    });
            },
            function (err: any) {
                // Always invoke the callback — even on error or when no pool had
                // shares — otherwise the worker_stats request hangs and the page
                // never populates.
                cback(err ? 0 : totalShares);
            }
        );
    };

    this.getBalanceByAddress = function (
        address: any,
        cback: (data: any) => void
    ) {
        var a = address.split('.')[0];

        var client = redisClients[0].client,
            balances: any[] = [];

        var totalHeld = parseFloat('0' as any);
        var totalPaid = parseFloat('0' as any);
        var totalImmature = parseFloat('0' as any);

        var pools = _this.stats.pools;
        if (!pools || Object.keys(pools).length === 0) {
            // Stats not gathered yet — still set the address so the page renders.
            _this.stats.address = address;
            cback({
                totalHeld: 0,
                totalPaid: 0,
                totalImmature: 0,
                balances: []
            });
            return;
        }

        async.each(
            pools,
            function (pool: any, pcb: any) {
                var coin = String(pools[pool.name].name);
                var scanOptions = { MATCH: a + '*', COUNT: 10000 };
                Promise.all([
                    // immature balances, balances and payouts for address
                    client.hScan(coin + ':immature', '0', scanOptions),
                    client.hScan(coin + ':balances', '0', scanOptions),
                    client.hScan(coin + ':payouts', '0', scanOptions)
                ])
                    .then(function (results: any) {
                        var pends = results[0].entries;
                        var bals = results[1].entries;
                        var pays = results[2].entries;

                        var workers: any = {};

                        pays.forEach(function (entry: any) {
                            var workerName = String(entry.field);
                            workers[workerName] = workers[workerName] || {};
                            var paidAmount = parseFloat(entry.value);
                            workers[workerName].paid = coinsRound(paidAmount);
                            totalPaid += paidAmount;
                        });
                        bals.forEach(function (entry: any) {
                            var workerName = String(entry.field);
                            workers[workerName] = workers[workerName] || {};
                            var balAmount = parseFloat(entry.value);
                            workers[workerName].balance = coinsRound(balAmount);
                            totalHeld += balAmount;
                        });
                        pends.forEach(function (entry: any) {
                            var workerName = String(entry.field);
                            workers[workerName] = workers[workerName] || {};
                            var pendingAmount = parseFloat(entry.value);
                            workers[workerName].immature =
                                coinsRound(pendingAmount);
                            totalImmature += pendingAmount;
                        });

                        for (var w in workers) {
                            balances.push({
                                worker: String(w),
                                balance: workers[w].balance,
                                paid: workers[w].paid,
                                immature: workers[w].immature
                            });
                        }

                        pcb();
                    })
                    .catch(function (error: any) {
                        pcb(error);
                    });
            },
            function (err: any) {
                // Read by the miner_stats template to render the page — always set.
                _this.stats.address = address;

                if (err) {
                    // Don't hang the request on a Redis error (this previously
                    // called an undefined `callback`, throwing and hanging) —
                    // return empty balances so the page still renders.
                    cback({
                        totalHeld: 0,
                        totalPaid: 0,
                        totalImmature: 0,
                        balances: []
                    });
                    return;
                }

                _this.stats.balances = balances;

                cback({
                    totalHeld: coinsRound(totalHeld),
                    totalPaid: coinsRound(totalPaid),
                    totalImmature: satoshisToCoins(totalImmature),
                    balances
                });
            }
        );
    };

    this.getGlobalStats = function (callback: () => void) {
        var statGatherTime = (Date.now() / 1000) | 0;

        var allCoinStats: any = {};

        async.each(
            redisClients,
            function (client: any, callback: any) {
                var windowTime = (
                    (Date.now() / 1000 -
                        portalConfig.website.stats.hashrateWindow) |
                    0
                ).toString();
                /* 13 commands per coin; the reply offsets (i + 0 .. i + 12)
                   below depend on this exact order */
                var commandsPerCoin = 13;

                var multi = client.client.multi();
                client.coins.forEach(function (coin: any) {
                    multi
                        .zRemRangeByScore(
                            coin + ':hashrate',
                            '-inf',
                            '(' + windowTime
                        )
                        .zRangeByScore(coin + ':hashrate', windowTime, '+inf')
                        .hGetAll(coin + ':stats')
                        .sCard(coin + ':blocksPending')
                        .sCard(coin + ':blocksConfirmed')
                        .sCard(coin + ':blocksKicked')
                        .sMembers(coin + ':blocksPending')
                        .sMembers(coin + ':blocksConfirmed')
                        .hGetAll(coin + ':shares:roundCurrent')
                        .hGetAll(coin + ':blocksPendingConfirms')
                        .zRange(coin + ':payments', -100, -1)
                        .hGetAll(coin + ':shares:timesCurrent')
                        // i+12: PPS accrual stats (float/paused/accruedTotal/
                        // sharePPS); empty hash for non-PPS coins.
                        .hGetAll(coin + ':pps:stats');
                });

                multi
                    .exec()
                    .catch(function (err: any) {
                        logger.error(
                            logSystem,
                            'Global',
                            'error with getting global stats ' +
                                JSON.stringify(err.message)
                        );
                        callback(err);
                        return null;
                    })
                    .then(function (replies: any) {
                        if (replies) {
                            for (
                                var i = 0;
                                i < replies.length;
                                i += commandsPerCoin
                            ) {
                                var coinName =
                                    client.coins[(i / commandsPerCoin) | 0];
                                var marketStats: any = {};
                                if (replies[i + 2]) {
                                    if (replies[i + 2].coinmarketcap) {
                                        marketStats = replies[i + 2]
                                            ? JSON.parse(
                                                  replies[i + 2].coinmarketcap
                                              )[0] || 0
                                            : 0;
                                    }
                                }
                                var rewardRecipients =
                                    poolConfigs[coinName].rewardRecipients ||
                                    {};
                                // Pool fee (%) = sum of reward-recipient shares,
                                // surfaced in /api/stats so aggregators
                                // (MiningPoolStats etc.) can show the fee.
                                var poolFeePercent = Object.keys(
                                    rewardRecipients
                                ).reduce(function (sum: number, addr: string) {
                                    return (
                                        sum +
                                        (Number(rewardRecipients[addr]) || 0)
                                    );
                                }, 0);
                                var coinStats: any = {
                                    name: coinName,
                                    fee: poolFeePercent,
                                    blockTime:
                                        poolConfigs[coinName].coin.blockTime,
                                    symbol: poolConfigs[
                                        coinName
                                    ].coin.symbol.toUpperCase(),
                                    algorithm:
                                        poolConfigs[coinName].coin.algorithm,
                                    hashrates: replies[i + 1],
                                    poolStats: {
                                        validShares: replies[i + 2]
                                            ? replies[i + 2].validShares || 0
                                            : 0,
                                        validBlocks: replies[i + 2]
                                            ? replies[i + 2].validBlocks || 0
                                            : 0,
                                        invalidShares: replies[i + 2]
                                            ? replies[i + 2].invalidShares || 0
                                            : 0,
                                        totalPaid: replies[i + 2]
                                            ? replies[i + 2].totalPaid || 0
                                            : 0,
                                        networkBlocks: replies[i + 2]
                                            ? replies[i + 2].networkBlocks || 0
                                            : 0,
                                        networkHash: replies[i + 2]
                                            ? replies[i + 2].networkHash || 0
                                            : 0,
                                        networkHashString:
                                            readableHashRateString(
                                                replies[i + 2]
                                                    ? replies[i + 2]
                                                          .networkHash || 0
                                                    : 0
                                            ),
                                        networkDiff: replies[i + 2]
                                            ? replies[i + 2].networkDiff || 0
                                            : 0,
                                        networkConnections: replies[i + 2]
                                            ? replies[i + 2]
                                                  .networkConnections || 0
                                            : 0,
                                        networkVersion: replies[i + 2]
                                            ? replies[i + 2]
                                                  .networkSubVersion ||
                                              replies[i + 2].networkVersion
                                            : 0,
                                        networkProtocolVersion: replies[i + 2]
                                            ? replies[i + 2]
                                                  .networkProtocolVersion || 0
                                            : 0
                                    },
                                    marketStats: marketStats,
                                    /* block stat counts */
                                    blocks: {
                                        pending: replies[i + 3],
                                        confirmed: replies[i + 4],
                                        orphaned: replies[i + 5]
                                    },
                                    /* show all pending blocks */
                                    pending: {
                                        blocks: replies[i + 6].sort(sortBlocks),
                                        confirms: replies[i + 9] || {}
                                    },
                                    /* show last 50 found blocks */
                                    confirmed: {
                                        blocks: replies[i + 7]
                                            .sort(sortBlocks)
                                            .slice(0, 50)
                                    },
                                    payments: [],
                                    currentRoundShares: replies[i + 8] || {},
                                    currentRoundTimes: replies[i + 11] || {},
                                    maxRoundTime: 0,
                                    shareCount: 0
                                };
                                for (
                                    var j = replies[i + 10].length;
                                    j > 0;
                                    j--
                                ) {
                                    var jsonObj;
                                    try {
                                        jsonObj = JSON.parse(
                                            replies[i + 10][j - 1]
                                        );
                                    } catch (e) {
                                        jsonObj = null;
                                    }
                                    if (jsonObj !== null) {
                                        coinStats.payments.push(jsonObj);
                                    }
                                }
                                // PPS monitoring (meaningful only when
                                // paymentMode=pps): float at last accrual, the
                                // kill-switch paused flag, lifetime accrued, and
                                // the latest per-diff-unit share value. Zero for
                                // other modes. Liability = live balances total,
                                // already surfaced through miner balances.
                                var ppsReply = replies[i + 12] || {};
                                coinStats.pps = {
                                    mode:
                                        (
                                            poolConfigs[coinName]
                                                .paymentProcessing || {}
                                        ).paymentMode || 'prop',
                                    float: parseFloat(ppsReply.float) || 0,
                                    paused: ppsReply.paused === '1' ? 1 : 0,
                                    accruedTotal:
                                        parseFloat(ppsReply.accruedTotal) || 0,
                                    sharePPS: parseFloat(ppsReply.sharePPS) || 0
                                };
                                allCoinStats[coinStats.name] = coinStats;
                            }
                            // sort pools alphabetically
                            allCoinStats = sortObjectByProperty(
                                allCoinStats,
                                'name',
                                false,
                                false
                            );
                            callback();
                        }
                    });
            },
            function (err: any) {
                if (err) {
                    logger.error(
                        logSystem,
                        'Global',
                        'error getting all stats' + JSON.stringify(err)
                    );
                    callback();
                    return;
                }

                var portalStats: any = {
                    time: statGatherTime,
                    global: {
                        workers: 0,
                        hashrate: 0
                    },
                    algos: {},
                    pools: allCoinStats
                };

                Object.keys(allCoinStats).forEach(function (coin) {
                    var coinStats = allCoinStats[coin];
                    coinStats.workers = {};
                    coinStats.miners = {};
                    coinStats.shares = 0;
                    coinStats.hashrates.forEach(function (ins: any) {
                        var parts = ins.split(':');
                        var workerShares = parseFloat(parts[0]);
                        var miner = parts[1].split('.')[0];
                        var worker = parts[1];
                        var diff = Math.round(parts[0] * 8192);
                        if (workerShares > 0) {
                            coinStats.shares += workerShares;
                            // build worker stats
                            if (worker in coinStats.workers) {
                                coinStats.workers[worker].shares +=
                                    workerShares;
                                coinStats.workers[worker].diff = diff;
                            } else {
                                coinStats.workers[worker] = {
                                    name: worker,
                                    diff: diff,
                                    shares: workerShares,
                                    invalidshares: 0,
                                    currRoundShares: 0,
                                    currRoundTime: 0,
                                    hashrate: null,
                                    hashrateString: null,
                                    luckDays: null,
                                    luckHours: null,
                                    paid: 0,
                                    balance: 0
                                };
                            }
                            // build miner stats
                            if (miner in coinStats.miners) {
                                coinStats.miners[miner].shares += workerShares;
                            } else {
                                coinStats.miners[miner] = {
                                    name: miner,
                                    shares: workerShares,
                                    invalidshares: 0,
                                    currRoundShares: 0,
                                    currRoundTime: 0,
                                    hashrate: null,
                                    hashrateString: null,
                                    luckDays: null,
                                    luckHours: null
                                };
                            }
                        } else {
                            // build worker stats
                            if (worker in coinStats.workers) {
                                coinStats.workers[worker].invalidshares -=
                                    workerShares; // workerShares is negative number!
                                coinStats.workers[worker].diff = diff;
                            } else {
                                coinStats.workers[worker] = {
                                    name: worker,
                                    diff: diff,
                                    shares: 0,
                                    invalidshares: -workerShares,
                                    currRoundShares: 0,
                                    currRoundTime: 0,
                                    hashrate: null,
                                    hashrateString: null,
                                    luckDays: null,
                                    luckHours: null,
                                    paid: 0,
                                    balance: 0
                                };
                            }
                            // build miner stats
                            if (miner in coinStats.miners) {
                                coinStats.miners[miner].invalidshares -=
                                    workerShares; // workerShares is negative number!
                            } else {
                                coinStats.miners[miner] = {
                                    name: miner,
                                    shares: 0,
                                    invalidshares: -workerShares,
                                    currRoundShares: 0,
                                    currRoundTime: 0,
                                    hashrate: null,
                                    hashrateString: null,
                                    luckDays: null,
                                    luckHours: null
                                };
                            }
                        }
                    });

                    // sort miners
                    coinStats.miners = sortObjectByProperty(
                        coinStats.miners,
                        'shares',
                        true,
                        true
                    );

                    var shareMultiplier =
                        Math.pow(2, 32) /
                        (algos as any)[coinStats.algorithm].multiplier;
                    coinStats.hashrate =
                        (shareMultiplier * coinStats.shares) /
                        portalConfig.website.stats.hashrateWindow;
                    coinStats.hashrateString = _this.getReadableHashRateString(
                        coinStats.hashrate
                    );

                    var _blocktime = coinStats.blockTime || 90;
                    var _networkHashRate = parseFloat(
                        coinStats.poolStats.networkHash
                    );
                    coinStats.luckDays = (
                        ((_networkHashRate / coinStats.hashrate) * _blocktime) /
                        (24 * 60 * 60)
                    ).toFixed(3);
                    coinStats.luckHours = (
                        ((_networkHashRate / coinStats.hashrate) * _blocktime) /
                        (60 * 60)
                    ).toFixed(3);
                    coinStats.luckMinute = (
                        ((_networkHashRate / coinStats.hashrate) * _blocktime) /
                        60
                    ).toFixed(3);
                    coinStats.minerCount = Object.keys(coinStats.miners).length;
                    coinStats.workerCount = Object.keys(
                        coinStats.workers
                    ).length;
                    portalStats.global.workers += coinStats.workerCount;

                    /* algorithm specific global stats */
                    var algo = coinStats.algorithm;
                    if (!portalStats.algos.hasOwnProperty(algo)) {
                        portalStats.algos[algo] = {
                            workers: 0,
                            hashrate: 0,
                            hashrateString: null
                        };
                    }
                    portalStats.algos[algo].hashrate += coinStats.hashrate;
                    portalStats.algos[algo].workers += Object.keys(
                        coinStats.workers
                    ).length;

                    var _shareTotal = parseFloat('0' as any);
                    var _maxTimeShare = parseFloat('0' as any);
                    for (var worker in coinStats.currentRoundShares) {
                        var miner = worker.split('.')[0];
                        if (miner in coinStats.miners) {
                            coinStats.miners[miner].currRoundShares +=
                                parseFloat(
                                    coinStats.currentRoundShares[worker]
                                );
                        }
                        if (worker in coinStats.workers) {
                            coinStats.workers[worker].currRoundShares +=
                                parseFloat(
                                    coinStats.currentRoundShares[worker]
                                );
                        }
                        _shareTotal += parseFloat(
                            coinStats.currentRoundShares[worker]
                        );
                    }
                    for (var worker in coinStats.currentRoundTimes) {
                        var time = parseFloat(
                            coinStats.currentRoundTimes[worker]
                        );
                        if (_maxTimeShare < time) _maxTimeShare = time;

                        var miner = worker.split('.')[0];
                        if (miner in coinStats.miners) {
                            coinStats.miners[miner].currRoundTime += parseFloat(
                                coinStats.currentRoundTimes[worker]
                            );
                        }
                    }

                    coinStats.shareCount = _shareTotal;
                    coinStats.maxRoundTime = _maxTimeShare;
                    coinStats.maxRoundTimeString =
                        readableSeconds(_maxTimeShare);

                    for (var worker in coinStats.workers) {
                        var _workerRate =
                            (shareMultiplier *
                                coinStats.workers[worker].shares) /
                            portalConfig.website.stats.hashrateWindow;
                        coinStats.workers[worker].luckDays = (
                            ((_networkHashRate / _workerRate) * _blocktime) /
                            (24 * 60 * 60)
                        ).toFixed(3);
                        coinStats.workers[worker].luckHours = (
                            ((_networkHashRate / _workerRate) * _blocktime) /
                            (60 * 60)
                        ).toFixed(3);
                        coinStats.workers[worker].luckMinute = (
                            ((_networkHashRate / _workerRate) * _blocktime) /
                            60
                        ).toFixed(3);
                        coinStats.workers[worker].hashrate = _workerRate;
                        coinStats.workers[worker].hashrateString =
                            _this.getReadableHashRateString(_workerRate);
                    }
                    for (var miner in coinStats.miners) {
                        var _workerRate =
                            (shareMultiplier * coinStats.miners[miner].shares) /
                            portalConfig.website.stats.hashrateWindow;
                        coinStats.miners[miner].luckDays = (
                            ((_networkHashRate / _workerRate) * _blocktime) /
                            (24 * 60 * 60)
                        ).toFixed(3);
                        coinStats.miners[miner].luckHours = (
                            ((_networkHashRate / _workerRate) * _blocktime) /
                            (60 * 60)
                        ).toFixed(3);
                        coinStats.miners[miner].luckMinute = (
                            ((_networkHashRate / _workerRate) * _blocktime) /
                            60
                        ).toFixed(3);
                        coinStats.miners[miner].hashrate = _workerRate;
                        coinStats.miners[miner].hashrateString =
                            _this.getReadableHashRateString(_workerRate);
                    }

                    // sort workers by name
                    coinStats.workers = sortObjectByProperty(
                        coinStats.workers,
                        'name',
                        false,
                        false
                    );

                    delete coinStats.hashrates;
                    delete coinStats.shares;
                });

                Object.keys(portalStats.algos).forEach(function (algo) {
                    var algoStats = portalStats.algos[algo];
                    algoStats.hashrateString = _this.getReadableHashRateString(
                        algoStats.hashrate
                    );
                });

                _this.stats = portalStats;

                // save historical hashrate, not entire stats!
                var saveStats = JSON.parse(JSON.stringify(portalStats));
                Object.keys(saveStats.pools).forEach(function (pool) {
                    delete saveStats.pools[pool].pending;
                    delete saveStats.pools[pool].confirmed;
                    delete saveStats.pools[pool].currentRoundShares;
                    delete saveStats.pools[pool].currentRoundTimes;
                    delete saveStats.pools[pool].payments;
                    delete saveStats.pools[pool].miners;
                });
                _this.statsString = JSON.stringify(saveStats);
                _this.statHistory.push(saveStats);

                // Attach the latest cached prices to the live stats object.
                // Kept out of saveStats/statsString so history stays lean; the
                // website template and the live SSE read portalStats.prices.
                portalStats.prices = _this.priceData;

                addStatPoolHistory(portalStats);

                var retentionTime =
                    (Date.now() / 1000 -
                        portalConfig.website.stats.historicalRetention) |
                    0;

                for (var i = 0; i < _this.statHistory.length; i++) {
                    if (retentionTime < _this.statHistory[i].time) {
                        if (i > 0) {
                            _this.statHistory = _this.statHistory.slice(i);
                            _this.statPoolHistory =
                                _this.statPoolHistory.slice(i);
                        }
                        break;
                    }
                }

                redisStats
                    .multi()
                    .zAdd('statHistory', {
                        score: statGatherTime,
                        value: _this.statsString
                    })
                    .zRemRangeByScore(
                        'statHistory',
                        '-inf',
                        '(' + retentionTime
                    )
                    .exec()
                    .catch(function (err: any) {
                        logger.error(
                            logSystem,
                            'Historics',
                            'Error adding stats to historics ' +
                                JSON.stringify(err.message)
                        );
                    });
                callback();
            }
        );
    };

    this.getReadableHashRateString = readableHashRateString;
}
