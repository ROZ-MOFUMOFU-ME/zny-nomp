import { createRedisClient, execCommands } from './redisUtil.ts';
import type { Logger } from './logUtil.ts';

/*
This module deals with handling shares when in internal payment processing mode. It connects to a redis
database and inserts shares with the database structure of:

key: coin_name + ':' + block_height
value: a hash with..
        key:

 */

export default function (this: any, logger: Logger, poolConfig: any) {
    const redisConfig = poolConfig.redis;
    const coin = poolConfig.coin.name;
    // PPS and D-PPS accrue per-share value continuously (drained by the payment
    // processor on a timer, independent of block finds), so each valid share's
    // difficulty is mirrored into a parallel buffer. roundCurrent stays
    // exclusively for block-based round accounting (prop/pplnt/solo). Both
    // share-based modes use the same shareBuffer; only the per-share rate differs
    // (see docs/payment-schemes.md §4–5).
    // Share-based accrual buffer: pps / dpps / fpps / ppsplus all credit miners
    // per-share off a float (only the per-share rate basis differs), so each
    // valid share's difficulty is mirrored into coin:pps:shareBuffer (drained by
    // the payment processor on a timer). roundCurrent stays exclusively for
    // block-based round accounting. See docs/payment-schemes.md.
    const paymentMode =
        (poolConfig.paymentProcessing &&
            poolConfig.paymentProcessing.paymentMode) ||
        'prop';
    const ppsEnabled =
        paymentMode === 'pps' ||
        paymentMode === 'dpps' ||
        paymentMode === 'fpps' ||
        paymentMode === 'ppsplus';
    // PPLNS keeps a rolling, capped log of recent shares ("worker:diff", newest
    // first) that spans round boundaries; on a block it is snapshotted into
    // coin:shares:pplnsRound<height>, and the payment processor pays each block
    // from its last-N-shares window (windowDiff = N * networkDiff). Used by pure
    // pplns and by ppsplus (which distributes the tx-fee portion of each block
    // PPLNS-style). Block-based — no float / liability. See
    // docs/payment-schemes.md and src/pplnsLogic.ts.
    const pplnsEnabled = paymentMode === 'pplns' || paymentMode === 'ppsplus';
    // Cap on the rolling log (entries). It must comfortably exceed the share
    // count covered by the window; if it is too small the window simply uses
    // every entry it has (still a valid proportional payout, just a shorter N).
    // Read from whichever mode owns the window (pplns or ppsplus).
    const pplnsWindowConfig =
        (poolConfig.paymentProcessing &&
            (poolConfig.paymentProcessing.pplns ||
                poolConfig.paymentProcessing.ppsplus)) ||
        {};
    const pplnsMaxLog = Math.max(
        parseInt(pplnsWindowConfig.maxLogLength || (100000 as any), 10),
        1
    );

    const forkId = process.env.forkId;
    const logSystem = 'Pool';
    const logComponent = coin;
    const logSubCat = 'Thread ' + (parseInt(forkId as string) + 1);

    const connection = createRedisClient(redisConfig, function (err: any) {
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
            const parts = response.split('\r\n');
            let version;
            let versionString;
            for (let i = 0; i < parts.length; i++) {
                if (parts[i].indexOf(':') !== -1) {
                    const valParts = parts[i].split(':');
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

    this.handleShare = function (
        isValidShare: boolean,
        isValidBlock: boolean,
        shareData: any
    ) {
        const redisCommands: Array<Array<string | number>> = [];

        if (isValidShare) {
            redisCommands.push([
                'hincrbyfloat',
                coin + ':shares:roundCurrent',
                shareData.worker,
                shareData.difficulty
            ]);
            if (ppsEnabled) {
                redisCommands.push([
                    'hincrbyfloat',
                    coin + ':pps:shareBuffer',
                    shareData.worker,
                    shareData.difficulty
                ]);
            }
            if (pplnsEnabled) {
                // newest at the head (matches the newest-first window walk in
                // pplnsLogic.selectPplnsWindow), then trim to the cap
                redisCommands.push([
                    'lpush',
                    coin + ':shares:pplnsWindow',
                    shareData.worker + ':' + shareData.difficulty
                ]);
                redisCommands.push([
                    'ltrim',
                    coin + ':shares:pplnsWindow',
                    0,
                    pplnsMaxLog - 1
                ]);
            }
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
        const dateNow = Date.now();
        const hashrateData = [
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
            if (pplnsEnabled) {
                // snapshot the rolling window at find time (the block share was
                // just LPUSH'd above, so it is included). The payment processor
                // reads/deletes coin:shares:pplnsRound<height>. COPY needs Redis
                // 6.2+ (already required); REPLACE guards a retried block.
                redisCommands.push([
                    'copy',
                    coin + ':shares:pplnsWindow',
                    coin + ':shares:pplnsRound' + shareData.height,
                    'REPLACE'
                ]);
            }
            redisCommands.push(['hincrby', coin + ':stats', 'validBlocks', 1]);
        } else if (shareData.blockHash) {
            redisCommands.push([
                'hincrby',
                coin + ':stats',
                'invalidBlocks',
                1
            ]);
        }

        const logMultiError = function (err: any) {
            let detail = (err && err.message) || String(err);
            // node-redis throws an aggregate when some MULTI commands fail; name
            // the offending command(s) instead of the opaque "N commands failed".
            if (err && Array.isArray(err.errorIndexes)) {
                detail +=
                    ' [' +
                    err.errorIndexes
                        .map(function (i: number) {
                            const cmd = redisCommands[i]
                                ? redisCommands[i].join(' ')
                                : 'cmd#' + i;
                            const reply = err.replies && err.replies[i];
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
