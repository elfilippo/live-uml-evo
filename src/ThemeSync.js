const ROLES = ["background", "canvas", "accent", "text"];

const PUML_CLASS_PROPS = {
    backgroundcolor: "background",
    arrowcolor: "accent",
    bordercolor: "accent",
    fontcolor: "text",
    attributefontcolor: "text",
    stereotypefontcolor: "text"
};

const PUML_GLOBAL_PROPS = {
    backgroundcolor: "canvas",
    defaultfontcolor: "text",
    arrowfontcolor: "text"
};

const PUML_CANONICAL = {
    canvas: ["backgroundColor"],
    text: ["defaultFontColor", "ArrowFontColor", "classFontColor", "classAttributeFontColor", "classStereotypeFontColor"],
    background: ["classBackgroundColor"],
    accent: ["classArrowColor", "classBorderColor"]
};

const MERMAID_KEYS = {
    background: "canvas",
    edgelabelbackground: "canvas",
    mainbkg: "background",
    secondbkg: "background",
    primarycolor: "background",
    primarybordercolor: "accent",
    linecolor: "accent",
    nodeborder: "accent",
    classborder: "accent",
    primarytextcolor: "text",
    classtext: "text",
    textcolor: "text",
    nodetextcolor: "text"
};

const BLOCK_START = /^\s*skinparam\s+(\w+)\s*\{\s*$/i;
const BLOCK_END = /^\s*\}\s*$/;
const FLAT_LINE = /^(\s*skinparam\s+)(\w+)(\s+)(\S+)(.*)$/i;
const BLOCK_LINE = /^(\s*)(\w+)(\s+)(\S+)(.*)$/;
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(value) {
    if (typeof value !== "string" || !HEX.test(value)) return null;
    const v = value.toLowerCase();
    return v.length === 4 ? "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3] : v;
}

function scanPlantuml(lines) {
    const found = [];
    let block = null;
    lines.forEach((line, index) => {
        const open = BLOCK_START.exec(line);
        if (open) {
            block = open[1].toLowerCase();
            return;
        }
        if (block !== null && BLOCK_END.test(line)) {
            block = null;
            return;
        }
        let match;
        let scope;
        let name;
        if (block !== null) {
            match = BLOCK_LINE.exec(line);
            if (!match) return;
            scope = block;
            name = match[2].toLowerCase();
        } else {
            match = FLAT_LINE.exec(line);
            if (!match) return;
            name = match[2].toLowerCase();
            scope = name.startsWith("class") && PUML_CLASS_PROPS[name.slice(5)] ? "class" : "global";
            if (scope === "class") name = name.slice(5);
        }
        const role = scope === "class" ? PUML_CLASS_PROPS[name] : scope === "global" ? PUML_GLOBAL_PROPS[name] : null;
        if (!role) return;
        found.push({
            index,
            role,
            id: scope + "." + name,
            value: normalizeHex(match[4]),
            head: match[1] + match[2] + match[3],
            tail: match[5]
        });
    });
    return found;
}

function scanMermaid(code) {
    const found = [];
    const blockRe = /%%\{\s*(?:init|initialize)\s*:[\s\S]*?\}\s*%%/gi;
    let block;
    while ((block = blockRe.exec(code))) {
        const propRe = /(["']?)([A-Za-z]+)\1(\s*:\s*)(["'])(#[0-9a-fA-F]{3,8})\4/g;
        let prop;
        while ((prop = propRe.exec(block[0]))) {
            const role = MERMAID_KEYS[prop[2].toLowerCase()];
            if (!role) continue;
            const start = block.index + prop.index;
            const [whole, keyQuote, key, colon, valueQuote] = prop;
            found.push({
                role,
                id: prop[2].toLowerCase(),
                value: normalizeHex(prop[5]),
                start,
                end: start + whole.length,
                build: (hex) => keyQuote + key + keyQuote + colon + valueQuote + hex + valueQuote
            });
        }
    }
    return found;
}

function read(code, mode, previous) {
    const entries = mode === "mermaid" ? scanMermaid(code || "") : scanPlantuml((code || "").split(/\r?\n/));
    const snapshot = {};
    const byRole = {};
    entries.forEach((entry) => {
        if (!entry.value) return;
        snapshot[entry.id] = entry.value;
        (byRole[entry.role] = byRole[entry.role] || []).push(entry);
    });
    const colors = {};
    Object.keys(byRole).forEach((role) => {
        const list = byRole[role];
        const changed = previous ? list.filter((entry) => previous[entry.id] !== entry.value) : [];
        colors[role] = (changed.length ? changed[changed.length - 1] : list[0]).value;
    });
    return { colors, snapshot };
}

function applyPlantuml(code, target) {
    const eol = code.includes("\r\n") ? "\r\n" : "\n";
    const lines = code.split(/\r?\n/);
    const present = new Set();
    scanPlantuml(lines).forEach((entry) => {
        present.add(entry.role);
        const hex = target[entry.role];
        if (hex) lines[entry.index] = entry.head + hex + entry.tail;
    });
    const inserted = [];
    ROLES.forEach((role) => {
        if (!target[role] || present.has(role)) return;
        PUML_CANONICAL[role].forEach((name) => inserted.push("skinparam " + name + " " + target[role]));
    });
    if (inserted.length) {
        const start = lines.findIndex((line) => /^\s*@startuml/i.test(line));
        lines.splice(start + 1, 0, ...inserted);
    }
    return lines.join(eol);
}

function applyMermaid(code, target) {
    let out = code;
    scanMermaid(code)
        .filter((entry) => target[entry.role])
        .sort((a, b) => b.start - a.start)
        .forEach((entry) => {
            out = out.slice(0, entry.start) + entry.build(target[entry.role]) + out.slice(entry.end);
        });
    return out;
}

function apply(code, mode, colors) {
    const target = {};
    ROLES.forEach((role) => {
        const hex = normalizeHex(colors && colors[role]);
        if (hex) target[role] = hex;
    });
    return mode === "mermaid" ? applyMermaid(code || "", target) : applyPlantuml(code || "", target);
}

module.exports = { read, apply };