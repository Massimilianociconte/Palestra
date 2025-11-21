const DAY_MS = 24 * 60 * 60 * 1000;

const includesAny = (value = '', keywords = []) => {
    const lower = (value || '').toLowerCase();
    return keywords.some(k => lower.includes(k));
};

const average = (values = []) => {
    if (!values.length) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
};

const sum = (values = []) => values.reduce((acc, val) => acc + val, 0);

const percentChange = (current, previous) => {
    if (!previous) return current ? 100 : 0;
    return ((current - previous) / Math.abs(previous)) * 100;
};

const getGoalDirection = (profile = {}) => {
    const goal = (profile.goal || profile.objective || '').toLowerCase();
    if (includesAny(goal, ['cut', 'deficit', 'lean', 'perdita', 'definiz'])) return 'down';
    if (includesAny(goal, ['bulk', 'massa', 'strength', 'ipertrof', 'gain'])) return 'up';
    return 'neutral';
};

const METRIC_CONFIG = {
    frequency: {
        id: 'frequency',
        label: 'Frequenza Allenamenti',
        higherIsBetter: true,
        formatter: (value) => `${value.toFixed(1)} sessioni/settimana`
    },
    volume: {
        id: 'volume',
        label: 'Volume Medio',
        higherIsBetter: true,
        formatter: (value, ctx) => {
            const unit = ctx.unit === 'imperial' ? 'lbs' : 'kg';
            return `${Math.round(value)} ${unit}`
        }
    },
    bodyWeight: {
        id: 'bodyWeight',
        label: 'Peso Corporeo',
        formatter: (value, ctx) => `${value.toFixed(1)} ${ctx.unit === 'imperial' ? 'lbs' : 'kg'}`
    },
    prs: {
        id: 'prs',
        label: 'Progressione PR',
        higherIsBetter: true,
        formatter: (value, ctx) => `${ctx.unit === 'imperial' ? (value * 2.20462).toFixed(1) : value.toFixed(1)} ${ctx.unit === 'imperial' ? 'lbs' : 'kg'}`
    },
    consistency: {
        id: 'consistency',
        label: 'Costanza',
        higherIsBetter: true,
        formatter: (value) => `${Math.round(value * 100)}%`
    },
    sleepQuality: {
        id: 'sleepQuality',
        label: 'Qualità Sonno',
        higherIsBetter: true,
        formatter: (value) => `${value.toFixed(1)} / 10`
    },
    energyLevel: {
        id: 'energyLevel',
        label: 'Energia Giornaliera',
        higherIsBetter: true,
        formatter: (value) => `${value.toFixed(1)} / 10`
    },
    stressLevel: {
        id: 'stressLevel',
        label: 'Stress',
        higherIsBetter: false,
        formatter: (value) => `${value.toFixed(1)} / 10`
    },
    sorenessLevel: {
        id: 'sorenessLevel',
        label: 'DOMS / Dolore',
        higherIsBetter: false,
        formatter: (value) => `${value.toFixed(1)} / 10`
    }
};

const evalTrendDirection = (metricId, current, previous, context = {}) => {
    const config = METRIC_CONFIG[metricId] || {};
    const delta = current - previous;
    const pct = percentChange(current, previous);

    if (metricId === 'bodyWeight') {
        const goalDirection = getGoalDirection(context.profile);
        if (goalDirection === 'neutral') {
            return {
                status: Math.abs(pct) > 2 ? 'variant' : 'stable',
                sentiment: 'neutral',
                delta,
                pct
            };
        }
        const improving = goalDirection === 'down' ? delta < -0.2 : delta > 0.2;
        return {
            status: improving ? 'improving' : 'declining',
            sentiment: improving ? 'positive' : 'negative',
            delta,
            pct
        };
    }

    if (Math.abs(pct) < 5) {
        return {
            status: 'stable',
            sentiment: 'neutral',
            delta,
            pct
        };
    }

    const positive = config.higherIsBetter ? delta > 0 : delta < 0;

    return {
        status: positive ? 'improving' : 'declining',
        sentiment: positive ? 'positive' : 'negative',
        delta,
        pct
    };
};

