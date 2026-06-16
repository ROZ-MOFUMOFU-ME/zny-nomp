import express from 'express';

export default function workerapi(this: any, listen: number) {
    const _this = this;
    const app = express();
    const counters = {
        validShares: 0,
        validBlocks: 0,
        invalidShares: 0
    };

    const lastEvents = {
        lastValidShare: 0,
        lastValidBlock: 0,
        lastInvalidShare: 0
    };

    app.get('/stats', function (req, res) {
        res.send({
            clients: Object.keys(
                _this.poolObj.stratumServer.getStratumClients()
            ).length,
            counters: counters,
            lastEvents: lastEvents
        });
    });

    this.start = function (this: any, poolObj: any) {
        this.poolObj = poolObj;
        this.poolObj
            .once('started', function () {
                app.listen(listen, function () {
                    console.log('LISTENING ');
                });
            })
            .on(
                'share',
                function (
                    isValidShare: boolean,
                    isValidBlock: boolean,
                    shareData: any
                ) {
                    const now = Date.now();
                    if (isValidShare) {
                        counters.validShares++;
                        lastEvents.lastValidShare = now;
                        if (isValidBlock) {
                            counters.validBlocks++;
                            lastEvents.lastValidBlock = now;
                        }
                    } else {
                        counters.invalidShares++;
                        lastEvents.lastInvalidShare = now;
                    }
                }
            );
    };
}
