const BaseLanguageProvider = require('./BaseLanguageProvider');

const TYPE = '[\\w.$]+(?:\\s*<[^>]*>)?(?:\\s*\\[\\s*\\])*';
const FIELD_MODIFIERS = '(?:(?:public|private|protected|static|final|transient|volatile)\\s+)*';
const NON_FIELD_STARTS = new Set([
    'return', 'throw', 'new', 'import', 'package', 'assert', 'break', 'continue',
    'case', 'default', 'else', 'this', 'super', 'yield'
]);

class JavaLanguageProvider extends BaseLanguageProvider {
    constructor() {
        super('java');
    }

    matchFunctionStart(line) {
        const trimmed = line.trim();
        if (/^\s*(if|else|while|for|switch|return|class|interface|enum|import|package|@|try|catch|finally)\b/.test(trimmed)) return null;

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
        return { visibility: null, isEnum: !!(classMatch && classMatch.isEnum) };
    }

    collectExtraFields(body, state) {
        if (!state || !state.isEnum) return [];

        const lines = body.split('\n');
        let depth = 0;
        for (const line of lines) {
            const depthBefore = depth;
            depth += this._braceDelta(line);
            if (depthBefore !== 1) continue;

            const trimmed = line.trim();
            if (!trimmed) continue;

            // Enum constants are the first depth-1 statement in the body, e.g.
            // "SUMMER, WINTER, ALL_SEASON;" or "SUMMER(1), WINTER(2);". Whatever
            // this first statement is, it's either that constant list or the
            // enum has none - either way there's nothing more to look for.
            return this.matchEnumConstants(trimmed);
        }
        return [];
    }

    matchEnumConstants(trimmed) {
        let body = trimmed;
        if (body.endsWith(';')) body = body.slice(0, -1);
        else if (body.endsWith(',')) body = body.slice(0, -1);
        if (!body || /[{}]/.test(body) || /^@/.test(body)) return [];

        const parts = body.split(',').map(s => s.trim()).filter(Boolean);
        if (!parts.length) return [];

        const constantPattern = /^([A-Z][A-Za-z0-9_]*)(?:\([^)]*\))?$/;
        if (!parts.every(p => constantPattern.test(p))) return [];

        return parts.map(p => ({
            name: p.match(constantPattern)[1],
            type: '',
            visibility: '+',
            isStatic: true,
            isEnumConstant: true
        }));
    }

    matchField(line) {
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
        return {
            name: match[3],
            type: type,
            visibility: this.visibilityOf(modifiers, '~'),
            isStatic: /\bstatic\b/.test(modifiers)
        };
    }

    matchClassStart(line) {
        const trimmed = line.trim();
        // matches: public abstract class MyClass extends Parent<String> implements Iface1, Iface2 {
        const classPattern = /^\s*((?:(?:public|protected|private|static|final|abstract)\s+)*)(class|interface|enum)\s+(\w+)(?:\s+extends\s+(\w+(?:\s*<[^>]*>)?(?:\.[\w<>]+)*))?(?:\s+implements\s+([\w\s,]+))?\s*\{?/;
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

module.exports = JavaLanguageProvider;