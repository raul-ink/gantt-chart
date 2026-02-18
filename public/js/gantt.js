/**
 * gantt.js — SVG-based Gantt chart renderer
 *
 * Renders a project JSON (with groups + tasks) as a split-panel Gantt chart:
 *   - Left: sticky HTML rows (ID, Name, Start, End, Effort)
 *   - Right: SVG timeline (phase bars, task bars, dependency arrows)
 */

const ROW_HEIGHT = 44;         // px per row
const TIMELINE_HEADER_H = 48;  // px, must match CSS var

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseDate(str) {
    // YYYY-MM-DD → local midnight Date
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function formatDisplay(str) {
    // YYYY-MM-DD → "Jan 8, 2024"
    const d = parseDate(str);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysBetween(a, b) {
    return Math.round((b - a) / 86400000);
}

function dateToX(date, projectStart, dayWidth) {
    return daysBetween(projectStart, date) * dayWidth;
}

function svgEl(tag, attrs = {}, children = []) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    for (const child of children) el.appendChild(child);
    return el;
}

function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (k === 'className') e.className = v;
        else if (k === 'textContent') e.textContent = v;
        else if (k === 'innerHTML') e.innerHTML = v;
        else e.setAttribute(k, v);
    }
    for (const child of children) {
        if (typeof child === 'string') e.appendChild(document.createTextNode(child));
        else e.appendChild(child);
    }
    return e;
}

// ─── Main renderer class ─────────────────────────────────────────────────────

class GanttChart {
    constructor(data) {
        this.data = data;
        this.projectStart = parseDate(data.project.start);
        this.projectEnd = parseDate(data.project.end);
        this.totalDays = daysBetween(this.projectStart, this.projectEnd) + 1;

        // dayWidth and svgWidth are set dynamically in render() based on container size
        this.dayWidth = 1;
        this.svgWidth = 0;

        // Flat ordered list of rows for Y-position lookup
        this.rows = [];           // { type, groupIdx, data, rowIndex, visible }
        this.collapsedGroups = new Set();
    }

    // Build flat row list
    buildRows() {
        this.rows = [];
        let rowIndex = 0;
        this.data.groups.forEach((group, gi) => {
            const collapsed = this.collapsedGroups.has(group.id);
            this.rows.push({ type: 'phase', groupIdx: gi, data: group, rowIndex: rowIndex++, visible: true });
            group.tasks.forEach((task, ti) => {
                this.rows.push({ type: 'task', groupIdx: gi, taskIdx: ti, data: task, rowIndex: rowIndex++, visible: !collapsed });
            });
        });
    }

    // Map task id → row entry
    buildTaskMap() {
        this.taskMap = {};
        for (const row of this.rows) {
            if (row.type === 'task') this.taskMap[row.data.id] = row;
        }
    }

    render() {
        // Always fit the full timeline into the available width — no horizontal scroll
        const rightEl = document.getElementById('gantt-right');
        const availableWidth = rightEl.clientWidth || (window.innerWidth - 560);
        this.dayWidth = availableWidth / this.totalDays;
        this.svgWidth = availableWidth;

        this.buildRows();
        this.buildTaskMap();
        this.renderLeftPanel();
        this.renderTimelineHeader();
        this.renderSVG();
        this.setupScrollSync();
        this.updateProjectHeader();
    }

    // ── Project header ──────────────────────────────────────────────────────
    updateProjectHeader() {
        const title = document.getElementById('project-title');
        const dates = document.getElementById('project-dates');
        if (title) title.textContent = this.data.project.name;
        if (dates) dates.textContent = `${formatDisplay(this.data.project.start)} - ${formatDisplay(this.data.project.end)}`;
    }

    // ── Left panel ──────────────────────────────────────────────────────────
    renderLeftPanel() {
        const container = document.getElementById('gantt-left-rows');
        container.innerHTML = '';

        for (const row of this.rows) {
            const rowEl = this.buildLeftRow(row);
            container.appendChild(rowEl);
        }
    }

