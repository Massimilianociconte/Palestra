// Focus Mode Enhancements Loader
// Dynamically loads and integrates all enhancement modules without modifying user.html
// Just add: <script type="module" src="./js/enhancements-loader.js"></script> to user.html

import { mediaSessionManager } from './media-session-manager.js';
import { sessionRecoveryManager } from './session-recovery-manager.js';
import { aiTargetingHandler, AITargetingHandler } from './ai-targeting-handler.js';
import { WorkoutSharingHandler } from './workout-sharing-handler.js';
import { firestoreService } from './firestore-service.js';
import { authService } from './auth-service.js';

console.log('🚀 Loading Focus Mode Enhancements...');

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

async function init() {
    // Add styles
    AITargetingHandler.addStyles();
    WorkoutSharingHandler.addStyles();

    // Initialize media session
    mediaSessionManager.init();

    // Initialize session recovery manager FIRST
    await setupSessionRecovery();

    // Initialize workout sharing
    const workoutSharingHandler = new WorkoutSharingHandler(firestoreService);

    // Inject AI targeting chips into AI Predictor section
    injectAITargetingUI();

    // Check for shared workout
    await checkSharedWorkout(workoutSharingHandler);

    // Initialize AI targeting handler
    setTimeout(() => {
        aiTargetingHandler.init('.ai-target-chip');
    }, 1000);

    // Intercept Share Buttons (Hijack old logic)
    setupShareInterception(workoutSharingHandler);

    // Intercept AI Generation Button
    setupAIGenerationInterception();

    // Setup Media Session Integration (Timer & Audio)
    setupMediaSessionIntegration();

    // Setup Focus Mode Session Tracking
    setupFocusModeTracking();

    console.log('✅ All enhancements loaded');
}

// Setup Session Recovery - Check for interrupted sessions and offer recovery
async function setupSessionRecovery() {
    try {
        const savedSession = await sessionRecoveryManager.init();
        
        if (savedSession) {
            console.log('🔄 Found interrupted session, showing recovery modal...');
            
            // Show recovery modal
            sessionRecoveryManager.showRecoveryModal(
                savedSession,
                // On Continue - restore the session
                (sessionState) => {
                    console.log('▶️ Continuing interrupted session...');
                    restoreSession(sessionState);
                },
                // On Start Fresh - clear and let user start new
                () => {
                    console.log('🔄 Starting fresh...');
                }
            );
        }
    } catch (error) {
        console.error('Session recovery init error:', error);
    }
}

// Restore a saved session
function restoreSession(sessionState) {
    try {
        // Store the session state for the focus mode to pick up
        window.pendingSessionRestore = sessionState;
        
        // Find and click the start button for the workout
        const workoutId = sessionState.workoutId;
        const workoutName = sessionState.workout?.name;
        
        // Try to find the workout in the list and start it
        const workoutItems = document.querySelectorAll('.workout-list-item');
        let found = false;
        
        workoutItems.forEach((item, index) => {
            const nameEl = item.querySelector('strong');
            if (nameEl && nameEl.textContent.includes(workoutName)) {
                // Found the workout, click its start button
                const startBtn = item.querySelector('.start-workout');
                if (startBtn) {
                    // Set a flag so focus mode knows to restore
                    startBtn.dataset.restoreSession = 'true';
                    startBtn.click();
                    found = true;
                }
            }
        });
        
        if (!found) {
            // Workout not found in list, show error
            alert(`Impossibile trovare la scheda "${workoutName}". Potrebbe essere stata eliminata.`);
            sessionRecoveryManager.clearSession();
        }
    } catch (error) {
        console.error('Error restoring session:', error);
        alert('Errore nel ripristino della sessione. Riprova.');
    }
}

// Setup Focus Mode Tracking - Monitor focus mode state and save sessions
function setupFocusModeTracking() {
    // Track when focus mode opens
    const focusModal = document.getElementById('focusModeModal');
    if (!focusModal) {
        console.warn('Focus mode modal not found for tracking');
        return;
    }

    // Observer for focus mode visibility
    const modalObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                const isVisible = focusModal.style.display !== 'none';
                
                if (isVisible) {
                    // Focus mode opened - start tracking
                    startSessionTracking();
                } else {
                    // Focus mode closed - check if session should be saved or cleared
                    handleFocusModeClose();
                }
            }
        });
    });
    
    modalObserver.observe(focusModal, { attributes: true, attributeFilter: ['style'] });
    console.log('📊 Focus mode tracking initialized');
}

