/**
 * Terra Health Service
 * Integrazione con Terra API per Apple Health (iOS) e altri provider
 * https://docs.tryterra.co/
 * 
 * Free Tier: 10 utenti connessi
 * Supporta: Apple Health, Samsung Health, Garmin, Fitbit, etc.
 */

import { healthTOONEncoder } from './health-toon-encoder.js';
import { firestoreService } from './firestore-service.js';

class TerraHealthService {
    constructor() {
        // Terra API Configuration
        // NOTA: In produzione, queste chiavi dovrebbero essere in Firebase Functions
        this.devId = ''; // Da configurare
        this.apiKey = ''; // Da configurare (X-API-Key)
        this.widgetUrl = 'https://widget.tryterra.co';
        this.apiBase = 'https://api.tryterra.co/v2';
        
        // Stato connessione
        this.isConnected = false;
        this.userId = null; // Terra user_id
        this.provider = null; // 'APPLE', 'SAMSUNG', etc.
        this.lastSync = null;
        
        // Reference token per widget
        this.referenceId = null;
    }

    /**
     * Configura le credenziali Terra API
     * Chiamato dopo aver caricato le config da Firestore
     */
    configure(devId, apiKey) {
        this.devId = devId;
        this.apiKey = apiKey;
        console.log('Terra Health Service configured');
    }

    /**
     * Carica configurazione Terra da Firestore
     */
    async loadConfig() {
        try {
            const config = await firestoreService.getTerraConfig();
            if (config && config.devId && config.apiKey) {
                this.configure(config.devId, config.apiKey);
                return true;
            }
            console.warn('Terra config not found in Firestore');
            return false;
        } catch (error) {
            console.error('Error loading Terra config:', error);
            return false;
        }
    }

    /**
     * Carica stato connessione utente da Firestore
     */
    async loadUserConnection() {
        try {
            const terraData = await firestoreService.getTerraUserData();
            if (terraData && terraData.userId) {
                this.userId = terraData.userId;
                this.provider = terraData.provider;
                this.isConnected = true;
                this.lastSync = terraData.lastSync;
                console.log(`Terra connected: ${this.provider} (user: ${this.userId})`);
                return true;
            }
            return false;
        } catch (error) {
            console.error('Error loading Terra user data:', error);
            return false;
        }
    }

    /**
     * Genera il widget URL per connettere un provider
     * L'utente apre questo URL sul telefono per autorizzare
     */
    async generateWidgetSession(provider = 'APPLE') {
        if (!this.devId || !this.apiKey) {
            await this.loadConfig();
        }

        if (!this.devId) {
            throw new Error('Terra API not configured. Please set up Terra credentials.');
        }

        try {
            // Genera reference_id unico per questo utente
            const user = await firestoreService.getUid();
            this.referenceId = `ironflow_${user}_${Date.now()}`;

            // Chiama Firebase Function per generare widget session
            // (Le API keys non devono essere esposte al client)
            const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            const functions = getFunctions();
            
            const generateSession = httpsCallable(functions, 'generateTerraWidgetSession');
            const result = await generateSession({ 
                referenceId: this.referenceId,
                providers: [provider] // Limita a un solo provider
            });

            if (result.data.success) {
                return {
                    success: true,
                    widgetUrl: result.data.url,
                    sessionId: result.data.sessionId
                };
            } else {
                throw new Error(result.data.message || 'Failed to generate widget session');
            }
        } catch (error) {
            console.error('Error generating Terra widget session:', error);
            throw error;
        }
    }

    /**
     * Apre il widget Terra per connettere Apple Health
     */
    async connectAppleHealth() {
        try {
            const session = await this.generateWidgetSession('APPLE');
            
            // Apri widget in nuova finestra/tab
            // Su mobile, questo aprirà l'app Terra se installata
            const width = 500;
            const height = 700;
            const left = (screen.width - width) / 2;
            const top = (screen.height - height) / 2;

            const popup = window.open(
                session.widgetUrl,
                'Terra Health Authorization',
                `width=${width},height=${height},left=${left},top=${top}`
            );

            // Mostra istruzioni all'utente
            this.showConnectionInstructions('apple');

            return {
                success: true,
                message: 'Widget aperto. Segui le istruzioni per connettere Apple Health.',
                sessionId: session.sessionId
            };
        } catch (error) {
            console.error('Error connecting Apple Health:', error);
            throw error;
        }
    }

