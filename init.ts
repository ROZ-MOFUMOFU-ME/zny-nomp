import fs from 'fs';
import path from 'path';
import os from 'os';
import cluster from 'cluster';
import extend from 'extend';
import { createRedisClient, execCommands } from './libs/redisUtil.ts';
import PoolLogger from './libs/logUtil.ts';
import CliListener from './libs/cliListener.ts';
import PoolWorker from './libs/poolWorker.ts';
import PaymentProcessor from './libs/paymentProcessor.ts';
import Website from './libs/website.ts';
import ProfitSwitch from './libs/profitSwitch.ts';
import PriceFeed from './libs/priceFeed.ts';
import algos from 'stratum-pool/lib/algoProperties.ts';
import jsonMinify from 'node-json-minify';

// Set JSON.minify for backward compatibility
JSON.minify = JSON.minify || jsonMinify;

// Determine config file name: prefer config.json, else fallback to config_example.json
const configFileName = fs.existsSync('config.json')
    ? 'config.json'
    : fs.existsSync('config_example.json')
      ? 'config_example.json'
      : null;

if (!configFileName) {
    console.log(
        'config.json file does not exist. Read the installation/setup instructions.'
    );
    process.exit(0);
}

// Load portal configuration from determined file
const portalConfig = JSON.parse(
    JSON.minify(fs.readFileSync(configFileName, { encoding: 'utf8' }))
);

// Allow the Redis connection to be overridden by environment variables so the
// same config works inside a container (e.g. docker-compose points it at the
// "redis" service). Overrides both the portal-level redis and the
// defaultPoolConfigs redis that pools inherit.
if (
    process.env.REDIS_HOST ||
    process.env.REDIS_PORT ||
    process.env.REDIS_PASSWORD !== undefined
) {
    const applyRedisEnv = function (redis: any) {
        if (!redis) return;
        if (process.env.REDIS_HOST) redis.host = process.env.REDIS_HOST;
        if (process.env.REDIS_PORT)
            redis.port = parseInt(process.env.REDIS_PORT, 10);
        if (process.env.REDIS_PASSWORD !== undefined)
            redis.password = process.env.REDIS_PASSWORD;
    };
    applyRedisEnv(portalConfig.redis);
    if (portalConfig.defaultPoolConfigs)
        applyRedisEnv(portalConfig.defaultPoolConfigs.redis);
}

let poolConfigs: any;

const logger = new PoolLogger({
    logLevel: portalConfig.logLevel,
    logColors: portalConfig.logColors
});

// Main initialization function
async function init() {
    try {
        await import('newrelic');
        if (cluster.isMaster) {
            logger.debug('NewRelic', 'Monitor', 'New Relic initiated');
        }
    } catch (_e) {
        // ignore
    }

    //Try to give process ability to handle 100k concurrent connections
    try {
        const posix = await import('posix');
        try {
            posix.setrlimit('nofile', { soft: 100000, hard: 100000 });
        } catch (_e) {
            if (cluster.isMaster) {
                logger.warning(
                    'POSIX',
                    'Connection Limit',
                    '(Safe to ignore) Must be ran as root to increase resource limits'
                );
            }
        } finally {
            // Find out which user used sudo through the environment variable
            const uid = parseInt(process.env.SUDO_UID as string);
            // Set our server's uid to that user
            if (uid) {
                (process as any).setuid(uid);
                logger.debug(
                    'POSIX',
                    'Connection Limit',
                    'Raised to 100K concurrent connections, now running as non-root user: ' +
                        (process as any).getuid()
                );
            }
        }
    } catch (_e) {
        if (cluster.isMaster) {
            logger.debug(
                'POSIX',
                'Connection Limit',
                '(Safe to ignore) POSIX module not installed and resource (connection) limit was not raised'
            );
        }
    }

    if (cluster.isWorker) {
        switch (process.env.workerType) {
            case 'pool':
                new (PoolWorker as any)(logger);
                break;
            case 'paymentProcessor':
                new (PaymentProcessor as any)(logger);
                break;
            case 'website':
                new (Website as any)(logger);
                break;
            case 'profitSwitch':
                new (ProfitSwitch as any)(logger);
                break;
            case 'priceFeed':
                new (PriceFeed as any)(logger);
                break;
        }
        return;
    }

    poolConfigs = buildPoolConfigs();
    spawnPoolWorkers();
    startPaymentProcessor();
    startWebsite();
    startProfitSwitch();
    startPriceFeed();
    startCliListener();
}

