/**
 * ProjectClassProvider (Mermaid) — renders the full {classes, relationships}
 * model produced by RelationshipAnalyzer as one Mermaid classDiagram, with
 * proper UML arrow types for each relationship kind. Unlike the single-file
 * ClassProvider, this has no "contextual bounding" windowing — every class
 * passed in is drawn, since the caller (extension.js) has already scoped the
 * input to whichever set (whole project / current package) the person chose.
 */

const VISIBILITY_SYMBOLS = { public: '+', private: '-', protected: '#', package: '~', internal: '~' };

function escapeMermaid(text) {
    // See providers/diagrams/mermaid/ClassProvider.js for why these specific
    // characters: ':' collides with mermaid's own member separator, '~' with
    // its generic-type delimiter, '&' isn't valid anywhere in its grammar.
    return String(text)
        .replace(/&/g, '')
        .replace(/[{}[\]<>~:]/g, '_');
}

function normalizeMembers(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(member => {
        if (typeof member === 'string') {
            return { name: member, type: '', params: '', visibility: '+', isStatic: false, isAbstract: false };
        }
        if (!member || !member.name) return null;
        const visibility = VISIBILITY_SYMBOLS[member.visibility] || member.visibility || '+';
        return {
            name: member.name,
            type: (member.type || member.returnType || '').trim(),
            params: formatParams(member.params !== undefined ? member.params : member.parameters),
            visibility: typeof visibility === 'string' && visibility.length === 1 ? visibility : '+',
            isStatic: !!member.isStatic,
            isAbstract: !!member.isAbstract
        };
    }).filter(Boolean);
}

function formatParams(params) {
    if (params === undefined || params === null) return '';
    if (typeof params === 'string') return params.replace(/\s+/g, ' ').trim();
    if (!Array.isArray(params)) return '';
    return params.map(param => {
        if (typeof param === 'string') return param.trim();
        if (!param || !param.name) return '';
        return param.type ? `${param.type} ${param.name}` : param.name;
    }).filter(Boolean).join(', ');
}

// UML arrow per relationship type. Direction convention throughout this file:
// `from` is the class that HAS the field / does the inheriting / declares the
// method; the arrow is drawn from `from` to `to` with the "owning" end (the
// diamond, or the triangle's point) landing correctly per UML convention.
const ARROW = {
    inheritance: '<|--',   // from extends to — triangle points at the parent (to)
    realization: '<|..',   // from implements to — dashed triangle at the interface (to)
    composition: '*--',    // from owns-and-creates to (filled diamond at from)
    aggregation: 'o--',    // from holds-a-reference-to to (hollow diamond at from)
    dependency: '..>'      // from uses to (dashed open arrow at to)
};

class ProjectClassProvider {
    generate(model, options = {}) {
        const { classes, relationships } = model;
        const { title = 'Project Diagram', showDependencies = true, minConfidence = null } = options;

        const lines = [];
        lines.push('classDiagram');
        lines.push('    direction LR');

        if (!classes || classes.length === 0) {
            lines.push('    class NoClassesFound');
            return { mermaidCode: lines.join('\n'), classCount: 0 };
        }

        const classByName = new Map(classes.map(c => [c.name, c]));

        classes.forEach(c => {
            if (!c.name || !c.name.trim()) return;
            const escapedName = escapeMermaid(c.name);

            if (c.isEnum) {
                lines.push(`    class ${escapedName} {`);
                lines.push('        <<enumeration>>');
                lines.push('    }');
            } else if (c.isInterface) {
                lines.push(`    class ${escapedName} {`);
                lines.push('        <<interface>>');
                lines.push('    }');
            } else if (c.isAbstract) {
                lines.push(`    class ${escapedName} {`);
                lines.push('        <<abstract>>');
                lines.push('    }');
            } else {
                lines.push(`    class ${escapedName}`);
            }

            const fields = normalizeMembers(c.fields);
            const methods = normalizeMembers(c.methods);
            fields.forEach(f => {
                const type = f.type ? `${escapeMermaid(f.type)} ` : '';
                const marker = f.isStatic ? '$' : '';
                lines.push(`    ${escapedName} : ${f.visibility}${type}${escapeMermaid(f.name)}${marker}`);
            });
            methods.forEach(m => {
                const type = m.type ? ` ${escapeMermaid(m.type)}` : '';
                const marker = m.isStatic ? '$' : (m.isAbstract ? '*' : '');
                lines.push(`    ${escapedName} : ${m.visibility}${escapeMermaid(m.name)}(${escapeMermaid(m.params)})${type}${marker}`);
            });
        });

        const renderedEdges = new Set();
        relationships.forEach(rel => {
            if (rel.type === 'dependency' && !showDependencies) return;
            if (minConfidence === 'high' && rel.confidence && rel.confidence !== 'high') return;
            if (!classByName.has(rel.from) || !classByName.has(rel.to)) return;

            const arrow = ARROW[rel.type];
            if (!arrow) return;
            const from = escapeMermaid(rel.from);
            const to = escapeMermaid(rel.to);
            const edgeKey = `${from}${arrow}${to}:${rel.label || ''}`;
            if (renderedEdges.has(edgeKey)) return;
            renderedEdges.add(edgeKey);

            let edge = `    ${from} ${arrow} ${to}`;
            const labelParts = [];
            if (rel.label) labelParts.push(rel.label);
            if (rel.multiplicity === '*') labelParts.push('*');
            if (rel.confidence === 'low') labelParts.push('?');
            if (labelParts.length > 0) edge += ` : ${labelParts.join(' ')}`;
            lines.push(edge);
        });

        return { mermaidCode: lines.join('\n'), classCount: classes.length };
    }
}

module.exports = ProjectClassProvider;