// Start tracking the current session
function startSessionTracking() {
    console.log('🎯 Focus mode opened - starting session tracking');
    
    // Give the focus mode a moment to initialize
    setTimeout(() => {
        // Create a state getter function that reads from the DOM
        const getStateCallback = () => {
            try {
                // Get current workout from window (set by focus mode)
                const currentWorkout = window.currentFocusWorkout;
                if (!currentWorkout) return null;
                
                // Get current exercise and set indices
                const exerciseNameEl = document.getElementById('focusExerciseName');
                const setCounterEl = document.getElementById('focusSetCounter');
                const timerAreaEl = document.getElementById('focusTimerArea');
                const timerEl = document.getElementById('focusTimer');
                
                // Parse set counter (e.g., "Set 2/4")
                let currentSetIndex = 0;
                if (setCounterEl) {
                    const match = setCounterEl.textContent.match(/Set (\d+)\/(\d+)/);
                    if (match) {
                        currentSetIndex = parseInt(match[1]) - 1;
                    }
                }
                
                // Find current exercise index
                let currentExerciseIndex = 0;
                if (exerciseNameEl && currentWorkout.exercises) {
                    const currentName = exerciseNameEl.textContent.trim();
                    currentExerciseIndex = currentWorkout.exercises.findIndex(
                        ex => ex.name.trim() === currentName
                    );
                    if (currentExerciseIndex === -1) currentExerciseIndex = 0;
                }
                
                // Check if resting
                const isResting = timerAreaEl && timerAreaEl.style.display !== 'none';
                
                // Get remaining rest time
                let remainingRestTime = 0;
                if (isResting && timerEl) {
                    const timerText = timerEl.textContent;
                    if (timerText && timerText.includes(':')) {
                        const [min, sec] = timerText.split(':').map(Number);
                        remainingRestTime = (min * 60) + sec;
                    }
                }
                
                // Get completed sets from history
                const historyItems = document.querySelectorAll('#focusHistoryList .history-item');
                const completedSets = Array.from(historyItems).map(item => {
                    const text = item.textContent;
                    // Parse "Set 1: 50kg × 10 @ RPE 8"
                    const match = text.match(/Set (\d+):\s*(\d+(?:\.\d+)?)\s*kg\s*×\s*(\d+)/);
                    if (match) {
                        return {
                            set: parseInt(match[1]),
                            weight: parseFloat(match[2]),
                            reps: parseInt(match[3])
                        };
                    }
                    return null;
                }).filter(Boolean);
                
                return {
                    workout: currentWorkout,
                    workoutId: currentWorkout.id,
                    currentExerciseIndex,
                    currentSetIndex,
                    completedSets,
                    isResting,
                    remainingRestTime,
                    sessionStartTime: window.focusModeStartTime || Date.now(),
                    wellnessData: window.focusModeWellnessData || null
                };
            } catch (error) {
                console.error('Error getting session state:', error);
                return null;
            }
        };
        
        // Start auto-save with the state getter
        sessionRecoveryManager.startAutoSave(getStateCallback);
        
        // Also trigger critical saves on important events
        setupCriticalSaveTriggers();
        
    }, 1000); // Wait 1 second for focus mode to initialize
}

// Setup triggers for critical saves (on important state changes)
function setupCriticalSaveTriggers() {
    // Save on action button click (completing a set)
    const actionBtn = document.getElementById('focusActionBtn');
    if (actionBtn) {
        actionBtn.addEventListener('click', () => {
            sessionRecoveryManager.criticalSave();
        });
    }
    
    // Save on weight/reps input change
    const weightInput = document.getElementById('focusWeightInput');
    const repsInput = document.getElementById('focusRepsInput');
    
    if (weightInput) {
        weightInput.addEventListener('change', () => {
            sessionRecoveryManager.criticalSave();
        });
    }
    
    if (repsInput) {
        repsInput.addEventListener('change', () => {
            sessionRecoveryManager.criticalSave();
        });
    }
    
    console.log('💾 Critical save triggers installed');
}