//Read all pool configs from pool_configs and join them with their coin profile
const buildPoolConfigs = function () {
    const configs: any = {};
    const configDir = 'pool_configs/';

    const poolConfigFiles: any[] = [];

    /* Get filenames of pool config json files that are enabled */
    fs.readdirSync(configDir).forEach(function (file: string) {
        if (
            !fs.existsSync(configDir + file) ||
            path.extname(configDir + file) !== '.json'
        )
            return;
        const poolOptions = JSON.parse(
            JSON.minify(fs.readFileSync(configDir + file, { encoding: 'utf8' }))
        );
        if (!poolOptions.enabled) return;
        poolOptions.fileName = file;
        poolConfigFiles.push(poolOptions);
    });

    /* Ensure no pool uses any of the same ports as another pool */
    for (let i = 0; i < poolConfigFiles.length; i++) {
        const ports = Object.keys(poolConfigFiles[i].ports);
        for (let f = 0; f < poolConfigFiles.length; f++) {
            if (f === i) continue;
            const portsF = Object.keys(poolConfigFiles[f].ports);
            for (let g = 0; g < portsF.length; g++) {
                if (ports.indexOf(portsF[g]) !== -1) {
                    logger.error(
                        'Master',
                        poolConfigFiles[f].fileName,
                        'Has same configured port of ' +
                            portsF[g] +
                            ' as ' +
                            poolConfigFiles[i].fileName
                    );
                    process.exit(1);
                    return;
                }
            }

            if (poolConfigFiles[f].coin === poolConfigFiles[i].coin) {
                logger.error(
                    'Master',
                    poolConfigFiles[f].fileName,
                    'Pool has same configured coin file coins/' +
                        poolConfigFiles[f].coin +
                        ' as ' +
                        poolConfigFiles[i].fileName +
                        ' pool'
                );
                process.exit(1);
                return;
            }
        }
    }

    poolConfigFiles.forEach(function (poolOptions: any) {
        poolOptions.coinFileName = poolOptions.coin;

        const coinFilePath = 'coins/' + poolOptions.coinFileName;
        if (!fs.existsSync(coinFilePath)) {
            logger.error(
                'Master',
                poolOptions.coinFileName,
                'could not find file: ' + coinFilePath
            );
            return;
        }

        const coinProfile = JSON.parse(
            JSON.minify(fs.readFileSync(coinFilePath, { encoding: 'utf8' }))
        );
        poolOptions.coin = coinProfile;
        poolOptions.coin.name = poolOptions.coin.name.toLowerCase();
        if (coinProfile.mainnet) {
            poolOptions.coin.mainnet.bip32.public = Buffer.from(
                coinProfile.mainnet.bip32.public,
                'hex'
            ).readUInt32LE(0);
            poolOptions.coin.mainnet.pubKeyHash = Buffer.from(
                coinProfile.mainnet.pubKeyHash,
                'hex'
            ).readUInt8(0);
            poolOptions.coin.mainnet.scriptHash = Buffer.from(
                coinProfile.mainnet.scriptHash,
                'hex'
            ).readUInt8(0);
        }
        if (coinProfile.testnet) {
            poolOptions.coin.testnet.bip32.public = Buffer.from(
                coinProfile.testnet.bip32.public,
                'hex'
            ).readUInt32LE(0);
            poolOptions.coin.testnet.pubKeyHash = Buffer.from(
                coinProfile.testnet.pubKeyHash,
                'hex'
            ).readUInt8(0);
            poolOptions.coin.testnet.scriptHash = Buffer.from(
                coinProfile.testnet.scriptHash,
                'hex'
            ).readUInt8(0);
        }

        if (poolOptions.coin.name in configs) {
            logger.error(
                'Master',
                poolOptions.fileName,
                'coins/' +
                    poolOptions.coinFileName +
                    ' has same configured coin name ' +
                    poolOptions.coin.name +
                    ' as coins/' +
                    configs[poolOptions.coin.name].coinFileName +
                    ' used by pool config ' +
                    configs[poolOptions.coin.name].fileName
            );

            process.exit(1);
            return;
        }

        for (const option in portalConfig.defaultPoolConfigs) {
            if (!(option in poolOptions)) {
                const toCloneOption = portalConfig.defaultPoolConfigs[option];
                let clonedOption = {};
                if (toCloneOption.constructor === Object)
                    extend(true, clonedOption, toCloneOption);
                else clonedOption = toCloneOption;
                poolOptions[option] = clonedOption;
            }
        }

        if (!poolOptions.blockIdentifier || poolOptions.blockIdentifier == '')
            if (portalConfig.website && portalConfig.website.stratumHost)
                poolOptions.blockIdentifier = portalConfig.website.stratumHost;
        logger.debug(
            'Master',
            coinProfile.name,
            'blockIdentifier: ' + poolOptions.blockIdentifier
        );

        configs[poolOptions.coin.name] = poolOptions;

        if (!(coinProfile.algorithm in algos)) {
            logger.error(
                'Master',
                coinProfile.name,
                'Cannot run a pool for unsupported algorithm "' +
                    coinProfile.algorithm +
                    '"'
            );
            delete configs[poolOptions.coin.name];
        }
    });
    return configs;
};

