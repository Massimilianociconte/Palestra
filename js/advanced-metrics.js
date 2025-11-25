/**
 * Advanced Metrics Engine
 * Calcola metriche avanzate dai dati di allenamento esistenti
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export class AdvancedMetricsEngine {
    constructor() {
        this.logs = [];
        this.bodyStats = [];
        this.healthData = [];
        this.profile = {};
    }

    /**
     * Carica tutti i dati necessari
     */
    loadData() {
        this.logs = JSON.parse(localStorage.getItem('ironflow_logs') || '[]');
        this.bodyStats = JSON.parse(localStorage.getItem('ironflow_body_stats') || '[]');
        this.healthData = JSON.parse(localStorage.getItem('ironflow_health_data') || '[]');
        this.profile = JSON.parse(localStorage.getItem('ironflow_profile') || '{}');
        return this;
    }

    /**
     * 1. TRAINING LOAD INDEX (0-100)
     * Combina volume, frequenza e intensità degli ultimi 7 giorni
     */
    calculateTrainingLoad(days = 7) {
        const cutoff = Date.now() - (days * DAY_MS);
        const recentLogs = this.logs.filter(log => new Date(log.date).getTime() >= cutoff);
        
        if (!recentLogs.length) return { score: 0, breakdown: {}, trend: 'neutral' };

        // Volume totale
        const totalVolume = recentLogs.reduce((sum, log) => sum + (log.totalVolume || 0), 0);
        
        // Frequenza (sessioni/settimana)
        const frequency = recentLogs.length;
        
        // Intensità media (RPE medio)
        const rpeValues = recentLogs
            .map(log => log.avgRpe || this.calculateAvgRpe(log))
            .filter(rpe => rpe > 0);
        const avgRpe = rpeValues.length ? rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length : 5;

        // Normalizza i valori (0-100)
        const volumeScore = Math.min(100, (totalVolume / 50000) * 100); // 50k = 100%
        const frequencyScore = Math.min(100, (frequency / 6) * 100); // 6 sessioni = 100%
        const intensityScore = (avgRpe / 10) * 100;

        // Score composito pesato
        const score = Math.round(
            volumeScore * 0.4 + 
            frequencyScore * 0.35 + 
            intensityScore * 0.25
        );

        // Calcola trend vs settimana precedente
        const prevCutoff = cutoff - (days * DAY_MS);
        const prevLogs = this.logs.filter(log => {
            const time = new Date(log.date).getTime();
            return time >= prevCutoff && time < cutoff;
        });
        const prevVolume = prevLogs.reduce((sum, log) => sum + (log.totalVolume || 0), 0);
        
        let trend = 'stable';
        if (totalVolume > prevVolume * 1.1) trend = 'increasing';
        else if (totalVolume < prevVolume * 0.9) trend = 'decreasing';

        return {
            score,
            breakdown: {
                volume: Math.round(volumeScore),
                frequency: Math.round(frequencyScore),
                intensity: Math.round(intensityScore)
            },
            totalVolume,
            sessions: frequency,
            avgRpe: avgRpe.toFixed(1),
            trend
        };
    }

    calculateAvgRpe(log) {
        const rpes = (log.exercises || [])
            .flatMap(ex => (ex.sets || []).map(s => s.rpe))
            .filter(rpe => rpe > 0);
        return rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : 0;
    }

    /**
     * 2. RECOVERY SCORE (0-100)
     * Basato su sonno, stress, DOMS e giorni di riposo
     */
    calculateRecoveryScore() {
        const recentLogs = this.logs.slice(0, 14); // Ultimi 14 log
        
        if (!recentLogs.length) return { score: 75, factors: {} };

        // Sonno medio
        const sleepValues = recentLogs
            .map(log => log.wellness?.sleepQuality)
            .filter(v => typeof v === 'number');
        const avgSleep = sleepValues.length 
            ? sleepValues.reduce((a, b) => a + b, 0) / sleepValues.length 
            : 7;

        // Stress medio (invertito)
        const stressValues = recentLogs
            .map(log => log.wellness?.stressLevel)
            .filter(v => typeof v === 'number');
        const avgStress = stressValues.length 
            ? stressValues.reduce((a, b) => a + b, 0) / stressValues.length 
            : 5;

        // DOMS medio (invertito)
        const sorenessValues = recentLogs
            .map(log => log.wellness?.sorenessLevel)
            .filter(v => typeof v === 'number');
        const avgSoreness = sorenessValues.length 
            ? sorenessValues.reduce((a, b) => a + b, 0) / sorenessValues.length 
            : 3;

        // Giorni dall'ultimo allenamento
        const lastWorkout = this.logs[0]?.date;
        const daysSinceWorkout = lastWorkout 
            ? Math.floor((Date.now() - new Date(lastWorkout).getTime()) / DAY_MS)
            : 7;
        const restScore = Math.min(100, daysSinceWorkout * 20); // 5+ giorni = 100%

        // Calcola score
        const sleepScore = (avgSleep / 10) * 100;
        const stressScore = ((10 - avgStress) / 10) * 100;
        const sorenessScore = ((10 - avgSoreness) / 10) * 100;

        const score = Math.round(
            sleepScore * 0.35 +
            stressScore * 0.25 +
            sorenessScore * 0.25 +
            restScore * 0.15
        );

        return {
            score: Math.min(100, Math.max(0, score)),
            factors: {
                sleep: Math.round(sleepScore),
                stress: Math.round(stressScore),
                soreness: Math.round(sorenessScore),
                rest: Math.round(restScore)
            },
            daysSinceWorkout,
            recommendation: this.getRecoveryRecommendation(score, daysSinceWorkout)
        };
    }

    getRecoveryRecommendation(score, days) {
        if (score >= 80 && days >= 1) return 'Pronto per allenamento intenso';
        if (score >= 60) return 'OK per allenamento moderato';
        if (score >= 40) return 'Consigliato allenamento leggero o recupero attivo';
        return 'Riposo consigliato';
    }

    /**
     * 3. MUSCLE BALANCE RADAR
     * Distribuzione volume per gruppo muscolare
     */
    calculateMuscleBalance(days = 30) {
        const cutoff = Date.now() - (days * DAY_MS);
        const recentLogs = this.logs.filter(log => new Date(log.date).getTime() >= cutoff);

        const muscleVolume = {
            chest: 0,
            back: 0,
            shoulders: 0,
            biceps: 0,
            triceps: 0,
            legs: 0,
            core: 0
        };

        const muscleKeywords = {
            chest: ['panca', 'chest', 'pettoral', 'push up', 'dip', 'fly', 'croci'],
            back: ['lat', 'row', 'pull', 'dorsal', 'rematore', 'trazioni', 'pulldown'],
            shoulders: ['shoulder', 'spalle', 'military', 'lateral', 'alzate', 'deltoide', 'lento'],
            biceps: ['bicep', 'curl', 'bicipite'],
            triceps: ['tricep', 'french', 'pushdown', 'tricipite', 'skull'],
            legs: ['squat', 'leg', 'gambe', 'quadricip', 'hamstring', 'calf', 'polpacci', 'stacco', 'deadlift', 'lunge', 'affondi', 'pressa'],
            core: ['abs', 'addominali', 'plank', 'crunch', 'core', 'obliqui']
        };

        recentLogs.forEach(log => {
            (log.exercises || []).forEach(ex => {
                const name = (ex.name || '').toLowerCase();
                const volume = (ex.sets || []).reduce((sum, set) => {
                    const w = parseFloat(set.weight) || 0;
                    const r = parseFloat(set.reps) || 0;
                    return sum + (w * r);
                }, 0);

                for (const [muscle, keywords] of Object.entries(muscleKeywords)) {
                    if (keywords.some(kw => name.includes(kw))) {
                        muscleVolume[muscle] += volume;
                        break;
                    }
                }
            });
        });

        // Normalizza a percentuali
        const total = Object.values(muscleVolume).reduce((a, b) => a + b, 0) || 1;
        const percentages = {};
        for (const [muscle, vol] of Object.entries(muscleVolume)) {
            percentages[muscle] = Math.round((vol / total) * 100);
        }

        // Identifica squilibri
        const values = Object.values(percentages);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const imbalances = [];
        
        for (const [muscle, pct] of Object.entries(percentages)) {
            if (pct < avg * 0.5 && pct < 10) {
                imbalances.push({ muscle, type: 'undertrained', value: pct });
            } else if (pct > avg * 1.8) {
                imbalances.push({ muscle, type: 'overtrained', value: pct });
            }
        }

        return {
            distribution: percentages,
            rawVolume: muscleVolume,
            totalVolume: total,
            imbalances,
            balanceScore: Math.round(100 - (imbalances.length * 15))
        };
    }

    /**
     * 4. STRENGTH PROGRESSION
     * Traccia progressione 1RM nel tempo per esercizi principali
     */
    calculateStrengthProgression(exerciseName, months = 3) {
        const cutoff = Date.now() - (months * 30 * DAY_MS);
        const relevantLogs = this.logs.filter(log => new Date(log.date).getTime() >= cutoff);

        const dataPoints = [];
        const searchTerm = exerciseName.toLowerCase();

        relevantLogs.forEach(log => {
            (log.exercises || []).forEach(ex => {
                if ((ex.name || '').toLowerCase().includes(searchTerm)) {
                    let maxEstimate = 0;
                    (ex.sets || []).forEach(set => {
                        const w = parseFloat(set.weight) || 0;
                        const r = parseFloat(set.reps) || 0;
                        if (w > 0 && r > 0) {
                            const estimate = this.estimate1RM(w, r);
                            if (estimate > maxEstimate) maxEstimate = estimate;
                        }
                    });
                    if (maxEstimate > 0) {
                        dataPoints.push({
                            date: log.date.split('T')[0],
                            value: Math.round(maxEstimate),
                            timestamp: new Date(log.date).getTime()
                        });
                    }
                }
            });
        });

        // Ordina per data
        dataPoints.sort((a, b) => a.timestamp - b.timestamp);

        // Calcola trend
        if (dataPoints.length >= 2) {
            const first = dataPoints[0].value;
            const last = dataPoints[dataPoints.length - 1].value;
            const change = last - first;
            const changePercent = ((change / first) * 100).toFixed(1);
            
            return {
                dataPoints,
                current: last,
                initial: first,
                change,
                changePercent: parseFloat(changePercent),
                trend: change > 0 ? 'up' : change < 0 ? 'down' : 'stable'
            };
        }

        return {
            dataPoints,
            current: dataPoints[0]?.value || 0,
            initial: dataPoints[0]?.value || 0,
            change: 0,
            changePercent: 0,
            trend: 'insufficient_data'
        };
    }

    estimate1RM(weight, reps) {
        if (!weight || !reps) return 0;
        const epley = weight * (1 + reps / 30);
        const brzycki = reps < 37 ? weight * (36 / (37 - reps)) : 0;
        const lombardi = weight * Math.pow(reps, 0.10);
        const estimates = [epley, brzycki, lombardi].filter(v => v > 0 && isFinite(v));
        return estimates.length ? estimates.reduce((a, b) => a + b, 0) / estimates.length : 0;
    }

    /**
     * 5. CONSISTENCY CALENDAR
     * Genera dati per heatmap stile GitHub
     */
    generateConsistencyCalendar(weeks = 12) {
        const days = weeks * 7;
        const calendar = [];
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        // Crea mappa date -> volume
        const volumeByDate = {};
        this.logs.forEach(log => {
            const date = log.date.split('T')[0];
            volumeByDate[date] = (volumeByDate[date] || 0) + (log.totalVolume || 1000);
        });

        // Genera calendario
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const volume = volumeByDate[dateStr] || 0;
            
            calendar.push({
                date: dateStr,
                dayOfWeek: date.getDay(),
                week: Math.floor(i / 7),
                volume,
                intensity: this.getIntensityLevel(volume)
            });
        }

        // Calcola streak corrente
        let currentStreak = 0;
        let maxStreak = 0;
        let tempStreak = 0;
        
        for (let i = calendar.length - 1; i >= 0; i--) {
            if (calendar[i].volume > 0) {
                tempStreak++;
                if (i === calendar.length - 1 || calendar[i + 1]?.volume > 0) {
                    currentStreak = tempStreak;
                }
            } else {
                maxStreak = Math.max(maxStreak, tempStreak);
                tempStreak = 0;
            }
        }
        maxStreak = Math.max(maxStreak, tempStreak);

        // Conta giorni attivi
        const activeDays = calendar.filter(d => d.volume > 0).length;
        const consistencyRate = Math.round((activeDays / days) * 100);

        return {
            calendar,
            currentStreak,
            maxStreak,
            activeDays,
            totalDays: days,
            consistencyRate
        };
    }

    getIntensityLevel(volume) {
        if (volume === 0) return 0;
        if (volume < 5000) return 1;
        if (volume < 15000) return 2;
        if (volume < 30000) return 3;
        return 4;
    }

    /**
     * 6. SLEEP-PERFORMANCE CORRELATION
     * Analizza correlazione tra sonno e performance
     */
    calculateSleepPerformanceCorrelation() {
        const dataPoints = [];
        
        this.logs.forEach(log => {
            const sleep = log.wellness?.sleepQuality;
            const volume = log.totalVolume;
            const rpe = log.avgRpe || this.calculateAvgRpe(log);
            
            if (typeof sleep === 'number' && volume > 0) {
                // Performance = volume normalizzato / RPE (più volume con meno sforzo = meglio)
                const performance = rpe > 0 ? (volume / 1000) / rpe : volume / 1000;
                dataPoints.push({
                    date: log.date.split('T')[0],
                    sleep,
                    volume,
                    rpe: rpe || 5,
                    performance: Math.round(performance * 10) / 10
                });
            }
        });

        if (dataPoints.length < 5) {
            return {
                correlation: null,
                dataPoints,
                insight: 'Dati insufficienti per calcolare la correlazione'
            };
        }

        // Calcola correlazione di Pearson
        const n = dataPoints.length;
        const sumX = dataPoints.reduce((s, d) => s + d.sleep, 0);
        const sumY = dataPoints.reduce((s, d) => s + d.performance, 0);
        const sumXY = dataPoints.reduce((s, d) => s + (d.sleep * d.performance), 0);
        const sumX2 = dataPoints.reduce((s, d) => s + (d.sleep * d.sleep), 0);
        const sumY2 = dataPoints.reduce((s, d) => s + (d.performance * d.performance), 0);

        const numerator = (n * sumXY) - (sumX * sumY);
        const denominator = Math.sqrt(((n * sumX2) - (sumX * sumX)) * ((n * sumY2) - (sumY * sumY)));
        
        const correlation = denominator !== 0 ? numerator / denominator : 0;

        let insight = '';
        if (correlation > 0.5) insight = 'Forte correlazione positiva: dormi meglio, ti alleni meglio!';
        else if (correlation > 0.2) insight = 'Correlazione moderata: il sonno influenza le tue performance';
        else if (correlation > -0.2) insight = 'Correlazione debole: altri fattori influenzano di più';
        else insight = 'Correlazione negativa: analizza altri fattori di recupero';

        return {
            correlation: Math.round(correlation * 100) / 100,
            dataPoints,
            insight,
            avgSleep: (sumX / n).toFixed(1),
            avgPerformance: (sumY / n).toFixed(1)
        };
    }

    /**
     * 7. RPE DISTRIBUTION
     * Distribuzione dell'intensità percepita
     */
    calculateRpeDistribution(days = 30) {
        const cutoff = Date.now() - (days * DAY_MS);
        const recentLogs = this.logs.filter(log => new Date(log.date).getTime() >= cutoff);

        const distribution = {
            easy: 0,      // RPE 1-5
            moderate: 0,  // RPE 6-7
            hard: 0,      // RPE 8-9
            maximal: 0    // RPE 10
        };

        let totalSets = 0;

        recentLogs.forEach(log => {
            (log.exercises || []).forEach(ex => {
                (ex.sets || []).forEach(set => {
                    const rpe = set.rpe;
                    if (rpe > 0) {
                        totalSets++;
                        if (rpe <= 5) distribution.easy++;
                        else if (rpe <= 7) distribution.moderate++;
                        else if (rpe <= 9) distribution.hard++;
                        else distribution.maximal++;
                    }
                });
            });
        });

        // Converti in percentuali
        const percentages = {};
        for (const [key, count] of Object.entries(distribution)) {
            percentages[key] = totalSets > 0 ? Math.round((count / totalSets) * 100) : 0;
        }

        // Valuta se la distribuzione è ottimale (80/20 rule)
        const hardPercent = percentages.hard + percentages.maximal;
        let assessment = '';
        if (hardPercent > 40) assessment = 'Troppi set ad alta intensità - rischio overtraining';
        else if (hardPercent < 15) assessment = 'Potresti aumentare l\'intensità su alcuni set';
        else assessment = 'Buona distribuzione dell\'intensità';

        return {
            distribution,
            percentages,
            totalSets,
            assessment,
            hardPercent
        };
    }

    /**
     * 8. VOLUME TREND (Weekly)
     * Trend del volume nelle ultime settimane
     */
    calculateVolumeTrend(weeks = 8) {
        const weeklyVolumes = [];
        const now = Date.now();

        for (let i = 0; i < weeks; i++) {
            const weekEnd = now - (i * 7 * DAY_MS);
            const weekStart = weekEnd - (7 * DAY_MS);
            
            const weekLogs = this.logs.filter(log => {
                const time = new Date(log.date).getTime();
                return time >= weekStart && time < weekEnd;
            });

            const volume = weekLogs.reduce((sum, log) => sum + (log.totalVolume || 0), 0);
            const sessions = weekLogs.length;

            weeklyVolumes.unshift({
                week: weeks - i,
                volume,
                sessions,
                date: new Date(weekStart).toISOString().split('T')[0]
            });
        }

        // Calcola trend (regressione lineare semplice)
        const n = weeklyVolumes.length;
        const sumX = weeklyVolumes.reduce((s, _, i) => s + i, 0);
        const sumY = weeklyVolumes.reduce((s, w) => s + w.volume, 0);
        const sumXY = weeklyVolumes.reduce((s, w, i) => s + (i * w.volume), 0);
        const sumX2 = weeklyVolumes.reduce((s, _, i) => s + (i * i), 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
        const avgVolume = sumY / n;
        const trendPercent = avgVolume > 0 ? ((slope * n) / avgVolume * 100).toFixed(1) : 0;

        return {
            weeklyData: weeklyVolumes,
            avgVolume: Math.round(avgVolume),
            trend: slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable',
            trendPercent: parseFloat(trendPercent)
        };
    }

    /**
     * 9. PERSONAL BESTS TIMELINE
     * Timeline dei PR raggiunti
     */
    getPersonalBestsTimeline(months = 6) {
        const cutoff = Date.now() - (months * 30 * DAY_MS);
        const prs = {};
        const timeline = [];

        // Ordina log per data
        const sortedLogs = [...this.logs]
            .filter(log => new Date(log.date).getTime() >= cutoff)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        sortedLogs.forEach(log => {
            (log.exercises || []).forEach(ex => {
                const name = (ex.name || '').toLowerCase();
                (ex.sets || []).forEach(set => {
                    const w = parseFloat(set.weight) || 0;
                    const r = parseFloat(set.reps) || 0;
                    if (w > 0 && r > 0) {
                        const estimate = this.estimate1RM(w, r);
                        if (!prs[name] || estimate > prs[name]) {
                            // Nuovo PR!
                            const isNewPR = prs[name] !== undefined;
                            prs[name] = estimate;
                            
                            if (isNewPR) {
                                timeline.push({
                                    date: log.date.split('T')[0],
                                    exercise: ex.name,
                                    value: Math.round(estimate),
                                    weight: w,
                                    reps: r
                                });
                            }
                        }
                    }
                });
            });
        });

        return {
            timeline: timeline.slice(-10), // Ultimi 10 PR
            totalPRs: timeline.length,
            currentPRs: Object.entries(prs).map(([name, value]) => ({
                exercise: name,
                value: Math.round(value)
            })).sort((a, b) => b.value - a.value).slice(0, 10)
        };
    }

    /**
     * 10. WORKOUT VARIETY SCORE
     * Quanto vari i tuoi allenamenti
     */
    calculateVarietyScore(days = 30) {
        const cutoff = Date.now() - (days * DAY_MS);
        const recentLogs = this.logs.filter(log => new Date(log.date).getTime() >= cutoff);

        if (recentLogs.length < 3) {
            return { score: 0, uniqueExercises: 0, avgPerSession: 0, insight: 'Dati insufficienti' };
        }

        const allExercises = new Set();
        const exercisesPerSession = [];

        recentLogs.forEach(log => {
            const sessionExercises = new Set();
            (log.exercises || []).forEach(ex => {
                const name = (ex.name || '').toLowerCase();
                allExercises.add(name);
                sessionExercises.add(name);
            });
            exercisesPerSession.push(sessionExercises.size);
        });

        const uniqueCount = allExercises.size;
        const avgPerSession = exercisesPerSession.reduce((a, b) => a + b, 0) / exercisesPerSession.length;
        
        // Score basato su varietà (più esercizi unici = meglio, fino a un certo punto)
        const varietyRatio = uniqueCount / (recentLogs.length * 5); // Assumendo 5 esercizi ideali per sessione
        const score = Math.min(100, Math.round(varietyRatio * 100));

        let insight = '';
        if (score > 80) insight = 'Ottima varietà! Stai stimolando i muscoli in modi diversi.';
        else if (score > 50) insight = 'Buona varietà. Potresti provare qualche esercizio nuovo.';
        else insight = 'Varietà limitata. Considera di aggiungere nuovi esercizi per evitare plateau.';

        return {
            score,
            uniqueExercises: uniqueCount,
            avgPerSession: avgPerSession.toFixed(1),
            insight
        };
    }

    /**
     * 11. WEEKLY SUMMARY
     * Riepilogo settimanale completo
     */
    getWeeklySummary() {
        const weekAgo = Date.now() - (7 * DAY_MS);
        const thisWeek = this.logs.filter(log => new Date(log.date).getTime() >= weekAgo);
        const prevWeekStart = weekAgo - (7 * DAY_MS);
        const lastWeek = this.logs.filter(log => {
            const time = new Date(log.date).getTime();
            return time >= prevWeekStart && time < weekAgo;
        });

        const thisVolume = thisWeek.reduce((s, l) => s + (l.totalVolume || 0), 0);
        const lastVolume = lastWeek.reduce((s, l) => s + (l.totalVolume || 0), 0);
        const volumeChange = lastVolume ? ((thisVolume - lastVolume) / lastVolume * 100).toFixed(1) : 0;

        const thisExercises = new Set();
        thisWeek.forEach(log => (log.exercises || []).forEach(ex => thisExercises.add(ex.name)));

        return {
            sessions: thisWeek.length,
            totalVolume: thisVolume,
            volumeChange: parseFloat(volumeChange),
            uniqueExercises: thisExercises.size,
            avgDuration: thisWeek.length 
                ? Math.round(thisWeek.reduce((s, l) => s + (l.duration || 0), 0) / thisWeek.length)
                : 0,
            comparedToLastWeek: {
                sessions: thisWeek.length - lastWeek.length,
                volume: thisVolume - lastVolume
            }
        };
    }
}

export const advancedMetrics = new AdvancedMetricsEngine();
