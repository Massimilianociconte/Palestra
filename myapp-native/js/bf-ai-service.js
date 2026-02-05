/**
 * BF-AI Service - Integrazione per siti esterni
 * Servizio per analizzare body fat da foto usando BF-AI API
 * 
 * Endpoint API: https://bf-ai.netlify.app
 */

const BF_AI_CONFIG = {
    baseUrl: 'https://bf-ai.netlify.app',
    endpoints: {
        analyzeDensity: '/api/v1/analyze-density',
        quickEstimate: '/api/v1/quick-estimate',
        health: '/api/v1/health'
    }
};

class BFAIService {
    constructor() {
        this.baseUrl = BF_AI_CONFIG.baseUrl;
    }

    /**
     * Verifica che il servizio BF-AI sia attivo
     */
    async checkHealth() {
        try {
            const response = await fetch(`${this.baseUrl}${BF_AI_CONFIG.endpoints.health}`);
            const data = await response.json();
            return { available: data.status === 'healthy', version: data.version };
        } catch (error) {
            console.error('BF-AI Health check failed:', error);
            return { available: false, error: error.message };
        }
    }

    /**
     * Analizza una foto per calcolare body fat e misure
     * @param {File} imageFile - File immagine da analizzare
     * @param {Object} params - Parametri dell'atleta
     * @param {number} params.height_cm - Altezza in cm
     * @param {number} params.weight_kg - Peso in kg
     * @param {string} params.gender - 'male' o 'female'
     * @param {number} params.age - Età in anni
     * @param {string} params.ethnicity - 'caucasian', 'african_american', 'asian', 'hispanic', 'other'
     * @param {number} [params.waist_cm] - Vita in cm (opzionale, migliora precisione)
     * @returns {Promise<Object>} Risultati dell'analisi
     */
    async analyzePhoto(imageFile, params) {
        try {
            const formData = new FormData();
            
            // Aggiungi immagine
            formData.append('image_front', imageFile);
            
            // Aggiungi parametri
            formData.append('height_cm', params.height_cm);
            formData.append('weight_kg', params.weight_kg);
            formData.append('gender', params.gender);
            formData.append('age', params.age || 30);
            formData.append('ethnicity', params.ethnicity || 'caucasian');
            
            if (params.waist_cm) {
                formData.append('waist_cm', params.waist_cm);
            }

            const response = await fetch(`${this.baseUrl}${BF_AI_CONFIG.endpoints.analyzeDensity}`, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.detail || 'Errore analisi BF-AI');
            }

            const result = await response.json();
            return this.formatResult(result);

        } catch (error) {
            console.error('BF-AI Analysis error:', error);
            throw error;
        }
    }

    /**
     * Formatta il risultato per una visualizzazione user-friendly
     */
    formatResult(rawResult) {
        const bf = rawResult.body_fat;
        const density = rawResult.density_analysis;
        const measurements = rawResult.measurements;

        return {
            success: true,
            summary: {
                bodyFatPercentage: bf.ensemble,
                category: rawResult.category,
                bmi: rawResult.bmi,
                confidence: Math.round(rawResult.confidence * 100)
            },
            methods: {
                ensemble: bf.ensemble,
                navy: bf.navy_method,
                siri: bf.siri_adjusted,
                cunBae: bf.cun_bae,
                rfm: bf.rfm,
                deurenberg: bf.deurenberg,
                bai: bf.bai
            },
            bodyComposition: {
                fatMassKg: density?.fat_mass_kg,
                leanMassKg: density?.lean_mass_kg,
                densityKgL: density?.density_kg_l
            },
            estimatedMeasurements: {
                neckCm: measurements?.neck_cm,
                waistCm: measurements?.waist_cm,
                hipCm: measurements?.hip_cm,
                chestCm: measurements?.chest_cm
            },
            ethnicity: rawResult.ethnicity,
            ethnicCorrections: rawResult.ethnic_corrections_applied
        };
    }

    /**
     * Genera HTML per mostrare i risultati
     */
    generateResultsHTML(result) {
        const { summary, methods, bodyComposition, estimatedMeasurements } = result;
        
        const categoryColors = {
            'Essential Fat': '#ff6b6b',
            'Athletes': '#00f3ff',
            'Fitness': '#4ecdc4',
            'Average': '#ffd93d',
            'Obese': '#ff4444'
        };
        
        const categoryColor = categoryColors[summary.category] || '#00f3ff';

        return `
            <div class="bf-ai-results" style="background: linear-gradient(135deg, rgba(0,243,255,0.1) 0%, rgba(0,0,0,0) 100%); border: 1px solid ${categoryColor}; border-radius: 12px; padding: 1.5rem; margin-top: 1rem;">
                
                <!-- Header con BF% principale -->
                <div style="text-align: center; margin-bottom: 1.5rem;">
                    <div style="font-size: 0.9rem; color: #888; margin-bottom: 0.5rem;">🎯 Body Fat Stimato</div>
                    <div style="font-size: 3rem; font-weight: bold; color: ${categoryColor};">${Number(summary.bodyFatPercentage).toFixed(1)}%</div>
                    <div style="font-size: 1.1rem; color: ${categoryColor}; margin-top: 0.25rem;">${summary.category}</div>
                    <div style="font-size: 0.8rem; color: #666; margin-top: 0.5rem;">Confidence: ${summary.confidence}%</div>
                </div>

                <!-- Grid Metodi -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; margin-bottom: 1.5rem;">
                    <div style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 0.7rem; color: #888;">Navy</div>
                        <div style="font-size: 1.2rem; font-weight: bold; color: #fff;">${Number(methods.navy).toFixed(1)}%</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 0.7rem; color: #888;">CUN-BAE</div>
                        <div style="font-size: 1.2rem; font-weight: bold; color: #fff;">${Number(methods.cunBae).toFixed(1)}%</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); padding: 0.75rem; border-radius: 8px; text-align: center;">
                        <div style="font-size: 0.7rem; color: #888;">RFM</div>
                        <div style="font-size: 1.2rem; font-weight: bold; color: #fff;">${Number(methods.rfm).toFixed(1)}%</div>
                    </div>
                </div>

                <!-- Composizione Corporea -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div style="background: rgba(0,0,0,0.3); padding: 1rem; border-radius: 8px;">
                        <div style="font-size: 0.8rem; color: #888;">Massa Grassa</div>
                        <div style="font-size: 1.3rem; font-weight: bold; color: #ff6b6b;">${Number(bodyComposition.fatMassKg).toFixed(2)} kg</div>
                    </div>
                    <div style="background: rgba(0,0,0,0.3); padding: 1rem; border-radius: 8px;">
                        <div style="font-size: 0.8rem; color: #888;">Massa Magra</div>
                        <div style="font-size: 1.3rem; font-weight: bold; color: #4ecdc4;">${Number(bodyComposition.leanMassKg).toFixed(2)} kg</div>
                    </div>
                </div>

                <!-- Misure Stimate -->
                <div style="background: rgba(0,0,0,0.2); padding: 1rem; border-radius: 8px;">
                    <div style="font-size: 0.9rem; color: #888; margin-bottom: 0.75rem;">📏 Misure Stimate</div>
                    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.5rem; font-size: 0.85rem;">
                        <div><span style="color:#888;">Collo:</span> <span style="color:#fff;">${estimatedMeasurements.neckCm} cm</span></div>
                        <div><span style="color:#888;">Vita:</span> <span style="color:#fff;">${estimatedMeasurements.waistCm} cm</span></div>
                        <div><span style="color:#888;">Fianchi:</span> <span style="color:#fff;">${estimatedMeasurements.hipCm} cm</span></div>
                        <div><span style="color:#888;">Torace:</span> <span style="color:#fff;">${estimatedMeasurements.chestCm} cm</span></div>
                    </div>
                </div>

                <!-- BMI -->
                <div style="text-align: center; margin-top: 1rem; font-size: 0.85rem; color: #888;">
                    BMI: <span style="color: #fff; font-weight: bold;">${Number(summary.bmi).toFixed(1)}</span>
                </div>

                <!-- Footer con credits -->
                <div style="text-align: center; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                    <span style="font-size: 0.7rem; color: #666;">Powered by </span>
                    <a href="https://bf-ai.netlify.app" target="_blank" style="font-size: 0.7rem; color: #00f3ff; text-decoration: none;">BF-AI</a>
                </div>
            </div>
        `;
    }
}

// Esporta l'istanza singleton
const bfAIService = new BFAIService();

// Export per ES modules
export { bfAIService, BFAIService };

// Fallback per script non-module
if (typeof window !== 'undefined') {
    window.bfAIService = bfAIService;
    window.BFAIService = BFAIService;
}
