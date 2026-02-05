// AI Targeting Handler for granular workout generation
// Manages muscle group selection and prompt modification

const TARGET_MAP = {
    'push': 'Petto, Spalle, Tricipiti',
    'pull': 'Schiena, Bicipiti, Avambracci',
    'legs': 'Quadricipiti, Femorali, Glutei, Polpacci',
    'upper': 'Parte superiore del corpo',
    'lower': 'Parte inferiore del corpo',
    'full': 'Tutto il corpo (equilibrato)',
    'core': 'Addominali, Obliqui, Lombari, Core'
};

export class AITargetingHandler {
    constructor() {
        this.selectedTarget = null;
        this.chips = [];
    }

    // Initialize chip selection
    init(chipSelector = '.ai-target-chip') {
        this.chips = document.querySelectorAll(chipSelector);

        if (this.chips.length === 0) {
            console.warn('No AI target chips found');
            return;
        }

        // Add click handlers
        this.chips.forEach(chip => {
            chip.addEventListener('click', () => this.handleChipClick(chip));

            // Add hover effect
            chip.style.transition = 'all 0.2s';
            chip.addEventListener('mouseenter', () => {
                if (!chip.classList.contains('active')) {
                    chip.style.background = 'rgba(255,255,255,0.08)';
                    chip.style.borderColor = 'var(--color-primary-dim)';
                }
            });
            chip.addEventListener('mouseleave', () => {
                if (!chip.classList.contains('active')) {
                    chip.style.background = 'rgba(255,255,255,0.05)';
                    chip.style.borderColor = 'var(--color-border)';
                }
            });
        });

        console.log('AI Targeting initialized with', this.chips.length, 'chips');
    }

    // Handle chip click
    handleChipClick(chip) {
        const target = chip.dataset.target;

        // Toggle selection
        if (chip.classList.contains('active')) {
            // Deselect
            chip.classList.remove('active');
            chip.style.background = 'rgba(255,255,255,0.05)';
            chip.style.borderColor = 'var(--color-border)';
            chip.style.color = 'var(--color-text)';
            this.selectedTarget = null;
        } else {
            // Deselect all others
            this.chips.forEach(c => {
                c.classList.remove('active');
                c.style.background = 'rgba(255,255,255,0.05)';
                c.style.borderColor = 'var(--color-border)';
                c.style.color = 'var(--color-text)';
            });

            // Select this one
            chip.classList.add('active');
            chip.style.background = 'var(--color-primary)';
            chip.style.borderColor = 'var(--color-primary)';
            chip.style.color = '#000';
            this.selectedTarget = target;
        }

        console.log('Target selected:', this.selectedTarget || 'none');
    }

    // Get current selection
    getSelectedTarget() {
        return this.selectedTarget;
    }

    // Get target instruction for AI prompt (temporary, per-request)
    getTargetInstruction() {
        if (!this.selectedTarget) {
            return ''; // No specific target, use normal prompt
        }

        const muscleGroups = TARGET_MAP[this.selectedTarget];
        if (!muscleGroups) {
            console.warn('Unknown target:', this.selectedTarget);
            return '';
        }

        return `\n\nFOCUS SPECIFICO RICHIESTO: ${muscleGroups}.\nL'allenamento DEVE concentrarsi principalmente su questi gruppi muscolari. Mantieni comunque l'equilibrio e considera i dati DOMS/recovery disponibili per evitare sovrallenamento.`;
    }

    // Build user request object for AI service
    buildUserRequest(customText = '') {
        return {
            target: this.selectedTarget, // Will be null if nothing selected
            customText: customText,
            targetInstruction: this.getTargetInstruction()
        };
    }

    // Reset selection (call after generation if needed)
    reset() {
        this.chips.forEach(chip => {
            chip.classList.remove('active');
            chip.style.background = 'rgba(255,255,255,0.05)';
            chip.style.borderColor = 'var(--color-border)';
            chip.style.color = 'var(--color-text)';
        });
        this.selectedTarget = null;
    }

    // Add CSS for active state (call once on init)
    static addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .ai-target-chip {
                user-select: none;
                -webkit-user-select: none;
            }
            
            .ai-target-chip.active {
                background: var(--color-primary) !important;
                border-color: var(--color-primary) !important;
                color: #000 !important;
                font-weight: 600;
            }
        `;
        document.head.appendChild(style);
    }
}

// Export singleton instance
export const aiTargetingHandler = new AITargetingHandler();
