import { db, doc, setDoc, getDoc, updateDoc, arrayUnion } from './firebase-config.js';
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
            
            const data = {
                workouts: localWorkouts,
                logs: localLogs,
                profile: localProfile,
                bodyStats: localBodyStats,
                photos: localPhotos, // Added photos sync
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
                
                return { success: true, data };
            } else {
                return { success: true, data: null, isNew: true };
            }
        } catch (error) {
            console.error("Error loading from Firestore:", error);
            return { success: false, message: error.message };
        }
    }

    // Upload Photo (Generic) - Returns Base64 string
    async processPhotoForUpload(file, maxWidth = 600) {
        try {
            let base64 = await this.fileToBase64(file);
            base64 = await this.resizeImage(base64, maxWidth, 0.6);
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

            // Filter last 30 days logs
            const now = new Date();
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(now.getDate() - 30);

            const recentLogs = localLogs.filter(log => new Date(log.date) >= thirtyDaysAgo);

            // Calculate PRs locally to save tokens
            // Formula: Hybrid (Epley + Brzycki + Lombardi) average for stability
            const estimateOneRM = (weight, reps) => {
                if (!weight || !reps) return 0;
                const epley = weight * (1 + reps / 30);
                const brzycki = (reps < 37) ? weight * (36 / (37 - reps)) : 0;
                const lombardi = weight * Math.pow(reps, 0.10);
                const estimates = [epley, brzycki, lombardi].filter(val => Number.isFinite(val) && val > 0);
                if (!estimates.length) return 0;
                return estimates.reduce((sum, val) => sum + val, 0) / estimates.length;
            };

            const prs = {};
            localLogs.forEach(log => {
                if (!log.exercises) return;
                log.exercises.forEach(ex => {
                    const name = ex.name.toLowerCase();
                    ex.sets.forEach(set => {
                        const w = parseFloat(set.weight);
                        const r = parseFloat(set.reps);
                        if (w > 0 && r > 0) {
                            const oneRM = estimateOneRM(w, r);
                            if (!prs[name] || oneRM > prs[name]['1rm']) {
                                prs[name] = {
                                    '1rm': Math.round(oneRM),
                                    '3rm': Math.round(oneRM * 0.93),
                                    '5rm': Math.round(oneRM * 0.87),
                                    '8rm': Math.round(oneRM * 0.80)
                                };
                            }
                        }
                    });
                });
            });

            // Sort PRs to keep only top 5-10 relevant ones (by 1RM)
            const topPrs = Object.entries(prs)
                .sort(([,a], [,b]) => b['1rm'] - a['1rm'])
                .slice(0, 10)
                .reduce((obj, [key, val]) => ({ ...obj, [key]: val }), {});

            // Simplify Logs for Token Efficiency (Date + Volume + All Exercises for Style Analysis)
            const simplifiedLogs = recentLogs.map(log => {
                // Pass ALL exercises to allow AI to understand the split/structure
                const workoutStructure = log.exercises.map(e => `${e.name} (${e.sets.length} sets)`);
                
                return {
                    date: log.date.split('T')[0],
                    volume: log.totalVolume, // Total tonnage if calculated, or just rely on sets
                    exercises: workoutStructure, // Renamed from mainExercises to avoid confusion
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
                exercises: w.exercises.map(ex => ({
                    name: ex.name,
                    sets: ex.sets,
                    reps: ex.reps,
                    rpe: ex.rpe || 'N/D'
                }))
            }));

            return {
                profile: localProfile,
                bodyStats: localBodyStats.slice(0, 3), // Last 3 weigh-ins
                recentLogs: simplifiedLogs,
                recentWorkoutCount: recentLogs.length,
                prs: topPrs,
                wellness: wellnessSummary,
                domsInsights,
                existingWorkouts
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

    // --- SHARED WORKOUTS (Legacy Support kept but main sharing is now URL-based) ---
    async getSharedWorkout(shareId) {
         try {
            const docSnap = await getDoc(doc(db, 'shared_workouts', shareId));
            if (docSnap.exists()) {
                return { success: true, data: docSnap.data() };
            }
            return { success: false, message: "Scheda non trovata." };
        } catch (error) {
            console.error("Error fetching shared workout:", error);
            return { success: false, message: error.message };
        }
    }
}

export const firestoreService = new FirestoreService();