// Handle focus mode close
function handleFocusModeClose() {
    // Check if session was completed normally
    const sessionCompleted = window.focusModeSessionCompleted;
    
    if (sessionCompleted) {
        // Session completed normally - clear saved session
        console.log('✅ Session completed normally - clearing saved state');
        sessionRecoveryManager.clearSession();
    } else {
        // Session interrupted - keep the saved state for recovery
        console.log('⚠️ Session interrupted - keeping saved state for recovery');
        // Do one final save
        sessionRecoveryManager.emergencySave('focus-mode-closed');
    }
}

// Setup Media Session Integration (Timer Observer & Audio Trigger)
function setupMediaSessionIntegration() {
    let lastTimerValue = null;
    let timerStarted = false;
    
    // 1. Audio Trigger on Start (Delegated) - CRITICAL for lockscreen
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.start-workout');
        if (btn) {
            // Get workout name if possible
            const workoutName = btn.closest('.workout-list-item')?.querySelector('strong')?.textContent.replace('AI', '').trim() || 'Allenamento';

            // Start Media Session (Audio Loop) - This activates lockscreen controls
            mediaSessionManager.startWorkout(workoutName);
            console.log('🎵 Media Session started via user interaction - lockscreen should be active');
        }
    });

    // 2. Timer Area Observer - Detect when rest period starts/ends
    const timerArea = document.getElementById('focusTimerArea');
    if (timerArea) {
        const timerAreaObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const isVisible = timerArea.style.display !== 'none';
                    
                    if (isVisible && !timerStarted) {
                        // Timer area just became visible - REST STARTED
                        console.log('🔔 Rest period detected - activating lockscreen timer');
                        timerStarted = true;
                        
                        // Get initial timer value
                        const timerElement = document.getElementById('focusTimer');
                        if (timerElement) {
                            const text = timerElement.textContent;
                            if (text && text.includes(':')) {
                                const [min, sec] = text.split(':').map(Number);
                                const totalSeconds = (min * 60) + sec;
                                if (!isNaN(totalSeconds) && totalSeconds > 0) {
                                    // Use startTimerDisplay for native lockscreen notification
                                    mediaSessionManager.startTimerDisplay(totalSeconds, 
                                        (remaining) => {
                                            // onTick callback - UI updates handled by DOM observer
                                        },
                                        () => {
                                            // onComplete callback
                                            console.log('⏱️ Native timer completed');
                                        }
                                    );
                                    console.log(`⏱️ Lockscreen timer started: ${totalSeconds}s`);
                                }
                            }
                        }
                    } else if (!isVisible && timerStarted) {
                        // Timer area hidden - REST ENDED
                        console.log('✅ Rest period ended');
                        timerStarted = false;
                        lastTimerValue = null;
                        
                        // Stop the native timer notification
                        mediaSessionManager.stopTimerDisplay();
                        
                        // Update lockscreen to show exercise info
                        const exerciseElement = document.getElementById('focusExerciseName');
                        if (exerciseElement) {
                            const name = exerciseElement.textContent;
                            const setCounter = document.getElementById('focusSetCounter');
                            const setInfo = setCounter ? setCounter.textContent : '';
                            const match = setInfo.match(/Set (\d+)\/(\d+)/);
                            const current = match ? parseInt(match[1]) : 1;
                            const total = match ? parseInt(match[2]) : 3;
                            mediaSessionManager.updateExercise(name, current, total);
                        }
                    }
                }
            });
        });
        timerAreaObserver.observe(timerArea, { attributes: true, attributeFilter: ['style'] });
        console.log('👁️ Timer area visibility observer attached');
    }

    // 3. Timer Value Observer (Sync DOM timer to Lockscreen in real-time)
    const timerElement = document.getElementById('focusTimer');
    if (timerElement) {
        const observer = new MutationObserver((mutations) => {
            const text = timerElement.textContent; // "01:30"
            if (text && text.includes(':')) {
                const [min, sec] = text.split(':').map(Number);
                const totalSeconds = (min * 60) + sec;

                // Only update if valid number and different from last value
                if (!isNaN(totalSeconds) && totalSeconds !== lastTimerValue) {
                    lastTimerValue = totalSeconds;
                    mediaSessionManager.updateTimer(totalSeconds);
                    
                    // Log every 10 seconds for debugging
                    if (totalSeconds % 10 === 0) {
                        console.log(`⏱️ Lockscreen timer: ${min}:${sec.toString().padStart(2, '0')}`);
                    }
                }
            }
        });
        observer.observe(timerElement, { childList: true, characterData: true, subtree: true });
        console.log('⏱️ Timer value observer attached');
    } else {
        console.warn('⚠️ focusTimer element not found for observer');
    }

    // 4. Exercise Name Observer (Sync Title)
    const exerciseElement = document.getElementById('focusExerciseName');
    if (exerciseElement) {
        const observer = new MutationObserver(() => {
            const name = exerciseElement.textContent;
            // Try to get set info if available
            const setCounter = document.getElementById('focusSetCounter');
            const setInfo = setCounter ? setCounter.textContent : '';
            // Parse "Set 1/3" if possible, otherwise pass raw
            const match = setInfo.match(/Set (\d+)\/(\d+)/);
            const current = match ? parseInt(match[1]) : 1;
            const total = match ? parseInt(match[2]) : 3;

            mediaSessionManager.updateExercise(name, current, total);
        });
        observer.observe(exerciseElement, { childList: true, characterData: true, subtree: true });
        console.log('💪 Exercise name observer attached');
    }

    // 5. Focus Mode Modal Observer - Detect when focus mode opens/closes
    const focusModal = document.getElementById('focusModeModal');
    if (focusModal) {
        const modalObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                    const isVisible = focusModal.style.display !== 'none';
                    
                    if (!isVisible) {
                        // Focus mode closed - end workout session
                        console.log('🏁 Focus mode closed - ending media session');
                        mediaSessionManager.endWorkout();
                    }
                }
            });
        });
        modalObserver.observe(focusModal, { attributes: true, attributeFilter: ['style'] });
        console.log('🎯 Focus mode modal observer attached');
    }

    // 6. Setup media session callbacks for lockscreen controls
    mediaSessionManager.onPlayPauseCallback((isPlaying) => {
        console.log('🎮 Lockscreen play/pause:', isPlaying);
        // Could be used to pause/resume timer in future
    });

    mediaSessionManager.onNextCallback(() => {
        console.log('🎮 Lockscreen next pressed');
        // Skip rest if available
        if (typeof window.skipRest === 'function') {
            window.skipRest();
        }
    });

    mediaSessionManager.onPreviousCallback(() => {
        console.log('🎮 Lockscreen previous pressed');
        // Could go to previous exercise in future
    });

    console.log('✅ Media Session Integration fully configured for lockscreen support');
}

