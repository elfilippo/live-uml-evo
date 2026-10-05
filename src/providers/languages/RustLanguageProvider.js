const BaseLanguageProvider = require('./BaseLanguageProvider');

const QUALIFIERS = /(?:pub(?:\s*\([^)]*\))?\s+|(?:unsafe|async|default|auto)\s+|const\s+(?=(?:unsafe|async|extern|fn)\b)|extern\s*(?:"[^"]*"\s*)?(?=(?:fn|unsafe|trait)\b))*/y;
const KEYWORD = /(struct|enum|union|trait|impl|mod|fn|type|const|static|use|extern|macro_rules|macro)\b/y;
const NAME = /\s*([A-Za-z_]\w*)/y;
const CONST_NAME = /\s*([A-Za-z_]\w*)\s*:/y;
const RECEIVER = /^(?:&\s*(?:'\w+\s+)?(?:mut\s+)?|mut\s+)?self\b/;
const REFERENCE_PREFIX = /^(?:&\s*(?:'\w+\s+)?(?:mut\s+)?|\*\s*(?:const|mut)\s+|dyn\s+)+/;
const STD_PREFIX = /^(?:::)?(?:std|core|alloc)::/;

function squash(text) {
    return String(text).replace(/\s+/g, ' ').trim();
}

function skipSpace(text, index, limit) {
    let i = index;
    while (i < limit && /\s/.test(text[i])) i++;
    return i;
}

function blank(source, blankLiterals) {
    const length = source.length;
    const parts = [];
    const fill = (from, to) => source.slice(from, to).replace(/[^\n]/g, ' ');
    let copied = 0;
    let i = 0;

    const replace = (end, text) => {
        parts.push(source.slice(copied, i), text);
        copied = end;
        i = end;
    };

    while (i < length) {
        const ch = source[i];
        const next = source[i + 1];

        if (ch === '/' && next === '/') {
            let end = source.indexOf('\n', i);
            if (end < 0) end = length;
            replace(end, fill(i, end));
        } else if (ch === '/' && next === '*') {
            let depth = 1;
            let j = i + 2;
            while (j < length && depth > 0) {
                if (source[j] === '/' && source[j + 1] === '*') { depth++; j += 2; }
                else if (source[j] === '*' && source[j + 1] === '/') { depth--; j += 2; }
                else j++;
            }
            replace(j, fill(i, j));
        } else if (ch === "'") {
            const end = charLiteralEnd(source, i);
            if (end < 0) i++;
            else if (blankLiterals) replace(end, `'${fill(i + 1, end - 1)}'`);
            else i = end;
        } else {
            const literal = stringAt(source, i);
            if (literal) {
                if (blankLiterals) replace(literal.end, source.slice(i, literal.open + 1) + fill(literal.open + 1, literal.close) + source.slice(literal.close, literal.end));
                else i = literal.end;
            } else {
                i++;
            }
        }
    }
    parts.push(source.slice(copied));
    return parts.join('');
}

function charLiteralEnd(source, i) {
    const first = source[i + 1];
    if (first === undefined || first === '\n') return -1;
    if (first === '\\') {
        const close = source.indexOf("'", i + 3);
        return close < 0 || source.slice(i, close).includes('\n') ? -1 : close + 1;
    }
    const width = source.codePointAt(i + 1) > 0xffff ? 2 : 1;
    return source[i + 1 + width] === "'" ? i + 2 + width : -1;
}

function stringAt(source, i) {
    const ch = source[i];
    if (ch !== '"' && ch !== 'r' && ch !== 'b') return null;
    if (ch !== '"' && i > 0 && /\w/.test(source[i - 1])) return null;
    let j = i;
    if (source[j] === 'b') j++;
    let hashes = 0;
    let raw = false;
    if (source[j] === 'r') {
        raw = true;
        j++;
        while (source[j] === '#') { hashes++; j++; }
    }
    if (source[j] !== '"') return null;
    const open = j;
    if (raw) {
        const closer = '"' + '#'.repeat(hashes);
        const at = source.indexOf(closer, open + 1);
        if (at < 0) return { open, close: source.length, end: source.length };
        return { open, close: at, end: at + closer.length };
    }
    for (let k = open + 1; k < source.length; k++) {
        if (source[k] === '\\') k++;
        else if (source[k] === '"') return { open, close: k, end: k + 1 };
    }
    return { open, close: source.length, end: source.length };
}

function matchBracket(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function matchAngle(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const ch = text[i];
        if (ch === '<') depth++;
        else if (ch === '>' && text[i - 1] !== '-' && text[i - 1] !== '=') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

function opensGroup(ch) {
    return ch === '(' || ch === '[' || ch === '{' || ch === '<';
}

function closesGroup(text, i) {
    const ch = text[i];
    return ch === ')' || ch === ']' || ch === '}' || (ch === '>' && text[i - 1] !== '-' && text[i - 1] !== '=');
}

function splitTop(text, separator) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (opensGroup(ch)) depth++;
        else if (closesGroup(text, i)) depth--;
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

function findTopLevel(text, pattern) {
    const re = new RegExp(pattern.source, 'y');
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (opensGroup(ch)) depth++;
        else if (closesGroup(text, i)) depth--;
        else if (depth === 0) {
            re.lastIndex = i;
            const match = re.exec(text);
            if (match) return { index: i, length: match[0].length };
        }
    }
    return null;
}

function findTerminator(text, from, limit) {
    let depth = 0;
    for (let i = from; i < limit; i++) {
        const ch = text[i];
        if (ch === '(' || ch === '[') depth++;
        else if (ch === ')' || ch === ']') depth--;
        else if (depth <= 0 && (ch === '{' || ch === ';')) return i;
    }
    return -1;
}

function visibilityOf(qualifiers) {
    const match = /\bpub\b\s*(\([^)]*\))?/.exec(qualifiers);
    if (!match) return null;
    if (!match[1]) return '+';
    return /^\(\s*self\s*\)$/.test(match[1]) ? '-' : '~';
}

function stripAttributes(entry) {
    let current = entry.trim();
    while (current.startsWith('#')) {
        const open = current.indexOf('[');
        if (open < 0) break;
        const close = matchBracket(current, open);
        if (close < 0) break;
        current = current.slice(close + 1).trim();
    }
    return current;
}

function cleanArguments(angled) {
    if (!angled) return '';
    const parts = splitTop(angled.slice(1, -1), ',').map(squash).filter(part => part && !part.startsWith("'"));
    return parts.length > 0 ? `<${parts.join(', ')}>` : '';
}

function typeParameterName(param) {
    if (param.startsWith("'")) return '';
    return (/^const\s+(\w+)/.exec(param) || /^(\w+)/.exec(param) || [])[1] || '';
}

class RustScanner {
    constructor(text) {
        this.text = text;
        this.lineStarts = [0];
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '\n') this.lineStarts.push(i + 1);
        }
    }

    lineOf(position) {
        let low = 0;
        let high = this.lineStarts.length - 1;
        while (low < high) {
            const mid = (low + high + 1) >> 1;
            if (this.lineStarts[mid] <= position) low = mid;
            else high = mid - 1;
        }
        return low;
    }

    scan() {
        const items = [];
        this.region(0, this.text.length, '', items);
        return items;
    }

    readName(index) {
        NAME.lastIndex = index;
        const match = NAME.exec(this.text);
        return match ? { name: match[1], end: index + match[0].length } : null;
    }

    skipAttributes(index, limit) {
        const text = this.text;
        let i = index;
        let testOnly = false;
        while (text[i] === '#') {
            const j = skipSpace(text, i + (text[i + 1] === '!' ? 2 : 1), limit);
            if (text[j] !== '[') break;
            const close = matchBracket(text, j);
            if (close < 0) return { index: limit, testOnly };
            if (/^\[\s*cfg\s*\(\s*test\s*\)\s*\]$/.test(text.slice(j, close + 1))) testOnly = true;
            i = skipSpace(text, close + 1, limit);
        }
        return { index: i, testOnly };
    }

    skipItem(index, limit) {
        const text = this.text;
        let depth = 0;
        for (let i = index; i < limit; i++) {
            const ch = text[i];
            if (ch === '(' || ch === '[') depth++;
            else if (ch === ')' || ch === ']') depth--;
            else if (depth <= 0 && ch === ';') return i + 1;
            else if (depth <= 0 && ch === '{') {
                const close = matchBracket(text, i);
                if (close < 0) return limit;
                const after = skipSpace(text, close + 1, limit);
                return text[after] === ';' ? after + 1 : close + 1;
            }
        }
        return limit;
    }

    region(from, limit, modPath, items) {
        const text = this.text;
        let i = from;
        for (;;) {
            i = skipSpace(text, i, limit);
            if (i >= limit) return;
            const attributes = this.skipAttributes(i, limit);
            i = attributes.index;
            if (i >= limit) return;
            const sink = attributes.testOnly ? [] : items;
            const start = i;
            QUALIFIERS.lastIndex = i;
            const qualifiers = QUALIFIERS.exec(text)[0];
            const afterQualifiers = i + qualifiers.length;
            KEYWORD.lastIndex = afterQualifiers;
            const keyword = KEYWORD.exec(text);
            let end;
            if (!keyword) {
                end = this.skipItem(afterQualifiers, limit);
            } else {
                const after = afterQualifiers + keyword[0].length;
                switch (keyword[1]) {
                    case 'mod':
                        end = this.module(after, limit, modPath, sink);
                        break;
                    case 'struct':
                    case 'union':
                    case 'enum':
                    case 'trait':
                        end = this.declaration(keyword[1], after, limit, start, qualifiers, modPath, sink);
                        break;
                    case 'impl':
                        end = this.implementation(after, limit, start, modPath, sink);
                        break;
                    case 'fn': {
                        const fn = this.fn(after, limit, start, qualifiers);
                        if (fn) sink.push({ kind: 'fn', modPath, ...fn });
                        end = fn ? fn.end : this.skipItem(after, limit);
                        break;
                    }
                    default:
                        end = this.skipItem(after, limit);
                }
            }
            i = end > i ? end : i + 1;
        }
    }

    module(index, limit, modPath, sink) {
        const text = this.text;
        const named = this.readName(index);
        if (!named) return this.skipItem(index, limit);
        const open = skipSpace(text, named.end, limit);
        if (text[open] !== '{') return this.skipItem(open, limit);
        const close = matchBracket(text, open);
        if (close < 0) return limit;
        this.region(open + 1, close, modPath ? `${modPath}::${named.name}` : named.name, sink);
        return close + 1;
    }

    declaration(kind, index, limit, start, qualifiers, modPath, sink) {
        const text = this.text;
        const named = this.readName(index);
        if (!named) return this.skipItem(index, limit);

        let after = named.end;
        let generics = '';
        const angle = skipSpace(text, after, limit);
        if (text[angle] === '<') {
            const close = matchAngle(text, angle);
            if (close < 0) return this.skipItem(index, limit);
            generics = text.slice(angle + 1, close);
            after = close + 1;
        }

        const item = {
            kind,
            name: named.name,
            modPath,
            visibility: visibilityOf(qualifiers) || '-',
            generics,
            where: '',
            bounds: '',
            body: '',
            tuple: false,
            members: [],
            startLine: this.lineOf(start),
            endLine: 0,
            text: ''
        };

        const first = skipSpace(text, after, limit);
        let end;
        if ((kind === 'struct' || kind === 'union') && text[first] === '(') {
            const close = matchBracket(text, first);
            if (close < 0) return this.skipItem(index, limit);
            const semicolon = findTerminator(text, close + 1, limit);
            if (semicolon < 0 || text[semicolon] !== ';') return this.skipItem(index, limit);
            item.tuple = true;
            item.body = text.slice(first + 1, close);
            item.where = this.whereClause(text.slice(close + 1, semicolon)).where;
            end = semicolon + 1;
        } else {
            const terminator = findTerminator(text, first, limit);
            if (terminator < 0) return limit;
            const header = this.whereClause(text.slice(first, terminator));
            item.where = header.where;
            if (kind === 'trait') item.bounds = header.main.replace(/^\s*:/, '');
            if (text[terminator] === '{') {
                const close = matchBracket(text, terminator);
                if (close < 0) return limit;
                item.body = text.slice(terminator + 1, close);
                if (kind === 'trait') item.members = this.members(terminator + 1, close);
                end = close + 1;
            } else {
                end = terminator + 1;
            }
        }

        item.endLine = this.lineOf(end - 1);
        item.text = text.slice(start, end);
        sink.push(item);
        return end;
    }

    whereClause(header) {
        const at = findTopLevel(header, /\bwhere\b/);
        if (!at) return { main: header, where: '' };
        return { main: header.slice(0, at.index), where: header.slice(at.index + at.length) };
    }

    implementation(index, limit, start, modPath, sink) {
        const text = this.text;
        let after = skipSpace(text, index, limit);
        let generics = '';
        if (text[after] === '<') {
            const close = matchAngle(text, after);
            if (close < 0) return this.skipItem(index, limit);
            generics = text.slice(after + 1, close);
            after = close + 1;
        }
        const terminator = findTerminator(text, after, limit);
        if (terminator < 0 || text[terminator] !== '{') return this.skipItem(index, limit);
        const close = matchBracket(text, terminator);
        if (close < 0) return limit;

        const header = this.whereClause(text.slice(after, terminator));
        const forAt = findTopLevel(header.main, /\bfor\b(?!\s*<)/);
        sink.push({
            kind: 'impl',
            modPath,
            generics,
            traitText: forAt ? squash(header.main.slice(0, forAt.index)) : '',
            typeText: squash(forAt ? header.main.slice(forAt.index + forAt.length) : header.main),
            members: this.members(terminator + 1, close),
            startLine: this.lineOf(start),
            endLine: this.lineOf(close),
            text: text.slice(start, close + 1)
        });
        return close + 1;
    }

    fn(index, limit, start, qualifiers) {
        const text = this.text;
        const named = this.readName(index);
        if (!named) return null;
        let after = named.end;
        const angle = skipSpace(text, after, limit);
        if (text[angle] === '<') {
            const close = matchAngle(text, angle);
            if (close < 0) return null;
            after = close + 1;
        }
        const open = skipSpace(text, after, limit);
        if (text[open] !== '(') return null;
        const closeParams = matchBracket(text, open);
        if (closeParams < 0) return null;
        const terminator = findTerminator(text, closeParams + 1, limit);
        if (terminator < 0) return null;

        const tail = this.whereClause(text.slice(closeParams + 1, terminator)).main;
        const arrow = tail.indexOf('->');
        let end = terminator + 1;
        const hasBody = text[terminator] === '{';
        if (hasBody) {
            const closeBody = matchBracket(text, terminator);
            if (closeBody < 0) return null;
            end = closeBody + 1;
        }
        return {
            name: named.name,
            params: text.slice(open + 1, closeParams),
            returnType: arrow >= 0 ? squash(tail.slice(arrow + 2)) : '',
            hasBody,
            visibility: visibilityOf(qualifiers),
            startLine: this.lineOf(start),
            endLine: this.lineOf(end - 1),
            end
        };
    }

    constant(index, limit, qualifiers) {
        CONST_NAME.lastIndex = index;
        const match = CONST_NAME.exec(this.text);
        if (!match) return null;
        const end = this.skipItem(index, limit);
        const declaration = this.text.slice(index + match[0].length, end).replace(/;\s*$/, '');
        const assign = findTopLevel(declaration, /=/);
        return {
            name: match[1],
            type: squash(assign ? declaration.slice(0, assign.index) : declaration),
            visibility: visibilityOf(qualifiers),
            end
        };
    }

    members(from, limit) {
        const text = this.text;
        const members = [];
        let i = from;
        for (;;) {
            i = skipSpace(text, i, limit);
            if (i >= limit) return members;
            const attributes = this.skipAttributes(i, limit);
            i = attributes.index;
            if (i >= limit) return members;
            const start = i;
            QUALIFIERS.lastIndex = i;
            const qualifiers = QUALIFIERS.exec(text)[0];
            const afterQualifiers = i + qualifiers.length;
            KEYWORD.lastIndex = afterQualifiers;
            const keyword = KEYWORD.exec(text);
            let end;
            if (keyword && keyword[1] === 'fn') {
                const fn = this.fn(afterQualifiers + keyword[0].length, limit, start, qualifiers);
                if (fn && !attributes.testOnly) members.push({ kind: 'fn', ...fn });
                end = fn ? fn.end : this.skipItem(afterQualifiers, limit);
            } else if (keyword && keyword[1] === 'const') {
                const constant = this.constant(afterQualifiers + keyword[0].length, limit, qualifiers);
                if (constant && !attributes.testOnly) members.push({ kind: 'const', ...constant });
                end = constant ? constant.end : this.skipItem(afterQualifiers, limit);
            } else {
                end = this.skipItem(afterQualifiers, limit);
            }
            i = end > i ? end : i + 1;
        }
    }
}

class RustLanguageProvider extends BaseLanguageProvider {
    constructor() {
        super('rust');
        this._memo = null;
    }

    matchFunctionStart(line) {
        const match = /^\s*((?:(?:pub(?:\s*\([^)]*\))?|default|const|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*)fn\s+([A-Za-z_]\w*)/.exec(line);
        if (!match) return null;
        return {
            name: match[2],
            modifiers: match[1].trim(),
            returnType: '',
            visibility: visibilityOf(match[1]) || '-',
            isStatic: false,
            isAbstract: false
        };
    }

    parseFunctions(sourceCode) {
        const source = this._normalize(sourceCode);
        const stripped = blank(source, false).split('\n');
        const raw = source.split('\n');
        const functions = [];
        const collect = fn => {
            if (!fn.hasBody) return;
            functions.push({
                name: fn.name,
                startLine: fn.startLine,
                body: stripped.slice(fn.startLine, fn.endLine + 1).join('\n'),
                rawBody: raw.slice(fn.startLine, fn.endLine + 1).join('\n'),
                endLine: fn.endLine
            });
        };
        for (const item of this._items(sourceCode)) {
            if (item.kind === 'fn') collect(item);
            else item.members.filter(member => member.kind === 'fn').forEach(collect);
        }
        return functions.sort((a, b) => a.startLine - b.startLine);
    }

    parseClasses(sourceCode) {
        return this._classes(sourceCode, true);
    }

    parseClassesLight(sourceCode) {
        return this._classes(sourceCode, false);
    }

    parseImplFragments(sourceCode) {
        const items = this._items(sourceCode);
        const local = new Set(items.filter(item => this._isType(item)).map(item => item.name));
        const fragments = [];
        for (const item of items) {
            if (item.kind !== 'impl') continue;
            const target = this._implTarget(item);
            if (!target || local.has(target.typeName)) continue;
            const fragment = {
                isImplFragment: true,
                name: target.typeName,
                interfaces: [],
                supertypeArgs: {},
                methods: [],
                fields: [],
                body: '',
                ranges: []
            };
            this._applyImpl(fragment, target, item, true);
            fragments.push(fragment);
        }
        return fragments;
    }

    finalizeClasses(classes) {
        const fragments = classes.filter(cls => cls.isImplFragment);
        if (fragments.length === 0) return classes;
        const byName = new Map();
        for (const fragment of fragments) {
            if (!byName.has(fragment.name)) byName.set(fragment.name, []);
            byName.get(fragment.name).push(fragment);
        }
        return classes.filter(cls => !cls.isImplFragment).map(cls => {
            const extras = byName.get(cls.name);
            if (!extras) return cls;
            const merged = {
                ...cls,
                interfaces: [...cls.interfaces],
                supertypeArgs: { ...cls.supertypeArgs },
                methods: [...cls.methods],
                fields: [...cls.fields]
            };
            for (const fragment of extras) {
                fragment.interfaces.forEach(name => this._addInterface(merged, name, fragment.supertypeArgs[name]));
                fragment.methods.forEach(method => this._addMethod(merged, method));
                fragment.fields.forEach(field => this._addField(merged, field));
                merged.body = merged.body ? `${merged.body}\n${fragment.body}` : fragment.body;
            }
            return merged;
        });
    }

    _normalize(sourceCode) {
        return sourceCode.replace(/\r\n?/g, '\n');
    }

    _items(sourceCode) {
        if (this._memo && this._memo.source === sourceCode) return this._memo.items;
        const items = new RustScanner(blank(this._normalize(sourceCode), true)).scan();
        this._memo = { source: sourceCode, items };
        return items;
    }

    _isType(item) {
        return item.kind === 'struct' || item.kind === 'union' || item.kind === 'enum' || item.kind === 'trait';
    }

    _classes(sourceCode, full) {
        const items = this._items(sourceCode);
        const classes = [];
        const byScope = new Map();
        const byName = new Map();
        for (const item of items) {
            if (!this._isType(item)) continue;
            const cls = this._makeClass(item, full);
            classes.push(cls);
            byScope.set(`${item.modPath}\0${item.name}`, cls);
            if (!byName.has(item.name)) byName.set(item.name, cls);
        }
        for (const item of items) {
            if (item.kind !== 'impl') continue;
            const target = this._implTarget(item);
            if (!target) continue;
            const cls = byScope.get(`${item.modPath}\0${target.typeName}`) || byName.get(target.typeName);
            if (cls) this._applyImpl(cls, target, item, full);
        }
        return classes;
    }

    _makeClass(item, full) {
        const parents = item.kind === 'trait' ? this._supertraits(item.bounds) : { names: [], args: {} };
        const cls = {
            name: item.name,
            parent: parents.names[0] || null,
            extraParents: parents.names.slice(1),
            interfaces: [],
            supertypeArgs: parents.args,
            typeParams: this._typeParams(item.generics, item.where),
            isInterface: item.kind === 'trait',
            isEnum: item.kind === 'enum',
            isAbstract: false,
            methods: [],
            fields: []
        };
        if (!full) return cls;

        if (item.kind === 'enum') cls.fields = this._variants(item);
        else if (item.kind === 'trait') this._applyMembers(cls, item.members, '+', true);
        else cls.fields = this._recordFields(item);

        return {
            ...cls,
            startLine: item.startLine,
            body: item.text,
            endLine: item.endLine,
            ranges: [{ startLine: item.startLine, endLine: item.endLine }],
            paramLists: [],
            language: 'rust'
        };
    }

    _typeParams(generics, where) {
        if (!generics.trim()) return [];
        const params = this.parseTypeParameters(`<${generics}>`, typeParameterName);
        for (const predicate of splitTop(where, ',')) {
            const match = /^\s*([A-Za-z_]\w*)\s*:\s*([\s\S]+)$/.exec(predicate);
            const param = match && params.find(candidate => candidate.name === match[1]);
            if (!param) continue;
            const bound = squash(match[2]);
            param.text = param.text.includes(':') ? `${param.text} + ${bound}` : `${param.text}: ${bound}`;
        }
        return params;
    }

    _supertraits(bounds) {
        const names = [];
        const args = {};
        for (const part of splitTop(bounds, '+')) {
            const bound = squash(part).replace(/^for\s*<[^>]*>\s*/, '');
            if (!bound || bound[0] === "'" || bound[0] === '?') continue;
            const parsed = this._pathType(bound, false);
            if (!parsed) continue;
            names.push(parsed.path);
            if (parsed.args) args[parsed.path] = parsed.args;
        }
        return { names, args };
    }

    _pathType(text, stripReferences) {
        let type = squash(text);
        if (stripReferences) type = type.replace(REFERENCE_PREFIX, '');
        const match = /^((?:::)?(?:[A-Za-z_]\w*::)*)([A-Za-z_]\w*)\s*(<[\s\S]*>)?$/.exec(type);
        if (!match || STD_PREFIX.test(match[1])) return null;
        return {
            name: match[2],
            path: match[1].replace(/^::/, '') + match[2],
            args: cleanArguments(match[3])
        };
    }

    _implTarget(impl) {
        if (impl.traitText.startsWith('!')) return null;
        const type = this._pathType(impl.typeText, true);
        if (!type) return null;
        const params = new Set(this._typeParams(impl.generics, '').map(param => param.name));
        if (params.has(type.name)) return null;
        if (!impl.traitText) return { typeName: type.name, traitName: '', traitArgs: '' };
        const trait = this._pathType(impl.traitText, false);
        if (!trait) return null;
        return { typeName: type.name, traitName: trait.path, traitArgs: trait.args };
    }

    _applyImpl(cls, target, impl, full) {
        if (target.traitName) this._addInterface(cls, target.traitName, target.traitArgs);
        if (!full) return;
        this._applyMembers(cls, impl.members, target.traitName ? '+' : '-', false);
        cls.body = cls.body ? `${cls.body}\n${impl.text}` : impl.text;
        cls.ranges.push({ startLine: impl.startLine, endLine: impl.endLine });
    }

    _applyMembers(cls, members, fallbackVisibility, inTrait) {
        for (const member of members) {
            if (member.kind === 'fn') {
                this._addMethod(cls, this._method(member, fallbackVisibility, inTrait));
            } else {
                this._addField(cls, {
                    name: member.name,
                    type: member.type,
                    visibility: member.visibility || fallbackVisibility,
                    isStatic: true,
                    isFinal: true
                });
            }
        }
    }

    _method(fn, fallbackVisibility, inTrait) {
        const params = splitTop(fn.params, ',').map(squash).filter(Boolean);
        const hasReceiver = params.length > 0 && RECEIVER.test(params[0]);
        return {
            name: fn.name,
            type: fn.returnType,
            params: (hasReceiver ? params.slice(1) : params).join(', '),
            visibility: fn.visibility || fallbackVisibility,
            isStatic: !hasReceiver,
            isAbstract: inTrait && !fn.hasBody
        };
    }

    _addInterface(cls, name, args) {
        if (!cls.interfaces.includes(name)) cls.interfaces.push(name);
        if (!args) return;
        const existing = cls.supertypeArgs[name];
        if (!existing) cls.supertypeArgs[name] = args;
        else if (!existing.split(', ').includes(args)) cls.supertypeArgs[name] = `${existing}, ${args}`;
    }

    _addMethod(cls, method) {
        if (!cls.methods.some(existing => existing.name === method.name && existing.params === method.params)) {
            cls.methods.push(method);
        }
    }

    _addField(cls, field) {
        if (!cls.fields.some(existing => existing.name === field.name)) cls.fields.push(field);
    }

    _fieldVisibility(entry) {
        const match = /^pub(?:\s*\(([^)]*)\))?\s*/.exec(entry);
        if (!match) return { visibility: '-', rest: entry };
        const restricted = match[1] !== undefined && match[1].trim() !== 'self';
        return {
            visibility: match[1] === undefined ? '+' : restricted ? '~' : '-',
            rest: entry.slice(match[0].length)
        };
    }

    _recordFields(item) {
        const fields = [];
        const entries = splitTop(item.body, ',').map(stripAttributes).filter(Boolean);
        entries.forEach((entry, index) => {
            const { visibility, rest } = this._fieldVisibility(entry);
            if (item.tuple) {
                fields.push({ name: String(index), type: squash(rest).replace(/\bSelf\b/g, item.name), visibility, isStatic: false });
                return;
            }
            const match = /^(?:r#)?([A-Za-z_]\w*)\s*:\s*([\s\S]+)$/.exec(rest);
            if (match) {
                fields.push({ name: match[1], type: squash(match[2]).replace(/\bSelf\b/g, item.name), visibility, isStatic: false });
            }
        });
        return fields;
    }

    _variants(item) {
        const variants = [];
        for (const entry of splitTop(item.body, ',').map(stripAttributes).filter(Boolean)) {
            const match = /^(?:r#)?([A-Za-z_]\w*)\s*([\s\S]*)$/.exec(entry);
            if (!match) continue;
            const rest = match[2].trim();
            let payload = '';
            if (rest.startsWith('(') || rest.startsWith('{')) {
                const close = matchBracket(rest, 0);
                if (close > 0) {
                    const inner = squash(rest.slice(1, close)).replace(/\bSelf\b/g, item.name);
                    payload = rest[0] === '(' ? `(${inner})` : `{ ${inner} }`;
                }
            }
            variants.push({ name: match[1], type: payload, visibility: '+', isStatic: true, isEnumConstant: true });
        }
        return variants;
    }
}

module.exports = RustLanguageProvider;