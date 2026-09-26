/**
 * StateAnalyzer — State Machine Detection & Transition Gathering
 *
 * Two-phase design:
 *   Phase 1 — Detection: scores variables across all functions to find state vars
 *   Phase 2 — Transition Gathering: walks target function gathering transitions
 *
 * Uses ASTParser for semantic extraction nodes instead of raw regex.
 */

const ASTParser = require('./ASTParser');
const StatementParser = require('./StatementParser');
const { KEYWORDS } = StatementParser;

const STATE_NAME_HINTS = /^(state|status|phase|mode|step|stage|current[A-Z]|\w*state$|\w*status$)/i;

class StateAnalyzer {
  constructor() {
    this._ast = new ASTParser();
  }
  analyze(functionName, functionBody, allFunctions, language) {
    const { stateVars: allStateVars } = this._detectStateVariablesAll(allFunctions, language);
    if (allStateVars.size === 0) {
      return { transitions: [], eligible: false, externalGuesses: [], extraStates: new Map() };
    }

    const targetFunc = allFunctions.find(f => f.name === functionName);
    if (!targetFunc) return { transitions: [], eligible: false, externalGuesses: [], extraStates: new Map() };

    const targetRawBody = targetFunc.rawBody || targetFunc.body;
    const bodyForAnalysis = StatementParser.removeCommentsPreservingStrings(targetRawBody);

    const activeVars = this._findActiveVars(allStateVars, bodyForAnalysis);

    if (activeVars.length === 0) {
      return { transitions: [], eligible: false, externalGuesses: [], extraStates: new Map() };
    }

    const extraStates = new Map();
    this._collectSwitchCaseLabels(activeVars, bodyForAnalysis, extraStates);

    const allTransitions = [];
    const allExternalGuesses = new Set();
    const visited = new Set();

    for (const sv of activeVars) {
      const svTransitions = [];
      const svVisited = new Set();
      const svExternalGuesses = new Set();
      const svExtraStates = new Set(extraStates.get(sv) || []);

      const stateVars = new Set([sv]);
      this._gatherTransitions(functionName, targetRawBody, allFunctions, svTransitions, svVisited, 2, null, stateVars, null, svExternalGuesses, null, svExtraStates, language);

      for (const t of svTransitions) {
        t.variable = sv;
      }

      allTransitions.push(...svTransitions);
      for (const g of svExternalGuesses) allExternalGuesses.add(g);
      if (svExtraStates.size > 0) extraStates.set(sv, [...svExtraStates]);
    }

    if (allTransitions.length === 0 && extraStates.size === 0) {
      return { transitions: [], eligible: false, externalGuesses: [...allExternalGuesses], extraStates };
    }

    const varsWithFrom = new Set();
    for (const t of allTransitions) {
      if (t.fromState !== undefined) varsWithFrom.add(t.variable);
    }
    const varsToKeep = new Set(varsWithFrom);
    for (const [sv] of extraStates) varsToKeep.add(sv);
    const filtered = allTransitions.filter(t => varsToKeep.has(t.variable));
    if (filtered.length === 0 && extraStates.size === 0) {
      return { transitions: [], eligible: false, externalGuesses: [...allExternalGuesses], extraStates };
    }

    return { transitions: filtered, eligible: true, externalGuesses: [...allExternalGuesses], extraStates };
  }

  // ---------------------------------------------------------------
  //  Phase 1 — Detection
  // ---------------------------------------------------------------

