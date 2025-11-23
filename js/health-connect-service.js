/**
 * Health Connect Service
 * Gestisce l'integrazione con Google Fit API per sincronizzazione dati salute
 */

import { healthTOONEncoder } from './health-toon-encoder.js';
import { firestoreService } from './firestore-service.js';

class HealthConnectService {
    constructor() {
        // Configurazione OAuth Google
        this.clientId = 'YOUR_GOOGLE_CLIENT_ID'; // Da configurare
        this.redirectUri = window.location.origin + '/auth/callback';
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
        
        // Base URL Google Fit API
        this.apiBase = 'https://www.googleapis.com/fitness/v1/users/me';
        
        // Carica token salvato
        this.loadSavedToken();
    }

    /**
     * Inizia il flusso OAuth per connettere Google Fit
     */
    async connect() {
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
            `client_id=${this.clientId}&` +
            `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
            `response_type=code&` +
            `scope=${encodeURIComponent(this.scopes)}&` +
            `access_type=offline&` +
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
                    popup.close();
                    await this.handleAuthCode(event.data.code);
                    resolve(true);
                } else if (event.data.type === 'oauth_error') {
                    popup.close();
                    reject(new Error(event.data.error));
                }
            }, { once: true });
        });
    }

    /**
     * Gestisce il codice di autorizzazione OAuth
     */
    async handleAuthCode(code) {
        try {
            // Scambia il code per access token
            // NOTA: Questo dovrebbe essere fatto server-side per sicurezza
            // Per ora usiamo un approccio client-side semplificato
            
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    code: code,
                    client_id: this.clientId,
                    client_secret: 'YOUR_CLIENT_SECRET', // Da configurare (meglio server-side)
                    redirect_uri: this.redirectUri,
                    grant_type: 'authorization_code'
                })
            });
            
            const data = await response.json();
            
            if (data.access_token) {
                this.accessToken = data.access_token;
                this.refreshToken = data.refresh_token;
                this.tokenExpiry = Date.now() + (data.expires_in * 1000);
                this.isConnected = true;
                
                // Salva token in Firestore (encrypted)
                await this.saveToken();
                
                // Prima sincronizzazione
                await this.syncAllData();
                
                return true;
            }
            
            throw new Error('Failed to get access token');
        } catch (error) {
            console.error('Error handling auth code:', error);
            throw error;
        }
    }

    /**
     * Refresh access token quando scade
     */
    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No refresh token available');
        }
        
        try {
            const response = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    refresh_token: this.refreshToken,
                    client_id: this.clientId,
                    client_secret: 'YOUR_CLIENT_SECRET',
                    grant_type: 'refresh_token'
                })
            });
            
            const data = await response.json();
            
            if (data.access_token) {
                this.accessToken = data.access_token;
                this.tokenExpiry = Date.now() + (data.expires_in * 1000);
                await this.saveToken();
                return true;
            }
            
            throw new Error('Failed to refresh token');
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
        
        // Se il token scade tra meno di 5 minuti, refresh
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
        
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${this.accessToken}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Google Fit API error: ${response.statusText}`);
        }
        
        return await response.json();
    }

    /**
     * Get data source ID per tipo di dato
     */
    getDataSourceId(dataType) {
        const sources = {
            steps: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
            heartRate: 'derived:com.google.heart_rate.bpm:com.google.android.gms:merge_heart_rate_bpm',
            weight: 'derived:com.google.weight:com.google.android.gms:merge_weight',
            calories: 'derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended',
            distance: 'derived:com.google.distance.delta:com.google.android.gms:merge_distance_delta',
            sleep: 'derived:com.google.sleep.segment:com.google.android.gms:merged'
        };
        
        return sources[dataType] || dataType;
    }

    /**
     * Sincronizza tutti i dati health
     */
    async syncAllData(days = 7) {
        try {
            const endTime = Date.now();
            const startTime = endTime - (days * 24 * 60 * 60 * 1000);
            
            // Converti in nanosecondi (formato Google Fit)
            const startNanos = startTime * 1000000;
            const endNanos = endTime * 1000000;
            
            // Fetch tutti i tipi di dati
            const [steps, heartRate, weight, calories, distance, sleep] = await Promise.allSettled([
                this.fetchSteps(startNanos, endNanos),
                this.fetchHeartRate(startNanos, endNanos),
                this.fetchWeight(startNanos, endNanos),
                this.fetchCalories(startNanos, endNanos),
                this.fetchDistance(startNanos, endNanos),
                this.fetchSleep(startNanos, endNanos)
            ]);
            
            // Processa risultati
            const healthData = {
                steps: steps.status === 'fulfilled' ? steps.value : null,
                heartRate: heartRate.status === 'fulfilled' ? heartRate.value : null,
                weight: weight.status === 'fulfilled' ? weight.value : null,
                calories: calories.status === 'fulfilled' ? calories.value : null,
                distance: distance.status === 'fulfilled' ? distance.value : null,
                sleep: sleep.status === 'fulfilled' ? sleep.value : null,
                syncTimestamp: Date.now(),
                source: 'google_fit'
            };
            
            // Converti in formato TOON
            const toonData = healthTOONEncoder.fromGoogleFit(healthData);
            
            // Salva in Firestore
            await firestoreService.saveHealthData(toonData);
            
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
     * Fetch sonno
     */
    async fetchSleep(startTime, endTime) {
        const data = await this.fetchGoogleFitData('sleep', startTime, endTime);
        const sleepMinutes = data.point?.reduce((sum, point) => {
            const start = parseInt(point.startTimeNanos) / 1000000;
            const end = parseInt(point.endTimeNanos) / 1000000;
            return sum + ((end - start) / (1000 * 60));
        }, 0) || 0;
        return Math.round(sleepMinutes / 60 * 10) / 10; // Converti in ore con 1 decimale
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
                this.tokenExpiry = tokenData.tokenExpiry;
                this.isConnected = true;
            }
        } catch (error) {
            console.error('Error loading saved token:', error);
        }
    }

    /**
     * Get status connessione
     */
    getStatus() {
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
