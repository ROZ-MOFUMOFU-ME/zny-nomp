var workerHashrateData;
var workerHashrateChart;
var workerHistoryMax = 160;

var statData;
var totalHash;
var totalImmature;
var totalBal;
var totalPaid;
var totalShares;

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

function getWorkerNameFromAddress(w) {
    let worker = w;
    if (w.split('.').length > 1) {
        worker = w.split('.')[1];
        if (worker == null || worker.length < 1) {
            worker = 'noname';
        }
    } else {
        worker = 'noname';
    }
    return worker;
}

function buildChartData() {
    const workers = {};
    for (const w in statData.history) {
        var worker = getWorkerNameFromAddress(w);
        const a = (workers[worker] = workers[worker] || {
            hashrate: []
        });
        for (const wh in statData.history[w]) {
            a.hashrate.push([
                statData.history[w][wh].time * 1000,
                statData.history[w][wh].hashrate
            ]);
        }
        if (a.hashrate.length > workerHistoryMax) {
            workerHistoryMax = a.hashrate.length;
        }
    }

    let i = 0;
    workerHashrateData = [];
    for (var worker in workers) {
        workerHashrateData.push({
            key: worker,
            disabled: i > Math.min(_workerCount - 1, 3),
            values: workers[worker].hashrate
        });
        i++;
    }
}

function updateChartData() {
    const workers = {};
    for (const w in statData.history) {
        const worker = getWorkerNameFromAddress(w);
        // get a reference to lastest workerhistory
        for (var wh in statData.history[w]) {
        }
        //var wh = statData.history[w][statData.history[w].length - 1];
        let foundWorker = false;
        for (let i = 0; i < workerHashrateData.length; i++) {
            if (workerHashrateData[i].key === worker) {
                foundWorker = true;
                if (workerHashrateData[i].values.length >= workerHistoryMax) {
                    workerHashrateData[i].values.shift();
                }
                workerHashrateData[i].values.push([
                    statData.history[w][wh].time * 1000,
                    statData.history[w][wh].hashrate
                ]);
                break;
            }
        }
        if (!foundWorker) {
            const hashrate = [];
            hashrate.push([
                statData.history[w][wh].time * 1000,
                statData.history[w][wh].hashrate
            ]);
            workerHashrateData.push({
                key: worker,
                values: hashrate
            });
            rebuildWorkerDisplay();
            return true;
        }
    }
    triggerChartUpdates();
    return false;
}

function calculateAverageHashrate(worker) {
    let count = 0;
    let total = 1;
    let avg = 0;
    for (let i = 0; i < workerHashrateData.length; i++) {
        count = 0;
        for (let ii = 0; ii < workerHashrateData[i].values.length; ii++) {
            if (worker == null || workerHashrateData[i].key === worker) {
                count++;
                avg += parseFloat(workerHashrateData[i].values[ii][1]);
            }
        }
        if (count > total) total = count;
    }
    avg = avg / total;
    return avg;
}

function triggerChartUpdates() {
    workerHashrateChart.update();
}

function displayCharts() {
    nv.addGraph(function () {
        workerHashrateChart = nv.models
            .lineChart()
            .margin({ left: 80, right: 30 })
            .x(function (d) {
                return d[0];
            })
            .y(function (d) {
                return d[1];
            })
            .useInteractiveGuideline(true);

        workerHashrateChart.xAxis.tickFormat(timeOfDayFormat);

        workerHashrateChart.yAxis.tickFormat(function (d) {
            return getReadableHashRateString(d);
        });
        d3.select('#workerHashrate')
            .datum(workerHashrateData)
            .call(workerHashrateChart);
        return workerHashrateChart;
    });
}

