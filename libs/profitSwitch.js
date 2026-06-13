import async from 'async';
import net from 'net';
import * as StratumUtil from 'stratum-pool/lib/util.js';
import * as Stratum from 'stratum-pool';

export default function (logger) {
    var _this = this;

    var portalConfig = JSON.parse(process.env.portalConfig);
    var poolConfigs = JSON.parse(process.env.pools);

    var logSystem = 'Profit';

    //
    // build status tracker for collecting coin market information
    //
    var profitStatus = {};
    var symbolToAlgorithmMap = {};
    Object.keys(poolConfigs).forEach(function (coin) {
        var poolConfig = poolConfigs[coin];
        var algo = poolConfig.coin.algorithm;

        if (!profitStatus.hasOwnProperty(algo)) {
            profitStatus[algo] = {};
        }
        var coinStatus = {
            name: poolConfig.coin.name,
            symbol: poolConfig.coin.symbol,
            difficulty: 0,
            reward: 0,
            exchangeInfo: {}
        };
        profitStatus[algo][poolConfig.coin.symbol] = coinStatus;
        symbolToAlgorithmMap[poolConfig.coin.symbol] = algo;
    });

    //
    // ensure we have something to switch
    //
    Object.keys(profitStatus).forEach(function (algo) {
        if (Object.keys(profitStatus[algo]).length <= 1) {
            delete profitStatus[algo];
            Object.keys(symbolToAlgorithmMap).forEach(function (symbol) {
                if (symbolToAlgorithmMap[symbol] === algo)
                    delete symbolToAlgorithmMap[symbol];
            });
        }
    });
    if (Object.keys(profitStatus).length == 0) {
        logger.debug(
            logSystem,
            'Config',
            'No alternative coins to switch to in current config, switching disabled.'
        );
        return;
    }

    //
    // setup APIs
    //
    var poloApi = new Poloniex();
    // 'API_KEY',
    // 'API_SECRET'
    var cryptsyApi = new Cryptsy();
    // 'API_KEY',
    // 'API_SECRET'
    var mintpalApi = new Mintpal();
    // 'API_KEY',
    // 'API_SECRET'

    var bittrexApi = new Bittrex();
    // 'API_KEY',
    // 'API_SECRET'

    //
    // market data collection from Poloniex
    //
    this.getProfitDataPoloniex = function (callback) {
        async.series(
            [
                function (taskCallback) {
                    poloApi.getTicker(function (err, data) {
                        if (err) {
                            taskCallback(err);
                            return;
                        }

                        Object.keys(symbolToAlgorithmMap).forEach(
                            function (symbol) {
                                var exchangeInfo =
                                    profitStatus[symbolToAlgorithmMap[symbol]][
                                        symbol
                                    ].exchangeInfo;
                                if (!exchangeInfo.hasOwnProperty('Poloniex'))
                                    exchangeInfo['Poloniex'] = {};
                                var marketData = exchangeInfo['Poloniex'];

                                if (data.hasOwnProperty('BTC_' + symbol)) {
                                    if (!marketData.hasOwnProperty('BTC'))
                                        marketData['BTC'] = {};

                                    var btcData = data['BTC_' + symbol];
                                    marketData['BTC'].ask = new Number(
                                        btcData.lowestAsk
                                    );
                                    marketData['BTC'].bid = new Number(
                                        btcData.highestBid
                                    );
                                    marketData['BTC'].last = new Number(
                                        btcData.last
                                    );
                                    marketData['BTC'].baseVolume = new Number(
                                        btcData.baseVolume
                                    );
                                    marketData['BTC'].quoteVolume = new Number(
                                        btcData.quoteVolume
                                    );
                                }
                                if (data.hasOwnProperty('LTC_' + symbol)) {
                                    if (!marketData.hasOwnProperty('LTC'))
                                        marketData['LTC'] = {};

                                    var ltcData = data['LTC_' + symbol];
                                    marketData['LTC'].ask = new Number(
                                        ltcData.lowestAsk
                                    );
                                    marketData['LTC'].bid = new Number(
                                        ltcData.highestBid
                                    );
                                    marketData['LTC'].last = new Number(
                                        ltcData.last
                                    );
                                    marketData['LTC'].baseVolume = new Number(
                                        ltcData.baseVolume
                                    );
                                    marketData['LTC'].quoteVolume = new Number(
                                        ltcData.quoteVolume
                                    );
                                }
                                // save LTC to BTC exchange rate
                                if (
                                    marketData.hasOwnProperty('LTC') &&
                                    data.hasOwnProperty('BTC_LTC')
                                ) {
                                    var btcLtc = data['BTC_LTC'];
                                    marketData['LTC'].ltcToBtc = new Number(
                                        btcLtc.highestBid
                                    );
                                }
                            }
                        );

                        taskCallback();
                    });
                },
                function (taskCallback) {
                    var depthTasks = [];
                    Object.keys(symbolToAlgorithmMap).forEach(
                        function (symbol) {
                            var marketData =
                                profitStatus[symbolToAlgorithmMap[symbol]][
                                    symbol
                                ].exchangeInfo['Poloniex'];
                            if (
                                marketData.hasOwnProperty('BTC') &&
                                marketData['BTC'].bid > 0
                            ) {
                                depthTasks.push(function (callback) {
                                    _this.getMarketDepthFromPoloniex(
                                        'BTC',
                                        symbol,
                                        marketData['BTC'].bid,
                                        callback
                                    );
                                });
                            }
                            if (
                                marketData.hasOwnProperty('LTC') &&
                                marketData['LTC'].bid > 0
                            ) {
                                depthTasks.push(function (callback) {
                                    _this.getMarketDepthFromPoloniex(
                                        'LTC',
                                        symbol,
                                        marketData['LTC'].bid,
                                        callback
                                    );
                                });
                            }
                        }
                    );

                    if (!depthTasks.length) {
                        taskCallback();
                        return;
                    }
                    async.series(depthTasks, function (err) {
                        if (err) {
                            taskCallback(err);
                            return;
                        }
                        taskCallback();
                    });
                }
            ],
            function (err) {
                if (err) {
                    callback(err);
                    return;
                }
                callback(null);
            }
        );
    };
    this.getMarketDepthFromPoloniex = function (
        symbolA,
        symbolB,
        coinPrice,
        callback
    ) {
        poloApi.getOrderBook(symbolA, symbolB, function (err, data) {
            if (err) {
                callback(err);
                return;
            }
            var depth = new Number(0);
            var totalQty = new Number(0);
            if (data.hasOwnProperty('bids')) {
                data['bids'].forEach(function (order) {
                    var price = new Number(order[0]);
                    var limit = new Number(
                        coinPrice * portalConfig.profitSwitch.depth
                    );
                    var qty = new Number(order[1]);
                    // only measure the depth down to configured depth
                    if (price >= limit) {
                        depth += qty * price;
                        totalQty += qty;
                    }
                });
            }

            var marketData =
                profitStatus[symbolToAlgorithmMap[symbolB]][symbolB]
                    .exchangeInfo['Poloniex'];
            marketData[symbolA].depth = depth;
            if (totalQty > 0)
                marketData[symbolA].weightedBid = new Number(depth / totalQty);
            callback();
        });
    };

    this.getProfitDataCryptsy = function (callback) {
        async.series(
            [
                function (taskCallback) {
                    cryptsyApi.getTicker(function (err, data) {
                        if (err || data.success != 1) {
                            taskCallback(err);
                            return;
                        }

                        Object.keys(symbolToAlgorithmMap).forEach(
                            function (symbol) {
                                var exchangeInfo =
                                    profitStatus[symbolToAlgorithmMap[symbol]][
                                        symbol
                                    ].exchangeInfo;
                                if (!exchangeInfo.hasOwnProperty('Cryptsy'))
                                    exchangeInfo['Cryptsy'] = {};

                                var marketData = exchangeInfo['Cryptsy'];
                                var results = data.return.markets;

                                if (
                                    results &&
                                    results.hasOwnProperty(symbol + '/BTC')
                                ) {
                                    if (!marketData.hasOwnProperty('BTC'))
                                        marketData['BTC'] = {};

                                    var btcData = results[symbol + '/BTC'];
                                    marketData['BTC'].last = new Number(
                                        btcData.lasttradeprice
                                    );
                                    marketData['BTC'].baseVolume = new Number(
                                        marketData['BTC'].last / btcData.volume
                                    );
                                    marketData['BTC'].quoteVolume = new Number(
                                        btcData.volume
                                    );
                                    if (btcData.sellorders != null)
                                        marketData['BTC'].ask = new Number(
                                            btcData.sellorders[0].price
                                        );
                                    if (btcData.buyorders != null) {
                                        marketData['BTC'].bid = new Number(
                                            btcData.buyorders[0].price
                                        );
                                        var limit = new Number(
                                            marketData['BTC'].bid *
                                                portalConfig.profitSwitch.depth
                                        );
                                        var depth = new Number(0);
                                        var totalQty = new Number(0);
                                        btcData['buyorders'].forEach(
                                            function (order) {
                                                var price = new Number(
                                                    order.price
                                                );
                                                var qty = new Number(
                                                    order.quantity
                                                );
                                                if (price >= limit) {
                                                    depth += qty * price;
                                                    totalQty += qty;
                                                }
                                            }
                                        );
                                        marketData['BTC'].depth = depth;
                                        if (totalQty > 0)
                                            marketData['BTC'].weightedBid =
                                                new Number(depth / totalQty);
                                    }
                                }

                                if (
                                    results &&
                                    results.hasOwnProperty(symbol + '/LTC')
                                ) {
                                    if (!marketData.hasOwnProperty('LTC'))
                                        marketData['LTC'] = {};

                                    var ltcData = results[symbol + '/LTC'];
                                    marketData['LTC'].last = new Number(
                                        ltcData.lasttradeprice
                                    );
                                    marketData['LTC'].baseVolume = new Number(
                                        marketData['LTC'].last / ltcData.volume
                                    );
                                    marketData['LTC'].quoteVolume = new Number(
                                        ltcData.volume
                                    );
                                    if (ltcData.sellorders != null)
                                        marketData['LTC'].ask = new Number(
                                            ltcData.sellorders[0].price
                                        );
                                    if (ltcData.buyorders != null) {
                                        marketData['LTC'].bid = new Number(
                                            ltcData.buyorders[0].price
                                        );
                                        var limit = new Number(
                                            marketData['LTC'].bid *
                                                portalConfig.profitSwitch.depth
                                        );
                                        var depth = new Number(0);
                                        var totalQty = new Number(0);
                                        ltcData['buyorders'].forEach(
                                            function (order) {
                                                var price = new Number(
                                                    order.price
                                                );
                                                var qty = new Number(
                                                    order.quantity
                                                );
                                                if (price >= limit) {
                                                    depth += qty * price;
                                                    totalQty += qty;
                                                }
                                            }
                                        );
                                        marketData['LTC'].depth = depth;
                                        if (totalQty > 0)
                                            marketData['LTC'].weightedBid =
                                                new Number(depth / totalQty);
                                    }
                                }
                            }
                        );
                        taskCallback();
                    });
                }
            ],
            function (err) {
                if (err) {
                    callback(err);
                    return;
                }
                callback(null);
            }
        );
    };

    this.getProfitDataMintpal = function (callback) {
        async.series(
            [
                function (taskCallback) {
                    mintpalApi.getTicker(function (err, response) {
                        if (err || !response.data) {
                            taskCallback(err);
                            return;
                        }

                        Object.keys(symbolToAlgorithmMap).forEach(
                            function (symbol) {
                                response.data.forEach(function (market) {
                                    var exchangeInfo =
                                        profitStatus[
                                            symbolToAlgorithmMap[symbol]
                                        ][symbol].exchangeInfo;
                                    if (!exchangeInfo.hasOwnProperty('Mintpal'))
                                        exchangeInfo['Mintpal'] = {};

                                    var marketData = exchangeInfo['Mintpal'];

                                    if (
                                        market.exchange == 'BTC' &&
                                        market.code == symbol
                                    ) {
                                        if (!marketData.hasOwnProperty('BTC'))
                                            marketData['BTC'] = {};

                                        marketData['BTC'].last = new Number(
                                            market.last_price
                                        );
                                        marketData['BTC'].baseVolume =
                                            new Number(market['24hvol']);
                                        marketData['BTC'].quoteVolume =
                                            new Number(
                                                market['24hvol'] /
                                                    market.last_price
                                            );
                                        marketData['BTC'].ask = new Number(
                                            market.top_ask
                                        );
                                        marketData['BTC'].bid = new Number(
                                            market.top_bid
                                        );
                                    }

                                    if (
                                        market.exchange == 'LTC' &&
                                        market.code == symbol
                                    ) {
                                        if (!marketData.hasOwnProperty('LTC'))
                                            marketData['LTC'] = {};

                                        marketData['LTC'].last = new Number(
                                            market.last_price
                                        );
                                        marketData['LTC'].baseVolume =
                                            new Number(market['24hvol']);
                                        marketData['LTC'].quoteVolume =
                                            new Number(
                                                market['24hvol'] /
                                                    market.last_price
                                            );
                                        marketData['LTC'].ask = new Number(
                                            market.top_ask
                                        );
                                        marketData['LTC'].bid = new Number(
                                            market.top_bid
                                        );
                                    }
                                });
                            }
                        );
                        taskCallback();
                    });
                },
                function (taskCallback) {
                    var depthTasks = [];
                    Object.keys(symbolToAlgorithmMap).forEach(
                        function (symbol) {
                            var marketData =
                                profitStatus[symbolToAlgorithmMap[symbol]][
                                    symbol
                                ].exchangeInfo['Mintpal'];
                            if (
                                marketData.hasOwnProperty('BTC') &&
                                marketData['BTC'].bid > 0
                            ) {
                                depthTasks.push(function (callback) {
                                    _this.getMarketDepthFromMintpal(
                                        'BTC',
                                        symbol,
                                        marketData['BTC'].bid,
                                        callback
                                    );
                                });
                            }
                            if (
                                marketData.hasOwnProperty('LTC') &&
                                marketData['LTC'].bid > 0
                            ) {
                                depthTasks.push(function (callback) {
                                    _this.getMarketDepthFromMintpal(
                                        'LTC',
                                        symbol,
                                        marketData['LTC'].bid,
                                        callback
                                    );
                                });
                            }
                        }
                    );

                    if (!depthTasks.length) {
                        taskCallback();
                        return;
                    }
                    async.series(depthTasks, function (err) {
                        if (err) {
                            taskCallback(err);
                            return;
                        }
                        taskCallback();
                    });
                }
            ],
            function (err) {
                if (err) {
                    callback(err);
                    return;
                }
                callback(null);
            }
        );
    };
    this.getMarketDepthFromMintpal = function (
        symbolA,
        symbolB,
        coinPrice,
        callback
    ) {
        mintpalApi.getBuyOrderBook(symbolA, symbolB, function (err, response) {
            if (err) {
                callback(err);
                return;
            }
            var depth = new Number(0);
            if (response.hasOwnProperty('data')) {
                var totalQty = new Number(0);
                response['data'].forEach(function (order) {
                    var price = new Number(order.price);
                    var limit = new Number(
                        coinPrice * portalConfig.profitSwitch.depth
                    );
                    var qty = new Number(order.amount);
                    // only measure the depth down to configured depth
                    if (price >= limit) {
                        depth += qty * price;
                        totalQty += qty;
                    }
                });
            }

            var marketData =
                profitStatus[symbolToAlgorithmMap[symbolB]][symbolB]
                    .exchangeInfo['Mintpal'];
            marketData[symbolA].depth = depth;
            if (totalQty > 0)
                marketData[symbolA].weightedBid = new Number(depth / totalQty);
            callback();
        });
    };

    this.getProfitDataBittrex = function (callback) {
        async.series(
            [
                function (taskCallback) {
                    bittrexApi.getTicker(function (err, response) {
                        if (err || !response.result) {
                            taskCallback(err);
                            return;
                        }

                        Object.keys(symbolToAlgorithmMap).forEach(
                            function (symbol) {
                                response.result.forEach(function (market) {
                                    var exchangeInfo =
                                        profitStatus[
                                            symbolToAlgorithmMap[symbol]
                                        ][symbol].exchangeInfo;
                                    if (!exchangeInfo.hasOwnProperty('Bittrex'))
                                        exchangeInfo['Bittrex'] = {};

                                    var marketData = exchangeInfo['Bittrex'];
                                    var marketPair =
                                        market.MarketName.match(
                                            /([\w]+)-([\w-_]+)/
                                        );
                                    market.exchange = marketPair[1];
                                    market.code = marketPair[2];
                                    if (
                                        market.exchange == 'BTC' &&
                                        market.code == symbol
                                    ) {
                                        if (!marketData.hasOwnProperty('BTC'))
                                            marketData['BTC'] = {};

                                        marketData['BTC'].last = new Number(
                                            market.Last
                                        );
                                        marketData['BTC'].baseVolume =
                                            new Number(market.BaseVolume);
                                        marketData['BTC'].quoteVolume =
                                            new Number(
                                                market.BaseVolume / market.Last
                                            );
                                        marketData['BTC'].ask = new Number(
                                            market.Ask
                                        );
                                        marketData['BTC'].bid = new Number(
                                            market.Bid
                                        );
                                    }

                                    if (
                                        market.exchange == 'LTC' &&
                                        market.code == symbol
                                    ) {
                                        if (!marketData.hasOwnProperty('LTC'))
                                            marketData['LTC'] = {};

                                        marketData['LTC'].last = new Number(
                                            market.Last
                                        );
                                        marketData['LTC'].baseVolume =
                                            new Number(market.BaseVolume);
                                        marketData['LTC'].quoteVolume =
                                            new Number(
                                                market.BaseVolume / market.Last
                                            );
                                        marketData['LTC'].ask = new Number(
                                            market.Ask
                                        );
                                        marketData['LTC'].bid = new Number(
                                            market.Bid
                                        );
                                    }
                                });
                            }
                        );
                        taskCallback();
                    });
                },
                function (taskCallback) {
                    var depthTasks = [];
                    Object.keys(symbolToAlgorithmMap).forEach(
                        function (symbol) {
                            var marketData =
                                profitStatus[symbolToAlgorithmMap[symbol]][
                                    symbol
                                ].exchangeInfo['Bittrex'];
                            if (
                                marketData.hasOwnProperty('BTC') &&
                                marketData['BTC'].bid > 0
                            ) {
                                depthTasks.push(function (callback) {
                                    _this.getMarketDepthFromBittrex(
                                        'BTC',
                                        symbol,
                                        marketData['BTC'].bid,
                                        callback
                                    );
                                });
                            }
                            if (
                                marketData.hasOwnProperty('LTC') &&
                                marketData['LTC'].bid > 0
                            ) {
                                depthTasks.push(function (callback) {
                                    _this.getMarketDepthFromBittrex(
                                        'LTC',
                                        symbol,
                                        marketData['LTC'].bid,
                                        callback
                                    );
                                });
                            }
                        }
                    );

                    if (!depthTasks.length) {
                        taskCallback();
                        return;
                    }
                    async.series(depthTasks, function (err) {
                        if (err) {
                            taskCallback(err);
                            return;
                        }
                        taskCallback();
                    });
                }
            ],
            function (err) {
                if (err) {
                    callback(err);
                    return;
                }
                callback(null);
            }
        );
    };
    this.getMarketDepthFromBittrex = function (
        symbolA,
        symbolB,
        coinPrice,
        callback
    ) {
        bittrexApi.getOrderBook(symbolA, symbolB, function (err, response) {
            if (err) {
                callback(err);
                return;
            }
            var depth = new Number(0);
            if (response.hasOwnProperty('result')) {
                var totalQty = new Number(0);
                response['result'].forEach(function (order) {
                    var price = new Number(order.Rate);
                    var limit = new Number(
                        coinPrice * portalConfig.profitSwitch.depth
                    );
                    var qty = new Number(order.Quantity);
                    // only measure the depth down to configured depth
                    if (price >= limit) {
                        depth += qty * price;
                        totalQty += qty;
                    }
                });
            }

            var marketData =
                profitStatus[symbolToAlgorithmMap[symbolB]][symbolB]
                    .exchangeInfo['Bittrex'];
            marketData[symbolA].depth = depth;
            if (totalQty > 0)
                marketData[symbolA].weightedBid = new Number(depth / totalQty);
            callback();
        });
    };

    this.getCoindDaemonInfo = function (callback) {
        var daemonTasks = [];
        Object.keys(profitStatus).forEach(function (algo) {
            Object.keys(profitStatus[algo]).forEach(function (symbol) {
                var coinName = profitStatus[algo][symbol].name;
                var poolConfig = poolConfigs[coinName];
                var daemonConfig = poolConfig.paymentProcessing.daemon;
                daemonTasks.push(function (callback) {
                    _this.getDaemonInfoForCoin(symbol, daemonConfig, callback);
                });
            });
        });

        if (daemonTasks.length == 0) {
            callback();
            return;
        }
        async.series(daemonTasks, function (err) {
            if (err) {
                callback(err);
                return;
            }
            callback(null);
        });
    };
    this.getDaemonInfoForCoin = function (symbol, cfg, callback) {
        var daemon = new Stratum.daemon.interface([cfg], function (
            severity,
            message
        ) {
            logger[severity](logSystem, symbol, message);
            callback(null); // fail gracefully for each coin
        });

        daemon.cmd(
            'getblocktemplate',
            [{ capabilities: ['coinbasetxn', 'workid', 'coinbase/append'] }],
            function (result) {
                if (result[0].error != null) {
                    logger.error(
                        logSystem,
                        symbol,
                        'Error while reading daemon info: ' +
                            JSON.stringify(result[0])
                    );
                    callback(null); // fail gracefully for each coin
                    return;
                }
                var coinStatus =
                    profitStatus[symbolToAlgorithmMap[symbol]][symbol];
                var response = result[0].response;

                // some coins don't provide target, only bits, so we need to deal with both
                var target = response.target
                    ? BigInt('0x' + response.target)
                    : StratumUtil.bignumFromBitsHex(response.bits);
                coinStatus.difficulty = parseFloat(
                    (diff1 / Number(target)).toFixed(9)
                );
                logger.debug(
                    logSystem,
                    symbol,
                    'difficulty is ' + coinStatus.difficulty
                );

                coinStatus.reward = response.coinbasevalue / 100000000;
                callback(null);
            }
        );
    };

    // Utility function to convert bits to BigInt
    exports.bignumFromBitsHex = function (bitsString) {
        var bitsBuff = Buffer.from(bitsString, 'hex');
        return exports.bignumFromBitsBuffer(bitsBuff);
    };

    exports.bignumFromBitsBuffer = function (bitsBuff) {
        var numBytes = bitsBuff.readUInt8(0);
        var bigBits = BigInt('0x' + bitsBuff.slice(1).toString('hex'));
        var target = bigBits * BigInt(2) ** (BigInt(8) * BigInt(numBytes - 3));
        return target;
    };

    this.getMiningRate = function (callback) {
        var daemonTasks = [];
        Object.keys(profitStatus).forEach(function (algo) {
            Object.keys(profitStatus[algo]).forEach(function (symbol) {
                var coinStatus =
                    profitStatus[symbolToAlgorithmMap[symbol]][symbol];
                coinStatus.blocksPerMhPerHour =
                    86400 /
                    ((coinStatus.difficulty * Math.pow(2, 32)) /
                        (1 * 1000 * 1000));
                coinStatus.coinsPerMhPerHour =
                    coinStatus.reward * coinStatus.blocksPerMhPerHour;
            });
        });
        callback(null);
    };

    this.switchToMostProfitableCoins = function () {
        Object.keys(profitStatus).forEach(function (algo) {
            var algoStatus = profitStatus[algo];

            var bestExchange;
            var bestCoin;
            var bestBtcPerMhPerHour = 0;

            Object.keys(profitStatus[algo]).forEach(function (symbol) {
                var coinStatus = profitStatus[algo][symbol];

                Object.keys(coinStatus.exchangeInfo).forEach(
                    function (exchange) {
                        var exchangeData = coinStatus.exchangeInfo[exchange];
                        if (
                            exchangeData.hasOwnProperty('BTC') &&
                            exchangeData['BTC'].hasOwnProperty('weightedBid')
                        ) {
                            var btcPerMhPerHour =
                                exchangeData['BTC'].weightedBid *
                                coinStatus.coinsPerMhPerHour;
                            if (btcPerMhPerHour > bestBtcPerMhPerHour) {
                                bestBtcPerMhPerHour = btcPerMhPerHour;
                                bestCoin = symbol;
                                bestExchange = exchange;
                            }
                        }
                    }
                );
            });

            if (bestCoin) {
                var currentBest =
                    profitStatus[algo][bestCoin].exchangeInfo[bestExchange];
                var newCoin = profitStatus[algo][bestCoin];

                //
                // only switch if the new coin has a clear advantage
                //
                var switchThreshold = portalConfig.profitSwitch.threshold;
                if (
                    currentBest.hasOwnProperty('BTC') &&
                    newCoin.hasOwnProperty('BTC') &&
                    currentBest.weightedBid * switchThreshold <
                        newCoin.BTC.weightedBid
                ) {
                    logger.info(
                        logSystem,
                        'Switching to more profitable coin: ' +
                            newCoin.name +
                            ' (' +
                            newCoin.symbol +
                            ') on exchange ' +
                            bestExchange
                    );
                    Object.keys(profitStatus).forEach(function (algo) {
                        Object.keys(profitStatus[algo]).forEach(
                            function (symbol) {
                                var coinStatus = profitStatus[algo][symbol];
                                coinStatus.exchangeInfo = {};
                            }
                        );
                    });
                    newCoin.exchangeInfo[bestExchange] = currentBest;
                }
            }
        });
    };
}
