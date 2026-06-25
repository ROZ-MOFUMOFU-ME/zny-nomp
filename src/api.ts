import stats from './stats.ts';
import { createRedisClient } from './redisUtil.ts';
import { parsePriceHash } from './priceProviders.ts';
import { renderMetrics } from './metrics.ts';
import { buildHealth } from './health.ts';
import type { Logger } from './logUtil.ts';
import type { Request, Response, NextFunction } from 'express';

export default function (
    this: any,
    logger: Logger,
    portalConfig: any,
    poolConfigs: any
) {
    var _this = this;

    var portalStats = (this.stats = new (stats as any)(
        logger,
        portalConfig,
        poolConfigs
    ));

    this.liveStatConnections = {};

    // Redis client for the API: reads the price feed the priceFeed worker
    // publishes (priceFeed:prices / priceFeed:lastUpdated) and reads/writes the
    // admin-editable site announcement ('announcement').
    var priceClient = createRedisClient(
        portalConfig.redis,
        function (err: any) {
            logger.error(
                'API',
                'prices',
                'Redis error: ' + (err && err.message)
            );
        }
    );

    this.getPrices = function (callback: (data: any) => void) {
        priceClient
            .hGetAll('priceFeed:prices')
            .then(function (raw: any) {
                var prices = parsePriceHash(raw);
                return priceClient.get('priceFeed:lastUpdated').then(function (
                    ts: any
                ) {
                    callback({
                        updated: ts ? parseInt(ts, 10) : null,
                        count: Object.keys(prices).length,
                        prices: prices
                    });
                });
            })
            .catch(function (err: any) {
                logger.error(
                    'API',
                    'prices',
                    'Redis read failed: ' + (err && err.message)
                );
                callback({ error: 'price data unavailable' });
            });
    };

    this.handleApiRequest = function (
        req: Request,
        res: Response,
        next: NextFunction
    ) {
        switch (req.params.method) {
            case 'stats':
                res.header('Content-Type', 'application/json');
                res.end(portalStats.statsString);
                return;
            case 'pool_stats':
                res.header('Content-Type', 'application/json');
                res.end(JSON.stringify(portalStats.statPoolHistory));
                return;
            case 'config': {
                // Public runtime config the SPA needs (stratum host, enabled
                // switching ports, per-pool coin/ports/explorer). No secrets.
                var swCfg: any = portalConfig.switching || {};
                var switching: any = {};
                Object.keys(swCfg).forEach(function (k) {
                    if (swCfg[k] && swCfg[k].enabled)
                        switching[k] = {
                            enabled: true,
                            port: swCfg[k].port,
                            algorithm: swCfg[k].algorithm,
                            diff: swCfg[k].diff
                        };
                });
                var pools: any = {};
                Object.keys(poolConfigs).forEach(function (name) {
                    var pc: any = poolConfigs[name];
                    var coin: any = pc.coin || {};
                    pools[name] = {
                        coin: {
                            name: coin.name,
                            symbol: coin.symbol,
                            algorithm: coin.algorithm,
                            explorer: coin.explorer,
                            miningTools: coin.miningTools
                        },
                        ports: pc.ports,
                        // Optional HTTP getwork endpoint (for getwork-only miners such as the
                        // official ccminer). Only the port is public; share difficulty is internal.
                        getwork:
                            pc.getwork && pc.getwork.port
                                ? { port: pc.getwork.port }
                                : undefined,
                        // Block maturity (confirmations required before payout);
                        // the stats UI uses it as the "x / N" confirmations denominator.
                        minConf:
                            pc.paymentProcessing && pc.paymentProcessing.minConf
                    };
                });
                // Operator branding (site name / logo / home-hero copy) so a
                // deployment can rebrand from config.json without code changes.
                var brandCfg: any =
                    (portalConfig.website && portalConfig.website.branding) ||
                    {};
                var brandHome: any = brandCfg.home || {};
                var brandAnalytics: any = brandCfg.analytics || {};
                // Only emit array values of the expected shape so a config typo
                // (e.g. navLinks/sections written as a string) can't crash the
                // SPA. Also drops any _comment_* helper keys.
                var arr = function (v: any) {
                    return Array.isArray(v) ? v : undefined;
                };
                res.header('Content-Type', 'application/json');
                res.end(
                    JSON.stringify({
                        stratumHost:
                            portalConfig.website &&
                            portalConfig.website.stratumHost,
                        branding: {
                            siteName: brandCfg.siteName,
                            logo: brandCfg.logo,
                            favicon: brandCfg.favicon,
                            tagline: brandCfg.tagline,
                            navLinks: arr(brandCfg.navLinks),
                            showTabStats:
                                typeof brandCfg.showTabStats === 'boolean'
                                    ? brandCfg.showTabStats
                                    : undefined,
                            home: {
                                logo: brandHome.logo,
                                title: brandHome.title,
                                coin: brandHome.coin,
                                minPayout: brandHome.minPayout,
                                paymentInterval: brandHome.paymentInterval,
                                poolFee: brandHome.poolFee,
                                paymentMethod: brandHome.paymentMethod,
                                sections: arr(brandHome.sections),
                                servers:
                                    brandHome.servers &&
                                    typeof brandHome.servers === 'object'
                                        ? {
                                              title: brandHome.servers.title,
                                              list: arr(brandHome.servers.list)
                                          }
                                        : undefined,
                                highlights: arr(brandHome.highlights)
                            },
                            analytics: {
                                googleAnalyticsId:
                                    brandAnalytics.googleAnalyticsId,
                                scripts: arr(brandAnalytics.scripts)
                            }
                        },
                        switching: switching,
                        pools: pools
                    })
                );
                return;
            }
            case 'prices':
                res.header('Content-Type', 'application/json');
                _this.getPrices(function (data: any) {
                    res.end(JSON.stringify(data));
                });
                return;
            case 'announcement':
                // Public: the admin-editable banner shown at the top of the
                // home page. Empty string when unset.
                res.header('Content-Type', 'application/json');
                priceClient
                    .get('announcement')
                    .then(function (text: any) {
                        res.end(JSON.stringify({ announcement: text || '' }));
                    })
                    .catch(function () {
                        res.end(JSON.stringify({ announcement: '' }));
                    });
                return;
            case 'metrics':
                res.header('Content-Type', 'text/plain; version=0.0.4');
                res.end(renderMetrics(portalStats.stats));
                return;
            case 'health': {
                var statsInterval =
                    portalConfig.website &&
                    portalConfig.website.stats &&
                    portalConfig.website.stats.updateInterval;
                var health = buildHealth(
                    portalStats.stats,
                    Date.now(),
                    process.uptime(),
                    statsInterval ? statsInterval * 3 : 900
                );
                res.header('Content-Type', 'application/json');
                res.status(health.status === 'ok' ? 200 : 503);
                res.end(JSON.stringify(health));
                return;
            }
            case 'blocks':
            case 'getblocksstats':
                portalStats.getBlocks(function (data: any) {
                    res.header('Content-Type', 'application/json');
                    res.end(JSON.stringify(data));
                });
                break;
            case 'payments':
                var poolBlocks = [];
                for (var pool in portalStats.stats.pools) {
                    poolBlocks.push({
                        name: pool,
                        pending: portalStats.stats.pools[pool].pending,
                        payments: portalStats.stats.pools[pool].payments
                    });
                }
                res.header('Content-Type', 'application/json');
                res.end(JSON.stringify(poolBlocks));
                return;
            case 'worker_stats':
                res.header('Content-Type', 'application/json');
                if (req.url.indexOf('?') > 0) {
                    var url_parms = req.url.split('?');
                    if (url_parms.length > 0) {
                        var history: any = {};
                        var workers: any = {};
                        var address: any = url_parms[1] || null;
                        //res.end(portalStats.getWorkerStats(address));
                        if (address != null && address.length > 0) {
                            // make sure it is just the miners address
                            address = address.split('.')[0];
                            // get miners balance along with worker balances
                            portalStats.getBalanceByAddress(
                                address,
                                function (balances: any) {
                                    // get current round share total
                                    portalStats.getTotalSharesByAddress(
                                        address,
                                        function (shares: any) {
                                            var totalHash = parseFloat(
                                                0.0 as any
                                            );
                                            var totalShares = shares;
                                            var networkHash = 0;
                                            for (var h in portalStats.statHistory) {
                                                for (var pool in portalStats
                                                    .statHistory[h].pools) {
                                                    for (var w in portalStats
                                                        .statHistory[h].pools[
                                                        pool
                                                    ].workers) {
                                                        if (
                                                            w.startsWith(
                                                                address
                                                            )
                                                        ) {
                                                            if (
                                                                history[w] ==
                                                                null
                                                            ) {
                                                                history[w] = [];
                                                            }
                                                            if (
                                                                portalStats
                                                                    .statHistory[
                                                                    h
                                                                ].pools[pool]
                                                                    .workers[w]
                                                                    .hashrate
                                                            ) {
                                                                history[w].push(
                                                                    {
                                                                        time: portalStats
                                                                            .statHistory[
                                                                            h
                                                                        ].time,
                                                                        hashrate:
                                                                            portalStats
                                                                                .statHistory[
                                                                                h
                                                                            ]
                                                                                .pools[
                                                                                pool
                                                                            ]
                                                                                .workers[
                                                                                w
                                                                            ]
                                                                                .hashrate
                                                                    }
                                                                );
                                                            }
                                                        }
                                                    }
                                                    // order check...
                                                    //console.log(portalStats.statHistory[h].time);
                                                }
                                            }
                                            for (var pool in portalStats.stats
                                                .pools) {
                                                for (var w in portalStats.stats
                                                    .pools[pool].workers) {
                                                    if (w.startsWith(address)) {
                                                        workers[w] =
                                                            portalStats.stats.pools[
                                                                pool
                                                            ].workers[w];
                                                        for (var b in balances.balances) {
                                                            if (
                                                                w ==
                                                                balances
                                                                    .balances[b]
                                                                    .worker
                                                            ) {
                                                                workers[
                                                                    w
                                                                ].paid =
                                                                    balances.balances[
                                                                        b
                                                                    ].paid;
                                                                workers[
                                                                    w
                                                                ].balance =
                                                                    balances.balances[
                                                                        b
                                                                    ].balance;
                                                            }
                                                        }
                                                        workers[w].balance =
                                                            workers[w]
                                                                .balance || 0;
                                                        workers[w].paid =
                                                            workers[w].paid ||
                                                            0;
                                                        totalHash +=
                                                            portalStats.stats
                                                                .pools[pool]
                                                                .workers[w]
                                                                .hashrate;
                                                        networkHash =
                                                            portalStats.stats
                                                                .pools[pool]
                                                                .poolStats
                                                                .networkHash;
                                                    }
                                                }
                                            }
                                            res.end(
                                                JSON.stringify({
                                                    miner: address,
                                                    totalHash: totalHash,
                                                    totalShares: totalShares,
                                                    networkHash: networkHash,
                                                    immature:
                                                        balances.totalImmature,
                                                    balance: balances.totalHeld,
                                                    paid: balances.totalPaid,
                                                    workers: workers,
                                                    history: history
                                                })
                                            );
                                        }
                                    );
                                }
                            );
                        } else {
                            res.end(JSON.stringify({ result: 'error' }));
                        }
                    } else {
                        res.end(JSON.stringify({ result: 'error' }));
                    }
                } else {
                    res.end(JSON.stringify({ result: 'error' }));
                }
                return;
            case 'live_stats':
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    Connection: 'keep-alive'
                });
                res.write('\n');
                var uid = Math.random().toString();
                _this.liveStatConnections[uid] = res;
                // Push the current snapshot immediately so clients render right
                // away instead of waiting for the next updateInterval tick.
                if (portalStats.stats)
                    res.write(
                        'data: ' + JSON.stringify(portalStats.stats) + '\n\n'
                    );
                (res as any).flush();
                req.on('close', function () {
                    delete _this.liveStatConnections[uid];
                });
                return;
            default:
                next();
        }
    };

    // Relay a CLI-style admin command (reloadpool/coinswitch) to the cluster
    // master, which dispatches it to the pool workers (init.ts dispatchCliCommand),
    // then wait for the master's reply so the HTTP response carries the result.
    let cliReqSeq = 0;
    const sendCliToMaster = function (
        command: string,
        params: any[],
        options: any,
        cb: (err: string | null, reply?: string) => void
    ): void {
        if (typeof process.send !== 'function') {
            cb('master IPC unavailable');
            return;
        }
        const id = ++cliReqSeq;
        const onMsg = function (m: any) {
            if (m && m.type === 'cliReply' && m.id === id) {
                clearTimeout(timer);
                process.off('message', onMsg);
                cb(null, m.reply);
            }
        };
        const timer = setTimeout(function () {
            process.off('message', onMsg);
            cb('timeout waiting for master');
        }, 8000);
        process.on('message', onMsg);
        (process.send as any)({
            type: 'cliCommand',
            id: id,
            command: command,
            params: params,
            options: options
        });
    };

    this.handleAdminApiRequest = function (
        req: Request,
        res: Response,
        next: NextFunction
    ) {
        switch (req.params.method) {
            case 'pools': {
                res.end(JSON.stringify({ result: poolConfigs }));
                return;
            }
            case 'announcement': {
                // Set/clear the home-page announcement (password already checked
                // by the /api/admin route). Plain text, capped, rendered escaped.
                var text =
                    typeof req.body.announcement === 'string'
                        ? req.body.announcement.slice(0, 2000)
                        : '';
                res.header('Content-Type', 'application/json');
                priceClient
                    .set('announcement', text)
                    .then(function () {
                        res.end(
                            JSON.stringify({ result: { announcement: text } })
                        );
                    })
                    .catch(function (err: any) {
                        logger.error(
                            'API',
                            'admin',
                            'Failed to save announcement: ' +
                                (err && err.message)
                        );
                        res.status(500);
                        res.end(
                            JSON.stringify({
                                error: 'failed to save announcement'
                            })
                        );
                    });
                return;
            }
            case 'reloadpool':
            case 'coinswitch': {
                // Operator commands relayed to the master (password already
                // checked by the /api/admin route). Replaces scripts/cli.ts.
                const method = req.params.method;
                const coin = req.body && req.body.coin;
                if (!coin) {
                    res.status(400);
                    res.end(JSON.stringify({ error: 'coin required' }));
                    return;
                }
                const params =
                    method === 'coinswitch' && req.body.switchKey
                        ? [coin, req.body.switchKey]
                        : [coin];
                const options =
                    method === 'coinswitch' && req.body.algorithm
                        ? { algorithm: req.body.algorithm }
                        : {};
                res.header('Content-Type', 'application/json');
                sendCliToMaster(
                    method,
                    params,
                    options,
                    function (err: string | null, reply?: string) {
                        if (err) {
                            res.status(504);
                            res.end(JSON.stringify({ error: err }));
                        } else {
                            res.end(JSON.stringify({ result: reply }));
                        }
                    }
                );
                return;
            }
            default:
                next();
        }
    };
}
