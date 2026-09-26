/**
 * RelationshipAnalyzer — infers UML relationships between a set of already-parsed
 * classes (as produced by BaseLanguageProvider.parseClasses: name, parent,
 * interfaces, fields, methods, body).
 *
 * Inheritance and realization are structural (parent/interfaces) and always
 * exact. Composition, aggregation, and dependency are heuristics inferred from
 * how a field gets its value or how a method uses a type — static analysis
 * can't know true object lifetime, so these come with a `confidence` and are
 * meant to be reviewed/overridden, not treated as ground truth.
 *
 * Heuristic rules:
 *  - Composition (filled diamond): a field assigned `new Target(...)` anywhere
 *    in the class body (declaration-site initializer or inside a constructor).
 *    The owner creates the part, so the part can't outlive the owner.
 *  - Aggregation (hollow diamond): a field assigned from an identifier that is
 *    also a parameter of one of the class's own methods/constructors — the
 *    class received the reference rather than creating it.
 *  - A field that matches neither pattern still becomes an aggregation edge
 *    (the safer, weaker claim) but with confidence 'low', so it's visually
 *    distinguishable and easy to correct or drop.
 *  - Dependency (dashed arrow): a class named in a method's parameters or
 *    return type, when that pair isn't already linked by inheritance,
 *    realization, or a field relationship — "uses", not "owns".
 *  - Only classes present in the analyzed set are ever linked; a field or
 *    parameter typed as a JDK/stdlib/external type simply produces no edge,
 *    since there's nothing in the model to draw it to.
 */

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCollectionType(rawType) {
    if (!rawType) return false;
    return /\b(List|ArrayList|LinkedList|Set|HashSet|TreeSet|LinkedHashSet|Collection|Map|HashMap|TreeMap|LinkedHashMap|Vector|Queue|Deque|ArrayDeque|Stack|vector|array|Array)\b/.test(rawType)
        || /\[\s*\]/.test(rawType);
}

// Finds every known class name that appears as a whole word anywhere in a raw
// type string — deliberately simple rather than a full generic-type parser, so
// it uniformly handles `Animal`, `List<Animal>`, `Map<String, Animal>`,
// `Animal[]`, and C++'s `Animal*`/`Animal&` without special-casing each shape.
function findReferencedClasses(rawType, classNames) {
    if (!rawType) return [];
    const found = [];
    for (const name of classNames) {
        if (new RegExp(`\\b${escapeRegExp(name)}\\b`).test(rawType)) {
            found.push(name);
        }
    }
    return found;
}

function paramNamesOf(cls) {
    const names = new Set();
    (cls.methods || []).forEach(m => {
        const paramsStr = typeof m.params === 'string' ? m.params : '';
        paramsStr.split(',').forEach(p => {
            const trimmed = p.trim();
            if (!trimmed) return;
            // "String breed" -> "breed"; "const std::string& breed" -> "breed"
            const last = trimmed.split(/\s+/).pop().replace(/^[*&]+/, '').replace(/[^\w]/g, '');
            if (last) names.add(last);
        });
    });
    return names;
}

function classifyFieldOwnership(cls, field, targetClassName, ownParamNames) {
    const body = cls.body || '';
    const escName = escapeRegExp(field.name);
    const escTarget = escapeRegExp(targetClassName);

    if (isCollectionType(field.type)) {
        // Collection elements are typically added via a method call
        // (`wheels.add(new Wheel())`), not assigned directly to the field, so
        // the anchored check below wouldn't see them. Anywhere in the body is a
        // weaker but more useful signal for this shape.
        const newAnywherePattern = new RegExp(`\\bnew\\s+${escTarget}\\b`);
        if (newAnywherePattern.test(body)) {
            return { relation: 'composition', confidence: 'medium' };
        }
        return { relation: 'aggregation', confidence: 'low' };
    }

    const newAssignPattern = new RegExp(`(?:this\\s*\\.\\s*)?\\b${escName}\\s*=\\s*new\\s+${escTarget}\\b`);
    if (newAssignPattern.test(body)) {
        return { relation: 'composition', confidence: 'high' };
    }

    const assignRe = new RegExp(`(?:this\\s*\\.\\s*)?\\b${escName}\\s*=\\s*(\\w+)\\s*;`, 'g');
    let match;
    while ((match = assignRe.exec(body)) !== null) {
        const rhs = match[1];
        if (rhs === 'new') continue; // already handled above
        if (ownParamNames.has(rhs)) {
            return { relation: 'aggregation', confidence: 'high' };
        }
    }

    return { relation: 'aggregation', confidence: 'low' };
}

function collectDependencies(cls, classNames, alreadyLinked) {
    const deps = new Set();
    (cls.methods || []).forEach(m => {
        const paramsStr = typeof m.params === 'string' ? m.params : '';
        const returnStr = m.type || '';
        for (const name of classNames) {
            if (name === cls.name || alreadyLinked.has(name) || deps.has(name)) continue;
            const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
            if (re.test(paramsStr) || re.test(returnStr)) deps.add(name);
        }
    });
    return Array.from(deps);
}

class RelationshipAnalyzer {
    /**
     * @param {Array} classes - full-parsed classes (name, parent, interfaces,
     *   isInterface, fields, methods, body) from across the analyzed scope.
     * @returns {{classes: Array, relationships: Array}} relationships:
     *   {from, to, type, label?, multiplicity?, confidence?}
     *   type is one of: inheritance, realization, composition, aggregation, dependency
     */
    analyze(classes) {
        const classNames = classes.map(c => c.name);
        const classByName = new Map(classes.map(c => [c.name, c]));
        const relationships = [];
        const seen = new Set();

        const addEdge = (from, to, type, extra = {}) => {
            const key = `${from}|${to}|${type}|${extra.label || ''}`;
            if (seen.has(key)) return;
            seen.add(key);
            relationships.push({ from, to, type, ...extra });
        };

        for (const cls of classes) {
            const linkedTargets = new Set();

            if (cls.parent && classByName.has(cls.parent)) {
                addEdge(cls.name, cls.parent, 'inheritance');
                linkedTargets.add(cls.parent);
            }
            (cls.interfaces || []).forEach(iface => {
                if (classByName.has(iface)) {
                    addEdge(cls.name, iface, 'realization');
                    linkedTargets.add(iface);
                }
            });

            const ownParamNames = paramNamesOf(cls);

            (cls.fields || []).forEach(field => {
                const targets = findReferencedClasses(field.type, classNames);
                targets.forEach(target => {
                    if (target === cls.name && !isCollectionType(field.type)) {
                        // A field typed exactly as its own owning class with no
                        // collection wrapper would be infinitely-sized — almost
                        // certainly a same-named-but-unrelated type, not a real
                        // self-reference. A collection of self (a tree/list node's
                        // `children`/`next`) is legitimate and kept.
                        return;
                    }
                    const { relation, confidence } = classifyFieldOwnership(cls, field, target, ownParamNames);
                    addEdge(cls.name, target, relation, {
                        label: field.name,
                        multiplicity: isCollectionType(field.type) ? '*' : '1',
                        confidence
                    });
                    linkedTargets.add(target);
                });
            });

            collectDependencies(cls, classNames, linkedTargets).forEach(target => {
                addEdge(cls.name, target, 'dependency', { confidence: 'medium' });
            });
        }

        return { classes, relationships };
    }
}

module.exports = RelationshipAnalyzer;