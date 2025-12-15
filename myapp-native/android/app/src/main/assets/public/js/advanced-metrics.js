/**
 * Advanced Metrics Engine
 * Calcola metriche avanzate dai dati di allenamento esistenti
 */

import { EXERCISE_DB } from './exercise-db.js';

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

        // Mapping from detailed muscles (EXERCISE_DB) to chart categories
        const muscleCategoryMap = {
            "chest": "chest", "upper-chest": "chest",
            "lats": "back", "traps": "back", "rhomboids": "back", "lower-back": "back",
            "front-delts": "shoulders", "side-delts": "shoulders", "rear-delts": "shoulders",
            "biceps": "biceps", "forearms": "biceps",
            "triceps": "triceps",
            "quads": "legs", "hamstrings": "legs", "calves": "legs", "glutes": "legs",
            "abs": "core", "core": "core"
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

                // 1. Try EXERCISE_DB first (Better precision)
                const dbKey = Object.keys(EXERCISE_DB).find(k => name.includes(k));
                let foundInDb = false;

                if (dbKey) {
                    const muscles = EXERCISE_DB[dbKey];
                    // Map detailed muscles to broad categories
                    const categories = new Set();
                    muscles.forEach(m => {
                        const cat = muscleCategoryMap[m];
                        if (cat) categories.add(cat);
                    });

                    if (categories.size > 0) {
                        foundInDb = true;
                        categories.forEach(cat => {
                            if (muscleVolume[cat] !== undefined) {
                                muscleVolume[cat] += volume;
                            }
                        });
                    }
                }

                // 2. Fallback to simple keywords if not found in DB
                if (!foundInDb) {
                    for (const [muscle, keywords] of Object.entries(muscleKeywords)) {
                        if (keywords.some(kw => name.includes(kw))) {
                            muscleVolume[muscle] += volume;
                            break;
                        }
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
     * Normalizza il nome di un esercizio per il matching
     * Rimuove varianti, parentesi, punteggiatura e normalizza
     */
    _normalizeExerciseName(name) {
        if (!name) return '';
        return name
            .toLowerCase()
            .trim()
            // Rimuovi contenuto tra parentesi (varianti come "seduto", "in piedi", etc.)
            .replace(/\s*\([^)]*\)\s*/g, ' ')
            // Rimuovi numeri isolati (es. "30 kg" rimanenti)
            .replace(/\b\d+\s*(kg|lb|lbs)?\b/gi, '')
            // Normalizza spazi multipli
            .replace(/\s+/g, ' ')
            // Rimuovi punteggiatura
            .replace(/[.,;:!?'"]/g, '')
            .trim();
    }

    /**
     * Verifica se due nomi di esercizi sono equivalenti
     */
    _exerciseNamesMatch(name1, name2) {
        const norm1 = this._normalizeExerciseName(name1);
        const norm2 = this._normalizeExerciseName(name2);
        
        // Match esatto dopo normalizzazione
        if (norm1 === norm2) return true;
        
        // Uno contiene l'altro (per nomi abbreviati)
        if (norm1.length >= 5 && norm2.length >= 5) {
            if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
        }
        
        // Calcola similarità per nomi molto simili (typo tolerance)
        const similarity = this._calculateSimilarity(norm1, norm2);
        return similarity >= 0.85; // 85% similarità
    }

    /**
     * Calcola similarità tra due stringhe (0-1)
     * Usa Dice coefficient per efficienza
     */
    _calculateSimilarity(str1, str2) {
        if (str1 === str2) return 1;
        if (!str1 || !str2) return 0;
        
        // Crea bigrammi
        const bigrams1 = new Set();
        const bigrams2 = new Set();
        
        for (let i = 0; i < str1.length - 1; i++) {
            bigrams1.add(str1.substring(i, i + 2));
        }
        for (let i = 0; i < str2.length - 1; i++) {
            bigrams2.add(str2.substring(i, i + 2));
        }
        
        // Conta intersezione
        let intersection = 0;
        bigrams1.forEach(bg => {
            if (bigrams2.has(bg)) intersection++;
        });
        
        return (2 * intersection) / (bigrams1.size + bigrams2.size);
    }

    /**
     * 4. GET UNIQUE EXERCISES FROM LOGS
     * Estrae TUTTI gli esercizi unici dai log (senza filtri minimi)
     * USA PESO REALE MASSIMO (non stimato)
     */
    getUniqueExercises(minOccurrences = 0) {
        const exerciseCounts = {};
        const exerciseMaxWeight = {}; // PESO REALE MASSIMO
        const exerciseLastDate = {}; // Data ultimo allenamento

        this.logs.forEach(log => {
            (log.exercises || []).forEach(ex => {
                const name = (ex.name || '').trim();
                if (!name) return;

                // Conta occorrenze (sessioni in cui appare l'esercizio)
                exerciseCounts[name] = (exerciseCounts[name] || 0) + 1;
                
                // Aggiorna data ultimo allenamento
                const logDate = new Date(log.date).getTime();
                if (!exerciseLastDate[name] || logDate > exerciseLastDate[name]) {
                    exerciseLastDate[name] = logDate;
                }

                // Trova il PESO REALE MASSIMO sollevato (non stimato)
                (ex.sets || []).forEach(set => {
                    const w = parseFloat(set.weight) || 0;
                    if (w > 0) {
                        if (!exerciseMaxWeight[name] || w > exerciseMaxWeight[name]) {
                            exerciseMaxWeight[name] = w;
                        }
                    }
                });
            });
        });

        // Ritorna TUTTI gli esercizi con almeno un peso registrato, ordinati per data più recente poi per peso
        return Object.entries(exerciseCounts)
            .filter(([name]) => exerciseMaxWeight[name] > 0)
            .map(([name, count]) => ({
                name,
                count,
                maxWeight: Math.round(exerciseMaxWeight[name] || 0),
                lastDate: exerciseLastDate[name] || 0
            }))
            .sort((a, b) => {
                // Prima ordina per data più recente
                if (b.lastDate !== a.lastDate) return b.lastDate - a.lastDate;
                // Poi per peso massimo
                return b.maxWeight - a.maxWeight;
            });
    }

    /**
     * 5. STRENGTH PROGRESSION
     * Traccia TUTTI i pesi fatti per un esercizio nel tempo
     * Usa matching intelligente per raggruppare varianti dello stesso esercizio
     */
    calculateStrengthProgression(exerciseName, months = 3) {
        const cutoff = Date.now() - (months * 30 * DAY_MS);
        
        // Usa TUTTI i log per trovare l'esercizio
        const allDataPoints = [];
        let exerciseFound = false;
        const matchedNames = new Set(); // Traccia tutti i nomi matchati

        // Raccogli TUTTI i pesi fatti per questo esercizio (da tutti i log)
        this.logs.forEach(log => {
            (log.exercises || []).forEach(ex => {
                const exName = (ex.name || '').trim();
                
                // Usa matching intelligente
                if (this._exerciseNamesMatch(exName, exerciseName)) {
                    exerciseFound = true;
                    matchedNames.add(exName);
                    const logTimestamp = new Date(log.date).getTime();
                    
                    // Raccogli OGNI set con peso (non solo il max della sessione)
                    (ex.sets || []).forEach((set, setIndex) => {
                        const w = parseFloat(set.weight) || 0;
                        const r = parseFloat(set.reps) || 0;
                        if (w > 0) {
                            allDataPoints.push({
                                date: log.date.split('T')[0],
                                value: Math.round(w),
                                reps: r,
                                timestamp: logTimestamp,
                                setIndex: setIndex,
                                exerciseName: exName
                            });
                        }
                    });
                }
            });
        });

        // Se l'esercizio non esiste, ritorna stato vuoto
        if (!exerciseFound || allDataPoints.length === 0) {
            return {
                dataPoints: [],
                current: 0,
                initial: 0,
                change: 0,
                changePercent: 0,
                trend: 'no_data',
                exerciseNotFound: !exerciseFound
            };
        }

        // Ordina tutti i punti per data (timestamp)
        allDataPoints.sort((a, b) => a.timestamp - b.timestamp);

        // Per il grafico: prendi il peso MASSIMO per ogni sessione (giorno)
        // Questo evita duplicati nello stesso giorno ma mostra la progressione
        const dataByDate = {};
        allDataPoints.forEach(point => {
            if (!dataByDate[point.date] || point.value > dataByDate[point.date].value) {
                dataByDate[point.date] = point;
            }
        });
        
        // Converti in array ordinato per il grafico
        const chartDataPoints = Object.values(dataByDate).sort((a, b) => a.timestamp - b.timestamp);

        // Filtra solo gli ultimi N mesi per calcoli di trend
        const recentDataPoints = chartDataPoints.filter(d => d.timestamp >= cutoff);

        // Calcola statistiche basate sui dati recenti
        if (recentDataPoints.length >= 2) {
            const first = recentDataPoints[0].value;
            const last = recentDataPoints[recentDataPoints.length - 1].value;
            const change = last - first;
            const changePercent = first > 0 ? ((change / first) * 100).toFixed(1) : 0;
            
            return {
                dataPoints: chartDataPoints, // Tutti i dati per il grafico
                recentDataPoints: recentDataPoints, // Solo ultimi N mesi
                current: last,
                initial: first,
                change,
                changePercent: parseFloat(changePercent),
                trend: change > 0 ? 'up' : change < 0 ? 'down' : 'stable',
                totalSessions: chartDataPoints.length
            };
        } else if (recentDataPoints.length === 1) {
            // Solo un dato recente - cerca dati più vecchi per confronto
            const allTimeCurrent = chartDataPoints[chartDataPoints.length - 1].value;
            const allTimeFirst = chartDataPoints[0].value;
            const change = allTimeCurrent - allTimeFirst;
            const changePercent = allTimeFirst > 0 ? ((change / allTimeFirst) * 100).toFixed(1) : 0;
            
            return {
                dataPoints: chartDataPoints,
                recentDataPoints: recentDataPoints,
                current: allTimeCurrent,
                initial: allTimeFirst,
                change: chartDataPoints.length > 1 ? change : 0,
                changePercent: chartDataPoints.length > 1 ? parseFloat(changePercent) : 0,
                trend: chartDataPoints.length > 1 ? (change > 0 ? 'up' : change < 0 ? 'down' : 'stable') : 'insufficient_data',
                totalSessions: chartDataPoints.length
            };
        }

        // Un solo dato point
        return {
            dataPoints: chartDataPoints,
            recentDataPoints: [],
            current: chartDataPoints[0]?.value || 0,
            initial: chartDataPoints[0]?.value || 0,
            change: 0,
            changePercent: 0,
            trend: 'insufficient_data',
            totalSessions: chartDataPoints.length
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
     * Analizza correlazione tra sonno e performance con validazione statistica
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
                insight: 'Dati insufficienti per calcolare la correlazione',
                isStatisticallyValid: false,
                varianceWarning: null
            };
        }

        // Calcola correlazione di Pearson
        const n = dataPoints.length;
        const sumX = dataPoints.reduce((s, d) => s + d.sleep, 0);
        const sumY = dataPoints.reduce((s, d) => s + d.performance, 0);
        const sumXY = dataPoints.reduce((s, d) => s + (d.sleep * d.performance), 0);
        const sumX2 = dataPoints.reduce((s, d) => s + (d.sleep * d.sleep), 0);
        const sumY2 = dataPoints.reduce((s, d) => s + (d.performance * d.performance), 0);

        // Calcola deviazione standard per X (sonno) e Y (performance)
        const meanX = sumX / n;
        const meanY = sumY / n;
        const varianceX = (sumX2 / n) - (meanX * meanX);
        const varianceY = (sumY2 / n) - (meanY * meanY);
        const stdDevX = Math.sqrt(varianceX);
        const stdDevY = Math.sqrt(varianceY);

        // Verifica varianza sufficiente (problema identificato: dati in colonna verticale)
        const MIN_STD_DEV_X = 0.8; // Minima deviazione standard per sonno (scala 1-10)
        const hasLowVarianceX = stdDevX < MIN_STD_DEV_X;
        const hasLowVarianceY = stdDevY < 0.5;

        // Rileva outlier con leverage elevato (punto isolato che forza la regressione)
        const leveragePoints = this._detectHighLeveragePoints(dataPoints, meanX, stdDevX);
        const hasHighLeverageOutlier = leveragePoints.length > 0 && leveragePoints.length <= Math.floor(n * 0.15);

        const numerator = (n * sumXY) - (sumX * sumY);
        const denominator = Math.sqrt(((n * sumX2) - (sumX * sumX)) * ((n * sumY2) - (sumY * sumY)));
        
        const correlation = denominator !== 0 ? numerator / denominator : 0;

        // Determina validità statistica
        const isStatisticallyValid = !hasLowVarianceX && !hasHighLeverageOutlier && n >= 8;
        
        // Genera warning appropriati
        let varianceWarning = null;
        if (hasLowVarianceX) {
            varianceWarning = 'Varia i tuoi voti sulla qualità del sonno per scoprire correlazioni significative';
        } else if (hasHighLeverageOutlier) {
            varianceWarning = 'Un singolo punto sta influenzando troppo la correlazione. Raccogli più dati variati';
        }

        // Soglie di correlazione corrette scientificamente
        // r < 0.3 = debole, 0.3-0.5 = moderata, > 0.5 = forte
        let insight = '';
        let correlationStrength = 'weak';
        const absCorr = Math.abs(correlation);
        
        if (!isStatisticallyValid) {
            insight = varianceWarning || 'Dati insufficienti per una correlazione affidabile';
            correlationStrength = 'invalid';
        } else if (absCorr >= 0.5) {
            insight = correlation > 0 
                ? 'Forte correlazione positiva: dormi meglio, ti alleni meglio!' 
                : 'Forte correlazione negativa: analizza i fattori di recupero';
            correlationStrength = 'strong';
        } else if (absCorr >= 0.3) {
            insight = correlation > 0
                ? 'Correlazione moderata: il sonno sembra influenzare le performance'
                : 'Correlazione moderata negativa: il sonno potrebbe non essere ottimale';
            correlationStrength = 'moderate';
        } else {
            insight = 'Correlazione debole: altri fattori influenzano maggiormente le performance';
            correlationStrength = 'weak';
        }

        return {
            correlation: Math.round(correlation * 100) / 100,
            dataPoints,
            insight,
            avgSleep: (sumX / n).toFixed(1),
            avgPerformance: (sumY / n).toFixed(1),
            // Nuovi campi per validità statistica
            isStatisticallyValid,
            varianceWarning,
            correlationStrength,
            stats: {
                n,
                stdDevX: Math.round(stdDevX * 100) / 100,
                stdDevY: Math.round(stdDevY * 100) / 100,
                hasLowVarianceX,
                hasHighLeverageOutlier,
                leveragePointsCount: leveragePoints.length
            }
        };
    }

    /**
     * Rileva punti con alto leverage (outlier che influenzano la regressione)
     */
    _detectHighLeveragePoints(dataPoints, meanX, stdDevX) {
        if (stdDevX === 0) return [];
        
        // Un punto ha alto leverage se è molto distante dalla media su X
        const threshold = 2.5; // Oltre 2.5 deviazioni standard
        return dataPoints.filter(d => {
            const zScore = Math.abs((d.sleep - meanX) / stdDevX);
            return zScore > threshold;
        });
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
     * Mostra TUTTI gli esercizi con il peso reale massimo mai registrato
     */
    getPersonalBestsTimeline(months = 6) {
        const prs = {}; // Traccia il peso reale massimo per esercizio
        const prDetails = {}; // Dettagli del PR (data, reps)

        // Usa TUTTI i log (senza limite di tempo) per trovare i PR
        const sortedLogs = [...this.logs]
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        sortedLogs.forEach(log => {
            (log.exercises || []).forEach(ex => {
                const name = (ex.name || '').toLowerCase();
                const displayName = ex.name || name;
                (ex.sets || []).forEach(set => {
                    const w = parseFloat(set.weight) || 0;
                    const r = parseFloat(set.reps) || 0;
                    if (w > 0 && r > 0) {
                        // Aggiorna se è un nuovo PR
                        if (!prs[name] || w > prs[name]) {
                            prs[name] = w;
                            prDetails[name] = {
                                date: log.date.split('T')[0],
                                exercise: displayName,
                                value: Math.round(w),
                                weight: w,
                                reps: r
                            };
                        }
                    }
                });
            });
        });

        // Converti in array timeline (tutti gli esercizi con PR)
        const timeline = Object.values(prDetails)
            .sort((a, b) => b.value - a.value); // Ordina per peso decrescente

        return {
            timeline: timeline, // TUTTI gli esercizi
            totalPRs: timeline.length,
            currentPRs: timeline.map(pr => ({
                exercise: pr.exercise,
                value: pr.value
            }))
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

        // Helper per estrarre minuti da durata (può essere "45 min", "45", o numero)
        const parseDuration = (duration) => {
            if (typeof duration === 'number') return duration;
            if (typeof duration === 'string') {
                const match = duration.match(/(\d+)/);
                return match ? parseInt(match[1], 10) : 0;
            }
            return 0;
        };

        // Calcola durata media
        const totalDuration = thisWeek.reduce((s, l) => s + parseDuration(l.duration), 0);
        const avgDuration = thisWeek.length > 0 ? Math.round(totalDuration / thisWeek.length) : 0;

        return {
            sessions: thisWeek.length,
            totalVolume: thisVolume,
            volumeChange: parseFloat(volumeChange),
            uniqueExercises: thisExercises.size,
            avgDuration: avgDuration,
            comparedToLastWeek: {
                sessions: thisWeek.length - lastWeek.length,
                volume: thisVolume - lastVolume
            }
        };
    }
}

export const advancedMetrics = new AdvancedMetricsEngine();
