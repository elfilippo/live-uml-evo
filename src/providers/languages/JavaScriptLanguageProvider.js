const BaseLanguageProvider = require('./BaseLanguageProvider');

const FIELD_MODIFIERS = '(?:(?:public|private|protected|static|readonly|declare|override|abstract)\\s+)*';

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

    matchClassStart(line) {
        const trimmed = line.trim();
        // matches: export default class MyClass extends Parent<Type> {
        // matches: interface MyIface extends Parent {
        // matches: enum MyEnum {  (TypeScript)
        // matches: export abstract class MyClass {  (TypeScript)
        const classPattern = /^\s*((?:export|default|class|interface|enum|abstract|\s)*)\s*(class|interface|enum)\s+(\w+)(?:\s+extends\s+(\w+(?:\s*<[^>]*>)?(?:\.[\w<>]+)*))?(?:\s+implements\s+([\w\s,]+))?\s*\{?/;
        const match = trimmed.match(classPattern);
        if (match) {
            const modifiers = match[1] || '';
            const interfaces = match[5] ? match[5].split(',').map(s => s.trim()) : [];
            return {
                name: match[3],
                parent: match[4] || null,
                interfaces: interfaces,
                isInterface: match[2] === 'interface',
                isEnum: match[2] === 'enum',
                isAbstract: /\babstract\b/.test(modifiers)
            };
        }
        return null;
    }
}

module.exports = JavaScriptLanguageProvider;