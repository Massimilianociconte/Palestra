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

export const computeDomsInsights = (logs = []) => {
    if (!Array.isArray(logs) || !logs.length) {
        return {
            hotspots: [],
            timeline: [],
            totalReports: 0
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
                return entry.date;
            }
        }
        return null;
    };

    const stats = {};
    const timeline = [];

    logs.forEach(log => {
        const wellness = log?.wellness;
        if (!wellness) return;
        const muscles = Array.isArray(wellness.sorenessMuscles) ? wellness.sorenessMuscles : [];
        if (!muscles.length) return;

        const recordedAt = wellness.recordedAt || log.date;
        const recordedTs = safeDate(recordedAt);
        if (recordedTs === null) return;

        const intensity = Number(wellness.sorenessLevel);
        const intensityValue = Number.isFinite(intensity) ? intensity : null;

        const entryDetail = {
            date: log.date,
            recordedAt,
            intensity: intensityValue,
            muscles: []
        };

        muscles.forEach(muscle => {
            const label = MUSCLE_GROUPS[muscle]?.label || muscle;
            const stimulusDate = findLastStimulusBefore(muscle, recordedTs);
            const stimulusTime = safeDate(stimulusDate);
            const gapDays = stimulusTime !== null
                ? Math.max(0, Math.round((recordedTs - stimulusTime) / DAY_MS))
                : null;

            entryDetail.muscles.push({
                id: muscle,
                label,
                daysSinceStimulus: gapDays,
                lastStimulusDate: stimulusDate || null
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

    const hotspots = Object.entries(stats).map(([muscle, bucket]) => ({
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
        lastRecoveryDays: bucket.lastGap
    })).sort((a, b) => {
        if (a.occurrences === b.occurrences) {
            return (safeDate(b.lastReportedAt) || 0) - (safeDate(a.lastReportedAt) || 0);
        }
        return b.occurrences - a.occurrences;
    });

    timeline.sort((a, b) => (safeDate(b.recordedAt) || 0) - (safeDate(a.recordedAt) || 0));

    return {
        hotspots,
        timeline: timeline.slice(0, 20),
        totalReports: timeline.length
    };
};

