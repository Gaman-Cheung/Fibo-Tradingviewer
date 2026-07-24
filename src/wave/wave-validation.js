/** Pure Elliott Wave structural validation. */
export function validateWaveStructure(m, dir, format) {
    const errors = [];
    const warnings = [];
    const up = dir === 1;
    const higher = (a, b) => up ? a > b : a < b;
    const lower = (a, b) => up ? a < b : a > b;
    const filled = key => m[key] !== null;

    if (!filled("p0") || !filled("p1")) {
        warnings.push("等待完整填写 P0、P1 后开始普通推动浪结构校验。");
    }

    if (filled("p0") && filled("p1") && m.p0 === m.p1) {
        errors.push("P0 与 P1 相同，浪1没有有效幅度。");
    }

    if (filled("p2")) {
        if (!filled("p0") || !filled("p1")) {
            warnings.push("已填写 P2，但 P0/P1 不完整，无法验证浪2。");
        } else {
            if (!lower(m.p2, m.p1)) errors.push("P2 没有相对 P1 形成反向调整。");
            if (!higher(m.p2, m.p0)) errors.push("P2 已越过或触及 P0，普通推动浪计数失效。");
        }
    }

    if (filled("p3")) {
        if (!filled("p2")) {
            warnings.push("已填写 P3，但 P2 未确认，三浪结构只能作为区间假设。");
        } else if (!higher(m.p3, m.p2)) {
            errors.push("P3 没有沿主趋势越过 P2。");
        }
        if (filled("p1") && !higher(m.p3, m.p1)) {
            errors.push("P3 未越过 P1，不符合普通推动浪的三浪结构。");
        }
    }

    if (filled("p4")) {
        if (!filled("p3")) {
            warnings.push("已填写 P4，但 P3 未确认，四浪结构无法验证。");
        } else if (!lower(m.p4, m.p3)) {
            errors.push("P4 没有相对 P3 形成反向调整。");
        }
        if (filled("p1") && !higher(m.p4, m.p1)) {
            errors.push("P4 已进入浪1价格区间；普通推动浪失效，除非按倾斜三角形重新标注。");
        }
    }

    if (filled("p5")) {
        if (!filled("p4")) {
            warnings.push("已填写 P5，但 P4 未确认，五浪结构无法完整验证。");
        } else if (!higher(m.p5, m.p4)) {
            errors.push("P5 没有沿主趋势越过 P4。");
        }
        if (filled("p3") && !higher(m.p5, m.p3)) {
            warnings.push("P5 未越过 P3，可能是失败五浪，也可能需要重新划分浪级。");
        }
    }

    if (["p0","p1","p2","p3","p4","p5"].every(filled)) {
        const w1 = Math.abs(m.p1 - m.p0);
        const w3 = Math.abs(m.p3 - m.p2);
        const w5 = Math.abs(m.p5 - m.p4);
        if (w3 < w1 && w3 < w5) {
            errors.push(`浪3幅度 ${format(w3)} 同时短于浪1 ${format(w1)} 与浪5 ${format(w5)}，违反“三浪不能最短”。`);
        }
    }

    if (filled("a")) {
        if (!filled("p5")) warnings.push("已填写 A 点，但 P5 未确认。");
        else if (!lower(m.a, m.p5)) errors.push("A浪没有从 P5 向主趋势反方向运行。");
    }

    if (filled("b")) {
        if (!filled("a")) warnings.push("已填写 B 点，但 A 点未确认。");
        else if (!higher(m.b, m.a)) errors.push("B浪没有相对 A浪形成反弹。");
        if (filled("p5") && higher(m.b, m.p5)) {
            warnings.push("B浪越过 P5，可能属于扩散平台型调整，不能按普通锯齿形直接理解。");
        }
    }

    return { errors, warnings, valid: errors.length === 0 };
}
