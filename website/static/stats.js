var poolHashrateData;
var poolHashrateChart;
var poolPendingData;
var poolPendingChart;

var statData;
var poolKeys;
/*
Usage:
(1) copy this file to ../website/static/stats.js
(2) add this html to ../website/pages/stats.html
----
<div id="topCharts">
    <div class="chartWrapper">
        <div class="chartLabel">Pool Pending Blocks</div>
        <div class="chartHolder"><svg id="poolPending"/></div>
    </div>
</div>
----
*/

function buildChartData() {
    const pools = {};

    poolKeys = [];
    for (var i = 0; i < statData.length; i++) {
        for (var pool in statData[i].pools) {
            if (poolKeys.indexOf(pool) === -1) poolKeys.push(pool);
        }
    }

    for (var i = 0; i < statData.length; i++) {
        const time = statData[i].time * 1000;
        for (let f = 0; f < poolKeys.length; f++) {
            const pName = poolKeys[f];
            const a = (pools[pName] = pools[pName] || {
                hashrate: [],
                pending: []
            });
            if (pName in statData[i].pools) {
                a.hashrate.push([time, statData[i].pools[pName].hashrate]);
                a.pending.push([time, statData[i].pools[pName].blocks.pending]);
            } else {
                a.hashrate.push([time, 0]);
            }
        }
    }

    poolHashrateData = [];
    poolPendingData = [];
    for (var pool in pools) {
        poolHashrateData.push({
            key: pool,
            values: pools[pool].hashrate
        });
        poolPendingData.push({
            key: pool,
            values: pools[pool].pending
        });
        $('#statsHashrateAvg' + pool).text(
            getReadableHashRateString(calculateAverageHashrate(pool))
        );
    }
}

function calculateAverageHashrate(pool) {
    let count = 0;
    let total = 1;
    let avg = 0;
    for (let i = 0; i < poolHashrateData.length; i++) {
        count = 0;
        for (let ii = 0; ii < poolHashrateData[i].values.length; ii++) {
            if (pool == null || poolHashrateData[i].key === pool) {
                count++;
                avg += parseFloat(poolHashrateData[i].values[ii][1]);
            }
        }
        if (count > total) total = count;
    }
    avg = avg / total;
    return avg;
}

function getReadableHashRateString(hashrate) {
    hashrate = hashrate * 1000000;
    if (hashrate < 1000000) {
        return '0 H/s';
    }
    const byteUnits = [
        ' H/s',
        ' KH/s',
        ' MH/s',
        ' GH/s',
        ' TH/s',
        ' PH/s',
        ' EH/s',
        ' ZH/s',
        ' YH/s'
    ];
    const i = Math.floor(Math.log(hashrate / 1000) / Math.log(1000) - 1);
    hashrate = hashrate / 1000 / Math.pow(1000, i + 1);
    return hashrate.toFixed(2) + byteUnits[i];
}

function getReadableLuckTime(lucktime) {
    let luck = lucktime;
    const timeUnits = [' Days', ' Hours', ' Minutes', ' Seconds'];
    if (luck < 1) {
        luck = luck * 24;
        if (luck < 1) {
            luck = luck * 60;
            if (luck < 1) {
                luck = luck * 60;
                return luck.toFixed(2) + timeUnits[3];
            } else {
                return luck.toFixed(2) + timeUnits[2];
            }
        } else {
            return luck.toFixed(2) + timeUnits[1];
        }
    }
    return luck.toFixed(3) + timeUnits[0];
}

function timeOfDayFormat(timestamp) {
    let dStr = d3.time.format('%I:%M %p')(new Date(timestamp));
    if (dStr.indexOf('0') === 0) dStr = dStr.slice(1);
    return dStr;
}

function displayCharts() {
    nv.addGraph(function () {
        poolHashrateChart = nv.models
            .lineChart()
            .margin({ left: 80, right: 30 })
            .x(function (d) {
                return d[0];
            })
            .y(function (d) {
                return d[1];
            })
            .useInteractiveGuideline(true);

        poolHashrateChart.xAxis.tickFormat(timeOfDayFormat);

        poolHashrateChart.yAxis.tickFormat(function (d) {
            return getReadableHashRateString(d);
        });

        d3.select('#poolHashrate')
            .datum(poolHashrateData)
            .call(poolHashrateChart);

        return poolHashrateChart;
    });

    nv.addGraph(function () {
        poolPendingChart = nv.models
            .lineChart()
            .margin({ left: 80, right: 30 })
            .x(function (d) {
                return d[0];
            })
            .y(function (d) {
                return d[1];
            })
            .useInteractiveGuideline(true);
        poolPendingChart.xAxis.tickFormat(timeOfDayFormat);

        poolPendingChart.yAxis.tickFormat(function (d) {
            return d.toFixed(2);
        });

        d3.select('#poolPending').datum(poolPendingData).call(poolPendingChart);

        return poolPendingChart;
    });
}

function triggerChartUpdates() {
    poolHashrateChart.update();
    poolPendingChart.update();
}

nv.utils.windowResize(triggerChartUpdates);

function rebuildAllChart() {
    $.getJSON('/api/pool_stats', function (data) {
        statData = data;
        buildChartData();
        displayCharts();
    });
}
rebuildAllChart();

function fmtPriceClient(v) {
    if (typeof v !== 'number') return v;
    return v >= 1 ? v.toFixed(2) : v.toPrecision(4);
}

// Update the Live Prices box in place from a stats SSE payload. Only touches
// symbols already rendered server-side (#price_<SYM>); new symbols appear on
// the next full page load.
function updatePriceDisplay(stats) {
    if (!stats || !stats.prices || !stats.prices.prices) return;
    const prices = stats.prices.prices;
    for (const sym in prices) {
        const el = document.querySelector('#price_' + sym + ' .priceValue');
        if (el) el.textContent = fmtPriceClient(prices[sym].price);
    }
}

var poolChartHidden = false;

statsSource.addEventListener('message', function (e) {
    if (document.hidden) {
        poolChartHidden = true;
        return;
    }

    if (poolChartHidden) {
        poolChartHidden = false;
        rebuildAllChart();
        return;
    }

    const stats = JSON.parse(e.data);
    updatePriceDisplay(stats);
    statData.push(stats);
    if (statData.length > 482) statData.shift();

    const newPoolAdded = (function () {
        for (const p in stats.pools) {
            if (poolKeys.indexOf(p) === -1) return true;
        }
        return false;
    })();

    if (newPoolAdded || Object.keys(stats.pools).length > poolKeys.length) {
        buildChartData();
        displayCharts();
    } else {
        const time = stats.time * 1000;
        for (let f = 0; f < poolKeys.length; f++) {
            const pool = poolKeys[f];
            for (var i = 0; i < poolHashrateData.length; i++) {
                if (poolHashrateData[i].key === pool) {
                    poolHashrateData[i].values.shift();
                    poolHashrateData[i].values.push([
                        time,
                        pool in stats.pools ? stats.pools[pool].hashrate : 0
                    ]);
                    $('#statsHashrateAvg' + pool).text(
                        getReadableHashRateString(
                            calculateAverageHashrate(pool)
                        )
                    );
                    break;
                }
            }
            for (var i = 0; i < poolPendingData.length; i++) {
                if (poolPendingData[i].key === pool) {
                    poolPendingData[i].values.shift();
                    poolPendingData[i].values.push([
                        time,
                        pool in stats.pools
                            ? stats.pools[pool].blocks.pending
                            : 0
                    ]);
                    break;
                }
            }
        }
        triggerChartUpdates();
    }
});
