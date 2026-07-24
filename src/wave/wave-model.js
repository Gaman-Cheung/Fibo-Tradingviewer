/** Pure macro Elliott Wave model builder. */
import { rangeOf, directionSign, addByDir, subByDir } from './wave-math.js';
import { validateWaveStructure } from './wave-validation.js';

export function buildWaveModel(input) {
    const { main:m, retrace:rts, extend:exts, subWaves, ratios, format } = input;
    const { W4_RETRACE, W5_BY_W1, W5_BY_W3, W5_BY_03, ABC_A, ABC_B, ABC_C } = ratios;

    const dir = directionSign(m.p0, m.p1);
    const w1Len = (m.p0 !== null && m.p1 !== null) ? Math.abs(m.p1 - m.p0) : null;

    const wave2 = [];
    const wave3 = [];
    const wave4 = [];
    const wave5 = [];
    const abc = {
        aTargets: [],
        bTargets: [],
        cTargets: []
    };

    if (w1Len !== null) {
        rts.forEach(r => {
            const price = subByDir(m.p1, w1Len, r, dir);
            wave2.push({ ratio: r, price });
        });
    }

    let p2Candidates = m.p2 !== null ? [m.p2] : wave2.map(x => x.price);

    if (w1Len !== null && p2Candidates.length) {
        exts.forEach(r => {
            const prices = p2Candidates.map(p2 => addByDir(p2, w1Len, r, dir));
            wave3.push({
                ratio: r,
                prices,
                range: rangeOf(prices)
            });
        });
    }

    let p3Candidates = m.p3 !== null
        ? [m.p3]
        : wave3.filter(x => x.ratio >= 1.272 && x.ratio <= 2).flatMap(x => x.prices);

    if (m.p2 !== null && p3Candidates.length) {
        W4_RETRACE
            .filter(r => rts.includes(r))
            .forEach(r => {
                const prices = p3Candidates.map(p3 => {
                    const w3Len = Math.abs(p3 - m.p2);
                    return subByDir(p3, w3Len, r, dir);
                });

                wave4.push({
                    ratio: r,
                    prices,
                    range: rangeOf(prices)
                });
            });
    }

    let p4Candidates = m.p4 !== null
        ? [m.p4]
        : wave4.filter(x => x.ratio >= 0.236 && x.ratio <= 0.5).flatMap(x => x.prices);

    if (p4Candidates.length && w1Len !== null) {
        W5_BY_W1
            .filter(r => exts.includes(r) || r === 0.618)
            .forEach(r => {
                const prices = p4Candidates.map(p4 => addByDir(p4, w1Len, r, dir));
                wave5.push({
                    method: "按浪1幅度",
                    ratio: r,
                    prices,
                    range: rangeOf(prices)
                });
            });
    }

    if (p4Candidates.length && m.p2 !== null && p3Candidates.length) {
        W5_BY_W3
            .filter(r => rts.includes(r) || exts.includes(r))
            .forEach(r => {
                let prices = [];
                p4Candidates.forEach(p4 => {
                    p3Candidates.forEach(p3 => {
                        const w3Len = Math.abs(p3 - m.p2);
                        prices.push(addByDir(p4, w3Len, r, dir));
                    });
                });

                wave5.push({
                    method: "按浪3幅度",
                    ratio: r,
                    prices,
                    range: rangeOf(prices)
                });
            });
    }

    if (p4Candidates.length && m.p0 !== null && p3Candidates.length) {
        W5_BY_03
            .filter(r => rts.includes(r) || exts.includes(r))
            .forEach(r => {
                let prices = [];
                p4Candidates.forEach(p4 => {
                    p3Candidates.forEach(p3 => {
                        const len03 = Math.abs(p3 - m.p0);
                        prices.push(addByDir(p4, len03, r, dir));
                    });
                });

                wave5.push({
                    method: "按0-3整体",
                    ratio: r,
                    prices,
                    range: rangeOf(prices)
                });
            });
    }

    if (m.p5 !== null && m.p0 !== null) {
        const totalLen = Math.abs(m.p5 - m.p0);

        ABC_A
            .filter(r => rts.includes(r))
            .forEach(r => {
                abc.aTargets.push({
                    ratio: r,
                    price: subByDir(m.p5, totalLen, r, dir)
                });
            });

        const aCandidates = m.a !== null ? [m.a] : abc.aTargets.map(x => x.price);

        if (aCandidates.length) {
            ABC_B
                .filter(r => rts.includes(r))
                .forEach(r => {
                    const prices = aCandidates.map(a => {
                        const aLen = Math.abs(m.p5 - a);
                        return addByDir(a, aLen, r, dir);
                    });

                    abc.bTargets.push({
                        ratio: r,
                        prices,
                        range: rangeOf(prices)
                    });
                });
        }

        if (m.a !== null) {
            const bCandidates = m.b !== null
                ? [m.b]
                : abc.bTargets.filter(x => x.ratio >= 0.382 && x.ratio <= 0.786).flatMap(x => x.prices);

            ABC_C
                .filter(r => exts.includes(r) || r === 0.618)
                .forEach(r => {
                    const aLen = Math.abs(m.p5 - m.a);
                    const prices = bCandidates.map(b => subByDir(b, aLen, r, dir));

                    abc.cTargets.push({
                        ratio: r,
                        prices,
                        range: rangeOf(prices)
                    });
                });
        }
    }

    return {
        main: m,
        dir,
        w1Len,
        retrace: rts,
        extend: exts,
        wave2,
        wave3,
        wave4,
        wave5,
        abc,
        subWaves,
        validation: validateWaveStructure(m, dir, format)
    };
}
