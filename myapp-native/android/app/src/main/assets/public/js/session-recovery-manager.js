// Session Recovery Manager for Focus Mode
// ROBUST system for saving and restoring interrupted workout sessions
// Handles: crashes, accidental exits, tab switches, PWA issues, browser kills
// ENHANCED: Native APK support via Capacitor, aggressive crash recovery

const STORAGE_KEY = 'ironflow_focus_session_state';
const BACKUP_KEY = 'ironflow_focus_session_backup';
const NATIVE_BACKUP_KEY = 'ironflow_native_session_backup';
const STALE_THRESHOLD = 4 * 60 * 60 * 1000; // 4 hours (increased from 2)
const AUTO_SAVE_INTERVAL = 5000; // 5 seconds (reduced for better crash recovery)
const CRITICAL_SAVE_DEBOUNCE = 300; // 300ms debounce for critical saves
const HEARTBEAT_INTERVAL = 2000; // 2 seconds heartbeat for crash detection

export class SessionRecoveryManager {
    constructor() {
        this.autoSaveInterval = null;
        this.heartbeatInterval = null;
        this.sessionState = null;
        this.getStateCallback = null;
        this.criticalSaveTimeout = null;
        this.isInitialized = false;
        this.db = null; // IndexedDB reference
        this.isNativeApp = false; // Capacitor native app detection
        this.lastHeartbeat = Date.now();
        this.crashDetected = false;
    }

    // Initialize and check for existing session
    async init() {
        // Detect if running in Capacitor native app
        this.isNativeApp = typeof window.Capacitor !== 'undefined' && window.Capacitor.isNativePlatform();
        console.log(`🔧 Session Recovery: ${this.isNativeApp ? 'Native APK' : 'Web/PWA'} mode`);
        
        // Setup emergency save handlers FIRST
        this.setupEmergencyHandlers();
        
        // Setup native app specific handlers
        if (this.isNativeApp) {
            this.setupNativeHandlers();
        }
        
        // Try to open IndexedDB for backup storage
        await this.initIndexedDB();
        
        // Check for crash (heartbeat was not updated)
        await this.detectCrash();
        
        this.isInitialized = true;
        
        // Check for saved session (try IndexedDB first, then localStorage)
        const savedState = await this.getSavedSession();

        if (savedState && !this.isStale(savedState)) {
            console.log('🔄 Found recoverable session from', new Date(savedState.timestamp).toLocaleString());
            if (this.crashDetected) {
                console.log('💥 Session recovered after crash/force close');
                savedState.wasRecoveredFromCrash = true;
            }
            return savedState; // Return for recovery prompt
        } else if (savedState) {
            // Clear stale session
            console.log('🗑️ Clearing stale session');
            await this.clearSession();
        }

        return null;
    }
    
    // Detect if app crashed (heartbeat wasn't properly stopped)
    async detectCrash() {
        try {
            const lastHeartbeat = localStorage.getItem('ironflow_session_heartbeat');
            const sessionActive = localStorage.getItem('ironflow_session_active');
            
            if (sessionActive === 'true' && lastHeartbeat) {
                const timeSinceHeartbeat = Date.now() - parseInt(lastHeartbeat);
                // If heartbeat is older than 30 seconds but session was active, it was a crash
                if (timeSinceHeartbeat > 30000) {
                    this.crashDetected = true;
                    console.log('💥 Crash detected! Last heartbeat:', Math.round(timeSinceHeartbeat / 1000), 'seconds ago');
                }
            }
        } catch (e) {
            console.warn('Crash detection failed:', e);
        }
    }
    
