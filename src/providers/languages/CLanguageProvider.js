const BaseLanguageProvider = require('./BaseLanguageProvider');

function splitBases(text) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of text) {
        if (ch === '<') depth++;
        else if (ch === '>') depth--;
        if (ch === ',' && depth === 0) {
            parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    parts.push(current);
    return parts;
}

const C_KEYWORDS = new Set([
    'return', 'if', 'else', 'while', 'for', 'switch', 'case', 'break', 'continue',
    'goto', 'typedef', 'using', 'namespace', 'template', 'friend', 'delete', 'new',
    'throw', 'sizeof', 'static_assert'
]);

class CLanguageProvider extends BaseLanguageProvider {
    constructor() {
        super('c');
    }

    processPreprocessor(code) {
        const lines = code.split('\n');
        const result = [];
        const stack = [];
        let skipDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            if (trimmed.startsWith('#if ') || trimmed.startsWith('#if\t')) {
                const condition = trimmed.substring(3).trim();
                const isTrue = condition === '1' || condition === 'true';
                if (skipDepth > 0) { skipDepth++; stack.push({ type: 'if', active: false, hasActiveBranch: false }); }
                else { const active = isTrue; stack.push({ type: 'if', active, hasActiveBranch: active }); if (!active) skipDepth = 1; }
                result.push('');
                continue;
            }
            if (trimmed.startsWith('#ifdef ')) {
                if (skipDepth > 0) { skipDepth++; stack.push({ type: 'ifdef', active: false, hasActiveBranch: false }); }
                else { stack.push({ type: 'ifdef', active: true, hasActiveBranch: true }); }
                result.push('');
                continue;
            }
            if (trimmed.startsWith('#ifndef ')) {
                if (skipDepth > 0) { skipDepth++; stack.push({ type: 'ifndef', active: false, hasActiveBranch: false }); }
                else { stack.push({ type: 'ifndef', active: true, hasActiveBranch: true }); }
                result.push('');
                continue;
            }
            if (trimmed.startsWith('#elif ')) {
                if (stack.length > 0) {
                    const top = stack[stack.length - 1];
                    if (skipDepth > 0) { if (!top.hasActiveBranch) { top.active = true; top.hasActiveBranch = true; skipDepth = 0; } }
                    else { top.active = false; skipDepth = 1; }
                }
                result.push('');
                continue;
            }
            if (trimmed.startsWith('#else')) {
                if (stack.length > 0) {
                    const top = stack[stack.length - 1];
                    if (skipDepth > 0) { if (!top.hasActiveBranch) { top.active = true; top.hasActiveBranch = true; skipDepth = 0; } }
                    else { top.active = false; skipDepth = 1; }
                }
                result.push('');
                continue;
            }
            if (trimmed.startsWith('#endif')) {
                if (stack.length > 0) { const top = stack.pop(); if (skipDepth > 0 && !top.active) skipDepth--; }
                result.push('');
                continue;
            }
            if (trimmed.startsWith('#')) { result.push(''); continue; }
            result.push(skipDepth === 0 ? line : '');
        }
        return result.join('\n');
    }

    parseFunctions(sourceCode) {
        const processedCode = this.processPreprocessor(sourceCode);
        return super.parseFunctions(processedCode);
    }

    matchFunctionStart(line) {
        const trimmed = line.trim();
        if (/^\s*(if|else|while|for|switch|return|typedef|struct|union|enum|#)/.test(trimmed)) return null;

        const keywords = ['if', 'else', 'while', 'for', 'switch', 'return', 'sizeof', 'typedef', 'try', 'catch', 'do', 'namespace', 'template', 'case', 'delete', 'new', 'throw'];

        // Inline function: void test() { or int* getName() { or void change(int s) { current = s; }
        // Capture group 1 is the function name, but for pointer returns like "byte *funcName()",
        // the * may be captured. We strip leading * from the captured name.
        const funcPattern = /^([\w\s*&:<>,]+?)\s+(\*?\w+)\s*\([^)]*\)\s*(?:const\s*)?(?:override\s*)?(?:noexcept\s*)?\{?\s*.*$/;
        let match = trimmed.match(funcPattern);
        if (match && match[2] && !keywords.includes(match[2].replace(/^\*+/, ''))) {
            return this._describe(match[2], match[1]);
        }

        // Namespace-qualified inline: void Device::test() { or int Device::getCount() {
        const nsInlineFuncPattern = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)::([A-Za-z_]\w*)\s*\([^)]*\)\s*\{?\s*(?:\/\/.*)?$/;
        match = trimmed.match(nsInlineFuncPattern);
        if (match && match[3] && !keywords.includes(match[3])) return this._describe(match[3], match[1]);

        const multiLineFuncPattern = /^([\w:<>,\s*&]+)\s+(\w+)\s*\([^)]*[,(]\s*$/;
        match = trimmed.match(multiLineFuncPattern);
        if (match && match[2] && !keywords.includes(match[2])) return this._describe(match[2], match[1]);

        const nsFuncPattern = /^([A-Za-z_]\w*)::([A-Za-z_]\w*)\s*\([^)]*(?:[,(]\s*)?$/;
        match = trimmed.match(nsFuncPattern);
        if (match && match[2] && !keywords.includes(match[2])) return this._describe(match[2], '');

        const nsReturnFuncPattern = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)::([A-Za-z_]\w*)\s*\([^)]*(?:[,(]\s*)?$/;
        match = trimmed.match(nsReturnFuncPattern);
        if (match && match[3] && !keywords.includes(match[3])) return this._describe(match[3], match[1]);

        const simpleFuncPattern = /^([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*\([^)]*(?:[,(]\s*)?$/;
        match = trimmed.match(simpleFuncPattern);
        if (match && match[2] && !keywords.includes(match[2])) return this._describe(match[2], match[1]);

        // Constructor / destructor without a return type: MyClass(int a) { or ~MyClass() {
        const ctorPattern = /^(?:explicit\s+)?(~?[A-Za-z_]\w*)\s*\([^)]*\)\s*(?::[^{]*)?\{?\s*$/;
        match = trimmed.match(ctorPattern);
        if (match && match[1] && !keywords.includes(match[1])) return this._describe(match[1], '');

        return null;
    }

    // Member level also sees pure declarations (constructors, destructors,
    // pure-virtual methods, and plain prototypes ending in a semicolon),
    // which are not function *definitions*. These are checked FIRST: a
    // return-typed declaration like "virtual double area() const = 0;" would
    // otherwise be caught by matchFunctionStart's definition regex (its
    // trailing `\{?\s*.*$` matches a bare ";" line just fine), which always
    // reports isAbstract:false — silently hiding every pure-virtual method
    // that has a return type before this check ever ran.
    matchMemberFunction(line) {
        const trimmed = line.trim();
        if (trimmed.endsWith(';')) {
            const declPattern = /^(?:explicit\s+|virtual\s+|static\s+|inline\s+|constexpr\s+)*(?:([\w:<>,\s*&]+?)\s+)?(~?[A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:const\s*)?(?:=\s*(?:0|default|delete)\s*)?;$/;
            const match = trimmed.match(declPattern);
            if (match) {
                const modifiers = (trimmed.match(/^(?:explicit\s+|virtual\s+|static\s+|inline\s+|constexpr\s+)*/) || [''])[0];
                return {
                    name: match[2],
                    modifiers: modifiers,
                    returnType: (match[1] || '').trim(),
                    params: (match[3] || '').replace(/\s+/g, ' ').trim(),
                    isStatic: /\bstatic\b/.test(modifiers),
                    isAbstract: /=\s*0\s*;$/.test(trimmed)
                };
            }
        }

        return this.matchFunctionStart(line);
    }

    _describe(rawName, rawType) {
        const modifiers = (rawType || '').trim();
        const type = modifiers
            .replace(/\b(?:static|virtual|inline|explicit|friend|constexpr)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return {
            name: rawName.replace(/^\*+/, ''),
            modifiers: modifiers,
            returnType: type,
            isStatic: /\bstatic\b/.test(modifiers),
            isAbstract: false
        };
    }

    createMemberState(body, classMatch) {
        const isStruct = /^\s*(?:template\s*<[^>]*>\s*)?struct\b/.test((body || '').split('\n')[0] || '');
        return { visibility: isStruct ? '+' : '-' };
    }

    updateMemberState(line, state) {
        const match = line.trim().match(/^(public|private|protected)\s*:/);
        if (match) {
            state.visibility = BaseLanguageProvider.VISIBILITY_SYMBOLS[match[1]];
        }
    }

    matchField(line, state) {
        const trimmed = line.trim();
        if (!trimmed.endsWith(';')) return null;
        if (/^(?:public|private|protected)\s*:/.test(trimmed)) return null;
        if (/^\s*(?:using|typedef|friend|template|return|struct|class|enum|union)\b/.test(trimmed)) return null;

        const fieldPattern = /^((?:(?:static|mutable|const|constexpr|volatile|inline|unsigned|signed|long|short)\s+)*)([\w:]+(?:\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*>)?)\s*([*&]*)\s*(\w+)\s*((?:\[[^\]]*\])*)\s*(?:=\s*[^;]*|\{[^}]*\})?;$/;
        const match = trimmed.match(fieldPattern);
        if (!match) return null;

        const baseType = match[2].trim();
        if (C_KEYWORDS.has(baseType)) return null;

        const declarationHead = trimmed.split('=')[0];
        if (declarationHead.includes('(')) return null;

        const modifiers = match[1] || '';
        const type = `${modifiers.replace(/\b(?:static|mutable|inline)\b/g, '').replace(/\s+/g, ' ').trim()} ${baseType}${match[3] || ''}${match[5] || ''}`.trim();

        return {
            name: match[4],
            type: type,
            visibility: this.defaultVisibility(state),
            isStatic: /\bstatic\b/.test(modifiers)
        };
    }

    matchClassStart(line) {
        const trimmed = line.trim();
        if (trimmed.split('{')[0].includes(';')) return null;
        // matches: class MyClass : public Parent1, public Parent2 {
        // Also handles template bases (Base<int>) and namespace-qualified (NS::Base)
        const classPattern = /^\s*(?:class|struct)\s+(\w+)(?:\s+final)?(?:\s*:\s*([^{]+))?\s*\{?/;
        const match = trimmed.match(classPattern);
        if (match) {
            const supertypeArgs = {};
            const bases = match[2] ? splitBases(match[2]).map(p => {
                const base = p.trim().replace(/^(?:(?:public|protected|private|virtual)\s+)+/, '').trim();
                const open = base.indexOf('<');
                if (open < 0) return base;
                const name = base.slice(0, open).trim();
                supertypeArgs[name] = base.slice(open).trim();
                return name;
            }).filter(Boolean) : [];
            return {
                name: match[1],
                parent: bases[0] || null,
                extraParents: bases.slice(1),
                interfaces: [],
                supertypeArgs
            };
        }
        return null;
    }

    parseClasses(sourceCode) {
        const processedCode = this.processPreprocessor(sourceCode);
        return super.parseClasses(processedCode);
    }

    parseClassesLight(sourceCode) {
        const processedCode = this.processPreprocessor(sourceCode);
        return super.parseClassesLight(processedCode);
    }
}

module.exports = CLanguageProvider;