  _detectStateVariablesAll(allFunctions, language) {
    const assignments = new Map();
    const switchVars = new Set();
    const inSwitchVars = new Set();
    const compareVars = new Map();
    const switchVarsWithCases = new Set();

    for (const func of allFunctions) {
      const body = StatementParser.removeCommentsPreservingStrings(func.rawBody || func.body);
      const lines = body.split('\n');

      let switchDepth = 0;
      let awaitingSwitchBody = false;

      for (const line of lines) {
        if (awaitingSwitchBody) {
          for (const ch of line) {
            if (ch === '{') { switchDepth++; awaitingSwitchBody = false; break; }
          }
        }
        if (/\bswitch\s*\(/.test(line)) {
          if (line.includes('{')) {
            const braceIdx = line.indexOf('{');
            const afterBrace = line.substring(braceIdx + 1);
            switchDepth++;
            for (const ch of afterBrace) {
              if (ch === '}') switchDepth--;
            }
          } else {
            awaitingSwitchBody = true;
          }
        }

        for (const ch of line) {
          if (ch === '}' && switchDepth > 0) switchDepth--;
        }
      }

      // Use the full function body for tree-sitter extraction (line-by-line
      // doesn't produce valid parse trees).
      const assigns = this._ast.extractAssignments(body, language);
      for (const a of assigns) {
        if (!assignments.has(a.key)) assignments.set(a.key, new Set());
        assignments.get(a.key).add(a.value);
        if (switchDepth > 0) inSwitchVars.add(a.key);
      }

      const discs = this._ast.extractSwitchDiscriminants(body, language);
      for (const d of discs) {
        switchVars.add(d.key);
        // Count case labels
        const afterSwitch = body.substring(body.indexOf('switch') + 7);
        const braceIdx = afterSwitch.indexOf('{');
        if (braceIdx !== -1) {
          const switchBody = afterSwitch.substring(braceIdx + 1);
          const caseRe = /\bcase\s+(\w+)\s*:/g;
          let cm;
          let caseCount = 0;
          while ((cm = caseRe.exec(switchBody)) !== null) {
            const textBefore = switchBody.substring(0, cm.index);
            const openBraces = (textBefore.match(/\{/g) || []).length;
            const closeBraces = (textBefore.match(/\}/g) || []).length;
            if (openBraces - closeBraces !== 0) continue;
            if (!KEYWORDS.has(cm[1])) caseCount++;
          }
          if (caseCount >= 1) switchVarsWithCases.add(d.key);
        }
      }

      const comps = this._ast.extractComparisons(body, language);
      for (const c of comps) {
        if (!compareVars.has(c.key)) compareVars.set(c.key, new Set());
        compareVars.get(c.key).add(c.value);
      }
    }

    const stateVars = new Set();
    const scores = new Map();

    for (const [key, values] of assignments) {
      let score = 0;
      if (switchVars.has(key) && assignments.has(key)) score += 3;
      if (inSwitchVars.has(key)) score += 3;
      if (compareVars.has(key) && compareVars.get(key).size >= 2) score += 2;
      if (values.size >= 2 && compareVars.has(key)) score += 1;
      if (values.size >= 3) score += 1;
      if (values.size >= 4) score += 1;
      if (STATE_NAME_HINTS.test(key)) score += 1;

      scores.set(key, score);

      if (score >= 2) {
        stateVars.add(key);
      }
    }

    for (const key of switchVars) {
      if (!stateVars.has(key) && assignments.has(key) && assignments.get(key).size >= 1) {
        stateVars.add(key);
        if (!scores.has(key)) scores.set(key, 3);
      }
    }

    for (const key of inSwitchVars) {
      if (!stateVars.has(key) && assignments.has(key) && assignments.get(key).size >= 1) {
        stateVars.add(key);
        if (!scores.has(key)) scores.set(key, 3);
      }
    }

    for (const key of switchVarsWithCases) {
      if (!stateVars.has(key)) {
        stateVars.add(key);
        if (!scores.has(key)) scores.set(key, 1);
      }
    }

    // Minimum eligibility filter
    for (const key of [...stateVars]) {
      const values = assignments.get(key);
      const numValues = values ? values.size : 0;
      const hasCompare = compareVars.has(key);
      const isSwitchVar = switchVars.has(key) || inSwitchVars.has(key);
      const hasNameHint = STATE_NAME_HINTS.test(key);
      const isSwitchOnly = switchVarsWithCases.has(key) && !isSwitchVar && !assignments.has(key);

      if (isSwitchOnly) continue;

      const hasManyCompares = hasCompare && compareVars.has(key) && compareVars.get(key).size >= 2;

      if (numValues < 2 && !isSwitchVar && !hasManyCompares) {
        stateVars.delete(key);
        continue;
      }

      if (!hasCompare && !isSwitchVar && !hasNameHint) {
        stateVars.delete(key);
      }
    }

    this._varValues = assignments;

    return { stateVars, scores };
  }

  _findActiveVars(allStateVars, bodyForAnalysis) {
    const activeVars = [];
    const bodyLower = bodyForAnalysis.toLowerCase();

    for (const sv of allStateVars) {
      const varName = sv.includes('.') ? sv.split('.')[1] : sv;
      const reVar = new RegExp('\\b' + varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      if (!reVar.test(bodyLower)) continue;

      const svThis = sv.startsWith('this.') ? sv : 'this.' + sv;
      const localAssignments = new Set();
      const localSwitchDiscriminant = new Set();
      const localCompareKeys = new Set();
      const localCompareVals = new Set();
      let hasBareAssignment = false;
      let hasBareSwitch = false;
      let hasBareCompare = false;
      const lines = bodyForAnalysis.split('\n');

      for (const line of lines) {
        const aRe = /\bswitch\s*\(/;
        // We use extractAssignments, extractSwitchDiscriminants, extractComparisons
        // directly from the reusable patterns
        const ASSIGN_RE = /(?:(\bthis|self)\s*\.\s*)?([a-zA-Z_]\w*)(?:\s*:\s*\w+(?:\s*<[^>]*>)?)?\s*=\s*['"]?(\w+)['"]?/g;
        const SWITCH_RE = /\bswitch\s*\(\s*(?:(this|self)\.)?\s*([a-zA-Z_]\w*)\s*\)/g;
        const COMPARE_RE = /(?:(this|self)\.)?([a-zA-Z_]\w*)\s*(?:===?|==|!=|>=|<=|>|<|is\s+not|is)\s*['"]?(\w+)['"]?/g;

        const reAss = new RegExp(ASSIGN_RE.source, 'g');
        let am;
        while ((am = reAss.exec(line)) !== null) {
          const afterMatch = line.substring(am.index + am[0].length).trimLeft();
          if (afterMatch.startsWith('(')) continue;
          const key = am[1] ? am[1] + '.' + am[2] : am[2];
          if (key === sv || key === svThis) {
            localAssignments.add(am[3]);
            if (key === sv) hasBareAssignment = true;
          }
        }

        const reSw = new RegExp(SWITCH_RE.source, 'g');
        let sm;
        while ((sm = reSw.exec(line)) !== null) {
          const key = sm[1] ? sm[1] + '.' + sm[2] : sm[2];
          if (key === sv || key === svThis) {
            localSwitchDiscriminant.add(key);
            if (key === sv) hasBareSwitch = true;
          }
        }

        const reCp = new RegExp(COMPARE_RE.source, 'g');
        let cm;
        while ((cm = reCp.exec(line)) !== null) {
          const key = cm[1] ? cm[1] + '.' + cm[2] : cm[2];
          if (key === sv || key === svThis) {
            localCompareKeys.add(key);
            const value = cm[3];
            if (!KEYWORDS.has(value)) localCompareVals.add(value);
            if (key === sv) hasBareCompare = true;
          }
        }
      }

      if (localAssignments.size > 0 || localSwitchDiscriminant.size > 0 || localCompareVals.size >= 2) {
        activeVars.push(sv);
      }
    }
    return activeVars;
  }

  _collectSwitchCaseLabels(activeVars, bodyForAnalysis, extraStates) {
    for (const sv of activeVars) {
      const svThis = sv.startsWith('this.') ? sv : 'this.' + sv;
      const SWITCH_RE = /\bswitch\s*\(\s*(?:(this|self)\.)?\s*([a-zA-Z_]\w*)\s*\)/g;
      const caseValues = new Set();

      let sm;
      while ((sm = SWITCH_RE.exec(bodyForAnalysis)) !== null) {
        const key = sm[1] ? sm[1] + '.' + sm[2] : sm[2];
        if (key !== sv && key !== svThis) continue;

        const afterSwitch = bodyForAnalysis.substring(sm.index + sm[0].length);
        const braceIdx = afterSwitch.indexOf('{');
        if (braceIdx === -1) continue;

        const switchBody = afterSwitch.substring(braceIdx + 1);
        const caseRe = /\bcase\s+(\w+)\s*:/g;
        caseRe.lastIndex = 0;
        let cm;
        while ((cm = caseRe.exec(switchBody)) !== null) {
          const textBefore = switchBody.substring(0, cm.index);
          const openBraces = (textBefore.match(/\{/g) || []).length;
          const closeBraces = (textBefore.match(/\}/g) || []).length;
          if (openBraces - closeBraces !== 0) continue;
          if (!KEYWORDS.has(cm[1])) caseValues.add(cm[1]);
        }
      }

      if (caseValues.size > 0) {
        if (!extraStates.has(sv)) extraStates.set(sv, []);
        const existing = new Set(extraStates.get(sv));
        for (const v of caseValues) {
          if (!existing.has(v)) {
            extraStates.get(sv).push(v);
            existing.add(v);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------
  //  Phase 2 — Transition Gathering
  // ---------------------------------------------------------------

  _commonPrefix(values, minLen) {
    if (!values || values.length === 0) return '';
    let prefix = values[0];
    for (let i = 1; i < values.length; i++) {
      while (values[i].indexOf(prefix) !== 0) {
        prefix = prefix.substring(0, prefix.length - 1);
        if (prefix.length < minLen) return '';
      }
    }
    return prefix;
  }

  _isArgCompatible(sv, extArg, extraStates, lastValue) {
    if (extraStates && extraStates.has(extArg)) return true;

    if (extraStates && extraStates.size > 0) {
      const p = this._commonPrefix([...extraStates], 3);
      if (p && extArg.indexOf(p) === 0) return true;
    }

    const val = lastValue.get(sv);
    if (val && val.includes('_')) {
      const prefix = val.split('_')[0] + '_';
      if (prefix.length >= 3 && extArg.indexOf(prefix) === 0) return true;
    }

    if (this._varValues && this._varValues.has(sv)) {
      const vals = [...this._varValues.get(sv)].filter(v => v.length >= 3 && v.includes('_'));
      if (vals.length > 0) {
        const p = this._commonPrefix(vals, 3);
        if (p && extArg.indexOf(p) === 0) return true;
      }
      if (vals.length > 0) return false;
      const allVals = [...this._varValues.get(sv)];
      const isEnumArg = /^[A-Z][A-Z_0-9]+$/.test(extArg);
      const allBare = allVals.every(v => !/^[A-Z][A-Z_0-9]+$/.test(v));
      if (isEnumArg && allBare && allVals.length > 0) return false;
    }

    return true;
  }

  _extractTrigger(line, prevLine) {
    const extractCondition = (text) => {
      const ifStart = text.search(/\bif\s*\(/);
      if (ifStart === -1) return null;
      const afterIf = text.substring(ifStart + 3);
      const openParen = afterIf.indexOf('(');
      if (openParen === -1) return null;
      let depth = 1;
      let cond = '';
      for (let i = openParen + 1; i < afterIf.length; i++) {
        if (afterIf[i] === '(') depth++;
        else if (afterIf[i] === ')') {
          depth--;
          if (depth === 0) break;
        }
        cond += afterIf[i];
      }
      return cond.trim();
    };
    let cond = extractCondition(line);
    if (cond) return { type: 'condition', value: cond };
    if (prevLine && prevLine.includes('{')) {
      cond = extractCondition(prevLine);
      if (cond) return { type: 'condition', value: cond };
    }
    return null;
  }

  _hasSetterCalleeForVar(varName, targetBody, allFunctions) {
    for (const func of allFunctions) {
      const funcBody = func.rawBody || func.body;
      if (!funcBody) continue;
      const params = this._ast.extractFunctionParams(funcBody);
      if (params.length === 0) continue;
      const cleanBody = StatementParser.removeCommentsPreservingStrings(funcBody);
      for (const paramName of params) {
        const reAssign = new RegExp(`([a-zA-Z_]\\w*)\\s*=\\s*` + paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + `\\b`, 'g');
        let am;
        while ((am = reAssign.exec(cleanBody)) !== null) {
          const assignedVar = am[1];
          if (assignedVar === varName || 'this.' + assignedVar === varName) {
            const reCall = new RegExp('\\b' + func.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'g');
            if (reCall.test(targetBody)) return true;
          }
        }
        const reThis = new RegExp(`(?:this|self)\\.([a-zA-Z_]\\w*)\\s*=\\s*` + paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + `\\b`, 'g');
        let tm;
        while ((tm = reThis.exec(cleanBody)) !== null) {
          const key = 'this.' + tm[1];
          if (key === varName) {
            const reCall = new RegExp('\\b' + func.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'g');
            if (reCall.test(targetBody)) return true;
          }
        }
      }
    }
    return false;
  }

  _gatherTransitions(funcName, funcBody, allFunctions, transitions, visited, depthLeft, callerName, stateVars, argMap, externalGuesses, parentValues, extraStates, language) {
    if (visited.has(funcName)) return;
    visited.add(funcName);

    const body = StatementParser.removeCommentsPreservingStrings(funcBody);
    const rawLines = body.split('\n');
    const lines = [];
    for (let i = 0; i < rawLines.length; i++) {
      const rl = rawLines[i];
      if (rl.includes('(') && !rl.includes(')') && i + 1 < rawLines.length) {
        const next = rawLines[i + 1].trim();
        if (next.includes(')')) {
          lines.push(rl + ' ' + next);
          i++;
          continue;
        }
      }
      lines.push(rl);
    }
    const lastValue = new Map(parentValues);
    let preIfSnapshot = null;
    let branchEndVals = null;
    let chainDepth = 0;
    const seenCallees = new Set();

    // Pre-scan local assignment keys
    const ASSIGN_RE = /(?:(\bthis|self)\s*\.\s*)?([a-zA-Z_]\w*)(?:\s*:\s*\w+(?:\s*<[^>]*>)?)?\s*=\s*['"]?(\w+)['"]?/g;
    const localAssignKeys = new Set();
    const preScanRe = new RegExp(ASSIGN_RE.source, 'g');
    let _am;
    while ((_am = preScanRe.exec(body)) !== null) {
      const k = _am[1] ? _am[1] + '.' + _am[2] : _am[2];
      localAssignKeys.add(k);
    }

    // Build state setter map
    const stateSetters = new Map();
    for (const func of allFunctions) {
      if (visited.has(func.name)) continue;
      const funcBody = func.rawBody || func.body;
      if (!funcBody) continue;
      const params = this._ast.extractFunctionParams(funcBody);
      if (params.length === 0) continue;
      const cleanBody = StatementParser.removeCommentsPreservingStrings(funcBody);
      for (const paramName of params) {
        const reAssign = new RegExp(`([a-zA-Z_]\\w*)\\s*=\\s*` + paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + `\\b`, 'g');
        let am;
        while ((am = reAssign.exec(cleanBody)) !== null) {
          const varName = am[1];
          if (stateVars.has(varName) || stateVars.has('this.' + varName)) {
            const targetVar = stateVars.has(varName) ? varName : 'this.' + varName;
            stateSetters.set(func.name, { targetVar, paramName });
            break;
          }
        }
        const reThis = new RegExp(`(?:this|self)\\.([a-zA-Z_]\\w*)\\s*=\\s*` + paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + `\\b`, 'g');
        let tm;
        while ((tm = reThis.exec(cleanBody)) !== null) {
          const key = 'this.' + tm[1];
          if (stateVars.has(key)) {
            stateSetters.set(func.name, { targetVar: key, paramName });
            break;
          }
        }
      }
    }

    const hasCalleeForVar = (varName) => {
      for (const [calleeName, setterInfo] of stateSetters) {
        if (setterInfo.targetVar === varName) {
          const re = new RegExp('\\b' + calleeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(', 'g');
          if (re.test(body)) return true;
        }
      }
      return false;
    };

    const extPattern = /^(?:set(?:[A-Z]\w*)?State|setState[A-Z]\w*|update(?:[A-Z]\w*)?State|change(?:[A-Z]\w*)?State)$/;
    const hasExternalGuessForVar = (varName) => {
      const reCall = /(\w+)\s*\(\s*['"]?(\w+)['"]?[^)]*\)/g;
      let m;
      while ((m = reCall.exec(body)) !== null) {
        const callName = m[1];
        const callArg = m[2];
        if (extPattern.test(callName) && !KEYWORDS.has(callName) && !KEYWORDS.has(callArg) && /^[A-Z][A-Z_0-9]+$/.test(callArg)) {
          const calleeExists = allFunctions.some(f => f.name === callName);
          if (!calleeExists) return true;
        }
      }
      return false;
    };

    // --- Switch statement analysis ---
    const SWITCH_RE = /\bswitch\s*\(\s*(?:(this|self)\.)?\s*([a-zA-Z_]\w*)\s*\)/g;
    let sm;
    while ((sm = SWITCH_RE.exec(body)) !== null) {
      const switchKey = sm[1] ? sm[1] + '.' + sm[2] : sm[2];
      const switchKeyUnqualified = sm[2];
      const hasSwitchVar = stateVars.has(switchKey) || stateVars.has(switchKeyUnqualified);
      if (!hasSwitchVar) continue;

      const effectiveKey = stateVars.has(switchKey) ? switchKey : switchKeyUnqualified;
      const afterSwitch = body.substring(sm.index + sm[0].length);
      const braceIdx = afterSwitch.indexOf('{');
      if (braceIdx === -1) continue;

      const afterBrace = afterSwitch.substring(braceIdx + 1);
      const hasAssign = localAssignKeys.has(switchKey) || localAssignKeys.has(switchKeyUnqualified) || hasCalleeForVar(switchKey) || hasExternalGuessForVar(switchKey);

      const caseRe = /\bcase\s+(\w+)\s*:/g;
      let cm;
      let prevLabel = null;
      let prevCaseEnd = -1;
      let initialTarget = null;
      const beforeSwitchText = body.substring(0, sm.index);
      const priorAssignRe = new RegExp(ASSIGN_RE.source, 'g');
      let _priorMatch;
      let hasPriorAssignment = false;
      while ((_priorMatch = priorAssignRe.exec(beforeSwitchText)) !== null) {
        const k = _priorMatch[1] ? _priorMatch[1] + '.' + _priorMatch[2] : _priorMatch[2];
        if (k === effectiveKey) {
          hasPriorAssignment = true;
          break;
        }
      }
      let alreadyAssignedBeforeSwitch = lastValue.has(effectiveKey) || hasPriorAssignment;

      while ((cm = caseRe.exec(afterBrace)) !== null) {
        const textBefore = afterBrace.substring(0, cm.index);
        const openBraces = (textBefore.match(/\{/g) || []).length;
        const closeBraces = (textBefore.match(/\}/g) || []).length;
        if (openBraces - closeBraces !== 0) continue;
        if (KEYWORDS.has(cm[1])) continue;

        const label = cm[1];
        if (prevLabel === null) {
          initialTarget = label;
          if (!alreadyAssignedBeforeSwitch) {
            lastValue.set(effectiveKey, label);
          }
          prevLabel = label;
          prevCaseEnd = cm.index + cm[0].length;
          if (!hasAssign && !alreadyAssignedBeforeSwitch) {
            transitions.push({
              toState: label,
              isInitial: true,
              triggerFunction: callerName || funcName,
              sourceFunction: funcName,
              confidence: 'high',
              sourceLocation: { line: body.substring(0, sm.index).split('\n').length },
              variable: effectiveKey,
            });
          }
          continue;
        }

        const between = afterBrace.substring(prevCaseEnd, cm.index);
        const hasCodeBetween = /\S/.test(between.replace(/case\s+\w+\s*:/g, ''));
        const hasBreak = /\bbreak\b/.test(between);
        if (!hasCodeBetween) {
          if (initialTarget === null) initialTarget = label;
          if (!hasAssign) lastValue.set(effectiveKey, label);
        } else if (hasBreak) {
          if (!hasAssign) lastValue.set(effectiveKey, label);
        } else {
          transitions.push({
            fromState: prevLabel,
            toState: label,
            triggerFunction: callerName || funcName,
            sourceFunction: funcName,
            confidence: 'high',
            sourceLocation: { line: body.substring(0, sm.index).split('\n').length },
            variable: effectiveKey,
          });
          if (!hasAssign) lastValue.set(effectiveKey, label);
        }
        prevLabel = label;
        prevCaseEnd = cm.index + cm[0].length;
      }

      if (initialTarget && hasAssign && !alreadyAssignedBeforeSwitch) {
        transitions.push({
          toState: initialTarget,
          isInitial: true,
          triggerFunction: callerName || funcName,
          sourceFunction: funcName,
          confidence: 'high',
          sourceLocation: { line: body.substring(0, sm.index).split('\n').length },
          variable: effectiveKey,
        });
      }
    }

    // --- Line-by-line walk ---
    let inElseBranch = false;
    let ifChainDepth = -1;
    let hasElseClause = false;
    const savedBranchEndsList = [];

    let caseFallbacks = new Map();
    let lastCaseLabel = null;
    let wasPreviousCase = false;
    let activeSwitchVar = null;
    let savedBranchEndVals = null;
    let savedPreIfSnapshot = null;

    const _isPython = language === 'python';
    const pythonIndentStack = [0];
    let pythonDepth = 0;
    let prevPythonIndent = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const prevLine = lineIdx > 0 ? lines[lineIdx - 1] : null;
      const trimmed = line.trim();

      if (_isPython) {
        const pythonIndent = line.length - line.trimStart().length;
        if (trimmed && !trimmed.startsWith('#')) {
          if (pythonIndent > prevPythonIndent && prevPythonIndent > 0) {
            pythonIndentStack.push(pythonIndent);
            pythonDepth++;
          } else if (pythonIndent < prevPythonIndent) {
            while (pythonIndentStack.length > 1 && pythonIndent < pythonIndentStack[pythonIndentStack.length - 1]) {
              pythonIndentStack.pop();
              pythonDepth--;
            }
          }
          prevPythonIndent = pythonIndent;
        }
      }

      const switchRe = /\bswitch\s*\(\s*(?:(?:this|self)\.)?\s*([a-zA-Z_]\w*)\s*\)/;
      const switchMatch = trimmed.match(switchRe);
      if (switchMatch && stateVars.has(switchMatch[1])) {
        activeSwitchVar = switchMatch[1];
      }

      const caseMatch = trimmed.match(/\bcase\s+(\w+)\s*:/);
      if (caseMatch && !KEYWORDS.has(caseMatch[1])) {
        lastCaseLabel = caseMatch[1];
        if (wasPreviousCase && activeSwitchVar) {
          const labelIsCompatible = extraStates ? extraStates.has(lastCaseLabel) : false;
          if (labelIsCompatible && caseFallbacks && lastValue.has(activeSwitchVar)) {
            const key = activeSwitchVar;
            const val = lastValue.get(key);
            if (!caseFallbacks.has(key)) caseFallbacks.set(key, new Set());
            caseFallbacks.get(key).add(val);
            lastValue.set(key, lastCaseLabel);
          }
        } else if (activeSwitchVar) {
          const labelIsCompatible = extraStates ? extraStates.has(lastCaseLabel) : false;
          if (labelIsCompatible && lastValue.has(activeSwitchVar)) {
            lastValue.set(activeSwitchVar, lastCaseLabel);
          }
        }
        wasPreviousCase = true;
        if (branchEndVals && preIfSnapshot) {
          const matchFound = [...branchEndVals.values()].some(vals => vals.has(lastCaseLabel));
          if (!matchFound) {
            if (!savedBranchEndVals) {
              savedBranchEndVals = branchEndVals;
              savedPreIfSnapshot = preIfSnapshot;
            }
            branchEndVals = null;
            preIfSnapshot = null;
            inElseBranch = false;
            ifChainDepth = -1;
          }
        }
        if (!branchEndVals && savedBranchEndVals && savedPreIfSnapshot) {
          const matchFound = [...savedBranchEndVals.values()].some(vals => vals.has(lastCaseLabel));
          if (matchFound) {
            branchEndVals = savedBranchEndVals;
            preIfSnapshot = savedPreIfSnapshot;
            savedBranchEndVals = null;
            savedPreIfSnapshot = null;
          }
        }
      } else {
        wasPreviousCase = false;
      }

      for (const ch of trimmed) {
        if (ch === '{') chainDepth++;
        else if (ch === '}') chainDepth--;
      }

      const isIf = (/\bif\s*\(/.test(trimmed) || /^\s*if\s+\S/.test(trimmed)) && !/else\s+if\b/.test(trimmed) && !/^\s*elif\s+/.test(trimmed);
      const isElse = /^\s*\}\s*else\s*\{/.test(trimmed) || /^\s*else\s*:/.test(trimmed) || /^\s*else\s*\{/.test(trimmed) || trimmed === 'else' || /^\s*else\s*$/.test(trimmed);
      const isElseIf = /^\s*\}\s*else\s+if\b/.test(trimmed) || /^\s*else\s+if\b/.test(trimmed) || /^\s*elif\s+/.test(trimmed);

      const effectiveDepth = _isPython ? pythonDepth : chainDepth;

      if (branchEndVals && !isIf && ifChainDepth >= 0 && effectiveDepth < ifChainDepth) {
        if (preIfSnapshot) {
          for (const [key, val] of lastValue) {
            if (stateVars.has(key) && preIfSnapshot.has(key) && preIfSnapshot.get(key) !== val) {
              if (!branchEndVals.has(key)) branchEndVals.set(key, new Set());
              branchEndVals.get(key).add(val);
              if (!hasElseClause) {
                branchEndVals.get(key).add(preIfSnapshot.get(key));
              }
            }
          }
        }
        if (savedBranchEndsList.length > 0) {
          const { prevBranchEndVals, chainModVars } = savedBranchEndsList.pop();
          if (prevBranchEndVals) {
            for (const [key, vals] of prevBranchEndVals) {
              if (!chainModVars.has(key)) {
                if (!branchEndVals.has(key)) branchEndVals.set(key, new Set());
                for (const v of vals) branchEndVals.get(key).add(v);
              }
            }
          }
        }
        inElseBranch = false;
        hasElseClause = false;
      }

      if (isIf) {
        const prevBranchEndVals = branchEndVals;
        const chainModVars = new Set();

        preIfSnapshot = new Map(lastValue);
        branchEndVals = new Map();
        inElseBranch = false;
        hasElseClause = false;
        ifChainDepth = effectiveDepth;

        const COMPARE_RE = /(?:(this|self)\.)?([a-zA-Z_]\w*)\s*(?:===?|==|!=|>=|<=|>|<|is\s+not|is)\s*['"]?(\w+)['"]?/g;
        const compareRe = new RegExp(COMPARE_RE.source, 'g');
        let _cm;
        while ((_cm = compareRe.exec(trimmed)) !== null) {
          const cmpKey = _cm[1] ? _cm[1] + '.' + _cm[2] : _cm[2];
          const svKey = _cm[1] && stateVars.has(_cm[2]) ? _cm[2] : (stateVars.has(cmpKey) ? cmpKey : null);
          if (svKey) {
            const opM = _cm[0].match(/(===?|!=|>=|<=|>|<|is\s+not|is)/);
            const isEq = opM && (opM[1] === '==' || opM[1] === '===' || opM[1] === 'is');
            if (isEq && !/^\d+$/.test(_cm[3])) {
              const prevVal = lastValue.get(svKey);
              lastValue.set(svKey, _cm[3]);
              if (prevVal === undefined) {
                transitions.push({
                  toState: _cm[3],
                  isInitial: true,
                  triggerFunction: callerName || funcName,
                  sourceFunction: funcName,
                  confidence: 'high',
                  sourceLocation: { line: lineIdx + 1 },
                  variable: cmpKey,
                });
              }
            }
          }
        }

        savedBranchEndsList.push({ prevBranchEndVals, chainModVars });
      }

      if (isElse || isElseIf) {
        inElseBranch = true;
        if (isElse && !isElseIf) hasElseClause = true;
        if (preIfSnapshot) {
          for (const [key, val] of lastValue) {
            if (stateVars.has(key) && preIfSnapshot.has(key) && preIfSnapshot.get(key) !== val) {
              if (!branchEndVals.has(key)) branchEndVals.set(key, new Set());
              branchEndVals.get(key).add(val);
            }
          }
          for (const [key, val] of preIfSnapshot) {
            if (stateVars.has(key)) lastValue.set(key, val);
          }
          const COMPARE_RE = /(?:(this|self)\.)?([a-zA-Z_]\w*)\s*(?:===?|==|!=|>=|<=|>|<|is\s+not|is)\s*['"]?(\w+)['"]?/g;
          const compareRe = new RegExp(COMPARE_RE.source, 'g');
          let _cm;
          while ((_cm = compareRe.exec(trimmed)) !== null) {
            const cmpKey = _cm[1] ? _cm[1] + '.' + _cm[2] : _cm[2];
            const svKey = _cm[1] && stateVars.has(_cm[2]) ? _cm[2] : (stateVars.has(cmpKey) ? cmpKey : null);
            if (svKey) {
              const opM = _cm[0].match(/(===?|!=|>=|<=|>|<|is\s+not|is)/);
              const isEq = opM && (opM[1] === '==' || opM[1] === '===' || opM[1] === 'is');
              if (isEq && !/^\d+$/.test(_cm[3])) {
                lastValue.set(svKey, _cm[3]);
              }
            }
          }
        }
      }

      // --- State setter call ---
      const stateSetterMatch = trimmed.match(/(\w+)\s*\(\s*['"]?(\w+)['"]?[^)]*\)/);
      if (stateSetterMatch && stateSetters.has(stateSetterMatch[1])) {
        const callName = stateSetterMatch[1];
        const callArg = stateSetterMatch[2];
        if (!KEYWORDS.has(callArg)) {
          const setterInfo = stateSetters.get(callName);
          if (stateVars.has(setterInfo.targetVar)) {
            const prev = lastValue.get(setterInfo.targetVar);
            const next = callArg;
            lastValue.set(setterInfo.targetVar, next);
            if (prev !== next) {
              const trigger = this._extractTrigger(line, prevLine);
              if (prev === undefined) {
                transitions.push({
                  toState: next,
                  isInitial: true,
                  triggerFunction: callerName || funcName,
                  sourceFunction: funcName,
                  confidence: 'high',
                  sourceLocation: { line: lineIdx + 1 },
                  variable: setterInfo.targetVar,
                  triggerCondition: trigger,
                });
              } else {
                transitions.push({
                  fromState: prev,
                  toState: next,
                  triggerFunction: callerName || funcName,
                  sourceFunction: funcName,
                  confidence: 'high',
                  sourceLocation: { line: lineIdx + 1 },
                  variable: setterInfo.targetVar,
                  triggerCondition: trigger,
                });
              }

              if (caseFallbacks && caseFallbacks.has(setterInfo.targetVar)) {
                for (const fbVal of caseFallbacks.get(setterInfo.targetVar)) {
                  if (fbVal !== next) {
                    transitions.push({
                      fromState: fbVal,
                      toState: next,
                      triggerFunction: callerName || funcName,
                      sourceFunction: funcName,
                      confidence: 'high',
                      sourceLocation: { line: lineIdx + 1 },
                      variable: setterInfo.targetVar,
                      triggerCondition: trigger,
                    });
                  }
                }
                caseFallbacks.delete(setterInfo.targetVar);
              }
            }
          }
        }
      }

      // --- External guess ---
      if (stateSetterMatch && !stateSetters.has(stateSetterMatch[1]) && externalGuesses) {
        const extCallName = stateSetterMatch[1];
        const extArg = stateSetterMatch[2];

        if (!KEYWORDS.has(extCallName) && !KEYWORDS.has(extArg) && /^[A-Z][A-Z_0-9]+$/.test(extArg) && stateVars.size > 0 && extPattern.test(extCallName)) {
          const calleeExists = allFunctions.some(f => f.name === extCallName);
          if (!calleeExists) {
            externalGuesses.add(extCallName);
            const firstStateVar = [...stateVars][0];
            if (!firstStateVar) continue;

            const compatible = this._isArgCompatible(firstStateVar, extArg, extraStates, lastValue);
            if (!compatible) continue;

            const prev = lastValue.get(firstStateVar);
            const next = extArg;
            lastValue.set(firstStateVar, next);
            if (prev !== next) {
              const trigger = this._extractTrigger(line, prevLine);
              if (prev === undefined) {
                transitions.push({
                  toState: next,
                  isInitial: true,
                  triggerFunction: callerName || funcName,
                  sourceFunction: funcName,
                  confidence: 'medium',
                  sourceLocation: { line: lineIdx + 1 },
                  variable: firstStateVar,
                  triggerCondition: trigger,
                });
              } else {
                transitions.push({
                  fromState: prev,
                  toState: next,
                  triggerFunction: callerName || funcName,
                  sourceFunction: funcName,
                  confidence: 'medium',
                  sourceLocation: { line: lineIdx + 1 },
                  variable: firstStateVar,
                  triggerCondition: trigger,
                });
              }

              if (caseFallbacks && caseFallbacks.has(firstStateVar)) {
                for (const fbVal of caseFallbacks.get(firstStateVar)) {
                  if (fbVal !== next) {
                    transitions.push({
                      fromState: fbVal,
                      toState: next,
                      triggerFunction: callerName || funcName,
                      sourceFunction: funcName,
                      confidence: 'medium',
                      sourceLocation: { line: lineIdx + 1 },
                      variable: firstStateVar,
                      triggerCondition: trigger,
                    });
                  }
                }
                caseFallbacks.delete(firstStateVar);
              }
            }
          }
        }
      }

      // --- Direct assignment ---
      const re = new RegExp(ASSIGN_RE.source, 'g');
      let m;
      while ((m = re.exec(line)) !== null) {
        const afterMatch = line.substring(m.index + m[0].length).trimLeft();
        if (afterMatch.startsWith('(')) continue;
        const key = m[1] ? m[1] + '.' + m[2] : m[2];
        if (stateVars.has(key)) {
          const prev = lastValue.get(key);
          let next = m[3];
          if (argMap && argMap[next] !== undefined) {
            next = argMap[next];
          }
          lastValue.set(key, next);
          if (savedBranchEndsList.length > 0) {
            savedBranchEndsList[savedBranchEndsList.length - 1].chainModVars.add(key);
          }
          if (prev === next) continue;
          const trigger = this._extractTrigger(line, prevLine);

          let merged = false;
          if (branchEndVals && branchEndVals.has(key) && !inElseBranch) {
            for (const branchVal of branchEndVals.get(key)) {
              if (branchVal === next) continue;
              transitions.push({
                fromState: branchVal,
                toState: next,
                triggerFunction: callerName || funcName,
                sourceFunction: funcName,
                confidence: 'high',
                sourceLocation: { line: lineIdx + 1 },
                variable: key,
                triggerCondition: trigger,
              });
              if (branchVal === prev) merged = true;
            }
            if (ifChainDepth >= 0 && effectiveDepth <= ifChainDepth) branchEndVals.delete(key);
          }

          if (merged) continue;

          if (prev === undefined) {
            transitions.push({
              toState: next,
              isInitial: true,
              triggerFunction: callerName || funcName,
              sourceFunction: funcName,
              confidence: 'high',
              sourceLocation: { line: lineIdx + 1 },
              variable: key,
              triggerCondition: trigger,
            });
          } else {
            transitions.push({
              fromState: prev,
              toState: next,
              triggerFunction: callerName || funcName,
              sourceFunction: funcName,
              confidence: 'high',
              sourceLocation: { line: lineIdx + 1 },
              variable: key,
              triggerCondition: trigger,
            });
          }

          if (caseFallbacks && caseFallbacks.has(key)) {
            for (const fbVal of caseFallbacks.get(key)) {
              if (fbVal !== next) {
                transitions.push({
                  fromState: fbVal,
                  toState: next,
                  triggerFunction: callerName || funcName,
                  sourceFunction: funcName,
                  confidence: 'high',
                  sourceLocation: { line: lineIdx + 1 },
                  variable: key,
                  triggerCondition: trigger,
                });
              }
            }
            caseFallbacks.delete(key);
          }
        }
      }

      // --- Callee expansion ---
      if (depthLeft > 1) {
        const CALL_RE = /(\w+)\s*\(/g;
        const reCallLine = new RegExp(CALL_RE.source, 'g');
        let _cm;
        while ((_cm = reCallLine.exec(line)) !== null) {
          const name = _cm[1];
          if (KEYWORDS.has(name) || visited.has(name) || seenCallees.has(name)) continue;
          if (stateSetters.has(name) && name !== funcName) continue;
          seenCallees.add(name);
          const calleeFunc = allFunctions.find(f => f.name === name);
          if (!calleeFunc) continue;
          const calleeBody = calleeFunc.rawBody || calleeFunc.body;
          const callArgs = this._ast.extractCallArgs(line, _cm.index);
          const calleeParams = this._ast.extractFunctionParams(calleeBody);
          const calleeArgMap = {};
          calleeParams.forEach((param, idx) => {
            if (idx < callArgs.length && !KEYWORDS.has(callArgs[idx])) {
              calleeArgMap[param] = callArgs[idx];
            }
          });
          const calleeParentValues = new Map();
          for (const [key, val] of lastValue) {
            if (stateVars.has(key)) calleeParentValues.set(key, val);
          }
          const beforeLen = transitions.length;
          this._gatherTransitions(name, calleeBody, allFunctions, transitions, visited, depthLeft - 1, funcName, stateVars, calleeArgMap, externalGuesses, calleeParentValues, extraStates, language);
          for (let i = beforeLen; i < transitions.length; i++) {
            const t = transitions[i];
            if (t.variable && stateVars.has(t.variable) && t.toState !== undefined && !t.isInitial) {
              lastValue.set(t.variable, t.toState);
            }
          }
        }
      }

      // Brace-less if handling
      if (branchEndVals && preIfSnapshot !== null && isIf && !trimmed.includes('{') && ifChainDepth >= 0 && effectiveDepth === ifChainDepth && savedBranchEndsList.length > 0 && lineIdx < lines.length - 1 && !_isPython && !trimmed.endsWith(':')) {
        const nextLine = lines[lineIdx + 1].trim();
        const nextIsElse = /^\s*\}\s*else\s*\{/.test(nextLine) || /^\s*else\s*:/.test(nextLine) || /^\s*else\s*\{/.test(nextLine);
        const nextIsElseIf = /^\s*else\s+if\b/.test(nextLine) || /^\s*elif\s+/.test(nextLine);
        if (!nextIsElse && !nextIsElseIf) {
          if (preIfSnapshot) {
            for (const [key, val] of lastValue) {
              if (stateVars.has(key) && preIfSnapshot.has(key) && preIfSnapshot.get(key) !== val) {
                if (!branchEndVals.has(key)) branchEndVals.set(key, new Set());
                branchEndVals.get(key).add(val);
                if (!hasElseClause) {
                  branchEndVals.get(key).add(preIfSnapshot.get(key));
                }
              }
            }
          }
          if (savedBranchEndsList.length > 0) {
            const { prevBranchEndVals, chainModVars } = savedBranchEndsList.pop();
            if (prevBranchEndVals) {
              for (const [key, vals] of prevBranchEndVals) {
                if (!chainModVars.has(key)) {
                  if (!branchEndVals.has(key)) branchEndVals.set(key, new Set());
                  for (const v of vals) branchEndVals.get(key).add(v);
                }
              }
            }
          }
          inElseBranch = false;
          hasElseClause = false;
          preIfSnapshot = null;
          ifChainDepth = -1;
        }
      }
    }
  }

  _varValues = null;
}

module.exports = StateAnalyzer;
