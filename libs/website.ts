import https from 'https';
import fs from 'fs';
import path from 'path';
import async from 'async';
import { createRedisClient } from './redisUtil.ts';
import dot from 'dot';
import express from 'express';
import compress from 'compression';
import * as Stratum from 'stratum-pool';
import * as StratumUtil from 'stratum-pool/lib/util.ts';
import api from './api.ts';
import type { Logger } from './logUtil.ts';

// Directory of the built Vite + React SPA (see web/). Served as static assets
// with a catch-all fallback to index.html so client-side routes work.
const SPA_DIR = path.resolve('web/dist');
const SPA_INDEX = path.join(SPA_DIR, 'index.html');

export default function (this: any, logger: Logger) {
    dot.templateSettings.strip = false;

    var portalConfig: any = JSON.parse(process.env.portalConfig as string);
    var poolConfigs: any = JSON.parse(process.env.pools as string);

    var websiteConfig = portalConfig.website;

    var portalApi: any = new (api as any)(logger, portalConfig, poolConfigs);
    var portalStats = portalApi.stats;

    var logSystem = 'Website';

    // The wallet/mining-key tool (website/key.html) is the one page still
    // rendered server-side, because it needs per-coin version bytes injected.
    var keyScriptTemplate: any = '';
    var keyScriptProcessed: any = '';

    // Populate the stats snapshot once at startup so /api/stats has data before
    // the first SSE tick, then push the live object to SSE clients on a timer.
    portalStats.getGlobalStats(function () {});

    var buildUpdatedWebsite = function () {
        portalStats.getGlobalStats(function () {
            var statData =
                'data: ' + JSON.stringify(portalStats.stats) + '\n\n';
            for (var uid in portalApi.liveStatConnections) {
                var res = portalApi.liveStatConnections[uid];
                res.write(statData);
            }
        });
    };

    setInterval(buildUpdatedWebsite, websiteConfig.stats.updateInterval * 1000);

    var buildKeyScriptPage = function () {
        async.waterfall(
            [
                function (callback: any) {
                    var client = createRedisClient(portalConfig.redis);
                    client
                        .hGetAll('coinVersionBytes')
                        .then(function (coinBytes: any) {
                            callback(null, client, coinBytes || {});
                        })
                        .catch(function (err: any) {
                            client.destroy();
                            callback(
                                'Failed grabbing coin version bytes from redis ' +
                                    JSON.stringify(err.message)
                            );
                        });
                },
                function (client: any, coinBytes: any, callback: any) {
                    var enabledCoins = Object.keys(poolConfigs).map(
                        function (c) {
                            return c.toLowerCase();
                        }
                    );
                    var missingCoins: any = [];
                    enabledCoins.forEach(function (c) {
                        if (!(c in coinBytes)) missingCoins.push(c);
                    });
                    callback(null, client, coinBytes, missingCoins);
                },
                function (
                    client: any,
                    coinBytes: any,
                    missingCoins: any,
                    callback: any
                ) {
                    var coinsForRedis: any = {};
                    async.each(
                        missingCoins,
                        function (c: any, cback: any) {
                            var coinInfo: any = (function () {
                                for (var pName in poolConfigs) {
                                    if (pName.toLowerCase() === c)
                                        return {
                                            daemon: poolConfigs[pName]
                                                .paymentProcessing.daemon,
                                            address: poolConfigs[pName].address
                                        };
                                }
                            })();
                            var daemon = new (Stratum as any).daemon.interface(
                                [coinInfo.daemon],
                                function (severity: any, message: any) {
                                    (logger as any)[severity](
                                        logSystem,
                                        c,
                                        message
                                    );
                                }
                            );
                            daemon.cmd(
                                'dumpprivkey',
                                [coinInfo.address],
                                function (result: any) {
                                    if (result[0].error) {
                                        logger.error(
                                            logSystem,
                                            c,
                                            'Could not dumpprivkey for ' +
                                                c +
                                                ' ' +
                                                JSON.stringify(result[0].error)
                                        );
                                        cback();
                                        return;
                                    }

                                    var vBytePub = StratumUtil.getVersionByte(
                                        coinInfo.address
                                    )[0];
                                    var vBytePriv = StratumUtil.getVersionByte(
                                        result[0].response
                                    )[0];

                                    coinBytes[c] =
                                        vBytePub.toString() +
                                        ',' +
                                        vBytePriv.toString();
                                    coinsForRedis[c] = coinBytes[c];
                                    cback();
                                }
                            );
                        },
                        function (err) {
                            callback(null, client, coinBytes, coinsForRedis);
                        }
                    );
                },
                function (
                    client: any,
                    coinBytes: any,
                    coinsForRedis: any,
                    callback: any
                ) {
                    if (Object.keys(coinsForRedis).length > 0) {
                        client
                            .hSet('coinVersionBytes', coinsForRedis)
                            .catch(function (err: any) {
                                logger.error(
                                    logSystem,
                                    'Init',
                                    'Failed inserting coin byte version into redis ' +
                                        JSON.stringify(err.message)
                                );
                            })
                            .then(function () {
                                client.destroy();
                            });
                    } else {
                        client.destroy();
                    }
                    callback(null, coinBytes);
                }
            ],
            function (err, coinBytes) {
                if (err) {
                    logger.error(logSystem, 'Init', err as any);
                    return;
                }
                try {
                    keyScriptTemplate = dot.template(
                        fs.readFileSync('website/key.html', {
                            encoding: 'utf8'
                        })
                    );
                    keyScriptProcessed = keyScriptTemplate({
                        coins: coinBytes
                    });
                } catch (e) {
                    logger.error(
                        logSystem,
                        'Init',
                        'Failed to read key.html file'
                    );
                }
            }
        );
    };

    buildKeyScriptPage();

    var app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(compress());

    // JSON / SSE API.
    app.get('/api/:method', function (req, res, next) {
        portalApi.handleApiRequest(req, res, next);
    });

    app.post('/api/admin/:method', function (req, res, next) {
        if (
            portalConfig.website &&
            portalConfig.website.adminCenter &&
            portalConfig.website.adminCenter.enabled
        ) {
            if (portalConfig.website.adminCenter.password === req.body.password)
                portalApi.handleAdminApiRequest(req, res, next);
            else res.status(401).json({ error: 'Incorrect Password' });
        } else next();
    });

    // Server-rendered wallet/mining-key tool (needs injected coin version
    // bytes). Falls back to the raw file until the async build completes.
    app.get('/key.html', function (req, res) {
        res.header('Content-Type', 'text/html');
        if (keyScriptProcessed) res.end(keyScriptProcessed);
        else res.sendFile(path.resolve('website/key.html'));
    });

    // Built SPA assets (index.html at /, hashed assets under /assets).
    app.use(express.static(SPA_DIR));

    // SPA fallback: any other GET serves the app shell for client-side routing.
    app.use(function (req: any, res: any) {
        res.sendFile(SPA_INDEX);
    });

    app.use(function (err: any, req: any, res: any, next: any) {
        console.error(err.stack);
        res.status(500).send('Something broke!');
    });

    try {
        if (
            portalConfig.website.tlsOptions &&
            portalConfig.website.tlsOptions.enabled === true
        ) {
            var TLSoptions = {
                key: fs.readFileSync(portalConfig.website.tlsOptions.key),
                cert: fs.readFileSync(portalConfig.website.tlsOptions.cert)
            };

            https
                .createServer(TLSoptions, app)
                .listen(
                    portalConfig.website.port,
                    portalConfig.website.host,
                    function () {
                        logger.debug(
                            logSystem,
                            'Server',
                            'TLS Website started on ' +
                                portalConfig.website.host +
                                ':' +
                                portalConfig.website.port
                        );
                    }
                );
        } else {
            app.listen(
                portalConfig.website.port,
                portalConfig.website.host,
                function () {
                    logger.debug(
                        logSystem,
                        'Server',
                        'Website started on ' +
                            portalConfig.website.host +
                            ':' +
                            portalConfig.website.port
                    );
                }
            );
        }
    } catch (e) {
        console.log(e);
        logger.error(
            logSystem,
            'Server',
            'Could not start website on ' +
                portalConfig.website.host +
                ':' +
                portalConfig.website.port +
                ' - its either in use or you do not have permission'
        );
    }
}