function roundTo(n: number, digits?: number) {
    if (digits === undefined) {
        digits = 0;
    }
    const multiplicator = Math.pow(10, digits);
    n = parseFloat((n * multiplicator).toFixed(11));
    const test = Math.round(n) / multiplicator;
    return +test.toFixed(digits);
}

const _lastStartTimes: any = [];
const _lastShareTimes: any = [];

const spawnPoolWorkers = function () {
    let redisConfig: any;
    let connection: any;

    Object.keys(poolConfigs).forEach(function (coin: string) {
        const pcfg = poolConfigs[coin];
        if (!Array.isArray(pcfg.daemons) || pcfg.daemons.length < 1) {
            logger.error(
                'Master',
                coin,
                'No daemons configured so a pool cannot be started for this coin.'
            );
            delete poolConfigs[coin];
        } else if (!connection) {
            redisConfig = pcfg.redis;
            connection = createRedisClient(redisConfig, function (err: any) {
                logger.error(
                    'PPLNT',
                    coin,
                    'Redis error: ' + JSON.stringify(err.message)
                );
            });
            connection.on('ready', function () {
                logger.debug(
                    'PPLNT',
                    coin,
                    'TimeShare processing setup with redis (' +
                        redisConfig.host +
                        ':' +
                        redisConfig.port +
                        ')'
                );
            });
        }
    });

    if (Object.keys(poolConfigs).length === 0) {
        logger.warning(
            'Master',
            'PoolSpawner',
            'No pool configs exists or are enabled in pool_configs folder. No pools spawned.'
        );
        process.exit(0);
    }

    const serializedConfigs = JSON.stringify(poolConfigs);

    const numForks = (function () {
        if (!portalConfig.clustering || !portalConfig.clustering.enabled)
            return 1;
        if (portalConfig.clustering.forks === 'auto') return os.cpus().length;
        if (
            !portalConfig.clustering.forks ||
            isNaN(portalConfig.clustering.forks)
        )
            return 1;
        return portalConfig.clustering.forks;
    })();

    const poolWorkers: any = {};

    const createPoolWorker = function (forkId: number) {
        const worker: any = cluster.fork({
            workerType: 'pool',
            forkId: forkId,
            pools: serializedConfigs,
            portalConfig: JSON.stringify(portalConfig)
        });
        worker.forkId = forkId;
        worker.type = 'pool';
        poolWorkers[forkId] = worker;
        worker
            .on('exit', function (_code: any, _signal: any) {
                logger.error(
                    'Master',
                    'PoolSpawner',
                    'Fork ' + forkId + ' died, spawning replacement worker...'
                );
                setTimeout(function () {
                    createPoolWorker(forkId);
                }, 2000);
            })
            .on('message', function (msg: any) {
                switch (msg.type) {
                    case 'banIP':
                        Object.keys(cluster.workers as any).forEach(function (
                            id: string
                        ) {
                            if ((cluster.workers as any)[id].type === 'pool') {
                                (cluster.workers as any)[id].send({
                                    type: 'banIP',
                                    ip: msg.ip
                                });
                            }
                        });
                        break;
                    case 'shareTrack':
                        // pplnt time share tracking of workers
                        if (msg.isValidShare && !msg.isValidBlock) {
                            const now = Date.now();
                            let lastShareTime = now;
                            const _lastStartTime = now;
                            const workerAddress = msg.data.worker.split('.')[0];

                            // if needed, initialize PPLNT objects for coin
                            if (!_lastShareTimes[msg.coin]) {
                                _lastShareTimes[msg.coin] = {};
                            }
                            if (!_lastStartTimes[msg.coin]) {
                                _lastStartTimes[msg.coin] = {};
                            }

                            // did they just join in this round?
                            if (
                                !_lastShareTimes[msg.coin][workerAddress] ||
                                !_lastStartTimes[msg.coin][workerAddress]
                            ) {
                                _lastShareTimes[msg.coin][workerAddress] = now;
                                _lastStartTimes[msg.coin][workerAddress] = now;
                                logger.debug(
                                    'PPLNT',
                                    msg.coin,
                                    'Thread ' + msg.thread,
                                    workerAddress + ' joined.'
                                );
                            }
                            // grab last times from memory objects
                            if (
                                _lastShareTimes[msg.coin][workerAddress] !=
                                    null &&
                                _lastShareTimes[msg.coin][workerAddress] > 0
                            ) {
                                lastShareTime =
                                    _lastShareTimes[msg.coin][workerAddress];
                                const _lastStartTime =
                                    _lastStartTimes[msg.coin][workerAddress];
                            }

                            const redisCommands = [];

                            // if its been less than 15 minutes since last share was submitted
                            const timeChangeSec = roundTo(
                                Math.max(now - lastShareTime, 0) / 1000,
                                4
                            );
                            //var timeChangeTotal = roundTo(Math.max(now - lastStartTime, 0) / 1000, 4);
                            if (timeChangeSec < 900) {
                                // loyal miner keeps mining :)
                                redisCommands.push([
                                    'hincrbyfloat',
                                    msg.coin + ':shares:timesCurrent',
                                    workerAddress,
                                    timeChangeSec
                                ]);
                                //logger.debug('PPLNT', msg.coin, 'Thread '+msg.thread, workerAddress+':{totalTimeSec:'+timeChangeTotal+', timeChangeSec:'+timeChangeSec+'}');
                                execCommands(connection, redisCommands).catch(
                                    function (err: any) {
                                        logger.error(
                                            'PPLNT',
                                            msg.coin,
                                            'Thread ' + msg.thread,
                                            'Error with time share processor call to redis ' +
                                                JSON.stringify(err.message)
                                        );
                                    }
                                );
                            } else {
                                // they just re-joined the pool
                                _lastStartTimes[workerAddress] = now;
                                logger.debug(
                                    'PPLNT',
                                    msg.coin,
                                    'Thread ' + msg.thread,
                                    workerAddress + ' re-joined.'
                                );
                            }

                            // track last time share
                            _lastShareTimes[msg.coin][workerAddress] = now;
                        }
                        if (msg.isValidBlock) {
                            // reset pplnt share times for next round
                            _lastShareTimes[msg.coin] = {};
                            _lastStartTimes[msg.coin] = {};
                        }
                        break;
                }
            });
    };

    let i = 0;
    const spawnInterval = setInterval(function () {
        createPoolWorker(i);
        i++;
        if (i === numForks) {
            clearInterval(spawnInterval);
            logger.debug(
                'Master',
                'PoolSpawner',
                'Spawned ' +
                    Object.keys(poolConfigs).length +
                    ' pool(s) on ' +
                    numForks +
                    ' thread(s)'
            );
        }
    }, 250);
};

