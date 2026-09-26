/**
 * Base class for language-specific parsing logic.
 */
class LanguageProvider {
    constructor(language) {
        this.language = language;
    }

    /**
     * Parse functions from source code.
     * @param {string} sourceCode 
     * @returns {Array} Array of {name, startLine, body, endLine}
     */
    parseFunctions(sourceCode) {
        throw new Error('parseFunctions not implemented');
    }

    /**
     * Match the start of a function/method.
     * @param {string} line 
     * @returns {Object|null} {name} if match, else null
     */
    matchFunctionStart(line) {
        throw new Error('matchFunctionStart not implemented');
    }

    /**
     * Extract the body of a function.
     * @param {string[]} lines 
     * @param {number} startLine 
     * @returns {Object|null} {body, endLine} if match, else null
     */
    extractFunctionBody(lines, startLine) {
        throw new Error('extractFunctionBody not implemented');
    }
}

module.exports = LanguageProvider;
