// Focus Mode Enhancements Loader
// Dynamically loads and integrates all enhancement modules without modifying user.html
// Just add: <script type="module" src="./js/enhancements-loader.js"></script> to user.html

import { mediaSessionManager } from './media-session-manager.js';
import { sessionRecoveryManager } from './session-recovery-manager.js';
import { aiTargetingHandler, AITargetingHandler } from './ai-targeting-handler.js';
import { WorkoutSharingHandler } from './workout-sharing-handler.js';
import { firestoreService } from './firestore-service.js';

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

    console.log('✅ All enhancements loaded');
}

// Inject AI targeting chips HTML
function injectAITargetingUI() {
    const aiPredictor = document.querySelector('#aiPredictorContent');
    if (!aiPredictor || aiPredictor.dataset.enhanced) return;

    const parent = aiPredictor.parentElement;
    if (!parent) return;

    // Find the button container
    const buttonContainer = parent.querySelector('div[style*="display: flex"]');
    if (!buttonContainer) return;

    // Create targeting UI
    const targetingHTML = `
        <div class="ai-target-selection" style="margin-bottom: 1rem;">
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
