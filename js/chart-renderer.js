/**
 * Chart Renderer
 * Genera grafici SVG avanzati per le metriche
 */

export class ChartRenderer {
    
    /**
     * GAUGE METER - Indicatore semicircolare
     */
    static renderGauge(containerId, value, max = 100, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const {
            label = '',
            colorStops = [
                { stop: 30, color: '#ff4444' },
                { stop: 60, color: '#ffcc00' },
                { stop: 100, color: '#00ff88' }
            ]
        } = options;

        const percentage = Math.min(100, Math.max(0, (value / max) * 100));
        const color = this.getColorForValue(percentage, colorStops);
        
        // Arc parameters
        const radius = 70;
        const circumference = Math.PI * radius;
        const offset = circumference - (percentage / 100) * circumference;

        container.innerHTML = `
            <div class="gauge-container">
                <svg class="gauge-svg" viewBox="0 0 180 100">
                    <defs>
                        <filter id="glow-${containerId}">
                            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                            <feMerge>
                                <feMergeNode in="coloredBlur"/>
                                <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                        </filter>
                    </defs>
                    <!-- Background arc -->
                    <path class="gauge-bg" 
                          d="M 20 90 A 70 70 0 0 1 160 90" />
                    <!-- Value arc -->
                    <path class="gauge-fill" 
                          d="M 20 90 A 70 70 0 0 1 160 90"
                          stroke="${color}"
                          stroke-dasharray="${circumference}"
                          stroke-dashoffset="${offset}"
                          filter="url(#glow-${containerId})" />
                    <!-- Value text -->
                    <text x="90" y="75" class="gauge-value">${Math.round(value)}</text>
                    <text x="90" y="95" class="gauge-label">${label}</text>
                </svg>
            </div>
        `;
    }

    static getColorForValue(value, colorStops) {
        for (const stop of colorStops) {
            if (value <= stop.stop) return stop.color;
        }
        return colorStops[colorStops.length - 1].color;
    }

    /**
     * RADAR CHART - Grafico a ragnatela
     */
    static renderRadar(containerId, data, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const { size = 280, levels = 5 } = options;
        const center = size / 2;
        const radius = (size / 2) - 40;
        const labels = Object.keys(data);
        const values = Object.values(data);
        const angleStep = (2 * Math.PI) / labels.length;

        // Generate grid
        let gridPaths = '';
        for (let level = 1; level <= levels; level++) {
            const r = (radius / levels) * level;
            const points = labels.map((_, i) => {
                const angle = angleStep * i - Math.PI / 2;
                return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
            }).join(' ');
            gridPaths += `<polygon class="radar-grid" points="${points}" />`;
        }

        // Generate axes
        let axes = '';
        labels.forEach((_, i) => {
            const angle = angleStep * i - Math.PI / 2;
            const x = center + radius * Math.cos(angle);
            const y = center + radius * Math.sin(angle);
            axes += `<line class="radar-axis" x1="${center}" y1="${center}" x2="${x}" y2="${y}" />`;
        });

        // Generate data polygon
        const dataPoints = values.map((val, i) => {
            const r = (val / 100) * radius;
            const angle = angleStep * i - Math.PI / 2;
            return `${center + r * Math.cos(angle)},${center + r * Math.sin(angle)}`;
        }).join(' ');

        // Generate points
        let points = '';
        values.forEach((val, i) => {
            const r = (val / 100) * radius;
            const angle = angleStep * i - Math.PI / 2;
            const x = center + r * Math.cos(angle);
            const y = center + r * Math.sin(angle);
            points += `<circle class="radar-point" cx="${x}" cy="${y}" r="5" data-value="${val}" />`;
        });

        // Generate labels
        let labelElements = '';
        labels.forEach((label, i) => {
            const angle = angleStep * i - Math.PI / 2;
            const labelRadius = radius + 25;
            const x = center + labelRadius * Math.cos(angle);
            const y = center + labelRadius * Math.sin(angle);
            const displayLabel = this.translateMuscle(label);
            labelElements += `<text class="radar-label" x="${x}" y="${y}" dy="0.35em">${displayLabel}</text>`;
        });

        container.innerHTML = `
            <div class="radar-container">
                <svg class="radar-svg" viewBox="0 0 ${size} ${size}">
                    ${gridPaths}
                    ${axes}
                    <polygon class="radar-area" points="${dataPoints}" />
                    ${points}
                    ${labelElements}
                </svg>
            </div>
        `;
    }

