const BaseLanguageProvider = require('./BaseLanguageProvider');

const TYPE = '[\\w.$]+(?:\\s*<[^>]*>)?(?:\\s*\\[\\s*\\])*';
const FIELD_MODIFIERS = '(?:(?:public|private|protected|static|final|transient|volatile)\\s+)*';
const RECORD_START = /^(?:(?:public|protected|private|static|final|strictfp)\s+)*record\s+\w+\s*[<(]/;
const RECORD_PATTERN = /^\s*((?:(?:public|protected|private|static|final|strictfp)\s+)*)record\s+(\w+)\s*\((?:[^)]*\))?(?:\s+implements\s+([\w\s,.]+))?\s*\{?/;
const NON_FIELD_STARTS = new Set([
    'return', 'throw', 'new', 'import', 'package', 'assert', 'break', 'continue',
    'case', 'default', 'else', 'this', 'super', 'yield'
]);

function splitAngles(text) {
    let depth = 0;
    let out = '';
    let inner = '';
    let owner = null;
    const args = {};
    for (const ch of text) {
        if (ch === '<') {
            if (depth === 0) {
                const m = out.match(/[\w.]+(?=\s*$)/);
                owner = m ? m[0] : null;
                inner = '';
            }
            depth++;
            inner += ch;
        } else if (ch === '>') {
            if (depth > 0) {
                depth--;
                inner += ch;
                if (depth === 0 && owner) args[owner] = inner.replace(/\s+/g, ' ');
            }
        } else if (depth > 0) {
            inner += ch;
        } else {
            out += ch;
        }
    }
    return { text: out, args };
}

class JavaLanguageProvider extends BaseLanguageProvider {
    constructor() {
        super('java');
    }

    matchFunctionStart(line) {
        const trimmed = line.trim();
        if (/^\s*(if|else|while|for|switch|return|class|interface|enum|import|package|@|try|catch|finally)\b/.test(trimmed)) return null;
        if (RECORD_START.test(trimmed)) return null;

        const keywords = ['if', 'else', 'while', 'for', 'switch', 'return', 'class', 'interface', 'new', 'try', 'catch', 'finally', 'throw'];

        // Match method start: [modifiers] [type-params] [return-type] name (
        // Matches: public void test(
        // Matches: static <T> T get(
        // Matches: MyClass(
        const methodStartPattern = new RegExp(
            `^\\s*((?:(?:public|private|protected|static|final|abstract|synchronized|native|default|transient|volatile)\\s+)*)` +
            `(?:<[^>]+>\\s*)?` +
            `(?:(${TYPE})\\s+)?` +
            `(\\w+)\\s*\\(`
        );

        const match = trimmed.match(methodStartPattern);
        if (match && match[3] && !keywords.includes(match[3])) {
            const modifiers = match[1] || '';
            return {
                name: match[3],
                modifiers: modifiers,
                returnType: (match[2] || '').trim(),
                visibility: this.visibilityOf(modifiers, '~'),
                isStatic: /\bstatic\b/.test(modifiers),
                isAbstract: /\babstract\b/.test(modifiers)
            };
        }

        return null;
    }

    createMemberState(body, classMatch) {
        return {
            visibility: null,
            isEnum: !!(classMatch && classMatch.isEnum),
            isInterface: !!(classMatch && classMatch.isInterface),
            isRecord: !!(classMatch && classMatch.isRecord)
        };
    }

    matchMemberFunction(line, state) {
        const match = this.matchFunctionStart(line);
        if (match && state && state.isInterface && !/\b(?:public|private|protected)\b/.test(match.modifiers)) {
            match.visibility = '+';
        }
        return match;
    }

    // Enum constants that take constructor args or have a per-constant
    // anonymous body (e.g. "PLUS(\"+\") { ... }") look exactly like a method
    // declaration to matchFunctionStart, so the base member loop ends up
    // filing them as methods before collectExtraFields ever runs - and its
    // own "already seen" guard then refuses to also add them as fields.
    // Recompute the real constant list independently here and reconcile.
    extractMembers(body, classMatch = null) {
        const result = super.extractMembers(body, classMatch);
        if (classMatch && classMatch.isRecord) {
            const components = this.matchRecordComponents(body);
            const names = new Set(components.map(c => c.name));
            return {
                methods: result.methods,
                fields: [...components, ...result.fields.filter(f => !names.has(f.name))]
            };
        }
        if (!classMatch || !classMatch.isEnum) return result;

        const constants = this.collectExtraFields(body, { isEnum: true });
        if (constants.length === 0) return result;

        const constantNames = new Set(constants.map(c => c.name));
        const methods = result.methods.filter(m => !constantNames.has(m.name));

        const existingFieldNames = new Set(result.fields.map(f => f.name));
        const fields = [
            ...constants.filter(c => !existingFieldNames.has(c.name)),
            ...result.fields
        ];

        return { methods, fields };
    }

    collectExtraFields(body, state) {
        if (state && state.isRecord) return this.matchRecordComponents(body);
        if (!state || !state.isEnum) return [];

        const openIdx = body.indexOf('{');
        if (openIdx === -1) return [];

        // The constant list is everything between the enum's opening brace and
        // the first top-level ';' (or the enum's own closing brace, if there's
        // no trailing member section). "Top-level" here means outside any
        // constructor-arg parens and outside any per-constant anonymous body,
        // so both of those can safely contain their own commas/semicolons.
        let segment = '';
        let parenDepth = 0;
        let braceDepth = 0;
        for (let i = openIdx + 1; i < body.length; i++) {
            const ch = body[i];
            if (ch === '(') { parenDepth++; segment += ch; continue; }
            if (ch === ')') { parenDepth--; segment += ch; continue; }
            if (ch === '{') { braceDepth++; segment += ch; continue; }
            if (ch === '}') {
                if (braceDepth === 0) break; // enum's own closing brace
                braceDepth--; segment += ch; continue;
            }
            if (ch === ';' && parenDepth === 0 && braceDepth === 0) break;
            segment += ch;
        }

        return this.matchEnumConstants(segment);
    }

    matchRecordComponents(body) {
        const header = /\brecord\s+\w+\s*/.exec(body);
        if (!header) return [];
        let i = header.index + header[0].length;
        if (body[i] === '<') {
            let depth = 0;
            for (; i < body.length; i++) {
                if (body[i] === '<') depth++;
                else if (body[i] === '>' && --depth === 0) { i++; break; }
            }
            while (/\s/.test(body[i] || '')) i++;
        }
        if (body[i] !== '(') return [];
        let depth = 0;
        let end = -1;
        for (let j = i; j < body.length; j++) {
            if (body[j] === '(') depth++;
            else if (body[j] === ')' && --depth === 0) { end = j; break; }
        }
        if (end < 0) return [];

        const parts = [];
        let current = '';
        let nesting = 0;
        for (const ch of body.slice(i + 1, end)) {
            if (ch === '<' || ch === '(') nesting++;
            else if (ch === '>' || ch === ')') nesting--;
            if (ch === ',' && nesting === 0) {
                parts.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        parts.push(current);

        const components = [];
        for (const part of parts) {
            const cleaned = part
                .replace(/@\w+(?:\.\w+)*(?:\s*\([^)]*\))?/g, ' ')
                .replace(/\bfinal\b/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const match = /^(.+?)\s+(\w+)$/.exec(cleaned);
            if (!match) continue;
            components.push({
                name: match[2],
                type: match[1].replace(/\s*\.\.\.$/, '[]'),
                visibility: '-',
                isStatic: false,
                isFinal: true
            });
        }
        return components;
    }

    matchEnumConstants(segment) {
        const trimmed = segment.trim();
        if (!trimmed) return [];

        // Split on top-level commas only, so a constant's constructor args
        // (e.g. "PLUS(1, 2)") or anonymous body don't get split apart.
        const parts = [];
        let current = '';
        let parenDepth = 0;
        let braceDepth = 0;
        for (const ch of trimmed) {
            if (ch === '(') parenDepth++;
            else if (ch === ')') parenDepth--;
            else if (ch === '{') braceDepth++;
            else if (ch === '}') braceDepth--;

            if (ch === ',' && parenDepth === 0 && braceDepth === 0) {
                parts.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) parts.push(current);

        const constants = [];
        for (const rawPart of parts) {
            const parsed = this._parseEnumConstantName(rawPart.trim());
            if (!parsed) return []; // not a clean constant list - bail entirely
            constants.push(parsed);
        }

        return constants.map(({ name, hasOverride }) => ({
            name,
            type: '',
            visibility: '+',
            isStatic: true,
            isEnumConstant: true,
            hasOverride
        }));
    }

    // Parses a single constant entry - NAME, optionally followed by balanced
    // (constructor args) and/or a balanced { anonymous body } - and returns
    // its name plus whether it carries its own body (i.e. overrides a
    // method), or null if anything is left over unaccounted for.
    _parseEnumConstantName(part) {
        const nameMatch = part.match(/^([A-Z][A-Za-z0-9_]*)/);
        if (!nameMatch) return null;
        let rest = part.slice(nameMatch[0].length).trim();

        rest = this._skipBalanced(rest, '(', ')');
        if (rest === null) return null;

        const hasOverride = rest.startsWith('{');
        rest = this._skipBalanced(rest, '{', '}');
        if (rest === null) return null;

        return rest === '' ? { name: nameMatch[1], hasOverride } : null;
    }

    // If `s` starts with `open`, consumes up to its matching `close` and
    // returns the remainder (trimmed). Returns `s` unchanged if it doesn't
    // start with `open`, or null if the brackets never balance.
    _skipBalanced(s, open, close) {
        if (!s.startsWith(open)) return s;
        let depth = 0;
        for (let i = 0; i < s.length; i++) {
            if (s[i] === open) depth++;
            else if (s[i] === close) {
                depth--;
                if (depth === 0) return s.slice(i + 1).trim();
            }
        }
        return null;
    }

    matchField(line, state) {
        const trimmed = line.trim();
        if (!trimmed.endsWith(';')) return null;
        if (/^@/.test(trimmed)) return null;
        if (/^\s*(?:class|interface|enum|import|package)\b/.test(trimmed)) return null;

        const fieldPattern = new RegExp(
            `^(${FIELD_MODIFIERS})(${TYPE})\\s+(\\w+)\\s*(?:=\\s*[^;]*)?;$`
        );
        const match = trimmed.match(fieldPattern);
        if (!match) return null;

        const type = match[2].trim();
        if (NON_FIELD_STARTS.has(type)) return null;

        const declarationHead = trimmed.split('=')[0];
        if (declarationHead.includes('(')) return null;

        const modifiers = match[1] || '';
        const inInterface = !!(state && state.isInterface);
        return {
            name: match[3],
            type: type,
            visibility: this.visibilityOf(modifiers, inInterface ? '+' : '~'),
            isStatic: inInterface || /\bstatic\b/.test(modifiers),
            isFinal: inInterface || /\bfinal\b/.test(modifiers)
        };
    }

    matchClassStart(line) {
        const { text: trimmed, args } = splitAngles(line.trim());
        const record = RECORD_PATTERN.exec(trimmed);
        if (record) {
            const interfaces = record[3] ? record[3].split(',').map(s => s.trim()).filter(Boolean) : [];
            const supertypeArgs = {};
            interfaces.forEach(name => {
                if (args[name]) supertypeArgs[name] = args[name];
            });
            return {
                name: record[2],
                parent: null,
                extraParents: [],
                interfaces: interfaces,
                supertypeArgs: supertypeArgs,
                typeParams: this.parseTypeParameters(args[record[2]]),
                isInterface: false,
                isEnum: false,
                isAbstract: false,
                isRecord: true
            };
        }
        // matches: public abstract class MyClass extends Parent<String> implements Iface1, Iface2 {
        const classPattern = /^\s*((?:(?:public|protected|private|static|final|abstract)\s+)*)(class|interface|enum)\s+(\w+)(?:\s+extends\s+([\w.]+(?:\s*,\s*[\w.]+)*))?(?:\s+implements\s+([\w\s,.]+))?\s*\{?/;
        const match = trimmed.match(classPattern);
        if (match) {
            const modifiers = match[1] || '';
            const extended = match[4] ? match[4].split(',').map(s => s.trim()).filter(Boolean) : [];
            const interfaces = match[5] ? match[5].split(',').map(s => s.trim()).filter(Boolean) : [];
            const supertypeArgs = {};
            [...extended, ...interfaces].forEach(name => {
                if (args[name]) supertypeArgs[name] = args[name];
            });
            return {
                name: match[3],
                parent: extended[0] || null,
                extraParents: extended.slice(1),
                interfaces: interfaces,
                supertypeArgs: supertypeArgs,
                typeParams: this.parseTypeParameters(args[match[3]]),
                isInterface: match[2] === 'interface',
                isEnum: match[2] === 'enum',
                isAbstract: /\babstract\b/.test(modifiers)
            };
        }
        return null;
    }
}

module.exports = JavaLanguageProvider;