const startCliListener = function () {
    const cliPort = portalConfig.cliPort;

    const listener = new (CliListener as any)(cliPort);
    listener
        .on('log', function (text: any) {
            logger.debug('Master', 'CLI', text);
        })
        .on(
            'command',
            function (command: any, params: any, options: any, reply: any) {
                switch (command) {
                    case 'blocknotify':
                        Object.keys(cluster.workers as any).forEach(function (
                            id: string
                        ) {
                            (cluster.workers as any)[id].send({
                                type: 'blocknotify',
                                coin: params[0],
                                hash: params[1]
                            });
                        });
                        reply('Pool workers notified');
                        break;
                    case 'coinswitch':
                        processCoinSwitchCommand(params, options, reply);
                        break;
                    case 'reloadpool':
                        Object.keys(cluster.workers as any).forEach(function (
                            id: string
                        ) {
                            (cluster.workers as any)[id].send({
                                type: 'reloadpool',
                                coin: params[0]
                            });
                        });
                        reply('reloaded pool ' + params[0]);
                        break;
                    default:
                        reply('unrecognized command "' + command + '"');
                        break;
                }
            }
        )
        .start();
};

const processCoinSwitchCommand = function (
    params: any,
    options: any,
    reply: any
) {
    const logSystem = 'CLI';
    const logComponent = 'coinswitch';

    const replyError = function (msg: any) {
        reply(msg);
        logger.error(logSystem, logComponent, msg);
    };

    if (!params[0]) {
        replyError('Coin name required');
        return;
    }

    if (!params[1] && !options.algorithm) {
        replyError(
            'If switch key is not provided then algorithm options must be specified'
        );
        return;
    } else if (params[1] && !portalConfig.switching[params[1]]) {
        replyError('Switch key not recognized: ' + params[1]);
        return;
    } else if (
        options.algorithm &&
        !Object.keys(portalConfig.switching).filter(function (s: any) {
            return portalConfig.switching[s].algorithm === options.algorithm;
        })[0]
    ) {
        replyError(
            'No switching options contain the algorithm ' + options.algorithm
        );
        return;
    }

    const messageCoin = params[0].toLowerCase();
    const newCoin = Object.keys(poolConfigs).filter(function (p: any) {
        return p.toLowerCase() === messageCoin;
    })[0];

    if (!newCoin) {
        replyError(
            'Switch message to coin that is not recognized: ' + messageCoin
        );
        return;
    }

    const switchNames = [];

    if (params[1]) {
        switchNames.push(params[1]);
    } else {
        for (const name in portalConfig.switching) {
            if (
                portalConfig.switching[name].enabled &&
                portalConfig.switching[name].algorithm === options.algorithm
            )
                switchNames.push(name);
        }
    }

    switchNames.forEach(function (name: any) {
        if (
            poolConfigs[newCoin].coin.algorithm !==
            portalConfig.switching[name].algorithm
        ) {
            replyError(
                'Cannot switch a ' +
                    portalConfig.switching[name].algorithm +
                    ' algo pool to coin ' +
                    newCoin +
                    ' with ' +
                    poolConfigs[newCoin].coin.algorithm +
                    ' algo'
            );
            return;
        }

        Object.keys(cluster.workers as any).forEach(function (id: string) {
            (cluster.workers as any)[id].send({
                type: 'coinswitch',
                coin: newCoin,
                switchName: name
            });
        });
    });

    reply('Switch message sent to pool workers');
};

