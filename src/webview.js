function getWebviewHtml(extensionVersion) {
    return `
        <html>
        <head>
        <style>
            :root {
                --bg-primary: #1e1e1e;
                --bg-secondary: #252526;
                --bg-tertiary: #2d2d2d;
                --bg-hover: #333333;
                --bg-active: #37373d;
                --text-primary: #e0e0e0;
                --text-secondary: #969696;
                --text-muted: #6e6e6e;
                --accent: #4fc3f7;
                --accent-hover: #29b6f6;
                --accent-dim: rgba(79, 195, 247, 0.15);
                --border: #3c3c3c;
                --success: #4caf50;
                --warning: #ff9800;
                --error: #f44336;
                --radius: 8px;
                --radius-sm: 4px;
                --shadow: 0 2px 8px rgba(0,0,0,0.3);
            }

            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }

            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
                background: var(--bg-primary);
                color: var(--text-primary);
                font-size: 13px;
                line-height: 1.5;
                overflow-x: hidden;
            }

            .welcome {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 32px 20px;
                text-align: center;
                min-height: 300px;
            }

            .welcome-icon {
                font-size: 48px;
                margin-bottom: 16px;
                opacity: 0.6;
            }

            .welcome h2 {
                font-size: 18px;
                font-weight: 600;
                color: var(--text-primary);
                margin-bottom: 8px;
            }

            .welcome p {
                color: var(--text-secondary);
                font-size: 13px;
                max-width: 280px;
                line-height: 1.6;
            }

            .welcome-steps {
                margin-top: 24px;
                text-align: left;
                width: 100%;
                max-width: 280px;
            }

            .welcome-step {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 10px 12px;
                background: var(--bg-tertiary);
                border-radius: var(--radius);
                margin-bottom: 8px;
                border: 1px solid var(--border);
            }

            .welcome-step .step-num {
                width: 22px;
                height: 22px;
                border-radius: 50%;
                background: var(--accent-dim);
                color: var(--accent);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 11px;
                font-weight: 700;
                flex-shrink: 0;
            }

            .welcome-step .step-text {
                color: var(--text-secondary);
                font-size: 12px;
                line-height: 1.5;
            }

            .welcome-step .step-text strong {
                color: var(--text-primary);
            }

            .header {
                padding: 6px 12px;
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                border-bottom: 1px solid var(--border);
                background: var(--bg-secondary);
            }

            .header-title {
                font-size: 13px;
                font-weight: 600;
                color: var(--text-primary);
                white-space: nowrap;
                display: flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
            }

            .header-title .badge {
                font-size: 9px;
                background: var(--accent-dim);
                color: var(--accent);
                padding: 1px 6px;
                border-radius: 10px;
                font-weight: 500;
            }

            .header-stats {
                flex: 1 1 80px;
                min-width: 0;
                text-align: center;
                font-size: 10px;
                color: var(--text-muted);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .header-actions {
                display: flex;
                gap: 4px;
                /* Package/project/settings buttons are fixed-size and were
                   previously allowed to shrink like any other flex item —
                   with no wrapping, a narrow sidebar just pushed them past the
                   panel's edge instead of shrinking (fixed-width buttons can't
                   actually get smaller), so they went out of view entirely.
                   flex-shrink:0 plus the .header's own flex-wrap now drops
                   this whole group onto its own row once space runs out. */
                flex-shrink: 0;
            }

            .header-actions button {
                background: none;
                border: 1px solid var(--border);
                color: var(--text-secondary);
                width: 26px;
                height: 26px;
                border-radius: var(--radius-sm);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 14px;
                transition: all 0.15s ease;
            }

            .header-actions button:hover {
                background: var(--bg-hover);
                color: var(--text-primary);
                border-color: var(--accent);
            }

            .function-bar {
                padding: 8px 12px;
                border-bottom: 1px solid var(--border);
            }

            .function-select {
                width: 100%;
                background: var(--bg-tertiary);
                color: var(--text-primary);
                border: 1px solid var(--border);
                border-radius: var(--radius);
                padding: 6px 10px;
                font-size: 12px;
                font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
                cursor: pointer;
                outline: none;
                transition: border-color 0.15s ease;
                appearance: none;
                -webkit-appearance: none;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23969696' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
                background-repeat: no-repeat;
                background-position: right 8px center;
                padding-right: 28px;
            }

            .function-select:focus {
                border-color: var(--accent);
            }

            .function-select option {
                background: var(--bg-secondary);
                color: var(--text-primary);
            }

            .tabs {
                display: flex;
                gap: 2px;
                padding: 8px 12px;
                background: var(--bg-secondary);
                border-bottom: 1px solid var(--border);
            }

            .mode-tabs {
                display: flex;
                justify-content: center;
                gap: 2px;
                padding: 6px 12px;
                background: var(--bg-secondary);
                border-bottom: 1px solid var(--border);
            }

            .mode-tabs .tab {
                flex: 1;
                padding: 3px 12px;
                text-align: center;
                font-size: 10px;
                font-weight: 600;
                color: var(--text-muted);
                background: transparent;
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                cursor: pointer;
                transition: all 0.15s ease;
                position: relative;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }

            .mode-tabs .tab:hover {
                color: var(--text-secondary);
                background: var(--bg-hover);
            }

            .mode-tabs .tab.active {
                color: var(--accent);
                background: var(--accent-dim);
                border-color: var(--accent);
            }

            .mode-tabs .tab.active::after {
                display: none;
            }

            .tab {
                flex: 1;
                padding: 5px 8px;
                text-align: center;
                font-size: 11px;
                font-weight: 500;
                color: var(--text-muted);
                background: transparent;
                border: none;
                border-radius: var(--radius-sm);
                cursor: pointer;
                transition: all 0.15s ease;
                position: relative;
            }

            .tab:hover {
                color: var(--text-secondary);
                background: var(--bg-hover);
            }

            .tab.active {
                color: var(--accent);
                background: var(--accent-dim);
            }

            .tab.active::after {
                content: '';
                position: absolute;
                bottom: -8px;
                left: 50%;
                transform: translateX(-50%);
                width: 20px;
                height: 2px;
                background: var(--accent);
                border-radius: 1px;
            }

            .diagram-container {
                padding: 12px;
            }

            .diagram-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 8px;
            }

            .state-var-selector {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 10px;
                padding: 6px 10px;
                background: var(--bg-secondary);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
            }

            .state-var-selector .selector-label {
                font-size: 11px;
                color: var(--text-muted);
                font-weight: 500;
            }

            .state-var-selector .selector-pills {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }

            .state-var-selector .pill {
                background: var(--bg-tertiary);
                border: 1px solid var(--border);
                color: var(--text-secondary);
                padding: 2px 8px;
                border-radius: 12px;
                cursor: pointer;
                font-size: 10px;
                transition: all 0.15s ease;
                outline: none;
            }

            .state-var-selector .pill:hover {
                background: var(--bg-hover);
                color: var(--text-primary);
                border-color: var(--accent);
            }

            .state-var-selector .pill.active {
                background: var(--accent);
                color: #1e1e1e;
                border-color: var(--accent);
                font-weight: 600;
            }

            .diagram-title {
                font-size: 12px;
                font-weight: 500;
                color: var(--text-secondary);
                font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
            }

            .diagram-title .func-name {
                color: var(--accent);
            }

            .diagram-actions {
                display: flex;
                gap: 4px;
            }

            .diagram-actions button {
                background: var(--bg-tertiary);
                border: 1px solid var(--border);
                color: var(--text-secondary);
                padding: 3px 8px;
                border-radius: var(--radius-sm);
                cursor: pointer;
                font-size: 10px;
                transition: all 0.15s ease;
            }

            .diagram-actions button:hover {
                background: var(--bg-hover);
                color: var(--text-primary);
                border-color: var(--accent);
            }

            .diagram-view {
                background: white;
                border-radius: var(--radius);
                overflow: auto;
                box-shadow: var(--shadow);
                min-height: 100px;
                display: flex;
                justify-content: center;
                align-items: flex-start;
                position: relative;
                transition: opacity 0.1s ease-in-out;
            }

            .diagram-view.loading {
                opacity: 0.7;
            }

            .diagram-view svg {
                display: block;
                max-width: 100%;
                height: auto;
            }

            .mermaid svg text {
                font-size: 13px !important;
            }
            .mermaid .classGroup rect {
                rx: 4px !important;
            }
            .mermaid .label {
                font-size: 13px !important;
            }
            .mermaid .edgeLabel {
                font-size: 11px !important;
            }
            .mermaid .node rect,
            .mermaid .node ellipse,
            .mermaid .node circle,
            .mermaid .node polygon {
                stroke-width: 1.5px !important;
            }
            .mermaid .flowchart-link {
                stroke-width: 1.5px !important;
            }

            .loading-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 40px 20px;
                gap: 12px;
            }

            .spinner {
                width: 28px;
                height: 28px;
                border: 3px solid var(--border);
                border-top-color: var(--accent);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            .loading-text {
                color: var(--text-muted);
                font-size: 12px;
            }

            .error-state {
                padding: 20px;
                text-align: center;
                color: var(--error);
                font-size: 12px;
                background: rgba(244, 67, 54, 0.08);
                border-radius: var(--radius);
                border: 1px solid rgba(244, 67, 54, 0.2);
            }

            .empty-state {
                padding: 40px 20px;
                text-align: center;
                color: var(--text-muted);
                font-size: 12px;
            }

            .empty-state .empty-icon {
                font-size: 32px;
                margin-bottom: 8px;
                opacity: 0.5;
            }

            .code-section {
                margin-top: 12px;
                border: 1px solid var(--border);
                border-radius: var(--radius);
                overflow: hidden;
                resize: vertical;
                display: flex;
                flex-direction: column;
                height: 200px;
                min-height: 60px;
            }

            .code-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 10px;
                background: var(--bg-tertiary);
                border-bottom: 1px solid var(--border);
                font-size: 11px;
                color: var(--text-muted);
                flex-shrink: 0;
            }

            .code-header button {
                background: none;
                border: 1px solid var(--border);
                color: var(--text-secondary);
                padding: 2px 8px;
                border-radius: var(--radius-sm);
                cursor: pointer;
                font-size: 10px;
                transition: all 0.15s ease;
            }

            .code-header button:hover {
                background: var(--bg-hover);
                color: var(--text-primary);
            }

            .code-content {
                background: #1a1a2e;
                padding: 10px;
                font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
                font-size: 11px;
                line-height: 1.6;
                color: #a0a0c0;
                overflow: auto;
                white-space: pre;
                flex: 1;
                min-height: 0;
            }

            .status-bar {
                padding: 6px 12px;
                border-top: 1px solid var(--border);
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 10px;
                color: var(--text-muted);
            }

            .status-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: var(--success);
                flex-shrink: 0;
            }

            .status-dot.loading {
                background: var(--warning);
                animation: pulse 1s ease-in-out infinite;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.4; }
            }

            .status-dot.error {
                background: var(--error);
            }

            ::-webkit-scrollbar {
                width: 6px;
                height: 6px;
            }

            ::-webkit-scrollbar-track {
                background: transparent;
            }

            ::-webkit-scrollbar-thumb {
                background: var(--border);
                border-radius: 3px;
            }

            ::-webkit-scrollbar-thumb:hover {
                background: var(--text-muted);
            }

            .settings-panel {
                padding: 12px;
                border-bottom: 1px solid var(--border);
                background: var(--bg-secondary);
            }

            .settings-panel .settings-title {
                font-size: 12px;
                font-weight: 600;
                color: var(--text-primary);
                margin-bottom: 12px;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            .settings-panel .settings-title button {
                background: none;
                border: 1px solid var(--border);
                color: var(--text-secondary);
                width: 22px;
                height: 22px;
                border-radius: var(--radius-sm);
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 12px;
                transition: all 0.15s ease;
            }

            .settings-panel .settings-title button:hover {
                background: var(--bg-hover);
                color: var(--text-primary);
                border-color: var(--accent);
            }

            .setting-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid var(--border);
            }

            .setting-row:last-child {
                border-bottom: none;
            }

            .setting-label {
                font-size: 12px;
                color: var(--text-primary);
                flex: 1;
            }

            .setting-desc {
                font-size: 10px;
                color: var(--text-muted);
                margin-top: 2px;
            }

            .setting-input {
                background: var(--bg-tertiary);
                color: var(--text-primary);
                border: 1px solid var(--border);
                border-radius: var(--radius-sm);
                padding: 4px 8px;
                font-size: 11px;
                width: 80px;
                text-align: center;
                outline: none;
                transition: border-color 0.15s ease;
            }

            .setting-input:focus {
                border-color: var(--accent);
            }

            .setting-input.wide {
                width: 160px;
                text-align: left;
                font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
                font-size: 10px;
            }

            .toggle-switch {
                position: relative;
                width: 36px;
                height: 20px;
                flex-shrink: 0;
            }

            .toggle-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }

            .toggle-slider {
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: var(--bg-tertiary);
                border: 1px solid var(--border);
                border-radius: 20px;
                transition: all 0.2s ease;
            }

            .toggle-slider:before {
                content: '';
                position: absolute;
                height: 14px;
                width: 14px;
                left: 2px;
                bottom: 2px;
                background: var(--text-muted);
                border-radius: 50%;
                transition: all 0.2s ease;
            }

            .toggle-switch input:checked + .toggle-slider {
                background: var(--accent-dim);
                border-color: var(--accent);
            }

            .toggle-switch input:checked + .toggle-slider:before {
                transform: translateX(16px);
                background: var(--accent);
            }

            .settings-actions {
                display: flex;
                gap: 8px;
                margin-top: 12px;
                padding-top: 8px;
                border-top: 1px solid var(--border);
            }

            .settings-actions button {
                flex: 1;
                padding: 6px 12px;
                border-radius: var(--radius-sm);
                cursor: pointer;
                font-size: 11px;
                font-weight: 500;
                transition: all 0.15s ease;
                border: 1px solid var(--border);
            }

            .btn-save {
                background: var(--accent);
                color: #1e1e1e;
                border-color: var(--accent) !important;
            }

            .btn-save:hover {
                background: var(--accent-hover);
            }

            .btn-cancel {
                background: var(--bg-tertiary);
                color: var(--text-secondary);
            }

            .btn-cancel:hover {
                background: var(--bg-hover);
                color: var(--text-primary);
            }

            .settings-saved-msg {
                text-align: center;
                padding: 8px;
                font-size: 11px;
                color: var(--success);
                animation: fadeIn 0.2s ease;
            }

            .fade-in {
                animation: fadeIn 0.2s ease;
            }

            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(4px); }
                to { opacity: 1; transform: translateY(0); }
            }

            /* --- Project diagram code editor --- */
            .project-editor {
                display: flex;
                flex-direction: column;
                height: 100vh;
            }

            .project-editor-scope {
                padding: 6px 12px;
                font-size: 11px;
                color: var(--text-secondary);
                border-bottom: 1px solid var(--border);
                display: flex;
                align-items: center;
                gap: 8px;
                flex-shrink: 0;
            }

            .project-editor-custom-flag {
                font-size: 9px;
                background: var(--accent-dim);
                color: var(--accent);
                padding: 1px 6px;
                border-radius: 10px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.04em;
            }

            .project-editor-toolbar {
                display: flex;
                gap: 6px;
                padding: 8px 12px;
                border-bottom: 1px solid var(--border);
                background: var(--bg-secondary);
                flex-shrink: 0;
            }

            .project-editor-toolbar button {
                flex: 1;
                background: var(--bg-tertiary);
                border: 1px solid var(--border);
                color: var(--text-secondary);
                padding: 6px 8px;
                border-radius: var(--radius-sm);
                cursor: pointer;
                font-size: 11px;
                font-weight: 600;
                transition: all 0.15s ease;
            }

            .project-editor-toolbar button:hover:not(:disabled) {
                background: var(--bg-hover);
                color: var(--text-primary);
                border-color: var(--accent);
            }

            .project-editor-toolbar button:disabled {
                opacity: 0.4;
                cursor: default;
            }

            .project-editor-toolbar button.primary:not(:disabled) {
                background: var(--accent-dim);
                color: var(--accent);
                border-color: var(--accent);
            }

            .code-editor-wrap {
                position: relative;
                flex: 1;
                min-height: 0;
                background: #1a1a2e;
                overflow: hidden;
            }

            .code-editor-highlight,
            .code-editor-input {
                position: absolute;
                inset: 0;
                margin: 0;
                padding: 10px;
                border: none;
                font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
                font-size: 11px;
                line-height: 1.6;
                white-space: pre;
                overflow: auto;
                tab-size: 4;
            }

            .code-editor-highlight {
                color: #a0a0c0;
                pointer-events: none;
            }

            .code-editor-input {
                background: transparent;
                color: transparent;
                caret-color: #e0e0e0;
                resize: none;
                outline: none;
            }

            .code-editor-input::selection {
                background: rgba(79, 195, 247, 0.35);
            }

            .tok-keyword { color: #4fc3f7; font-weight: 600; }
            .tok-string { color: #ce9178; }
            .tok-comment { color: #6e6e6e; font-style: italic; }
            .tok-arrow { color: #ff9800; }

            .project-editor-status {
                padding: 6px 12px;
                border-top: 1px solid var(--border);
                font-size: 10px;
                color: var(--text-muted);
                flex-shrink: 0;
            }
        </style>
        </head>
        <body>
            <div id="app"></div>
            <script src="https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js"></script>
            <script>
                mermaid.initialize({
                    startOnLoad: false,
                    theme: 'default',
                    themeVariables: {
                        primaryColor: '#E8F4FD',
                        primaryTextColor: '#1a1a2e',
                        primaryBorderColor: '#2980b9',
                        lineColor: '#2980b9',
                        secondaryColor: '#FFF3CD',
                        tertiaryColor: '#FEFEFE',
                        fontSize: '13px'
                    },
                    flowchart: { useMaxWidth: true, htmlLabels: true },
                    sequence: { useMaxWidth: true, showSequenceNumbers: false },
                    class: { useMaxWidth: true },
                    state: { useMaxWidth: true }
                });

                const vscode = acquireVsCodeApi();
                function verboseLog(...args) {
                    if (state && state.verbose) {
                        console.log('[LiveUML]', ...args);
                    }
                }
                let state = {
                    functions: [],
                    classes: [],
                    currentFunction: null,
                    currentClass: null,
                    diagramType: 'flowchart',
                    diagramMode: 'plantuml',
                    diagramSvg: null,
                    plantUmlCode: null,
                    mermaidCode: null,
                    renderedMermaidSvg: null,
                    lastRequestId: 0,
                    isLoading: false,
                    hasEditor: true,
                    error: null,
                    showSettings: false,
                    scopeWarning: false,
                    externalGuesses: [],
                    stateVars: [],
                    activeStateVar: null,
                    stats: { totalFiles: 0, totalClasses: 0, language: '' },
                    verbose: false,
                    settings: {
                        javaPath: 'java',
                        classExcludePatterns: 'node_modules, build, bin, dist, target'
                    },
                    // Project diagram editor (active while a Live Uml Evo project/package
                    // panel is the focused editor tab). projectDraftCode is whatever's
                    // in the textarea right now (typed but maybe not applied);
                    // projectLastAppliedCode is what Discard reverts to. The two being
                    // equal is how the extension's incoming syncs decide it's safe to
                    // overwrite the draft (see the 'projectEditMode'/'projectDiagramSync'
                    // handlers below) — it means there's nothing unsaved to lose.
                    projectEditMode: false,
                    projectDiagramMode: 'plantuml',
                    projectScopeLabel: '',
                    projectIsCustom: false,
                    projectDraftCode: '',
                    projectLastAppliedCode: '',
                    projectScopeFolder: null,
                    projectPackages: []
                };

                const savedState = vscode.getState();
                if (savedState) {
                    state = { ...state, ...savedState };
                }
                // The extension's request counter starts at 1 on every new
                // session, but the persisted lastRequestId can be higher (from a
                // previous session). Without resetting it, every incoming
                // diagram/loading message would look "stale" (reqId <
                // lastRequestId) and be ignored — leaving the panel frozen on the
                // last cached diagram after a VS Code restart. Reset the
                // per-session sequencing state so fresh messages are accepted.
                state.lastRequestId = 0;
                state.isLoading = false;
                // Whether a project panel is focused is something only the extension
                // knows right now, fresh — a value restored from a previous session
                // would show an editor with no panel behind it. It re-announces the
                // real state shortly after activation if a project panel is still open.
                state.projectEditMode = false;

                window.addEventListener('message', e => {
                    const msg = e.data;
                    verboseLog('message received:', msg.type, msg);
                    switch (msg.type) {
                        case 'update': {
                            // The render decision is based purely on whether this update
                            // actually changes the panel's *shape* — never on which
                            // backend code path triggered it. That one rule is what makes
                            // file switches, clicking a class link in the diagram to
                            // navigate, and plain cursor moves all patch in place instead
                            // of tearing down the whole panel: none of them change the
                            // shape unless the language/available-items truly did.
                            const hadShell = !!document.getElementById('diagramContainer');
                            const hadItems = Array.isArray(state.functions) && state.functions.length > 0 || Array.isArray(state.classes) && state.classes.length > 0;
                            const willHaveItems = Array.isArray(msg.functions) && msg.functions.length > 0 || Array.isArray(msg.classes) && msg.classes.length > 0;
                            const structural = !hadShell || !state.hasEditor || (hadItems !== willHaveItems) || (msg.diagramType && msg.diagramType !== state.diagramType) || (msg.diagramMode && msg.diagramMode !== state.diagramMode);

                            state.functions = msg.functions;
                            state.classes = msg.classes || [];
                            state.currentFunction = msg.currentFunction;
                            state.currentClass = msg.currentClass;
                            state.stats = msg.stats || state.stats;
                            state.diagramType = msg.diagramType || state.diagramType;
                            state.diagramMode = msg.diagramMode || state.diagramMode;
                            state.verbose = msg.verbose || false;
                            state.hasEditor = true;
                            state.error = null;
                            verboseLog('state updated:', state.currentFunction, state.currentClass);
                            // While Settings is open, a background structural update would
                            // otherwise blow away whatever the user is mid-typing into the
                            // Java Path / Exclude Dirs fields (a full render rebuilds that
                            // panel's <input>s from the last-saved values). Defer it — the
                            // state above is already current, so closing Settings renders
                            // correctly either way.
                            if (state.showSettings && structural) {
                                state.pendingStructuralRender = true;
                            } else if (structural || state.pendingStructuralRender) {
                                state.pendingStructuralRender = false;
                                render();
                            } else {
                                updateChrome();
                            }
                            vscode.setState(state);
                            break;
                        }
                        case 'navUpdate': break;
                        case 'projectEditMode': {
                            if (!msg.active) {
                                verboseLog('projectEditMode: off');
                                state.projectEditMode = false;
                                render();
                                vscode.setState(state);
                                break;
                            }
                            verboseLog('projectEditMode: on, isCustom=' + msg.isCustom);
                            state.projectEditMode = true;
                            state.projectScopeLabel = msg.scopeLabel || '';
                            state.projectScopeFolder = msg.scopeFolder || null;
                            state.projectPackages = msg.packages || [];
                            state.projectIsCustom = !!msg.isCustom;
                            // Only load the panel's code over whatever's already in the
                            // editor if there's nothing unsaved there to lose — otherwise
                            // stepping away to another tab and back would silently wipe
                            // an in-progress edit.
                            const noLocalDraft = state.projectDraftCode === state.projectLastAppliedCode;
                            if (noLocalDraft) {
                                state.projectDiagramMode = msg.diagramMode || 'plantuml';
                                state.projectDraftCode = msg.code || '';
                                state.projectLastAppliedCode = msg.isCustom ? (msg.code || '') : '';
                            }
                            render();
                            vscode.setState(state);
                            break;
                        }
                        case 'projectDiagramSync': {
                            // A one-way mirror of the panel's live, auto-generated
                            // diagram — only applied while the editor is genuinely idle
                            // (no unsaved draft, no active override), so it can never
                            // clobber something the person is mid-editing.
                            if (!state.projectEditMode || state.projectIsCustom) break;
                            const noLocalDraft = state.projectDraftCode === state.projectLastAppliedCode;
                            if (!noLocalDraft) break;
                            verboseLog('projectDiagramSync: refreshing idle editor from source');
                            state.projectDiagramMode = msg.diagramMode || state.projectDiagramMode;
                            state.projectDraftCode = msg.code || '';
                            state.projectLastAppliedCode = '';
                            updateProjectEditor();
                            vscode.setState(state);
                            break;
                        }
                        case 'projectDiagramLoaded':
                            // Loaded content lands in the draft, same as typing it in —
                            // it still needs Apply to actually take effect on the panel.
                            verboseLog('projectDiagramLoaded');
                            state.projectDiagramMode = msg.diagramMode || state.projectDiagramMode;
                            state.projectDraftCode = msg.code || '';
                            render();
                            vscode.setState(state);
                            break;
                        case 'noEditor':
                            verboseLog('no editor, resetting state');
                            state.hasEditor = false;
                            state.functions = [];
                            state.classes = [];
                            state.currentFunction = null;
                            state.currentClass = null;
                            state.diagramSvg = null;
                            state.plantUmlCode = null;
                            state.mermaidCode = null;
                            state.renderedMermaidSvg = null;
                            state.lastRequestId = 0;
                            state.isLoading = false;
                            state.error = null;
                            state.stateVars = [];
                            state.activeStateVar = null;
                            render();
                            vscode.setState(state);
                            break;
                        case 'loading': {
                            const loadReqId = msg.requestId || 0;
                            verboseLog('loading: requestId=' + loadReqId + ', lastRequestId=' + state.lastRequestId);
                            // requestId ordering alone isn't enough: a slow class-diagram
                            // request can finish after the user has already switched to
                            // Flowchart and back, with nothing newer in between to bump
                            // lastRequestId past it. Checking the message's own diagram
                            // type against what's currently selected catches that case
                            // directly, regardless of timing.
                            if (loadReqId < (state.lastRequestId || 0) || (msg.diagramType && msg.diagramType !== state.diagramType)) {
                                verboseLog('loading: stale or mismatched-type request, ignoring');
                                break;
                            }
                            state.lastRequestId = loadReqId;
                            state.isLoading = true;
                            state.error = null;
                            state.stateVars = [];
                            state.activeStateVar = null;
                            updateDiagramContainer();
                            break;
                        }
                        case 'diagram': {
                            const reqId = msg.requestId || 0;
                            verboseLog('diagram: requestId=' + reqId + ', lastRequestId=' + state.lastRequestId + ', svg.length=' + (msg.svg ? msg.svg.length : 0) + ', mermaidCode.length=' + (msg.mermaidCode ? msg.mermaidCode.length : 0));
                            if (reqId < (state.lastRequestId || 0) || (msg.diagramType && msg.diagramType !== state.diagramType)) {
                                verboseLog('diagram: stale or mismatched-type request, ignoring');
                                break;
                            }
                            state.lastRequestId = reqId;
                            state.isLoading = false;
                            state.diagramSvg = msg.svg;
                            state.plantUmlCode = msg.plantUml;
                            state.mermaidCode = msg.mermaidCode;
                            state.diagramMode = msg.diagramMode || state.diagramMode;
                            state.error = null;
                            state.scopeWarning = msg.scopeWarning || false;
                            state.externalGuesses = msg.externalGuesses || [];
                            state.stateVars = msg.stateVars || [];
                            state.activeStateVar = msg.activeStateVar || null;
                            if (msg.classCount !== undefined && state.diagramType === 'class') {
                                state.stats.totalClasses = msg.classCount;
                            }

                            if (state.diagramMode === 'mermaid' && msg.mermaidCode) {
                                verboseLog('diagram: rendering mermaid...');
                                const uniqueId = 'mermaid-' + reqId;
                                mermaid.render(uniqueId, msg.mermaidCode)
                                    .then(({ svg }) => {
                                        if (reqId < (state.lastRequestId || 0) || (msg.diagramType && msg.diagramType !== state.diagramType)) {
                                            verboseLog('mermaid render: stale or mismatched-type, ignoring');
                                            return;
                                        }
                                        verboseLog('mermaid render: success, svg.length=' + svg.length);
                                        state.renderedMermaidSvg = svg;
                                        updateDiagramContainer();
                                        vscode.setState(state);
                                    })
                                    .catch(err => {
                                        if (reqId < (state.lastRequestId || 0) || (msg.diagramType && msg.diagramType !== state.diagramType)) {
                                            verboseLog('mermaid render error (stale or mismatched-type):', err.message);
                                            return;
                                        }
                                        verboseLog('mermaid render error:', err.message);
                                        console.error('Mermaid render error:', err);
                                        state.renderedMermaidSvg = null;
                                        state.error = err.message || 'Mermaid parsing error';
                                        updateDiagramContainer();
                                        vscode.setState(state);
                                    });
                            } else {
                                verboseLog('diagram: no mermaid, rendering SVG directly');
                                state.renderedMermaidSvg = null;
                                updateDiagramContainer();
                                vscode.setState(state);
                            }
                            break;
                        }
                        case 'error': {
                            const errReqId = msg.requestId || 0;
                            if (errReqId < (state.lastRequestId || 0) || (msg.diagramType && msg.diagramType !== state.diagramType)) {
                                verboseLog('error: stale or mismatched-type, ignoring:', msg.message);
                                break;
                            }
                            verboseLog('error:', msg.message);
                            state.lastRequestId = errReqId || state.lastRequestId;
                            state.isLoading = false;
                            state.error = msg.message;
                            updateDiagramContainer();
                            break;
                        }
                        case 'showSettings':
                            verboseLog('showSettings');
                            state.showSettings = true;
                            state.settings = msg.settings;
                            render();
                            break;
                        case 'settingsSaved':
                            verboseLog('settingsSaved');
                            state.showSettings = false;
                            render();
                            break;
                    }
                });

                function render() {
                    const app = document.getElementById('app');
                    verboseLog('render(): isLoading=' + state.isLoading + ', hasEditor=' + state.hasEditor + ', functions.length=' + (state.functions ? state.functions.length : 0) + ', classes.length=' + (state.classes ? state.classes.length : 0) + ', error=' + (state.error || 'null') + ', hasSvg=' + (state.diagramSvg ? 'yes' : 'no') + ', mermaidCode=' + (state.mermaidCode ? 'yes' : 'no') + ', renderedMermaid=' + (state.renderedMermaidSvg ? 'yes' : 'no'));
                    if (state.projectEditMode) {
                        app.innerHTML = renderProjectEditor();
                        attachProjectEditorEvents();
                    } else if (!state.hasEditor || (Array.isArray(state.functions) && state.functions.length === 0 && Array.isArray(state.classes) && state.classes.length === 0)) {
                        app.innerHTML = renderWelcome();
                    } else {
                        app.innerHTML = renderMain();
                        attachEvents();
                        if (state.diagramMode !== 'mermaid') normalizePlantUmlSvg();
                        if (state.diagramMode === 'mermaid') {
                            if (state.renderedMermaidSvg) {
                                attachMermaidClassClicks();
                            } else if (state.mermaidCode) {
                                setTimeout(() => {
                                    try {
                                        mermaid.run({ nodes: document.querySelectorAll('.mermaid') }).then(() => {
                                            attachMermaidClassClicks();
                                        }).catch(e => {
                                            console.error('Mermaid render error:', e);
                                        });
                                    } catch (e) {
                                        console.error('Mermaid render error:', e);
                                    }
                                }, 50);
                            }
                        }
                    }
                }

                function renderWelcome() {
                    return \`
                        <div class="welcome fade-in">
                            <div class="welcome-icon">📊</div>
                            <h2>Live Uml Evo</h2>
                            <p>Generate real-time UML diagrams from your code as you type.</p>
                            <div class="welcome-steps">
                                <div class="welcome-step">
                                    <span class="step-num">1</span>
                                    <span class="step-text"><strong>Open a file</strong> in any supported language</span>
                                </div>
                                <div class="welcome-step">
                                    <span class="step-num">2</span>
                                    <span class="step-text"><strong>Click on a function</strong> to see its diagram</span>
                                </div>
                                <div class="welcome-step">
                                    <span class="step-num">3</span>
                                    <span class="step-text"><strong>Edit your code</strong> and watch the diagram update live</span>
                                </div>
                            </div>
                            <p style="margin-top: 20px; font-size: 11px; color: var(--text-muted);">
                                Supports: JavaScript, TypeScript, Python, Java, C, C++
                            </p>
                        </div>
                    \`;
                }

                // --- Project diagram code editor ---
                // Shown instead of the normal function/class view whenever a Live Uml Evo
                // project or package panel is the focused editor tab (see the
                // 'projectEditMode' message handler above). A plain textarea with a
                // regex-highlighted <pre> synced behind it — not a real embedded VS
                // Code editor, since that would mean bundling Monaco into the webview.

                function highlightDiagramCode(code, mode) {
    if (!code) return '';
    const isMermaid = mode === 'mermaid';
    const patterns = [
        { cls: 'tok-comment', re: isMermaid ? /%%[^\\n]*/g : /'[^\\n]*/g },
        { cls: 'tok-string', re: /"[^"\\n]*"/g },
        { cls: 'tok-arrow', re: /(<\\|\\.\\.|\\.\\.\\|>|<\\|--|--\\|>|o--|--o|\\*--|--\\*|\\.\\.>|<\\.\\.|-->|<--|--|\\.\\.)/g },
        { cls: 'tok-keyword', re: isMermaid
            ? /\\b(classDiagram|sequenceDiagram|stateDiagram-v2|stateDiagram|flowchart|graph|class|interface|note|as|participant|activate|deactivate|loop|alt|else|opt|par|and|end|direction|TD|LR|TB|RL)\\b/g
            : /(@\\w+)|\\b(class|interface|enum|abstract|package|namespace|note|as|skinparam|hide|show|left|right|top|bottom|of|extends|implements|end|if|else|endif|while|endwhile|partition)\\b/g
        }
    ];
    let out = '';
    let i = 0;
    const len = code.length;
    while (i < len) {
        let best = null;
        for (let p = 0; p < patterns.length; p++) {
            const pat = patterns[p];
            pat.re.lastIndex = i;
            const m = pat.re.exec(code);
            if (m && m.index === i && m[0].length > 0) { best = { cls: pat.cls, text: m[0] }; break; }
        }
        if (best) {
            out += '<span class="' + best.cls + '">' + escapeHtml(best.text) + '</span>';
            i += best.text.length;
        } else {
            out += escapeHtml(code[i]);
            i += 1;
        }
    }
    return out;
}

function renderProjectEditor() {
    const hasUnsavedDraft = state.projectDraftCode !== state.projectLastAppliedCode;
    const modeLabel = state.projectDiagramMode === 'mermaid' ? 'Mermaid' : 'PlantUML';
    const statusText = hasUnsavedDraft
        ? 'Unapplied changes'
        : state.projectIsCustom
            ? 'Showing your custom code'
            : 'Mirroring the live diagram';

    const scopeOptions = ['<option value=""' + (state.projectScopeFolder ? '' : ' selected') + '>Whole Project</option>']
        .concat((state.projectPackages || []).map(function (p) {
            return '<option value="' + escapeHtml(p) + '"' + (p === state.projectScopeFolder ? ' selected' : '') + '>' + escapeHtml(p) + '</option>';
        }))
        .join('');

    return [
        '<div class="project-editor">',
        '<div class="header"><div class="header-title">Live Uml Evo</div>',
        '<div class="header-stats">' + modeLabel + ' \\u00B7 Project Diagram</div></div>',
        '<div class="project-editor-scope">',
        '<select class="function-select" id="projScopeSelect" onchange="changeProjectScope(this.value)">' + scopeOptions + '</select>',
        (state.projectIsCustom ? '<span class="project-editor-custom-flag">custom</span>' : ''),
        '</div>',
        '<div class="project-editor-toolbar">',
        '<button id="projApplyBtn" class="primary" onclick="applyProjectDiagram()" ' + (hasUnsavedDraft ? '' : 'disabled') + '>Apply</button>',
        '<button id="projDiscardBtn" onclick="discardProjectDraft()" ' + (hasUnsavedDraft ? '' : 'disabled') + '>Discard</button>',
        '<button id="projResetBtn" onclick="resetProjectDiagram()" ' + (state.projectIsCustom ? '' : 'disabled') + '>Reset</button>',
        '<button onclick="saveProjectDiagramSource()">Save\\u2026</button>',
        '<button onclick="loadProjectDiagramSource()">Load\\u2026</button>',
        '</div>',
        '<div class="code-editor-wrap"><pre class="code-editor-highlight" id="projEditorHighlight" aria-hidden="true"><code>' + highlightDiagramCode(state.projectDraftCode, state.projectDiagramMode) + '\\n</code></pre><textarea class="code-editor-input" id="projEditorInput" spellcheck="false" wrap="off" oninput="onProjectEditorInput(this.value)" onscroll="syncProjectEditorScroll(this)">' + escapeHtml(state.projectDraftCode) + '</textarea></div>',
        '<div class="project-editor-status" id="projEditorStatus">' + statusText + '</div>',
        '</div>'
    ].join('');
}

// Patches the editor in place on incoming syncs so a live-idle mirror
// update never steals focus or resets scroll/caret position the way a
// full render() would.
function updateProjectEditor() {
    const textarea = document.getElementById('projEditorInput');
    const highlight = document.querySelector('#projEditorHighlight code');
    if (!textarea || !highlight) { render(); return; }
    textarea.value = state.projectDraftCode;
    highlight.innerHTML = highlightDiagramCode(state.projectDraftCode, state.projectDiagramMode) + '\\n';
    refreshProjectEditorToolbar();
}

function refreshProjectEditorToolbar() {
    const hasUnsavedDraft = state.projectDraftCode !== state.projectLastAppliedCode;
    const applyBtn = document.getElementById('projApplyBtn');
    const discardBtn = document.getElementById('projDiscardBtn');
    const resetBtn = document.getElementById('projResetBtn');
    const status = document.getElementById('projEditorStatus');
    if (applyBtn) applyBtn.disabled = !hasUnsavedDraft;
    if (discardBtn) discardBtn.disabled = !hasUnsavedDraft;
    if (resetBtn) resetBtn.disabled = !state.projectIsCustom;
    if (status) {
        status.textContent = hasUnsavedDraft
            ? 'Unapplied changes'
            : state.projectIsCustom
                ? 'Showing your custom code'
                : 'Mirroring the live diagram';
    }
}

function attachProjectEditorEvents() {
    const textarea = document.getElementById('projEditorInput');
    const highlight = document.getElementById('projEditorHighlight');
    if (textarea && highlight) {
        textarea.scrollTop = highlight.scrollTop;
        textarea.scrollLeft = highlight.scrollLeft;
    }
}

function onProjectEditorInput(value) {
    state.projectDraftCode = value;
    const highlight = document.querySelector('#projEditorHighlight code');
    if (highlight) highlight.innerHTML = highlightDiagramCode(value, state.projectDiagramMode) + '\\n';
    refreshProjectEditorToolbar();
    vscode.setState(state);
}

function syncProjectEditorScroll(textarea) {
    const highlight = document.getElementById('projEditorHighlight');
    if (!highlight) return;
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
}

function applyProjectDiagram() {
    if (state.projectDraftCode === state.projectLastAppliedCode) return;
    verboseLog('applyProjectDiagram');
    state.projectLastAppliedCode = state.projectDraftCode;
    state.projectIsCustom = true;
    refreshProjectEditorToolbar();
    vscode.setState(state);
    vscode.postMessage({ type: 'applyProjectDiagram', code: state.projectDraftCode, diagramMode: state.projectDiagramMode });
}

function discardProjectDraft() {
    verboseLog('discardProjectDraft');
    state.projectDraftCode = state.projectLastAppliedCode;
    updateProjectEditor();
    vscode.setState(state);
}

function resetProjectDiagram() {
    verboseLog('resetProjectDiagram');
    state.projectIsCustom = false;
    state.projectDraftCode = '';
    state.projectLastAppliedCode = '';
    vscode.setState(state);
    vscode.postMessage({ type: 'resetProjectDiagram' });
}

function changeProjectScope(value) {
    const scopeFolder = value || null;
    if (scopeFolder === state.projectScopeFolder) return;
    verboseLog('changeProjectScope: ' + scopeFolder);
    // A custom override or unapplied draft was written for the old scope —
    // switching to a different package/whole-project drops it rather than
    // showing stale text next to a diagram it no longer matches. The fresh
    // auto-generated code for the new scope arrives via projectDiagramSync
    // once the extension finishes regenerating.
    state.projectScopeFolder = scopeFolder;
    state.projectIsCustom = false;
    state.projectDraftCode = '';
    state.projectLastAppliedCode = '';
    render();
    vscode.setState(state);
    vscode.postMessage({ type: 'changeProjectScope', scopeFolder: scopeFolder });
}

function saveProjectDiagramSource() {
    vscode.postMessage({ type: 'saveProjectDiagramSource', code: state.projectDraftCode, diagramMode: state.projectDiagramMode });
}

function loadProjectDiagramSource() {
    vscode.postMessage({ type: 'loadProjectDiagramSource' });
}

function renderEmpty() {
                    return \`
                        <div class="empty-state fade-in">
                            <div class="empty-icon">🔍</div>
                            <p>No functions found in this file</p>
                            <p style="margin-top: 4px; font-size: 11px;">Try opening a file with function definitions</p>
                        </div>
                    \`;
                }

                function renderMain() {
                    const funcOptions = state.functions.map(f => 
                        \`<option value="\${f}" \${f === state.currentFunction ? 'selected' : ''}>\${f}</option>\`
                    ).join('');

                    const classOptions = state.classes.map(c => 
                        \`<option value="\${c}" \${c === state.currentClass ? 'selected' : ''}>\${c}</option>\`
                    ).join('');

                    const placeholderOption = (!funcOptions && !classOptions) ? \`
                        <option disabled>No items available</option>
                    \` : '';

                    const select = state.diagramType === 'class' ? 
                        \`<select class="function-select" id="classSelect" onchange="selectClass(this.value)">
                            \${classOptions || placeholderOption}
                        </select>\` :
                        \`<select class="function-select" id="funcSelect" onchange="selectFunction(this.value)">
                            \${funcOptions || placeholderOption}
                        </select>\`;

                    const classTab = state.stats.language !== 'c' ? 
                        \`<button class="tab \${state.diagramType === 'class' ? 'active' : ''}" onclick="changeType('class')">Class</button>\` : '';

                    const isMermaid = state.diagramMode === 'mermaid';
                    const hasDiagram = isMermaid ? (state.renderedMermaidSvg || (state.diagramSvg && state.diagramSvg.includes('empty-state'))) : state.diagramSvg;

                    const diagramContent = state.isLoading ? renderLoading() :
                        state.error ? renderError() :
                        hasDiagram ? renderDiagram() :
                        renderSelectPrompt();

                    const settingsPanel = state.showSettings ? renderSettings() : '';

                    const statusText = state.isLoading ? 'Generating diagram...' :
                        state.error ? 'Error generating diagram' :
                        hasDiagram ? (isMermaid ? 'Mermaid diagram ready' : 'PlantUML diagram ready') :
                        'Select an item';

                    const showStats = state.diagramType === 'class';
                    const statsHtml = showStats
                        ? (state.stats.language === 'c'
                            ? 'Not applicable for C'
                            : 'Workspace: ' + state.stats.totalFiles + ' files \u00B7 Scope: ' + state.stats.totalClasses + ' classes')
                        : '';

                    return \`
                        <div class="header">
                            <div class="header-title">
                                Live Uml Evo
                                <span class="badge">v${extensionVersion}</span>
                            </div>
                            <div class="header-stats" id="headerStats">\${statsHtml}</div>
                            <div class="header-actions">
                                <button onclick="showPackageDiagram()" title="Diagram this package/folder">📦</button>
                                <button onclick="showProjectDiagram()" title="Diagram the whole project">📐</button>
                                <button onclick="toggleSettings()" title="Settings">⚙</button>
                            </div>
                        </div>
                        \${settingsPanel}
                        <div class="mode-tabs" id="modeTabs">
                            <button class="tab \${state.diagramMode === 'plantuml' ? 'active' : ''}" onclick="changeMode('plantuml')">PlantUML</button>
                            <button class="tab \${state.diagramMode === 'mermaid' ? 'active' : ''}" onclick="changeMode('mermaid')">Mermaid</button>
                        </div>
                        <div class="function-bar" id="functionBar">
                            \${select}
                        </div>
                        <div class="tabs" id="typeTabs">
                            <button class="tab \${state.diagramType === 'flowchart' ? 'active' : ''}" onclick="changeType('flowchart')">Flowchart</button>
                            <button class="tab \${state.diagramType === 'sequence' ? 'active' : ''}" onclick="changeType('sequence')">Sequence</button>
                            <button class="tab \${state.diagramType === 'state' ? 'active' : ''}" onclick="changeType('state')">State</button>
                            \${classTab}
                        </div>
                        <div class="diagram-container fade-in" id="diagramContainer">
                            \${diagramContent}
                        </div>
                        <div class="status-bar" id="statusBar">
                            <span class="status-dot \${state.isLoading ? 'loading' : state.error ? 'error' : ''}" id="statusDot"></span>
                            <span id="statusText">\${statusText}</span>
                        </div>
                    \`;
                }

                // Computes the same "what goes in the diagram container" decision
                // renderMain() uses, so updateDiagramContainer() can patch just that
                // node without rebuilding the rest of the panel.
                function computeDiagramContent() {
                    const isMermaid = state.diagramMode === 'mermaid';
                    const hasDiagram = isMermaid ? (state.renderedMermaidSvg || (state.diagramSvg && state.diagramSvg.includes('empty-state'))) : state.diagramSvg;
                    return state.isLoading ? renderLoading() :
                        state.error ? renderError() :
                        hasDiagram ? renderDiagram() :
                        renderSelectPrompt();
                }

                function computeStatusText() {
                    const isMermaid = state.diagramMode === 'mermaid';
                    const hasDiagram = isMermaid ? (state.renderedMermaidSvg || (state.diagramSvg && state.diagramSvg.includes('empty-state'))) : state.diagramSvg;
                    return state.isLoading ? 'Generating diagram...' :
                        state.error ? 'Error generating diagram' :
                        hasDiagram ? (isMermaid ? 'Mermaid diagram ready' : 'PlantUML diagram ready') :
                        'Select an item';
                }

                // Patches only the diagram/source area and the status bar — used for
                // 'loading' / 'diagram' / 'error' updates so generating a new diagram
                // never rebuilds the header, tabs, or selector (no more full-panel
                // "bounce" on every diagram refresh).
                function updateDiagramContainer() {
                    const container = document.getElementById('diagramContainer');
                    if (!container) { render(); return; }

                    container.innerHTML = computeDiagramContent();
                    attachEvents();
                    if (state.diagramMode !== 'mermaid') normalizePlantUmlSvg();
                    if (state.diagramMode === 'mermaid') {
                        if (state.renderedMermaidSvg) {
                            attachMermaidClassClicks();
                        } else if (state.mermaidCode) {
                            setTimeout(() => {
                                try {
                                    mermaid.run({ nodes: document.querySelectorAll('.mermaid') }).then(() => {
                                        attachMermaidClassClicks();
                                    }).catch(e => {
                                        console.error('Mermaid render error:', e);
                                    });
                                } catch (e) {
                                    console.error('Mermaid render error:', e);
                                }
                            }, 50);
                        }
                    }
                    updateStatusBar();
                }

                function updateStatusBar() {
                    const dot = document.getElementById('statusDot');
                    const text = document.getElementById('statusText');
                    if (!dot || !text) return;
                    dot.className = 'status-dot ' + (state.isLoading ? 'loading' : state.error ? 'error' : '');
                    text.textContent = computeStatusText();
                }

                // Patches just the function/class selector and header stats, for any
                // 'update' that doesn't change the panel's shape (file switch, cursor
                // move, or navigating to a class from a diagram link). Rebuilds the
                // select's options too — not just its value — since a file switch does
                // change which functions/classes are listed even when the shape (some
                // items vs. none) stays the same.
                function updateChrome() {
                    const headerStats = document.getElementById('headerStats');
                    if (headerStats) {
                        headerStats.textContent = state.diagramType === 'class'
                            ? (state.stats.language === 'c'
                                ? 'Not applicable for C'
                                : 'Workspace: ' + state.stats.totalFiles + ' files \\u00B7 Scope: ' + state.stats.totalClasses + ' classes')
                            : '';
                    }
                    const isClass = state.diagramType === 'class';
                    const select = document.getElementById(isClass ? 'classSelect' : 'funcSelect');
                    if (!select) return;
                    const items = isClass ? (state.classes || []) : (state.functions || []);
                    const current = isClass ? state.currentClass : state.currentFunction;
                    const existing = Array.from(select.options).map(o => o.value);
                    const sameList = existing.length === items.length && existing.every((v, i) => v === items[i]);
                    if (!sameList) {
                        // Built with concatenation, not a template literal, so it never
                        // needs escaping against the outer template literal this whole
                        // script is embedded inside.
                        select.innerHTML = items.length
                            ? items.map(v => '<option value="' + v + '" ' + (v === current ? 'selected' : '') + '>' + v + '</option>').join('')
                            : '<option disabled>No items available</option>';
                    } else if (current !== null && select.value !== current) {
                        select.value = current;
                    }
                }

                function renderSettings() {
                    return \`
                        <div class="settings-panel fade-in">
                            <div class="settings-title">
                                <span>⚙ Settings</span>
                                <button onclick="closeSettings()" title="Close">✕</button>
                            </div>
                            <div class="setting-row">
                                <div>
                                    <div class="setting-label">Java Path</div>
                                    <div class="setting-desc">Path to Java executable</div>
                                </div>
                                <input class="setting-input wide" type="text" id="settingJavaPath" value="\${state.settings.javaPath}" placeholder="/usr/bin/java">
                            </div>
                            <div class="setting-row">
                                <div>
                                    <div class="setting-label">Class Exclude Dirs</div>
                                    <div class="setting-desc">Comma-separated dirs to skip for class diagram</div>
                                </div>
                                <input class="setting-input wide" type="text" id="settingExcludePatterns" value="\${state.settings.classExcludePatterns}" placeholder="node_modules, build, bin">
                            </div>
                            <div class="settings-actions">
                                <button class="btn-cancel" onclick="closeSettings()">Cancel</button>
                                <button class="btn-save" onclick="saveSettings()">Save</button>
                            </div>
                        </div>
                    \`;
                }

                function renderLoading() {
                    const isMermaid = state.diagramMode === 'mermaid';
                    const hasDiagram = isMermaid ? state.renderedMermaidSvg : state.diagramSvg;
                    if (hasDiagram) return renderDiagram();
                    return \`
                        <div class="loading-state">
                            <div class="spinner"></div>
                            <div class="loading-text">Analyzing <strong>\${state.currentFunction}</strong>...</div>
                        </div>
                    \`;
                }

                function renderError() {
                    return \`<div class="error-state">⚠️ \${state.error}</div>\`;
                }

                function renderSelectPrompt() {
                    const type = state.diagramType === 'class' ? 'class' : 'function';
                    return \`
                        <div class="empty-state">
                            <div class="empty-icon">👆</div>
                            <p>Select a \${type} to view its diagram</p>
                        </div>
                    \`;
                }

                function renderDiagram() {
                    const scopeWarning = state.scopeWarning ? \`
                        <div style="padding: 6px 12px; margin-bottom: 8px; background: rgba(255, 152, 0, 0.1); border: 1px solid rgba(255, 152, 0, 0.3); border-radius: var(--radius-sm); font-size: 11px; color: var(--warning);">
                            ⚠ State variables inferred heuristically
                        </div>
                    \` : '';
                    const externalGuessNote = state.externalGuesses && state.externalGuesses.length > 0 ? \`
                        <div style="padding: 6px 12px; margin-bottom: 8px; background: rgba(33, 150, 243, 0.1); border: 1px solid rgba(33, 150, 243, 0.3); border-radius: var(--radius-sm); font-size: 11px; color: #64b5f6;">
                            ℹ Transition assumed: <code>\${state.externalGuesses.join(', ')}</code>() was called with a state-like argument but its implementation was not parsed (external). The state update was inferred heuristically.
                        </div>
                    \` : '';
                    const stateVarSelector = (state.diagramType === 'state' && state.stateVars && state.stateVars.length > 1) ? \`
                        <div class="state-var-selector fade-in">
                            <span class="selector-label">State Variable:</span>
                            <div class="selector-pills">
                                \${state.stateVars.map(v => \`
                                    <button class="pill \${v === state.activeStateVar ? 'active' : ''}" onclick="selectStateVar('\${v}')" >\${v}</button>
                                \`).join('')}
                            </div>
                        </div>
                    \` : '';
                    const isMermaid = state.diagramMode === 'mermaid';
                    const sourceLabel = isMermaid ? 'Mermaid' : 'PlantUML';
                    const diagramBody = isMermaid
                        ? (state.renderedMermaidSvg || ((state.diagramSvg && state.diagramSvg.includes('empty-state')) ? state.diagramSvg : ''))
                        : state.diagramSvg || '';
                    const codeSection = isMermaid
                        ? (state.mermaidCode ? renderSourceCode('Mermaid', state.mermaidCode) : '')
                        : (state.plantUmlCode ? renderSourceCode('PlantUML', state.plantUmlCode) : '');
                    return \`
                        <div class="diagram-header">
                            <div class="diagram-title">
                                <span class="func-name">\${state.currentFunction}</span>
                            </div>
                            <div class="diagram-actions">
                                <button onclick="copySource()" title="Copy \${sourceLabel} source code to clipboard">📋 Code</button>
                                \${isMermaid ? '' : '<button onclick="copyDiagram()" title=\"Copy diagram image (SVG) to clipboard\">🖼️ Copy SVG</button>'}
                                <button onclick="downloadAsPng()" title="Download diagram as PNG image">⬇ PNG</button>
                            </div>
                        </div>
                        \${stateVarSelector}
                        \${scopeWarning}
                        \${externalGuessNote}
                        <div class="diagram-view \${state.isLoading ? 'loading' : ''}" id="diagramView">
                            \${diagramBody}
                        </div>
                        \${codeSection}
                    \`;
                }

                function renderSourceCode(label, code) {
                    return \`
                        <div class="code-section">
                            <div class="code-header">
                                <span>\${label} Source</span>
                                <button onclick="copySource()" title="Copy \${label} source code to clipboard">📋 Copy</button>
                            </div>
                            <div class="code-content">\${escapeHtml(code)}</div>
                        </div>
                    \`;
                }

                function escapeHtml(text) {
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
                }

                function selectFunction(name) {
                    verboseLog('selectFunction:', name);
                    state.currentFunction = name;
                    state.isLoading = true;
                    state.renderedMermaidSvg = null;
                    render();
                    vscode.postMessage({ type: 'selectFunction', functionName: name });
                    vscode.postMessage({ type: 'command', command: 'extension.openFunction', args: name });
                }

                function selectClass(name) {
                    verboseLog('selectClass:', name);
                    state.currentClass = name;
                    state.isLoading = true;
                    state.renderedMermaidSvg = null;
                    render();
                    vscode.postMessage({ type: 'selectClass', className: name });
                    vscode.postMessage({ type: 'command', command: 'extension.openClass', args: name });
                }

                function selectStateVar(name) {
                    verboseLog('selectStateVar:', name);
                    state.activeStateVar = name;
                    state.isLoading = true;
                    state.renderedMermaidSvg = null;
                    render();
                    vscode.postMessage({ type: 'command', command: 'extension.selectStateVar', args: name });
                }

                function changeType(type) {
                    verboseLog('changeType:', type);
                    state.diagramType = type;
                    state.isLoading = true;
                    state.renderedMermaidSvg = null;
                    render();
                    vscode.postMessage({ type: 'changeDiagramType', diagramType: type });
                }

                function changeMode(mode) {
                    if (state.diagramMode === mode) return;
                    verboseLog('changeMode:', mode);
                    state.diagramMode = mode;
                    state.isLoading = true;
                    state.renderedMermaidSvg = null;
                    render();
                    vscode.postMessage({ type: 'changeDiagramMode', diagramMode: mode });
                }

                function openSettings() { vscode.postMessage({ type: 'openSettings' }); }
                // Both open a full editor-tab panel (not the sidebar) since a project
                // or package diagram needs real room — handled entirely on the
                // extension side via the existing generic command-forwarding path.
                function showProjectDiagram() { vscode.postMessage({ type: 'command', command: 'liveUmlEvo.showProjectDiagram' }); }
                function showPackageDiagram() { vscode.postMessage({ type: 'command', command: 'liveUmlEvo.showPackageDiagram' }); }
                // The gear button previously only ever opened Settings — clicking it a
                // second time did nothing, since it always re-sent 'openSettings'
                // rather than checking whether the panel was already showing.
                function toggleSettings() { if (state.showSettings) closeSettings(); else openSettings(); }
                function closeSettings() { state.showSettings = false; render(); }

                function saveSettings() {
                    const javaPath = document.getElementById('settingJavaPath').value.trim();
                    const classExcludePatterns = document.getElementById('settingExcludePatterns').value.trim();
                    vscode.postMessage({ type: 'saveSettings', settings: { javaPath: javaPath || 'java', classExcludePatterns } });
                }

                function refresh() { vscode.postMessage({ type: 'refresh' }); }

                function copySource() {
                    const code = state.diagramMode === 'mermaid' ? state.mermaidCode : state.plantUmlCode;
                    const label = state.diagramMode === 'mermaid' ? 'Mermaid' : 'PlantUML';
                    if (code) {
                        navigator.clipboard.writeText(code).then(() => {
                            vscode.postMessage({ type: 'showInfo', message: label + ' source code copied to clipboard' });
                        });
                    }
                }

                function copyDiagram() {
                    const svgEl = document.querySelector('.diagram-view svg');
                    if (svgEl) {
                        const svgData = new XMLSerializer().serializeToString(svgEl);
                        const svgDoc = '<?xml version="1.0" encoding="UTF-8"?>' + svgData;
                        navigator.clipboard.writeText(svgDoc).then(() => {
                            vscode.postMessage({ type: 'showInfo', message: 'Diagram image (SVG) copied to clipboard' });
                        });
                    }
                }

                function getSvgElement() {
                    return document.querySelector('.diagram-view svg');
                }

                function normalizePlantUmlSvg() {
                    // PlantUML's raw SVG output bakes in its own inline
                    // style="width:...px;height:...px;..." plus preserveAspectRatio=
                    // "none". Inline styles always win over the external
                    // ".diagram-view svg { max-width:100%; height:auto; }" rule, so
                    // the container's CSS could shrink the width on a narrow panel
                    // while the inline height stayed pinned at the SVG's native
                    // size — stretching/squishing the diagram instead of scaling it
                    // proportionally. Mermaid's client-rendered SVG never sets this,
                    // which is why only PlantUML was affected, and why it happened
                    // in every PlantUML view, not just the project diagram panel.
                    const svg = getSvgElement();
                    if (!svg) return;
                    svg.style.width = '100%';
                    svg.style.height = 'auto';
                    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                }

                function downloadAsPng() {
                    const svgEl = getSvgElement();
                    if (!svgEl) return;
                    const svgString = new XMLSerializer().serializeToString(svgEl);
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth * 2;
                        canvas.height = img.naturalHeight * 2;
                        const ctx = canvas.getContext('2d');
                        ctx.fillStyle = '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.scale(2, 2);
                        ctx.drawImage(img, 0, 0);
                        canvas.toBlob((blob) => {
                            const reader = new FileReader();
                            reader.onload = () => {
                                const bytes = new Uint8Array(reader.result);
                                let binary = '';
                                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                                const base64 = btoa(binary);
                                const a = document.createElement('a');
                                a.href = 'data:image/png;base64,' + base64;
                                a.download = (state.currentFunction || 'diagram') + '.png';
                                a.click();
                            };
                            reader.readAsArrayBuffer(blob);
                        }, 'image/png');
                    };
                    img.src = 'data:image/svg+xml;base64,' + btoa(svgString);
                }

                function attachEvents() {
                    const svg = document.querySelector('.diagram-view svg');
                    if (svg) {
                        svg.querySelectorAll('a').forEach(a => {
                            let href = a.getAttribute('xlink:href') || a.getAttribute('href');
                            if (href && href.startsWith('command://')) {
                                a.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    const path = href.substring(10);
                                    const [cmd, args] = path.split('?');
                                    vscode.postMessage({ type: 'command', command: cmd, args: args });
                                });
                            } else if (href && href.startsWith('command:')) {
                                a.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    const path = href.substring(8);
                                    const [cmd, args] = path.split('?');
                                    vscode.postMessage({ type: 'command', command: cmd, args: args });
                                });
                            }
                        });
                    }
                }

                function attachMermaidClassClicks() {
                    const svg = document.querySelector('.diagram-view svg');
                    if (!svg || state.diagramType !== 'class') return;
                    
                    svg.querySelectorAll('.classGroup, g[id]').forEach(g => {
                        let className = null;
                        
                        const titleEl = g.querySelector('title');
                        if (titleEl) {
                            className = titleEl.textContent.trim();
                        }
                        
                        if (!className) {
                            const labelEl = g.querySelector('.label');
                            if (labelEl) {
                                className = labelEl.textContent.trim();
                            }
                        }
                        
                        if (!className || !className.trim()) return;
                        
                        const clickable = g.querySelector('rect') || g.querySelector('polygon') || g;
                        if (clickable) {
                            clickable.style.cursor = 'pointer';
                            clickable.addEventListener('click', (e) => {
                                e.stopPropagation();
                                vscode.postMessage({
                                    type: 'command',
                                    command: 'extension.openClass',
                                    args: className
                                });
                            });
                        }
                    });
                }

                render();
            </script>
        </body>
        </html>`;
}

module.exports = {
    getWebviewHtml
};