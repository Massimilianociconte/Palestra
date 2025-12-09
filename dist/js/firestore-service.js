import { db, doc, setDoc, getDoc, updateDoc, deleteDoc, arrayUnion, serverTimestamp, collection, query, where, orderBy, limit, getDocs } from './firebase-config.js';
import { auth } from './firebase-config.js';
import { computeDomsInsights } from './doms-insights.js';

export class FirestoreService {
    constructor() {
        this.collectionName = 'users';
    }

    // Get current user ID or throw error
    getUid() {
        const user = auth.currentUser;
        if (!user) throw new Error("Utente non autenticato");
        return user.uid;
    }

    // --- GLOBAL CONFIG MANAGEMENT ---

    async getGlobalConfig() {
        try {
            const docSnap = await getDoc(doc(db, 'config', 'global'));
            if (docSnap.exists()) {
                return docSnap.data();
            }
            return null;
        } catch (error) {
            console.warn("Global config not found or accessible:", error);
            return null;
        }
    }

    // Admin tool to set the key once (Run from console: window.firestoreService.setGlobalApiKey('...'))
    async setGlobalApiKey(key) {
        try {
            await setDoc(doc(db, 'config', 'global'), {
                defaultGeminiKey: key
            }, { merge: true });
            console.log("Global API Key stored securely in Firestore.");
            return { success: true };
        } catch (error) {
            console.error("Error setting global key:", error);
            return { success: false, message: error.message };
        }
    }

    // Initialize new user with default settings and keys
    async initializeNewUser(user) {
        try {
            // Try to get global config
            let defaultKey = '';

            try {
                const config = await this.getGlobalConfig();
                defaultKey = config?.defaultGeminiKey || '';
            } catch (e) {
                console.warn("Could not fetch global config, using fallback if available.");
            }

            // Hardcoded fallback removed for security
            if (!defaultKey) defaultKey = '';

            const initialData = {
                profile: {
                    name: user.displayName || '',
                    email: user.email || '',
                    photoUrl: user.photoURL || '',
                    geminiKey: defaultKey, // Auto-assign global key
                    joinDate: new Date().toISOString()
                },
                workouts: [],
                logs: [],
                bodyStats: []
            };

            await setDoc(doc(db, this.collectionName, user.uid), initialData, { merge: true });
            return { success: true };
        } catch (error) {
            console.error("Error initializing user:", error);
            return { success: false, message: error.message };
        }
    }