const startPaymentProcessor = function () {
    let enabledForAny = false;
    for (const pool in poolConfigs) {
        const p = poolConfigs[pool];
        const enabled =
            p.enabled && p.paymentProcessing && p.paymentProcessing.enabled;
        if (enabled) {
            enabledForAny = true;
            break;
        }
    }

    if (!enabledForAny) return;

    const worker = cluster.fork({
        workerType: 'paymentProcessor',
        pools: JSON.stringify(poolConfigs)
    });
    worker.on('exit', function (_code: any, _signal: any) {
        logger.error(
            'Master',
            'Payment Processor',
            'Payment processor died, spawning replacement...'
        );
        setTimeout(function () {
            startPaymentProcessor();
        }, 2000);
    });
};

const startWebsite = function () {
    if (!portalConfig.website.enabled) return;

    const worker = cluster.fork({
        workerType: 'website',
        pools: JSON.stringify(poolConfigs),
        portalConfig: JSON.stringify(portalConfig)
    });
    worker.on('exit', function (_code: any, _signal: any) {
        logger.error(
            'Master',
            'Website',
            'Website process died, spawning replacement...'
        );
        setTimeout(function () {
            startWebsite();
        }, 2000);
    });
};

const startProfitSwitch = function () {
    if (!portalConfig.profitSwitch || !portalConfig.profitSwitch.enabled) {
        //logger.error('Master', 'Profit', 'Profit auto switching disabled');
        return;
    }

    const worker = cluster.fork({
        workerType: 'profitSwitch',
        pools: JSON.stringify(poolConfigs),
        portalConfig: JSON.stringify(portalConfig)
    });
    worker.on('exit', function (_code: any, _signal: any) {
        logger.error(
            'Master',
            'Profit',
            'Profit switching process died, spawning replacement...'
        );
        setTimeout(function () {
            startProfitSwitch();
        }, 2000);
    });
};

const startPriceFeed = function () {
    if (!portalConfig.priceFeed || !portalConfig.priceFeed.enabled) {
        return;
    }

    const worker = cluster.fork({
        workerType: 'priceFeed',
        pools: JSON.stringify(poolConfigs),
        portalConfig: JSON.stringify(portalConfig)
    });
    worker.on('exit', function (_code: any, _signal: any) {
        logger.error(
            'Master',
            'PriceFeed',
            'Price feed process died, spawning replacement...'
        );
        setTimeout(function () {
            startPriceFeed();
        }, 2000);
    });
};

// Start the application
init().catch(console.error);
