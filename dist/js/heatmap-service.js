import { EXERCISE_DB, MUSCLE_GROUPS } from './exercise-db.js';
import { MUSCLE_PATHS, BODY_SILHOUETTE, DETAIL_LINES, BODY_VIEWBOX } from './muscle-model.js';

const DEFAULT_VIEWBOX = BODY_VIEWBOX || "0 0 360 720";

export class HeatmapService {
    constructor() {
        this.muscleFatigue = {}; // Stores muscle -> score (0-100)
    }

    /**
     * Calculates muscle fatigue based on logs from the last X days.
     * @param {Array} logs - The user's workout logs
     * @param {number} days - Lookback period (default 7)
     */
    calculateFatigue(logs, days = 7) {
        this.muscleFatigue = {};
        const now = new Date();
        const cutoff = new Date();
        cutoff.setDate(now.getDate() - days);

        // Initialize all groups to 0
        Object.keys(MUSCLE_GROUPS).forEach(key => this.muscleFatigue[key] = 0);

        logs.forEach(log => {
            const logDate = new Date(log.date);
            if (logDate < cutoff) return;

            // Calculate decay factor (older workouts count less)
            const daysAgo = Math.floor((now - logDate) / (1000 * 60 * 60 * 24));
            const recencyMultiplier = Math.max(0.2, 1 - (daysAgo * 0.1)); // 1.0 today, 0.3 a week ago

            if (log.exercises) {
                log.exercises.forEach(ex => {
                    const name = ex.name.toLowerCase();
                    // Find partial match in DB
                    const dbKey = Object.keys(EXERCISE_DB).find(k => name.includes(k));
                    
                    if (dbKey) {
                        const muscles = EXERCISE_DB[dbKey];
                        const setVolume = ex.sets.length; // Use set count as volume proxy
                        
                        muscles.forEach(muscle => {
                            if (!this.muscleFatigue[muscle]) this.muscleFatigue[muscle] = 0;
                            // Add fatigue: Sets * Recency
                            this.muscleFatigue[muscle] += (setVolume * 20 * recencyMultiplier);
                        });
                    }
                });
            }
        });

        // Cap at 100
        Object.keys(this.muscleFatigue).forEach(k => {
            this.muscleFatigue[k] = Math.min(100, this.muscleFatigue[k]);
        });

        return this.muscleFatigue;
    }

