/**
 * Health Connect Service
 * Gestisce l'integrazione con Google Fit API per sincronizzazione dati salute
 */

import { healthTOONEncoder } from './health-toon-encoder.js';
import { firestoreService } from './firestore-service.js';

class HealthConnectService {
    constructor() {
        // Configurazione OAuth Google
        this.clientId = '658389886558-i33b8t1d482g394brc4h8bl8g7368ep3.apps.googleusercontent.com';
        // Gestisce sia GitHub Pages che locale
        const basePath = window.location.pathname.includes('/Palestra/') ? '/Palestra' : '';
        this.redirectUri = window.location.origin + basePath + '/auth-callback.html';
        this.scopes = [
            'https://www.googleapis.com/auth/fitness.activity.read',
            'https://www.googleapis.com/auth/fitness.body.read',
            'https://www.googleapis.com/auth/fitness.heart_rate.read',
            'https://www.googleapis.com/auth/fitness.sleep.read',
            'https://www.googleapis.com/auth/fitness.nutrition.read'
        ].join(' ');
        
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        this.isConnected = false;
        this.tokenLoadPromise = null;
        
        // Base URL Google Fit API
        this.apiBase = 'https://www.googleapis.com/fitness/v1/users/me';
    }

    /**
     * Inizia il flusso OAuth per connettere Google Fit (Authorization Code Flow con Firebase Functions)
     */
    async connect() {
        // Usa Authorization Code Flow (con Firebase Function per exchange)
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${this.clientId}&` +
            `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
            `response_type=code&` + // Code per avere refresh_token
            `scope=${encodeURIComponent(this.scopes)}&` +
            `access_type=offline&` + // Necessario per refresh_token
            `prompt=consent`;
        
        // Apri popup OAuth
        const width = 500;
        const height = 600;
        const left = (screen.width - width) / 2;
        const top = (screen.height - height) / 2;
        
        const popup = window.open(
            authUrl,
            'Google Fit Authorization',
            `width=${width},height=${height},left=${left},top=${top}`
        );
        
        // Ascolta il messaggio dal popup
        return new Promise((resolve, reject) => {
            window.addEventListener('message', async (event) => {
                if (event.origin !== window.location.origin) return;
                
                if (event.data.type === 'oauth_success') {
                    try {
                        popup.close();
                    } catch (e) {
                        console.log('Popup already closed');
                    }
                    await this.handleAuthCode(event.data.code);
                    resolve(true);
                } else if (event.data.type === 'oauth_error') {
                    try {
                        popup.close();
                    } catch (e) {
                        console.log('Popup already closed');
                    }
                    reject(new Error(event.data.error));
                }
            }, { once: true });
        });
    }

    /**
     * Gestisce il codice di autorizzazione OAuth tramite Firebase Function
     */
    async handleAuthCode(code) {
        try {
            // Importa Firebase Functions
            const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            const functions = getFunctions();
            
            // Chiama la Firebase Function per scambiare il code
            const exchangeCode = httpsCallable(functions, 'exchangeHealthCode');
            const result = await exchangeCode({ code });
            
            if (result.data.success) {
                console.log('Auth code exchanged successfully');
                
                // Aspetta un momento per assicurarsi che Firestore sia aggiornato
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Token salvato server-side, ora caricalo
                await this.loadSavedToken();
                
                if (!this.accessToken) {
                    throw new Error('Failed to load token after exchange');
                }
                
                this.isConnected = true;
                console.log('Health Connect is now connected');
                
                // Prima sincronizzazione
                await this.syncAllData();
                
                return true;
            } else {
                throw new Error(result.data.message || 'Failed to exchange code');
            }
        } catch (error) {
            console.error('Error handling auth code:', error);
            throw error;
        }
    }

