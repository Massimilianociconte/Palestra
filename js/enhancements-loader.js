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

    console.log('✅ All enhancements loaded');
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
                                    // Store initial duration for progress bar
                                    mediaSessionManager.initialTimerDuration = totalSeconds;
                                    mediaSessionManager.updateTimer(totalSeconds);
                                    console.log(`⏱️ Lockscreen timer started: ${totalSeconds}s`);
                                }
                            }
                        }
                    } else if (!isVisible && timerStarted) {
                        // Timer area hidden - REST ENDED
                        console.log('✅ Rest period ended');
                        timerStarted = false;
                        lastTimerValue = null;
                        
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

            // 1. Get Profile
            const profile = JSON.parse(localStorage.getItem('ironflow_profile') || '{}');

            // 2. Get Existing Workouts
            const workouts = JSON.parse(localStorage.getItem('ironflow_workouts') || '[]');

            // 3. Construct Payload
            const payload = {
                profile: profile,
                recentLogs: [],
                existingWorkouts: workouts,
                userRequest: userRequest,
                recentWorkoutCount: workouts.length,
                progressionData: {},
                healthData: {}
            };

            // Import AI Service dynamically
            const { aiService } = await import('./ai-service.js');
            const result = await aiService.predictNextSession(payload);

            if (result.success) {
                // Render result
                const suggestion = result.data;

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

                const createWorkoutObj = () => ({
                    id: Date.now(),
                    name: suggestion.suggestion,
                    exercises: suggestion.exercises ? suggestion.exercises.map(ex => ({
                        name: ex.name,
                        sets: Array(parseInt(ex.sets) || 3).fill({ weight: 0, reps: ex.reps || '10', rpe: 8 }),
                        rest: 90,
                        notes: ex.notes || ''
                    })) : [],
                    aiGenerated: true,
                    createdAt: new Date().toISOString()
                });

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