    /**
     * Generates the SVG HTML for the heatmap
     */
    renderSVG(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        // Add global tooltip if not exists
        let tooltip = document.getElementById('heatmap-tooltip');
        if (!tooltip) {
            tooltip = document.createElement('div');
            tooltip.id = 'heatmap-tooltip';
            tooltip.className = 'heatmap-tooltip';
            document.body.appendChild(tooltip);
            
            // Global styles for tooltip
            const style = document.createElement('style');
            style.innerHTML = `
                .heatmap-tooltip {
                    position: fixed;
                    background: rgba(0, 0, 0, 0.9);
                    color: #fff;
                    padding: 0.5rem 1rem;
                    border-radius: 8px;
                    font-size: 0.8rem;
                    pointer-events: none;
                    z-index: 9999;
                    opacity: 0;
                    transition: opacity 0.2s;
                    border: 1px solid var(--color-primary);
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                    transform: translate(-50%, -120%);
                }
                .muscle-path {
                    cursor: pointer;
                    transition: opacity 0.2s;
                }
                .muscle-path:hover {
                    filter: brightness(1.3);
                }
            `;
            document.head.appendChild(style);
        }

        // Event delegation for tooltips
        const handleInteraction = (e) => {
            const target = e.target.closest('.muscle-path');
            if (target) {
                const label = target.querySelector('title')?.textContent || '';
                if (label) {
                    tooltip.textContent = label;
                    tooltip.style.opacity = '1';
                    tooltip.style.left = e.clientX + 'px';
                    tooltip.style.top = e.clientY + 'px';
                }
            } else {
                tooltip.style.opacity = '0';
            }
        };

        // Attach listeners to document or specific container if possible, 
        // but since SVG is injected, we can attach to container after injection
        // or use a persistent listener. Let's attach to container.
        
        // Clean up old listeners if re-rendering? 
        // For simplicity in this architecture, we'll assume container is stable or just add listener.
        // Better: add inline onmousemove to the SVG wrapper.

        const getColor = (muscle) => {
            const fatigue = this.muscleFatigue[muscle] || 0;
            if (fatigue <= 0) return "rgba(255,255,255,0.06)"; // Idle
            if (fatigue < 30) return "rgba(0,243,255,0.35)"; // Low
            if (fatigue < 70) return "var(--color-primary)"; // Med
            return "#ff5c5c"; // High/Recovery needed
        };

        const getOpacity = (muscle) => {
            const fatigue = this.muscleFatigue[muscle] || 0;
            if (fatigue === 0) return 0.55;
            return Math.min(1, 0.55 + (fatigue / 130)); // Glow brighter with heat
        };

        const sanitizePath = (value = "") => {
            if (typeof value !== "string") return "";
            return value.replace(/\s+/g, " ").trim();
        };

        const buildMusclePaths = (view) => {
            const viewPaths = MUSCLE_PATHS[view] || {};
            return Object.entries(viewPaths).map(([muscle, path]) => {
                const d = sanitizePath(path);
                if (!d) return "";
                const label = MUSCLE_GROUPS[muscle]?.label || muscle;
                return `<path d="${d}" fill="${getColor(muscle)}" stroke="rgba(255,255,255,0.22)" stroke-width="1" class="muscle-path" data-muscle="${muscle}" style="opacity:${getOpacity(muscle)}" vector-effect="non-scaling-stroke" filter="url(#${view}-heatGlow)"><title>${label}</title></path>`;
            }).join("");
        };

        const renderSilhouette = (view) => {
            const raw = BODY_SILHOUETTE?.[view];
            if (!raw) return "";
            return `<path d="${sanitizePath(raw)}" fill="url(#${view}-bodyGradient)" stroke="rgba(255,255,255,0.12)" stroke-width="1.4" vector-effect="non-scaling-stroke"></path>`;
        };

        const renderGuides = (view) => {
            const paths = DETAIL_LINES?.[view] || [];
            return paths.map((line, index) => {
                const d = sanitizePath(line);
                if (!d) return "";
                const opacity = index === 0 ? 0.25 : 0.12;
                const width = index === 0 ? 1.4 : 0.8;
                return `<path d="${d}" fill="none" stroke="rgba(255,255,255,${opacity})" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"></path>`;
            }).join("");
        };

        const renderFigure = (view, title) => {
            const defs = `
                <defs>
                    <linearGradient id="${view}-bodyGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="rgba(255,255,255,0.08)" />
                        <stop offset="50%" stop-color="rgba(255,255,255,0.04)" />
                        <stop offset="100%" stop-color="rgba(255,255,255,0.02)" />
                    </linearGradient>
                    <filter id="${view}-heatGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur"></feGaussianBlur>
                        <feMerge>
                            <feMergeNode in="blur"></feMergeNode>
                            <feMergeNode in="SourceGraphic"></feMergeNode>
                        </feMerge>
                    </filter>
                </defs>
            `;

            return `
                <div class="heatmap-figure" style="flex:1; min-width:160px; display:flex; flex-direction:column; align-items:center; gap:0.4rem;">
                    <h4 style="text-transform:uppercase; letter-spacing:1px; font-size:0.78rem; color:var(--color-text-muted);">Heatmap Muscolare - ${title}</h4>
                    <div style="width:190px; aspect-ratio:9/16; padding:0.8rem; border-radius:28px; background:linear-gradient(180deg, rgba(0,243,255,0.08) 0%, rgba(0,243,255,0.02) 100%); box-shadow:inset 0 0 30px rgba(0,243,255,0.08), 0 10px 25px rgba(0,0,0,0.35);">
                        <svg viewBox="${DEFAULT_VIEWBOX}" role="img" aria-label="Heatmap muscolare ${title.toLowerCase()}" style="width:100%; height:100%; overflow:visible;" onmousemove="window.heatmapTooltipMove(event)" onmouseleave="window.heatmapTooltipHide()" onclick="window.heatmapTooltipMove(event)">
                            ${defs}
                            ${renderSilhouette(view)}
                            ${renderGuides(view)}
                            ${buildMusclePaths(view)}
                        </svg>
                    </div>
                </div>
            `;
        };

        // Add global handlers to window if not present
        if (!window.heatmapTooltipMove) {
            window.heatmapTooltipMove = (e) => {
                const target = e.target.closest('.muscle-path');
                const tooltip = document.getElementById('heatmap-tooltip');
                if (target && tooltip) {
                    const label = target.querySelector('title')?.textContent || '';
                    if (label) {
                        tooltip.textContent = label;
                        tooltip.style.opacity = '1';
                        tooltip.style.left = e.clientX + 'px';
                        tooltip.style.top = e.clientY + 'px';
                        return;
                    }
                }
                if (tooltip) tooltip.style.opacity = '0';
            };
            
            window.heatmapTooltipHide = () => {
                const tooltip = document.getElementById('heatmap-tooltip');
                if (tooltip) tooltip.style.opacity = '0';
            };
        }

        const figures = `
            <div class="heatmap-canvas" style="display:flex; flex-wrap:wrap; justify-content:center; gap:1.5rem;">
                ${renderFigure('front', 'Vista Frontale')}
                ${renderFigure('back', 'Vista Posteriore')}
            </div>
        `;

        const legend = `
            <div style="display:flex; justify-content:center; gap:1rem; flex-wrap:wrap; margin-top:1rem; font-size:0.78rem; color:var(--color-text-muted);">
                <span style="display:flex; align-items:center; gap:6px;">
                    <div style="width:14px; height:14px; border-radius:50%; background:rgba(255,255,255,0.12);"></div> Riposo
                </span>
                <span style="display:flex; align-items:center; gap:6px;">
                    <div style="width:14px; height:14px; border-radius:50%; background:var(--color-primary-dim);"></div> Stimolo Leggero
                </span>
                <span style="display:flex; align-items:center; gap:6px;">
                    <div style="width:14px; height:14px; border-radius:50%; background:var(--color-primary);"></div> Zona Attiva
                </span>
                <span style="display:flex; align-items:center; gap:6px;">
                    <div style="width:14px; height:14px; border-radius:50%; background:#ff5c5c;"></div> Sovraccarico
                </span>
            </div>
        `;

        container.innerHTML = `${figures}${legend}`;
    }
}

export const heatmapService = new HeatmapService();