    static translateMuscle(key) {
        const translations = {
            chest: 'Petto',
            back: 'Dorso',
            shoulders: 'Spalle',
            biceps: 'Bicipiti',
            triceps: 'Tricipiti',
            legs: 'Gambe',
            core: 'Core'
        };
        return translations[key] || key;
    }

    // Expose as instance method too
    translateMuscle(key) {
        return ChartRenderer.translateMuscle(key);
    }

    /**
     * LINE CHART - Grafico a linee con area
     */
    static renderLineChart(containerId, dataPoints, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!dataPoints || dataPoints.length === 0) {
            container.innerHTML = '<p style="text-align:center; color: var(--color-text-muted);">Dati insufficienti</p>';
            return;
        }

        const { width = 400, height = 180, unit = 'kg' } = options;
        const padding = { top: 20, right: 20, bottom: 30, left: 45 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        const values = dataPoints.map(d => d.value);
        const minVal = Math.min(...values) * 0.95;
        const maxVal = Math.max(...values) * 1.05;
        const range = maxVal - minVal || 1;

        // Scale functions
        const xScale = (i) => padding.left + (i / (dataPoints.length - 1 || 1)) * chartWidth;
        const yScale = (v) => padding.top + chartHeight - ((v - minVal) / range) * chartHeight;

        // Generate path
        const linePath = dataPoints.map((d, i) => 
            `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.value)}`
        ).join(' ');

        // Area path
        const areaPath = linePath + 
            ` L ${xScale(dataPoints.length - 1)} ${padding.top + chartHeight}` +
            ` L ${padding.left} ${padding.top + chartHeight} Z`;

        // Grid lines
        let gridLines = '';
        const gridCount = 4;
        for (let i = 0; i <= gridCount; i++) {
            const y = padding.top + (chartHeight / gridCount) * i;
            const val = maxVal - (range / gridCount) * i;
            gridLines += `<line class="chart-grid-line" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />`;
            gridLines += `<text x="${padding.left - 5}" y="${y}" fill="var(--color-text-muted)" font-size="10" text-anchor="end" dy="0.35em">${Math.round(val)}</text>`;
        }

        // Points
        let points = '';
        dataPoints.forEach((d, i) => {
            points += `<circle class="chart-point" cx="${xScale(i)}" cy="${yScale(d.value)}" r="5" 
                        data-date="${d.date}" data-value="${d.value}" />`;
        });

        // X-axis labels (show first, middle, last)
        let xLabels = '';
        const labelIndices = [0, Math.floor(dataPoints.length / 2), dataPoints.length - 1];
        labelIndices.forEach(i => {
            if (dataPoints[i]) {
                const date = new Date(dataPoints[i].date);
                const label = date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
                xLabels += `<text x="${xScale(i)}" y="${height - 5}" fill="var(--color-text-muted)" font-size="10" text-anchor="middle">${label}</text>`;
            }
        });

        container.innerHTML = `
            <div class="line-chart-container" style="position: relative;">
                <svg class="line-chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
                    <defs>
                        <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="var(--color-primary)" stop-opacity="0.4"/>
                            <stop offset="100%" stop-color="var(--color-primary)" stop-opacity="0"/>
                        </linearGradient>
                        <filter id="lineGlow">
                            <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                            <feMerge>
                                <feMergeNode in="coloredBlur"/>
                                <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                        </filter>
                    </defs>
                    ${gridLines}
                    <path class="chart-area" d="${areaPath}" />
                    <path class="chart-line" d="${linePath}" filter="url(#lineGlow)" />
                    ${points}
                    ${xLabels}
                </svg>
                <div class="chart-tooltip" id="tooltip-${containerId}"></div>
            </div>
        `;

        // Add tooltip interaction
        const svg = container.querySelector('svg');
        const tooltip = container.querySelector('.chart-tooltip');
        
        svg.querySelectorAll('.chart-point').forEach(point => {
            point.addEventListener('mouseenter', (e) => {
                const date = e.target.dataset.date;
                const value = e.target.dataset.value;
                tooltip.innerHTML = `<strong>${value} ${unit}</strong><br>${new Date(date).toLocaleDateString('it-IT')}`;
                tooltip.classList.add('visible');
            });
            
            point.addEventListener('mousemove', (e) => {
                const rect = container.getBoundingClientRect();
                tooltip.style.left = (e.clientX - rect.left + 10) + 'px';
                tooltip.style.top = (e.clientY - rect.top - 30) + 'px';
            });
            
            point.addEventListener('mouseleave', () => {
                tooltip.classList.remove('visible');
            });
        });
    }