    // Helper: Convert File to Base64
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    // Helper: Resize Image (Optimized for Mobile/Storage)
    resizeImage(base64Str, maxWidth = 600, quality = 0.6) {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = base64Str;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
        });
    }

    // Save all local data to Firestore
    async syncToCloud() {
        try {
            const uid = this.getUid();
            const localWorkouts = JSON.parse(localStorage.getItem('ironflow_workouts') || '[]');
            const localLogs = JSON.parse(localStorage.getItem('ironflow_logs') || '[]');
            const localProfile = JSON.parse(localStorage.getItem('ironflow_profile') || '{}');
            const localBodyStats = JSON.parse(localStorage.getItem('ironflow_body_stats') || '[]');
            // Sync Photos too (only metadata/Base64 if small enough, typically stored in separate collection or array)
            const localPhotos = JSON.parse(localStorage.getItem('ironflow_photos') || '[]');
            // Sync AI Plan History for persistence across devices
            const localAiPlanHistory = JSON.parse(localStorage.getItem('ironflow_ai_plan_history') || '[]');

            const data = {
                workouts: localWorkouts,
                logs: localLogs,
                profile: localProfile,
                bodyStats: localBodyStats,
                photos: localPhotos, // Added photos sync
                aiPlanHistory: localAiPlanHistory, // AI workout generation history
                lastUpdated: new Date().toISOString()
            };

            await setDoc(doc(db, this.collectionName, uid), data, { merge: true });
            console.log("Data synced to Firestore successfully");
            return { success: true };
        } catch (error) {
            console.error("Error syncing to Firestore:", error);
            return { success: false, message: error.message };
        }
    }

    async loadFromCloud() {
        try {
            const uid = this.getUid();
            const docRef = doc(db, this.collectionName, uid);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.workouts) localStorage.setItem('ironflow_workouts', JSON.stringify(data.workouts));
                if (data.logs) localStorage.setItem('ironflow_logs', JSON.stringify(data.logs));
                if (data.profile) localStorage.setItem('ironflow_profile', JSON.stringify(data.profile));
                if (data.bodyStats) localStorage.setItem('ironflow_body_stats', JSON.stringify(data.bodyStats));
                if (data.photos) localStorage.setItem('ironflow_photos', JSON.stringify(data.photos)); // Load photos
                
                // Merge AI Plan History: combine local and cloud, remove duplicates, sort by date
                const cloudAiHistory = data.aiPlanHistory || [];
                const localAiHistory = JSON.parse(localStorage.getItem('ironflow_ai_plan_history') || '[]');
                const mergedAiHistory = this.mergeAiPlanHistory(localAiHistory, cloudAiHistory);
                localStorage.setItem('ironflow_ai_plan_history', JSON.stringify(mergedAiHistory));
                data.aiPlanHistory = mergedAiHistory; // Update data object for return

                return { success: true, data };
            } else {
                return { success: true, data: null, isNew: true };
            }
        } catch (error) {
            console.error("Error loading from Firestore:", error);
            return { success: false, message: error.message };
        }
    }

    // Merge AI Plan History from local and cloud
    // Combines both arrays, removes duplicates based on createdAt timestamp, sorts by date (newest first)
    mergeAiPlanHistory(localHistory, cloudHistory) {
        const combined = [...(localHistory || []), ...(cloudHistory || [])];
        
        // Create a map to deduplicate by createdAt timestamp
        const uniqueMap = new Map();
        combined.forEach(plan => {
            const key = plan.createdAt || plan.suggestion + '_' + (plan.focus || '').substring(0, 50);
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, plan);
            }
        });
        
        // Convert back to array and sort by createdAt (newest first)
        const merged = Array.from(uniqueMap.values())
            .sort((a, b) => {
                const dateA = new Date(a.createdAt || 0);
                const dateB = new Date(b.createdAt || 0);
                return dateB - dateA;
            })
            .slice(0, 30); // Keep max 30 items
        
        console.log(`📚 AI History merged: ${localHistory?.length || 0} local + ${cloudHistory?.length || 0} cloud = ${merged.length} unique`);
        return merged;
    }

    // Set ImgBB API Key
    async setImgBBKey(key) {
        try {
            await setDoc(doc(db, 'config', 'imgbb'), {
                apiKey: key
            }, { merge: true });
            console.log("ImgBB API Key stored securely.");
            return { success: true };
        } catch (error) {
            console.error("Error setting ImgBB key:", error);
            return { success: false, message: error.message };
        }
    }

    // Get ImgBB API Key
    async getImgBBKey() {
        try {
            const docSnap = await getDoc(doc(db, 'config', 'imgbb'));
            if (docSnap.exists()) {
                return docSnap.data().apiKey;
            }
            return null;
        } catch (error) {
            console.warn("ImgBB config not found:", error);
            return null;
        }
    }

    // Upload to ImgBB
    async uploadToImgBB(base64Image) {
        try {
            const apiKey = await this.getImgBBKey();
            if (!apiKey) throw new Error("ImgBB API Key not found");

            // Remove header if present (data:image/jpeg;base64,)
            const base64Data = base64Image.split(',')[1] || base64Image;

            const formData = new FormData();
            formData.append('key', apiKey);
            formData.append('image', base64Data);

            const response = await fetch('https://api.imgbb.com/1/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                return { success: true, url: result.data.url, deleteUrl: result.data.delete_url };
            } else {
                throw new Error(result.error?.message || 'ImgBB Upload Failed');
            }
        } catch (error) {
            console.error("ImgBB Upload Error:", error);
            return { success: false, message: error.message };
        }
    }

    // Upload Photo (Generic) - Returns URL (ImgBB) or Base64 (Fallback)
    async processPhotoForUpload(file, maxWidth = 600) {
        try {
            let base64 = await this.fileToBase64(file);
            base64 = await this.resizeImage(base64, maxWidth, 0.6);

            // Try ImgBB first
            const imgbbResult = await this.uploadToImgBB(base64);
            if (imgbbResult.success) {
                return { success: true, base64: imgbbResult.url, isUrl: true }; // Return URL in 'base64' field for compatibility
            }

            // Fallback to Base64 if ImgBB fails or no key
            console.warn("ImgBB upload failed or not configured, using Base64 fallback.");
            return { success: true, base64 };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    // Upload profile picture specifically (updates profile field)
    async uploadProfilePhoto(file) {
        try {
            const uid = this.getUid();
            const result = await this.processPhotoForUpload(file, 200); // Smaller for avatar
            if (!result.success) throw new Error(result.message);

            await updateDoc(doc(db, this.collectionName, uid), {
                "profile.photoUrl": result.base64
            });

            const localProfile = JSON.parse(localStorage.getItem('ironflow_profile') || '{}');
            localProfile.photoUrl = result.base64;
            localStorage.setItem('ironflow_profile', JSON.stringify(localProfile));

            return { success: true, url: result.base64 };
        } catch (error) {
            console.error("Error uploading photo:", error);
            return { success: false, message: error.message };
        }
    }

    // ... existing methods ...
    // Save single profile field
    async updateProfileField(field, value) {
        try {
            const uid = this.getUid();
            await setDoc(doc(db, this.collectionName, uid), {
                profile: { [field]: value }
            }, { merge: true });

            const localProfile = JSON.parse(localStorage.getItem('ironflow_profile') || '{}');
            localProfile[field] = value;
            localStorage.setItem('ironflow_profile', JSON.stringify(localProfile));
            return { success: true };
        } catch (error) {
            console.error("Error updating profile:", error);
            return { success: false, message: error.message };
        }
    }

    // Helper: Gather data for AI Analysis
    async gatherDataForAI() {
        try {
            // Fetch fresh data if possible, otherwise use local
            const localLogs = JSON.parse(localStorage.getItem('ironflow_logs') || '[]');
            const localBodyStats = JSON.parse(localStorage.getItem('ironflow_body_stats') || '[]');
            const localProfile = JSON.parse(localStorage.getItem('ironflow_profile') || '{}');

            // Filter last 30 days logs for recent analysis
            const now = new Date();
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(now.getDate() - 30);

            const recentLogs = localLogs.filter(log => new Date(log.date) >= thirtyDaysAgo);

            // Also get 60-90 days ago for progression/regression tracking
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(now.getDate() - 90);
            const sixtyDaysAgo = new Date();
            sixtyDaysAgo.setDate(now.getDate() - 60);

            const historicalLogs = localLogs.filter(log => {
                const logDate = new Date(log.date);
                return logDate >= ninetyDaysAgo && logDate < sixtyDaysAgo;
            });

            // Calculate PRs locally - USA PESI REALI (non stime)
            const prs = {};
            localLogs.forEach(log => {
                if (!log.exercises) return;
                log.exercises.forEach(ex => {
                    const name = ex.name.toLowerCase();
                    ex.sets.forEach(set => {
                        const w = parseFloat(set.weight);
                        const r = parseFloat(set.reps);
                        if (w > 0 && r > 0) {
                            if (!prs[name]) {
                                prs[name] = {
                                    maxWeight: 0,      // Peso reale massimo
                                    maxWeightReps: 0,  // Reps con quel peso
                                    totalSets: 0,
                                    avgWeight: 0,
                                    weightSum: 0
                                };
                            }
                            
                            // Aggiorna peso massimo reale
                            if (w > prs[name].maxWeight) {
                                prs[name].maxWeight = w;
                                prs[name].maxWeightReps = r;
                            }
                            
                            // Calcola media pesi
                            prs[name].weightSum += w;
                            prs[name].totalSets++;
                        }
                    });
                });
            });

            // Calcola medie e formatta per AI
            Object.keys(prs).forEach(name => {
                prs[name].avgWeight = Math.round(prs[name].weightSum / prs[name].totalSets);
                delete prs[name].weightSum;
            });

            // Sort PRs by max weight (PESO REALE) and keep top 10
            const topPrs = Object.entries(prs)
                .sort(([, a], [, b]) => b.maxWeight - a.maxWeight)
                .slice(0, 10)
                .reduce((obj, [key, val]) => ({ ...obj, [key]: val }), {});

            // Simplify Logs for Token Efficiency (Date + Volume + All Exercises for Style Analysis + RPE + Set Types)
            const simplifiedLogs = recentLogs.map(log => {
                // Pass ALL exercises to allow AI to understand the split/structure
                const workoutStructure = log.exercises.map(e => {
                    // Calculate average RPE for this exercise if available
                    const rpeValues = e.sets
                        .map(s => s.rpe)
                        .filter(rpe => rpe && rpe > 0);
                    const avgRpe = rpeValues.length > 0
                        ? (rpeValues.reduce((sum, val) => sum + val, 0) / rpeValues.length).toFixed(1)
                        : null;

                    // Check for special set types
                    const setTypes = e.sets.map(s => s.type || 'normal');
                    const hasSpecialSets = setTypes.some(t => t !== 'normal');
                    
                    let setsDescription;
                    if (hasSpecialSets) {
                        // Count sets by type for compact representation
                        const typeCounts = {};
                        setTypes.forEach(t => {
                            typeCounts[t] = (typeCounts[t] || 0) + 1;
                        });
                        setsDescription = Object.entries(typeCounts)
                            .map(([type, count]) => `${count}${type.charAt(0).toUpperCase()}`) // e.g., "3N+1B" for 3 normal + 1 backoff
                            .join('+');
                    } else {
                        setsDescription = `${e.sets.length}`;
                    }

                    let result = `${e.name} (${setsDescription} sets`;
                    if (avgRpe) result += ` @ RPE ${avgRpe}`;
                    result += ')';
                    
                    return result;
                });

                // Calculate overall workout RPE average (use log.avgRpe if available, otherwise calculate)
                let workoutAvgRpe = log.avgRpe;
                if (!workoutAvgRpe) {
                    const allRpeValues = log.exercises
                        .flatMap(e => e.sets.map(s => s.rpe))
                        .filter(rpe => rpe && rpe > 0);
                    workoutAvgRpe = allRpeValues.length > 0
                        ? (allRpeValues.reduce((sum, val) => sum + val, 0) / allRpeValues.length).toFixed(1)
                        : null;
                }

                return {
                    date: log.date.split('T')[0],
                    name: log.workoutName || 'Workout', // Include workout name
                    volume: log.totalVolume,
                    exercises: workoutStructure,
                    avgRpe: workoutAvgRpe,
                    duration: log.duration || null, // Include duration
                    wellness: log.wellness ? {
                        sleepQuality: log.wellness.sleepQuality,
                        energyLevel: log.wellness.energyLevel,
                        stressLevel: log.wellness.stressLevel,
                        sorenessLevel: log.wellness.sorenessLevel
                    } : undefined,
                    domsTargets: Array.isArray(log.wellness?.sorenessMuscles) && log.wellness.sorenessMuscles.length
                        ? log.wellness.sorenessMuscles
                        : undefined
                };
            });

            const avgWellness = (field) => {
                const values = recentLogs
                    .map(log => log.wellness?.[field])
                    .filter(val => typeof val === 'number' && !Number.isNaN(val));
                return values.length ? (values.reduce((sum, val) => sum + val, 0) / values.length) : null;
            };

            const wellnessSummary = {
                sleepQuality: avgWellness('sleepQuality'),
                energyLevel: avgWellness('energyLevel'),
                stressLevel: avgWellness('stressLevel'),
                sorenessLevel: avgWellness('sorenessLevel')
            };

            const domsInsights = computeDomsInsights(localLogs);

            // Get existing workouts (Schede) created by user
            const existingWorkouts = JSON.parse(localStorage.getItem('ironflow_workouts') || '[]').map(w => ({
                name: w.name,
                exercises: w.exercises.map(ex => {
                    // Handle both old format (sets as number) and new format (sets as array)
                    let setsInfo;
                    if (Array.isArray(ex.sets)) {
                        // New format - array of set objects with types
                        const setTypes = ex.sets.map(s => s.type || 'normal');
                        const uniqueTypes = [...new Set(setTypes)];
                        const hasSpecialSets = uniqueTypes.some(t => t !== 'normal');
                        
                        if (hasSpecialSets) {
                            // Count sets by type
                            const typeCounts = {};
                            setTypes.forEach(t => {
                                typeCounts[t] = (typeCounts[t] || 0) + 1;
                            });
                            setsInfo = Object.entries(typeCounts)
                                .map(([type, count]) => `${count}x${type}`)
                                .join('+');
                        } else {
                            setsInfo = ex.sets.length;
                        }
                        
                        // Get target reps from first set
                        const targetReps = ex.sets[0]?.target || ex.sets[0]?.reps || 'N/D';
                        const targetRpe = ex.sets[0]?.rpe || 'N/D';
                        
                        return {
                            name: ex.name,
                            sets: setsInfo,
                            reps: targetReps,
                            rpe: targetRpe,
                            hasSpecialSets: hasSpecialSets
                        };
                    } else {
                        // Old format - sets as number
                        return {
                            name: ex.name,
                            sets: ex.sets,
                            reps: ex.reps,
                            rpe: ex.rpe || 'N/D'
                        };
                    }
                })
            }));

            // Calculate historical PRs for progression/regression tracking (PESI REALI)
            const historicalPrs = {};
            historicalLogs.forEach(log => {
                if (!log.exercises) return;
                log.exercises.forEach(ex => {
                    const name = ex.name.toLowerCase();
                    ex.sets.forEach(set => {
                        const w = parseFloat(set.weight);
                        const r = parseFloat(set.reps);
                        if (w > 0) {
                            if (!historicalPrs[name] || w > historicalPrs[name].maxWeight) {
                                historicalPrs[name] = {
                                    maxWeight: w,
                                    reps: r
                                };
                            }
                        }
                    });
                });
            });

            // Calculate progression/regression for each lift (PESI REALI)
            const progressionData = {};
            Object.keys(topPrs).forEach(lift => {
                const current = topPrs[lift].maxWeight;
                const historical = historicalPrs[lift]?.maxWeight || 0;
                if (historical > 0) {
                    const change = current - historical;
                    const changePercent = ((change / historical) * 100).toFixed(1);
                    progressionData[lift] = {
                        current: current,
                        historical: historical,
                        change: change,
                        changePercent: parseFloat(changePercent),
                        status: change > 0 ? 'progressing' : change < 0 ? 'regressing' : 'stable'
                    };
                }
            });

            // === STIME 1RM PER SUGGERIMENTO PESO ===
            // Formula ibrida per calcolare 1RM
            const calculateHybrid1RM = (weight, reps) => {
                if (reps === 1) return weight;
                if (reps > 15) return null;
                const epley = weight * (1 + reps / 30);
                const brzycki = weight * (36 / (37 - reps));
                const lombardi = weight * Math.pow(reps, 0.1);
                const mayhew = weight * (100 / (52.2 + 41.9 * Math.exp(-0.055 * reps)));
                const wathen = weight * (100 / (48.8 + 53.8 * Math.exp(-0.075 * reps)));
                return (epley * 0.25 + brzycki * 0.25 + lombardi * 0.15 + mayhew * 0.15 + wathen * 0.2);
            };

            // Normalizza nome esercizio per matching (versione aggressiva)
            const normalizeExerciseName = (name) => {
                return (name || '').toLowerCase().trim()
                    .replace(/\s+/g, ' ')
                    .replace(/[àáâã]/g, 'a')
                    .replace(/[èéêë]/g, 'e')
                    .replace(/[ìíîï]/g, 'i')
                    .replace(/[òóôõ]/g, 'o')
                    .replace(/[ùúûü]/g, 'u')
                    .replace(/\(.*?\)/g, '') // Rimuove contenuto tra parentesi
                    .replace(/[:;,\-–]/g, ' ') // Rimuove punteggiatura
                    .replace(/\s+/g, ' ')
                    .trim();
            };

            // Calcola stime 1RM per ogni esercizio dai log
            const exerciseEstimates = {};
            localLogs.forEach(log => {
                if (!log.exercises) return;
                log.exercises.forEach(ex => {
                    const name = normalizeExerciseName(ex.name);
                    if (!name || !ex.sets) return;
                    
                    ex.sets.forEach(set => {
                        const w = parseFloat(set.weight);
                        const r = parseInt(set.reps);
                        if (w > 0 && r > 0 && r <= 15) {
                            const est1RM = calculateHybrid1RM(w, r);
                            if (est1RM && (!exerciseEstimates[name] || est1RM > exerciseEstimates[name].est1RM)) {
                                exerciseEstimates[name] = {
                                    est1RM: Math.round(est1RM * 10) / 10,
                                    basedOn: `${w}kg x ${r}`,
                                    originalName: ex.name
                                };
                            }
                        }
                    });
                });
            });

            // Get health data from Google Fit or Terra/Apple Health (last 7 days)
            let healthData = null;
            try {
                const healthRecords = await this.getHealthData(7);
                if (healthRecords && healthRecords.length > 0) {
                    // Get the most recent record
                    const latestHealth = healthRecords[0];

                    // Decode TOON format to plain values for AI
                    // Helper to decode TOON string
                    const decodeTOON = (toonString) => {
                        if (!toonString || typeof toonString !== 'string') return null;
                        if (!toonString.includes('|')) return toonString; // Not TOON format
                        const parts = toonString.split('|');
                        return parseFloat(parts[1]);
                    };

                    healthData = {
                        // Base metrics (available from both Google Fit and Terra)
                        steps: decodeTOON(latestHealth.steps),
                        heartRate: decodeTOON(latestHealth.heartRate),
                        weight: decodeTOON(latestHealth.weight),
                        calories: decodeTOON(latestHealth.calories),
                        distance: decodeTOON(latestHealth.distance),
                        sleep: decodeTOON(latestHealth.sleep),
                        
                        // Advanced metrics (may be available from Terra/Apple Health)
                        activeMinutes: decodeTOON(latestHealth.activeMinutes),
                        hrv: decodeTOON(latestHealth.hrv),
                        bodyFat: decodeTOON(latestHealth.bodyFat),
                        height: decodeTOON(latestHealth.height),
                        restingHeartRate: decodeTOON(latestHealth.restingHeartRate),
                        vo2Max: decodeTOON(latestHealth.vo2Max),
                        oxygenSaturation: decodeTOON(latestHealth.oxygenSaturation),
                        respiratoryRate: decodeTOON(latestHealth.respiratoryRate),
                        
                        // Metadata
                        syncTimestamp: latestHealth.syncTimestamp || null,
                        source: latestHealth.source || 'unknown'
                    };
                    
                    // Remove null values to keep payload clean
                    Object.keys(healthData).forEach(key => {
                        if (healthData[key] === null || healthData[key] === undefined) {
                            delete healthData[key];
                        }
                    });
                }
            } catch (error) {
                console.warn('Could not load health data for AI:', error);
            }

            return {
                profile: localProfile,
                bodyStats: localBodyStats.slice(0, 5), // Last 5 weigh-ins for trend
                recentLogs: simplifiedLogs,
                recentWorkoutCount: recentLogs.length,
                historicalWorkoutCount: historicalLogs.length,
                // PR con PESI REALI (non stime)
                prs: topPrs,
                historicalPrs: Object.entries(historicalPrs)
                    .sort(([, a], [, b]) => b.maxWeight - a.maxWeight)
                    .slice(0, 10)
                    .reduce((obj, [key, val]) => ({ ...obj, [key]: val }), {}),
                progressionData: progressionData,
                wellness: wellnessSummary,
                domsInsights,
                existingWorkouts,
                healthData: healthData, // Health data in TOON format
                // Nota per AI: i pesi nei PR sono REALI, non stime 1RM
                prNote: 'I pesi nei PR sono i massimi REALI sollevati, non stime 1RM',
                // Stime 1RM per suggerimento peso nelle schede AI
                exerciseEstimates: exerciseEstimates
            };

        } catch (e) {
            console.error("Error gathering data:", e);
            return null;
        }
    }

    // Save AI Analysis to Firestore History
    async saveAIAnalysis(text) {
        try {
            const uid = this.getUid();
            const analysisEntry = {
                date: new Date().toISOString(),
                text: text,
                summary: text.substring(0, 100) + '...' // Preview
            };

            // Use arrayUnion to add to an array "aiHistory" in the user doc
            await updateDoc(doc(db, this.collectionName, uid), {
                aiHistory: arrayUnion(analysisEntry)
            });

            return { success: true };
        } catch (error) {
            console.error("Error saving AI analysis:", error);
            return { success: false, message: error.message };
        }
    }

    // Load AI History
    async getAIHistory() {
        try {
            const uid = this.getUid();
            const docSnap = await getDoc(doc(db, this.collectionName, uid));
            if (docSnap.exists()) {
                const data = docSnap.data();
                return data.aiHistory || []; // Return empty array if no history
            }
            return [];
        } catch (error) {
            console.error("Error loading history:", error);
            return [];
        }
    }

    // --- SHARED WORKOUTS (SHORT LINKS) ---

    // Generate a 6-character short ID
    generateShortId() {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = '';
        for (let i = 0; i < 6; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return id;
    }

    // Generate unique short ID with collision check
    // @param {string} prefix - Optional prefix for the ID (e.g., 'L' for logs)
    async generateUniqueShortId(prefix = '', maxRetries = 5) {
        // Determine which collection to check based on prefix
        const collection = prefix === 'L' ? 'shared_logs' : 'shared_workouts';
        
        for (let i = 0; i < maxRetries; i++) {
            const baseId = this.generateShortId();
            const shortId = prefix ? `${prefix}${baseId}` : baseId;

            // Check if ID already exists
            const docRef = doc(db, collection, shortId);
            const docSnap = await getDoc(docRef);

            if (!docSnap.exists()) {
                return shortId;
            }

            console.warn(`Short ID collision: ${shortId}, retrying...`);
        }

        throw new Error('Failed to generate unique short ID after maximum retries');
    }

    // Create a shared workout with short link
    async createSharedWorkout(workoutData) {
        try {
            // Clean data before saving
            const cleanData = JSON.parse(JSON.stringify(workoutData));
            delete cleanData.id; // Remove local ID

            // Generate unique short ID
            const shortId = await this.generateUniqueShortId();

            // Use short ID as document ID
            await setDoc(doc(db, 'shared_workouts', shortId), {
                workoutData: cleanData,
                createdAt: serverTimestamp(),
                createdBy: this.getUid() || 'anonymous',
                shortId: shortId // Store for reference
            });

            return shortId; // Return just the short ID
        } catch (error) {
            console.error("Error creating shared workout:", error);
            throw new Error(`Impossibile creare link di condivisione: ${error.message}`);
        }
    }

    // Get shared workout by short ID (case-insensitive)
    async getSharedWorkout(shareId) {
        try {
            if (!shareId || shareId.length < 6) {
                throw new Error('ID condivisione non valido');
            }

            // Try exact match first
            let docSnap = await getDoc(doc(db, 'shared_workouts', shareId));

            // If not found and ID looks like it might be case-mismatched, try case-insensitive search
            if (!docSnap.exists() && /^[a-zA-Z0-9]{6}$/.test(shareId)) {
                // This is a fallback - in production you'd want to use Firestore queries
                // For now, we'll just return not found
                console.warn('Workout not found with ID:', shareId);
                throw new Error('Link di condivisione non valido o scaduto');
            }

            if (docSnap.exists()) {
                const data = docSnap.data();
                return data.workoutData; // Return just the workout data
            } else {
                throw new Error('Link di condivisione non valido o scaduto');
            }
        } catch (error) {
            console.error("Error getting shared workout:", error);
            throw error;
        }
    }

    // --- SHARED WORKOUT LOGS (Diary Sharing) ---

    /**
     * Create a shared workout log (from diary) with short link
     * @param {Object} logData - The workout log data to share
     * @returns {string} - The short ID for the share link
     */
    async createSharedWorkoutLog(logData) {
        try {
            // Clean data before saving
            const cleanData = JSON.parse(JSON.stringify(logData));
            
            // Generate unique short ID (different prefix for logs)
            const shortId = await this.generateUniqueShortId('L'); // L prefix for logs

            // Use short ID as document ID
            await setDoc(doc(db, 'shared_logs', shortId), {
                logData: cleanData,
                createdAt: serverTimestamp(),
                createdBy: this.getUid() || 'anonymous',
                shortId: shortId,
                type: 'workout_log'
            });

            return shortId;
        } catch (error) {
            console.error("Error creating shared workout log:", error);
            throw new Error(`Impossibile creare link di condivisione: ${error.message}`);
        }
    }

    /**
     * Get shared workout log by short ID
     * @param {string} shareId - The short ID
     * @returns {Object} - The workout log data
     */
    async getSharedWorkoutLog(shareId) {
        try {
            if (!shareId || shareId.length < 6) {
                throw new Error('ID condivisione non valido');
            }

            const docSnap = await getDoc(doc(db, 'shared_logs', shareId));

            if (docSnap.exists()) {
                const data = docSnap.data();
                return data.logData;
            } else {
                throw new Error('Link di condivisione non valido o scaduto');
            }
        } catch (error) {
            console.error("Error getting shared workout log:", error);
            throw error;
        }
    }

    // --- HEALTH DATA (Google Fit / Health Connect Integration) ---

    /**
     * Salva dati health in formato TOON
     */
    async saveHealthData(toonHealthData) {
        const user = auth.currentUser;
        if (!user) throw new Error('User not authenticated');

        try {
            const healthRef = doc(db, 'users', user.uid, 'health', new Date().toISOString().split('T')[0]);
            await setDoc(healthRef, {
                ...toonHealthData,
                syncTimestamp: Date.now(),
                updatedAt: serverTimestamp()
            }, { merge: true });

            return { success: true };
        } catch (error) {
            console.error('Error saving health data:', error);
            throw error;
        }
    }

    /**
     * Get dati health per periodo
     */
    async getHealthData(days = 7) {
        const user = auth.currentUser;
        if (!user) return [];

        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const healthRef = collection(db, 'users', user.uid, 'health');
            const q = query(
                healthRef,
                where('syncTimestamp', '>=', startDate.getTime()),
                orderBy('syncTimestamp', 'desc')
            );

            const snapshot = await getDocs(q);
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        } catch (error) {
            console.error('Error getting health data:', error);
            return [];
        }
    }

    /**
     * Salva token OAuth Google Fit
     */
    async saveHealthToken(tokenData) {
        const user = auth.currentUser;
        if (!user) throw new Error('User not authenticated');

        try {
            const tokenRef = doc(db, 'users', user.uid, 'private', 'healthToken');
            await setDoc(tokenRef, {
                ...tokenData,
                updatedAt: serverTimestamp()
            });

            return { success: true };
        } catch (error) {
            console.error('Error saving health token:', error);
            throw error;
        }
    }

    /**
     * Get token OAuth Google Fit
     */
    async getHealthToken() {
        const user = auth.currentUser;
        if (!user) return null;

        try {
            const tokenRef = doc(db, 'users', user.uid, 'private', 'healthToken');
            const docSnap = await getDoc(tokenRef);

            if (docSnap.exists()) {
                return docSnap.data();
            }
            return null;
        } catch (error) {
            console.error('Error getting health token:', error);
            return null;
        }
    }

    /**
     * Rimuovi token OAuth Google Fit
     */
    async removeHealthToken() {
        const user = auth.currentUser;
        if (!user) return;

        try {
            const tokenRef = doc(db, 'users', user.uid, 'private', 'healthToken');
            await deleteDoc(tokenRef);
            return { success: true };
        } catch (error) {
            console.error('Error removing health token:', error);
            throw error;
        }
    }

    /**
     * Get ultimo sync health data
     */
    async getLastHealthSync() {
        const user = auth.currentUser;
        if (!user) return null;

        try {
            const healthRef = collection(db, 'users', user.uid, 'health');
            const q = query(healthRef, orderBy('syncTimestamp', 'desc'), limit(1));
            const snapshot = await getDocs(q);

            if (!snapshot.empty) {
                return snapshot.docs[0].data();
            }
            return null;
        } catch (error) {
            console.error('Error getting last health sync:', error);
            return null;
        }
    }

    // --- TERRA API INTEGRATION (Apple Health) ---

    /**
     * Get Terra API configuration
     */
    async getTerraConfig() {
        try {
            const docSnap = await getDoc(doc(db, 'config', 'terra'));
            if (docSnap.exists()) {
                return docSnap.data();
            }
            return null;
        } catch (error) {
            console.warn('Terra config not found:', error);
            return null;
        }
    }

    /**
     * Set Terra API configuration (Admin only)
     */
    async setTerraConfig(devId, apiKey) {
        try {
            await setDoc(doc(db, 'config', 'terra'), {
                devId: devId,
                apiKey: apiKey,
                updatedAt: serverTimestamp()
            });
            return { success: true };
        } catch (error) {
            console.error('Error setting Terra config:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Save Terra user connection data
     */
    async saveTerraUserData(terraData) {
        const user = auth.currentUser;
        if (!user) throw new Error('User not authenticated');

        try {
            const terraRef = doc(db, 'users', user.uid, 'private', 'terraConnection');
            await setDoc(terraRef, {
                ...terraData,
                updatedAt: serverTimestamp()
            });
            return { success: true };
        } catch (error) {
            console.error('Error saving Terra user data:', error);
            throw error;
        }
    }

    /**
     * Get Terra user connection data
     */
    async getTerraUserData() {
        const user = auth.currentUser;
        if (!user) return null;

        try {
            const terraRef = doc(db, 'users', user.uid, 'private', 'terraConnection');
            const docSnap = await getDoc(terraRef);

            if (docSnap.exists()) {
                return docSnap.data();
            }
            return null;
        } catch (error) {
            console.error('Error getting Terra user data:', error);
            return null;
        }
    }

    /**
     * Remove Terra user connection
     */
    async removeTerraUserData() {
        const user = auth.currentUser;
        if (!user) return;

        try {
            const terraRef = doc(db, 'users', user.uid, 'private', 'terraConnection');
            await deleteDoc(terraRef);
            return { success: true };
        } catch (error) {
            console.error('Error removing Terra user data:', error);
            throw error;
        }
    }

    /**
     * Update Terra last sync timestamp
     */
    async updateTerraLastSync(timestamp) {
        const user = auth.currentUser;
        if (!user) return;

        try {
            const terraRef = doc(db, 'users', user.uid, 'private', 'terraConnection');
            await updateDoc(terraRef, {
                lastSync: timestamp,
                updatedAt: serverTimestamp()
            });
            return { success: true };
        } catch (error) {
            console.error('Error updating Terra last sync:', error);
            throw error;
        }
    }

    /**
     * Check which health provider is connected
     * Returns: 'google_fit', 'terra_apple', 'terra_samsung', or null
     */
    async getConnectedHealthProvider() {
        const user = auth.currentUser;
        if (!user) return null;

        try {
            // Check Google Fit first
            const healthToken = await this.getHealthToken();
            if (healthToken && healthToken.accessToken) {
                return 'google_fit';
            }

            // Check Terra
            const terraData = await this.getTerraUserData();
            if (terraData && terraData.userId) {
                return `terra_${(terraData.provider || 'unknown').toLowerCase()}`;
            }

            return null;
        } catch (error) {
            console.error('Error checking health provider:', error);
            return null;
        }
    }
}

export const firestoreService = new FirestoreService();