    // Setup native app specific handlers (Capacitor)
    setupNativeHandlers() {
        // Listen for Capacitor App state changes
        if (window.Capacitor?.Plugins?.App) {
            const { App } = window.Capacitor.Plugins;
            
            // App going to background
            App.addListener('appStateChange', ({ isActive }) => {
                if (!isActive) {
                    this.emergencySave('native-background');
                    console.log('📱 App going to background - session saved');
                } else {
                    // App coming to foreground - verify session
                    this.verifySessionIntegrity();
                    console.log('📱 App resumed - verifying session');
                }
            });
            
            // App being terminated
            App.addListener('backButton', () => {
                this.emergencySave('native-backbutton');
            });
            
            console.log('📱 Native Capacitor handlers installed');
        }
        
        // Additional native-specific storage using Capacitor Preferences
        if (window.Capacitor?.Plugins?.Preferences) {
            console.log('📱 Capacitor Preferences available for backup');
        }
    }

    // Initialize IndexedDB for more reliable storage
    async initIndexedDB() {
        return new Promise((resolve) => {
            try {
                const request = indexedDB.open('IronFlowSessionDB', 1);
                
                request.onerror = () => {
                    console.warn('IndexedDB not available, using localStorage only');
                    resolve(false);
                };
                
                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    console.log('✅ IndexedDB initialized for session backup');
                    resolve(true);
                };
                
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains('sessions')) {
                        db.createObjectStore('sessions', { keyPath: 'id' });
                    }
                };
            } catch (error) {
                console.warn('IndexedDB error:', error);
                resolve(false);
            }
        });
    }

    // Setup emergency save handlers for various scenarios
    setupEmergencyHandlers() {
        // 1. Page unload (closing tab, navigating away)
        window.addEventListener('beforeunload', (e) => {
            this.emergencySave('beforeunload');
        });

        // 2. Page hide (switching tabs, minimizing, PWA background)
        window.addEventListener('pagehide', (e) => {
            this.emergencySave('pagehide');
        });

        // 3. Visibility change (tab switch, screen lock)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.emergencySave('visibilitychange-hidden');
            } else if (document.visibilityState === 'visible') {
                // When coming back, verify session integrity
                this.verifySessionIntegrity();
            }
        });

        // 4. Page freeze (Chrome's Page Lifecycle API for frozen tabs)
        if ('onfreeze' in document) {
            document.addEventListener('freeze', () => {
                this.emergencySave('freeze');
            });
        }

        // 5. Online/Offline changes (network issues)
        window.addEventListener('offline', () => {
            this.emergencySave('offline');
            console.log('📴 Gone offline - session saved');
        });

        // 6. Error handler for crashes
        window.addEventListener('error', (e) => {
            this.emergencySave('error');
            console.error('💥 Error detected - emergency save triggered');
        });

        // 7. Unhandled promise rejections
        window.addEventListener('unhandledrejection', (e) => {
            this.emergencySave('unhandledrejection');
            console.error('💥 Unhandled rejection - emergency save triggered');
        });

        // 8. Focus/Blur for PWA issues
        window.addEventListener('blur', () => {
            this.emergencySave('blur');
        });

        console.log('🛡️ Emergency save handlers installed');
    }

    // Emergency save - synchronous and fast
    emergencySave(reason) {
        if (!this.getStateCallback) return;
        
        try {
            const currentState = this.getStateCallback();
            if (currentState && currentState.workout) {
                // Use synchronous localStorage for emergency saves
                const sessionState = this.buildSessionState(currentState);
                sessionState.emergencySaveReason = reason;
                sessionState.emergencySaveTime = Date.now();
                
                // Save to localStorage (synchronous, more reliable for emergencies)
                localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionState));
                
                // Also save backup
                localStorage.setItem(BACKUP_KEY, JSON.stringify(sessionState));
                
                console.log(`🚨 Emergency save (${reason}):`, new Date().toLocaleTimeString());
            }
        } catch (error) {
            console.error('Emergency save failed:', error);
        }
    }

    // Verify session integrity when returning to the app
    async verifySessionIntegrity() {
        try {
            const localSession = this.getFromLocalStorage();
            const backupSession = this.getBackupFromLocalStorage();
            const idbSession = await this.getFromIndexedDB();
            
            // Use the most recent valid session
            const sessions = [localSession, backupSession, idbSession].filter(s => s && !this.isStale(s));
            
            if (sessions.length > 1) {
                // Sort by timestamp, use most recent
                sessions.sort((a, b) => b.timestamp - a.timestamp);
                const mostRecent = sessions[0];
                
                // Sync all storage locations
                await this.saveToAllStorages(mostRecent);
                console.log('✅ Session integrity verified and synced');
            }
        } catch (error) {
            console.warn('Session integrity check failed:', error);
        }
    }

    // Build session state object
    buildSessionState(state) {
        return {
            timestamp: Date.now(),
            workout: state.workout,
            workoutId: state.workoutId,
            currentExerciseIndex: state.currentExerciseIndex,
            currentSetIndex: state.currentSetIndex,
            completedSets: state.completedSets || [],
            setHistory: state.setHistory || [], // NEW: Full history of completed sets with data
            isResting: state.isResting || false,
            remainingRestTime: state.remainingRestTime || 0,
            sessionStartTime: state.sessionStartTime,
            wellnessData: state.wellnessData || null,
            totalVolume: state.totalVolume || 0, // NEW: Track total volume
            exerciseProgress: state.exerciseProgress || {}, // NEW: Per-exercise progress
            version: 2 // Version for future migrations
        };
    }

    // Get saved session from all storage locations
    async getSavedSession() {
        try {
            // Collect all available sessions
            const sessions = [];
            
            // Try localStorage first (fastest)
            const localSession = this.getFromLocalStorage();
            if (localSession && !this.isStale(localSession)) {
                sessions.push({ source: 'localStorage', data: localSession });
            }
            
            // Try backup localStorage
            const backupSession = this.getBackupFromLocalStorage();
            if (backupSession && !this.isStale(backupSession)) {
                sessions.push({ source: 'backup', data: backupSession });
            }
            
            // Try IndexedDB
            const idbSession = await this.getFromIndexedDB();
            if (idbSession && !this.isStale(idbSession)) {
                sessions.push({ source: 'IndexedDB', data: idbSession });
            }
            
            // Try native storage (Capacitor)
            if (this.isNativeApp) {
                const nativeSession = await this.getFromNativeStorage();
                if (nativeSession && !this.isStale(nativeSession)) {
                    sessions.push({ source: 'NativeStorage', data: nativeSession });
                }
            }
            
            // Return the most recent valid session
            if (sessions.length === 0) return null;
            
            // Sort by timestamp (most recent first)
            sessions.sort((a, b) => (b.data.timestamp || 0) - (a.data.timestamp || 0));
            
            const best = sessions[0];
            console.log(`📦 Restored from ${best.source} (${sessions.length} backups found)`);
            
            return best.data;
        } catch (error) {
            console.error('Error reading saved session:', error);
            return null;
        }
    }

    // Get from localStorage
    getFromLocalStorage() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            return null;
        }
    }

    // Get backup from localStorage
    getBackupFromLocalStorage() {
        try {
            const saved = localStorage.getItem(BACKUP_KEY);
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            return null;
        }
    }

    // Get from IndexedDB
    async getFromIndexedDB() {
        if (!this.db) return null;
        
        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction(['sessions'], 'readonly');
                const store = transaction.objectStore('sessions');
                const request = store.get('current');
                
                request.onsuccess = () => {
                    resolve(request.result?.data || null);
                };
                
                request.onerror = () => {
                    resolve(null);
                };
            } catch (error) {
                resolve(null);
            }
        });
    }

    // Save to IndexedDB
    async saveToIndexedDB(sessionState) {
        if (!this.db) return;
        
        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction(['sessions'], 'readwrite');
                const store = transaction.objectStore('sessions');
                store.put({ id: 'current', data: sessionState });
                
                transaction.oncomplete = () => resolve(true);
                transaction.onerror = () => resolve(false);
            } catch (error) {
                resolve(false);
            }
        });
    }

    // Save to all storage locations
    async saveToAllStorages(sessionState) {
        // localStorage (primary)
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionState));
        } catch (e) {
            console.warn('localStorage save failed:', e);
        }
        
        // localStorage backup
        try {
            localStorage.setItem(BACKUP_KEY, JSON.stringify(sessionState));
        } catch (e) {
            console.warn('Backup localStorage save failed:', e);
        }
        
        // IndexedDB
        await this.saveToIndexedDB(sessionState);
        
        // Native Capacitor Preferences (for APK)
        if (this.isNativeApp) {
            await this.saveToNativeStorage(sessionState);
        }
    }
    
    // Save to Capacitor Preferences (native storage)
    async saveToNativeStorage(sessionState) {
        if (!window.Capacitor?.Plugins?.Preferences) return;
        
        try {
            await window.Capacitor.Plugins.Preferences.set({
                key: NATIVE_BACKUP_KEY,
                value: JSON.stringify(sessionState)
            });
        } catch (e) {
            console.warn('Native storage save failed:', e);
        }
    }
    
    // Get from Capacitor Preferences (native storage)
    async getFromNativeStorage() {
        if (!window.Capacitor?.Plugins?.Preferences) return null;
        
        try {
            const result = await window.Capacitor.Plugins.Preferences.get({ key: NATIVE_BACKUP_KEY });
            return result.value ? JSON.parse(result.value) : null;
        } catch (e) {
            console.warn('Native storage read failed:', e);
            return null;
        }
    }

    // Check if session is stale
    isStale(sessionState) {
        if (!sessionState || !sessionState.timestamp) return true;

        const age = Date.now() - sessionState.timestamp;
        return age > STALE_THRESHOLD;
    }

    // Save current session state (called by auto-save and manual triggers)
    async saveSession(state) {
        try {
            const sessionState = this.buildSessionState(state);
            
            await this.saveToAllStorages(sessionState);
            this.sessionState = sessionState;

            // Log only every 30 seconds to reduce noise
            if (Date.now() % 30000 < AUTO_SAVE_INTERVAL) {
                console.log('💾 Session saved:', new Date(sessionState.timestamp).toLocaleTimeString());
            }
        } catch (error) {
            console.error('Error saving session:', error);
        }
    }

    // Critical save - called on important state changes (debounced)
    criticalSave() {
        if (this.criticalSaveTimeout) {
            clearTimeout(this.criticalSaveTimeout);
        }
        
        this.criticalSaveTimeout = setTimeout(() => {
            if (this.getStateCallback) {
                const currentState = this.getStateCallback();
                if (currentState) {
                    this.saveSession(currentState);
                }
            }
        }, CRITICAL_SAVE_DEBOUNCE);
    }

    // Start auto-save interval
    startAutoSave(getStateCallback) {
        this.getStateCallback = getStateCallback;
        this.stopAutoSave(); // Clear any existing interval

        // Mark session as active
        localStorage.setItem('ironflow_session_active', 'true');
        
        // Initial save
        const initialState = getStateCallback();
        if (initialState) {
            this.saveSession(initialState);
        }

        // Start auto-save interval
        this.autoSaveInterval = setInterval(() => {
            const currentState = getStateCallback();
            if (currentState) {
                this.saveSession(currentState);
            }
        }, AUTO_SAVE_INTERVAL);
        
        // Start heartbeat interval (for crash detection)
        this.heartbeatInterval = setInterval(() => {
            this.updateHeartbeat();
        }, HEARTBEAT_INTERVAL);
        
        // Initial heartbeat
        this.updateHeartbeat();

        console.log(`⏰ Auto-save started (every ${AUTO_SAVE_INTERVAL / 1000}s) with heartbeat`);
    }
    
    // Update heartbeat timestamp
    updateHeartbeat() {
        try {
            this.lastHeartbeat = Date.now();
            localStorage.setItem('ironflow_session_heartbeat', this.lastHeartbeat.toString());
            
            // Also save to native storage if available
            if (this.isNativeApp && window.Capacitor?.Plugins?.Preferences) {
                window.Capacitor.Plugins.Preferences.set({
                    key: 'session_heartbeat',
                    value: this.lastHeartbeat.toString()
                }).catch(() => {});
            }
        } catch (e) {
            // Ignore heartbeat errors
        }
    }

    // Stop auto-save interval
    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
        }
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
        
        if (this.criticalSaveTimeout) {
            clearTimeout(this.criticalSaveTimeout);
            this.criticalSaveTimeout = null;
        }
        
        // Mark session as inactive (clean shutdown)
        localStorage.setItem('ironflow_session_active', 'false');
        localStorage.removeItem('ironflow_session_heartbeat');
    }

    // Clear saved session from all storages
    async clearSession() {
        // localStorage
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(BACKUP_KEY);
        localStorage.removeItem('ironflow_session_active');
        localStorage.removeItem('ironflow_session_heartbeat');
        
        // IndexedDB
        if (this.db) {
            try {
                const transaction = this.db.transaction(['sessions'], 'readwrite');
                const store = transaction.objectStore('sessions');
                store.delete('current');
            } catch (error) {
                console.warn('IndexedDB clear failed:', error);
            }
        }
        
        // Native Capacitor Preferences
        if (this.isNativeApp && window.Capacitor?.Plugins?.Preferences) {
            try {
                await window.Capacitor.Plugins.Preferences.remove({ key: NATIVE_BACKUP_KEY });
                await window.Capacitor.Plugins.Preferences.remove({ key: 'session_heartbeat' });
            } catch (error) {
                console.warn('Native storage clear failed:', error);
            }
        }
        
        this.sessionState = null;
        this.getStateCallback = null;
        this.crashDetected = false;
        this.stopAutoSave();
        
        console.log('🗑️ Session cleared from all storages');
    }

    // Create recovery state summary for UI
    getRecoverySummary(sessionState) {
        if (!sessionState || !sessionState.workout) return null;

        const workout = sessionState.workout;
        const currentExercise = workout.exercises?.[sessionState.currentExerciseIndex];
        const totalExercises = workout.exercises?.length || 0;
        
        // Calculate completed sets count
        const completedSetsCount = sessionState.completedSets?.length || 0;
        const totalSetsInWorkout = workout.exercises?.reduce((sum, ex) => sum + (ex.sets?.length || 0), 0) || 0;

        return {
            workoutName: workout.name || 'Allenamento',
            currentExerciseName: currentExercise?.name || 'Esercizio',
            currentExerciseIndex: sessionState.currentExerciseIndex,
            totalExercises: totalExercises,
            currentSet: sessionState.currentSetIndex + 1,
            totalSets: currentExercise?.sets?.length || 0,
            completedSetsCount: completedSetsCount,
            totalSetsInWorkout: totalSetsInWorkout,
            progressPercent: totalSetsInWorkout > 0 ? Math.round((completedSetsCount / totalSetsInWorkout) * 100) : 0,
            elapsedTime: sessionState.sessionStartTime
                ? Math.floor((Date.now() - sessionState.sessionStartTime) / 60000)
                : 0,
            timestamp: new Date(sessionState.timestamp).toLocaleString('it-IT'),
            wasEmergencySave: !!sessionState.emergencySaveReason,
            emergencyReason: sessionState.emergencySaveReason || null
        };
    }

    // Show recovery modal with improved UI
    showRecoveryModal(sessionState, onContinue, onStartFresh) {
        const summary = this.getRecoverySummary(sessionState);
        if (!summary) {
            onStartFresh();
            return;
        }

        // Emergency save indicator
        const emergencyBadge = summary.wasEmergencySave 
            ? `<div style="background: rgba(255, 100, 100, 0.2); border: 1px solid #ff6464; padding: 0.5rem; border-radius: var(--radius-sm); margin-bottom: 1rem; font-size: 0.8rem;">
                ⚠️ Sessione salvata automaticamente (${summary.emergencyReason || 'interruzione'})
               </div>`
            : '';

        // Progress bar
        const progressBar = `
            <div style="margin-bottom: 1rem;">
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 0.25rem;">
                    <span>Progresso</span>
                    <span>${summary.progressPercent}%</span>
                </div>
                <div style="background: rgba(255,255,255,0.1); border-radius: 4px; height: 8px; overflow: hidden;">
                    <div style="background: var(--color-primary); height: 100%; width: ${summary.progressPercent}%; transition: width 0.3s;"></div>
                </div>
            </div>
        `;

        // Create modal HTML
        const modalHTML = `
            <div id="sessionRecoveryModal" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.95);
                z-index: 3000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1rem;
                animation: fadeIn 0.3s ease;
            ">
                <style>
                    @keyframes fadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    @keyframes slideUp {
                        from { transform: translateY(20px); opacity: 0; }
                        to { transform: translateY(0); opacity: 1; }
                    }
                </style>
                <div class="card" style="max-width: 400px; width: 100%; animation: slideUp 0.3s ease;">
                    <h3 style="margin-bottom: 1rem; color: var(--color-primary); display: flex; align-items: center; gap: 0.5rem;">
                        🔄 Sessione Interrotta
                    </h3>
                    
                    ${emergencyBadge}
                    
                    <p style="margin-bottom: 1rem; color: var(--color-text-muted);">
                        Hai una sessione di allenamento in corso. Vuoi riprenderla?
                    </p>
                    
                    ${progressBar}
                    
                    <div style="
                        background: rgba(255,255,255,0.05);
                        padding: 1rem;
                        border-radius: var(--radius-sm);
                        border: 1px solid var(--color-border);
                        margin-bottom: 1.5rem;
                    ">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
                            <div>
                                <div style="font-size: 0.7rem; color: var(--color-text-muted); text-transform: uppercase;">Workout</div>
                                <div style="color: var(--color-text); font-weight: 500;">${summary.workoutName}</div>
                            </div>
                            <div>
                                <div style="font-size: 0.7rem; color: var(--color-text-muted); text-transform: uppercase;">Tempo</div>
                                <div style="color: var(--color-text); font-weight: 500;">${summary.elapsedTime} min</div>
                            </div>
                            <div>
                                <div style="font-size: 0.7rem; color: var(--color-text-muted); text-transform: uppercase;">Esercizio</div>
                                <div style="color: var(--color-text); font-weight: 500;">
                                    ${summary.currentExerciseName}
                                </div>
                            </div>
                            <div>
                                <div style="font-size: 0.7rem; color: var(--color-text-muted); text-transform: uppercase;">Set</div>
                                <div style="color: var(--color-text); font-weight: 500;">
                                    ${summary.currentSet}/${summary.totalSets}
                                </div>
                            </div>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--color-border);">
                            💾 Salvato: ${summary.timestamp}
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 0.75rem;">
                        <button id="sessionRecoveryStartFresh" class="btn btn-outline" style="flex: 1;">
                            🔄 Ricomincia
                        </button>
                        <button id="sessionRecoveryContinue" class="btn btn-primary" style="flex: 1;">
                            ▶️ Continua
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Insert modal into page
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Add event listeners
        const modal = document.getElementById('sessionRecoveryModal');
        const continueBtn = document.getElementById('sessionRecoveryContinue');
        const freshBtn = document.getElementById('sessionRecoveryStartFresh');

        continueBtn.addEventListener('click', () => {
            modal.remove();
            onContinue(sessionState);
        });

        freshBtn.addEventListener('click', () => {
            modal.remove();
            this.clearSession();
            onStartFresh();
        });
    }

    // Get status for debugging
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            hasCallback: !!this.getStateCallback,
            hasAutoSave: !!this.autoSaveInterval,
            hasIndexedDB: !!this.db,
            currentSession: this.sessionState ? {
                timestamp: new Date(this.sessionState.timestamp).toLocaleString(),
                workout: this.sessionState.workout?.name,
                exercise: this.sessionState.currentExerciseIndex,
                set: this.sessionState.currentSetIndex
            } : null
        };
    }
}

// Export singleton instance
export const sessionRecoveryManager = new SessionRecoveryManager();
