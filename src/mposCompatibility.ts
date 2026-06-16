import mysql from 'mysql';
import type { Logger } from './logUtil.ts';

export default function (this: any, logger: Logger, poolConfig: any) {
    const mposConfig = poolConfig.mposMode;
    const coin = poolConfig.coin.name;

    const connection = mysql.createPool({
        host: mposConfig.host,
        port: mposConfig.port,
        user: mposConfig.user,
        password: mposConfig.password,
        database: mposConfig.database
    });

    const logIdentify = 'MySQL';
    const logComponent = coin;

    this.handleAuth = function (
        workerName: string,
        password: string,
        authCallback: (authorized: boolean) => void
    ) {
        if (
            poolConfig.validateWorkerUsername !== true &&
            mposConfig.autoCreateWorker !== true
        ) {
            authCallback(true);
            return;
        }

        connection.query(
            'SELECT password FROM pool_worker WHERE username = LOWER(?)',
            [workerName.toLowerCase()],
            function (err, result) {
                if (err) {
                    logger.error(
                        logIdentify,
                        logComponent,
                        'Database error when authenticating worker: ' +
                            JSON.stringify(err)
                    );
                    authCallback(false);
                } else if (!result[0]) {
                    if (mposConfig.autoCreateWorker) {
                        const account = workerName.split('.')[0];
                        connection.query(
                            'SELECT id,username FROM accounts WHERE username = LOWER(?)',
                            [account.toLowerCase()],
                            function (err, result) {
                                if (err) {
                                    logger.error(
                                        logIdentify,
                                        logComponent,
                                        'Database error when authenticating account: ' +
                                            JSON.stringify(err)
                                    );
                                    authCallback(false);
                                } else if (!result[0]) {
                                    authCallback(false);
                                } else {
                                    connection.query(
                                        'INSERT INTO `pool_worker` (`account_id`, `username`, `password`) VALUES (?, ?, ?);',
                                        [
                                            result[0].id,
                                            workerName.toLowerCase(),
                                            password
                                        ],
                                        function (err, result) {
                                            if (err) {
                                                logger.error(
                                                    logIdentify,
                                                    logComponent,
                                                    'Database error when insert worker: ' +
                                                        JSON.stringify(err)
                                                );
                                                authCallback(false);
                                            } else {
                                                authCallback(true);
                                            }
                                        }
                                    );
                                }
                            }
                        );
                    } else {
                        authCallback(false);
                    }
                } else if (
                    mposConfig.checkPassword &&
                    result[0].password !== password
                )
                    authCallback(false);
                else authCallback(true);
            }
        );
    };

    this.handleShare = function (
        isValidShare: boolean,
        isValidBlock: boolean,
        shareData: any
    ) {
        const dbData = [
            shareData.ip,
            shareData.worker,
            isValidShare ? 'Y' : 'N',
            isValidBlock ? 'Y' : 'N',
            shareData.difficulty * (poolConfig.coin.mposDiffMultiplier || 1),
            typeof shareData.error === 'undefined' ? null : shareData.error,
            shareData.blockHash
                ? shareData.blockHash
                : shareData.blockHashInvalid
                  ? shareData.blockHashInvalid
                  : ''
        ];
        connection.query(
            'INSERT INTO `shares` SET time = NOW(), rem_host = ?, username = ?, our_result = ?, upstream_result = ?, difficulty = ?, reason = ?, solution = ?',
            dbData,
            function (err, result) {
                if (err)
                    logger.error(
                        logIdentify,
                        logComponent,
                        'Insert error when adding share: ' + JSON.stringify(err)
                    );
                else logger.debug(logIdentify, logComponent, 'Share inserted');
            }
        );
    };

    this.handleDifficultyUpdate = function (workerName: string, diff: number) {
        connection.query(
            'UPDATE `pool_worker` SET `difficulty` = ' +
                diff +
                ' WHERE `username` = ' +
                connection.escape(workerName),
            function (err, result) {
                if (err)
                    logger.error(
                        logIdentify,
                        logComponent,
                        'Error when updating worker diff: ' +
                            JSON.stringify(err)
                    );
                else if (result.affectedRows === 0) {
                    connection.query('INSERT INTO `pool_worker` SET ?', {
                        username: workerName,
                        difficulty: diff
                    });
                } else console.log('Updated difficulty successfully', result);
            }
        );
    };
}
