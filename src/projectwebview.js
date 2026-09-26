function getProjectWebviewHtml(extensionVersion, sidebarLocation) {
    const sideBarSide = sidebarLocation === "right" ? "right" : "left";
    return `
        <html>
        <head>
        <style>
            :root {
                --bg-primary: #1e1e1e;
                --bg-secondary: #252526;
                --border: #3c3c3c;
                --text-primary: #cccccc;
                --text-secondary: #969696;
                --accent: #0284C7;
            }
            @media (prefers-color-scheme: light) {
                :root {
                    --bg-primary: #ffffff;
                    --bg-secondary: #f3f3f3;
                    --border: #e0e0e0;
                    --text-primary: #1e1e1e;
                    --text-secondary: #616161;
                }
            }
            * { box-sizing: border-box; }
            body {
                margin: 0; padding: 0; height: 100vh; overflow: hidden;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                background: var(--bg-primary); color: var(--text-primary);
                display: flex; flex-direction: column;
            }
            .header {
                display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
                padding: 10px 16px; border-bottom: 1px solid var(--border);
                background: var(--bg-secondary); flex-shrink: 0;
            }
            .header-title { font-weight: 600; font-size: 14px; }
            .scope-label { color: var(--text-secondary); font-size: 12px; }
            .header-actions { margin-left: auto; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
            .header-actions label { font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 4px; cursor: pointer; }
            /* Below this width the title/scope/stats row and the controls row
               no longer both fit on one line without every element (theme
               dropdown, color swatches, buttons) getting squeezed down to fit —
               dropping header-actions onto its own full-width row below the
               title instead lets each control keep its natural size. */
            @media (max-width: 640px) {
                .header-actions { flex-basis: 100%; margin-left: 0; }
            }
            button.action {
                background: var(--accent); color: #fff; border: none; border-radius: 4px;
                padding: 5px 12px; font-size: 12px; cursor: pointer;
            }
            button.action:hover { opacity: 0.85; }
            .mode-tabs { display: flex; border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
            .mode-tabs button {
                background: transparent; color: var(--text-secondary); border: none;
                padding: 5px 10px; font-size: 12px; cursor: pointer;
            }
            .mode-tabs button.active { background: var(--accent); color: #fff; }
            select#themeSelect {
                background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border);
                border-radius: 4px; padding: 4px 6px; font-size: 12px;
            }
            .custom-colors { display: flex; gap: 10px; }
            .custom-colors label { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-secondary); }
            .custom-colors input[type="color"] { width: 22px; height: 20px; border: 1px solid var(--border); border-radius: 3px; padding: 0; background: none; cursor: pointer; }
            .stats { font-size: 11px; color: var(--text-secondary); }
            .legend {
                display: flex; align-items: center; gap: 18px; padding: 8px 16px; border-bottom: 1px solid var(--border);
                background: var(--bg-secondary); font-size: 11px; color: var(--text-secondary); flex-wrap: wrap;
            }
            .header-collapse-toggle {
                margin-left: auto; background: none; border: none; color: var(--text-secondary);
                cursor: pointer; font-size: 10px; padding: 2px 4px; flex-shrink: 0;
            }
            .header-collapse-toggle:hover { color: var(--text-primary); }
            /* Collapsed: keep only the title and the scope/stats overview line
               (e.g. "Whole project \u00b7 42 classes \u00b7 61 relationships") visible
               in the header, as a thin bar; the legend row also shrinks down to
               just its toggle button, and the two rows' padding/border is
               trimmed so they read as a single narrow strip with no divider
               line between them. */
            body.header-collapsed .header-actions { display: none; }
            body.header-collapsed .header { padding: 4px 16px; border-bottom: none; }
            body.header-collapsed .header-title { font-size: 11px; }
            body.header-collapsed .legend {
                gap: 0; padding: 2px 16px;
                /* .legend is still its own flex row even with everything else
                   hidden, so the button was adding a whole second line of
                   height below the header. Pulling it up by roughly the
                   header's own collapsed height puts it back on the same
                   visual line instead — but .legend's own opaque background
                   then painted straight over the header's text underneath it,
                   so it needs to go transparent too now that it overlaps. */
                margin-top: -22px; position: relative; z-index: 1; background: transparent;
            }
            body.header-collapsed .legend .legend-item { display: none; }
            .legend-item { display: flex; align-items: center; gap: 6px; }
            .legend-swatch { display: inline-block; width: 20px; height: 2px; position: relative; }
            .sw-inheritance { background: #2980b9; }
            .sw-realization { background: repeating-linear-gradient(90deg, #2980b9 0 4px, transparent 4px 7px); }
            .sw-composition::before { content: '\\25C6'; position: absolute; left: -8px; top: -7px; color: #c0392b; font-size: 11px; }
            .sw-composition { background: #c0392b; }
            .sw-aggregation::before { content: '\\25C7'; position: absolute; left: -8px; top: -7px; color: #27ae60; font-size: 11px; }
            .sw-aggregation { background: #27ae60; }
            .sw-dependency { background: repeating-linear-gradient(90deg, #8e44ad 0 4px, transparent 4px 7px); }
            .confidence-note { font-style: italic; }
            .diagram-wrapper { flex: 1; position: relative; min-height: 0; }
            .diagram-container {
                /* Was display:flex + justify-content:center, which has a
                   well-known flexbox quirk: when a centered flex item
                   overflows its container, the browser only lets you scroll
                   toward the end, not the start — the overflow past the left
                   edge is simply unreachable. Centering via text-align on a
                   block container doesn't have that limitation; overflow in
                   either direction scrolls normally. */
                position: absolute; inset: 0; overflow: auto; padding: 20px;
                text-align: center;
            }
            .diagram-container svg { display: inline-block; }
            .zoom-controls {
                /* Kept on the same side as VS Code's own sidebar (passed in from
                   extension.js, since a webview has no way to know this on its
                   own), so this widget always sits right next to it. */
                position: absolute; ${sideBarSide}: 16px; top: 50%; transform: translateY(-50%);
                display: flex; flex-direction: column; align-items: center; gap: 2px;
                background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 6px;
                padding: 6px 4px; box-shadow: 0 2px 8px rgba(0,0,0,0.35); z-index: 10;
            }
            .zoom-controls button {
                width: 26px; height: 26px; border: none; border-radius: 4px; background: transparent;
                color: var(--text-primary); font-size: 15px; line-height: 1; cursor: pointer;
                display: flex; align-items: center; justify-content: center;
            }
            .zoom-controls button:hover { background: var(--border); }
            .zoom-controls #zoomLevel { font-size: 10px; color: var(--text-secondary); padding: 3px 0; user-select: none; }
            .vscode-sidebar-toggle { font-size: 12px !important; color: var(--text-secondary); }
            .loading-state, .error-state, .empty-state {
                margin: 40px 0 0; text-align: center; color: var(--text-secondary); font-size: 13px; padding: 40px;
            }
            .error-state { color: #e06c75; }
            .spinner {
                width: 24px; height: 24px; margin: 0 auto 12px; border-radius: 50%;
                border: 3px solid var(--border); border-top-color: var(--accent);
                animation: spin 0.8s linear infinite;
            }
            @keyframes spin { to { transform: rotate(360deg); } }
        </style>
        </head>
        <body>
            <div class="header" id="header">
                <span class="header-title">Live Uml Evo \u2014 Project Diagram</span>
                <span class="scope-label" id="scopeLabel">Loading\u2026</span>
                <span class="stats" id="stats"></span>
                <div class="header-actions">
                    <div class="mode-tabs">
                        <button id="modePlantuml" class="active" onclick="changeMode('plantuml')">PlantUML</button>
                        <button id="modeMermaid" onclick="changeMode('mermaid')">Mermaid</button>
                    </div>
                    <select id="themeSelect" title="Color theme">
                        <option value="ocean">Ocean</option>
                        <option value="forest">Forest</option>
                        <option value="sunset">Sunset</option>
                        <option value="monochrome">Monochrome</option>
                        <option value="dark">Dark</option>
                        <option value="contrast">High Contrast</option>
                        <option value="custom">Custom\u2026</option>
                    </select>
                    <span id="customColors" class="custom-colors" style="display:none;">
                        <label title="Class box fill">Box <input type="color" id="colorBg" value="#FEFEFE" /></label>
                        <label title="Empty canvas / page area behind the diagram">Canvas <input type="color" id="colorCanvas" value="#FEFEFE" /></label>
                        <label title="Border / arrows">Accent <input type="color" id="colorAccent" value="#2980b9" /></label>
                        <label title="Text">Text <input type="color" id="colorText" value="#1a1a1a" /></label>
                        <button class="action" onclick="applyTheme()" title="Apply these colors">\u2713 Apply</button>
                    </span>
                    <label><input type="checkbox" id="depToggle" checked /> Show dependencies</label>
                    <button class="action" onclick="refresh()">\u21bb Refresh</button>
                    <button class="action" onclick="exportDiagram('svg')" title="Download the current diagram as an SVG file">\u2b07 SVG</button>
                    <button class="action" onclick="exportDiagram('png')" title="Download the current diagram as a PNG file">\u2b07 PNG</button>
                </div>
            </div>
            <div class="legend" id="legend">
                <div class="legend-item"><span class="legend-swatch sw-inheritance"></span> Inheritance</div>
                <div class="legend-item"><span class="legend-swatch sw-realization"></span> Realization (interface)</div>
                <div class="legend-item"><span class="legend-swatch sw-composition"></span> Composition (owns)</div>
                <div class="legend-item"><span class="legend-swatch sw-aggregation"></span> Aggregation (has-a)</div>
                <div class="legend-item"><span class="legend-swatch sw-dependency"></span> Dependency (uses)</div>
                <div class="legend-item confidence-note">? = inferred, not certain \u2014 click a class to check its source</div>
                <button class="header-collapse-toggle" id="headerCollapseToggle" onclick="toggleHeader()" title="Collapse to just the title and overview">\u25b2</button>
            </div>
            <div class="diagram-wrapper">
                <div class="diagram-container" id="diagramContainer">
                    <div class="loading-state"><div class="spinner"></div>Analyzing project\u2026</div>
                </div>
                <div class="zoom-controls" id="zoomControls">
                    <button class="vscode-sidebar-toggle" id="vsCodeSidebarToggle" onclick="toggleVsCodeSidebar()" title="Collapse the VS Code sidebar">\u25b8</button>
                    <button onclick="zoomBy(0.2)" title="Zoom in">+</button>
                    <span id="zoomLevel">100%</span>
                    <button onclick="zoomBy(-0.2)" title="Zoom out">\u2212</button>
                    <button onclick="zoomFit()" title="Fit the whole diagram in view">\u2922</button>
                </div>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js"></script>
            <script>
                const vscode = acquireVsCodeApi();
                const SIDEBAR_LOCATION = '${sideBarSide}';
                let vsCodeSidebarCollapsed = false;
                let state = { mermaidCode: '', svg: '', diagramMode: 'plantuml', renderedSvg: null, zoomMode: 'fit', zoomPercent: 100 };

                // Keys match the PlantUML provider's own THEMES (providers/diagrams/plantuml/ProjectClassProvider.js)
                // so a given preset name means the same colors regardless of which renderer is active.
                const THEME_COLORS = {
                    ocean: { background: '#FEFEFE', canvas: '#FEFEFE', accent: '#2980b9', text: '#1a1a1a' },
                    forest: { background: '#F3FAF3', canvas: '#F3FAF3', accent: '#27ae60', text: '#1a1a1a' },
                    sunset: { background: '#FFF3E8', canvas: '#FFF3E8', accent: '#ff5722', text: '#3d1f00' },
                    monochrome: { background: '#FAFAFA', canvas: '#FAFAFA', accent: '#555555', text: '#222222' },
                    dark: { background: '#1e1e1e', canvas: '#1e1e1e', accent: '#569cd6', text: '#d4d4d4' },
                    contrast: { background: '#1e1e1e', canvas: '#1e1e1e', accent: '#00d4ff', text: '#ffffff' }
                };

                // Same idea as the background/textColor fix in the comment below:
                // 'base' derives mainBkg/secondBkg (the actual fill mermaid paints
                // inside each class box) from darkMode when they're not set
                // explicitly, and darkMode itself was never set — so it silently
                // stayed at mermaid's own default regardless of preset, which is
                // why the container fill looked wrong while the page background
                // (set via the outer background var) tracked the VS Code theme fine.
                function isDark(hex) {
                    const h = (hex || '').replace('#', '');
                    if (h.length !== 6) return false;
                    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
                    // standard perceptual luminance
                    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
                }

                function mermaidConfigFor(colors) {
                    // canvas falls back to background for presets and for any older
                    // saved custom color set that predates the canvas swatch.
                    const canvas = colors.canvas || colors.background;
                    const dark = isDark(canvas);
                    return {
                        startOnLoad: false, securityLevel: 'strict', theme: 'base',
                        themeVariables: {
                            // 'base' theme leaves anything not explicitly set here to
                            // its own internal defaults rather than a neutral value —
                            // background/textColor/nodeTextColor weren't set at all
                            // before, which is why every preset rendered the same
                            // (dark) regardless of which one was actually selected.
                            darkMode: dark,
                            background: canvas,
                            mainBkg: colors.background, secondBkg: colors.background,
                            primaryColor: colors.background, primaryBorderColor: colors.accent,
                            primaryTextColor: colors.text, lineColor: colors.accent, classText: colors.text,
                            textColor: colors.text, nodeTextColor: colors.text,
                            nodeBorder: colors.accent, classBorder: colors.accent,
                            // classDiagram never paints a full-canvas background rect of
                            // its own (confirmed against mermaid's source), so the empty
                            // space around the boxes was always showing through to
                            // whatever's behind the SVG in the page — VS Code's own
                            // background, appearing black regardless of preset. And
                            // edge/relationship label backgrounds (the box behind arrow
                            // text) use their own separate variable, never set before, so
                            // they fell back to mermaid's own computed default instead of
                            // matching the diagram. Both use canvas, not the box color,
                            // since they sit in the empty space, not inside a class box.
                            edgeLabelBackground: canvas
                        }
                    };
                }

                mermaid.initialize(mermaidConfigFor(THEME_COLORS.ocean));

                function currentColors() {
                    const theme = document.getElementById('themeSelect').value;
                    if (theme === 'custom') {
                        return {
                            background: document.getElementById('colorBg').value,
                            canvas: document.getElementById('colorCanvas').value,
                            accent: document.getElementById('colorAccent').value,
                            text: document.getElementById('colorText').value
                        };
                    }
                    return THEME_COLORS[theme] || THEME_COLORS.ocean;
                }

                function applyTheme() {
                    const theme = document.getElementById('themeSelect').value;
                    document.getElementById('customColors').style.display = theme === 'custom' ? 'flex' : 'none';
                    const colors = currentColors();

                    if (state.diagramMode === 'mermaid') {
                        // Mermaid's theme lives entirely in the browser — re-initializing
                        // and re-rendering the already-cached diagram text is instant and
                        // needs no round trip to re-scan the project.
                        mermaid.initialize(mermaidConfigFor(colors));
                        if (state.mermaidCode) renderMermaid(state.mermaidCode, colors);
                    } else {
                        // PlantUML's colors are skinparam directives baked into the
                        // generated diagram source, so this does need the backend to
                        // regenerate it.
                        vscode.postMessage({
                            type: 'changeTheme',
                            theme: theme === 'custom' ? null : theme,
                            customColors: theme === 'custom' ? colors : null
                        });
                    }
                }

                document.getElementById('themeSelect').addEventListener('change', applyTheme);
                // Color pickers deliberately don't auto-apply on drag (an 'input'
                // listener here would fire continuously while dragging) — for
                // PlantUML specifically, each application is a full backend
                // regenerate, so live-applying made every drag movement queue up
                // its own slow render, which looked like heavy lag. The "Apply"
                // button (wired via onclick in the HTML above) is the only trigger
                // now, for both renderers, so a drag costs nothing until you're
                // actually done choosing a color.

                function refresh() {
                    document.getElementById('diagramContainer').innerHTML = '<div class="loading-state"><div class="spinner"></div>Analyzing project\\u2026</div>';
                    vscode.postMessage({ type: 'refresh' });
                }

                function changeMode(mode) {
                    document.getElementById('diagramContainer').innerHTML = '<div class="loading-state"><div class="spinner"></div>Analyzing project\\u2026</div>';
                    vscode.postMessage({ type: 'changeDiagramMode', diagramMode: mode });
                }

                function updateModeTabs(mode) {
                    document.getElementById('modeMermaid').classList.toggle('active', mode === 'mermaid');
                    document.getElementById('modePlantuml').classList.toggle('active', mode === 'plantuml');
                }

                document.getElementById('depToggle').addEventListener('change', (e) => {
                    vscode.postMessage({ type: 'toggleDependencies', value: e.target.checked });
                });

                window.addEventListener('message', (event) => {
                    const msg = event.data;
                    switch (msg.type) {
                        case 'loading':
                            document.getElementById('diagramContainer').innerHTML = '<div class="loading-state"><div class="spinner"></div>Analyzing project\\u2026</div>';
                            break;
                        case 'error':
                            document.getElementById('diagramContainer').innerHTML = '<div class="error-state">\\u26A0\\uFE0F ' + escapeHtml(msg.message) + '</div>';
                            document.getElementById('stats').textContent = '';
                            break;
                        case 'diagram':
                            document.getElementById('scopeLabel').textContent = msg.scopeLabel;
                            document.getElementById('stats').textContent = msg.classCount + ' classes \\u00B7 ' + msg.relationshipCount + ' relationships';
                            state.diagramMode = msg.diagramMode;
                            updateModeTabs(msg.diagramMode);
                            if (msg.diagramMode === 'mermaid') {
                                // mermaid.initialize() was previously only called from
                                // applyTheme(), so a plain load/refresh reused whatever
                                // config was set last (the hardcoded Ocean default on
                                // first load) instead of the currently selected theme —
                                // the class boxes rendered in the wrong colors until you
                                // touched the theme dropdown yourself.
                                const colors = currentColors();
                                mermaid.initialize(mermaidConfigFor(colors));
                                state.mermaidCode = msg.mermaidCode;
                                renderMermaid(msg.mermaidCode, colors);
                            } else {
                                document.getElementById('diagramContainer').style.backgroundColor = '';
                                document.getElementById('diagramContainer').innerHTML = msg.svg || '<div class="empty-state">No diagram produced.</div>';
                                attachLinkClicks();
                                applyZoom();
                            }
                            break;
                    }
                });

                async function renderMermaid(code, colors) {
                    try {
                        // See the comment on edgeLabelBackground above: classDiagram
                        // draws no background rect at all, so we paint the container
                        // itself to match the selected theme instead of leaving it to
                        // show through to the page's (VS Code-themed) background.
                        if (colors) document.getElementById('diagramContainer').style.backgroundColor = colors.canvas || colors.background;
                        const { svg } = await mermaid.render('project-diagram-' + Date.now(), code);
                        document.getElementById('diagramContainer').innerHTML = svg;
                        attachMermaidClassClicks();
                        applyZoom();
                    } catch (e) {
                        document.getElementById('diagramContainer').innerHTML = '<div class="error-state">\\u26A0\\uFE0F ' + escapeHtml(e.message || 'Mermaid render error') + '</div>';
                    }
                }

                function applyZoom() {
                    const svg = document.querySelector('.diagram-container svg');
                    if (!svg) return;
                    const { width, height } = svgDimensions(svg);
                    if (state.zoomMode === 'fit') {
                        // Scale to the container's own width so the whole diagram is
                        // always visible without horizontal scrolling — the default,
                        // since neither renderer's raw output does this on its own
                        // (PlantUML ships fixed pixel dimensions; mermaid's native size
                        // is whatever its own layout produces).
                        svg.style.width = '100%';
                        svg.style.height = 'auto';
                    } else {
                        const scale = state.zoomPercent / 100;
                        svg.style.width = (width * scale) + 'px';
                        svg.style.height = (height * scale) + 'px';
                    }
                    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
                    updateZoomLabel();
                }

                function currentZoomPercent() {
                    const svg = document.querySelector('.diagram-container svg');
                    if (!svg) return 100;
                    const { width } = svgDimensions(svg);
                    const rendered = svg.getBoundingClientRect().width;
                    return width > 0 ? Math.round((rendered / width) * 100) : 100;
                }

                function zoomBy(deltaFraction) {
                    // Starts from whatever's currently on screen (including the
                    // container-relative "fit" size) so the diagram doesn't jump —
                    // the very first click just continues zooming from there.
                    const next = Math.max(10, Math.min(400, currentZoomPercent() + Math.round(deltaFraction * 100)));
                    state.zoomMode = 'custom';
                    state.zoomPercent = next;
                    applyZoom();
                }

                function zoomFit() {
                    state.zoomMode = 'fit';
                    state.zoomPercent = null;
                    applyZoom();
                }

                function toggleHeader() {
                    const btn = document.getElementById('headerCollapseToggle');
                    if (!btn) return;
                    const collapsed = document.body.classList.toggle('header-collapsed');
                    btn.textContent = collapsed ? '\\u25bc' : '\\u25b2';
                    btn.title = collapsed ? 'Expand the title bar' : 'Collapse to just the title and overview';
                }

                function updateSidebarToggleIcon() {
                    const btn = document.getElementById('vsCodeSidebarToggle');
                    if (!btn) return;
                    const rightPointing = '\\u25b8', leftPointing = '\\u25c2';
                    // Points toward the sidebar while it's open, and away from it
                    // (back toward where it'll reopen from) once collapsed — mirrored
                    // depending on which side the sidebar is actually docked on.
                    const towardSidebar = SIDEBAR_LOCATION === 'right' ? rightPointing : leftPointing;
                    const awayFromSidebar = SIDEBAR_LOCATION === 'right' ? leftPointing : rightPointing;
                    btn.textContent = vsCodeSidebarCollapsed ? awayFromSidebar : towardSidebar;
                    btn.title = vsCodeSidebarCollapsed ? 'Expand the VS Code sidebar' : 'Collapse the VS Code sidebar';
                }

                function toggleVsCodeSidebar() {
                    vsCodeSidebarCollapsed = !vsCodeSidebarCollapsed;
                    updateSidebarToggleIcon();
                    vscode.postMessage({ type: 'command', command: 'workbench.action.toggleSidebarVisibility' });
                }

                function updateZoomLabel() {
                    const label = document.getElementById('zoomLevel');
                    if (!label) return;
                    label.textContent = state.zoomMode === 'fit' ? 'Fit' : state.zoomPercent + '%';
                }

                function escapeHtml(s) {
                    const div = document.createElement('div');
                    div.textContent = String(s);
                    return div.innerHTML;
                }

                function attachLinkClicks() {
                    const svg = document.querySelector('.diagram-container svg');
                    if (!svg) return;
                    svg.querySelectorAll('a').forEach(a => {
                        const href = a.getAttribute('xlink:href') || a.getAttribute('href');
                        if (href && href.startsWith('command:')) {
                            a.addEventListener('click', (e) => {
                                e.preventDefault();
                                const path = href.replace(/^command:\\/\\//, '').replace(/^command:/, '');
                                const [cmd, args] = path.split('?');
                                vscode.postMessage({ type: 'command', command: cmd, args: args });
                            });
                        }
                    });
                }

                function attachMermaidClassClicks() {
                    const svg = document.querySelector('.diagram-container svg');
                    if (!svg) return;
                    svg.querySelectorAll('.classGroup, g[id]').forEach(g => {
                        let className = null;
                        const titleEl = g.querySelector('title');
                        if (titleEl) className = titleEl.textContent.trim();
                        if (!className) {
                            const labelEl = g.querySelector('.label');
                            if (labelEl) className = labelEl.textContent.trim();
                        }
                        if (!className) return;
                        const clickable = g.querySelector('rect') || g.querySelector('polygon') || g;
                        if (clickable) {
                            clickable.style.cursor = 'pointer';
                            clickable.addEventListener('click', (e) => {
                                e.stopPropagation();
                                vscode.postMessage({ type: 'command', command: 'extension.openClass', args: className });
                            });
                        }
                    });
                }

                function downloadBlob(blob, filename) {
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = filename;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                }

                function svgDimensions(svg) {
                    // Prefer viewBox over width/height attrs — mermaid's output sets
                    // width as a percentage, which parseFloat would read as NaN.
                    const vb = svg.getAttribute('viewBox');
                    if (vb) {
                        const parts = vb.trim().split(/\\s+/).map(Number);
                        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) return { width: parts[2], height: parts[3] };
                    }
                    const w = parseFloat(svg.getAttribute('width'));
                    const h = parseFloat(svg.getAttribute('height'));
                    if (w > 0 && h > 0) return { width: w, height: h };
                    return { width: 1200, height: 800 };
                }

                function exportDiagram(format) {
                    const svg = document.querySelector('.diagram-container svg');
                    if (!svg) return;
                    const clone = svg.cloneNode(true);
                    const { width, height } = svgDimensions(svg);
                    clone.setAttribute('width', width);
                    clone.setAttribute('height', height);
                    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
                    const svgText = new XMLSerializer().serializeToString(clone);
                    const baseName = 'liveuml-' + state.diagramMode + '-diagram';

                    if (format === 'svg') {
                        downloadBlob(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }), baseName + '.svg');
                        return;
                    }

                    // PNG: rasterize via an offscreen canvas. 2x the SVG's own size
                    // for a crisper export than the on-screen native resolution.
                    const scale = 2;
                    const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
                    const url = URL.createObjectURL(svgBlob);
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = width * scale; canvas.height = height * scale;
                        const ctx = canvas.getContext('2d');
                        // Neither renderer paints a full-canvas background rect of its
                        // own (see the mermaidConfigFor comments above), so without
                        // this the PNG would export with a transparent canvas instead
                        // of matching what's actually shown on screen.
                        const bg = getComputedStyle(document.getElementById('diagramContainer')).backgroundColor;
                        ctx.fillStyle = bg && bg !== 'rgba(0, 0, 0, 0)' ? bg : '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        URL.revokeObjectURL(url);
                        canvas.toBlob(blob => { if (blob) downloadBlob(blob, baseName + '.png'); }, 'image/png');
                    };
                    img.onerror = () => URL.revokeObjectURL(url);
                    img.src = url;
                }

                updateSidebarToggleIcon();
                vscode.postMessage({ type: 'ready' });
            </script>
        </body>
        </html>`;
}

module.exports = { getProjectWebviewHtml };