    /**
     * DONUT CHART - Grafico a ciambella
     */
    static renderDonut(containerId, data, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const { size = 200, centerLabel = '', centerValue = '' } = options;
        const radius = 70;
        const circumference = 2 * Math.PI * radius;
        
        const colors = ['#00f3ff', '#00ff88', '#ff8844', '#ff6b6b', '#a855f7', '#fbbf24', '#ec4899'];
        const entries = Object.entries(data).filter(([_, v]) => v > 0);
        const total = entries.reduce((sum, [_, v]) => sum + v, 0) || 1;

        let segments = '';
        let offset = 0;
        let legendItems = '';

        entries.forEach(([key, value], i) => {
            const percentage = (value / total) * 100;
            const dashLength = (percentage / 100) * circumference;
            const color = colors[i % colors.length];
            
            segments += `
                <circle class="donut-segment" 
                        cx="${size/2}" cy="${size/2}" r="${radius}"
                        stroke="${color}"
                        stroke-dasharray="${dashLength} ${circumference - dashLength}"
                        stroke-dashoffset="${-offset}"
                        data-label="${this.translateMuscle(key)}"
                        data-value="${percentage.toFixed(1)}%" />
            `;
            offset += dashLength;

            legendItems += `
                <div class="donut-legend-item">
                    <div class="donut-legend-color" style="background: ${color}"></div>
                    <span>${this.translateMuscle(key)} (${percentage.toFixed(0)}%)</span>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="donut-container" style="width: ${size}px; height: ${size}px;">
                <svg class="donut-svg" viewBox="0 0 ${size} ${size}">
                    ${segments}
                </svg>
                <div class="donut-center">
                    <div class="donut-center-value">${centerValue}</div>
                    <div class="donut-center-label">${centerLabel}</div>
                </div>
            </div>
            <div class="donut-legend">${legendItems}</div>
        `;
    }

    /**
     * CONSISTENCY CALENDAR - Heatmap stile GitHub
     */
    static renderCalendar(containerId, calendarData) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const { calendar, currentStreak, maxStreak, consistencyRate } = calendarData;
        
        // Raggruppa per settimana
        const weeks = [];
        let currentWeek = [];
        
        calendar.forEach((day, i) => {
            currentWeek.push(day);
            if (currentWeek.length === 7 || i === calendar.length - 1) {
                weeks.push([...currentWeek]);
                currentWeek = [];
            }
        });

        // Genera HTML
        const dayLabels = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];
        
        let calendarHTML = '<div class="calendar-heatmap">';
        
        // Day labels
        calendarHTML += '<div style="display: flex;">';
        calendarHTML += '<div class="calendar-day-labels">';
        dayLabels.forEach((label, i) => {
            if (i % 2 === 1) { // Show only odd days
                calendarHTML += `<div class="calendar-day-label">${label}</div>`;
            } else {
                calendarHTML += `<div class="calendar-day-label"></div>`;
            }
        });
        calendarHTML += '</div>';
        
        // Calendar grid
        calendarHTML += '<div style="display: flex; gap: 3px;">';
        weeks.forEach(week => {
            calendarHTML += '<div class="calendar-row" style="flex-direction: column;">';
            week.forEach(day => {
                const title = `${day.date}: ${day.volume > 0 ? Math.round(day.volume/1000) + 'k volume' : 'Riposo'}`;
                calendarHTML += `<div class="calendar-day" data-intensity="${day.intensity}" title="${title}"></div>`;
            });
            calendarHTML += '</div>';
        });
        calendarHTML += '</div></div>';
        
        // Stats
        calendarHTML += `
            <div style="display: flex; justify-content: space-around; margin-top: 1rem; text-align: center;">
                <div>
                    <div class="streak-badge">
                        <span class="fire">🔥</span>
                        <span class="count">${currentStreak}</span>
                        <span>giorni</span>
                    </div>
                    <div style="font-size: 0.7rem; color: var(--color-text-muted); margin-top: 0.25rem;">Streak Attuale</div>
                </div>
                <div>
                    <div style="font-family: var(--font-display); font-size: 1.5rem; color: var(--color-primary);">${consistencyRate}%</div>
                    <div style="font-size: 0.7rem; color: var(--color-text-muted);">Costanza</div>
                </div>
                <div>
                    <div style="font-family: var(--font-display); font-size: 1.5rem; color: #ff8844;">${maxStreak}</div>
                    <div style="font-size: 0.7rem; color: var(--color-text-muted);">Record Streak</div>
                </div>
            </div>
        `;
        
        calendarHTML += '</div>';
        container.innerHTML = calendarHTML;
    }

