/**
 * ProjectClassProvider (PlantUML) — PlantUML counterpart to the Mermaid
 * version in providers/diagrams/mermaid/ProjectClassProvider.js. Renders the
 * full {classes, relationships} model from RelationshipAnalyzer with proper
 * UML arrow types; no per-class windowing, since the caller has already
 * scoped the input (whole project / current package).
 */

const VISIBILITY_SYMBOLS = { public: "+", private: "-", protected: "#", package: "~", internal: "~" };

// Named presets share keys across both renderers (see the Mermaid provider's
// own THEMES) so the webview can offer one theme dropdown that means the same
// thing regardless of which renderer is currently active.
const THEMES = {
    ocean: { background: "#FEFEFE", canvas: "#FEFEFE", accent: "#2980b9", text: "#1a1a1a" },
    forest: { background: "#F3FAF3", canvas: "#F3FAF3", accent: "#27ae60", text: "#1a1a1a" },
    sunset: { background: "#FFF3E8", canvas: "#FFF3E8", accent: "#ff5722", text: "#3d1f00" },
    monochrome: { background: "#FAFAFA", canvas: "#FAFAFA", accent: "#555555", text: "#222222" },
    dark: { background: "#1e1e1e", canvas: "#1e1e1e", accent: "#569cd6", text: "#d4d4d4" },
    contrast: { background: "#1e1e1e", canvas: "#1e1e1e", accent: "#00d4ff", text: "#ffffff" }
};

function resolveColors(options) {
    if (options.customColors) {
        const { background, canvas, accent, text } = options.customColors;
        return {
            background: background || THEMES.ocean.background,
            // Falls back to background (not canvas alone) so older saved custom
            // color sets that predate the canvas swatch keep their old look.
            canvas: canvas || background || THEMES.ocean.canvas,
            accent: accent || THEMES.ocean.accent,
            text: text || THEMES.ocean.text
        };
    }
    return THEMES[options.theme] || THEMES.ocean;
}

function normalizeMembers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((member) => {
            if (typeof member === "string") {
                return { name: member, type: "", params: "", visibility: "+", isStatic: false, isAbstract: false };
            }
            if (!member || !member.name) return null;
            const visibility = VISIBILITY_SYMBOLS[member.visibility] || member.visibility || "+";
            return {
                name: member.name,
                type: (member.type || member.returnType || "").trim(),
                params: formatParams(member.params !== undefined ? member.params : member.parameters),
                visibility: typeof visibility === "string" && visibility.length === 1 ? visibility : "+",
                isStatic: !!member.isStatic,
                isAbstract: !!member.isAbstract
            };
        })
        .filter(Boolean);
}

function formatParams(params) {
    if (params === undefined || params === null) return "";
    if (typeof params === "string") return params.replace(/\s+/g, " ").trim();
    if (!Array.isArray(params)) return "";
    return params
        .map((param) => {
            if (typeof param === "string") return param.trim();
            if (!param || !param.name) return "";
            return param.type ? `${param.type} ${param.name}` : param.name;
        })
        .filter(Boolean)
        .join(", ");
}

function decorate(member) {
    let prefix = "";
    if (member.isStatic) prefix += "{static} ";
    if (member.isAbstract) prefix += "{abstract} ";
    return prefix;
}

// Same direction convention as the Mermaid version: `from` HAS the field / does
// the inheriting; PlantUML draws the diamond/triangle at whichever end the
// arrow syntax puts it, so these read "from OWNS/EXTENDS/USES to".
const ARROW = {
    inheritance: "--|>",
    realization: "..|>",
    composition: "*--",
    aggregation: "o--",
    dependency: "..>"
};