// Inject AI targeting chips HTML and Custom Text Input
function injectAITargetingUI() {
    const aiPredictor = document.querySelector('#aiPredictorContent');
    if (!aiPredictor || aiPredictor.dataset.enhanced) return;

    const parent = aiPredictor.parentElement;
    if (!parent) return;

    // Find the button container
    const buttonContainer = parent.querySelector('div[style*="display: flex"]');
    if (!buttonContainer) return;

    // Create targeting UI with Textarea
    const targetingHTML = `
        <div class="ai-target-selection" style="margin-bottom: 1rem;">
            
            <!-- Custom Request Textarea -->
            <div style="margin-bottom: 1rem;">
                <h5 style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em;">
                    Richieste Personalizzate (Opzionale)
                </h5>
                <textarea id="aiCustomInput" placeholder="Es: 'Ho poco tempo', 'Voglio focus braccia', 'Niente squat oggi'..." 
                    style="width: 100%; background: rgba(255,255,255,0.05); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 0.8rem; color: var(--color-text); font-family: inherit; font-size: 0.9rem; resize: vertical; min-height: 60px;"></textarea>
            </div>

            <h5 style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em;">
                Focus Gruppo Muscolare (Opzionale)
            </h5>
            <div class="ai-chip-wrapper" style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.5rem;">
                <div class="ai-target-chip" data-target="push" style="padding: 0.4rem 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.85rem; transition: all 0.2s;">
                    💪 Push
                </div>
                <div class="ai-target-chip" data-target="pull" style="padding: 0.4rem 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.85rem; transition: all 0.2s;">
                    🔙 Pull
                </div>
                <div class="ai-target-chip" data-target="legs" style="padding: 0.4rem 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.85rem; transition: all 0.2s;">
                    🦵 Legs
                </div>
                <div class="ai-target-chip" data-target="upper" style="padding: 0.4rem 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.85rem; transition: all 0.2s;">
                    ⬆️ Upper
                </div>
                <div class="ai-target-chip" data-target="lower" style="padding: 0.4rem 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.85rem; transition: all 0.2s;">
                    ⬇️ Lower
                </div>
                <div class="ai-target-chip" data-target="full" style="padding: 0.4rem 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.85rem; transition: all 0.2s;">
                    🎯 Full Body
                </div>
                <div class="ai-target-chip" data-target="core" style="padding: 0.4rem 0.8rem; background: rgba(255,255,255,0.05); border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer; font-size: 0.85rem; transition: all 0.2s;">
                    🔥 Core
                </div>
            </div>
            <p style="font-size: 0.7rem; color: var(--color-text-muted); margin: 0;">
                Seleziona un focus specifico o lascia vuoto per un allenamento completo.
            </p>
        </div>
    `;

    // Insert before buttons
    buttonContainer.insertAdjacentHTML('beforebegin', targetingHTML);
    aiPredictor.dataset.enhanced = 'true';

    console.log('✅ AI targeting UI injected');
}

