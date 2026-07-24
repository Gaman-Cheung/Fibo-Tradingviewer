/** Pure Fibonacci target and stop calculations. No DOM or storage access. */
export function getAutoPlan(h, l, c) {
            const diff = h - l;
            const fibs = [
                { label:'23.6%', price:h - diff * 0.236 }, { label:'38.2%', price:h - diff * 0.382 },
                { label:'50%', price:h - diff * 0.5 }, { label:'61.8%', price:h - diff * 0.618 },
                { label:'78.6%', price:h - diff * 0.786 }, { label:'88.6%', price:h - diff * 0.886 }
            ];
            const extensions = [
                { label:'1.272延伸', price:l + diff * 1.272 },
                { label:'1.618延伸', price:l + diff * 1.618 },
                { label:'2.618延伸', price:l + diff * 2.618 }
            ];
            const supports = [...fibs, { label:'前低', price:l }];
            if (c >= h) supports.push({ label:'前高回踩', price:h });
            const support = supports.filter(x => x.price <= c).sort((a,b) => b.price - a.price)[0] || { label:'前低', price:l };
            const fibPressure = fibs.filter(x => x.price > c).sort((a,b) => a.price - b.price)[0] || null;
            const nearHigh = c < h && (h - c) / Math.abs(h || 1) <= 0.01;
            let pressure, t1, t2, stage;

            if (c < h && !nearHigh && fibPressure) {
                stage = 'recovery';
                pressure = fibPressure;
                t1 = fibPressure;
                t2 = { label:'前高', price:h };
            } else if (c < h) {
                stage = 'nearHigh';
                pressure = { label:'前高突破', price:h };
                t1 = pressure;
                t2 = extensions[0];
            } else {
                stage = 'breakout';
                const future = extensions.filter(x => x.price > c).sort((a,b) => a.price - b.price);
                pressure = future[0] || { label:'已超2.618', price:extensions[2].price };
                t1 = future[0] || null;
                t2 = future[1] || future[0] || null;
            }
            return { fibs, extensions, support, pressure, t1, t2, stage };
        }

export function movePct(price, base) {
            return Number.isFinite(price) && Number.isFinite(base) && base !== 0 ? (price - base) / base * 100 : null;
        }

export function getStopCandidates(plan, entry, low) {
            if (!Number.isFinite(entry) || entry <= 0) return null;
            const below = [...plan.fibs, { label:'前低', price:low }]
                .filter(level => Number.isFinite(level.price) && level.price < entry)
                .sort((a,b) => b.price - a.price);
            if (!below.length) return null;
            let index = 0;
            let support = below[index];
            let stop = support.price * 0.995;
            let riskPct = (entry - stop) / entry * 100;
            if (riskPct < 3 && below[index + 1]) {
                support = below[++index];
                stop = support.price * 0.995;
                riskPct = (entry - stop) / entry * 100;
            }
            return {
                structure:{ price:stop, riskPct, label:`${support.label} 下方 0.5%`, tooWide:riskPct > 7 },
                fixed5:{ price:entry * 0.95, riskPct:5, label:'Entry -5%' },
                fixed7:{ price:entry * 0.93, riskPct:7, label:'Entry -7%' },
                support
            };
        }