// A tiny seedable PRNG (mulberry32) rather than Math.random(), so a given
// shuffleSeed always produces the same reordering — useful for reproducing
// and debugging a specific attempt if needed.
function seededShuffle(array, seed) {
    if (!seed) return array.slice();
    let s = seed >>> 0;
    const rand = () => {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const arr = array.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

class ProjectClassProvider {
    generate(model, options = {}) {
        // Smetana's edge-crossing-minimization has a known, order-sensitive bug
        // (see extension.js's retry loop in regenerate()) — the same set of
        // classes and relationships can crash it or not depending purely on the
        // order they're declared in. shuffleSeed lets the caller retry the exact
        // same diagram with a different internal ordering, which is a real
        // second (or third) chance at avoiding the bug, not just a cosmetic
        // change — the diagram's content is identical either way, only Smetana's
        // internal processing order differs.
        let { classes, relationships } = model;
        if (options.shuffleSeed) {
            classes = seededShuffle(classes, options.shuffleSeed);
            relationships = seededShuffle(relationships, options.shuffleSeed + 1);
        }
        const { showDependencies = true, minConfidence = null } = options;
        const colors = resolveColors(options);

        const uml = [];
        uml.push("@startuml");
        // Graphviz (PlantUML's default engine) is what actually renders here
        // unless explicitly told to use Smetana. Graphviz is mature and doesn't
        // have Smetana's order-dependent crossing-minimization bug — and since
        // PlantUML 1.2020.21+ it self-extracts a bundled minimal Graphviz
        // distribution when none is found on the system, so this needs no setup
        // in the common case. Smetana is a deliberate, explicit fallback for
        // when Graphviz genuinely isn't available (see extension.js's retry
        // loop in regenerate()), not the default.
        if (options.engine === "smetana") {
            uml.push("!pragma layout smetana");
        }
        uml.push("left to right direction");
        // skinparam class{}'s FontColor only covers the class name/header —
        // attributes and methods have their own separate setting
        // (AttributeFontColor), which is why they stayed black in dark/high-
        // contrast themes even after the class name and page background were
        // already fixed. defaultFontColor is added as a global catch-all for
        // anything else (notes, stereotype text) not covered by the more
        // specific settings below.
        // backgroundColor is the page/canvas fill (the empty space around and
        // between boxes); the class block below's BackgroundColor is the box
        // fill specifically — previously both used the same value, so the
        // canvas custom-color swatch had no visible effect in PlantUML mode.
        uml.push(`skinparam backgroundColor ${colors.canvas}`);
        uml.push(`skinparam defaultFontColor ${colors.text}`);
        uml.push(`skinparam ArrowFontColor ${colors.text}`);
        uml.push("skinparam class {");
        uml.push(`  BackgroundColor ${colors.background}`);
        uml.push(`  ArrowColor ${colors.accent}`);
        uml.push(`  BorderColor ${colors.accent}`);
        uml.push(`  FontColor ${colors.text}`);
        uml.push(`  AttributeFontColor ${colors.text}`);
        uml.push(`  StereotypeFontColor ${colors.text}`);
        uml.push("  FontStyle bold");
        uml.push("}");
        uml.push("skinparam shadowing false");
        uml.push("skinparam ranksep 40");
        uml.push("skinparam nodesep 20");

        if (!classes || classes.length === 0) {
            uml.push('class "No classes found" as NA');
            uml.push("@enduml");
            return { uml: uml.join("\n"), classCount: 0 };
        }

        const classByName = new Map(classes.map((c) => [c.name, c]));

        classes.forEach((c) => {
            if (!c.name || !c.name.trim()) return;
            // PlantUML auto-shows a circled letter (C/I/E/A) based on this
            // keyword — class/interface/enum/abstract class.
            const type =
                c.isEnum ? "enum"
                : c.isInterface ? "interface"
                : c.isAbstract ? "abstract class"
                : "class";
            uml.push(`${type} ${c.name} [[command:extension.openClass?${c.name}]] {`);

            const fields = normalizeMembers(c.fields);
            const methods = normalizeMembers(c.methods);
            fields.forEach((f) => {
                uml.push(`  ${f.visibility}${decorate(f)}${f.name}${f.type ? ` : ${f.type}` : ""}`);
            });
            if (fields.length > 0 && methods.length > 0) uml.push("  --");
            methods.forEach((m) => {
                uml.push(`  ${m.visibility}${decorate(m)}${m.name}(${m.params})${m.type ? ` : ${m.type}` : ""}`);
            });
            uml.push("}");
        });

        const renderedEdges = new Set();
        relationships.forEach((rel) => {
            if (rel.type === "dependency" && !showDependencies) return;
            if (minConfidence === "high" && rel.confidence && rel.confidence !== "high") return;
            if (!classByName.has(rel.from) || !classByName.has(rel.to)) return;

            const arrow = ARROW[rel.type];
            if (!arrow) return;
            const edgeKey = `${rel.from}${arrow}${rel.to}:${rel.label || ""}`;
            if (renderedEdges.has(edgeKey)) return;
            renderedEdges.add(edgeKey);

            let edge = `${rel.from} ${arrow} `;
            if (rel.multiplicity === "*") edge += '"*" ';
            edge += rel.to;
            const labelParts = [];
            if (rel.label) labelParts.push(rel.label);
            if (rel.confidence === "low") labelParts.push("≈");
            if (labelParts.length > 0) edge += ` : ${labelParts.join(" ")}`;
            uml.push(edge);
        });

        uml.push("@enduml");
        return { uml: uml.join("\n"), classCount: classes.length };
    }
}

module.exports = ProjectClassProvider;
