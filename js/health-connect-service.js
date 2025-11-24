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
        this.autoRefreshInterval = null;

        // Base URL Google Fit API
        this.apiBase = 'https://www.googleapis.com/fitness/v1/users/me';

        // Avvia auto-refresh proattivo del token
        this.startAutoRefresh();
    }

    /**
     * Avvia il sistema di auto-refresh proattivo del token
     * Controlla ogni 5 minuti se il token sta per scadere e lo refresha automaticamente
     */
    startAutoRefresh() {
        // Pulisci eventuali interval esistenti
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }

        // Controlla ogni 5 minuti
        this.autoRefreshInterval = setInterval(async () => {
            try {
                // Se non siamo connessi, salta
                if (!this.isConnected || !this.accessToken) {
                    return;
                }

                // Se il token scade tra meno di 15 minuti, refresha
                if (this.tokenExpiry && this.tokenExpiry - Date.now() < 15 * 60 * 1000) {
                    console.log('Auto-refresh: Token expiring soon, refreshing proactively...');
                    await this.refreshAccessToken();
                }
            } catch (error) {
                console.error('Auto-refresh error:', error);
            }
        }, 5 * 60 * 1000); // Ogni 5 minuti

        console.log('Auto-refresh system started (checks every 5 minutes)');
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
            `access_type=offline&` + // CRITICO: Necessario per refresh_token
            `prompt=consent&` + // CRITICO: Forza consent per ottenere refresh_token ogni volta
            `include_granted_scopes=true`; // Include scopes già garantiti

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
            console.log('Refreshing access token...');

            // Importa Firebase Functions
            const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js');
            const functions = getFunctions();

            // Chiama la Firebase Function per refresh
            const refreshToken = httpsCallable(functions, 'refreshHealthToken');
            const result = await refreshToken();

            if (result.data.success) {
                this.accessToken = result.data.accessToken;
                this.tokenExpiry = result.data.expiryDate;

                const minutesUntilExpiry = Math.round((this.tokenExpiry - Date.now()) / (60 * 1000));
                console.log(`✅ Token refreshed successfully! New expiry in ${minutesUntilExpiry} minutes (${new Date(this.tokenExpiry).toLocaleString()})`);

                return true;
            } else {
                throw new Error(result.data.message || 'Failed to refresh token');
            }
        } catch (error) {
            console.error('❌ Error refreshing token:', error);

            // Se il refresh fallisce, potrebbe essere che il refresh token sia scaduto
            // In questo caso, l'utente deve riconnettersi
            if (error.message.includes('invalid_grant') || error.message.includes('Token has been expired or revoked')) {
                console.error('Refresh token expired or revoked. User needs to reconnect.');
                this.isConnected = false;
                // Pulisci i token locali
                this.accessToken = null;
                this.refreshToken = null;
                this.tokenExpiry = null;
            }

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

        // Se il token scade tra meno di 10 minuti, refresh automatico (aumentato da 5 a 10 per maggiore sicurezza)
        if (this.tokenExpiry && this.tokenExpiry - Date.now() < 10 * 60 * 1000) {
            console.log('Token expiring soon, refreshing...');
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
     * Avvia la sincronizzazione periodica (Background Sync simulato)
     */
    startPeriodicSync(intervalMinutes = 240) { // Default 4 ore
        console.log(`Starting periodic health sync every ${intervalMinutes} minutes`);

        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }

        this.syncInterval = setInterval(async () => {
            if (this.isConnected) {
                console.log('Running periodic health sync...');
                await this.syncAllData();
            }
        }, intervalMinutes * 60 * 1000);
    }

    /**
     * Ferma la sincronizzazione periodica
     */
    stopPeriodicSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    /**
     * Sincronizza tutti i dati health
     */
    async syncAllData() {
        try {
            console.log(`Starting health data sync for TODAY`);

            const now = new Date();
            const endTime = now.getTime();
            const endNanos = endTime * 1000000;

            // 1. Time range per metriche giornaliere (Passi, Calorie, etc.) - Inizio di OGGI
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            const todayStartNanos = todayStart.getTime() * 1000000;

            // 2. Time range per metriche di stato (Peso, Altezza) - Ultimi 30 giorni
            // Serve per trovare l'ultimo valore registrato anche se non è di oggi
            const stateStart = new Date(now);
            stateStart.setDate(stateStart.getDate() - 30);
            const stateStartNanos = stateStart.getTime() * 1000000;

            console.log('Syncing daily metrics from:', todayStart.toLocaleString());
            console.log('Syncing state metrics from:', stateStart.toLocaleString());

            // Fetch tutti i tipi di dati (base + aggiuntivi)
            const [
                steps, heartRate, weight, calories, distance, sleep,
                activeMinutes, hrv, bodyFat, height, hydration,
                bloodPressure, bloodGlucose, oxygenSaturation
            ] = await Promise.allSettled([
                // Dati base
                this.fetchSteps(todayStartNanos, endNanos),
                this.fetchHeartRate(todayStartNanos, endNanos),
                this.fetchWeight(stateStartNanos, endNanos), // State metric
                this.fetchCalories(todayStartNanos, endNanos),
                this.fetchDistance(todayStartNanos, endNanos),
                this.fetchSleep(todayStartNanos, endNanos),
                // Dati aggiuntivi
                this.fetchActiveMinutes(todayStartNanos, endNanos),
                this.fetchHRV(todayStartNanos, endNanos),
                this.fetchBodyFat(stateStartNanos, endNanos), // State metric
                this.fetchHeight(stateStartNanos, endNanos), // State metric
                this.fetchHydration(todayStartNanos, endNanos),
                this.fetchBloodPressure(todayStartNanos, endNanos),
                this.fetchBloodGlucose(todayStartNanos, endNanos),
                this.fetchOxygenSaturation(todayStartNanos, endNanos)
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
     * Fetch passi - ULTRA PRECISO
     * Somma tutti i delta di passi nel periodo, gestendo correttamente i duplicati
     */
    async fetchSteps(startTime, endTime) {
        const data = await this.fetchGoogleFitData('steps', startTime, endTime);

        if (!data.point || data.point.length === 0) {
            console.log('No steps data available');
            return 0;
        }

        // Google Fit può avere dati duplicati da diverse fonti (phone, watch, etc.)
        // Usiamo un set per tracciare i timestamp e evitare duplicati
        const stepsByTimestamp = new Map();

        data.point.forEach(point => {
            const steps = point.value?.[0]?.intVal || 0;
            const startNanos = point.startTimeNanos;
            const endNanos = point.endTimeNanos;

            // Crea una chiave unica per questo intervallo temporale
            const key = `${startNanos}-${endNanos}`;

            // Se abbiamo già dati per questo intervallo, prendi il valore più alto
            // (Google Fit a volte ha stime multiple, prendiamo la più accurata)
            if (stepsByTimestamp.has(key)) {
                const existing = stepsByTimestamp.get(key);
                stepsByTimestamp.set(key, Math.max(existing, steps));
            } else {
                stepsByTimestamp.set(key, steps);
            }
        });

        // Somma tutti i passi unici
        const totalSteps = Array.from(stepsByTimestamp.values()).reduce((sum, steps) => sum + steps, 0);

        console.log(`Total steps: ${totalSteps.toLocaleString()} (${stepsByTimestamp.size} unique intervals, ${data.point.length} total data points)`);

        return totalSteps;
    }

    /**
     * Fetch frequenza cardiaca - ULTRA PRECISO
     * Calcola la media ponderata escludendo outliers (valori anomali)
     */
    async fetchHeartRate(startTime, endTime) {
        const data = await this.fetchGoogleFitData('heartRate', startTime, endTime);

        if (!data.point || data.point.length === 0) {
            console.log('No heart rate data available');
            return null;
        }

        // Estrai tutti i valori validi
        const hrValues = data.point
            .map(p => p.value?.[0]?.fpVal)
            .filter(v => v && v > 30 && v < 220); // Filtra valori fisiologicamente validi (30-220 bpm)

        if (hrValues.length === 0) {
            console.log('No valid heart rate values found');
            return null;
        }

        // Rimuovi outliers usando metodo IQR (Interquartile Range)
        const sorted = [...hrValues].sort((a, b) => a - b);
        const q1Index = Math.floor(sorted.length * 0.25);
        const q3Index = Math.floor(sorted.length * 0.75);
        const q1 = sorted[q1Index];
        const q3 = sorted[q3Index];
        const iqr = q3 - q1;
        const lowerBound = q1 - 1.5 * iqr;
        const upperBound = q3 + 1.5 * iqr;

        // Filtra outliers
        const filteredValues = hrValues.filter(v => v >= lowerBound && v <= upperBound);

        if (filteredValues.length === 0) {
            console.log('All heart rate values were outliers, using original data');
            // Fallback: usa tutti i valori se il filtro è troppo aggressivo
            const avgHR = hrValues.reduce((a, b) => a + b, 0) / hrValues.length;
            console.log(`Heart rate average: ${Math.round(avgHR)} bpm (${hrValues.length} readings, no filtering)`);
            return Math.round(avgHR);
        }

        // Calcola media
        const avgHR = filteredValues.reduce((a, b) => a + b, 0) / filteredValues.length;

        console.log(`Heart rate average: ${Math.round(avgHR)} bpm (${filteredValues.length}/${hrValues.length} readings after outlier removal)`);

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
     * Fetch sonno (media giornaliera) - ULTRA PRECISO
     * Google Fit registra segmenti di sonno con diversi tipi (light, deep, REM, awake)
     * Contiamo solo i segmenti di sonno effettivo (escludendo awake)
     */
    async fetchSleep(startTime, endTime) {
        const data = await this.fetchGoogleFitData('sleep', startTime, endTime);

        if (!data.point || data.point.length === 0) {
            console.log('No sleep data available');
            return 0;
        }

        // Raggruppa i segmenti di sonno per giorno
        const sleepByDay = {};

        // Sleep segment types da Google Fit:
        // 1 = awake (sveglio - NON contare)
        // 2 = sleep (sonno generico)
        // 3 = out-of-bed (fuori dal letto - NON contare)
        // 4 = light sleep (sonno leggero)
        // 5 = deep sleep (sonno profondo)
        // 6 = REM sleep (sonno REM)

        const SLEEP_TYPES = [2, 4, 5, 6]; // Solo sonno effettivo

        data.point?.forEach(point => {
            const sleepType = point.value?.[0]?.intVal;

            // Salta segmenti non-sonno (awake, out-of-bed)
            if (!SLEEP_TYPES.includes(sleepType)) {
                return;
            }

            const start = parseInt(point.startTimeNanos) / 1000000;
            const end = parseInt(point.endTimeNanos) / 1000000;
            const durationMinutes = (end - start) / (1000 * 60);

            // Usa la data di fine del segmento come chiave (formato YYYY-MM-DD)
            // Questo attribuisce il sonno al giorno in cui ci si sveglia (standard per fitness tracker)
            const dayKey = new Date(end).toISOString().split('T')[0];

            if (!sleepByDay[dayKey]) {
                sleepByDay[dayKey] = {
                    totalMinutes: 0,
                    segments: []
                };
            }

            sleepByDay[dayKey].totalMinutes += durationMinutes;
            sleepByDay[dayKey].segments.push({
                type: sleepType,
                start: new Date(start).toISOString(),
                end: new Date(end).toISOString(),
                minutes: Math.round(durationMinutes)
            });
        });

        // Log dettagliato per debug
        console.log('Sleep data by day:', Object.entries(sleepByDay).map(([day, data]) => ({
            day,
            hours: (data.totalMinutes / 60).toFixed(1),
            segments: data.segments.length
        })));

        // Calcola la media giornaliera solo sui giorni con dati
        const days = Object.keys(sleepByDay);
        if (days.length === 0) {
            console.log('No valid sleep days found');
            return 0;
        }

        const totalMinutes = Object.values(sleepByDay).reduce((sum, data) => sum + data.totalMinutes, 0);
        const avgMinutes = totalMinutes / days.length;
        const avgHours = avgMinutes / 60;

        console.log(`Sleep average: ${avgHours.toFixed(1)} hours/night (${days.length} days with data)`);

        return Math.round(avgHours * 10) / 10; // Ore con 1 decimale
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
     * Carica token salvato e refresha automaticamente se scaduto
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
                    const minutesUntilExpiry = Math.round((this.tokenExpiry - Date.now()) / (60 * 1000));
                    console.log(`Health token loaded successfully, expires in ${minutesUntilExpiry} minutes (${new Date(this.tokenExpiry).toLocaleString()})`);

                    // Se scade tra meno di 20 minuti, refresha subito
                    if (minutesUntilExpiry < 20) {
                        console.log('Token expiring soon, refreshing immediately...');
                        try {
                            await this.refreshAccessToken();
                        } catch (refreshError) {
                            console.error('Failed to refresh token on load:', refreshError);
                            this.isConnected = false;
                        }
                    }
                } else {
                    console.log('Health token expired, attempting refresh...');
                    // Token scaduto, prova a refreshare
                    if (this.refreshToken) {
                        try {
                            await this.refreshAccessToken();
                            this.isConnected = true;
                            console.log('Token refreshed successfully after expiry');
                        } catch (refreshError) {
                            console.error('Failed to refresh expired token:', refreshError);
                            this.isConnected = false;
                        }
                    } else {
                        console.log('No refresh token available, user needs to reconnect');
                        this.isConnected = false;
                    }
                }
            } else {
                console.log('No saved token found');
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