const getVolumePerSession = (logs = []) => {
    if (!logs.length) return 0;
    return sum(logs.map(log => log.totalVolume || 0)) / logs.length;
};

const getTrainingDays = (logs = []) => {
    const days = new Set();
    logs.forEach(log => {
        const day = (log.date || '').slice(0, 10);
        if (day) days.add(day);
    });
    return days.size;
};

const getConsistency = (logs = []) => {
    if (!logs.length) return 0;
    const first = new Date(logs[logs.length - 1].date);
    const last = new Date(logs[0].date);
    const weeks = Math.max(1, (last - first) / (DAY_MS * 7));
    const trainingDays = getTrainingDays(logs);
    const theoreticalDays = weeks * 4;
    return Math.min(1, trainingDays / theoreticalDays);
};

const getPRSnapshot = (logs = []) => {
    const prs = {};
    logs.forEach(log => {
        (log.exercises || []).forEach(ex => {
            (ex.sets || []).forEach(set => {
                const w = parseFloat(set.weight);
                const r = parseFloat(set.reps);
                if (!w || !r) return;
                const estimate = w * (1 + r / 30);
                if (!prs[ex.name] || estimate > prs[ex.name]) {
                    prs[ex.name] = estimate;
                }
            });
        });
    });

    const values = Object.values(prs);
    if (!values.length) return 0;
    return average(values);
};

const bucketizeLogs = (logs = [], days = 14) => {
    const now = Date.now();
    const recentCutoff = now - (days * DAY_MS);
    const prevCutoff = now - (days * 2 * DAY_MS);

    const recent = [];
    const previous = [];

    logs.forEach(log => {
        const time = new Date(log.date).getTime();
        if (Number.isNaN(time)) return;
        if (time >= recentCutoff) recent.push(log);
        else if (time >= prevCutoff) previous.push(log);
    });

    return { recent, previous };
};

const bucketizeBodyStats = (stats = [], days = 14) => {
    const now = Date.now();
    const recentCutoff = now - (days * DAY_MS);
    const prevCutoff = now - (days * 2 * DAY_MS);

    const recent = [];
    const previous = [];

    stats.forEach(stat => {
        const time = new Date(stat.date || stat.recordedAt).getTime();
        if (Number.isNaN(time)) return;
        if (time >= recentCutoff) recent.push(stat);
        else if (time >= prevCutoff) previous.push(stat);
    });

    return { recent, previous };
};

const getAverageWellness = (logs = [], field) => {
    const values = logs
        .map(log => log.wellness?.[field])
        .filter(val => typeof val === 'number' && !Number.isNaN(val));
    return values.length ? average(values) : 0;
};

const formatDeltaText = (metricId, trend) => {
    const arrow = trend.status === 'improving'
        ? '⬆️'
        : trend.status === 'declining'
            ? '⬇️'
            : '➡️';

    const pct = trend.pct ? `${trend.pct > 0 ? '+' : ''}${trend.pct.toFixed(1)}%` : '';
    return `${arrow} ${pct}`;
};

const buildHeuristicSummary = (metrics = []) => {
    if (!metrics.length) {
        return 'Non ci sono dati sufficienti per valutare l’andamento recente. Registra qualche allenamento e riprova.';
    }

    const positives = metrics.filter(m => m.status === 'improving');
    const negatives = metrics.filter(m => m.status === 'declining');

    const positiveText = positives.length
        ? `Buone notizie su ${positives.map(p => p.label).join(', ')}`
        : 'Nessun miglioramento evidente negli ultimi log';

    const negativeText = negatives.length
        ? `Attenzione su ${negatives.map(n => n.label).join(', ')}`
        : 'Nessuna regressione significativa rilevata';

    return `${positiveText}. ${negativeText}. Continua a registrare i dati per un monitoraggio più preciso.`;
};

