import { createRedisClient, execCommands } from './redisUtil.ts';
import * as Stratum from 'stratum-pool';
import type { Logger } from './logUtil.ts';

/*
 * Optional pool wallet-balance logger.
 *
 * Periodically records each enabled pool's spendable wallet balance (daemon
 * `getbalance` — the same figure the PPS float guard uses) into Redis so it can
 * be charted or scraped:
 *
 *   <coin>:walletBalance         HASH  { balance, time }            (latest)
 *   <coin>:walletBalanceHistory  ZSET  score = epoch-ms, member "<ms>:<balance>"
 *
 * The latest value is surfaced via GET /api (stats.pools[coin].walletBalance) and
 * the Prometheus gauge nomp_pool_wallet_balance (see src/metrics.ts). Disabled by
 * default — enable with the `balanceLog` block in the portal config. This is the
 * native replacement for the old scripts/getbalance.py + kotobalance.service.
 */
export default function (this: any, logger: Logger) {
    const _this = this;
    const portalConfig = JSON.parse(process.env.portalConfig as string);
    const poolConfigs = JSON.parse(process.env.pools as string);
    const logSystem = 'Balance';
    const cfg = portalConfig.balanceLog || {};

    const interval = Math.max(30, cfg.interval || 300) * 1000;
    // Rolling history window in seconds (0 keeps only the latest value).
    const historyRetention =
        cfg.historyRetention != null ? Math.max(0, cfg.historyRetention) : 86400;

    const pools = Object.keys(poolConfigs)
        .map(function (coin) {
            const poolOptions = poolConfigs[coin];
            const daemonCfg =
                (poolOptions.paymentProcessing &&
                    poolOptions.paymentProcessing.daemon) ||
                (Array.isArray(poolOptions.daemons) && poolOptions.daemons[0]);
            if (!daemonCfg) return null;
            const daemon = new (Stratum as any).daemon.interface(
                [daemonCfg],
                function (severity: any, message: any) {
                    (logger as any)[severity](logSystem, coin, message);
                }
            );
            const redis = createRedisClient(
                poolOptions.redis || portalConfig.redis,
                function (err: any) {
                    logger.error(
                        logSystem,
                        coin,
                        'Redis client error: ' + (err && err.message)
                    );
                }
            );
            return { coin: coin, daemon: daemon, redis: redis };
        })
        .filter(Boolean) as Array<{ coin: string; daemon: any; redis: any }>;

    if (pools.length === 0) {
        logger.warning(
            logSystem,
            'Config',
            'No pools with a daemon configured; balance logger idle.'
        );
        return;
    }

    function poll(p: { coin: string; daemon: any; redis: any }) {
        p.daemon.cmd('getbalance', [], function (result: any) {
            if (
                !result ||
                !result[0] ||
                result[0].error ||
                result[0].response == null
            ) {
                logger.warning(
                    logSystem,
                    p.coin,
                    'getbalance failed: ' +
                        JSON.stringify(result && result[0] && result[0].error)
                );
                return;
            }
            const balance = parseFloat(result[0].response) || 0;
            const now = Date.now();
            const commands: Array<Array<string | number>> = [
                [
                    'hset',
                    p.coin + ':walletBalance',
                    'balance',
                    String(balance),
                    'time',
                    String(now)
                ]
            ];
            if (historyRetention > 0) {
                commands.push([
                    'zadd',
                    p.coin + ':walletBalanceHistory',
                    String(now),
                    now + ':' + balance
                ]);
                commands.push([
                    'zremrangebyscore',
                    p.coin + ':walletBalanceHistory',
                    '-inf',
                    String(now - historyRetention * 1000)
                ]);
            }
            execCommands(p.redis, commands).catch(function (e: any) {
                logger.error(
                    logSystem,
                    p.coin,
                    'Failed to store balance: ' + (e && e.message)
                );
            });
            logger.debug(logSystem, p.coin, 'wallet balance ' + balance);
        });
    }

    this.update = function () {
        pools.forEach(poll);
    };

    logger.debug(
        logSystem,
        'Config',
        'Logging wallet balance for ' +
            pools.length +
            ' pool(s) every ' +
            interval / 1000 +
            's'
    );
    this.update();
    this._timer = setInterval(function () {
        _this.update();
    }, interval);
}
