import fs from 'fs';
import { createRedisClient, execCommands } from './redisUtil.ts';
import { dppsRateScalar, emaNext, realizedLuck } from './ppsLogic.ts';
import { parsePplnsEntry, pplnsShareTotals } from './pplnsLogic.ts';
import {
    avgFeePerBlock,
    fppsEffectiveReward,
    ppsPlusFeePart
} from './feeRewardLogic.ts';
import { esmppsAllocate, smppsAllocate, parseDebtEntry } from './smppsLogic.ts';
import async from 'async';
import * as Stratum from 'stratum-pool';
import * as StratumUtil from 'stratum-pool/src/util.ts';
import algos from 'stratum-pool/src/algoProperties.ts';
import type { Logger } from './logUtil.ts';

// `util` is referenced (but never imported) by getProperAddress/handleAddress
// below; declared here as a type-only ambient binding so the reference type-checks
// without introducing a runtime value (preserving the original behavior).
declare const util: any;
// `callback` is referenced in dead/unreachable code inside getProperAddress
// (after an unconditional return); declared type-only so it type-checks without
// introducing a runtime value (preserving the original behavior).
declare const callback: any;

export default function (logger: Logger) {
    var poolConfigs: any = JSON.parse(process.env.pools as string);

    var enabledPools: any = [];

    Object.keys(poolConfigs).forEach(function (coin) {
        var poolOptions = poolConfigs[coin];
        if (
            poolOptions.paymentProcessing &&
            poolOptions.paymentProcessing.enabled
        )
            enabledPools.push(coin);
    });

    async.filter(
        enabledPools,
        function (coin: any, callback: any) {
            SetupForPool(
                logger,
                poolConfigs[coin],
                function (setupResults: any) {
                    callback(null, setupResults);
                }
            );
        },
        function (err: any, results: any) {
            results.forEach(function (coin: any) {
                var poolOptions = poolConfigs[coin];
                var processingConfig = poolOptions.paymentProcessing;
                var logSystem = 'Payments';
                var logComponent = coin;

                logger.debug(
                    logSystem,
                    logComponent,
                    'Payment processing setup with daemon (' +
                        processingConfig.daemon.user +
                        '@' +
                        processingConfig.daemon.host +
                        ':' +
                        processingConfig.daemon.port +
                        ') and redis (' +
                        poolOptions.redis.host +
                        ':' +
                        poolOptions.redis.port +
                        ')'
                );
            });
        }
    );
}

