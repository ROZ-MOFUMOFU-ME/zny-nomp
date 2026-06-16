import { createRedisClient, execCommands } from './redisUtil.ts';

/*
This module deals with handling shares when in internal payment processing mode. It connects to a redis
database and inserts shares with the database structure of:

key: coin_name + ':' + block_height
value: a hash with..
        key:

 */

export default function (logger, poolConfig) {
    var redisConfig = poolConfig.redis;
    var coin = poolConfig.coin.name;

    var forkId = process.env.forkId;
    var logSystem = 'Pool';
    var logComponent = coin;
    var logSubCat = 'Thread ' + (parseInt(forkId) + 1);

    var connection = createRedisClient(redisConfig, function (err) {
        logger.error(
            logSystem,
            logComponent,
            logSubCat,
            'Redis client had an error: ' + JSON.stringify(err.message)
        );
    });
    connection.on('ready', function () {
        logger.debug(
            logSystem,
            logComponent,
            logSubCat,
            'Share processing setup with redis (' +
                redisConfig.host +
                ':' +
                redisConfig.port +
                ')'
        );
    });
    connection.on('end', function () {
        logger.error(
            logSystem,
            logComponent,
            logSubCat,
            'Connection to redis database has been ended'
        );
    });
    connection
        .info()
        .then(function (response) {
            var parts = response.split('\r\n');
            var version;
            var versionString;
            for (var i = 0; i < parts.length; i++) {
                if (parts[i].indexOf(':') !== -1) {
                    var valParts = parts[i].split(':');
                    if (valParts[0] === 'redis_version') {
                        versionString = valParts[1];
                        version = parseFloat(versionString);
                        break;
                    }
                }
            }
            if (!version) {
                logger.error(
                    logSystem,
                    logComponent,
                    logSubCat,
                    'Could not detect redis version - but be super old or broken'
                );
            } else if (version < 2.6) {
                logger.error(
                    logSystem,
                    logComponent,
                    logSubCat,
                    "You're using redis version " +
                        versionString +
                        ' the minimum required version is 2.6. Follow the damn usage instructions...'
                );
            }
        })
        .catch(function () {
            logger.error(
                logSystem,
                logComponent,
                logSubCat,
                'Redis version check failed'
            );
        });

    this.handleShare = function (isValidShare, isValidBlock, shareData) {
        var redisCommands = [];

        if (isValidShare) {
            redisCommands.push([
                'hincrbyfloat',
                coin + ':shares:roundCurrent',
                shareData.worker,
                shareData.difficulty
            ]);
            redisCommands.push(['hincrby', coin + ':stats', 'validShares', 1]);
        } else {
            redisCommands.push([
                'hincrby',
                coin + ':stats',
                'invalidShares',
                1
            ]);
        }

        /* Stores share diff, worker, and unique value with a score that is the timestamp. Unique value ensures it
           doesn't overwrite an existing entry, and timestamp as score lets us query shares from last X minutes to
           generate hashrate for each worker and pool. */
        var dateNow = Date.now();
        var hashrateData = [
            isValidShare ? shareData.difficulty : -shareData.difficulty,
            shareData.worker,
            dateNow
        ];
        redisCommands.push([
            'zadd',
            coin + ':hashrate',
            (dateNow / 1000) | 0,
            hashrateData.join(':')
        ]);

        if (isValidBlock) {
            // roundCurrent is created by the valid-share hincrbyfloat above (a
            // block share is always a valid share), so renaming it within this
            // same MULTI is safe. timesCurrent is handled below.
            redisCommands.push([
                'rename',
                coin + ':shares:roundCurrent',
                coin + ':shares:round' + shareData.height
            ]);
            redisCommands.push([
                'sadd',
                coin + ':blocksPending',
                [
                    shareData.blockHash,
                    shareData.txHash,
                    shareData.height,
                    shareData.worker,
                    dateNow
                ].join(':')
            ]);
            redisCommands.push(['hincrby', coin + ':stats', 'validBlocks', 1]);
        } else if (shareData.blockHash) {
            redisCommands.push([
                'hincrby',
                coin + ':stats',
                'invalidBlocks',
                1
            ]);
        }

        var logMultiError = function (err) {
            var detail = (err && err.message) || String(err);
            // node-redis throws an aggregate when some MULTI commands fail; name
            // the offending command(s) instead of the opaque "N commands failed".
            if (err && Array.isArray(err.errorIndexes)) {
                detail +=
                    ' [' +
                    err.errorIndexes
                        .map(function (i) {
                            var cmd = redisCommands[i]
                                ? redisCommands[i].join(' ')
                                : 'cmd#' + i;
                            var reply = err.replies && err.replies[i];
                            return (
                                cmd +
                                ' -> ' +
                                ((reply && reply.message) || reply)
                            );
                        })
                        .join('; ') +
                    ']';
            }
            logger.error(
                logSystem,
                logComponent,
                logSubCat,
                'Error with share processor multi ' + detail
            );
        };

        if (isValidBlock) {
            // timesCurrent (PPLNT per-worker round time, written by the master
            // process) may not exist when a block is found -- e.g. a block found
            // before any non-block share recreated it for the round, or a PROP
            // pool. RENAME aborts on a missing key, failing just that command in
            // the MULTI and logging a spurious error, so only snapshot it for the
            // round when it actually exists.
            connection
                .exists(coin + ':shares:timesCurrent')
                .then(function (exists) {
                    if (exists) {
                        redisCommands.push([
                            'rename',
                            coin + ':shares:timesCurrent',
                            coin + ':shares:times' + shareData.height
                        ]);
                    }
                    return execCommands(connection, redisCommands);
                })
                .catch(logMultiError);
        } else {
            execCommands(connection, redisCommands).catch(logMultiError);
        }
    };
}
