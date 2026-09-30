const BaseLanguageProvider = require('./BaseLanguageProvider');

const FIELD_MODIFIERS = '(?:(?:public|private|protected|static|readonly|declare|override|abstract)\\s+)*';

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitTopLevel(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    let previous = '';
    for (const ch of text) {
        if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
        else if (ch === ')' || ch === ']' || ch === '}' || (ch === '>' && previous !== '=')) depth--;
        if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
        previous = ch;
    }
    parts.push(current);
    return parts;
}

function splitTypeParameters(text) {
    const start = text.search(/\S/);
    if (start < 0 || text[start] !== '<') return { params: '', rest: text };
    let depth = 0;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '<') depth++;
        else if (text[i] === '>' && --depth === 0) return { params: text.slice(start, i + 1), rest: text.slice(i + 1) };
    }
    return { params: '', rest: '' };
}

function parseSupertypes(text, supertypeArgs) {
    const names = [];
    splitTopLevel(text).forEach(part => {
        const item = part.trim();
        const name = item.replace(/[<(][\s\S]*$/, '').trim();
        if (!name) return;
        names.push(name);
        const open = item.indexOf('<');
        if (open >= 0) supertypeArgs[name] = item.slice(open).trim();
    });
    return names;
}

class JavaScriptLanguageProvider extends BaseLanguageProvider {
    constructor() {
        super('javascript');
    }

    matchFunctionStart(line) {
        const trimmed = line.trim();
        if (/^\s*(if|else|while|for|switch|return|class|interface|enum|import|export|default|static|async|public|private|protected)\b/.test(trimmed) &&
            !/^\s*(static|async|public|private|protected)\s+[a-zA-Z_$]/.test(trimmed)) {
            return null;
        }

        // Standard function: function name()
        const funcPattern = /function\s+([a-zA-Z_$][\w$]*)/;
        let match = trimmed.match(funcPattern);
        if (match) return { name: match[1], visibility: '+', returnType: '' };

        // Class method: name(args) {
        // Matches: myMethod(a, b) { or async myMethod() { or static myMethod() {
        const methodPattern = /^\s*((?:async\s+|static\s+|public\s+|private\s+|protected\s+|get\s+|set\s+|\*\s*)*)(#?[a-zA-Z_$][\w$]*)\s*\(([^)]*)\)\s*(?::\s*([^{;]+))?\s*\{?/;
        match = trimmed.match(methodPattern);
        if (match && match[2]) {
            const keywords = ['if', 'else', 'while', 'for', 'switch', 'return', 'class', 'interface', 'enum', 'import', 'export', 'default', 'constructor', 'get', 'set', 'catch', 'function', 'typeof', 'await', 'new', 'delete'];
            if (!keywords.includes(match[2])) {
                const modifiers = match[1] || '';
                return {
                    name: match[2],
                    modifiers: modifiers,
                    returnType: (match[4] || '').trim(),
                    params: (match[3] || '').replace(/\s+/g, ' ').trim(),
                    visibility: match[2].startsWith('#') ? '-' : this.visibilityOf(modifiers, '+'),
                    isStatic: /\bstatic\b/.test(modifiers)
                };
            }
        }

        return null;
    }

    matchField(line) {
        const trimmed = line.trim();
        if (!trimmed) return null;
        if (/^(?:\/\/|\*|@)/.test(trimmed)) return null;
        if (/^\s*(?:class|interface|enum|import|export|return|constructor)\b/.test(trimmed)) return null;
        if (trimmed.includes('=>')) return this._matchArrowField(trimmed);

        const fieldPattern = new RegExp(
            `^(${FIELD_MODIFIERS})(#?[a-zA-Z_$][\\w$]*)\\s*[?!]?\\s*(?::\\s*([^=;]+?))?\\s*(?:=\\s*([^;]*))?\\s*;?\\s*$`
        );
        const match = trimmed.match(fieldPattern);
        if (!match || !match[2]) return null;

        const hasType = !!match[3];
        const hasValue = match[4] !== undefined;
        const hasSemicolon = trimmed.endsWith(';');
        if (!hasType && !hasValue && !hasSemicolon) return null;
        if (!hasType && !hasValue && !/^#/.test(match[2])) return null;

        const modifiers = match[1] || '';
        return {
            name: match[2],
            type: hasType ? match[3].trim() : this._inferType(match[4]),
            visibility: match[2].startsWith('#') || /\bprivate\b/.test(modifiers) ? '-' : this.visibilityOf(modifiers, '+'),
            isStatic: /\bstatic\b/.test(modifiers)
        };
    }

    _matchArrowField(trimmed) {
        const arrowPattern = new RegExp(
            `^(${FIELD_MODIFIERS})(#?[a-zA-Z_$][\\w$]*)\\s*(?::\\s*[^=]+)?=\\s*(?:async\\s+)?\\(?[^=]*=>`
        );
        const match = trimmed.match(arrowPattern);
        if (!match || !match[2]) return null;
        const modifiers = match[1] || '';
        return {
            name: match[2],
            type: 'function',
            visibility: match[2].startsWith('#') || /\bprivate\b/.test(modifiers) ? '-' : this.visibilityOf(modifiers, '+'),
            isStatic: /\bstatic\b/.test(modifiers)
        };
    }

    _inferType(value) {
        if (value === undefined || value === null) return '';
        const v = value.trim();
        if (!v) return '';
        if (/^['"`]/.test(v)) return 'string';
        if (/^-?\d/.test(v)) return 'number';
        if (/^(?:true|false)$/.test(v)) return 'boolean';
        if (/^\[/.test(v)) return 'array';
        if (/^\{/.test(v)) return 'object';
        if (/^new\s+([\w.$]+)/.test(v)) return v.match(/^new\s+([\w.$]+)/)[1];
        return '';
    }

    // Fields assigned in the constructor (this.foo = ...) never appear at class
    // member level, so they are collected from the whole class body.
    collectExtraFields(body) {
        const fields = [];
        const seen = new Set();
        const pattern = /this\.(#?[a-zA-Z_$][\w$]*)\s*=(?!=)/g;
        let match;
        while ((match = pattern.exec(body)) !== null) {
            const name = match[1];
            if (seen.has(name)) continue;
            seen.add(name);
            fields.push({
                name: name,
                type: '',
                visibility: name.startsWith('#') || name.startsWith('_') ? '-' : '+',
                isStatic: false
            });
        }
        return fields;
    }

    extractMembers(body, classMatch = null) {
        const { lists, flattened } = this._scanConstructors(body);
        const { methods, fields } = super.extractMembers(flattened, classMatch);
        const parse = list => splitTopLevel(list).map(text => this._parseParam(text)).filter(Boolean);
        const constructorParams = lists.flatMap(parse);
        const paramTypes = new Map();
        [...constructorParams, ...methods.flatMap(m => parse(m.params || ''))].forEach(param => {
            if (param.type && !paramTypes.has(param.name)) paramTypes.set(param.name, param.type);
        });
        const properties = constructorParams
            .filter(param => param.modifiers.trim())
            .map(param => ({
                name: param.name,
                type: param.type,
                visibility: this.visibilityOf(param.modifiers, '+'),
                isStatic: false,
                assignedFromParameter: true
            }));
        const propertyNames = new Set(properties.map(p => p.name));
        const remaining = fields
            .filter(f => !propertyNames.has(f.name))
            .map(f => f.type ? f : { ...f, type: this._inferAssignedType(body, f.name, paramTypes) });
        return { methods, fields: [...properties, ...remaining], paramLists: lists };
    }

    _scanConstructors(body) {
        const lists = [];
        let flattened = '';
        let last = 0;
        const pattern = /(?:^|[\s;{}])constructor\s*\(/g;
        let match;
        while ((match = pattern.exec(body)) !== null) {
            const open = match.index + match[0].length - 1;
            let depth = 0;
            let close = -1;
            for (let i = open; i < body.length; i++) {
                if (body[i] === '(') depth++;
                else if (body[i] === ')' && --depth === 0) {
                    close = i;
                    break;
                }
            }
            if (close < 0) break;
            const params = body.slice(open + 1, close);
            lists.push(params.replace(/\s+/g, ' ').trim());
            flattened += body.slice(last, open + 1) + params.replace(/\s*\n\s*/g, ' ');
            last = close;
            pattern.lastIndex = close;
        }
        return { lists, flattened: flattened + body.slice(last) };
    }

    _parseParam(text) {
        const cleaned = text.trim().replace(/^(?:@\w+(?:\([^)]*\))?\s*)+/, '');
        const match = /^((?:(?:public|private|protected|readonly|override)\s+)*)(?:\.\.\.)?(#?[\w$]+)\s*\??\s*(?::\s*([\s\S]+?))?\s*(?:=(?!>)[\s\S]*)?$/.exec(cleaned);
        if (!match) return null;
        return { name: match[2], type: (match[3] || '').trim(), modifiers: match[1] || '' };
    }

    _inferAssignedType(body, name, paramTypes) {
        const pattern = new RegExp(`this\\.${escapeRegExp(name)}\\s*=(?!=)\\s*([^;\\n]*)`, 'g');
        let match;
        while ((match = pattern.exec(body)) !== null) {
            const expression = match[1].trim();
            const lead = /^([\w$]+)\s*(?:$|\|\||\?\?)/.exec(expression);
            const type = (lead && paramTypes.get(lead[1]))
                || this._inferType(expression)
                || (/\bnew\s+([\w.$]+)/.exec(expression) || [])[1]
                || '';
            if (type) return type;
        }
        return '';
    }

    matchClassStart(line) {
        const trimmed = line.trim();
        // matches: export default class MyClass extends Parent<Type> {
        // matches: interface MyIface extends Parent, Other {
        // matches: enum MyEnum {  (TypeScript)
        // matches: export abstract class MyClass<T> implements Foo<T>, Bar {  (TypeScript)
        const classPattern = /^\s*((?:export|default|class|interface|enum|abstract|\s)*)\s*(class|interface|enum)\s+(\w+)/;
        const match = trimmed.match(classPattern);
        if (match) {
            const modifiers = match[1] || '';
            const { params, rest } = splitTypeParameters(trimmed.slice(match[0].length));
            const clauses = rest.split('{')[0];
            const supertypeArgs = {};
            const extendsMatch = /\bextends\s+([\s\S]*?)(?=\bimplements\b|$)/.exec(clauses);
            const implementsMatch = /\bimplements\s+([\s\S]*)$/.exec(clauses);
            const parents = extendsMatch ? parseSupertypes(extendsMatch[1], supertypeArgs) : [];
            const interfaces = implementsMatch ? parseSupertypes(implementsMatch[1], supertypeArgs) : [];
            return {
                name: match[3],
                parent: parents[0] || null,
                extraParents: parents.slice(1),
                interfaces: interfaces,
                supertypeArgs: supertypeArgs,
                typeParams: this.parseTypeParameters(params),
                isInterface: match[2] === 'interface',
                isEnum: match[2] === 'enum',
                isAbstract: /\babstract\b/.test(modifiers)
            };
        }
        return null;
    }
}

module.exports = JavaScriptLanguageProvider;