    /**
     * SCATTER PLOT - Correlazione
     */
    static renderScatter(containerId, dataPoints, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const { width = 350, height = 200, xLabel = 'X', yLabel = 'Y' } = options;
        const padding = { top: 20, right: 20, bottom: 35, left: 45 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        if (!dataPoints || dataPoints.length < 2) {
            container.innerHTML = '<p style="text-align:center; color: var(--color-text-muted);">Dati insufficienti per la correlazione</p>';
            return;
        }

        const xValues = dataPoints.map(d => d.x);
        const yValues = dataPoints.map(d => d.y);
        
        const xMin = Math.min(...xValues) * 0.9;
        const xMax = Math.max(...xValues) * 1.1;
        const yMin = Math.min(...yValues) * 0.9;
        const yMax = Math.max(...yValues) * 1.1;

        const xScale = (v) => padding.left + ((v - xMin) / (xMax - xMin)) * chartWidth;
        const yScale = (v) => padding.top + chartHeight - ((v - yMin) / (yMax - yMin)) * chartHeight;

        // Points
        let points = '';
        dataPoints.forEach(d => {
            points += `<circle class="scatter-point" cx="${xScale(d.x)}" cy="${yScale(d.y)}" r="6" 
                        data-x="${d.x}" data-y="${d.y.toFixed(1)}" />`;
        });

        // Trend line (linear regression)
        const n = dataPoints.length;
        const sumX = xValues.reduce((a, b) => a + b, 0);
        const sumY = yValues.reduce((a, b) => a + b, 0);
        const sumXY = dataPoints.reduce((s, d) => s + d.x * d.y, 0);
        const sumX2 = xValues.reduce((s, x) => s + x * x, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        const trendY1 = slope * xMin + intercept;
        const trendY2 = slope * xMax + intercept;

        container.innerHTML = `
            <div class="scatter-container">
                <svg class="scatter-svg" viewBox="0 0 ${width} ${height}">
                    <!-- Grid -->
                    <line x1="${padding.left}" y1="${padding.top + chartHeight}" 
                          x2="${width - padding.right}" y2="${padding.top + chartHeight}" 
                          stroke="rgba(255,255,255,0.2)" />
                    <line x1="${padding.left}" y1="${padding.top}" 
                          x2="${padding.left}" y2="${padding.top + chartHeight}" 
                          stroke="rgba(255,255,255,0.2)" />
                    
                    <!-- Trend line -->
                    <line class="scatter-trend-line" 
                          x1="${xScale(xMin)}" y1="${yScale(trendY1)}"
                          x2="${xScale(xMax)}" y2="${yScale(trendY2)}" />
                    
                    <!-- Points -->
                    ${points}
                    
                    <!-- Labels -->
                    <text class="scatter-axis-label" x="${width/2}" y="${height - 5}" text-anchor="middle">${xLabel}</text>
                    <text class="scatter-axis-label" x="12" y="${height/2}" text-anchor="middle" transform="rotate(-90, 12, ${height/2})">${yLabel}</text>
                </svg>
            </div>
        `;
    }

    /**
     * PROGRESS BAR - Barra di progresso
     */
    static renderProgressBar(containerId, value, max, label, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const percentage = Math.min(100, (value / max) * 100);
        const { showValue = true, colorClass = '' } = options;
        
        let fillClass = 'progress-bar-fill';
        if (percentage < 30) fillClass += ' danger';
        else if (percentage < 60) fillClass += ' warning';

        container.innerHTML = `
            <div class="progress-bar-container">
                <div class="progress-bar-header">
                    <span class="progress-bar-label">${label}</span>
                    ${showValue ? `<span class="progress-bar-value">${Math.round(value)}/${max}</span>` : ''}
                </div>
                <div class="progress-bar-track">
                    <div class="${fillClass}" style="width: ${percentage}%"></div>
                </div>
            </div>
        `;
    }
}

export default ChartRenderer;
