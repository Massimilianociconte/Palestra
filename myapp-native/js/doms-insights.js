import { EXERCISE_DB, MUSCLE_GROUPS } from './exercise-db.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const normalize = (value = '') => value.toLowerCase().trim();

const matchExerciseMuscles = (name = '') => {
    const normalized = normalize(name);
    if (!normalized) return [];
    const matchKey = Object.keys(EXERCISE_DB).find(key => normalized.includes(key));
    return matchKey ? EXERCISE_DB[matchKey] : [];
};

const collectLogMuscles = (log = {}) => {
    const muscles = new Set();
    (log.exercises || []).forEach(ex => {
        matchExerciseMuscles(ex?.name || '').forEach(m => muscles.add(m));
    });
    return muscles;
};

const safeDate = (value) => {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
};

/**
 * Calcola il carico di fatica per gruppo muscolare basandosi sugli esercizi
 * Questo permette di mostrare dati anche senza questionario DOMS esplicito
 */
const computeMuscleFatigue = (logs = [], days = 14) => {
    const cutoff = Date.now() - (days * DAY_MS);
    const recentLogs = logs.filter(log => {
        const time = safeDate(log?.date);
        return time && time >= cutoff;
    });

    const muscleStats = {};

    recentLogs.forEach(log => {
        const logTime = safeDate(log.date);
        const daysAgo = Math.floor((Date.now() - logTime) / DAY_MS);
        const recencyFactor = Math.max(0.3, 1 - (daysAgo * 0.07)); // Decay over time

        (log.exercises || []).forEach(ex => {
            const muscles = matchExerciseMuscles(ex?.name || '');
            const sets = (ex.sets || []).length;
            const volume = (ex.sets || []).reduce((sum, s) => {
                const w = parseFloat(s.weight) || 0;
                const r = parseFloat(s.reps) || 0;
                return sum + (w * r);
            }, 0);

            // Calcola intensità basata su RPE se disponibile
            const rpeValues = (ex.sets || []).map(s => s.rpe).filter(r => r > 0);
            const avgRpe = rpeValues.length ? rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length : 6;

            muscles.forEach(muscle => {
                if (!muscleStats[muscle]) {
                    muscleStats[muscle] = {
                        totalSets: 0,
                        totalVolume: 0,
                        avgRpe: 0,
                        rpeCount: 0,
                        lastWorked: null,
                        workoutCount: 0
                    };
                }

                const stat = muscleStats[muscle];
                stat.totalSets += sets * recencyFactor;
                stat.totalVolume += volume * recencyFactor;
                stat.avgRpe = ((stat.avgRpe * stat.rpeCount) + avgRpe) / (stat.rpeCount + 1);
                stat.rpeCount++;
                stat.workoutCount++;

                if (!stat.lastWorked || logTime > safeDate(stat.lastWorked)) {
                    stat.lastWorked = log.date;
                }
            });
        });
    });

    return muscleStats;
};

