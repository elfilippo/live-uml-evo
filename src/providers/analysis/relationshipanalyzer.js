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
 *  - Dependency (dashed arrow): a class named anywhere in a method's
 *    parameters, return type, or body (a static call, a local variable, a
 *    cast, etc.), when that pair isn't already linked by inheritance,
 *    realization, or a field relationship — "uses", not "owns".
 *  - Realization resolves against the interface name with any package prefix
 *    dropped. The provider strips generic arguments from `parent` and
 *    `interfaces`, so a known class named only inside a generic argument
 *    (`implements Comparable<Car>`) is picked up by the body dependency scan.
 *  - A class's or interface's own generic bounds (`class Fleet<T extends
 *    Vehicle & Serializable>`) produce an inheritance-like edge to each bound
 *    type — explicit in source, not a heuristic.
 *  - An enum-typed field produces no ownership edge (it's already visible in
 *    the attribute list); a field bidirectionally mirrored by another class's
 *    field only keeps its ownership diamond on the stronger (composition >
 *    aggregation) side — the weaker direction is downgraded to a dependency.
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

// A class's use of another type isn't limited to fields and method
// signatures — a static call (`Logger.log(...)`) or a purely local variable
// (`Logger log = new Logger();`) never touches a field or a parameter, but
// it's still a real "uses" relationship. Scanning the whole class body is
// the simplest way to catch these too; anything already linked via
// inheritance/realization/a field is excluded so it isn't duplicated here.
function collectDependencies(cls, classNames, alreadyLinked) {
    const deps = new Set();
    const body = cls.body || '';
    for (const name of classNames) {
        if (name === cls.name || alreadyLinked.has(name)) continue;
        const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
        if (re.test(body)) deps.add(name);
    }
    return Array.from(deps);
}

function readTypeParameters(body, name) {
    const declMatch = new RegExp(`\\b(?:class|interface)\\s+${escapeRegExp(name)}\\s*<`).exec(body);
    if (!declMatch) return null;
    const start = declMatch.index + declMatch[0].length;
    let depth = 1;
    for (let i = start; i < body.length; i++) {
        if (body[i] === '<') depth++;
        else if (body[i] === '>' && --depth === 0) return body.slice(start, i);
    }
    return null;
}

function splitTopLevel(text, separator) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
        if (ch === '<') depth++;
        else if (ch === '>') depth--;
        if (ch === separator && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts;
}

// A class's or interface's own declaration can bound its type parameters to
// known classes (`class Fleet<T extends Vehicle & Serializable>`) — an
// explicit, exact relationship in source, not a heuristic one, so it's
// treated like inheritance. Only the bound's own name counts here; a class
// named inside a bound's generic argument (`T extends Comparable<Vehicle>`)
// is left to the body dependency scan.
function extractGenericBoundTargets(cls, classNames) {
    const typeParams = readTypeParameters(cls.body || '', cls.name);
    if (!typeParams) return [];
    const bounds = new Set();
    splitTopLevel(typeParams, ',').forEach(param => {
        const extendsAt = param.search(/\bextends\b/);
        if (extendsAt < 0) return;
        splitTopLevel(param.slice(extendsAt + 'extends'.length), '&').forEach(part => {
            const base = part.replace(/<[\s\S]*$/, '').trim().split('.').pop();
            if (base && base !== cls.name && classNames.includes(base)) bounds.add(base);
        });
    });
    return Array.from(bounds);
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

            const parentName = cls.parent ? cls.parent.split('.').pop() : null;
            if (parentName && classByName.has(parentName)) {
                addEdge(cls.name, parentName, 'inheritance');
                linkedTargets.add(parentName);
            }
            (cls.extraParents || []).forEach(rawParent => {
                const base = String(rawParent).split('.').pop().trim();
                if (classByName.has(base)) {
                    addEdge(cls.name, base, 'inheritance');
                    linkedTargets.add(base);
                }
            });
            (cls.interfaces || []).forEach(rawIface => {
                const base = String(rawIface).split('.').pop().trim();
                if (classByName.has(base)) {
                    addEdge(cls.name, base, 'realization');
                    linkedTargets.add(base);
                }
            });

            extractGenericBoundTargets(cls, classNames).forEach(target => {
                addEdge(cls.name, target, 'inheritance', { confidence: 'medium' });
                linkedTargets.add(target);
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
                    const targetCls = classByName.get(target);
                    if (targetCls && (targetCls.isEnum || targetCls.kind === 'enum')) {
                        // Enum values aren't independently-owned sub-objects, and
                        // they're already visible in the attribute list — no
                        // ownership edge for it.
                        linkedTargets.add(target);
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

        // Two classes that each hold a field referencing the other (Garage
        // has a List<Car>, Car has a back-reference `garage`) end up with an
        // ownership diamond in both directions. Only the real owner (ranked
        // composition > aggregation) keeps its diamond; the reverse edge is
        // downgraded to a dependency — the class still uses the type, it
        // just doesn't own it.
        const ownershipRank = { composition: 2, aggregation: 1 };
        for (const rel of relationships) {
            if (!(rel.type in ownershipRank)) continue;
            const reverse = relationships.find(r => r !== rel
                && r.from === rel.to && r.to === rel.from
                && r.type in ownershipRank);
            if (!reverse) continue;
            let loser;
            if (ownershipRank[rel.type] !== ownershipRank[reverse.type]) {
                loser = ownershipRank[rel.type] > ownershipRank[reverse.type] ? reverse : rel;
            } else if (rel.multiplicity === '*' && reverse.multiplicity !== '*') {
                loser = reverse;
            } else if (reverse.multiplicity === '*' && rel.multiplicity !== '*') {
                loser = rel;
            } else {
                loser = reverse;
            }
            loser.type = 'dependency';
            loser.confidence = 'low';
            delete loser.multiplicity;
        }

        return { classes, relationships };
    }
}

module.exports = RelationshipAnalyzer;
