/** Pure Elliott Wave math helpers. No DOM, storage or network access. */
export function rangeOf(arr) {
    const vals = arr.filter(v => Number.isFinite(v));
    if (!vals.length) return null;
    return {
        min: Math.min(...vals),
        max: Math.max(...vals)
    };
}

export function directionSign(p0, p1) {
    if (p0 === null || p1 === null) return 1;
    return p1 >= p0 ? 1 : -1;
}

export function addByDir(base, len, ratio, dir) {
    return base + dir * Math.abs(len) * ratio;
}

export function subByDir(base, len, ratio, dir) {
    return base - dir * Math.abs(len) * ratio;
}

export function calcSubTargets(sw, rts, exts) {
    let retraces = [];
    let extensionTargets = [];

    if (!sw.valid) {
        return {
            retraces,
            extensionTargets
        };
    }

    const high = sw.high;
    const low = sw.low;
    const len = sw.len;

    if (sw.type === "up") {
        retraces = rts.map(r => ({
            ratio: r,
            price: high - len * r
        }));

        extensionTargets = exts.map(r => ({
            ratio: r,
            price: low + len * r
        }));
    } else {
        retraces = rts.map(r => ({
            ratio: r,
            price: low + len * r
        }));

        extensionTargets = exts.map(r => ({
            ratio: r,
            price: high - len * r
        }));
    }

    return {
        retraces,
        extensionTargets
    };
}

export function findClusters(prices, tolerance = 0.015) {
    const arr = prices.filter(Number.isFinite).sort((a, b) => a - b);
    const clusters = [];

    arr.forEach(p => {
        let found = false;

        for (const c of clusters) {
            const mid = (c.min + c.max) / 2;
            if (Math.abs(p - mid) / Math.abs(mid || 1) <= tolerance) {
                c.min = Math.min(c.min, p);
                c.max = Math.max(c.max, p);
                c.count++;
                found = true;
                break;
            }
        }

        if (!found) {
            clusters.push({ min: p, max: p, count: 1 });
        }
    });

    return clusters.filter(c => c.count >= 3).sort((a, b) => b.count - a.count).slice(0, 5);
}
