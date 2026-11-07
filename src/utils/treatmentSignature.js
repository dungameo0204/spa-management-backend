const invalid = () => Object.assign(new Error('Chữ ký phải là SVG nét vẽ hợp lệ (svg/path), tối đa 128 KiB; không nhận script, text, ảnh, liên kết hoặc XML entity.'), { status: 400 });

// Deliberately narrow SVG dialect, not a general SVG sanitizer. Rebuild every tag/attribute.
// Signature pads should export paths only, with an explicit viewBox or width/height.
const normalizeClosureSignature = value => {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 128 * 1024 || /[&\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw invalid();
    const source = value.trim();
    const outer = source.match(/^<svg\b([^<>]*)>([\s\S]*)<\/svg>$/);
    if (!outer) throw invalid();
    const attrs = text => {
        const result = Object.create(null);
        let rest = text;
        while (rest.trim()) {
            const match = rest.match(/^\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/);
            if (!match || Object.hasOwn(result, match[1])) throw invalid();
            result[match[1]] = match[2] ?? match[3];
            rest = rest.slice(match[0].length);
        }
        return result;
    };
    const number = text => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text) && Number(text) > 0 && Number(text) <= 10000;
    const paint = text => /^(?:none|black|#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})$/.test(text);
    const allowedCommon = {
        fill: paint, stroke: paint,
        'stroke-width': number,
        'stroke-linecap': text => ['round', 'butt', 'square'].includes(text),
        'stroke-linejoin': text => ['round', 'bevel', 'miter'].includes(text)
    };
    const rootAttrs = attrs(outer[1]);
    let viewBox;
    if (rootAttrs.viewBox) {
        const parts = rootAttrs.viewBox.trim().split(/[\s,]+/);
        if (parts.length !== 4 || !parts.every(p => /^-?\d+(?:\.\d+)?$/.test(p) && Math.abs(Number(p)) <= 10000) || Number(parts[2]) <= 0 || Number(parts[3]) <= 0) throw invalid();
        viewBox = parts.join(' ');
    } else {
        if (!number(rootAttrs.width || '') || !number(rootAttrs.height || '')) throw invalid();
        viewBox = `0 0 ${rootAttrs.width} ${rootAttrs.height}`;
    }
    for (const [key, val] of Object.entries(rootAttrs)) {
        if (key === 'xmlns' && val === 'http://www.w3.org/2000/svg') continue;
        if (['viewBox', 'width', 'height'].includes(key)) {
            if (key !== 'viewBox' && !number(val)) throw invalid();
            continue;
        }
        if (!Object.hasOwn(allowedCommon, key) || !allowedCommon[key](val)) throw invalid();
    }
    const common = attributes => Object.entries(attributes).filter(([key]) => Object.hasOwn(allowedCommon, key)).map(([key, val]) => ` ${key}="${val}"`).join('');
    const paths = [];
    let rest = outer[2];
    while (rest.trim()) {
        const match = rest.match(/^\s*<path\b([^<>]*?)(?:\s*\/\s*>|>\s*<\/path>)/);
        if (!match || paths.length >= 1000) throw invalid();
        const attributes = attrs(match[1]);
        const d = attributes.d;
        // Restrict lexical input; browser interprets path commands only, never markup/URLs.
        if (!d || d.length > 100000 || !/^[Mm]/.test(d.trim()) || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(d) || (d.match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || []).length < 4) throw invalid();
        const values = d.match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g) || [];
        if (values.some(n => !Number.isFinite(Number(n)) || Math.abs(Number(n)) > 100000)) throw invalid();
        for (const [key, val] of Object.entries(attributes)) if (key !== 'd' && (!Object.hasOwn(allowedCommon, key) || !allowedCommon[key](val))) throw invalid();
        paths.push(`<path d="${d.trim()}"${common(attributes)}/>`);
        rest = rest.slice(match[0].length);
    }
    if (!paths.length) throw invalid();
    const defaults = { fill: 'none', stroke: 'black', 'stroke-width': '2', ...Object.fromEntries(Object.entries(rootAttrs).filter(([key]) => Object.hasOwn(allowedCommon, key))) };
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${common(defaults)}>${paths.join('')}</svg>`;
};
module.exports = { normalizeClosureSignature };