export const trendEngine = {
    evaluate({ logs = [], bodyStats = [], profile = {}, unit = 'metric' }) {
        const { recent: recentLogs, previous: prevLogs } = bucketizeLogs(logs);
        const { recent: recentStats, previous: prevStats } = bucketizeBodyStats(bodyStats);

        const recentFrequency = getTrainingDays(recentLogs) / 2; // approx per week
        const prevFrequency = getTrainingDays(prevLogs) / 2;

        const recentVolume = getVolumePerSession(recentLogs);
        const prevVolume = getVolumePerSession(prevLogs);

        const recentWeight = recentStats.length ? average(recentStats.map(s => s.weight)) : 0;
        const prevWeight = prevStats.length ? average(prevStats.map(s => s.weight)) : 0;

        const recentPR = getPRSnapshot(recentLogs);
        const prevPR = getPRSnapshot(prevLogs);

        const recentConsistency = getConsistency(recentLogs.concat(prevLogs));
        const prevConsistency = getConsistency(prevLogs);

        const ctx = { unit: unit === 'imperial' ? 'imperial' : 'metric', profile };
        const wellnessMetrics = [];

        const recentSleep = getAverageWellness(recentLogs, 'sleepQuality');
        const prevSleep = getAverageWellness(prevLogs, 'sleepQuality');
        if (recentSleep || prevSleep) {
            wellnessMetrics.push({
                ...METRIC_CONFIG.sleepQuality,
                current: recentSleep || prevSleep,
                previous: prevSleep || recentSleep,
                ...evalTrendDirection('sleepQuality', recentSleep || prevSleep, prevSleep || recentSleep, ctx)
            });
        }

        const recentEnergy = getAverageWellness(recentLogs, 'energyLevel');
        const prevEnergy = getAverageWellness(prevLogs, 'energyLevel');
        if (recentEnergy || prevEnergy) {
            wellnessMetrics.push({
                ...METRIC_CONFIG.energyLevel,
                current: recentEnergy || prevEnergy,
                previous: prevEnergy || recentEnergy,
                ...evalTrendDirection('energyLevel', recentEnergy || prevEnergy, prevEnergy || recentEnergy, ctx)
            });
        }

        const recentStress = getAverageWellness(recentLogs, 'stressLevel');
        const prevStress = getAverageWellness(prevLogs, 'stressLevel');
        if (recentStress || prevStress) {
            wellnessMetrics.push({
                ...METRIC_CONFIG.stressLevel,
                current: recentStress || prevStress,
                previous: prevStress || recentStress,
                ...evalTrendDirection('stressLevel', recentStress || prevStress, prevStress || recentStress, ctx)
            });
        }

        const recentSoreness = getAverageWellness(recentLogs, 'sorenessLevel');
        const prevSoreness = getAverageWellness(prevLogs, 'sorenessLevel');
        if (recentSoreness || prevSoreness) {
            wellnessMetrics.push({
                ...METRIC_CONFIG.sorenessLevel,
                current: recentSoreness || prevSoreness,
                previous: prevSoreness || recentSoreness,
                ...evalTrendDirection('sorenessLevel', recentSoreness || prevSoreness, prevSoreness || recentSoreness, ctx)
            });
        }

        const metrics = [
            {
                ...METRIC_CONFIG.frequency,
                current: recentFrequency,
                previous: prevFrequency,
                ...evalTrendDirection('frequency', recentFrequency, prevFrequency, ctx)
            },
            {
                ...METRIC_CONFIG.volume,
                current: recentVolume,
                previous: prevVolume,
                ...evalTrendDirection('volume', recentVolume, prevVolume, ctx)
            },
            {
                ...METRIC_CONFIG.bodyWeight,
                current: recentWeight || prevWeight,
                previous: prevWeight || recentWeight,
                ...evalTrendDirection('bodyWeight', recentWeight || prevWeight, prevWeight || recentWeight, ctx)
            },
            {
                ...METRIC_CONFIG.prs,
                current: recentPR,
                previous: prevPR,
                ...evalTrendDirection('prs', recentPR, prevPR, ctx)
            },
            {
                ...METRIC_CONFIG.consistency,
                current: recentConsistency,
                previous: prevConsistency,
                ...evalTrendDirection('consistency', recentConsistency, prevConsistency, ctx)
            }
        ]
        .concat(wellnessMetrics)
        .map(metric => ({
            ...metric,
            summary: formatDeltaText(metric.id, metric)
        }));

        const digest = buildHeuristicSummary(metrics);

        return {
            metrics,
            digest,
            generatedAt: new Date().toISOString()
        };
    }
};

export default trendEngine;