function SetupForPool(logger: Logger, poolOptions: any, setupFinished: any) {
    var coin = poolOptions.coin.name;
    var processingConfig = poolOptions.paymentProcessing;

    var logSystem = 'Payments';
    var logComponent = coin;

    // default tx fee
    var txFee = 1000;

    var opidCount = 0;
    var opids: any = [];

    // zcash team recommends 10 confirmations for safety from orphaned blocks
    var minConfShield = Math.max(processingConfig.minConf || 10, 1); // Don't allow 0 conf transactions.
    var minConfPayout = Math.max(processingConfig.minConf || 10, 1);
    if (minConfPayout < 3) {
        logger.warning(
            logSystem,
            logComponent,
            logComponent + ' minConf of 3 is recommended.'
        );
    }

    // minimum paymentInterval of 60 seconds
    var paymentIntervalSecs = Math.max(
        processingConfig.paymentInterval || 120,
        30
    );
    if (parseInt(processingConfig.paymentInterval) < 120) {
        logger.warning(
            logSystem,
            logComponent,
            ' minimum paymentInterval of 120 seconds recommended.'
        );
    }

    var maxBlocksPerPayment = Math.max(
        processingConfig.maxBlocksPerPayment || 3,
        1
    );

    // Payment mode: prop (default, proportional), pplnt (time-weighted), solo
    // (whole block reward to the finder), pps (fixed pay-per-share, share-based),
    // or dpps (dynamic PPS — PPS whose per-share rate auto-throttles on the pool's
    // realized luck, floored at rateMin; see docs/payment-schemes.md §5).
    var paymentMode = processingConfig.paymentMode || 'prop';
    if (
        [
            'prop',
            'pplnt',
            'pplns',
            'solo',
            'pps',
            'dpps',
            'fpps',
            'ppsplus',
            'smpps',
            'esmpps'
        ].indexOf(paymentMode) === -1
    ) {
        logger.warning(
            logSystem,
            logComponent,
            'paymentMode "' +
                paymentMode +
                '" is not implemented; falling back to proportional (prop)'
        );
    }
    // pplnt - pay per last N time shares
    var pplntEnabled = paymentMode === 'pplnt';
    var pplntTimeQualify = processingConfig.pplnt || 0.51; // 51%
    // pplns - pay per last N shares. BLOCK-BASED (no float / liability, like
    // prop/pplnt/solo): each matured block is shared among the contributors to
    // the last N shares before it, where the window N is a multiple of the
    // network difficulty (windowDiff = pplnsN * networkDiff). The window slides
    // across round boundaries, so it is fed from a rolling share log
    // (coin:shares:pplnsWindow) snapshotted per block into
    // coin:shares:pplnsRound<height> at find time, rather than the per-round
    // coin:shares:round<height> hash. See docs/payment-schemes.md and
    // src/pplnsLogic.ts.
    var pplnsEnabled = paymentMode === 'pplns';
    var pplnsConfig = (pplnsEnabled && processingConfig.pplns) || {};
    var pplnsN = parseFloat(pplnsConfig.n) || 2; // window = N x networkDiff
    // solo - the block finder (round.minedby) takes the whole block reward
    var soloEnabled = paymentMode === 'solo';
    // pps - pay-per-share. SHARE-BASED: the pool fronts variance from a float so
    // this carries real financial liability (see docs/payment-schemes.md).
    // Miners accrue `(blockReward / networkDiff) * shareDiff` continuously into
    // coin:balances (accruePPS, below); matured block rewards are routed to the
    // pool float instead of miners. HIGH RISK — keep behind float monitoring
    // (/api/metrics) and the minFloat kill-switch.
    var ppsEnabled = paymentMode === 'pps';
    var ppsConfig = (ppsEnabled && processingConfig.pps) || {};
    var ppsBlockReward = parseFloat(ppsConfig.blockReward) || 0;
    var ppsFeePercent = parseFloat(ppsConfig.feePercent) || 0;
    var ppsMinFloat = parseFloat(ppsConfig.minFloat) || 0;
    // Accrual cannot run without a positive per-block reward basis; if pps is
    // selected but misconfigured we log and behave as prop (block-based, safe).
    var ppsActive = ppsEnabled && ppsBlockReward > 0;
    if (ppsEnabled && !ppsActive) {
        logger.error(
            logSystem,
            logComponent,
            'paymentMode "pps" requires pps.blockReward > 0 — PPS accrual is DISABLED (behaving as prop) until configured'
        );
    }
    if (ppsActive && !(ppsMinFloat > 0)) {
        logger.warning(
            logSystem,
            logComponent,
            'pps.minFloat is 0 — the float kill-switch is effectively off; set a safety floor to bound pool liability'
        );
    }
    // dpps - DYNAMIC pay-per-share. PPS plus a feedback controller: the per-share
    // rate is scaled by the pool's realized luck (smoothed actualReward /
    // expectedReward) so payouts auto-throttle when the pool runs underwater,
    // floored at rateMin and capped at full PPS. Shares the entire PPS accrual
    // path (shareBuffer drain + float kill-switch); only the per-share rate differs.
    var dppsEnabled = paymentMode === 'dpps';
    var dppsConfig = (dppsEnabled && processingConfig.dpps) || {};
    var dppsBlockReward = parseFloat(dppsConfig.blockReward) || 0;
    var dppsTargetMargin = parseFloat(dppsConfig.targetMargin);
    if (!(dppsTargetMargin >= 0 && dppsTargetMargin < 1))
        dppsTargetMargin = 0.02;
    var dppsRateMin = parseFloat(dppsConfig.rateMin);
    if (!(dppsRateMin >= 0 && dppsRateMin <= 1)) dppsRateMin = 0.5;
    var dppsSmoothingWindow = Math.max(
        parseInt(dppsConfig.smoothingWindow) || 100,
        1
    );
    var dppsMinFloat = parseFloat(dppsConfig.minFloat) || 0;
    var dppsActive = dppsEnabled && dppsBlockReward > 0;
    if (dppsEnabled && !dppsActive) {
        logger.error(
            logSystem,
            logComponent,
            'paymentMode "dpps" requires dpps.blockReward > 0 — D-PPS accrual is DISABLED (behaving as prop) until configured'
        );
    }
    if (dppsActive && !(dppsMinFloat > 0)) {
        logger.warning(
            logSystem,
            logComponent,
            'dpps.minFloat is 0 — the float kill-switch is effectively off; set a safety floor to bound pool liability'
        );
    }
    // fpps - FULL pay-per-share. PPS whose per-share rate also pays out the
    // pool's expected transaction fees: the rate basis is
    // (blockReward + smoothed avg tx fee) instead of just the subsidy. Each
    // matured block's fee (round.reward - blockReward) is sampled into a fee EMA
    // (feePending/feeBlocksPending -> feeEma in coin:pps:stats, rolled by
    // accruePPS); like PPS the whole matured reward goes to the float. SHARE-
    // BASED — same float / kill-switch risk as pps. See docs/payment-schemes.md.
    var fppsEnabled = paymentMode === 'fpps';
    var fppsConfig = (fppsEnabled && processingConfig.fpps) || {};
    var fppsBlockReward = parseFloat(fppsConfig.blockReward) || 0;
    var fppsFeePercent = parseFloat(fppsConfig.feePercent) || 0;
    var fppsMinFloat = parseFloat(fppsConfig.minFloat) || 0;
    var fppsFeeWindow = Math.max(parseInt(fppsConfig.feeWindow) || 100, 1);
    var fppsActive = fppsEnabled && fppsBlockReward > 0;
    if (fppsEnabled && !fppsActive) {
        logger.error(
            logSystem,
            logComponent,
            'paymentMode "fpps" requires fpps.blockReward > 0 — FPPS accrual is DISABLED (behaving as prop) until configured'
        );
    }
    if (fppsActive && !(fppsMinFloat > 0)) {
        logger.warning(
            logSystem,
            logComponent,
            'fpps.minFloat is 0 — the float kill-switch is effectively off; set a safety floor to bound pool liability'
        );
    }
    // ppsplus - PPS+. The block SUBSIDY is paid via PPS accrual (share-based,
    // from the float); each matured block's TX-FEE portion
    // (round.reward - blockReward) is distributed PPLNS-style to recent shares
    // (block-based) instead of being routed to the float. So it reuses both the
    // PPS accrual path (subsidy) and the PPLNS rolling-window path (fees). The
    // subsidy stays in the wallet to back the accrual. SHARE-BASED on the
    // subsidy leg — same float / kill-switch risk as pps.
    var ppsplusEnabled = paymentMode === 'ppsplus';
    var ppsplusConfig = (ppsplusEnabled && processingConfig.ppsplus) || {};
    var ppsplusBlockReward = parseFloat(ppsplusConfig.blockReward) || 0;
    var ppsplusFeePercent = parseFloat(ppsplusConfig.feePercent) || 0;
    var ppsplusMinFloat = parseFloat(ppsplusConfig.minFloat) || 0;
    var ppsplusN = parseFloat(ppsplusConfig.n) || 2; // fee window = N x networkDiff
    var ppsplusActive = ppsplusEnabled && ppsplusBlockReward > 0;
    if (ppsplusEnabled && !ppsplusActive) {
        logger.error(
            logSystem,
            logComponent,
            'paymentMode "ppsplus" requires ppsplus.blockReward > 0 — PPS+ accrual is DISABLED (behaving as prop) until configured'
        );
    }
    if (ppsplusActive && !(ppsplusMinFloat > 0)) {
        logger.warning(
            logSystem,
            logComponent,
            'ppsplus.minFloat is 0 — the float kill-switch is effectively off; set a safety floor to bound pool liability'
        );
    }
    // smpps / esmpps - SHARED MAXIMUM PPS family. Miners accrue a PPS-style
    // amount per share into an OWED ledger, but the pool only releases
    // owed -> coin:balances up to the income it has actually earned (matured
    // block rewards, tracked as coin:smpps:stats.budget). Credited balances
    // therefore never exceed realized income, so the pool can carry deferred
    // *debt* but never an unbacked liability — this bounds the bankruptcy risk
    // of plain PPS. smpps pays oldest debt first (FIFO, coin:smpps:debt list);
    // esmpps equalizes (every miner the same fraction of owed, coin:smpps:owed
    // hash). See docs/payment-schemes.md and src/smppsLogic.ts.
    var smppsEnabled = paymentMode === 'smpps';
    var esmppsEnabled = paymentMode === 'esmpps';
    var smppsFamilyConfig =
        ((smppsEnabled || esmppsEnabled) &&
            (processingConfig.smpps || processingConfig.esmpps)) ||
        {};
    var smppsBlockReward = parseFloat(smppsFamilyConfig.blockReward) || 0;
    var smppsFeePercent = parseFloat(smppsFamilyConfig.feePercent) || 0;
    var smppsMinFloat = parseFloat(smppsFamilyConfig.minFloat) || 0;
    var smppsActive = smppsEnabled && smppsBlockReward > 0;
    var esmppsActive = esmppsEnabled && smppsBlockReward > 0;
    var smppsFamilyActive = smppsActive || esmppsActive;
    if ((smppsEnabled || esmppsEnabled) && !smppsFamilyActive) {
        logger.error(
            logSystem,
            logComponent,
            'paymentMode "' +
                paymentMode +
                '" requires ' +
                paymentMode +
                '.blockReward > 0 — SMPPS accrual is DISABLED (behaving as prop) until configured'
        );
    }
    // Unified share-based accrual parameters. pps / dpps / fpps / ppsplus share
    // the accrual timer, the shareBuffer drain and the float kill-switch; only
    // the per-share rate basis differs (fixed (1 - feePercent) for pps/fpps/
    // ppsplus, dynamic rateScalar for dpps; fpps adds the smoothed fee to the
    // reward basis; ppsplus accrues only the subsidy). smpps/esmpps accrue per
    // share too but via a separate ledger path (accrueSMPPS), not this one.
    var accrualActive = ppsActive || dppsActive || fppsActive || ppsplusActive;
    var shareBlockReward = ppsActive
        ? ppsBlockReward
        : dppsActive
          ? dppsBlockReward
          : fppsActive
            ? fppsBlockReward
            : ppsplusActive
              ? ppsplusBlockReward
              : 0;
    var shareMinFloat = ppsActive
        ? ppsMinFloat
        : dppsActive
          ? dppsMinFloat
          : fppsActive
            ? fppsMinFloat
            : ppsplusActive
              ? ppsplusMinFloat
              : 0;
    var shareFeePercent = ppsActive
        ? ppsFeePercent
        : fppsActive
          ? fppsFeePercent
          : ppsplusActive
            ? ppsplusFeePercent
            : 0;
    var shareAccrualConfig: any = ppsActive
        ? ppsConfig
        : dppsActive
          ? dppsConfig
          : fppsActive
            ? fppsConfig
            : ppsplusActive
              ? ppsplusConfig
              : {};
    // Whether a matured block's FULL reward is NOT credited to miners directly
    // in Step 3 (they are paid via accrual instead): true for pps/dpps/fpps
    // (reward -> float) and for smpps/esmpps (reward -> income budget ledger).
    // ppsplus distributes the fee portion to miners (only the subsidy backs the
    // float), so it is NOT in this group.
    var blockToFloat =
        ppsActive || dppsActive || fppsActive || smppsFamilyActive;
    // Whether the PPLNS rolling window is maintained / consumed: pure pplns and
    // ppsplus (the latter uses it only to split tx fees).
    var pplnsWindowActive = pplnsEnabled || ppsplusActive;
    // Fee window multiplier used by the active window consumer.
    var pplnsWindowN = ppsplusActive ? ppsplusN : pplnsN;
    // Human label for the active share-based accrual mode (logs only).
    var shareModeLabel = ppsActive
        ? 'PPS'
        : dppsActive
          ? 'D-PPS'
          : fppsActive
            ? 'FPPS'
            : ppsplusActive
              ? 'PPS+'
              : 'PPS';
    // PPS-family economics need the network difficulty on the SAME scale as
    // shareData.difficulty (the stratum/vardiff scale = raw daemon difficulty x
    // the algo multiplier). coin:stats.networkDiff caches the RAW daemon
    // difficulty (getmininginfo), so the per-share rate must multiply it by the
    // algo multiplier; otherwise basePPS over-credits by the multiplier — e.g.
    // 65536x on yespower/yescrypt, where getmininginfo difficulty 0.000061 is
    // really stratum difficulty ~4. multiplier-1 algos (sha256d, quark) are
    // unaffected. Used by accruePPS / accrueSMPPS.
    var algoMultiplier =
        (algos[poolOptions.coin.algorithm] &&
            algos[poolOptions.coin.algorithm].multiplier) ||
        1;

    var requireShielding = poolOptions.coin.requireShielding === true;
    var fee = parseFloat(poolOptions.coin.txfee) || parseFloat(0.0004 as any);
    var maxUnshieldAmount = processingConfig.maxUnshieldAmount || 100.0;
    logger.debug(
        logSystem,
        logComponent,
        'maxUnshieldAmount: ' + maxUnshieldAmount
    );

    logger.debug(
        logSystem,
        logComponent,
        logComponent + ' requireShielding: ' + requireShielding
    );
    logger.debug(
        logSystem,
        logComponent,
        logComponent + ' minConf: ' + minConfShield
    );
    logger.debug(
        logSystem,
        logComponent,
        logComponent + ' payments txfee reserve: ' + fee
    );
    logger.debug(
        logSystem,
        logComponent,
        logComponent + ' maxBlocksPerPayment: ' + maxBlocksPerPayment
    );
    logger.debug(
        logSystem,
        logComponent,
        logComponent +
            ' PPLNT: ' +
            pplntEnabled +
            ', time period: ' +
            pplntTimeQualify
    );

    var daemon = new (Stratum as any).daemon.interface(
        [processingConfig.daemon],
        function (severity: any, message: any) {
            (logger as any)[severity](logSystem, logComponent, message);
        }
    );
    var redisClient = createRedisClient(poolOptions.redis, function (err: any) {
        logger.error(
            logSystem,
            logComponent,
            'Redis client had an error: ' + JSON.stringify(err.message)
        );
    });

    var magnitude: any;
    var minPaymentSatoshis: any;
    var coinPrecision: any;

    var paymentInterval: any;
    var disablePeymentProcessing = false;

    function validateAddress(callback: any) {
        var cmd = 'validateaddress';
        if (poolOptions.BTCover17) cmd = 'getaddressinfo';
        if (poolOptions.address != false) {
            daemon.cmd(
                cmd,
                [poolOptions.address],
                function (result: any) {
                    if (result.error) {
                        logger.error(
                            logSystem,
                            logComponent,
                            'Error with payment processing daemon ' +
                                JSON.stringify(result.error)
                        );
                        callback(true);
                    } else if (!result.response || !result.response.ismine) {
                        logger.error(
                            logSystem,
                            logComponent,
                            'Daemon does not own pool address - payment processing can not be done with this daemon, ' +
                                JSON.stringify(result.response)
                        );
                        callback(true);
                    } else {
                        callback();
                    }
                },
                true
            );
        } else callback();
    }
    function validateTAddress(callback: any) {
        daemon.cmd(
            'validateaddress',
            [poolOptions.tAddress],
            function (result: any) {
                if (result.error) {
                    logger.error(
                        logSystem,
                        logComponent,
                        'Error with payment processing daemon ' +
                            JSON.stringify(result.error)
                    );
                    callback(true);
                } else if (!result.response || !result.response.ismine) {
                    logger.error(
                        logSystem,
                        logComponent,
                        'Daemon does not own pool address - payment processing can not be done with this daemon, ' +
                            JSON.stringify(result.response)
                    );
                    callback(true);
                } else {
                    callback();
                }
            },
            true
        );
    }
    function validateZAddress(callback: any) {
        daemon.cmd(
            'z_validateaddress',
            [poolOptions.zAddress],
            function (result: any) {
                if (result.error) {
                    logger.error(
                        logSystem,
                        logComponent,
                        'Error with payment processing daemon ' +
                            JSON.stringify(result.error)
                    );
                    callback(true);
                } else if (!result.response || !result.response.ismine) {
                    logger.error(
                        logSystem,
                        logComponent,
                        'Daemon does not own pool address - payment processing can not be done with this daemon, ' +
                            JSON.stringify(result.response)
                    );
                    callback(true);
                } else {
                    callback();
                }
            },
            true
        );
    }
    function getBalance(callback: any) {
        daemon.cmd(
            'getbalance',
            [],
            function (result: any) {
                if (result.error) {
                    return callback(true);
                }
                try {
                    var d = result.data
                        .split('result":')[1]
                        .split(',')[0]
                        .split('.')[1];
                    magnitude = parseInt('10' + new Array(d.length).join('0'));
                    minPaymentSatoshis = parseInt(
                        (processingConfig.minimumPayment * magnitude) as any
                    );
                    coinPrecision = magnitude.toString().length - 1;
                } catch (e) {
                    logger.error(
                        logSystem,
                        logComponent,
                        'Error detecting number of satoshis in a coin, cannot do payment processing. Tried parsing: ' +
                            result.data
                    );
                    return callback(true);
                }
                callback();
            },
            true,
            true
        );
    }

    function asyncComplete(err: any) {
        if (err) {
            setupFinished(false);
            return;
        }
        if (paymentInterval) {
            //clearInterval(paymentInterval);
            clearTimeout(paymentInterval);
        }
        paymentInterval = setTimeout(
            processPayments,
            paymentIntervalSecs * 1000
        );
        //paymentInterval = setInterval(processPayments, paymentIntervalSecs * 1000);
        //setTimeout(processPayments, 100);
        setupFinished(true);
    }

    if (requireShielding === true) {
        async.parallel(
            [validateAddress, validateTAddress, validateZAddress, getBalance],
            asyncComplete
        );
    } else {
        async.parallel([validateAddress, getBalance], asyncComplete);
    }

    //get t_address coinbalance
    function listUnspent(
        addr: any,
        notAddr: any,
        minConf: any,
        displayBool: any,
        callback: any
    ) {
        if (addr !== null) {
            var args = [minConf, 99999999, [addr]];
        } else {
            addr = 'Payout wallet';
            var args = [minConf, 99999999];
        }
        daemon.cmd('listunspent', args, function (result: any) {
            if (!result || result.error || result[0].error) {
                logger.error(
                    logSystem,
                    logComponent,
                    'Error with RPC call listunspent ' +
                        addr +
                        ' ' +
                        JSON.stringify(result[0].error)
                );
                callback = function () {};
                callback(true);
            } else {
                var tBalance = parseFloat(0 as any);
                if (
                    result[0].response != null &&
                    result[0].response.length > 0
                ) {
                    for (
                        var i = 0, len = result[0].response.length;
                        i < len;
                        i++
                    ) {
                        if (
                            result[0].response[i].address &&
                            result[0].response[i].address !== notAddr
                        ) {
                            tBalance += parseFloat(
                                result[0].response[i].amount || 0
                            );
                        }
                    }
                    tBalance = coinsRound(tBalance);
                }
                if (displayBool === true) {
                    logger.special(
                        logSystem,
                        logComponent,
                        addr + ' balance of ' + tBalance
                    );
                }
                callback(null, coinsToSatoshies(tBalance), minConf);
            }
        });
    }

    // get z_address coinbalance
    function listUnspentZ(
        addr: any,
        minConf: any,
        displayBool: any,
        callback: any
    ) {
        daemon.cmd('z_getbalance', [addr, minConf], function (result: any) {
            if (!result || result.error || result[0].error) {
                logger.error(
                    logSystem,
                    logComponent,
                    'Error with RPC call z_getbalance ' +
                        addr +
                        ' ' +
                        JSON.stringify(result[0].error)
                );
                callback = function () {};
                callback(true);
            } else {
                var zBalance = parseFloat(0 as any);
                if (result[0].response != null) {
                    zBalance = coinsRound(result[0].response);
                }
                if (displayBool === true) {
                    logger.special(
                        logSystem,
                        logComponent,
                        addr.substring(0, 14) +
                            '...' +
                            addr.substring(addr.length - 14) +
                            ' balance: ' +
                            zBalance.toFixed(8)
                    );
                }
                callback(null, coinsToSatoshies(zBalance), minConf);
            }
        });
    }

    //send t_address balance to z_address
    function sendTToZ(callback: any, tBalance: any, minConf: any) {
        if (callback === true) return;
        if (tBalance === (NaN as any)) {
            logger.error(
                logSystem,
                logComponent,
                'tBalance === NaN for sendTToZ'
            );
            return;
        }
        if (tBalance - txFee <= 0) return;

        // do not allow more than a single z_sendmany operation at a time
        if (opidCount > 0) {
            logger.warning(
                logSystem,
                logComponent,
                'sendTToZ is waiting, too many z_sendmany operations already in progress.'
            );
            return;
        }

        var amount = satoshisToCoins(tBalance - txFee);
        var params = [
            poolOptions.address,
            [{ address: poolOptions.zAddress, amount: amount }],
            minConf,
            satoshisToCoins(txFee)
        ];
        daemon.cmd('z_sendmany', params, function (result: any) {
            //Check if payments failed because wallet doesn't have enough coins to pay for tx fees
            if (
                !result ||
                result.error ||
                result[0].error ||
                !result[0].response
            ) {
                logger.error(
                    logSystem,
                    logComponent,
                    'Error trying to shield balance ' +
                        amount +
                        ' ' +
                        JSON.stringify(result[0].error)
                );
                callback = function () {};
                callback(true);
            } else {
                var opid = result.response || result[0].response;
                opidCount++;
                opids.push(opid);
                logger.debug(
                    logSystem,
                    logComponent,
                    'Shield balance ' + amount + ' ' + opid
                );
                callback = function () {};
                callback(null);
            }
        });
    }

    // send z_address balance to t_address
    function sendZToT(callback: any, zBalance: any, minConf: any) {
        if (callback === true) return;
        if (zBalance === (NaN as any)) {
            logger.error(
                logSystem,
                logComponent,
                'zBalance === NaN for sendZToT'
            );
            return;
        }
        if (zBalance - txFee <= 0) return;

        // do not allow more than a single z_sendmany operation at a time
        if (opidCount > 0) {
            logger.warning(
                logSystem,
                logComponent,
                'sendZToT is waiting, too many z_sendmany operations already in progress.'
            );
            return;
        }

        var amount = satoshisToCoins(zBalance - txFee);
        // unshield no more than 100 KOTO at a time
        if (amount > maxUnshieldAmount) amount = maxUnshieldAmount;

        var params = [
            poolOptions.zAddress,
            [{ address: poolOptions.tAddress, amount: amount }],
            minConf,
            satoshisToCoins(txFee)
        ];
        daemon.cmd('z_sendmany', params, function (result: any) {
            //Check if payments failed because wallet doesn't have enough coins to pay for tx fees
            if (
                !result ||
                result.error ||
                result[0].error ||
                !result[0].response
            ) {
                logger.error(
                    logSystem,
                    logComponent,
                    'Error trying to send z_address coin balance to payout t_address.' +
                        JSON.stringify(result[0].error)
                );
                callback = function () {};
                callback(true);
            } else {
                var opid = result.response || result[0].response;
                opidCount++;
                opids.push(opid);
                logger.debug(
                    logSystem,
                    logComponent,
                    'Unshield funds for payout ' + amount + ' ' + opid
                );
                callback = function () {};
                callback(null);
            }
        });
    }

    function cacheNetworkStats() {
        var params: any = null;
        daemon.cmd('getmininginfo', params, function (result: any) {
            if (
                !result ||
                result.error ||
                result[0].error ||
                !result[0].response
            ) {
                logger.error(
                    logSystem,
                    logComponent,
                    'Error with RPC call getmininginfo ' +
                        JSON.stringify(result[0].error)
                );
                return;
            }

            var coin = logComponent;
            var finalRedisCommands: any = [];

            if (result[0].response.blocks !== null) {
                finalRedisCommands.push([
                    'hset',
                    coin + ':stats',
                    'networkBlocks',
                    result[0].response.blocks
                ]);
            }
            if (
                result[0].response.difficulty !== null &&
                typeof result[0].response.difficulty == 'object'
            ) {
                finalRedisCommands.push([
                    'hset',
                    coin + ':stats',
                    'networkDiff',
                    result[0].response.difficulty['proof-of-work']
                ]);
            } else if (result[0].response.difficulty !== null) {
                finalRedisCommands.push([
                    'hset',
                    coin + ':stats',
                    'networkDiff',
                    result[0].response.difficulty
                ]);
            }
            if (result[0].response.networkhashps !== null) {
                finalRedisCommands.push([
                    'hset',
                    coin + ':stats',
                    'networkHash',
                    result[0].response.networkhashps
                ]);
            }

            daemon.cmd(
                poolOptions.coin.getInfo ? 'getinfo' : 'getnetworkinfo',
                params,
                function (result: any) {
                    if (
                        !result ||
                        result.error ||
                        result[0].error ||
                        !result[0].response
                    ) {
                        logger.error(
                            logSystem,
                            logComponent,
                            'Error with RPC call getinfo or getnetworkinfo ' +
                                JSON.stringify(result[0].error)
                        );
                        return;
                    }

                    if (result[0].response.connections !== null) {
                        finalRedisCommands.push([
                            'hset',
                            coin + ':stats',
                            'networkConnections',
                            result[0].response.connections
                        ]);
                    }
                    if (result[0].response.version !== null) {
                        finalRedisCommands.push([
                            'hset',
                            coin + ':stats',
                            'networkVersion',
                            result[0].response.version
                        ]);
                    }
                    if (result[0].response.protocolversion !== null) {
                        finalRedisCommands.push([
                            'hset',
                            coin + ':stats',
                            'networkProtocolVersion',
                            result[0].response.protocolversion
                        ]);
                    }
                    if (
                        result[0].response.subversion !== null &&
                        result[0].response.subversion !== undefined
                    ) {
                        finalRedisCommands.push([
                            'hset',
                            coin + ':stats',
                            'networkSubVersion',
                            result[0].response.subversion
                        ]);
                    } else if (
                        poolOptions.coin.subVersion &&
                        result[0].response.version != null
                    ) {
                        // Old wallets (getInfo + noNetworkInfo, e.g. KumaCoin)
                        // expose no `subversion` over RPC — only a git build
                        // string in `version` (e.g. "v0.8.9.9-c60962c-dirty").
                        // Rebuild the P2P user-agent the daemon reports
                        // ("/Antenna:0.8.9.9/") from the coin's `subVersion`
                        // template, with {version} = the cleaned version.
                        var cleanVersion = String(result[0].response.version)
                            .replace(/^v/i, '')
                            .replace(/-.*$/, '');
                        finalRedisCommands.push([
                            'hset',
                            coin + ':stats',
                            'networkSubVersion',
                            poolOptions.coin.subVersion.replace(
                                '{version}',
                                cleanVersion
                            )
                        ]);
                    }
                    if (finalRedisCommands.length <= 0) return;

                    execCommands(redisClient, finalRedisCommands).catch(
                        function (error: any) {
                            logger.error(
                                logSystem,
                                logComponent,
                                'Error with redis during call to cacheNetworkStats() ' +
                                    JSON.stringify(error.message)
                            );
                        }
                    );
                }
            );
        });
    }

    // PPS accrual (share-based "Step 0"). Runs on its own timer when pps is
    // active. Drains coin:pps:shareBuffer (written by shareProcessor) into
    // coin:balances at a fixed per-share rate, independent of block finds. The
    // pool fronts this from its float, so a minFloat kill-switch pauses accrual
    // (retaining the buffer) when the spendable wallet balance dips too low.
    // Liability is NOT tracked here — it equals the live coin:balances total
    // (payments reduce it automatically); see /api/metrics. Refs
    // docs/payment-schemes.md.
    function accruePPS() {
        // Kill-switch / float guard: never accrue liability the wallet can't
        // back. getbalance is the spendable pool balance (the float).
        daemon.cmd('getbalance', [], function (result: any) {
            if (
                !result ||
                result.error ||
                result[0].error ||
                result[0].response == null
            ) {
                logger.error(
                    logSystem,
                    logComponent,
                    'PPS accrual: getbalance failed ' +
                        JSON.stringify(result && result[0] && result[0].error)
                );
                return;
            }
            var floatBalance = parseFloat(result[0].response) || 0;
            if (shareMinFloat > 0 && floatBalance < shareMinFloat) {
                logger.warning(
                    logSystem,
                    logComponent,
                    'Share-based accrual PAUSED (kill-switch): float ' +
                        floatBalance +
                        ' < minFloat ' +
                        shareMinFloat +
                        ' — buffer retained, miners not credited this cycle'
                );
                execCommands(redisClient, [
                    ['hset', coin + ':pps:stats', 'paused', '1'],
                    [
                        'hset',
                        coin + ':pps:stats',
                        'float',
                        floatBalance.toFixed(8)
                    ]
                ]).catch(function () {});
                return;
            }
            var statsKey = coin + ':pps:stats';
            Promise.all([
                redisClient.hGet(coin + ':stats', 'networkDiff'),
                // dpps needs the luck EMAs; fpps needs the fee EMA + pending fee
                // samples — both live in pps:stats.
                dppsActive || fppsActive
                    ? redisClient.hGetAll(statsKey)
                    : Promise.resolve({})
            ])
                .then(function (reads: any) {
                    var networkDiff = parseFloat(reads[0]) || 0;
                    var statsHash = reads[1] || {};
                    if (networkDiff <= 0) {
                        logger.warning(
                            logSystem,
                            logComponent,
                            'Share-based accrual: networkDiff not cached yet, skipping cycle'
                        );
                        return;
                    }
                    // FPPS: roll the per-block tx-fee EMA from this cycle's
                    // matured-block samples (feePending over feeBlocksPending,
                    // accumulated in Step 3), and add the smoothed fee to the
                    // reward basis so each share is paid its even slice of fees.
                    var feeEma = parseFloat(statsHash.feeEma) || 0;
                    var feePending = parseFloat(statsHash.feePending) || 0;
                    var feeBlocksPending =
                        parseFloat(statsHash.feeBlocksPending) || 0;
                    var newFeeEma = feeEma;
                    if (fppsActive && feeBlocksPending > 0) {
                        newFeeEma = emaNext(
                            feeEma,
                            avgFeePerBlock(feePending, feeBlocksPending),
                            fppsFeeWindow
                        );
                    }
                    var rewardBasis = fppsActive
                        ? fppsEffectiveReward(shareBlockReward, newFeeEma)
                        : shareBlockReward;
                    // basePPS: full value of one difficulty unit of work, in
                    // coins. networkDiff x algoMultiplier puts the cached raw
                    // daemon difficulty onto the same (stratum) scale as the
                    // accumulated shareDiff (see algoMultiplier note above).
                    var basePPS = rewardBasis / (networkDiff * algoMultiplier);
                    // Per-share rate. pps/fpps/ppsplus: fixed (1 - feePercent).
                    // dpps: dynamic rateScalar from smoothed realized luck
                    // (actualReward EMA / expectedReward EMA), floored at rateMin
                    // and capped at 1.0.
                    var expectedEma = parseFloat(statsHash.expectedEma) || 0;
                    var actualEma = parseFloat(statsHash.actualEma) || 0;
                    var actualPending =
                        parseFloat(statsHash.actualPending) || 0;
                    var rateScalar = dppsActive
                        ? dppsRateScalar(
                              realizedLuck(actualEma, expectedEma),
                              dppsTargetMargin,
                              dppsRateMin
                          )
                        : 1;
                    var effectiveRate = dppsActive
                        ? rateScalar
                        : 1 - shareFeePercent / 100;
                    // Atomically snapshot+drain: RENAME moves the live hash aside
                    // so shares arriving mid-accrual land in a fresh buffer and
                    // are never lost or double-counted.
                    redisClient
                        .rename(
                            coin + ':pps:shareBuffer',
                            coin + ':pps:draining'
                        )
                        .then(function () {
                            return redisClient.hGetAll(coin + ':pps:draining');
                        })
                        .then(function (buffer: any) {
                            var cmds: Array<Array<string | number>> = [];
                            var totalOwed = 0;
                            var totalDiff = 0;
                            for (var worker in buffer) {
                                var shareDiff = parseFloat(buffer[worker]) || 0;
                                if (shareDiff <= 0) continue;
                                var owed = basePPS * effectiveRate * shareDiff;
                                if (owed <= 0) continue;
                                cmds.push([
                                    'hincrbyfloat',
                                    coin + ':balances',
                                    worker,
                                    owed.toFixed(8)
                                ]);
                                totalOwed += owed;
                                totalDiff += shareDiff;
                            }
                            cmds.push(['del', coin + ':pps:draining']);
                            cmds.push(['hset', statsKey, 'paused', '0']);
                            cmds.push([
                                'hset',
                                statsKey,
                                'float',
                                floatBalance.toFixed(8)
                            ]);
                            cmds.push([
                                'hset',
                                statsKey,
                                'sharePPS',
                                basePPS.toFixed(12)
                            ]);
                            if (totalOwed > 0) {
                                cmds.push([
                                    'hincrbyfloat',
                                    statsKey,
                                    'accruedTotal',
                                    totalOwed.toFixed(8)
                                ]);
                            }
                            if (fppsActive) {
                                // Persist the rolled fee EMA and clear this
                                // cycle's pending samples (subtract the snapshot
                                // so a block maturing mid-cycle is not lost).
                                cmds.push(['hset', statsKey, 'mode', 'fpps']);
                                cmds.push([
                                    'hset',
                                    statsKey,
                                    'feeEma',
                                    newFeeEma.toFixed(8)
                                ]);
                                if (feePending !== 0) {
                                    cmds.push([
                                        'hincrbyfloat',
                                        statsKey,
                                        'feePending',
                                        (-feePending).toFixed(8)
                                    ]);
                                }
                                if (feeBlocksPending !== 0) {
                                    cmds.push([
                                        'hincrbyfloat',
                                        statsKey,
                                        'feeBlocksPending',
                                        String(-feeBlocksPending)
                                    ]);
                                }
                            }
                            if (dppsActive) {
                                // Roll the luck EMAs with this cycle's flows:
                                // expected = full-PPS value of the drained work,
                                // actual = block rewards received since the last
                                // cycle (actualPending, accrued in Step 3). Reset
                                // pending by subtracting the snapshot so a block
                                // maturing mid-cycle is not lost.
                                var newExpectedEma = emaNext(
                                    expectedEma,
                                    basePPS * totalDiff,
                                    dppsSmoothingWindow
                                );
                                var newActualEma = emaNext(
                                    actualEma,
                                    actualPending,
                                    dppsSmoothingWindow
                                );
                                cmds.push(['hset', statsKey, 'mode', 'dpps']);
                                cmds.push([
                                    'hset',
                                    statsKey,
                                    'expectedEma',
                                    newExpectedEma.toFixed(8)
                                ]);
                                cmds.push([
                                    'hset',
                                    statsKey,
                                    'actualEma',
                                    newActualEma.toFixed(8)
                                ]);
                                cmds.push([
                                    'hset',
                                    statsKey,
                                    'realizedLuck',
                                    realizedLuck(
                                        newActualEma,
                                        newExpectedEma
                                    ).toFixed(6)
                                ]);
                                cmds.push([
                                    'hset',
                                    statsKey,
                                    'rateScalar',
                                    rateScalar.toFixed(6)
                                ]);
                                if (actualPending !== 0) {
                                    cmds.push([
                                        'hincrbyfloat',
                                        statsKey,
                                        'actualPending',
                                        (-actualPending).toFixed(8)
                                    ]);
                                }
                            }
                            return execCommands(redisClient, cmds).then(
                                function () {
                                    if (totalOwed > 0) {
                                        logger.debug(
                                            logSystem,
                                            logComponent,
                                            shareModeLabel +
                                                ' accrued ' +
                                                totalOwed.toFixed(8) +
                                                ' over ' +
                                                totalDiff +
                                                ' share-diff (basePPS ' +
                                                basePPS.toFixed(12) +
                                                ', rate ' +
                                                effectiveRate.toFixed(6) +
                                                ', float ' +
                                                floatBalance +
                                                ')'
                                        );
                                    }
                                }
                            );
                        })
                        .catch(function (err: any) {
                            // RENAME rejects when no shares accumulated since the
                            // last cycle (key missing) — benign, nothing to do.
                            if (
                                err &&
                                /no such key/i.test(String(err.message))
                            ) {
                                return;
                            }
                            logger.error(
                                logSystem,
                                logComponent,
                                'Share-based accrual drain error: ' +
                                    JSON.stringify(err && err.message)
                            );
                        });
                })
                .catch(function (err: any) {
                    logger.error(
                        logSystem,
                        logComponent,
                        'Share-based accrual: redis error reading stats ' +
                            JSON.stringify(err && err.message)
                    );
                });
        });
    }

    // SMPPS-family accrual (smpps / esmpps). Separate from accruePPS: instead of
    // crediting coin:balances directly, each cycle drains coin:pps:shareBuffer
    // into an OWED ledger and then RELEASES owed -> coin:balances limited by the
    // pool's realized income (coin:smpps:stats.budget, fed by matured blocks in
    // Step 3). So balances never exceed income — the pool may carry deferred
    // debt but never an unbacked liability. smpps releases oldest debt first
    // (FIFO list coin:smpps:debt); esmpps equalizes (hash coin:smpps:owed).
    function accrueSMPPS() {
        daemon.cmd('getbalance', [], function (result: any) {
            if (
                !result ||
                result.error ||
                result[0].error ||
                result[0].response == null
            ) {
                logger.error(
                    logSystem,
                    logComponent,
                    'SMPPS accrual: getbalance failed ' +
                        JSON.stringify(result && result[0] && result[0].error)
                );
                return;
            }
            var floatBalance = parseFloat(result[0].response) || 0;
            var statsKey = coin + ':smpps:stats';
            if (smppsMinFloat > 0 && floatBalance < smppsMinFloat) {
                logger.warning(
                    logSystem,
                    logComponent,
                    'SMPPS release PAUSED (kill-switch): float ' +
                        floatBalance +
                        ' < minFloat ' +
                        smppsMinFloat
                );
                execCommands(redisClient, [
                    ['hset', statsKey, 'paused', '1'],
                    ['hset', statsKey, 'float', floatBalance.toFixed(8)]
                ]).catch(function () {});
                return;
            }
            Promise.all([
                redisClient.hGet(coin + ':stats', 'networkDiff'),
                redisClient.hGet(statsKey, 'budget')
            ])
                .then(function (reads: any) {
                    var networkDiff = parseFloat(reads[0]) || 0;
                    var budget = parseFloat(reads[1]) || 0;
                    if (networkDiff <= 0) {
                        logger.warning(
                            logSystem,
                            logComponent,
                            'SMPPS accrual: networkDiff not cached yet, skipping cycle'
                        );
                        return;
                    }
                    // networkDiff x algoMultiplier → same scale as shareDiff
                    // (see algoMultiplier note); without it basePPS over-credits
                    // by the multiplier on yespower/yescrypt etc.
                    var basePPS =
                        smppsBlockReward / (networkDiff * algoMultiplier);
                    var rate = 1 - smppsFeePercent / 100;
                    // Drain this cycle's shares (RENAME+HGETALL); "no such key"
                    // just means no new shares — we still release budget against
                    // any existing debt (backpay).
                    redisClient
                        .rename(
                            coin + ':pps:shareBuffer',
                            coin + ':smpps:draining'
                        )
                        .then(function () {
                            return redisClient.hGetAll(
                                coin + ':smpps:draining'
                            );
                        })
                        .catch(function (err: any) {
                            if (/no such key/i.test(String(err && err.message)))
                                return {};
                            throw err;
                        })
                        .then(function (buffer: any) {
                            var newOwed: Record<string, number> = {};
                            for (var w in buffer) {
                                var d = parseFloat(buffer[w]) || 0;
                                if (d <= 0) continue;
                                var owed = basePPS * rate * d;
                                if (owed > 0)
                                    newOwed[w] = (newOwed[w] || 0) + owed;
                            }
                            if (esmppsActive) {
                                return releaseEsmpps(
                                    newOwed,
                                    budget,
                                    floatBalance,
                                    statsKey
                                );
                            }
                            return releaseSmpps(
                                newOwed,
                                budget,
                                floatBalance,
                                statsKey
                            );
                        })
                        .catch(function (err: any) {
                            logger.error(
                                logSystem,
                                logComponent,
                                'SMPPS accrual error: ' +
                                    JSON.stringify(err && err.message)
                            );
                        });
                })
                .catch(function (err: any) {
                    logger.error(
                        logSystem,
                        logComponent,
                        'SMPPS accrual: redis error reading stats ' +
                            JSON.stringify(err && err.message)
                    );
                });
        });
    }

    // ESMPPS release: merge new owed into the owed hash, then pay every miner the
    // same fraction of their outstanding owed that the income budget allows.
    function releaseEsmpps(
        newOwed: Record<string, number>,
        budget: number,
        floatBalance: number,
        statsKey: string
    ) {
        return redisClient.hGetAll(coin + ':smpps:owed').then(function (
            prev: any
        ) {
            var owedMap: Record<string, number> = {};
            for (var w in prev) {
                var v = parseFloat(prev[w]) || 0;
                if (v > 0) owedMap[w] = v;
            }
            for (var nw in newOwed)
                owedMap[nw] = (owedMap[nw] || 0) + newOwed[nw];
            var alloc = esmppsAllocate(owedMap, budget);
            var cmds: Array<Array<string | number>> = [];
            cmds.push(['del', coin + ':smpps:draining']);
            cmds.push(['del', coin + ':smpps:owed']);
            var totalPaid = 0;
            for (var w2 in owedMap) {
                var paid = alloc.paid[w2] || 0;
                if (paid > 0) {
                    cmds.push([
                        'hincrbyfloat',
                        coin + ':balances',
                        w2,
                        paid.toFixed(8)
                    ]);
                    totalPaid += paid;
                }
                var rem = owedMap[w2] - paid;
                if (rem > 1e-12)
                    cmds.push([
                        'hset',
                        coin + ':smpps:owed',
                        w2,
                        rem.toFixed(8)
                    ]);
            }
            return finishSmppsRelease(
                cmds,
                totalPaid,
                floatBalance,
                statsKey,
                'esmpps'
            );
        });
    }

    // SMPPS release: append new owed batches to the FIFO debt list, then pay it
    // down oldest-first up to the income budget; rewrite the remaining debt.
    function releaseSmpps(
        newOwed: Record<string, number>,
        budget: number,
        floatBalance: number,
        statsKey: string
    ) {
        return redisClient.lRange(coin + ':smpps:debt', 0, -1).then(function (
            entries: any
        ) {
            var queue = (entries || [])
                .map(parseDebtEntry)
                .filter(Boolean) as Array<{ worker: string; owed: number }>;
            for (var w in newOwed) queue.push({ worker: w, owed: newOwed[w] });
            var alloc = smppsAllocate(queue, budget);
            var cmds: Array<Array<string | number>> = [];
            cmds.push(['del', coin + ':smpps:draining']);
            var totalPaid = 0;
            for (var pw in alloc.paid) {
                var paid = alloc.paid[pw];
                if (paid > 0) {
                    cmds.push([
                        'hincrbyfloat',
                        coin + ':balances',
                        pw,
                        paid.toFixed(8)
                    ]);
                    totalPaid += paid;
                }
            }
            cmds.push(['del', coin + ':smpps:debt']);
            if (alloc.remaining.length > 0) {
                cmds.push(
                    (
                        ['rpush', coin + ':smpps:debt'] as Array<
                            string | number
                        >
                    ).concat(
                        alloc.remaining.map(function (b) {
                            return b.worker + ':' + b.owed.toFixed(8);
                        })
                    )
                );
            }
            return finishSmppsRelease(
                cmds,
                totalPaid,
                floatBalance,
                statsKey,
                'smpps'
            );
        });
    }

    // Shared tail for both SMPPS releases: decrement the budget by what was paid
    // (hincrbyfloat, not hset, so income arriving mid-cycle in Step 3 is never
    // overwritten), stamp stats, and run the MULTI.
    function finishSmppsRelease(
        cmds: Array<Array<string | number>>,
        totalPaid: number,
        floatBalance: number,
        statsKey: string,
        mode: string
    ) {
        if (totalPaid > 0) {
            cmds.push([
                'hincrbyfloat',
                statsKey,
                'budget',
                (-totalPaid).toFixed(8)
            ]);
            cmds.push([
                'hincrbyfloat',
                statsKey,
                'paidTotal',
                totalPaid.toFixed(8)
            ]);
        }
        cmds.push(['hset', statsKey, 'paused', '0']);
        cmds.push(['hset', statsKey, 'mode', mode]);
        cmds.push(['hset', statsKey, 'float', floatBalance.toFixed(8)]);
        return execCommands(redisClient, cmds).then(function () {
            if (totalPaid > 0) {
                logger.debug(
                    logSystem,
                    logComponent,
                    mode.toUpperCase() +
                        ' released ' +
                        totalPaid.toFixed(8) +
                        ' from income budget (float ' +
                        floatBalance +
                        ')'
                );
            }
        });
    }

    // run shielding process every x minutes (walletInterval). Default is a
    // moderate 10 min: z_sendmany is slow/fee-bearing, so a 1-minute cadence
    // just spams tiny shields and the code below even warns when the interval is
    // shorter than an operation's execution time. Override per coin in the
    // pool config (the koto example uses 2.5).
    var shieldIntervalState = 0; // do not send ZtoT and TtoZ and same time, this results in operation failed!
    var shielding_interval =
        Math.max(parseInt(poolOptions.walletInterval || 10), 1) * 60 * 1000; // run every x minutes
    // shielding not required for some equihash coins
    if (requireShielding === true) {
        var shieldInterval = setInterval(function () {
            shieldIntervalState++;
            switch (shieldIntervalState) {
                case 1:
                    listUnspent(
                        poolOptions.address,
                        null,
                        minConfShield,
                        false,
                        sendTToZ
                    );
                    break;
                default:
                    listUnspentZ(
                        poolOptions.zAddress,
                        minConfShield,
                        false,
                        sendZToT
                    );
                    shieldIntervalState = 0;
                    break;
            }
        }, shielding_interval);
    }

    // network stats caching every 58 seconds
    var stats_interval = 58 * 1000;
    var statsInterval = setInterval(function () {
        // update network stats using coin daemon
        cacheNetworkStats();
    }, stats_interval);

    // Share-based accrual timer — only when a share-based mode is active (mode
    // set + blockReward > 0: pps/dpps/fpps/ppsplus). Drains the per-share buffer
    // into coin:balances decoupled from block finds. Default 60s; override with
    // {pps|dpps|fpps|ppsplus}.accrualInterval (min 10s).
    if (accrualActive) {
        var ppsAccrualMs =
            Math.max(parseInt(shareAccrualConfig.accrualInterval) || 60, 10) *
            1000;
        setInterval(accruePPS, ppsAccrualMs);
        logger.debug(
            logSystem,
            logComponent,
            shareModeLabel +
                ' accrual enabled (blockReward ' +
                shareBlockReward +
                (dppsActive
                    ? ', targetMargin ' +
                      dppsTargetMargin +
                      ', rateMin ' +
                      dppsRateMin +
                      ', smoothingWindow ' +
                      dppsSmoothingWindow
                    : ', fee ' + shareFeePercent + '%') +
                (fppsActive ? ', feeWindow ' + fppsFeeWindow : '') +
                (ppsplusActive ? ', feeWindowN ' + ppsplusN : '') +
                ', minFloat ' +
                shareMinFloat +
                ', every ' +
                ppsAccrualMs / 1000 +
                's)'
        );
    }

    // SMPPS-family release timer — drains shares into the owed ledger and
    // releases owed -> balances bounded by realized income. Default 60s; override
    // with {smpps|esmpps}.accrualInterval (min 10s).
    if (smppsFamilyActive) {
        var smppsAccrualMs =
            Math.max(parseInt(smppsFamilyConfig.accrualInterval) || 60, 10) *
            1000;
        setInterval(accrueSMPPS, smppsAccrualMs);
        logger.debug(
            logSystem,
            logComponent,
            (esmppsActive ? 'ESMPPS' : 'SMPPS') +
                ' accrual enabled (blockReward ' +
                smppsBlockReward +
                ', fee ' +
                smppsFeePercent +
                '%, minFloat ' +
                smppsMinFloat +
                ', every ' +
                smppsAccrualMs / 1000 +
                's)'
        );
    }

    // check operation statuses every 57 seconds
    var opid_interval = 57 * 1000;
    // shielding not required for some equihash coins
    if (requireShielding === true) {
        var checkOpids = function () {
            clearTimeout(opidTimeout);
            var checkOpIdSuccessAndGetResult = function (ops: any) {
                var batchRPC: any = [];
                // if there are no op-ids
                if (ops.length == 0) {
                    // and we think there is
                    if (opidCount !== 0) {
                        // clear them!
                        opidCount = 0;
                        opids = [];
                        logger.warning(
                            logSystem,
                            logComponent,
                            'Clearing operation ids due to empty result set.'
                        );
                    }
                }
                // loop through op-ids checking their status
                ops.forEach(function (op: any, i: any) {
                    // check operation id status
                    if (op.status == 'success' || op.status == 'failed') {
                        // clear operation id result
                        var opid_index = opids.indexOf(op.id);
                        if (opid_index > -1) {
                            // clear operation id count
                            batchRPC.push(['z_getoperationresult', [[op.id]]]);
                            opidCount--;
                            opids.splice(opid_index, 1);
                        }
                        // log status to console
                        if (op.status == 'failed') {
                            if (op.error) {
                                logger.error(
                                    logSystem,
                                    logComponent,
                                    'Shielding operation failed ' +
                                        op.id +
                                        ' ' +
                                        op.error.code +
                                        ', ' +
                                        op.error.message
                                );
                            } else {
                                logger.error(
                                    logSystem,
                                    logComponent,
                                    'Shielding operation failed ' + op.id
                                );
                            }
                        } else {
                            logger.debug(
                                logSystem,
                                logComponent,
                                'Shielding operation success ' +
                                    op.id +
                                    '  txid: ' +
                                    op.result.txid
                            );
                        }
                    } else if (op.status == 'executing') {
                        logger.debug(
                            logSystem,
                            logComponent,
                            'Shielding operation in progress ' + op.id
                        );
                    }
                });
                // if there are no completed operations
                if (batchRPC.length <= 0) {
                    opidTimeout = setTimeout(checkOpids, opid_interval);
                    return;
                }
                // clear results for completed operations
                daemon.batchCmd(batchRPC, function (error: any, results: any) {
                    if (error || !results) {
                        opidTimeout = setTimeout(checkOpids, opid_interval);
                        logger.error(
                            logSystem,
                            logComponent,
                            'Error with RPC call z_getoperationresult ' +
                                JSON.stringify(error)
                        );
                        return;
                    }
                    // check result execution_secs vs pool_config
                    results.forEach(function (result: any, i: any) {
                        if (
                            result.result[i] &&
                            parseFloat(result.result[i].execution_secs || 0) >
                                shielding_interval
                        ) {
                            logger.warning(
                                logSystem,
                                logComponent,
                                'Warning, walletInverval shorter than opid execution time of ' +
                                    result.result[i].execution_secs +
                                    ' secs.'
                            );
                        }
                    });
                    // keep checking operation ids
                    opidTimeout = setTimeout(checkOpids, opid_interval);
                });
            };
            // check for completed operation ids
            daemon.cmd(
                'z_getoperationstatus',
                null,
                function (result: any) {
                    var err = false;
                    if (result.error) {
                        err = true;
                        logger.error(
                            logSystem,
                            logComponent,
                            'Error with RPC call z_getoperationstatus ' +
                                JSON.stringify(result.error)
                        );
                    } else if (result.response) {
                        checkOpIdSuccessAndGetResult(result.response);
                    } else {
                        err = true;
                        logger.error(
                            logSystem,
                            logComponent,
                            'No response from z_getoperationstatus RPC call.'
                        );
                    }
                    if (err === true) {
                        opidTimeout = setTimeout(checkOpids, opid_interval);
                        if (opidCount !== 0) {
                            opidCount = 0;
                            opids = [];
                            logger.warning(
                                logSystem,
                                logComponent,
                                'Clearing operation ids due to RPC call errors.'
                            );
                        }
                    }
                },
                true,
                true
            );
        };
        var opidTimeout = setTimeout(checkOpids, opid_interval);
    }

    function roundTo(n: any, digits: any) {
        if (digits === undefined) {
            digits = 0;
        }
        var multiplicator = Math.pow(10, digits);
        n = parseFloat((n * multiplicator).toFixed(11));
        var test = Math.round(n) / multiplicator;
        return +test.toFixed(digits);
    }

    var satoshisToCoins = function (satoshis: any) {
        return roundTo(satoshis / magnitude, coinPrecision);
    };

    var coinsToSatoshies = function (coins: any) {
        return Math.round(coins * magnitude);
    };

    function coinsRound(number: any) {
        return roundTo(number, coinPrecision);
    }

    function checkForDuplicateBlockHeight(rounds: any, height: any) {
        var count = 0;
        for (var i = 0; i < rounds.length; i++) {
            if (rounds[i].height == height) count++;
        }
        return count > 1;
    }

    /* Deal with numbers in smallest possible units (satoshis) as much as possible. This greatly helps with accuracy
       when rounding and whatnot. When we are storing numbers for only humans to see, store in whole coin units. */

    var processPayments = function () {
        var startPaymentProcess = Date.now();

        var timeSpentRPC = 0;
        var timeSpentRedis = 0;

        var startTimeRedis: any;
        var startTimeRPC: any;

        var startRedisTimer = function () {
            startTimeRedis = Date.now();
        };
        var endRedisTimer = function () {
            timeSpentRedis += Date.now() - startTimeRedis;
        };

        var startRPCTimer = function () {
            startTimeRPC = Date.now();
        };
        var endRPCTimer = function () {
            timeSpentRPC += Date.now() - startTimeRedis;
        };

        // PPLNS: load the per-block share-log snapshots and resolve the window
        // (pplnsN x current networkDiff) into per-round { worker -> windowDiff }
        // maps, keyed by block height. Returns null (and a no-op) for every
        // non-PPLNS mode. The window is sized by the *current* cached
        // networkDiff; an off-by-a-little network difficulty only shifts which
        // shares fall in the window, never the total reward paid (the full block
        // reward is always distributed proportionally among the window).
        var loadPplnsTotals = function (rounds: any, cb: any) {
            if (!pplnsWindowActive) return cb(null);
            var pm = redisClient.multi();
            pm.hGet(coin + ':stats', 'networkDiff');
            rounds.forEach(function (r: any) {
                pm.lRange(coin + ':shares:pplnsRound' + r.height, 0, -1);
            });
            startRedisTimer();
            pm.exec().then(
                function (res: any) {
                    endRedisTimer();
                    var networkDiff = parseFloat(res[0]) || 0;
                    var windowDiff = pplnsWindowN * networkDiff;
                    var byHeight: any = {};
                    rounds.forEach(function (r: any, i: any) {
                        var entries = (res[i + 1] || [])
                            .map(parsePplnsEntry)
                            .filter(Boolean);
                        byHeight[r.height] = pplnsShareTotals(
                            entries,
                            windowDiff
                        ).totals;
                    });
                    cb(byHeight);
                },
                function (error: any) {
                    endRedisTimer();
                    logger.error(
                        logSystem,
                        logComponent,
                        'Error loading PPLNS share-log snapshots ' +
                            JSON.stringify(error && error.message)
                    );
                    cb(null);
                }
            );
        };

        async.waterfall(
            [
                /*
                Step 1 - build workers and rounds objects from redis
                         * removes duplicate block submissions from redis
            */
                function (callback: any) {
                    startRedisTimer();
                    redisClient
                        .multi()
                        .hGetAll(coin + ':balances')
                        .sMembers(coin + ':blocksPending')
                        .exec()
                        .then(
                            function (results: any) {
                                endRedisTimer();
                                // build workers object from :balances
                                var workers: any = {};
                                for (var w in results[0]) {
                                    workers[w] = {
                                        balance: coinsToSatoshies(
                                            parseFloat(results[0][w])
                                        )
                                    };
                                }
                                // build rounds object from :blocksPending
                                var rounds: any = results[1].map(function (
                                    r: any
                                ) {
                                    var details = r.split(':');
                                    return {
                                        blockHash: details[0],
                                        txHash: details[1],
                                        height: details[2],
                                        minedby: details[3],
                                        time: details[4],
                                        duplicate: false,
                                        serialized: r
                                    };
                                });
                                /* sort rounds by block hieght to pay in order */
                                rounds.sort(function (a: any, b: any) {
                                    return a.height - b.height;
                                });
                                // find duplicate blocks by height
                                // this can happen when two or more solutions are submitted at the same block height
                                var duplicateFound = false;
                                for (var i = 0; i < rounds.length; i++) {
                                    if (
                                        checkForDuplicateBlockHeight(
                                            rounds,
                                            rounds[i].height
                                        ) === true
                                    ) {
                                        rounds[i].duplicate = true;
                                        duplicateFound = true;
                                    }
                                }
                                // handle duplicates if needed
                                if (duplicateFound) {
                                    var dups = rounds.filter(function (
                                        round: any
                                    ) {
                                        return round.duplicate;
                                    });
                                    logger.warning(
                                        logSystem,
                                        logComponent,
                                        'Duplicate pending blocks found: ' +
                                            JSON.stringify(dups)
                                    );
                                    // attempt to find the invalid duplicates
                                    var rpcDupCheck = dups.map(function (
                                        r: any
                                    ) {
                                        return ['getblock', [r.blockHash]];
                                    });
                                    startRPCTimer();
                                    daemon.batchCmd(
                                        rpcDupCheck,
                                        function (error: any, blocks: any) {
                                            endRPCTimer();
                                            if (error || !blocks) {
                                                logger.error(
                                                    logSystem,
                                                    logComponent,
                                                    'Error with duplicate block check rpc call getblock ' +
                                                        JSON.stringify(error)
                                                );
                                                return;
                                            }
                                            // look for the invalid duplicate block
                                            var validBlocks: any = {}; // hashtable for unique look up
                                            var invalidBlocks: any = []; // array for redis work
                                            blocks.forEach(function (
                                                block: any,
                                                i: any
                                            ) {
                                                if (block && block.result) {
                                                    // invalid duplicate submit blocks have negative confirmations
                                                    if (
                                                        block.result
                                                            .confirmations <= 0
                                                    ) {
                                                        logger.warning(
                                                            logSystem,
                                                            logComponent,
                                                            'Remove invalid duplicate block ' +
                                                                block.result
                                                                    .height +
                                                                ' > ' +
                                                                block.result
                                                                    .hash
                                                        );
                                                        // move from blocksPending to blocksDuplicate...
                                                        invalidBlocks.push([
                                                            'smove',
                                                            coin +
                                                                ':blocksPending',
                                                            coin +
                                                                ':blocksDuplicate',
                                                            dups[i].serialized
                                                        ]);
                                                    } else {
                                                        // block must be valid, make sure it is unique
                                                        if (
                                                            validBlocks.hasOwnProperty(
                                                                dups[i]
                                                                    .blockHash
                                                            )
                                                        ) {
                                                            // not unique duplicate block
                                                            logger.warning(
                                                                logSystem,
                                                                logComponent,
                                                                'Remove non-unique duplicate block ' +
                                                                    block.result
                                                                        .height +
                                                                    ' > ' +
                                                                    block.result
                                                                        .hash
                                                            );
                                                            // move from blocksPending to blocksDuplicate...
                                                            invalidBlocks.push([
                                                                'smove',
                                                                coin +
                                                                    ':blocksPending',
                                                                coin +
                                                                    ':blocksDuplicate',
                                                                dups[i]
                                                                    .serialized
                                                            ]);
                                                        } else {
                                                            // keep unique valid block
                                                            validBlocks[
                                                                dups[
                                                                    i
                                                                ].blockHash
                                                            ] =
                                                                dups[
                                                                    i
                                                                ].serialized;
                                                            logger.debug(
                                                                logSystem,
                                                                logComponent,
                                                                'Keep valid duplicate block ' +
                                                                    block.result
                                                                        .height +
                                                                    ' > ' +
                                                                    block.result
                                                                        .hash
                                                            );
                                                        }
                                                    }
                                                } else if (
                                                    block &&
                                                    block.error &&
                                                    block.error.code === -5
                                                ) {
                                                    // Block not found, move to blocksDuplicate
                                                    logger.warning(
                                                        logSystem,
                                                        logComponent,
                                                        'Remove invalid duplicate block: ' +
                                                            dups[i].blockHash
                                                    );
                                                    invalidBlocks.push([
                                                        'smove',
                                                        coin + ':blocksPending',
                                                        coin +
                                                            ':blocksDuplicate',
                                                        dups[i].serialized
                                                    ]);
                                                }
                                            });
                                            // filter out all duplicates to prevent double payments
                                            rounds = rounds.filter(function (
                                                round: any
                                            ) {
                                                return !round.duplicate;
                                            });
                                            // if we detected the invalid duplicates, move them
                                            if (invalidBlocks.length > 0) {
                                                // move invalid duplicate blocks in redis
                                                startRedisTimer();
                                                execCommands(
                                                    redisClient,
                                                    invalidBlocks
                                                ).then(
                                                    function () {
                                                        endRedisTimer();
                                                        // continue payments normally
                                                        callback(
                                                            null,
                                                            workers,
                                                            rounds
                                                        );
                                                    },
                                                    function (error: any) {
                                                        endRedisTimer();
                                                        logger.error(
                                                            logSystem,
                                                            logComponent,
                                                            'Error could not move invalid duplicate blocks in redis ' +
                                                                JSON.stringify(
                                                                    error.message
                                                                )
                                                        );
                                                        // continue payments normally
                                                        callback(
                                                            null,
                                                            workers,
                                                            rounds
                                                        );
                                                    }
                                                );
                                            } else {
                                                // notify pool owner that we are unable to find the invalid duplicate blocks, manual intervention required...
                                                logger.error(
                                                    logSystem,
                                                    logComponent,
                                                    'Unable to detect invalid duplicate blocks, duplicate block payments on hold.'
                                                );
                                                // continue payments normally
                                                callback(null, workers, rounds);
                                            }
                                        }
                                    );
                                } else {
                                    // no duplicates, continue payments normally
                                    callback(null, workers, rounds);
                                }
                            },
                            function (error: any) {
                                endRedisTimer();
                                logger.error(
                                    logSystem,
                                    logComponent,
                                    'Could not get blocks from redis ' +
                                        JSON.stringify(error.message)
                                );
                                callback(true);
                            }
                        );
                },

                /*
                Step 2 - check if mined block coinbase tx are ready for payment
                         * adds block reward to rounds object
                         * adds block confirmations count to rounds object
            */
                function (workers: any, rounds: any, callback: any) {
                    // get pending block tx details
                    var batchRPCcommand = rounds.map(function (r: any) {
                        return ['gettransaction', [r.txHash]];
                    });
                    // get account address (not implemented at this time)
                    batchRPCcommand.push(['getaccount', [poolOptions.address]]);

                    startRPCTimer();
                    daemon.batchCmd(
                        batchRPCcommand,
                        function (error: any, txDetails: any) {
                            endRPCTimer();
                            if (error || !txDetails) {
                                logger.error(
                                    logSystem,
                                    logComponent,
                                    'Check finished - daemon rpc error with batch gettransactions ' +
                                        JSON.stringify(error)
                                );
                                callback(true);
                                return;
                            }

                            var addressAccount = '';

                            // check for transaction errors and generated coins
                            txDetails.forEach(function (tx: any, i: any) {
                                if (i === txDetails.length - 1) {
                                    if (
                                        tx.result &&
                                        tx.result.toString().length > 0
                                    ) {
                                        addressAccount = tx.result.toString();
                                    }
                                    return;
                                }
                                var round = rounds[i];
                                // update confirmations for round
                                //round.confirmations = parseInt((tx.result.confirmations || 0));
                                // look for transaction errors
                                if (tx.error && tx.error.code === -5) {
                                    logger.warning(
                                        logSystem,
                                        logComponent,
                                        'Daemon reports invalid transaction: ' +
                                            round.txHash
                                    );
                                    round.category = 'kicked';
                                    return;
                                } else if (
                                    !tx.result.details ||
                                    (tx.result.details &&
                                        tx.result.details.length === 0)
                                ) {
                                    logger.warning(
                                        logSystem,
                                        logComponent,
                                        'Daemon reports no details for transaction: ' +
                                            round.txHash
                                    );
                                    round.category = 'kicked';
                                    return;
                                } else if (tx.error || !tx.result) {
                                    logger.error(
                                        logSystem,
                                        logComponent,
                                        'Odd error with gettransaction ' +
                                            round.txHash +
                                            ' ' +
                                            JSON.stringify(tx)
                                    );
                                    return;
                                }
                                // update confirmations for round
                                round.confirmations = parseInt(
                                    tx.result.confirmations || 0
                                );
                                // get the coin base generation tx
                                var generationTx = tx.result.details.filter(
                                    function (tx: any) {
                                        return (
                                            tx.address === poolOptions.address
                                        );
                                    }
                                )[0];
                                if (
                                    !generationTx &&
                                    tx.result.details.length === 1
                                ) {
                                    generationTx = tx.result.details[0];
                                }
                                if (!generationTx) {
                                    logger.error(
                                        logSystem,
                                        logComponent,
                                        'Missing output details to pool address for transaction ' +
                                            round.txHash
                                    );
                                    return;
                                }
                                // get transaction category for round
                                round.category = generationTx.category;
                                // get reward for newly generated blocks
                                if (
                                    round.category === 'generate' ||
                                    round.category === 'immature'
                                ) {
                                    round.reward = coinsRound(
                                        parseFloat(
                                            generationTx.amount ||
                                                generationTx.value
                                        )
                                    );
                                }
                            });

                            var canDeleteShares = function (r: any) {
                                for (var i = 0; i < rounds.length; i++) {
                                    var compareR = rounds[i];
                                    if (
                                        compareR.height === r.height &&
                                        compareR.category !== 'kicked' &&
                                        compareR.category !== 'orphan' &&
                                        compareR.serialized !== r.serialized
                                    ) {
                                        return false;
                                    }
                                }
                                return true;
                            };

                            // only pay max blocks at a time
                            var payingBlocks = 0;
                            rounds = rounds.filter(function (r: any) {
                                switch (r.category) {
                                    case 'orphan':
                                    case 'kicked':
                                        r.canDeleteShares = canDeleteShares(r);
                                    case 'immature':
                                        return true;
                                    case 'generate':
                                        payingBlocks++;
                                        // if over maxBlocksPerPayment...
                                        // change category to immature to prevent payment
                                        // and to keep track of confirmations/immature balances
                                        if (payingBlocks > maxBlocksPerPayment)
                                            r.category = 'immature';
                                        return true;
                                    default:
                                        return false;
                                }
                            });

                            // continue to next step in waterfall (loading the
                            // PPLNS window snapshots first when in pplns mode)
                            loadPplnsTotals(
                                rounds,
                                function (pplnsTotals: any) {
                                    callback(
                                        null,
                                        workers,
                                        rounds,
                                        addressAccount,
                                        pplnsTotals
                                    );
                                }
                            );
                        }
                    );
                },

                /*
                Step 3 - lookup shares and calculate rewards
                         * pull pplnt times from redis
                         * pull shares from redis
                         * calculate rewards
                         * pplnt share reductions if needed
                         * for pplns, swap the per-round share hash for the
                           pre-resolved last-N-shares window totals
            */
                function (
                    workers: any,
                    rounds: any,
                    addressAccount: any,
                    pplnsTotals: any,
                    callback: any
                ) {
                    // pplnt times lookup
                    var timesMulti = redisClient.multi();
                    rounds.forEach(function (r: any) {
                        timesMulti.hGetAll(coin + ':shares:times' + r.height);
                    });
                    startRedisTimer();
                    timesMulti.exec().then(
                        function (allWorkerTimes: any) {
                            endRedisTimer();
                            // shares lookup
                            var sharesMulti = redisClient.multi();
                            rounds.forEach(function (r: any) {
                                sharesMulti.hGetAll(
                                    coin + ':shares:round' + r.height
                                );
                            });
                            startRedisTimer();
                            sharesMulti.exec().then(
                                function (allWorkerShares: any) {
                                    endRedisTimer();

                                    // PPLNS: for blocks we are about to pay or
                                    // mark immature, replace the per-round share
                                    // hash with the last-N-shares window totals
                                    // resolved in Step 2. Orphan/kicked rounds
                                    // keep their real round shares so the orphan
                                    // share merge-back is unaffected. A block
                                    // with an empty/missing snapshot (e.g. found
                                    // before pplns was enabled) falls back to
                                    // its round shares (prop-like) so it still
                                    // pays rather than being kicked.
                                    if (pplnsWindowActive && pplnsTotals) {
                                        rounds.forEach(function (
                                            r: any,
                                            i: any
                                        ) {
                                            if (
                                                r.category !== 'generate' &&
                                                r.category !== 'immature'
                                            )
                                                return;
                                            var totals = pplnsTotals[r.height];
                                            if (
                                                totals &&
                                                Object.keys(totals).length > 0
                                            ) {
                                                allWorkerShares[i] = totals;
                                            } else {
                                                logger.warning(
                                                    logSystem,
                                                    logComponent,
                                                    'PPLNS: no share-log window for round ' +
                                                        r.height +
                                                        ' — falling back to round shares for this block'
                                                );
                                            }
                                        });
                                    }

                                    // error detection
                                    var err: any = null;
                                    var performPayment = false;

                                    var notAddr = null;
                                    if (requireShielding === true) {
                                        notAddr = poolOptions.address;
                                    }

                                    // calculate what the pool owes its miners
                                    var feeSatoshi = coinsToSatoshies(fee);
                                    var totalOwed: any = parseInt(0 as any);
                                    for (var i = 0; i < rounds.length; i++) {
                                        // only pay generated blocks, not orphaned, kicked, immature.
                                        // The full block reward is counted (conservative): under
                                        // pps/dpps/fpps it stays in the float and under ppsplus the
                                        // subsidy stays in the wallet, but in every case the wallet
                                        // must hold the coins, so the funds check should require them.
                                        if (rounds[i].category == 'generate') {
                                            totalOwed =
                                                totalOwed +
                                                coinsToSatoshies(
                                                    rounds[i].reward
                                                ) -
                                                feeSatoshi;
                                        }
                                    }
                                    // also include balances owed
                                    for (var w in workers) {
                                        var worker = workers[w];
                                        totalOwed =
                                            totalOwed + (worker.balance || 0);
                                    }
                                    // check if we have enough tAddress funds to begin payment processing
                                    listUnspent(
                                        null,
                                        notAddr,
                                        minConfPayout,
                                        false,
                                        function (error: any, tBalance: any) {
                                            if (error) {
                                                logger.error(
                                                    logSystem,
                                                    logComponent,
                                                    'Error checking pool balance before processing payments.'
                                                );
                                                return callback(true);
                                            } else if (tBalance < totalOwed) {
                                                logger.error(
                                                    logSystem,
                                                    logComponent,
                                                    'Insufficient funds (' +
                                                        satoshisToCoins(
                                                            tBalance
                                                        ) +
                                                        ') to process payments (' +
                                                        satoshisToCoins(
                                                            totalOwed
                                                        ) +
                                                        '); possibly waiting for txs.'
                                                );
                                                performPayment = false;
                                            } else if (tBalance > totalOwed) {
                                                performPayment = true;
                                            }
                                            // just in case...
                                            if (totalOwed <= 0) {
                                                performPayment = false;
                                            }
                                            // if we can not perform payment
                                            if (performPayment === false) {
                                                // convert category generate to immature
                                                rounds = rounds.filter(
                                                    function (r: any) {
                                                        switch (r.category) {
                                                            case 'orphan':
                                                            case 'kicked':
                                                            case 'immature':
                                                                return true;
                                                            case 'generate':
                                                                r.category =
                                                                    'immature';
                                                                return true;
                                                            default:
                                                                return false;
                                                        }
                                                    }
                                                );
                                            }

                                            // handle rounds
                                            rounds.forEach(function (
                                                round: any,
                                                i: any
                                            ) {
                                                var workerShares =
                                                    allWorkerShares[i];
                                                if (!workerShares) {
                                                    err = true;
                                                    logger.warning(
                                                        logSystem,
                                                        logComponent,
                                                        'Remove no worker shares block for round: ' +
                                                            round.height +
                                                            ' blockHash: ' +
                                                            round.blockHash
                                                    );
                                                    var noWorkerSharesMoveCommand =
                                                        [
                                                            'smove',
                                                            coin +
                                                                ':blocksPending',
                                                            coin +
                                                                ':blocksKicked',
                                                            round.serialized
                                                        ];
                                                    startRedisTimer();
                                                    execCommands(redisClient, [
                                                        noWorkerSharesMoveCommand
                                                    ]).then(
                                                        function () {
                                                            endRedisTimer();
                                                            logger.debug(
                                                                logSystem,
                                                                logComponent,
                                                                'Removed no worker shares block: ' +
                                                                    round.blockHash
                                                            );
                                                        },
                                                        function (error: any) {
                                                            endRedisTimer();
                                                            logger.error(
                                                                logSystem,
                                                                logComponent,
                                                                'Error removing no worker shares block: ' +
                                                                    JSON.stringify(
                                                                        error.message
                                                                    )
                                                            );
                                                        }
                                                    );
                                                    return;
                                                }
                                                var workerTimes =
                                                    allWorkerTimes[i];

                                                switch (round.category) {
                                                    case 'kicked':
                                                    case 'orphan':
                                                        round.workerShares =
                                                            workerShares;
                                                        break;

                                                    /* calculate immature balances */
                                                    case 'immature':
                                                        var feeSatoshi =
                                                            coinsToSatoshies(
                                                                fee
                                                            );
                                                        var immature: any =
                                                            coinsToSatoshies(
                                                                round.reward
                                                            );
                                                        var totalShares: any =
                                                            parseFloat(
                                                                0 as any
                                                            );
                                                        var sharesLost: any =
                                                            parseFloat(
                                                                0 as any
                                                            );

                                                        // adjust block immature .. tx fees
                                                        immature = Math.round(
                                                            immature -
                                                                feeSatoshi
                                                        );

                                                        // PPS+: only the tx-fee portion is owed to miners from a
                                                        // block (the subsidy is paid via accrual), so the immature
                                                        // estimate excludes the subsidy too.
                                                        if (ppsplusActive) {
                                                            immature =
                                                                Math.round(
                                                                    ppsPlusFeePart(
                                                                        coinsToSatoshies(
                                                                            round.reward
                                                                        ),
                                                                        coinsToSatoshies(
                                                                            ppsplusBlockReward
                                                                        ),
                                                                        feeSatoshi
                                                                    )
                                                                );
                                                        }

                                                        // find most time spent in this round by single worker
                                                        var maxTime: any = 0;
                                                        for (var workerAddress in workerTimes) {
                                                            if (
                                                                maxTime <
                                                                parseFloat(
                                                                    workerTimes[
                                                                        workerAddress
                                                                    ]
                                                                )
                                                            )
                                                                maxTime =
                                                                    parseFloat(
                                                                        workerTimes[
                                                                            workerAddress
                                                                        ]
                                                                    );
                                                        }
                                                        // total up shares for round
                                                        for (var workerAddress in workerShares) {
                                                            var worker =
                                                                (workers[
                                                                    workerAddress
                                                                ] =
                                                                    workers[
                                                                        workerAddress
                                                                    ] || {});
                                                            var shares: any =
                                                                parseFloat(
                                                                    workerShares[
                                                                        workerAddress
                                                                    ] || 0
                                                                );
                                                            // if pplnt mode
                                                            if (
                                                                pplntEnabled ===
                                                                    true &&
                                                                maxTime > 0
                                                            ) {
                                                                var tshares =
                                                                    shares;
                                                                var lost: any =
                                                                    parseFloat(
                                                                        0 as any
                                                                    );
                                                                var address =
                                                                    workerAddress.split(
                                                                        '.'
                                                                    )[0];
                                                                if (
                                                                    workerTimes[
                                                                        address
                                                                    ] != null &&
                                                                    parseFloat(
                                                                        workerTimes[
                                                                            address
                                                                        ]
                                                                    ) > 0
                                                                ) {
                                                                    var timePeriod =
                                                                        roundTo(
                                                                            parseFloat(
                                                                                workerTimes[
                                                                                    address
                                                                                ] ||
                                                                                    1
                                                                            ) /
                                                                                maxTime,
                                                                            2
                                                                        );
                                                                    if (
                                                                        timePeriod >
                                                                            0 &&
                                                                        timePeriod <
                                                                            pplntTimeQualify
                                                                    ) {
                                                                        var lost: any =
                                                                            shares -
                                                                            shares *
                                                                                timePeriod;
                                                                        sharesLost +=
                                                                            lost;
                                                                        shares =
                                                                            Math.max(
                                                                                shares -
                                                                                    lost,
                                                                                0
                                                                            );
                                                                    }
                                                                }
                                                            }
                                                            worker.roundShares =
                                                                shares;
                                                            totalShares +=
                                                                shares;
                                                        }

                                                        //console.log('--IMMATURE DEBUG--------------');
                                                        //console.log('performPayment: '+performPayment);
                                                        //console.log('blockHeight: '+round.height);
                                                        //console.log('blockReward: '+Math.round(immature));
                                                        //console.log('blockConfirmations: '+round.confirmations);

                                                        // calculate rewards for round
                                                        var totalAmount = 0;
                                                        for (var workerAddress in workerShares) {
                                                            var worker =
                                                                (workers[
                                                                    workerAddress
                                                                ] =
                                                                    workers[
                                                                        workerAddress
                                                                    ] || {});
                                                            // solo: finder takes
                                                            // 100%, others 0.
                                                            // pps: matured reward
                                                            // goes to the pool
                                                            // float (miners are
                                                            // paid via accrual),
                                                            // so 0 here.
                                                            var percent =
                                                                soloEnabled
                                                                    ? workerAddress ===
                                                                      round.minedby
                                                                        ? 1.0
                                                                        : 0
                                                                    : blockToFloat
                                                                      ? 0
                                                                      : parseFloat(
                                                                            worker.roundShares
                                                                        ) /
                                                                        totalShares;
                                                            // calculate workers immature for this round
                                                            var workerImmatureTotal =
                                                                Math.round(
                                                                    immature *
                                                                        percent
                                                                );
                                                            worker.immature =
                                                                (worker.immature ||
                                                                    0) +
                                                                workerImmatureTotal;
                                                            totalAmount +=
                                                                workerImmatureTotal;
                                                        }

                                                        //console.log('----------------------------');
                                                        break;

                                                    /* calculate reward balances */
                                                    case 'generate':
                                                        var feeSatoshi =
                                                            coinsToSatoshies(
                                                                fee
                                                            );
                                                        var reward: any =
                                                            coinsToSatoshies(
                                                                round.reward
                                                            );
                                                        var totalShares: any =
                                                            parseFloat(
                                                                0 as any
                                                            );
                                                        var sharesLost: any =
                                                            parseFloat(
                                                                0 as any
                                                            );

                                                        // adjust block reward .. tx fees
                                                        reward = Math.round(
                                                            reward - feeSatoshi
                                                        );

                                                        // PPS+: only the TX-FEE portion of the block is
                                                        // distributed to miners here (PPLNS-style). The subsidy
                                                        // stays in the wallet to back the PPS accrual that pays it
                                                        // per-share, so the apportioned amount is the fee part.
                                                        if (ppsplusActive) {
                                                            reward = Math.round(
                                                                ppsPlusFeePart(
                                                                    coinsToSatoshies(
                                                                        round.reward
                                                                    ),
                                                                    coinsToSatoshies(
                                                                        ppsplusBlockReward
                                                                    ),
                                                                    feeSatoshi
                                                                )
                                                            );
                                                        }

                                                        // D-PPS realized-luck input: the matured block reward
                                                        // (the gross coins the pool actually received this round,
                                                        // which under pps/dpps goes to the float) is accrued into
                                                        // coin:pps:stats.actualPending; the next accrual cycle
                                                        // folds it into the actualReward EMA. Once per matured
                                                        // round — the round leaves blocksPending after payout, so
                                                        // it is never double-counted.
                                                        if (
                                                            dppsActive &&
                                                            round.reward > 0
                                                        ) {
                                                            redisClient
                                                                .hIncrByFloat(
                                                                    coin +
                                                                        ':pps:stats',
                                                                    'actualPending',
                                                                    round.reward
                                                                )
                                                                .catch(
                                                                    function () {}
                                                                );
                                                        }

                                                        // FPPS fee sample: each matured block's tx-fee portion
                                                        // (gross coinbase minus the fixed subsidy) is accumulated
                                                        // as a pending sum + count; accruePPS folds it into the
                                                        // fee EMA that lifts the per-share rate. Once per matured
                                                        // round (it leaves blocksPending after payout).
                                                        if (
                                                            fppsActive &&
                                                            round.reward > 0
                                                        ) {
                                                            var fppsFee =
                                                                Math.max(
                                                                    0,
                                                                    round.reward -
                                                                        fppsBlockReward
                                                                );
                                                            redisClient
                                                                .multi()
                                                                .hIncrByFloat(
                                                                    coin +
                                                                        ':pps:stats',
                                                                    'feePending',
                                                                    fppsFee
                                                                )
                                                                .hIncrByFloat(
                                                                    coin +
                                                                        ':pps:stats',
                                                                    'feeBlocksPending',
                                                                    1
                                                                )
                                                                .exec()
                                                                .catch(
                                                                    function () {}
                                                                );
                                                        }

                                                        // SMPPS income: the matured block reward is the pool's
                                                        // realized income for the SMPPS family — add it to the
                                                        // release budget (accrueSMPPS only ever credits balances up
                                                        // to this). Once per matured round (leaves blocksPending
                                                        // after payout, so never double-counted).
                                                        if (
                                                            smppsFamilyActive &&
                                                            round.reward > 0
                                                        ) {
                                                            redisClient
                                                                .hIncrByFloat(
                                                                    coin +
                                                                        ':smpps:stats',
                                                                    'budget',
                                                                    round.reward
                                                                )
                                                                .catch(
                                                                    function () {}
                                                                );
                                                        }

                                                        // find most time spent in this round by single worker
                                                        maxTime = 0;
                                                        for (var workerAddress in workerTimes) {
                                                            if (
                                                                maxTime <
                                                                parseFloat(
                                                                    workerTimes[
                                                                        workerAddress
                                                                    ]
                                                                )
                                                            )
                                                                maxTime =
                                                                    parseFloat(
                                                                        workerTimes[
                                                                            workerAddress
                                                                        ]
                                                                    );
                                                        }
                                                        // total up shares for round
                                                        for (var workerAddress in workerShares) {
                                                            var worker =
                                                                (workers[
                                                                    workerAddress
                                                                ] =
                                                                    workers[
                                                                        workerAddress
                                                                    ] || {});
                                                            var shares: any =
                                                                parseFloat(
                                                                    workerShares[
                                                                        workerAddress
                                                                    ] || 0
                                                                );
                                                            // if pplnt mode
                                                            if (
                                                                pplntEnabled ===
                                                                    true &&
                                                                maxTime > 0
                                                            ) {
                                                                var tshares =
                                                                    shares;
                                                                var lost: any =
                                                                    parseFloat(
                                                                        0 as any
                                                                    );
                                                                var address =
                                                                    workerAddress.split(
                                                                        '.'
                                                                    )[0];
                                                                if (
                                                                    workerTimes[
                                                                        address
                                                                    ] != null &&
                                                                    parseFloat(
                                                                        workerTimes[
                                                                            address
                                                                        ]
                                                                    ) > 0
                                                                ) {
                                                                    var timePeriod =
                                                                        roundTo(
                                                                            parseFloat(
                                                                                workerTimes[
                                                                                    address
                                                                                ] ||
                                                                                    1
                                                                            ) /
                                                                                maxTime,
                                                                            2
                                                                        );
                                                                    if (
                                                                        timePeriod >
                                                                            0 &&
                                                                        timePeriod <
                                                                            pplntTimeQualify
                                                                    ) {
                                                                        var lost: any =
                                                                            shares -
                                                                            shares *
                                                                                timePeriod;
                                                                        sharesLost +=
                                                                            lost;
                                                                        shares =
                                                                            Math.max(
                                                                                shares -
                                                                                    lost,
                                                                                0
                                                                            );
                                                                        logger.warning(
                                                                            logSystem,
                                                                            logComponent,
                                                                            'PPLNT: Reduced shares for ' +
                                                                                workerAddress +
                                                                                ' round:' +
                                                                                round.height +
                                                                                ' maxTime:' +
                                                                                maxTime +
                                                                                'sec timePeriod:' +
                                                                                roundTo(
                                                                                    timePeriod,
                                                                                    6
                                                                                ) +
                                                                                ' shares:' +
                                                                                tshares +
                                                                                ' lost:' +
                                                                                lost +
                                                                                ' new:' +
                                                                                shares
                                                                        );
                                                                    }
                                                                    if (
                                                                        timePeriod >
                                                                        1.0
                                                                    ) {
                                                                        err = true;
                                                                        logger.error(
                                                                            logSystem,
                                                                            logComponent,
                                                                            'Time share period is greater than 1.0 for ' +
                                                                                workerAddress +
                                                                                ' round:' +
                                                                                round.height +
                                                                                ' blockHash:' +
                                                                                round.blockHash
                                                                        );
                                                                        return;
                                                                    }
                                                                    worker.timePeriod =
                                                                        timePeriod;
                                                                }
                                                            }
                                                            worker.roundShares =
                                                                shares;
                                                            worker.totalShares =
                                                                parseFloat(
                                                                    worker.totalShares ||
                                                                        0
                                                                ) + shares;
                                                            totalShares +=
                                                                shares;
                                                        }

                                                        //console.log('--REWARD DEBUG--------------');
                                                        //console.log('performPayment: '+performPayment);
                                                        //console.log('blockHeight: '+round.height);
                                                        //console.log('blockReward: ' + Math.round(reward));
                                                        //console.log('blockConfirmations: '+round.confirmations);

                                                        // calculate rewards for round
                                                        var totalAmount = 0;
                                                        for (var workerAddress in workerShares) {
                                                            var worker =
                                                                (workers[
                                                                    workerAddress
                                                                ] =
                                                                    workers[
                                                                        workerAddress
                                                                    ] || {});
                                                            // solo: finder takes
                                                            // 100%, others 0.
                                                            // pps: matured reward
                                                            // goes to the pool
                                                            // float (miners are
                                                            // paid via accrual),
                                                            // so 0 here.
                                                            var percent =
                                                                soloEnabled
                                                                    ? workerAddress ===
                                                                      round.minedby
                                                                        ? 1.0
                                                                        : 0
                                                                    : blockToFloat
                                                                      ? 0
                                                                      : parseFloat(
                                                                            worker.roundShares
                                                                        ) /
                                                                        totalShares;
                                                            if (percent > 1.0) {
                                                                err = true;
                                                                logger.error(
                                                                    logSystem,
                                                                    logComponent,
                                                                    'Share percent is greater than 1.0 for ' +
                                                                        workerAddress +
                                                                        ' round:' +
                                                                        round.height +
                                                                        ' blockHash:' +
                                                                        round.blockHash
                                                                );
                                                                return;
                                                            }
                                                            // calculate workers reward for this round
                                                            var workerRewardTotal =
                                                                Math.round(
                                                                    reward *
                                                                        percent
                                                                );
                                                            worker.reward =
                                                                (worker.reward ||
                                                                    0) +
                                                                workerRewardTotal;
                                                            totalAmount +=
                                                                workerRewardTotal;
                                                        }

                                                        //console.log('----------------------------');
                                                        break;
                                                }
                                            });

                                            // if there was no errors
                                            if (err === null) {
                                                callback(
                                                    null,
                                                    workers,
                                                    rounds,
                                                    addressAccount
                                                );
                                            } else {
                                                // some error, stop waterfall
                                                callback(true);
                                            }
                                        }
                                    ); // end funds check
                                },
                                function () {
                                    endRedisTimer();
                                    callback(
                                        'Check finished - redis error with multi get rounds share'
                                    );
                                }
                            ); // end share lookup
                        },
                        function () {
                            endRedisTimer();
                            callback(
                                'Check finished - redis error with multi get rounds time'
                            );
                        }
                    ); // end time lookup
                },

                /*
               Step 4 - Generate RPC commands to send payments
               When deciding the sent balance, it the difference should be -1*amount they had in db,
               If not sending the balance, the differnce should be +(the amount they earned this round)
            */
                function (
                    workers: any,
                    rounds: any,
                    addressAccount: any,
                    callback: any
                ) {
                    var tries = 0;
                    var trySend = function (withholdPercent: any) {
                        var addressAmounts: any = {};
                        var balanceAmounts: any = {};
                        var shareAmounts: any = {};
                        var timePeriods: any = {};
                        var minerTotals: any = {};
                        var totalSent = 0;
                        var totalShares = 0;

                        // track attempts made, calls to trySend...
                        tries++;

                        // total up miner's balances
                        for (var w in workers) {
                            var worker = workers[w];
                            totalShares += worker.totalShares || 0;
                            worker.balance = worker.balance || 0;
                            worker.reward = worker.reward || 0;
                            // get miner payout totals
                            var toSendSatoshis = Math.round(
                                (worker.balance + worker.reward) *
                                    (1 - withholdPercent)
                            );
                            var address = (worker.address = (
                                worker.address ||
                                getProperAddress(w.split('.')[0])
                            ).trim());
                            if (
                                minerTotals[address] != null &&
                                minerTotals[address] > 0
                            ) {
                                minerTotals[address] += toSendSatoshis;
                            } else {
                                minerTotals[address] = toSendSatoshis;
                            }
                        }
                        // now process each workers balance, and pay the miner
                        for (var w in workers) {
                            var worker = workers[w];
                            worker.balance = worker.balance || 0;
                            worker.reward = worker.reward || 0;
                            var toSendSatoshis = Math.round(
                                (worker.balance + worker.reward) *
                                    (1 - withholdPercent)
                            );
                            var address = (worker.address = (
                                worker.address ||
                                getProperAddress(w.split('.')[0])
                            ).trim());
                            // if miners total is enough, go ahead and add this worker balance
                            if (minerTotals[address] >= minPaymentSatoshis) {
                                totalSent += toSendSatoshis;
                                // send funds
                                worker.sent = satoshisToCoins(toSendSatoshis);
                                worker.balanceChange =
                                    Math.min(worker.balance, toSendSatoshis) *
                                    -1;
                                if (
                                    addressAmounts[address] != null &&
                                    addressAmounts[address] > 0
                                ) {
                                    addressAmounts[address] = coinsRound(
                                        addressAmounts[address] + worker.sent
                                    );
                                } else {
                                    addressAmounts[address] = worker.sent;
                                }
                            } else {
                                // add to balance, not enough minerals
                                worker.sent = 0;
                                worker.balanceChange = Math.max(
                                    toSendSatoshis - worker.balance,
                                    0
                                );
                                // track balance changes
                                if (worker.balanceChange > 0) {
                                    if (
                                        balanceAmounts[address] != null &&
                                        balanceAmounts[address] > 0
                                    ) {
                                        balanceAmounts[address] = coinsRound(
                                            balanceAmounts[address] +
                                                satoshisToCoins(
                                                    worker.balanceChange
                                                )
                                        );
                                    } else {
                                        balanceAmounts[address] =
                                            satoshisToCoins(
                                                worker.balanceChange
                                            );
                                    }
                                }
                            }
                            // track share work
                            if (worker.totalShares > 0) {
                                if (
                                    shareAmounts[address] != null &&
                                    shareAmounts[address] > 0
                                ) {
                                    shareAmounts[address] += worker.totalShares;
                                } else {
                                    shareAmounts[address] = worker.totalShares;
                                }
                            }
                        }

                        // if no payouts...continue to next set of callbacks
                        if (Object.keys(addressAmounts).length === 0) {
                            callback(null, workers, rounds, []);
                            return;
                        }

                        // do final rounding of payments per address
                        // this forces amounts to be valid (0.12345678)
                        for (var a in addressAmounts) {
                            addressAmounts[a] = coinsRound(addressAmounts[a]);
                        }

                        // POINT OF NO RETURN! GOOD LUCK!
                        // WE ARE SENDING PAYMENT CMD TO DAEMON

                        // perform the sendmany operation .. addressAccount
                        var rpccallTracking =
                            'sendmany "" ' + JSON.stringify(addressAmounts);
                        //console.log(rpccallTracking);

                        daemon.cmd(
                            'sendmany',
                            ['', addressAmounts, minConfPayout],
                            function (result: any) {
                                // check for failed payments, there are many reasons
                                if (result.error && result.error.code === -6) {
                                    // check if it is because we don't have enough funds
                                    if (
                                        result.error.message &&
                                        result.error.message.includes(
                                            'insufficient funds'
                                        )
                                    ) {
                                        // only try up to XX times (Max, 0.5%)
                                        if (tries < 5) {
                                            // we thought we had enough funds to send payments, but apparently not...
                                            // try decreasing payments by a small percent to cover unexpected tx fees?
                                            var higherPercent =
                                                withholdPercent + 0.001; // 0.1%
                                            logger.warning(
                                                logSystem,
                                                logComponent,
                                                'Insufficient funds (??) for payments (' +
                                                    satoshisToCoins(totalSent) +
                                                    '), decreasing rewards by ' +
                                                    (
                                                        higherPercent * 100
                                                    ).toFixed(1) +
                                                    '% and retrying'
                                            );
                                            trySend(higherPercent);
                                        } else {
                                            logger.warning(
                                                logSystem,
                                                logComponent,
                                                rpccallTracking
                                            );
                                            logger.error(
                                                logSystem,
                                                logComponent,
                                                'Error sending payments, decreased rewards by too much!!!'
                                            );
                                            callback(true);
                                        }
                                    } else {
                                        // there was some fatal payment error?
                                        logger.warning(
                                            logSystem,
                                            logComponent,
                                            rpccallTracking
                                        );
                                        logger.error(
                                            logSystem,
                                            logComponent,
                                            'Error sending payments ' +
                                                JSON.stringify(result.error)
                                        );
                                        // payment failed, prevent updates to redis
                                        callback(true);
                                    }
                                    return;
                                } else if (
                                    result.error &&
                                    result.error.code === -5
                                ) {
                                    // invalid address specified in addressAmounts array
                                    logger.warning(
                                        logSystem,
                                        logComponent,
                                        rpccallTracking
                                    );
                                    logger.error(
                                        logSystem,
                                        logComponent,
                                        'Error sending payments ' +
                                            JSON.stringify(result.error)
                                    );
                                    // payment failed, prevent updates to redis
                                    callback(true);
                                    return;
                                } else if (
                                    result.error &&
                                    result.error.message != null
                                ) {
                                    // invalid amount, others?
                                    logger.warning(
                                        logSystem,
                                        logComponent,
                                        rpccallTracking
                                    );
                                    logger.error(
                                        logSystem,
                                        logComponent,
                                        'Error sending payments ' +
                                            JSON.stringify(result.error)
                                    );
                                    // payment failed, prevent updates to redis
                                    callback(true);
                                    return;
                                } else if (result.error) {
                                    // unknown error
                                    logger.error(
                                        logSystem,
                                        logComponent,
                                        'Error sending payments ' +
                                            JSON.stringify(result.error)
                                    );
                                    // payment failed, prevent updates to redis
                                    callback(true);
                                    return;
                                } else {
                                    // make sure sendmany gives us back a txid
                                    var txid = null;
                                    if (result.response) {
                                        txid = result.response;
                                    }
                                    if (txid != null) {
                                        // it worked, congrats on your pools payout ;)
                                        logger.special(
                                            logSystem,
                                            logComponent,
                                            'Sent ' +
                                                satoshisToCoins(totalSent) +
                                                ' to ' +
                                                Object.keys(addressAmounts)
                                                    .length +
                                                ' miners; txid: ' +
                                                txid
                                        );

                                        if (withholdPercent > 0) {
                                            logger.warning(
                                                logSystem,
                                                logComponent,
                                                'Had to withhold ' +
                                                    withholdPercent * 100 +
                                                    '% of reward from miners to cover transaction fees. ' +
                                                    'Fund pool wallet with coins to prevent this from happening'
                                            );
                                        }

                                        // save payments data to redis
                                        var paymentBlocks = rounds
                                            .filter(function (r: any) {
                                                return r.category == 'generate';
                                            })
                                            .map(function (r: any) {
                                                return parseInt(r.height);
                                            });

                                        var paymentsUpdate: any = [];
                                        var paymentsData = {
                                            time: Date.now(),
                                            txid: txid,
                                            shares: totalShares,
                                            paid: satoshisToCoins(totalSent),
                                            miners: Object.keys(addressAmounts)
                                                .length,
                                            blocks: paymentBlocks,
                                            amounts: addressAmounts,
                                            balances: balanceAmounts,
                                            work: shareAmounts
                                        };
                                        paymentsUpdate.push([
                                            'zadd',
                                            logComponent + ':payments',
                                            Date.now(),
                                            JSON.stringify(paymentsData)
                                        ]);

                                        callback(
                                            null,
                                            workers,
                                            rounds,
                                            paymentsUpdate
                                        );
                                    } else {
                                        //clearInterval(paymentInterval);
                                        clearTimeout(paymentInterval);
                                        disablePeymentProcessing = true;

                                        logger.error(
                                            logSystem,
                                            logComponent,
                                            'Error RPC sendmany did not return txid ' +
                                                JSON.stringify(result) +
                                                'Disabling payment processing to prevent possible double-payouts.'
                                        );

                                        callback(true);
                                        return;
                                    }
                                }
                            },
                            true,
                            true
                        );
                    };

                    // attempt to send any owed payments
                    trySend(0);
                },

                /*
                Step 5 - Final redis commands
            */
                function (
                    workers: any,
                    rounds: any,
                    paymentsUpdate: any,
                    callback: any
                ) {
                    var totalPaid: any = parseFloat(0 as any);

                    var immatureUpdateCommands: any = [];
                    var balanceUpdateCommands: any = [];
                    var workerPayoutsCommand: any = [];

                    // update worker paid/balance stats
                    for (var w in workers) {
                        var worker = workers[w];
                        // update balances
                        if ((worker.balanceChange || 0) !== 0) {
                            balanceUpdateCommands.push([
                                'hincrbyfloat',
                                coin + ':balances',
                                w,
                                satoshisToCoins(worker.balanceChange)
                            ]);
                        }
                        // update payouts
                        if ((worker.sent || 0) > 0) {
                            workerPayoutsCommand.push([
                                'hincrbyfloat',
                                coin + ':payouts',
                                w,
                                coinsRound(worker.sent)
                            ]);
                            totalPaid = coinsRound(totalPaid + worker.sent);
                        }
                        // update immature balances
                        if ((worker.immature || 0) > 0) {
                            immatureUpdateCommands.push([
                                'hset',
                                coin + ':immature',
                                w,
                                worker.immature
                            ]);
                        } else {
                            immatureUpdateCommands.push([
                                'hset',
                                coin + ':immature',
                                w,
                                0
                            ]);
                        }
                    }

                    var movePendingCommands: any = [];
                    var roundsToDelete: any = [];
                    var orphanMergeCommands: any = [];

                    var confirmsUpdate: any = [];
                    var confirmsToDelete: any = [];

                    var moveSharesToCurrent = function (r: any) {
                        var workerShares = r.workerShares;
                        if (workerShares != null) {
                            logger.warning(
                                logSystem,
                                logComponent,
                                'Moving shares from orphaned block ' +
                                    r.height +
                                    ' to current round.'
                            );
                            Object.keys(workerShares).forEach(
                                function (worker) {
                                    orphanMergeCommands.push([
                                        'hincrbyfloat',
                                        coin + ':shares:roundCurrent',
                                        worker,
                                        workerShares[worker]
                                    ]);
                                }
                            );
                        }
                    };

                    rounds.forEach(function (r: any) {
                        switch (r.category) {
                            case 'kicked':
                            case 'orphan':
                                confirmsToDelete.push([
                                    'hdel',
                                    coin + ':blocksPendingConfirms',
                                    r.blockHash
                                ]);
                                movePendingCommands.push([
                                    'smove',
                                    coin + ':blocksPending',
                                    coin + ':blocksKicked',
                                    r.serialized
                                ]);
                                if (r.canDeleteShares) {
                                    moveSharesToCurrent(r);
                                    roundsToDelete.push(
                                        coin + ':shares:round' + r.height
                                    );
                                    roundsToDelete.push(
                                        coin + ':shares:times' + r.height
                                    );
                                    if (pplnsWindowActive)
                                        roundsToDelete.push(
                                            coin +
                                                ':shares:pplnsRound' +
                                                r.height
                                        );
                                }
                                return;
                            case 'immature':
                                confirmsUpdate.push([
                                    'hset',
                                    coin + ':blocksPendingConfirms',
                                    r.blockHash,
                                    r.confirmations || 0
                                ]);
                                return;
                            case 'generate':
                                confirmsToDelete.push([
                                    'hdel',
                                    coin + ':blocksPendingConfirms',
                                    r.blockHash
                                ]);
                                movePendingCommands.push([
                                    'smove',
                                    coin + ':blocksPending',
                                    coin + ':blocksConfirmed',
                                    r.serialized
                                ]);
                                roundsToDelete.push(
                                    coin + ':shares:round' + r.height
                                );
                                roundsToDelete.push(
                                    coin + ':shares:times' + r.height
                                );
                                if (pplnsWindowActive)
                                    roundsToDelete.push(
                                        coin + ':shares:pplnsRound' + r.height
                                    );
                                return;
                        }
                    });

                    var finalRedisCommands: any = [];

                    if (movePendingCommands.length > 0)
                        finalRedisCommands =
                            finalRedisCommands.concat(movePendingCommands);

                    if (orphanMergeCommands.length > 0)
                        finalRedisCommands =
                            finalRedisCommands.concat(orphanMergeCommands);

                    if (immatureUpdateCommands.length > 0)
                        finalRedisCommands = finalRedisCommands.concat(
                            immatureUpdateCommands
                        );

                    if (balanceUpdateCommands.length > 0)
                        finalRedisCommands = finalRedisCommands.concat(
                            balanceUpdateCommands
                        );

                    if (workerPayoutsCommand.length > 0)
                        finalRedisCommands =
                            finalRedisCommands.concat(workerPayoutsCommand);

                    if (roundsToDelete.length > 0)
                        finalRedisCommands.push(['del'].concat(roundsToDelete));

                    if (confirmsUpdate.length > 0)
                        finalRedisCommands =
                            finalRedisCommands.concat(confirmsUpdate);

                    if (confirmsToDelete.length > 0)
                        finalRedisCommands =
                            finalRedisCommands.concat(confirmsToDelete);

                    if (paymentsUpdate.length > 0)
                        finalRedisCommands =
                            finalRedisCommands.concat(paymentsUpdate);

                    if (totalPaid !== 0)
                        finalRedisCommands.push([
                            'hincrbyfloat',
                            coin + ':stats',
                            'totalPaid',
                            totalPaid
                        ]);

                    if (finalRedisCommands.length === 0) {
                        callback();
                        return;
                    }

                    startRedisTimer();
                    execCommands(redisClient, finalRedisCommands).then(
                        function () {
                            endRedisTimer();
                            callback();
                        },
                        function (error: any) {
                            endRedisTimer();
                            //clearInterval(paymentInterval);
                            clearTimeout(paymentInterval);
                            disablePeymentProcessing = true;

                            logger.error(
                                logSystem,
                                logComponent,
                                'Payments sent but could not update redis. ' +
                                    JSON.stringify(error.message) +
                                    ' Disabling payment processing to prevent possible double-payouts. The redis commands in ' +
                                    coin +
                                    '_finalRedisCommands.txt must be ran manually'
                            );

                            fs.writeFile(
                                coin + '_finalRedisCommands.txt',
                                JSON.stringify(finalRedisCommands),
                                function (err) {
                                    if (err)
                                        logger.error(
                                            'Could not write finalRedisCommands.txt, you are fucked.'
                                        );
                                }
                            );
                            callback();
                        }
                    );
                }
            ],
            function () {
                if (!disablePeymentProcessing) {
                    paymentInterval = setTimeout(
                        processPayments,
                        paymentIntervalSecs * 1000
                    );
                }

                var paymentProcessTime = Date.now() - startPaymentProcess;
                logger.debug(
                    logSystem,
                    logComponent,
                    'Finished interval - time spent: ' +
                        paymentProcessTime +
                        'ms total, ' +
                        timeSpentRedis +
                        'ms redis, ' +
                        timeSpentRPC +
                        'ms daemon RPC'
                );
            }
        );
    };

    function handleAddress(address: any) {
        if (address.length === 40) {
            return util.addressFromEx(poolOptions.address, address);
        } else return address;
    }

    var getProperAddress = function (address: any) {
        if (address.length === 40) {
            return util.addressFromEx(poolOptions.address, address);
        } else return address;
        if (address != false) {
            return handleAddress(address);
        } else {
            var addressToPay = '';

            daemon.cmd(
                'getnewaddress',
                [],
                function (result: any) {
                    if (result.error) {
                        callback(true);
                        return;
                    }
                    try {
                        addressToPay = result.data;
                    } catch (e) {
                        logger.error(
                            logSystem,
                            logComponent,
                            'Error getting a new address. Got: ' + result.data
                        );
                        callback(true);
                    }
                },
                true,
                true
            );

            return handleAddress(addressToPay);
        }
    };
}
