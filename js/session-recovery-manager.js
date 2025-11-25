// Session Recovery Manager for Focus Mode
// Automatically saves and restores interrupted workout sessions

const STORAGE_KEY = 'ironflow_focus_session_state';
const STALE_THRESHOLD = 2 * 60 * 60 * 1000; // 2 hours
const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

export class SessionRecoveryManager {
    constructor() {
        this.autoSaveInterval = null;
        this.sessionState = null;
    }

    // Initialize and check for existing session
    init() {
        const savedState = this.getSavedSession();

        if (savedState && !this.isStale(savedState)) {
            return savedState; // Return for recovery prompt
        } else if (savedState) {
            // Clear stale session
            this.clearSession();
        }

        return null;
    }

    // Get saved session from localStorage
    getSavedSession() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) return null;

            return JSON.parse(saved);
        } catch (error) {
            console.error('Error reading saved session:', error);
            return null;
        }
    }

    // Check if session is stale (>2 hours old)
    isStale(sessionState) {
        if (!sessionState || !sessionState.timestamp) return true;

        const age = Date.now() - sessionState.timestamp;
        return age > STALE_THRESHOLD;
    }

    // Save current session state
    saveSession(state) {
        try {
            const sessionState = {
                timestamp: Date.now(),
                workout: state.workout,
                currentExerciseIndex: state.currentExerciseIndex,
                currentSetIndex: state.currentSetIndex,
                completedSets: state.completedSets || [],
                isResting: state.isResting || false,
                remainingRestTime: state.remainingRestTime || 0,
                sessionStartTime: state.sessionStartTime,
                workoutId: state.workoutId,
                wellnessData: state.wellnessData || null
            };

            localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionState));
            this.sessionState = sessionState;

            console.log('Session saved:', new Date(sessionState.timestamp).toLocaleTimeString());
        } catch (error) {
            console.error('Error saving session:', error);
        }
    }

    // Start auto-save interval
    startAutoSave(getStateCallback) {
        this.stopAutoSave(); // Clear any existing interval

        this.autoSaveInterval = setInterval(() => {
            const currentState = getStateCallback();
            if (currentState) {
                this.saveSession(currentState);
            }
        }, AUTO_SAVE_INTERVAL);

        console.log(`Auto-save started (every ${AUTO_SAVE_INTERVAL / 1000}s)`);
    }

    // Stop auto-save interval
    stopAutoSave() {
        if (this.autoSaveInterval) {
            clearInterval(this.autoSaveInterval);
            this.autoSaveInterval = null;
            console.log('Auto-save stopped');
        }
    }

    // Clear saved session
    clearSession() {
        localStorage.removeItem(STORAGE_KEY);
        this.sessionState = null;
        this.stopAutoSave();
        console.log('Session cleared');
    }

    // Create recovery state summary for UI
    getRecoverySummary(sessionState) {
        if (!sessionState || !sessionState.workout) return null;

        const workout = sessionState.workout;
        const currentExercise = workout.exercises?.[sessionState.currentExerciseIndex];
        const totalExercises = workout.exercises?.length || 0;

        return {
            workoutName: workout.name || 'Allenamento',
            currentExerciseName: currentExercise?.name || 'Esercizio',
            currentExerciseIndex: sessionState.currentExerciseIndex,
            totalExercises: totalExercises,
            currentSet: sessionState.currentSetIndex + 1,
            totalSets: currentExercise?.sets?.length || 0,
            elapsedTime: sessionState.sessionStartTime
                ? Math.floor((Date.now() - sessionState.sessionStartTime) / 60000)
                : 0,
            timestamp: new Date(sessionState.timestamp).toLocaleString('it-IT')
        };
    }

    // Show recovery modal
    showRecoveryModal(sessionState, onContinue, onStartFresh) {
        const summary = this.getRecoverySummary(sessionState);
        if (!summary) {
            onStartFresh();
            return;
        }

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
            ">
                <div class="card" style="max-width: 400px; width: 100%;">
                    <h3 style="margin-bottom: 1rem; color: var(--color-primary);">
                        🔄 Sessione Interrotta Rilevata
                    </h3>
                    
                    <p style="margin-bottom: 1.5rem; color: var(--color-text-muted);">
                        Hai una sessione di allenamento in corso. Vuoi riprenderla da dove eri rimasto?
                    </p>
                    
                    <div style="
                        background: rgba(255,255,255,0.05);
                        padding: 1rem;
                        border-radius: var(--radius-sm);
                        border: 1px solid var(--color-border);
                        margin-bottom: 1.5rem;
                    ">
                        <div style="margin-bottom: 0.5rem;">
                            <strong style="color: var(--color-primary);">Workout:</strong>
                            <span style="color: var(--color-text);">${summary.workoutName}</span>
                        </div>
                        <div style="margin-bottom: 0.5rem;">
                            <strong style="color: var(--color-primary);">Esercizio:</strong>
                            <span style="color: var(--color-text);">
                                ${summary.currentExerciseName}
                                (${summary.currentExerciseIndex + 1}/${summary.totalExercises})
                            </span>
                        </div>
                        <div style="margin-bottom: 0.5rem;">
                            <strong style="color: var(--color-primary);">Progressione:</strong>
                            <span style="color: var(--color-text);">
                                Set ${summary.currentSet}/${summary.totalSets}
                            </span>
                        </div>
                        <div style="font-size: 0.8rem; color: var(--color-text-muted); margin-top: 0.75rem;">
                            💾 Salvato: ${summary.timestamp}
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 0.75rem;">
                        <button id="sessionRecoveryStartFresh" class="btn btn-outline" style="flex: 1;">
                            Ricomincia
                        </button>
                        <button id="sessionRecoveryContinue" class="btn btn-primary" style="flex: 1;">
                            Continua
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
}

// Export singleton instance
export const sessionRecoveryManager = new SessionRecoveryManager();
