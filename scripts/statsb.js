var poolBalanceData;
var poolBalanceChart;

var statDataBalance;
var poolKeysBalance;

function buildChartDataB() {
    const pools = {};

    poolKeysBalance = ['total', 'transparent', 'private'];

    for (let i = 0; i < statDataBalance.length; i++) {
        const time = statDataBalance[i].time * 1000;
        for (let f = 0; f < poolKeysBalance.length; f++) {
            const pName = poolKeysBalance[f];
            const a = (pools[pName] = pools[pName] || {
                Balance: []
            });
            a.Balance.push([time, statDataBalance[i][pName]]);
        }
    }

    poolBalanceData = [];
    for (const pool in pools) {
        poolBalanceData.push({
            key: pool,
            values: pools[pool].Balance
        });
        $('#statsBalanceAvg' + pool).text(
            getReadableBalanceString(calculateAverageBalance(pool))
        );
    }
}

function calculateAverageBalance(pool) {
    let count = 0;
    let total = 1;
    let avg = 0;
    for (let i = 0; i < poolBalanceData.length; i++) {
        count = 0;
        for (let ii = 0; ii < poolBalanceData[i].values.length; ii++) {
            if (pool == null || poolBalanceData[i].key === pool) {
                count++;
                avg += parseFloat(poolBalanceData[i].values[ii][1]);
            }
        }
        if (count > total) total = count;
    }
    avg = avg / total;
    return avg;
}

function getReadableBalanceString(Balance) {
    Balance = Balance * 1000000;
    if (Balance < 1000000) {
        return '0';
    }
    const byteUnits = [
        ' KOTO',
        ' kKOTO',
        ' MKOTO',
        ' GKOTO',
        ' TKOTO',
        ' PKOTO'
    ];
    const i = Math.floor(Math.log(Balance / 1000) / Math.log(1000) - 1);
    Balance = Balance / 1000 / Math.pow(1000, i + 1);
    return Balance.toFixed(2) + byteUnits[i];
}

function timeOfDayFormatB(timestamp) {
    let dStr = d3.time.format('%I:%M %p')(new Date(timestamp));
    if (dStr.indexOf('0') === 0) dStr = dStr.slice(1);
    return dStr;
}

function displayChartsB() {
    nv.addGraph(function () {
        poolBalanceChart = nv.models
            .lineChart()
            .margin({ left: 80, right: 30 })
            .x(function (d) {
                return d[0];
            })
            .y(function (d) {
                return d[1];
            })
            .useInteractiveGuideline(true);

        poolBalanceChart.xAxis.tickFormat(timeOfDayFormatB);

        poolBalanceChart.yAxis.tickFormat(function (d) {
            return getReadableBalanceString(d);
        });

        d3.select('#poolBalance').datum(poolBalanceData).call(poolBalanceChart);

        return poolBalanceChart;
    });
}

function triggerChartUpdatesB() {
    poolBalanceChart.update();
}

nv.utils.windowResize(triggerChartUpdatesB);

var updateChartB = function () {
    $.getJSON('/static/balance.json?' + new Date().getTime(), function (data) {
        statDataBalance = data;
        buildChartDataB();
        displayChartsB();
    });
};

updateChartB();
setInterval(updateChartB, 30000);

/*
statsSource.addEventListener('message', function(e){
    var stats = JSON.parse(e.data);
    statDataBalance.push(stats);

    var newPoolAdded = (function(){
        for (var p in stats.pools){
            if (poolKeysBalance.indexOf(p) === -1)
                return true;
        }
        return false;
    })();

    if (newPoolAdded || Object.keys(stats.pools).length > poolKeysBalance.length){
        buildChartDataB();
        displayChartsB();
    }
    else {
        var time = stats.time * 1000;
        for (var f = 0; f < poolKeysBalance.length; f++) {
            var pool =  poolKeysBalance[f];
            for (var i = 0; i < poolBalanceData.length; i++) {
                if (poolBalanceData[i].key === pool) {
                    poolBalanceData[i].values.shift();
                    poolBalanceData[i].values.push([time, pool in stats.pools ? stats.pools[pool].Balance : 0]);
					$('#statsBalanceAvg' + pool).text(getReadableBalanceString(calculateAverageBalance(pool)));
                    break;
                }
            }
        }
        triggerChartUpdatesB();
    }
});
*/