// Intercept AI Generation Button to include custom data
function setupAIGenerationInterception() {
    const refreshBtn = document.getElementById('refreshAiPredictor');
    if (!refreshBtn) return;

    // Create a NEW button to replace the old one completely
    // This avoids any event listener conflicts or race conditions
    const newBtn = document.createElement('button');
    newBtn.id = 'customAiGenerateBtn';
    newBtn.className = refreshBtn.className;
    newBtn.innerHTML = refreshBtn.innerHTML;
    newBtn.style.cssText = refreshBtn.style.cssText;

    // Insert new button and hide old one
    refreshBtn.parentNode.insertBefore(newBtn, refreshBtn);
    refreshBtn.style.display = 'none'; // Hide original
    refreshBtn.id = 'refreshAiPredictor_hidden'; // Remove ID to prevent conflicts

    // Add new listener
    newBtn.addEventListener('click', async () => {
        const aiContent = document.getElementById('aiPredictorContent');
        const customInput = document.getElementById('aiCustomInput');

        // Show loading state
        aiContent.innerHTML = `
            <div style="padding: 2rem; text-align: center;">
                <div class="spinner" style="margin: 0 auto 1rem;"></div>
                <p style="color: var(--color-text-muted);">L'AI sta analizzando il tuo profilo e le tue richieste...</p>
            </div>
        `;

        try {
            // Gather data
            const customText = customInput ? customInput.value : '';
            const userRequest = aiTargetingHandler.buildUserRequest(customText);

            console.log('🧠 AI Request:', userRequest);

            // Use authService instead of global firebase
            const user = authService.getCurrentUser();
            if (!user) throw new Error("Utente non autenticato");

            // Use gatherDataForAI to get complete data including recent logs, PRs, health data
            const baseData = await firestoreService.gatherDataForAI();
            
            // Add user request to the gathered data
            const payload = {
                ...baseData,
                userRequest: userRequest
            };
            
            // Track if this is a personalized request
            const isPersonalized = !!(userRequest.style || userRequest.customText);

            // Import AI Service dynamically
            const { aiService } = await import('./ai-service.js');
            const result = await aiService.predictNextSession(payload);

            if (result.success) {
                // Render result
                const suggestion = result.data;
                
                // Save to AI plan history (for storico)
                const plan = {
                    ...suggestion,
                    isPersonalized: isPersonalized,
                    createdAt: new Date().toISOString()
                };
                try {
                    const history = JSON.parse(localStorage.getItem('ironflow_ai_plan_history') || '[]');
                    history.unshift(plan);
                    const trimmed = history.slice(0, 20);
                    localStorage.setItem('ironflow_ai_plan_history', JSON.stringify(trimmed));
                    console.log('📚 AI plan saved to history');
                } catch (e) {
                    console.warn('Could not save AI plan to history:', e);
                }

                aiContent.innerHTML = `
                    <div style="background: rgba(0, 243, 255, 0.05); border: 1px solid var(--color-primary); border-radius: var(--radius-md); padding: 1.5rem; margin-bottom: 1.5rem;">
                        <h3 style="color: var(--color-primary); margin-bottom: 0.5rem;">${suggestion.suggestion}</h3>
                        <p style="color: var(--color-text-muted); font-size: 0.9rem; margin-bottom: 1rem;">${suggestion.focus}</p>
                        
                        <div style="margin-bottom: 1rem;">
                            <strong style="display:block; margin-bottom:0.5rem; font-size:0.8rem;">ESERCIZI SUGGERITI:</strong>
                            <ul style="list-style: none; padding: 0;">
                                ${suggestion.exercises ? suggestion.exercises.map(ex => `
                                    <li style="padding: 0.5rem 0; border-bottom: 1px solid var(--color-border); display:flex; justify-content:space-between;">
                                        <span>${ex.name}</span>
                                        <span style="color:var(--color-text-muted); font-size:0.85rem;">${ex.sets} x ${ex.reps}</span>
                                    </li>
                                `).join('') : '<li style="color:var(--color-text-muted)">Nessun esercizio specifico elencato.</li>'}
                            </ul>
                        </div>
                        
                        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: var(--radius-sm); font-size: 0.85rem; margin-top: 1rem;">
                            <strong>💡 Coach Note:</strong><br>
                            ${suggestion.reasoning || 'Nessuna nota disponibile.'}
                        </div>
                        
                        <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                            <button id="saveAiWorkout" class="btn btn-outline" style="flex: 1; border-color: var(--color-primary); color: var(--color-primary);">
                                💾 Salva
                            </button>
                            <button id="startAiWorkout" class="btn btn-primary" style="flex: 1;">
                                🚀 Avvia
                            </button>
                        </div>
                    </div>
                `;

                const createWorkoutObj = () => {
                    // Parse reps from AI format (could be "8-10", "12", etc.)
                    const parseReps = (repsStr) => {
                        if (!repsStr) return '10';
                        const str = String(repsStr);
                        // If it's a range like "8-10", take the first number
                        if (str.includes('-')) {
                            return str.split('-')[0].trim();
                        }
                        // If it's a number, return as string
                        return str.trim();
                    };
                    
                    // Parse sets count from AI format
                    const parseSetsCount = (setsStr) => {
                        const num = parseInt(setsStr);
                        return isNaN(num) || num < 1 ? 3 : num;
                    };
                    
                    // === CALCOLO PESO SUGGERITO ===
                    // Percentuali NSCA per convertire 1RM in peso per X reps
                    const rmPercentages = {
                        1: 1.00, 2: 0.97, 3: 0.93, 4: 0.90, 5: 0.87,
                        6: 0.85, 7: 0.83, 8: 0.80, 9: 0.77, 10: 0.75,
                        11: 0.73, 12: 0.70, 13: 0.68, 14: 0.66, 15: 0.64
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
                    
                    // Accedi alle stime 1RM dal payload
                    const exerciseEstimates = payload?.exerciseEstimates || {};
                    console.log('📊 AI Workout - exerciseEstimates disponibili:', Object.keys(exerciseEstimates).length, exerciseEstimates);
                    
                    // Calcola peso suggerito basato su 1RM e reps target
                    const calculateSuggestedWeight = (exerciseName, targetReps) => {
                        const name = normalizeExerciseName(exerciseName);
                        
                        // Parsa le reps target
                        let reps = parseInt(targetReps);
                        if (isNaN(reps) || reps < 1) reps = 10;
                        if (reps > 15) reps = 15;
                        
                        const percentage = rmPercentages[reps] || 0.70;
                        
                        // STEP 1: Cerca match ESATTO (nome normalizzato identico)
                        const exactMatch = exerciseEstimates[name];
                        if (exactMatch && exactMatch.est1RM) {
                            const suggestedWeight = Math.round(exactMatch.est1RM * percentage * 2) / 2;
                            return {
                                weight: suggestedWeight,
                                basedOn: exactMatch.basedOn, // es. "60kg x 8"
                                est1RM: exactMatch.est1RM,
                                type: 'direct'
                            };
                        }
                        
                        // STEP 2: Cerca match con nome base (prima parola/e principali)
                        const nameWords = name.split(' ').filter(w => w.length > 2);
                        let bestMatch = null;
                        let bestScore = 0;
                        
                        for (const [estName, estData] of Object.entries(exerciseEstimates)) {
                            const estWords = estName.split(' ').filter(w => w.length > 2);
                            
                            // Calcola quante parole in comune
                            const commonWords = nameWords.filter(w => estWords.includes(w));
                            const score = commonWords.length;
                            
                            // Match diretto se tutte le parole principali combaciano
                            if (score >= Math.min(nameWords.length, estWords.length) && score >= 2) {
                                if (score > bestScore) {
                                    bestScore = score;
                                    bestMatch = { estName, estData, isDirect: true };
                                }
                            }
                            // Match simile se almeno 1 parola chiave combacia
                            else if (score >= 1 && !bestMatch) {
                                bestMatch = { estName, estData, isDirect: false };
                            }
                        }
                        
                        if (bestMatch) {
                            const factor = bestMatch.isDirect ? 1.0 : 0.85;
                            const suggestedWeight = Math.round(bestMatch.estData.est1RM * percentage * factor * 2) / 2;
                            return {
                                weight: suggestedWeight,
                                basedOn: bestMatch.isDirect ? bestMatch.estData.basedOn : bestMatch.estData.originalName,
                                est1RM: bestMatch.estData.est1RM,
                                type: bestMatch.isDirect ? 'direct' : 'similar'
                            };
                        }
                        
                        return null;
                    };
                    
                    return {
                        id: Date.now(),
                        name: suggestion.suggestion || 'Allenamento AI',
                        exercises: suggestion.exercises ? suggestion.exercises.map(ex => {
                            const setsCount = parseSetsCount(ex.sets);
                            const repsValue = parseReps(ex.reps);
                            
                            // Calcola peso suggerito per questo esercizio
                            const weightSuggestion = calculateSuggestedWeight(ex.name, repsValue);
                            console.log(`💪 ${ex.name} (${repsValue} reps):`, weightSuggestion ? `${weightSuggestion.weight}kg (${weightSuggestion.type})` : 'Nessun suggerimento');
                            
                            // Create individual set objects (not references to same object)
                            const setsArray = [];
                            for (let i = 0; i < setsCount; i++) {
                                const setObj = {
                                    weight: 0,
                                    reps: repsValue,
                                    rpe: 8,
                                    target: repsValue // Also set target for display
                                };
                                
                                // Aggiungi peso suggerito se disponibile
                                if (weightSuggestion) {
                                    setObj.suggestedWeight = weightSuggestion.weight;
                                    setObj.suggestedBasis = weightSuggestion.basedOn;
                                    setObj.suggestedType = weightSuggestion.type;
                                }
                                
                                setsArray.push(setObj);
                            }
                            
                            return {
                                name: ex.name || 'Esercizio',
                                sets: setsArray,
                                rest: 90,
                                notes: ex.notes || ''
                            };
                        }) : [],
                        aiGenerated: true,
                        aiPersonalized: isPersonalized, // Distingue AI classico da personalizzato
                        fromAI: true, // Compatibilità con renderWorkouts
                        createdAt: new Date().toISOString()
                    };
                };

                // Handle Save
                document.getElementById('saveAiWorkout').addEventListener('click', async () => {
                    const btn = document.getElementById('saveAiWorkout');
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '☁️ Sync...';
                    btn.disabled = true;

                    try {
                        const newWorkout = createWorkoutObj();
                        const currentWorkouts = JSON.parse(localStorage.getItem('ironflow_workouts') || '[]');
                        currentWorkouts.unshift(newWorkout);
                        localStorage.setItem('ironflow_workouts', JSON.stringify(currentWorkouts));

                        // CRITICAL: Sync to cloud BEFORE reload to prevent overwrite by loadFromCloud() on init
                        console.log('☁️ Syncing new AI workout to cloud...');
                        await firestoreService.syncToCloud();

                        alert('Scheda salvata e sincronizzata!');
                        window.location.reload();
                    } catch (e) {
                        console.error('Sync error:', e);
                        alert('Salvato in locale. Errore sync cloud: ' + e.message);
                        window.location.reload();
                    } finally {
                        btn.innerHTML = originalText;
                        btn.disabled = false;
                    }
                });

                // Handle Start
                document.getElementById('startAiWorkout').addEventListener('click', async () => {
                    const btn = document.getElementById('startAiWorkout');
                    const originalText = btn.innerHTML;
                    btn.innerHTML = '🚀 Avvio...';
                    btn.disabled = true;

                    try {
                        const newWorkout = createWorkoutObj();
                        const currentWorkouts = JSON.parse(localStorage.getItem('ironflow_workouts') || '[]');
                        currentWorkouts.unshift(newWorkout);
                        localStorage.setItem('ironflow_workouts', JSON.stringify(currentWorkouts));

                        // CRITICAL: Sync to cloud BEFORE reload
                        console.log('☁️ Syncing new AI workout to cloud before start...');
                        await firestoreService.syncToCloud();

                        // Reload to show in list and start
                        window.location.reload();
                    } catch (e) {
                        console.error('Sync error:', e);
                        // Still reload to try to start locally
                        window.location.reload();
                    }
                });

            } else {
                throw new Error(result.message);
            }

        } catch (error) {
            console.error('AI Error:', error);
            aiContent.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: #ff4444;">
                    <p>❌ Errore durante la generazione: ${error.message}</p>
                    <button class="btn btn-outline" onclick="window.location.reload()" style="margin-top:1rem;">Riprova</button>
                </div>
            `;
        }
    });

    console.log('🤖 AI Generation intercepted (Button Replaced)');
}

// Check for shared workout
async function checkSharedWorkout(workoutSharingHandler) {
    const result = await workoutSharingHandler.checkForSharedWorkout();
    if (result) {
        if (result.success) {
            workoutSharingHandler.showImportSuccess(result.workout.name);
            // Trigger workout list reload if function exists
            if (typeof window.renderWorkouts === 'function') {
                window.renderWorkouts();
            }
        } else {
            workoutSharingHandler.showImportError(result.error);
        }
    }
}

// Intercept clicks on share buttons to use new system
function setupShareInterception(sharingHandler) {
    const list = document.getElementById('savedWorkoutsList');
    if (!list) return;

    // Use Capture phase to intercept event BEFORE it reaches the button's original handler
    list.addEventListener('click', async (e) => {
        const btn = e.target.closest('.share-workout');
        if (!btn) return;

        // Stop original handler
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        console.log('⚡ Share button intercepted by Enhancement Loader');

        // Visual feedback
        const originalText = btn.textContent;
        btn.textContent = '⏳';

        try {
            const index = Number(btn.dataset.index);
            const workouts = JSON.parse(localStorage.getItem('ironflow_workouts') || '[]');
            const workout = workouts[index];

            if (!workout) throw new Error('Workout non trovato');

            const result = await sharingHandler.shareWorkout(workout);

            if (result.success) {
                sharingHandler.showShareModal(workout.name, result.shareUrl);
            } else {
                alert('Errore: ' + result.error);
            }
        } catch (error) {
            console.error('Share error:', error);
            alert('Errore durante la condivisione');
        } finally {
            btn.textContent = originalText;
        }
    }, true); // true = Capture Phase

    console.log('🛡️ Share interception active');
}

// Export for global access
window.focusModeEnhancements = {
    mediaSessionManager,
    sessionRecoveryManager,
    aiTargetingHandler,
    WorkoutSharingHandler,
    initialized: true
};

console.log('📦 Enhancements exported to window.focusModeEnhancements');
