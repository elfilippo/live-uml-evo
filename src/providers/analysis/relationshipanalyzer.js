/**
 * RelationshipAnalyzer — infers UML relationships between a set of already-parsed
 * classes (as produced by BaseLanguageProvider.parseClasses: name, parent,
 * interfaces, fields, methods, body).
 *
 * Inheritance and realization are structural (parent/interfaces) and always
 * exact. Field relationships follow a fixed ownership rule based on how the
 * class assigns the field, so the same source always yields the same edge.
 * Dependency edges are a heuristic scan for a type's name and carry a
 * `confidence`.
 *
 * Ownership rules, in order:
 *  - Aggregation (hollow diamond): some assignment stores a parameter of one
 *    of the class's own methods/constructors — directly, through
 *    `Objects.requireNonNull`, `copyOf`, `Collections.unmodifiable*` or a
 *    collection copy constructor, or, for collection fields, via
 *    `field.add(param)` / `field.put(key, param)`. The class received the
 *    reference rather than creating it.
 *  - Composition (filled diamond): otherwise, some assignment creates the
 *    target with `new Target(...)` — for collection fields, an assignment or
 *    a `field.add(new Target(...))`. The owner creates the part.
 *  - Association (plain arrow): the field references the target and the
 *    class body settles neither of the above; nothing more is claimed.
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
        || /\[[^\]]*\]/.test(rawType);
}

function baseName(rawName) {
    return String(rawName).split(/::|\./).pop().trim();
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

function typeArgsFor(cls, rawName) {
    const args = cls.supertypeArgs && cls.supertypeArgs[rawName];
    return args ? { typeArgs: args } : {};
}

function paramNamesOf(cls) {
    const names = new Set();
    (cls.methods || []).forEach(m => {
        const paramsStr = typeof m.params === 'string' ? m.params : '';
        splitTopLevel(paramsStr, ',').forEach(p => {
            const trimmed = p.replace(/=(?!>)[\s\S]*$/, '').trim();
            if (!trimmed) return;
            const typed = /^(?:\.\.\.)?(\w+)\??\s*:(?!:)/.exec(trimmed);
            if (typed) {
                names.add(typed[1]);
                return;
            }
            // "String breed" -> "breed"; "const std::string& breed" -> "breed"
            const last = trimmed.split(/\s+/).pop().replace(/^[*&]+/, '').replace(/[^\w]/g, '');
            if (last) names.add(last);
        });
    });
    return names;
}

const SUPPLIED_WRAPPER = /^(?:(?:\w+\.)*Objects\s*\.\s*requireNonNull|(?:\w+\.)*(?:List|Set|Map)\s*\.\s*copyOf|(?:\w+\.)*Collections\s*\.\s*unmodifiable\w+|new\s+(?:\w+\.)*(?:ArrayList|LinkedList|ArrayDeque|Vector|HashSet|LinkedHashSet|TreeSet|HashMap|LinkedHashMap|TreeMap))\s*\(\s*(\w+)\s*(?:,[^)]*)?\)$/;

const COLLECTION_ADDERS = 'add|addFirst|addLast|offer|offerFirst|offerLast|push|put|putIfAbsent';

function stripGenerics(text) {
    let current = text;
    let previous;
    do {
        previous = current;
        current = current.replace(/<[^<>]*>/g, '');
    } while (current !== previous);
    return current;
}

function lastArgument(text) {
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') depth--;
        else if (ch === ',' && depth === 0) start = i + 1;
    }
    return text.slice(start).trim();
}

function assignedExpressions(body, fieldName, isCollection) {
    const name = escapeRegExp(fieldName);
    const expressions = [];
    const assignRe = new RegExp(`\\b${name}\\s*=(?!=)\\s*([^;]*);`, 'g');
    let match;
    while ((match = assignRe.exec(body)) !== null) {
        expressions.push(stripGenerics(match[1]).trim());
    }
    if (isCollection) {
        const addRe = new RegExp(`\\b${name}\\s*\\.\\s*(?:${COLLECTION_ADDERS})\\s*\\(([^;]*)\\)\\s*;`, 'g');
        while ((match = addRe.exec(body)) !== null) {
            expressions.push(lastArgument(stripGenerics(match[1])));
        }
    }
    return expressions;
}

function suppliedIdentifier(expression) {
    const wrapped = SUPPLIED_WRAPPER.exec(expression);
    if (wrapped) return wrapped[1];
    return /^\w+$/.test(expression) ? expression : null;
}

function classifyFieldOwnership(cls, field, targetClassName, ownParamNames) {
    const expressions = assignedExpressions(cls.body || '', field.name, isCollectionType(field.type));
    if (expressions.some(expression => ownParamNames.has(suppliedIdentifier(expression)))) {
        return 'aggregation';
    }
    const creates = new RegExp(`\\bnew\\s+${escapeRegExp(targetClassName)}\\b`);
    if (expressions.some(expression => creates.test(expression))) return 'composition';
    return 'association';
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
     *   type is one of: inheritance, realization, composition, aggregation, association, dependency
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

            const parentName = cls.parent ? baseName(cls.parent) : null;
            if (parentName && classByName.has(parentName)) {
                addEdge(cls.name, parentName, 'inheritance', typeArgsFor(cls, cls.parent));
                linkedTargets.add(parentName);
            }
            (cls.extraParents || []).forEach(rawParent => {
                const base = baseName(rawParent);
                if (classByName.has(base)) {
                    addEdge(cls.name, base, 'inheritance', typeArgsFor(cls, rawParent));
                    linkedTargets.add(base);
                }
            });
            (cls.interfaces || []).forEach(rawIface => {
                const base = baseName(rawIface);
                if (classByName.has(base)) {
                    addEdge(cls.name, base, 'realization', typeArgsFor(cls, rawIface));
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
                    const relation = classifyFieldOwnership(cls, field, target, ownParamNames);
                    addEdge(cls.name, target, relation, {
                        label: field.name,
                        multiplicity: isCollectionType(field.type) ? '*' : '1'
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
            loser.confidence = 'medium';
            delete loser.multiplicity;
        }

        return { classes, relationships };
    }
}

module.exports = RelationshipAnalyzer;