    buildLeftRow(row) {
        const isPhase = row.type === 'phase';
        const d = row.data;

        const rowEl = el('div', { className: `gantt-row ${isPhase ? 'is-phase' : 'is-task'}${(!row.visible ? ' is-collapsed' : '')}` });
        rowEl.dataset.rowId = d.id;

        if (isPhase) {
            const toggleSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>`;
            const toggle = el('span', { className: `row-toggle${this.collapsedGroups.has(d.id) ? ' collapsed' : ''}`, innerHTML: toggleSvg });
            rowEl.appendChild(toggle);
            rowEl.appendChild(el('div', { className: 'row-id', textContent: '' }));
        } else {
            rowEl.appendChild(el('div', { className: 'row-id', textContent: d.id.replace('task-', '').replace('-', '.') }));
        }

        rowEl.appendChild(el('div', { className: 'row-name', textContent: d.name }));
        rowEl.appendChild(el('div', { className: 'row-start', textContent: formatDisplay(d.start) }));
        rowEl.appendChild(el('div', { className: 'row-end', textContent: formatDisplay(d.end) }));
        rowEl.appendChild(el('div', { className: 'row-effort', textContent: d.effort }));

        if (isPhase) {
            rowEl.addEventListener('click', () => this.toggleGroup(d.id));
        }

        return rowEl;
    }

    toggleGroup(groupId) {
        if (this.collapsedGroups.has(groupId)) {
            this.collapsedGroups.delete(groupId);
        } else {
            this.collapsedGroups.add(groupId);
        }
        this.render();
    }

    // ── Adaptive tick dates ──────────────────────────────────────────────────
    // Returns [{date, label}] at weekly / monthly / quarterly intervals
    // based on how many pixels each period occupies at the current dayWidth.
    getTickDates() {
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const pxPerWeek  = this.dayWidth * 7;
        const pxPerMonth = this.dayWidth * 30;
        const ticks = [];

        if (pxPerWeek >= 40) {
            // Weekly — align to the Monday of the week containing projectStart
            const cur = new Date(this.projectStart);
            cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7));
            while (cur <= this.projectEnd) {
                ticks.push({ date: new Date(cur), label: `${months[cur.getMonth()]} ${cur.getDate()}` });
                cur.setDate(cur.getDate() + 7);
            }
        } else if (pxPerMonth >= 40) {
            // Monthly — 1st of each month
            const cur = new Date(this.projectStart.getFullYear(), this.projectStart.getMonth(), 1);
            while (cur <= this.projectEnd) {
                ticks.push({ date: new Date(cur), label: `${months[cur.getMonth()]} ${cur.getFullYear()}` });
                cur.setMonth(cur.getMonth() + 1);
            }
        } else {
            // Quarterly — Jan/Apr/Jul/Oct 1
            const qMonths = [0, 3, 6, 9];
            for (let yr = this.projectStart.getFullYear(); yr <= this.projectEnd.getFullYear(); yr++) {
                for (const qm of qMonths) {
                    const d = new Date(yr, qm, 1);
                    if (d >= this.projectStart && d <= this.projectEnd) {
                        ticks.push({ date: new Date(d), label: `Q${qm / 3 + 1} ${yr}` });
                    }
                }
            }
            // Fallback: at least show the project start month
            if (ticks.length === 0) {
                ticks.push({ date: new Date(this.projectStart), label: `${months[this.projectStart.getMonth()]} ${this.projectStart.getFullYear()}` });
            }
        }

        return ticks;
    }

    // ── Timeline header ──────────────────────────────────────────────────────
    renderTimelineHeader() {
        const headerEl = document.getElementById('gantt-timeline-header');
        headerEl.innerHTML = '';

        const svgH = TIMELINE_HEADER_H;
        const svg = svgEl('svg', { width: this.svgWidth, height: svgH, xmlns: 'http://www.w3.org/2000/svg' });

        svg.appendChild(svgEl('rect', { x: 0, y: 0, width: this.svgWidth, height: svgH, fill: '#f1f5f9' }));

        for (const tick of this.getTickDates()) {
            const x = Math.max(0, dateToX(tick.date, this.projectStart, this.dayWidth));

            svg.appendChild(svgEl('line', {
                x1: x, y1: 0, x2: x, y2: svgH,
                stroke: '#cbd5e1', 'stroke-width': 1
            }));

            svg.appendChild(svgEl('text', {
                x: x + 6, y: svgH / 2 + 4,
                fill: '#64748b',
                'font-size': '11',
                'font-family': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                'font-weight': '500'
            })).textContent = tick.label;
        }

        svg.appendChild(svgEl('line', {
            x1: 0, y1: svgH - 1, x2: this.svgWidth, y2: svgH - 1,
            stroke: '#e2e8f0', 'stroke-width': 1
        }));

        headerEl.appendChild(svg);
    }

    // ── SVG Timeline body ────────────────────────────────────────────────────
    renderSVG() {
        const visibleRows = this.rows.filter(r => r.visible);
        const svgHeight = visibleRows.length * ROW_HEIGHT;

        const svg = document.getElementById('gantt-svg');
        svg.innerHTML = '';
        svg.setAttribute('width', this.svgWidth);
        svg.setAttribute('height', svgHeight);

        // Defs (gradient + arrow marker)
        const defs = svgEl('defs');
        defs.appendChild(this.buildGradient());
        defs.appendChild(this.buildArrowMarker());
        svg.appendChild(defs);

        // Grid lines — same intervals as timeline header ticks
        const gridG = svgEl('g', { class: 'grid' });
        for (const tick of this.getTickDates()) {
            const x = Math.max(0, dateToX(tick.date, this.projectStart, this.dayWidth));
            gridG.appendChild(svgEl('line', {
                x1: x, y1: 0, x2: x, y2: svgHeight,
                stroke: '#e2e8f0', 'stroke-width': 1
            }));
        }
        svg.appendChild(gridG);

        // Row backgrounds + bars
        const barsG = svgEl('g', { class: 'bars' });
        let visibleIdx = 0;
        for (const row of this.rows) {
            if (!row.visible) continue;
            const y = visibleIdx * ROW_HEIGHT;

            // Alternating row bg
            if (row.type === 'task' && visibleIdx % 2 === 1) {
                barsG.appendChild(svgEl('rect', {
                    x: 0, y, width: this.svgWidth, height: ROW_HEIGHT,
                    fill: 'rgba(241, 245, 249, 0.5)'
                }));
            }

            // Horizontal row separator
            barsG.appendChild(svgEl('line', {
                x1: 0, y1: y + ROW_HEIGHT, x2: this.svgWidth, y2: y + ROW_HEIGHT,
                stroke: '#f1f5f9', 'stroke-width': 1
            }));

            // Store visible Y for dependency routing
            row.visibleY = y;

            if (row.type === 'phase') {
                barsG.appendChild(this.buildPhaseBar(row, y));
            } else {
                barsG.appendChild(this.buildTaskBar(row, y));
            }

            visibleIdx++;
        }
        svg.appendChild(barsG);

        // Dependency arrows (drawn on top)
        const depsG = svgEl('g', { class: 'dependencies' });
        for (const row of this.rows) {
            if (row.type !== 'task' || !row.visible) continue;
            if (!row.data.dependsOn || row.data.dependsOn.length === 0) continue;

            for (const depId of row.data.dependsOn) {
                const depRow = this.taskMap[depId];
                if (!depRow || !depRow.visible) continue;
                const arrow = this.buildDependencyArrow(depRow, row);
                if (arrow) depsG.appendChild(arrow);
            }
        }
        svg.appendChild(depsG);
    }

    buildGradient() {
        const grad = svgEl('linearGradient', { id: 'taskGrad', x1: '0%', y1: '0%', x2: '100%', y2: '0%' });
        grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#6366f1' }));
        grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#818cf8' }));
        return grad;
    }

    buildArrowMarker() {
        const marker = svgEl('marker', {
            id: 'arrowhead', markerWidth: '8', markerHeight: '6',
            refX: '8', refY: '3', orient: 'auto'
        });
        marker.appendChild(svgEl('polygon', {
            points: '0 0, 8 3, 0 6',
            fill: '#94a3b8'
        }));
        return marker;
    }

    buildPhaseBar(row, y) {
        const g = svgEl('g');
        const d = row.data;
        const x = dateToX(parseDate(d.start), this.projectStart, this.dayWidth);
        const endX = dateToX(parseDate(d.end), this.projectStart, this.dayWidth) + this.dayWidth;
        const w = Math.max(endX - x, 4);
        const barY = y + 8;
        const barH = ROW_HEIGHT - 16;

        // Phase bar: translucent fill, indigo border
        g.appendChild(svgEl('rect', {
            x, y: barY, width: w, height: barH, rx: 4,
            fill: 'rgba(99, 102, 241, 0.12)',
            stroke: '#6366f1',
            'stroke-width': 1.5
        }));

        return g;
    }

    buildTaskBar(row, y) {
        const g = svgEl('g');
        const d = row.data;
        const x = dateToX(parseDate(d.start), this.projectStart, this.dayWidth);
        const endX = dateToX(parseDate(d.end), this.projectStart, this.dayWidth) + this.dayWidth;
        const w = Math.max(endX - x, 4);
        const barY = y + 10;
        const barH = ROW_HEIGHT - 20;

        g.appendChild(svgEl('rect', {
            x, y: barY, width: w, height: barH, rx: 4,
            fill: 'url(#taskGrad)'
        }));

        return g;
    }

    buildDependencyArrow(fromRow, toRow) {
        const fromD = fromRow.data;
        const toD = toRow.data;

        const fromX = dateToX(parseDate(fromD.end), this.projectStart, this.dayWidth) + this.dayWidth;
        const fromY = fromRow.visibleY + ROW_HEIGHT / 2;
        const toX = dateToX(parseDate(toD.start), this.projectStart, this.dayWidth);
        const toY = toRow.visibleY + ROW_HEIGHT / 2;

        const ELBOW = 10; // px to extend right before turning

        let pathD;
        if (fromX + ELBOW * 2 <= toX) {
            // Normal case: predecessor ends before dependent starts with room.
            // Route: right → vertical → right (last segment always goes right → arrowhead points right)
            pathD = `M ${fromX} ${fromY} H ${fromX + ELBOW} V ${toY} H ${toX}`;
        } else {
            // Overlap case: predecessor ends after (or close to) dependent start.
            // Drop below/above the predecessor row, travel horizontally, then approach the bar from the left.
            const approachX = Math.max(ELBOW, toX - ELBOW);
            const detourY = fromY < toY
                ? fromRow.visibleY + ROW_HEIGHT + 4   // route below the predecessor row
                : fromRow.visibleY - 4;                // route above the predecessor row
            pathD = `M ${fromX} ${fromY} H ${fromX + ELBOW} V ${detourY} H ${approachX} V ${toY} H ${toX}`;
        }

        return svgEl('path', {
            d: pathD,
            fill: 'none',
            stroke: '#94a3b8',
            'stroke-width': 1.5,
            'marker-end': 'url(#arrowhead)'
        });
    }

    // ── Scroll sync ──────────────────────────────────────────────────────────
    setupScrollSync() {
        const leftRows = document.getElementById('gantt-left-rows');
        const rightBody = document.getElementById('gantt-timeline-body');
        const rightHeader = document.getElementById('gantt-timeline-header');

        let syncing = false;

        leftRows.addEventListener('scroll', () => {
            if (syncing) return;
            syncing = true;
            rightBody.scrollTop = leftRows.scrollTop;
            syncing = false;
        });

        rightBody.addEventListener('scroll', () => {
            if (syncing) return;
            syncing = true;
            leftRows.scrollTop = rightBody.scrollTop;
            rightHeader.scrollLeft = rightBody.scrollLeft;
            syncing = false;
        });
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load and render a project into the gantt chart.
 * @param {object} data - The parsed gantt JSON
 */
function loadGanttProject(data) {
    const ganttContainer = document.getElementById('gantt-container');
    const emptyState = document.getElementById('empty-state');

    // Show gantt, hide empty state
    emptyState.style.display = 'none';
    ganttContainer.style.display = 'flex';

    const chart = new GanttChart(data);
    chart.render();

    // Re-render on resize so dayWidth stays proportional to window width
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => chart.render(), 150);
    });
}

window.GanttChart = GanttChart;
window.loadGanttProject = loadGanttProject;
