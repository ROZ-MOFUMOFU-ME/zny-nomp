// Formatting helpers ported from the legacy templates / statsUtil. The API
// returns many numbers as strings, so everything coerces defensively.

export function toNum(v: unknown): number {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = parseFloat(String(v));
    return isFinite(n) ? n : 0;
}

// Hashrate is stored in an internal MH/s-scaled unit; mirror
// statsUtil.readableHashRateString (multiplies by 1e6 first).
export function readableHashRateString(hashrate: unknown): string {
    let h = toNum(hashrate) * 1000000;
    const units = [' H', ' KH', ' MH', ' GH', ' TH', ' PH'];
    let i = 0;
    if (h < 1) return '0 H/s';
    while (h > 1000 && i < units.length - 1) {
        h = h / 1000;
        i++;
    }
    return h.toFixed(2) + units[i] + '/s';
}

// Largest-unit "luck" string from a value in days (server sends luckDays).
export function readableLuckTime(luckDays: unknown): string {
    const days = toNum(luckDays);
    if (days <= 0) return '–';
    if (days >= 1) return days.toFixed(2) + ' days';
    const hours = days * 24;
    if (hours >= 1) return hours.toFixed(2) + ' hours';
    const minutes = hours * 60;
    if (minutes >= 1) return minutes.toFixed(2) + ' min';
    return (minutes * 60).toFixed(0) + ' sec';
}

export function readableSeconds(secondsRaw: unknown): string {
    let s = Math.floor(toNum(secondsRaw));
    const d = Math.floor(s / 86400);
    s %= 86400;
    const h = Math.floor(s / 3600);
    s %= 3600;
    const m = Math.floor(s / 60);
    s %= 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// Coin-amount formatter. The API serves balances/payouts/payment amounts as
// already-decimal coin values (the share/payment processor stores coins, and
// stats.js converts the only satoshi field, immature, server-side), so this
// must NOT divide by 1e8 — it just fixes the precision.
export function formatAmount(coins: unknown, digits = 8): string {
    return toNum(coins).toFixed(digits);
}

export function maskAddress(addr: string): string {
    if (!addr || addr.length <= 12) return addr;
    return addr.slice(0, 4) + '****' + addr.slice(-4);
}

export interface ParsedBlock {
    blockHash: string;
    txHash: string;
    height: string;
    worker: string;
    time: string;
}

// Pending/confirmed block strings are colon-joined, in the order the share
// processor stores them: blockHash:txHash:height:worker:time
export function parseBlockString(raw: string): ParsedBlock {
    const p = String(raw).split(':');
    return {
        blockHash: p[0] ?? '',
        txHash: p[1] ?? '',
        height: p[2] ?? '',
        worker: p[3] ?? '',
        time: p[4] ?? ''
    };
}

// Time-of-day in the viewer's own time zone, English/24h — for compact chart
// axis ticks. Accepts seconds or milliseconds.
export function shortTime(unixSecondsOrMs: unknown): string {
    const n = toNum(unixSecondsOrMs);
    if (!n) return '';
    const ms = n < 1e12 ? n * 1000 : n;
    return new Intl.DateTimeFormat('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    }).format(new Date(ms));
}

// Full timestamp in English, rendered for the viewer's own time zone via Intl.
// The zone label is whatever Intl derives from the browser (e.g. "GMT+9") — we
// never hardcode "UTC+9"/"JST"/a locale-specific long name like "日本標準時".
export function readableDate(msOrSec: unknown): string {
    const n = toNum(msOrSec);
    if (!n) return '';
    const ms = n < 1e12 ? n * 1000 : n;
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short'
    }).format(new Date(ms));
}

export function explorerUrl(
    template: string | undefined,
    value: string
): string | null {
    if (!template) return null;
    return template.includes('{')
        ? template.replace(/\{[^}]*\}/, value)
        : template + value;
}
