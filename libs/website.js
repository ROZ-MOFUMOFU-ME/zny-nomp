import https from 'https';
import fs from 'fs';
import path from 'path';
import async from 'async';
import watch from 'node-watch';
import { createRedisClient } from './redisUtil.js';
import dot from 'dot';
import express from 'express';
import compress from 'compression';
import * as Stratum from 'stratum-pool';
import * as StratumUtil from 'stratum-pool/lib/util.js';
import api from './api.js';

export default function (logger) {
    dot.templateSettings.strip = false;

    var portalConfig = JSON.parse(process.env.portalConfig);
    var poolConfigs = JSON.parse(process.env.pools);

    var websiteConfig = portalConfig.website;

    var portalApi = new api(logger, portalConfig, poolConfigs);
    var portalStats = portalApi.stats;

    var logSystem = 'Website';

    var pageFiles = {
        'index.html': 'index',
        'home.html': '',
        'getting_started.html': 'getting_started',
        'stats.html': 'stats',
        'tbs.html': 'tbs',
        'workers.html': 'workers',
        'api.html': 'api',
        'admin.html': 'admin',
        'mining_key.html': 'mining_key',
        'miner_stats.html': 'miner_stats',
        'payments.html': 'payments'
    };

    var pageTemplates = {};

    var pageProcessed = {};
    var indexesProcessed = {};

    var keyScriptTemplate = '';
    var keyScriptProcessed = '';

    var processTemplates = function () {
        for (var pageName in pageTemplates) {
            if (pageName === 'index') continue;
            pageProcessed[pageName] = pageTemplates[pageName]({
                poolsConfigs: poolConfigs,
                stats: portalStats.stats,
                portalConfig: portalConfig
            });
            indexesProcessed[pageName] = pageTemplates.index({
                page: pageProcessed[pageName],
                selected: pageName,
                stats: portalStats.stats,
                poolConfigs: poolConfigs,
                portalConfig: portalConfig
            });
        }

        //logger.debug(logSystem, 'Stats', 'Website updated to latest stats');
    };

    var readPageFiles = function (files) {
        async.each(
            files,
            function (fileName, callback) {
                var filePath =
                    'website/' +
                    (fileName === 'index.html' ? '' : 'pages/') +
                    fileName;
                fs.readFile(filePath, 'utf8', function (err, data) {
                    if (err) {
                        console.log('Error reading file:', filePath, err);
                        return callback(err);
                    }
                    var pTemp = dot.template(data);
                    pageTemplates[pageFiles[fileName]] = pTemp;
                    callback();
                });
            },
            function (err) {
                if (err) {
                    console.log(
                        'error reading files for creating dot templates: ' +
                            JSON.stringify(err)
                    );
                    return;
                }
                processTemplates();
            }
        );
    };

    // if an html file was changed reload it
    /* requires node-watch 0.5.0 or newer */
    watch(['./website', './website/pages'], function (evt, filename) {
        var basename;
        // support older versions of node-watch automatically
        if (!filename && evt) basename = path.basename(evt);
        else basename = path.basename(filename);

        if (basename in pageFiles) {
            readPageFiles([basename]);
            logger.special(logSystem, 'Server', 'Reloaded file ' + basename);
        }
    });

    portalStats.getGlobalStats(function () {
        readPageFiles(Object.keys(pageFiles));
    });

    var buildUpdatedWebsite = function () {
        portalStats.getGlobalStats(function () {
            processTemplates();

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
                function (callback) {
                    var client = createRedisClient(portalConfig.redis);
                    client
                        .hGetAll('coinVersionBytes')
                        .then(function (coinBytes) {
                            callback(null, client, coinBytes || {});
                        })
                        .catch(function (err) {
                            client.destroy();
                            callback(
                                'Failed grabbing coin version bytes from redis ' +
                                    JSON.stringify(err.message)
                            );
                        });
                },
                function (client, coinBytes, callback) {
                    var enabledCoins = Object.keys(poolConfigs).map(
                        function (c) {
                            return c.toLowerCase();
                        }
                    );
                    var missingCoins = [];
                    enabledCoins.forEach(function (c) {
                        if (!(c in coinBytes)) missingCoins.push(c);
                    });
                    callback(null, client, coinBytes, missingCoins);
                },
                function (client, coinBytes, missingCoins, callback) {
                    var coinsForRedis = {};
                    async.each(
                        missingCoins,
                        function (c, cback) {
                            var coinInfo = (function () {
                                for (var pName in poolConfigs) {
                                    if (pName.toLowerCase() === c)
                                        return {
                                            daemon: poolConfigs[pName]
                                                .paymentProcessing.daemon,
                                            address: poolConfigs[pName].address
                                        };
                                }
                            })();
                            var daemon = new Stratum.daemon.interface(
                                [coinInfo.daemon],
                                function (severity, message) {
                                    logger[severity](logSystem, c, message);
                                }
                            );
                            daemon.cmd(
                                'dumpprivkey',
                                [coinInfo.address],
                                function (result) {
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
                function (client, coinBytes, coinsForRedis, callback) {
                    if (Object.keys(coinsForRedis).length > 0) {
                        client
                            .hSet('coinVersionBytes', coinsForRedis)
                            .catch(function (err) {
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
                    logger.error(logSystem, 'Init', err);
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

    var getPage = function (pageId) {
        if (pageId in pageProcessed) {
            var requestedPage = pageProcessed[pageId];
            return requestedPage;
        }
    };

    var minerpage = function (req, res, next) {
        var address = req.params.address || null;
        if (address != null) {
            address = address.split('.')[0];
            portalStats.getBalanceByAddress(address, function () {
                processTemplates();
                res.header('Content-Type', 'text/html');
                res.end(indexesProcessed['miner_stats']);
            });
        } else next();
    };

    var payout = function (req, res, next) {
        var address = req.params.address || null;
        if (address != null) {
            portalStats.getPayout(address, function (data) {
                res.write(data.toString());
                res.end();
            });
        } else next();
    };

    var shares = function (req, res, next) {
        portalStats.getCoins(function () {
            processTemplates();
            res.end(indexesProcessed['user_shares']);
        });
    };

    var usershares = function (req, res, next) {
        var coin = req.params.coin || null;
        if (coin != null) {
            portalStats.getCoinTotals(coin, null, function () {
                processTemplates();
                res.end(indexesProcessed['user_shares']);
            });
        } else next();
    };

    var route = function (req, res, next) {
        var pageId = req.params.page || '';
        var acceptLanguage = req.headers['accept-language'];
        let language = 'en';

        if (acceptLanguage) {
            const supportedLanguages = [
                'en',
                'en-US',
                'ja',
                'zh',
                'zh-TW',
                'zh-HK',
                'fr',
                'es',
                'de',
                'ru',
                'hi',
                'ar',
                'pt',
                'it',
                'tl',
                'id',
                'ms',
                'ko',
                'vi',
                'tr'
            ];
            const languages = acceptLanguage
                .split(',')
                .map((lang) => lang.split(';')[0].trim());

            for (let lang of languages) {
                if (supportedLanguages.includes(lang)) {
                    language = lang;
                    break;
                }
            }
        }

        if (pageId in indexesProcessed) {
            res.header('Content-Type', 'text/html');

            let pageContent = indexesProcessed[pageId].replace(
                /<html lang=".*?">/,
                `<html lang="${language}">`
            );

            res.end(pageContent);
        } else next();
    };

    var app = express();

    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    app.get('/get_page', function (req, res, next) {
        var requestedPage = getPage(req.query.id);
        if (requestedPage) {
            res.end(requestedPage);
            return;
        }
        next();
    });

    //app.get('/stats/shares/:coin', usershares);
    //app.get('/stats/shares', shares);
    //app.get('/payout/:address', payout);
    app.use(compress());
    app.get('/workers/:address', minerpage);
    app.get('/:page', route);
    app.get('/', route);

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

    app.use(compress());
    app.use('/static', express.static('website/static'));

    app.use(function (err, req, res, next) {
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