    /**
     * Refresh access token quando scade (tramite Firebase Function)
     */
    async refreshAccessToken() {
        try {
            // Importa Firebase Functions
            const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            const functions = getFunctions();
            
            // Chiama la Firebase Function per refresh
            const refreshToken = httpsCallable(functions, 'refreshHealthToken');
            const result = await refreshToken();
            
            if (result.data.success) {
                this.accessToken = result.data.accessToken;
                this.tokenExpiry = result.data.expiryDate;
                return true;
            } else {
                throw new Error(result.data.message || 'Failed to refresh token');
            }
        } catch (error) {
            console.error('Error refreshing token:', error);
            this.isConnected = false;
            throw error;
        }
    }

    /**
     * Verifica e refresh token se necessario
     */
    async ensureValidToken() {
        if (!this.accessToken) {
            throw new Error('Not connected to Google Fit');
        }
        
        // Se il token scade tra meno di 5 minuti, refresh automatico
        if (this.tokenExpiry && this.tokenExpiry - Date.now() < 5 * 60 * 1000) {
            await this.refreshAccessToken();
        }
    }

    /**
     * Fetch dati da Google Fit API
     */
    async fetchGoogleFitData(dataType, startTime, endTime) {
        await this.ensureValidToken();
        
        const dataSourceId = this.getDataSourceId(dataType);
        const url = `${this.apiBase}/dataSources/${dataSourceId}/datasets/${startTime}-${endTime}`;
        
        console.log(`Fetching ${dataType} from Google Fit:`, url);
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Google Fit API error for ${dataType}:`, response.status, errorText);
            
            // Se 403, verifica se è un problema di permessi o token scaduto
            if (response.status === 403) {
                // Prova a parsare l'errore per capire il tipo
                try {
                    const errorJson = JSON.parse(errorText);
                    const errorMessage = errorJson.error?.message || '';
                    
                    // Se è un errore di permessi (dato non disponibile), non fare retry
                    if (errorMessage.includes('Cannot read data of type') || errorMessage.includes('PERMISSION_DENIED')) {
                        console.warn(`Data type ${dataType} not available or not authorized`);
                        throw new Error(`Data type not available: ${dataType}`);
                    }
                } catch (parseError) {
                    // Se non riusciamo a parsare, proviamo il refresh
                }
                
                // Altrimenti, potrebbe essere un token scaduto - prova il refresh
                console.log('403 error - attempting token refresh');
                try {
                    await this.refreshAccessToken();
                    // Riprova la richiesta con il nuovo token
                    const retryResponse = await fetch(url, {
                        headers: {
                            'Authorization': `Bearer ${this.accessToken}`
                        }
                    });
                    if (retryResponse.ok) {
                        return await retryResponse.json();
                    }
                } catch (refreshError) {
                    console.error('Token refresh failed:', refreshError);
                }
            }
            
            throw new Error(`Google Fit API error (${response.status}): ${response.statusText}`);
        }
        
        return await response.json();
    }

    /**
     * Get data source ID per tipo di dato
     */
    getDataSourceId(dataType) {
        const sources = {
            // Dati base (già implementati)
            steps: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
            heartRate: 'derived:com.google.heart_rate.bpm:com.google.android.gms:merge_heart_rate_bpm',
            weight: 'derived:com.google.weight:com.google.android.gms:merge_weight',
            calories: 'derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended',
            distance: 'derived:com.google.distance.delta:com.google.android.gms:merge_distance_delta',
            sleep: 'derived:com.google.sleep.segment:com.google.android.gms:merged',
            
            // Dati aggiuntivi
            activeMinutes: 'derived:com.google.active_minutes:com.google.android.gms:merge_active_minutes',
            hrv: 'derived:com.google.heart_rate.variability:com.google.android.gms:merge_heart_rate_variability',
            bodyFat: 'derived:com.google.body.fat.percentage:com.google.android.gms:merge_body_fat_percentage',
            height: 'derived:com.google.height:com.google.android.gms:merge_height',
            hydration: 'derived:com.google.hydration:com.google.android.gms:merge_hydration',
            bloodPressure: 'derived:com.google.blood_pressure:com.google.android.gms:merge_blood_pressure',
            bloodGlucose: 'derived:com.google.blood_glucose:com.google.android.gms:merge_blood_glucose',
            oxygenSaturation: 'derived:com.google.oxygen_saturation:com.google.android.gms:merge_oxygen_saturation',
            speed: 'derived:com.google.speed:com.google.android.gms:merge_speed',
            power: 'derived:com.google.power.sample:com.google.android.gms:merge_power',
            activitySegment: 'derived:com.google.activity.segment:com.google.android.gms:merge_activity_segments'
        };
        
        return sources[dataType] || dataType;
    }

    /**
     * Sincronizza tutti i dati health
     */
    async syncAllData(days = 7) {
        try {
            console.log(`Starting health data sync for last ${days} days`);
            
            const endTime = Date.now();
            const startTime = endTime - (days * 24 * 60 * 60 * 1000);
            
            // Converti in nanosecondi (formato Google Fit)
            const startNanos = startTime * 1000000;
            const endNanos = endTime * 1000000;
            
            console.log('Time range:', new Date(startTime), 'to', new Date(endTime));
            
            // Fetch tutti i tipi di dati (base + aggiuntivi)
            const [
                steps, heartRate, weight, calories, distance, sleep,
                activeMinutes, hrv, bodyFat, height, hydration,
                bloodPressure, bloodGlucose, oxygenSaturation
            ] = await Promise.allSettled([
                // Dati base
                this.fetchSteps(startNanos, endNanos),
                this.fetchHeartRate(startNanos, endNanos),
                this.fetchWeight(startNanos, endNanos),
                this.fetchCalories(startNanos, endNanos),
                this.fetchDistance(startNanos, endNanos),
                this.fetchSleep(startNanos, endNanos),
                // Dati aggiuntivi
                this.fetchActiveMinutes(startNanos, endNanos),
                this.fetchHRV(startNanos, endNanos),
                this.fetchBodyFat(startNanos, endNanos),
                this.fetchHeight(startNanos, endNanos),
                this.fetchHydration(startNanos, endNanos),
                this.fetchBloodPressure(startNanos, endNanos),
                this.fetchBloodGlucose(startNanos, endNanos),
                this.fetchOxygenSaturation(startNanos, endNanos)
            ]);
            
            // Log risultati
            console.log('Sync results:', {
                steps: steps.status,
                heartRate: heartRate.status,
                weight: weight.status,
                calories: calories.status,
                distance: distance.status,
                sleep: sleep.status,
                activeMinutes: activeMinutes.status,
                hrv: hrv.status,
                bodyFat: bodyFat.status,
                height: height.status,
                hydration: hydration.status,
                bloodPressure: bloodPressure.status,
                bloodGlucose: bloodGlucose.status,
                oxygenSaturation: oxygenSaturation.status
            });
            
            // Log errori
            const allResults = [
                steps, heartRate, weight, calories, distance, sleep,
                activeMinutes, hrv, bodyFat, height, hydration,
                bloodPressure, bloodGlucose, oxygenSaturation
            ];
            const names = [
                'steps', 'heartRate', 'weight', 'calories', 'distance', 'sleep',
                'activeMinutes', 'hrv', 'bodyFat', 'height', 'hydration',
                'bloodPressure', 'bloodGlucose', 'oxygenSaturation'
            ];
            
            allResults.forEach((result, idx) => {
                if (result.status === 'rejected') {
                    const errorMsg = result.reason?.message || result.reason;
                    
                    // Distingui tra dato non disponibile e errore reale
                    if (errorMsg.includes('Data type not available')) {
                        console.info(`ℹ️ ${names[idx]}: dato non disponibile (normale se non hai registrato questo tipo di dato)`);
                    } else {
                        console.error(`❌ Failed to fetch ${names[idx]}:`, result.reason);
                    }
                }
            });
            
            // Processa risultati
            const healthData = {
                // Dati base
                steps: steps.status === 'fulfilled' ? steps.value : null,
                heartRate: heartRate.status === 'fulfilled' ? heartRate.value : null,
                weight: weight.status === 'fulfilled' ? weight.value : null,
                calories: calories.status === 'fulfilled' ? calories.value : null,
                distance: distance.status === 'fulfilled' ? distance.value : null,
                sleep: sleep.status === 'fulfilled' ? sleep.value : null,
                // Dati aggiuntivi
                activeMinutes: activeMinutes.status === 'fulfilled' ? activeMinutes.value : null,
                hrv: hrv.status === 'fulfilled' ? hrv.value : null,
                bodyFat: bodyFat.status === 'fulfilled' ? bodyFat.value : null,
                height: height.status === 'fulfilled' ? height.value : null,
                hydration: hydration.status === 'fulfilled' ? hydration.value : null,
                bloodPressure: bloodPressure.status === 'fulfilled' ? bloodPressure.value : null,
                bloodGlucose: bloodGlucose.status === 'fulfilled' ? bloodGlucose.value : null,
                oxygenSaturation: oxygenSaturation.status === 'fulfilled' ? oxygenSaturation.value : null,
                syncTimestamp: Date.now(),
                source: 'google_fit'
            };
            
            console.log('Health data collected:', healthData);
            
            // Converti in formato TOON
            const toonData = healthTOONEncoder.fromGoogleFit(healthData);
            
            // Salva in Firestore
            await firestoreService.saveHealthData(toonData);
            
            console.log('Health data saved successfully');
            
            return {
                success: true,
                data: toonData,
                message: 'Dati sincronizzati con successo'
            };
        } catch (error) {
            console.error('Error syncing health data:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Fetch passi
     */
    async fetchSteps(startTime, endTime) {
        const data = await this.fetchGoogleFitData('steps', startTime, endTime);
        const totalSteps = data.point?.reduce((sum, point) => {
            return sum + (point.value?.[0]?.intVal || 0);
        }, 0) || 0;
        return totalSteps;
    }

    /**
     * Fetch frequenza cardiaca
     */
    async fetchHeartRate(startTime, endTime) {
        const data = await this.fetchGoogleFitData('heartRate', startTime, endTime);
        const hrValues = data.point?.map(p => p.value?.[0]?.fpVal).filter(v => v) || [];
        if (hrValues.length === 0) return null;
        const avgHR = hrValues.reduce((a, b) => a + b, 0) / hrValues.length;
        return Math.round(avgHR);
    }

    /**
     * Fetch peso
     */
    async fetchWeight(startTime, endTime) {
        const data = await this.fetchGoogleFitData('weight', startTime, endTime);
        const weights = data.point?.map(p => p.value?.[0]?.fpVal).filter(v => v) || [];
        if (weights.length === 0) return null;
        return weights[weights.length - 1]; // Ultimo peso registrato
    }

    /**
     * Fetch calorie
     */
    async fetchCalories(startTime, endTime) {
        const data = await this.fetchGoogleFitData('calories', startTime, endTime);
        const totalCalories = data.point?.reduce((sum, point) => {
            return sum + (point.value?.[0]?.fpVal || 0);
        }, 0) || 0;
        return Math.round(totalCalories);
    }

    /**
     * Fetch distanza
     */
    async fetchDistance(startTime, endTime) {
        const data = await this.fetchGoogleFitData('distance', startTime, endTime);
        const totalDistance = data.point?.reduce((sum, point) => {
            return sum + (point.value?.[0]?.fpVal || 0);
        }, 0) || 0;
        return totalDistance; // In metri
    }

    /**
     * Fetch sonno (media giornaliera)
     */
    async fetchSleep(startTime, endTime) {
        const data = await this.fetchGoogleFitData('sleep', startTime, endTime);
        
        // Raggruppa i segmenti di sonno per giorno
        const sleepByDay = {};
        
        data.point?.forEach(point => {
            const start = parseInt(point.startTimeNanos) / 1000000;
            const end = parseInt(point.endTimeNanos) / 1000000;
            const duration = (end - start) / (1000 * 60); // minuti
            
            // Usa la data di inizio del segmento come chiave
            const dayKey = new Date(start).toISOString().split('T')[0];
            
            if (!sleepByDay[dayKey]) {
                sleepByDay[dayKey] = 0;
            }
            sleepByDay[dayKey] += duration;
        });
        
        // Calcola la media giornaliera
        const days = Object.keys(sleepByDay);
        if (days.length === 0) return 0;
        
        const totalMinutes = Object.values(sleepByDay).reduce((sum, min) => sum + min, 0);
        const avgMinutes = totalMinutes / days.length;
        
        return Math.round(avgMinutes / 60 * 10) / 10; // Converti in ore con 1 decimale
    }

    /**
     * Fetch minuti attivi
     */
    async fetchActiveMinutes(startTime, endTime) {
        const data = await this.fetchGoogleFitData('activeMinutes', startTime, endTime);
        const totalMinutes = data.point?.reduce((sum, point) => {
            return sum + (point.value?.[0]?.intVal || 0);
        }, 0) || 0;
        return totalMinutes;
    }

    /**
     * Fetch HRV (Heart Rate Variability)
     */
    async fetchHRV(startTime, endTime) {
        const data = await this.fetchGoogleFitData('hrv', startTime, endTime);
        const hrvValues = data.point?.map(p => p.value?.[0]?.fpVal).filter(v => v) || [];
        if (hrvValues.length === 0) return null;
        const avgHRV = hrvValues.reduce((a, b) => a + b, 0) / hrvValues.length;
        return Math.round(avgHRV * 10) / 10; // 1 decimale
    }

    /**
     * Fetch percentuale grasso corporeo
     */
    async fetchBodyFat(startTime, endTime) {
        const data = await this.fetchGoogleFitData('bodyFat', startTime, endTime);
        const bodyFatValues = data.point?.map(p => p.value?.[0]?.fpVal).filter(v => v) || [];
        if (bodyFatValues.length === 0) return null;
        return bodyFatValues[bodyFatValues.length - 1]; // Ultimo valore registrato
    }

    /**
     * Fetch altezza
     */
    async fetchHeight(startTime, endTime) {
        const data = await this.fetchGoogleFitData('height', startTime, endTime);
        const heights = data.point?.map(p => p.value?.[0]?.fpVal).filter(v => v) || [];
        if (heights.length === 0) return null;
        return heights[heights.length - 1]; // Ultimo valore (in metri)
    }

    /**
     * Fetch idratazione
     */
    async fetchHydration(startTime, endTime) {
        const data = await this.fetchGoogleFitData('hydration', startTime, endTime);
        const totalHydration = data.point?.reduce((sum, point) => {
            return sum + (point.value?.[0]?.fpVal || 0);
        }, 0) || 0;
        return Math.round(totalHydration * 1000); // Converti in ml
    }

    /**
     * Fetch pressione sanguigna
     */
    async fetchBloodPressure(startTime, endTime) {
        const data = await this.fetchGoogleFitData('bloodPressure', startTime, endTime);
        if (!data.point || data.point.length === 0) return null;
        
        // Prendi l'ultima misurazione
        const lastPoint = data.point[data.point.length - 1];
        return {
            systolic: lastPoint.value?.[0]?.fpVal || null, // Sistolica
            diastolic: lastPoint.value?.[1]?.fpVal || null // Diastolica
        };
    }

    /**
     * Fetch glicemia
     */
    async fetchBloodGlucose(startTime, endTime) {
        const data = await this.fetchGoogleFitData('bloodGlucose', startTime, endTime);
        const glucoseValues = data.point?.map(p => p.value?.[0]?.fpVal).filter(v => v) || [];
        if (glucoseValues.length === 0) return null;
        const avgGlucose = glucoseValues.reduce((a, b) => a + b, 0) / glucoseValues.length;
        return Math.round(avgGlucose); // mg/dL
    }

    /**
     * Fetch saturazione ossigeno (SpO2)
     */
    async fetchOxygenSaturation(startTime, endTime) {
        const data = await this.fetchGoogleFitData('oxygenSaturation', startTime, endTime);
        const spo2Values = data.point?.map(p => p.value?.[0]?.fpVal).filter(v => v) || [];
        if (spo2Values.length === 0) return null;
        const avgSpO2 = spo2Values.reduce((a, b) => a + b, 0) / spo2Values.length;
        return Math.round(avgSpO2 * 10) / 10; // Percentuale con 1 decimale
    }

    /**
     * Disconnetti Google Fit
     */
    async disconnect() {
        // Revoca token
        if (this.accessToken) {
            try {
                await fetch(`https://oauth2.googleapis.com/revoke?token=${this.accessToken}`, {
                    method: 'POST'
                });
            } catch (error) {
                console.error('Error revoking token:', error);
            }
        }
        
        // Pulisci dati locali
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        this.isConnected = false;
        
        // Rimuovi da Firestore
        await firestoreService.removeHealthToken();
        
        return { success: true, message: 'Disconnesso da Google Fit' };
    }

    /**
     * Salva token in Firestore (encrypted)
     */
    async saveToken() {
        const tokenData = {
            accessToken: this.accessToken,
            refreshToken: this.refreshToken,
            tokenExpiry: this.tokenExpiry,
            updatedAt: Date.now()
        };
        
        await firestoreService.saveHealthToken(tokenData);
    }

    /**
     * Carica token salvato
     */
    async loadSavedToken() {
        try {
            const tokenData = await firestoreService.getHealthToken();
            if (tokenData) {
                this.accessToken = tokenData.accessToken;
                this.refreshToken = tokenData.refreshToken;
                this.tokenExpiry = tokenData.expiryDate || tokenData.tokenExpiry; // Usa expiryDate dalla Firebase Function
                
                // Verifica se il token è ancora valido
                if (this.tokenExpiry && this.tokenExpiry > Date.now()) {
                    this.isConnected = true;
                    console.log('Health token loaded successfully, expires:', new Date(this.tokenExpiry));
                } else {
                    console.log('Health token expired, needs refresh');
                    this.isConnected = false;
                }
            } else {
                this.isConnected = false;
            }
        } catch (error) {
            console.error('Error loading saved token:', error);
            this.isConnected = false;
        }
    }

    /**
     * Get status connessione (async per assicurarsi che i token siano caricati)
     */
    async getStatus() {
        // Se non abbiamo ancora caricato i token, caricali ora
        if (!this.tokenLoadPromise && !this.accessToken) {
            this.tokenLoadPromise = this.loadSavedToken();
        }
        
        // Aspetta che il caricamento sia completato
        if (this.tokenLoadPromise) {
            await this.tokenLoadPromise;
            this.tokenLoadPromise = null;
        }
        
        return {
            isConnected: this.isConnected,
            hasToken: !!this.accessToken,
            tokenExpiry: this.tokenExpiry,
            tokenValid: this.tokenExpiry && this.tokenExpiry > Date.now()
        };
    }

    /**
     * Get dati health per AI context
     */
    async getHealthDataForAI(days = 7) {
        try {
            const healthData = await firestoreService.getHealthData(days);
            if (!healthData || healthData.length === 0) {
                return null;
            }
            
            // Crea summary TOON per AI
            const summary = healthTOONEncoder.createAISummary(healthData, days);
            
            return summary;
        } catch (error) {
            console.error('Error getting health data for AI:', error);
            return null;
        }
    }
}

// Export singleton
export const healthConnectService = new HealthConnectService();