    /**
     * Mostra istruzioni per la connessione
     */
    showConnectionInstructions(provider) {
        const instructions = {
            apple: `
                <div style="padding: 1rem;">
                    <h3 style="color: var(--color-primary); margin-bottom: 1rem;">📱 Connetti Apple Health</h3>
                    <ol style="line-height: 1.8; color: var(--color-text-muted);">
                        <li>Si aprirà una pagina Terra sul tuo dispositivo</li>
                        <li>Seleziona <strong>Apple Health</strong></li>
                        <li>Scarica l'app <strong>Terra</strong> se richiesto</li>
                        <li>Autorizza l'accesso ai dati salute</li>
                        <li>Torna qui e clicca "Verifica Connessione"</li>
                    </ol>
                    <p style="font-size: 0.85rem; margin-top: 1rem; padding: 0.75rem; background: rgba(255,193,7,0.1); border-radius: 8px;">
                        ⚠️ <strong>Nota:</strong> L'app Terra deve rimanere installata per sincronizzare i dati in background.
                    </p>
                </div>
            `
        };

        // Crea modal con istruzioni
        const modal = document.createElement('div');
        modal.id = 'terraInstructionsModal';
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.9);
            z-index: 10000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
        `;

        modal.innerHTML = `
            <div class="card" style="max-width: 450px; width: 100%;">
                ${instructions[provider] || instructions.apple}
                <div style="display: flex; gap: 0.75rem; margin-top: 1rem;">
                    <button id="terraInstructionsClose" class="btn btn-outline" style="flex: 1;">
                        Chiudi
                    </button>
                    <button id="terraVerifyConnection" class="btn btn-primary" style="flex: 1;">
                        ✓ Verifica Connessione
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        document.getElementById('terraInstructionsClose').addEventListener('click', () => {
            modal.remove();
        });