export const computeDomsInsights = (logs = []) => {
    if (!Array.isArray(logs) || !logs.length) {
        return {
            hotspots: [],
            timeline: [],
            totalReports: 0,
            fatigueData: {},
            hasSorenessData: false
        };
    }

    const chronologicalLogs = [...logs].sort((a, b) => {
        const aTime = safeDate(a?.date);
        const bTime = safeDate(b?.date);
        return (aTime || 0) - (bTime || 0);
    });

    const trainingLookup = chronologicalLogs.map(log => ({
        date: log?.date,
        muscles: collectLogMuscles(log)
    }));

    const findLastStimulusBefore = (muscle, beforeTimestamp) => {
        for (let i = trainingLookup.length - 1; i >= 0; i--) {
            const entry = trainingLookup[i];
            const entryTime = safeDate(entry.date);
            if (entryTime === null || entryTime >= beforeTimestamp) continue;
            
            if (entry.muscles.has(muscle)) {
                return entryTime;
            }
        }
        return null;
    };

    const stats = {};
    const timeline = [];
    let hasSorenessData = false;

    logs.forEach(log => {
        const wellness = log?.wellness;
        if (!wellness) return;
        
        // Check for explicit soreness muscles
        let muscles = Array.isArray(wellness.sorenessMuscles) ? [...wellness.sorenessMuscles] : [];
        
        // Debug log per verificare i dati
        if (wellness.sorenessMuscles && wellness.sorenessMuscles.length > 0) {
            console.log('[DOMS] Found explicit sorenessMuscles:', wellness.sorenessMuscles, 'in log:', log.date);
        }
        
        // FALLBACK: Se non ci sono muscoli specifici ma c'è sorenessLevel > 3,
        // inferisci i muscoli dall'allenamento corrente
        if (!muscles.length && wellness.sorenessLevel && wellness.sorenessLevel > 3) {
            const logMuscles = collectLogMuscles(log);
            if (logMuscles.size > 0) {
                muscles = Array.from(logMuscles);
                console.log('[DOMS] Inferred muscles from exercises:', muscles, 'sorenessLevel:', wellness.sorenessLevel);
            }
        }
        
        if (!muscles.length) return;
        
        hasSorenessData = true;

        const recordedAt = wellness.recordedAt || log.date;
        const recordedTs = safeDate(recordedAt);
        if (recordedTs === null) return;

        const intensity = Number(wellness.sorenessLevel);
        const intensityValue = Number.isFinite(intensity) ? intensity : null;

        const entryDetail = {
            date: log.date,
            recordedAt,
            intensity: intensityValue,
            muscles: [],
            inferred: !Array.isArray(wellness.sorenessMuscles) || !wellness.sorenessMuscles.length
        };

        muscles.forEach(muscle => {
            const label = MUSCLE_GROUPS[muscle]?.label || muscle;
            const stimulusTs = findLastStimulusBefore(muscle, recordedTs);
            
            let gapDays = null;
            if (stimulusTs !== null) {
                const diff = recordedTs - stimulusTs;
                gapDays = Math.max(0, Math.round(diff / DAY_MS));
                if (gapDays > 60) gapDays = null;
            }

            entryDetail.muscles.push({
                id: muscle,
                label,
                daysSinceStimulus: gapDays,
                lastStimulusDate: stimulusTs ? new Date(stimulusTs).toISOString() : null
            });

            if (!stats[muscle]) {
                stats[muscle] = {
                    occurrences: 0,
                    intensitySum: 0,
                    lastReportTs: null,
                    lastIntensity: null,
                    gapSum: 0,
                    gapCount: 0,
                    lastGap: null
                };
            }

            const bucket = stats[muscle];
            bucket.occurrences += 1;
            if (intensityValue !== null) bucket.intensitySum += intensityValue;
            if (gapDays !== null) {
                bucket.gapSum += gapDays;
                bucket.gapCount += 1;
            }
            if (!bucket.lastReportTs || recordedTs > bucket.lastReportTs) {
                bucket.lastReportTs = recordedTs;
                bucket.lastIntensity = intensityValue;
                bucket.lastGap = gapDays;
            }
        });

        timeline.push(entryDetail);
    });

    // Calcola anche i dati di fatica muscolare (sempre disponibili)
    const fatigueData = computeMuscleFatigue(logs, 14);

    // Se non ci sono hotspots da DOMS espliciti, genera hotspots da fatica
    let hotspots = Object.entries(stats).map(([muscle, bucket]) => ({
        muscle,
        label: MUSCLE_GROUPS[muscle]?.label || muscle,
        occurrences: bucket.occurrences,
        avgIntensity: bucket.occurrences
            ? Number((bucket.intensitySum / bucket.occurrences).toFixed(1))
            : null,
        lastReportedAt: bucket.lastReportTs ? new Date(bucket.lastReportTs).toISOString() : null,
        lastIntensity: bucket.lastIntensity,
        avgRecoveryDays: bucket.gapCount
            ? Number((bucket.gapSum / bucket.gapCount).toFixed(1))
            : null,
        lastRecoveryDays: bucket.lastGap,
        source: 'doms'
    })).sort((a, b) => {
        if (a.occurrences === b.occurrences) {
            return (safeDate(b.lastReportedAt) || 0) - (safeDate(a.lastReportedAt) || 0);
        }
        return b.occurrences - a.occurrences;
    });

    // Se non ci sono hotspots DOMS, genera da fatica muscolare
    if (!hotspots.length && Object.keys(fatigueData).length > 0) {
        hotspots = Object.entries(fatigueData)
            .map(([muscle, data]) => {
                const daysAgo = data.lastWorked 
                    ? Math.floor((Date.now() - safeDate(data.lastWorked)) / DAY_MS)
                    : null;
                
                // Stima intensità DOMS basata su volume e RPE
                const estimatedIntensity = Math.min(10, Math.round(
                    (data.totalSets / 10) * (data.avgRpe / 6) * 2
                ));

                return {
                    muscle,
                    label: MUSCLE_GROUPS[muscle]?.label || muscle,
                    occurrences: data.workoutCount,
                    avgIntensity: estimatedIntensity > 0 ? estimatedIntensity : null,
                    lastReportedAt: data.lastWorked,
                    lastIntensity: estimatedIntensity > 0 ? estimatedIntensity : null,
                    avgRecoveryDays: daysAgo,
                    lastRecoveryDays: daysAgo,
                    source: 'fatigue',
                    totalSets: Math.round(data.totalSets),
                    avgRpe: data.avgRpe.toFixed(1)
                };
            })
            .filter(h => h.occurrences > 0)
            .sort((a, b) => b.occurrences - a.occurrences)
            .slice(0, 8);
    }

    timeline.sort((a, b) => (safeDate(b.recordedAt) || 0) - (safeDate(a.recordedAt) || 0));

    return {
        hotspots,
        timeline: timeline.slice(0, 20),
        totalReports: timeline.length,
        fatigueData,
        hasSorenessData
    };
};