function updateStats() {
    totalHash = statData.totalHash;
    totalPaid = statData.paid;
    totalBal = statData.balance;
    totalImmature = statData.immature;
    totalShares = statData.totalShares;
    // do some calculations
    let luckDays = 0;
    for (const w in statData.workers) {
        luckDays = luckDays + 1 / statData.workers[w].luckDays;
    }
    luckDays = 1 / luckDays;
    // update miner stats
    $('#statsHashrate').text(getReadableHashRateString(totalHash));
    $('#statsHashrateAvg').text(
        getReadableHashRateString(calculateAverageHashrate(null))
    );
    $('#statsLuckDays').text(getReadableLuckTime(luckDays));
    $('#statsTotalImmature').text(totalImmature);
    $('#statsTotalBal').text(totalBal);
    $('#statsTotalPaid').text(totalPaid);
    $('#statsTotalShares').text(totalShares.toFixed(2));
}
function updateWorkerStats() {
    // update worker stats
    let i = 0;
    for (const w in statData.workers) {
        i++;
        const htmlSafeWorkerName = w
            .split('.')
            .join('_')
            .replace(/[^\w\s]/gi, '');
        const saneWorkerName = getWorkerNameFromAddress(w);
        $('#statsHashrate' + htmlSafeWorkerName).text(
            getReadableHashRateString(statData.workers[w].hashrate)
        );
        $('#statsHashrateAvg' + htmlSafeWorkerName).text(
            getReadableHashRateString(calculateAverageHashrate(saneWorkerName))
        );
        $('#statsLuckDays' + htmlSafeWorkerName).text(
            getReadableLuckTime(statData.workers[w].luckDays)
        );
        $('#statsPaid' + htmlSafeWorkerName).text(statData.workers[w].paid);
        $('#statsBalance' + htmlSafeWorkerName).text(
            statData.workers[w].balance
        );
        $('#statsShares' + htmlSafeWorkerName).text(
            Math.round(statData.workers[w].currRoundShares * 100) / 100
        );
        $('#statsDiff' + htmlSafeWorkerName).text(statData.workers[w].diff);
    }
}
function addWorkerToDisplay(name, htmlSafeName, workerObj) {
    let htmlToAdd = '';
    htmlToAdd =
        '<div class="boxStats" id="boxStatsLeft" style="float:left; margin: 9px; min-width: 260px;"><div class="boxStatsList">';
    htmlToAdd +=
        '<div class="boxLowerHeader">' +
        name.replace(/[^\w\s]/gi, '') +
        '</div><div>';
    htmlToAdd +=
        '<div><i class="fas fa-tachometer-alt fa-fw"></i> <span id="statsHashrate' +
        htmlSafeName +
        '">' +
        getReadableHashRateString(workerObj.hashrate) +
        '</span> (Now)</div>';
    htmlToAdd +=
        '<div><i class="fas fa-tachometer-alt fa-fw"></i> <span id="statsHashrateAvg' +
        htmlSafeName +
        '">' +
        getReadableHashRateString(calculateAverageHashrate(name)) +
        '</span> (Avg)</div>';
    htmlToAdd +=
        '<div><i class="fas fa-unlock-alt fa-fw"></i> <small>Diff:</small> <span id="statsDiff' +
        htmlSafeName +
        '">' +
        workerObj.diff +
        '</span></div>';
    htmlToAdd +=
        '<div><i class="fas fa-cog fa-fw"></i> <small>Shares:</small> <span id="statsShares' +
        htmlSafeName +
        '">' +
        Math.round(workerObj.currRoundShares * 100) / 100 +
        '</span></div>';
    htmlToAdd +=
        '<div><i class="fas fa-clock fa-fw"></i> <small>Luck:</small> <span id="statsLuckDays' +
        htmlSafeName +
        '">' +
        getReadableLuckTime(workerObj.luckDays) +
        '</span></div>';
    htmlToAdd +=
        '<div><i class="fas fa-money-bill-alt fa-fw"></i> <small>Bal:</small> <span id="statsBalance' +
        htmlSafeName +
        '">' +
        workerObj.balance +
        '</span></div>';
    htmlToAdd +=
        '<div><i class="fas fa-money-bill-alt fa-fw"></i> <small>Paid:</small> <span id="statsPaid' +
        htmlSafeName +
        '">' +
        workerObj.paid +
        '</span></div>';
    htmlToAdd += '</div></div></div>';
    $('#boxesWorkers').html($('#boxesWorkers').html() + htmlToAdd);
}

function rebuildWorkerDisplay() {
    $('#boxesWorkers').html('');
    let i = 0;
    for (const w in statData.workers) {
        i++;
        const htmlSafeWorkerName = w
            .split('.')
            .join('_')
            .replace(/[^\w\s]/gi, '');
        const saneWorkerName = getWorkerNameFromAddress(w);
        addWorkerToDisplay(
            saneWorkerName,
            htmlSafeWorkerName,
            statData.workers[w]
        );
    }
}

// resize chart on window resize
nv.utils.windowResize(triggerChartUpdates);

// grab initial stats
$.getJSON('/api/worker_stats?' + _miner, function (data) {
    statData = data;
    for (const w in statData.workers) {
        _workerCount++;
    }
    buildChartData();
    displayCharts();
    rebuildWorkerDisplay();
    updateStats();
});

// live stat updates
statsSource.addEventListener('message', function (e) {
    if (document.hidden) return;

    // TODO, create miner_live_stats...
    // miner_live_stats will return the same josn except without the worker history
    // FOR NOW, use this to grab updated stats
    $.getJSON('/api/worker_stats?' + _miner, function (data) {
        statData = data;
        // check for missing workers
        let wc = 0;
        let rebuilt = false;
        // update worker stats
        for (const w in statData.workers) {
            wc++;
        }
        // TODO, this isn't 100% fool proof!
        if (_workerCount != wc) {
            if (_workerCount > wc) {
                rebuildWorkerDisplay();
                rebuilt = true;
            }
            _workerCount = wc;
        }
        rebuilt = rebuilt || updateChartData();
        updateStats();
        if (!rebuilt) {
            updateWorkerStats();
        }
    });
});