        document.getElementById('terraVerifyConnection').addEventListener('click', async () => {
            const btn = document.getElementById('terraVerifyConnection');
            btn.textContent = '⏳ Verifica...';
            btn.disabled = true;

            try {
                const connected = await this.verifyConnection();
                if (connected) {
                    modal.remove();
                    this.showSuccessNotification('Apple Health connesso con successo!');
                    // Trigger UI update
                    window.dispatchEvent(new CustomEvent('terraConnected', { detail: { provider: 'APPLE' } }));
                } else {
                    btn.textContent = '✓ Verifica Connessione';
                    btn.disabled = false;
                    alert('Connessione non ancora completata. Assicurati di aver autorizzato l\'accesso nell\'app Terra.');
                }
            } catch (error) {
                btn.textContent = '✓ Verifica Connessione';
                btn.disabled = false;
                alert('Errore verifica: ' + error.message);
            }
        });
    }

    /**
     * Verifica se la connessione è stata completata
     */
    async verifyConnection() {
        try {
            const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            const functions = getFunctions();
            
            const verifyTerra = httpsCallable(functions, 'verifyTerraConnection');
            const result = await verifyTerra({ referenceId: this.referenceId });

            if (result.data.success && result.data.connected) {
                this.userId = result.data.userId;
                this.provider = result.data.provider;
                this.isConnected = true;

                // Salva in Firestore
                await firestoreService.saveTerraUserData({
                    userId: this.userId,
                    provider: this.provider,
                    connectedAt: new Date().toISOString(),
                    referenceId: this.referenceId
                });

                // Prima sincronizzazione
                await this.syncAllData();

                return true;
            }

            return false;
        } catch (error) {
            console.error('Error verifying Terra connection:', error);
            throw error;
        }
    }

    /**
     * Disconnetti da Terra
     */
    async disconnect() {
        try {
            if (!this.userId) {
                console.log('No Terra connection to disconnect');
                return true;
            }

            const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            const functions = getFunctions();
            
            const deauthTerra = httpsCallable(functions, 'deauthTerraUser');
            await deauthTerra({ userId: this.userId });

            // Pulisci stato locale
            this.userId = null;
            this.provider = null;
            this.isConnected = false;

            // Rimuovi da Firestore
            await firestoreService.removeTerraUserData();

            console.log('Terra disconnected successfully');
            return true;
        } catch (error) {
            console.error('Error disconnecting Terra:', error);
            throw error;
        }
    }

    /**
     * Sincronizza tutti i dati da Terra
     */
    async syncAllData() {
        if (!this.isConnected || !this.userId) {
            console.log('Terra not connected, skipping sync');
            return null;
        }

        try {
            console.log('Starting Terra health data sync...');

            const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            const functions = getFunctions();
            
            // Fetch dati degli ultimi 7 giorni
            const fetchTerraData = httpsCallable(functions, 'fetchTerraHealthData');
            const result = await fetchTerraData({ 
                userId: this.userId,
                days: 7
            });

            if (!result.data.success) {
                throw new Error(result.data.message || 'Failed to fetch Terra data');
            }

            const terraData = result.data.data;
            console.log('Terra raw data received:', terraData);

            // Processa e normalizza i dati
            const healthData = this.processTerraDat(terraData);
            console.log('Processed health data:', healthData);

            // Converti in formato TOON
            const toonData = healthTOONEncoder.fromTerra(healthData);

            // Salva in Firestore
            await firestoreService.saveHealthData(toonData);

            // Aggiorna timestamp ultimo sync
            this.lastSync = Date.now();
            await firestoreService.updateTerraLastSync(this.lastSync);

            console.log('Terra health data synced successfully');

            return {
                success: true,
                data: toonData,
                message: 'Dati Apple Health sincronizzati con successo'
            };
        } catch (error) {
            console.error('Error syncing Terra data:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Processa i dati raw da Terra API in formato normalizzato
     * Terra restituisce dati in formato standardizzato per tutti i provider
     */
    processTerraDat(terraData) {
        const processed = {
            // Metriche base
            steps: 0,
            heartRate: null,
            weight: null,
            calories: 0,
            distance: 0,
            sleep: 0,
            
            // Metriche avanzate
            activeMinutes: 0,
            hrv: null,
            bodyFat: null,
            height: null,
            restingHeartRate: null,
            vo2Max: null,
            respiratoryRate: null,
            oxygenSaturation: null,
            
            // Metadata
            syncTimestamp: Date.now(),
            source: 'terra_' + (this.provider || 'unknown').toLowerCase()
        };

        // Processa Daily data (aggregati giornalieri)
        if (terraData.daily && Array.isArray(terraData.daily)) {
            terraData.daily.forEach(day => {
                // Steps
                if (day.steps) {
                    processed.steps += day.steps;
                }
                
                // Calories (active + BMR)
                if (day.calories) {
                    processed.calories += day.calories;
                }
                
                // Distance (in metri)
                if (day.distance_meters) {
                    processed.distance += day.distance_meters;
                }
                
                // Active minutes
                if (day.active_durations_data?.activity_seconds) {
                    processed.activeMinutes += Math.round(day.active_durations_data.activity_seconds / 60);
                }
            });

            // Media giornaliera per metriche aggregate
            const days = terraData.daily.length || 1;
            processed.steps = Math.round(processed.steps / days);
            processed.calories = Math.round(processed.calories / days);
            processed.distance = Math.round(processed.distance / days);
            processed.activeMinutes = Math.round(processed.activeMinutes / days);
        }

        // Processa Body data (peso, grasso, etc.)
        if (terraData.body && Array.isArray(terraData.body)) {
            const latestBody = terraData.body[terraData.body.length - 1];
            if (latestBody) {
                processed.weight = latestBody.weight_kg || null;
                processed.bodyFat = latestBody.body_fat_percentage || null;
                processed.height = latestBody.height_cm || null;
            }
        }

        // Processa Sleep data
        if (terraData.sleep && Array.isArray(terraData.sleep)) {
            let totalSleepMinutes = 0;
            let sleepDays = 0;

            terraData.sleep.forEach(sleepSession => {
                if (sleepSession.sleep_durations_data?.asleep?.duration_asleep_state_seconds) {
                    totalSleepMinutes += sleepSession.sleep_durations_data.asleep.duration_asleep_state_seconds / 60;
                    sleepDays++;
                } else if (sleepSession.duration_seconds) {
                    // Fallback: usa durata totale
                    totalSleepMinutes += sleepSession.duration_seconds / 60;
                    sleepDays++;
                }
            });

            if (sleepDays > 0) {
                processed.sleep = Math.round((totalSleepMinutes / sleepDays / 60) * 10) / 10; // Ore con 1 decimale
            }
        }

        // Processa Heart Rate data
        if (terraData.activity && Array.isArray(terraData.activity)) {
            const hrSamples = [];
            
            terraData.activity.forEach(activity => {
                if (activity.heart_rate_data?.summary?.avg_hr_bpm) {
                    hrSamples.push(activity.heart_rate_data.summary.avg_hr_bpm);
                }
            });

            if (hrSamples.length > 0) {
                processed.heartRate = Math.round(hrSamples.reduce((a, b) => a + b, 0) / hrSamples.length);
            }
        }

        // Processa HRV data (se disponibile)
        if (terraData.daily) {
            const hrvSamples = [];
            
            terraData.daily.forEach(day => {
                if (day.heart_rate_data?.hrv?.avg_hrv_sdnn) {
                    hrvSamples.push(day.heart_rate_data.hrv.avg_hrv_sdnn);
                }
            });

            if (hrvSamples.length > 0) {
                processed.hrv = Math.round((hrvSamples.reduce((a, b) => a + b, 0) / hrvSamples.length) * 10) / 10;
            }
        }

        // Resting Heart Rate
        if (terraData.daily) {
            const restingHRSamples = [];
            
            terraData.daily.forEach(day => {
                if (day.heart_rate_data?.summary?.resting_hr_bpm) {
                    restingHRSamples.push(day.heart_rate_data.summary.resting_hr_bpm);
                }
            });

            if (restingHRSamples.length > 0) {
                processed.restingHeartRate = Math.round(restingHRSamples.reduce((a, b) => a + b, 0) / restingHRSamples.length);
            }
        }

        // VO2 Max (se disponibile)
        if (terraData.daily) {
            terraData.daily.forEach(day => {
                if (day.oxygen_data?.vo2_max_ml_per_min_per_kg) {
                    processed.vo2Max = day.oxygen_data.vo2_max_ml_per_min_per_kg;
                }
            });
        }

        // Oxygen Saturation
        if (terraData.daily) {
            const spo2Samples = [];
            
            terraData.daily.forEach(day => {
                if (day.oxygen_data?.avg_saturation_percentage) {
                    spo2Samples.push(day.oxygen_data.avg_saturation_percentage);
                }
            });

            if (spo2Samples.length > 0) {
                processed.oxygenSaturation = Math.round(spo2Samples.reduce((a, b) => a + b, 0) / spo2Samples.length);
            }
        }

        return processed;
    }

    /**
     * Mostra notifica di successo
     */
    showSuccessNotification(message) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--color-surface);
            border: 1px solid var(--color-primary);
            padding: 1rem 1.5rem;
            border-radius: var(--radius-md);
            z-index: 10001;
            box-shadow: 0 4px 12px rgba(0, 243, 255, 0.3);
            animation: slideDown 0.3s ease-out;
        `;

        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="font-size: 1.5rem;">✅</span>
                <span style="color: var(--color-text);">${message}</span>
            </div>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideUp 0.3s ease-in';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    /**
     * Verifica se l'utente è già connesso a Google Fit
     */
    async isGoogleFitConnected() {
        try {
            const healthToken = await firestoreService.getHealthToken();
            return !!(healthToken && healthToken.accessToken);
        } catch (error) {
            return false;
        }
    }

    /**
     * Verifica conflitti con altri provider
     */
    async checkProviderConflict() {
        const googleFitConnected = await this.isGoogleFitConnected();
        
        if (googleFitConnected) {
            return {
                hasConflict: true,
                currentProvider: 'Google Fit',
                message: 'Sei già connesso a Google Fit. Per usare Apple Health, devi prima disconnetterti da Google Fit.'
            };
        }

        return { hasConflict: false };
    }
}

// Singleton export
export const terraHealthService = new TerraHealthService();
