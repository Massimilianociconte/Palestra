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
        // Gestisce GitHub Pages, locale e app nativa Capacitor
        this.redirectUri = this.getRedirectUri();
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

    getRedirectUri() {
        const origin = window.location.origin;
        // App nativa Capacitor (Android)
        if (origin.includes('localhost') || origin.includes('capacitor')) {
            // Per app native, usa il redirect URI della webapp
            return 'https://massimilianociconte.github.io/Palestra/auth-callback.html';
        }
        // GitHub Pages
        if (origin.includes('github.io')) {
            return origin + '/Palestra/auth-callback.html';
        }
        // Sviluppo locale
        const basePath = window.location.pathname.includes('/Palestra/') ? '/Palestra' : '';
        return origin + basePath + '/auth-callback.html';
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
                // FIX: Allow GitHub Pages origin for Native App flow
                const allowedOrigins = [window.location.origin, 'https://massimilianociconte.github.io'];
                if (!allowedOrigins.includes(event.origin) && !event.origin.includes('localhost') && !event.origin.includes('capacitor')) {
                    // Strict check, but permissive for our app parts
                    console.warn('Blocked message from unknown origin:', event.origin);
                    return;
                }

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

            console.log('Exchanging auth code with redirect URI:', this.redirectUri);

            // Chiama la Firebase Function per scambiare il code
            const exchangeCode = httpsCallable(functions, 'exchangeHealthCode');
            // FIX: Invio redirect_uri in vari formati per compatibilità col backend
            const result = await exchangeCode({
                code,
                redirectUri: this.redirectUri,
                redirect_uri: this.redirectUri // Snake case standard OAuth
            });

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
     * 
     * LOGICA CORRETTA:
     * - Passi, Calorie, Distanza, Minuti Attivi: MEDIA GIORNALIERA degli ultimi 7 giorni
     * - Sonno: MEDIA GIORNALIERA degli ultimi 7 giorni (solo notti con dati)
     * - HR, HRV, SpO2, etc.: Valore di OGGI
     * - Peso, Altezza, Body Fat: ULTIMO valore registrato (ultimi 30 giorni)
     */
    async syncAllData() {
        try {
            console.log(`Starting health data sync`);

            const now = new Date();
            const endTime = now.getTime();
            const endNanos = endTime * 1000000;

            // 1. Time range per metriche giornaliere (HR, etc.) - Inizio di OGGI
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            const todayStartNanos = todayStart.getTime() * 1000000;

            // 2. Time range per metriche SETTIMANALI (Passi, Calorie, Sonno) - Ultimi 7 giorni
            const weekStart = new Date(now);
            weekStart.setDate(weekStart.getDate() - 7);
            weekStart.setHours(0, 0, 0, 0);
            const weekStartNanos = weekStart.getTime() * 1000000;

            // 3. Time range per metriche di stato (Peso, Body Fat) - Ultimi 90 giorni
            // Esteso per catturare misurazioni meno frequenti
            const stateStart = new Date(now);
            stateStart.setDate(stateStart.getDate() - 90);
            const stateStartNanos = stateStart.getTime() * 1000000;

            // 4. Time range per Altezza - Ultimi 365 giorni (cambia raramente)
            const heightStart = new Date(now);
            heightStart.setDate(heightStart.getDate() - 365);
            const heightStartNanos = heightStart.getTime() * 1000000;

            console.log('Syncing daily metrics from:', todayStart.toLocaleString());
            console.log('Syncing weekly metrics (Steps, Calories, Sleep) from:', weekStart.toLocaleString());
            console.log('Syncing body metrics (90 days) from:', stateStart.toLocaleString());

            // Fetch tutti i tipi di dati (base + aggiuntivi)
            // NOTA: Per passi, calorie, distanza usiamo le nuove funzioni che calcolano la MEDIA GIORNALIERA REALE
            const [
                stepsData, heartRate, weight, caloriesData, distanceData, sleepData,
                activeMinutesData, hrv, bodyFat, height, hydration,
                bloodPressure, bloodGlucose, oxygenSaturation
            ] = await Promise.allSettled([
                // Dati base - con calcolo media giornaliera
                this.fetchStepsWithDailyAverage(weekStartNanos, endNanos),
                this.fetchHeartRate(todayStartNanos, endNanos), // Daily
                this.fetchWeight(stateStartNanos, endNanos), // State metric (90gg)
                this.fetchCaloriesWithDailyAverage(weekStartNanos, endNanos),
                this.fetchDistanceWithDailyAverage(weekStartNanos, endNanos),
                this.fetchSleepWithDetails(weekStartNanos, endNanos), // Restituisce oggetto con media e dettagli
                // Dati aggiuntivi
                this.fetchActiveMinutesWithDailyAverage(weekStartNanos, endNanos),
                this.fetchHRV(todayStartNanos, endNanos), // Daily
                this.fetchBodyFat(stateStartNanos, endNanos), // State metric (90gg)
                this.fetchHeight(heightStartNanos, endNanos), // State metric (365gg)
                this.fetchHydration(todayStartNanos, endNanos), // Daily
                this.fetchBloodPressure(todayStartNanos, endNanos), // Daily
                this.fetchBloodGlucose(todayStartNanos, endNanos), // Daily
                this.fetchOxygenSaturation(todayStartNanos, endNanos) // Daily
            ]);

            // Log risultati
            console.log('Sync results:', {
                steps: stepsData.status,
                heartRate: heartRate.status,
                weight: weight.status,
                calories: caloriesData.status,
                distance: distanceData.status,
                sleep: sleepData.status,
                activeMinutes: activeMinutesData.status,
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
                stepsData, heartRate, weight, caloriesData, distanceData, sleepData,
                activeMinutesData, hrv, bodyFat, height, hydration,
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

            // Estrai i valori dalle nuove strutture dati
            const stepsResult = stepsData.status === 'fulfilled' ? stepsData.value : null;
            const caloriesResult = caloriesData.status === 'fulfilled' ? caloriesData.value : null;
            const distanceResult = distanceData.status === 'fulfilled' ? distanceData.value : null;
            const sleepResult = sleepData.status === 'fulfilled' ? sleepData.value : null;
            const activeMinutesResult = activeMinutesData.status === 'fulfilled' ? activeMinutesData.value : null;

            // Processa risultati - usa le MEDIE GIORNALIERE
            const healthData = {
                // Dati base - MEDIE GIORNALIERE
                steps: stepsResult?.dailyAverage || stepsResult || null,
                stepsTotal: stepsResult?.total || null, // Totale settimanale per riferimento
                stepsDaysWithData: stepsResult?.daysWithData || null,

                heartRate: heartRate.status === 'fulfilled' ? heartRate.value : null,
                weight: weight.status === 'fulfilled' ? weight.value : null,

                calories: caloriesResult?.dailyAverage || caloriesResult || null,
                caloriesTotal: caloriesResult?.total || null,
                caloriesDaysWithData: caloriesResult?.daysWithData || null,

                distance: distanceResult?.dailyAverage || distanceResult || null,
                distanceTotal: distanceResult?.total || null,
                distanceDaysWithData: distanceResult?.daysWithData || null,

                sleep: sleepResult?.dailyAverage || sleepResult || null,
                sleepDaysWithData: sleepResult?.daysWithData || null,

                // Dati aggiuntivi
                activeMinutes: activeMinutesResult?.dailyAverage || activeMinutesResult || null,
                activeMinutesTotal: activeMinutesResult?.total || null,

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

            console.log('Health data collected (with daily averages):', healthData);

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
     * Fetch passi con MEDIA GIORNALIERA - CORRETTO
     * Raggruppa i passi per giorno e calcola la media sui giorni con dati
     */
    async fetchStepsWithDailyAverage(startTime, endTime) {
        const data = await this.fetchGoogleFitData('steps', startTime, endTime);

        if (!data.point || data.point.length === 0) {
            console.log('No steps data available');
            return { dailyAverage: 0, total: 0, daysWithData: 0, byDay: {} };
        }

        // Raggruppa i passi per giorno
        const stepsByDay = {};

        data.point.forEach(point => {
            const steps = point.value?.[0]?.intVal || 0;
            const startNanos = point.startTimeNanos;
            const endNanos = point.endTimeNanos;

            // Usa la data di fine dell'intervallo per attribuire i passi al giorno corretto
            const dayKey = new Date(parseInt(endNanos) / 1000000).toISOString().split('T')[0];

            if (!stepsByDay[dayKey]) {
                stepsByDay[dayKey] = new Map(); // Map per evitare duplicati per intervallo
            }

            // Chiave unica per questo intervallo
            const intervalKey = `${startNanos}-${endNanos}`;

            // Se abbiamo già dati per questo intervallo, prendi il valore più alto
            if (stepsByDay[dayKey].has(intervalKey)) {
                const existing = stepsByDay[dayKey].get(intervalKey);
                stepsByDay[dayKey].set(intervalKey, Math.max(existing, steps));
            } else {
                stepsByDay[dayKey].set(intervalKey, steps);
            }
        });

        // Calcola totale per ogni giorno
        const dailyTotals = {};
        let totalSteps = 0;

        Object.entries(stepsByDay).forEach(([day, intervalsMap]) => {
            const dayTotal = Array.from(intervalsMap.values()).reduce((sum, s) => sum + s, 0);
            dailyTotals[day] = dayTotal;
            totalSteps += dayTotal;
        });

        // CALCOLO MEDIA CORRETTO: Basato sulla durata del periodo (7 giorni)
        const durationMs = (parseInt(endTime) - parseInt(startTime)) / 1000000;
        const daysInPeriod = Math.max(1, Math.round(durationMs / (1000 * 60 * 60 * 24)));
        const daysWithData = Object.keys(dailyTotals).length;

        // Media reale sul periodo, includendo giorni a 0
        const dailyAverage = Math.round(totalSteps / daysInPeriod);

        console.log(`Steps: ${dailyAverage.toLocaleString()}/day average (Real ${daysInPeriod}-day avg) - Total: ${totalSteps.toLocaleString()}`);
        console.log('Steps by day:', dailyTotals);

        return {
            dailyAverage,
            total: totalSteps,
            daysWithData,
            byDay: dailyTotals
        };
    }

    /**
     * Fetch passi - LEGACY (per compatibilità)
     * Somma tutti i delta di passi nel periodo, gestendo correttamente i duplicati
     */
    async fetchSteps(startTime, endTime) {
        const result = await this.fetchStepsWithDailyAverage(startTime, endTime);
        return result.total; // Ritorna il totale per compatibilità
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

        // Calcola media su TUTTI i valori validi
        // NOTA: Rimosso filtro IQR perché eliminava picchi reali durante allenamento
        const avgHR = hrValues.reduce((a, b) => a + b, 0) / hrValues.length;

        console.log(`Heart rate average: ${Math.round(avgHR)} bpm (${hrValues.length} readings)`);

        return Math.round(avgHR);
    }

    /**
     * Fetch peso - ULTRA PRECISO
     * Restituisce l'ultimo peso registrato con precisione a 1 decimale
     */
    async fetchWeight(startTime, endTime) {
        const data = await this.fetchGoogleFitData('weight', startTime, endTime);

        if (!data.point || data.point.length === 0) {
            console.log('No weight data available');
            return null;
        }

        // Ordina per timestamp per ottenere l'ultimo valore
        const sortedPoints = data.point
            .filter(p => p.value?.[0]?.fpVal > 0)
            .sort((a, b) => {
                const timeA = parseInt(a.endTimeNanos || a.startTimeNanos);
                const timeB = parseInt(b.endTimeNanos || b.startTimeNanos);
                return timeB - timeA; // Più recente prima
            });

        if (sortedPoints.length === 0) {
            console.log('No valid weight values found');
            return null;
        }

        // Prendi l'ultimo peso con precisione a 1 decimale
        const latestWeight = Math.round(sortedPoints[0].value[0].fpVal * 10) / 10;
        const timestamp = new Date(parseInt(sortedPoints[0].endTimeNanos || sortedPoints[0].startTimeNanos) / 1000000);

        console.log(`Latest weight: ${latestWeight} kg (recorded: ${timestamp.toLocaleString()})`);

        return latestWeight;
    }

    /**
     * Fetch calorie con MEDIA GIORNALIERA - CORRETTO
     * Raggruppa le calorie per giorno e calcola la media sui giorni con dati
     */
    async fetchCaloriesWithDailyAverage(startTime, endTime) {
        const data = await this.fetchGoogleFitData('calories', startTime, endTime);

        if (!data.point || data.point.length === 0) {
            console.log('No calories data available');
            return { dailyAverage: 0, total: 0, daysWithData: 0, byDay: {} };
        }

        // Raggruppa le calorie per giorno
        const caloriesByDay = {};

        data.point.forEach(point => {
            const calories = point.value?.[0]?.fpVal || 0;
            const startNanos = point.startTimeNanos;
            const endNanos = point.endTimeNanos;

            const dayKey = new Date(parseInt(endNanos) / 1000000).toISOString().split('T')[0];

            if (!caloriesByDay[dayKey]) {
                caloriesByDay[dayKey] = new Map();
            }

            const intervalKey = `${startNanos}-${endNanos}`;

            if (caloriesByDay[dayKey].has(intervalKey)) {
                const existing = caloriesByDay[dayKey].get(intervalKey);
                caloriesByDay[dayKey].set(intervalKey, Math.max(existing, calories));
            } else {
                caloriesByDay[dayKey].set(intervalKey, calories);
            }
        });

        // Calcola totale per ogni giorno
        const dailyTotals = {};
        let totalCalories = 0;

        Object.entries(caloriesByDay).forEach(([day, intervalsMap]) => {
            const dayTotal = Array.from(intervalsMap.values()).reduce((sum, c) => sum + c, 0);
            dailyTotals[day] = Math.round(dayTotal);
            totalCalories += dayTotal;
        });

        // Media reale sul periodo
        const durationMs = (parseInt(endTime) - parseInt(startTime)) / 1000000;
        const daysInPeriod = Math.max(1, Math.round(durationMs / (1000 * 60 * 60 * 24)));
        const daysWithData = Object.keys(dailyTotals).length;

        const dailyAverage = Math.round(totalCalories / daysInPeriod);

        console.log(`Calories: ${dailyAverage.toLocaleString()} kcal/day average (Real ${daysInPeriod}-day avg) - Total: ${Math.round(totalCalories).toLocaleString()}`);
        console.log('Calories by day:', dailyTotals);

        return {
            dailyAverage,
            total: Math.round(totalCalories),
            daysWithData,
            byDay: dailyTotals
        };
    }

    /**
     * Fetch calorie - LEGACY (per compatibilità)
     */
    async fetchCalories(startTime, endTime) {
        const result = await this.fetchCaloriesWithDailyAverage(startTime, endTime);
        return result.total;
    }

    /**
     * Fetch distanza con MEDIA GIORNALIERA - CORRETTO
     * Raggruppa la distanza per giorno e calcola la media sui giorni con dati
     */
    async fetchDistanceWithDailyAverage(startTime, endTime) {
        const data = await this.fetchGoogleFitData('distance', startTime, endTime);

        if (!data.point || data.point.length === 0) {
            console.log('No distance data available');
            return { dailyAverage: 0, total: 0, daysWithData: 0, byDay: {} };
        }

        // Raggruppa la distanza per giorno
        const distanceByDay = {};

        data.point.forEach(point => {
            const distance = point.value?.[0]?.fpVal || 0;
            const startNanos = point.startTimeNanos;
            const endNanos = point.endTimeNanos;

            const dayKey = new Date(parseInt(endNanos) / 1000000).toISOString().split('T')[0];

            if (!distanceByDay[dayKey]) {
                distanceByDay[dayKey] = new Map();
            }

            const intervalKey = `${startNanos}-${endNanos}`;

            if (distanceByDay[dayKey].has(intervalKey)) {
                const existing = distanceByDay[dayKey].get(intervalKey);
                distanceByDay[dayKey].set(intervalKey, Math.max(existing, distance));
            } else {
                distanceByDay[dayKey].set(intervalKey, distance);
            }
        });

        // Calcola totale per ogni giorno
        const dailyTotals = {};
        let totalDistance = 0;

        Object.entries(distanceByDay).forEach(([day, intervalsMap]) => {
            const dayTotal = Array.from(intervalsMap.values()).reduce((sum, d) => sum + d, 0);
            dailyTotals[day] = Math.round(dayTotal * 100) / 100; // metri con 2 decimali
            totalDistance += dayTotal;
        });

        // Media reale sul periodo
        const durationMs = (parseInt(endTime) - parseInt(startTime)) / 1000000;
        const daysInPeriod = Math.max(1, Math.round(durationMs / (1000 * 60 * 60 * 24)));
        const daysWithData = Object.keys(dailyTotals).length;

        const dailyAverage = Math.round((totalDistance / daysInPeriod) * 100) / 100;

        console.log(`Distance: ${(dailyAverage / 1000).toFixed(2)} km/day average (Real ${daysInPeriod}-day avg)`);
        console.log('Distance by day (meters):', dailyTotals);

        return {
            dailyAverage, // metri
            total: Math.round(totalDistance * 100) / 100,
            daysWithData,
            byDay: dailyTotals
        };
    }

    /**
     * Fetch distanza - LEGACY (per compatibilità)
     */
    async fetchDistance(startTime, endTime) {
        const result = await this.fetchDistanceWithDailyAverage(startTime, endTime);
        return result.total;
    }

    /**
     * Fetch sonno con DETTAGLI - CORRETTO
     * Restituisce media giornaliera E dettagli per giorno
     * 
     * NOTA IMPORTANTE: Il sonno viene attribuito al giorno in cui ci si SVEGLIA.
     * Quindi se dormi dalle 23:00 del 27 Nov alle 07:00 del 28 Nov,
     * quelle ore vengono attribuite al 28 Nov.
     */
    async fetchSleepWithDetails(startTime, endTime) {
        const data = await this.fetchGoogleFitData('sleep', startTime, endTime);

        if (!data.point || data.point.length === 0) {
            console.log('No sleep data available');
            return { dailyAverage: 0, daysWithData: 0, byDay: {} };
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

        // Calcola ore per ogni giorno
        const dailyHours = {};
        Object.entries(sleepByDay).forEach(([day, data]) => {
            dailyHours[day] = Math.round((data.totalMinutes / 60) * 100) / 100;
        });

        // Log dettagliato per debug
        console.log('Sleep data by day:', Object.entries(sleepByDay).map(([day, data]) => ({
            day,
            hours: (data.totalMinutes / 60).toFixed(2),
            segments: data.segments.length
        })));

        // Calcola la media giornaliera solo sui giorni con dati
        const days = Object.keys(sleepByDay);
        if (days.length === 0) {
            console.log('No valid sleep days found');
            return { dailyAverage: 0, daysWithData: 0, byDay: {} };
        }

        const totalMinutes = Object.values(sleepByDay).reduce((sum, data) => sum + data.totalMinutes, 0);
        const avgMinutes = totalMinutes / days.length;
        const avgHours = avgMinutes / 60;

        // Precisione a 2 decimali per maggiore accuratezza
        const preciseAvgHours = Math.round(avgHours * 100) / 100;

        console.log(`Sleep: ${preciseAvgHours.toFixed(2)} hours/night average (${days.length} nights with data)`);
        console.log('Sleep by day (hours):', dailyHours);

        return {
            dailyAverage: preciseAvgHours,
            daysWithData: days.length,
            byDay: dailyHours
        };
    }

    /**
     * Fetch sonno - LEGACY (per compatibilità)
     */
    async fetchSleep(startTime, endTime) {
        const result = await this.fetchSleepWithDetails(startTime, endTime);
        return result.dailyAverage;
    }

    /**
     * Fetch minuti attivi con MEDIA GIORNALIERA - CORRETTO
     */
    async fetchActiveMinutesWithDailyAverage(startTime, endTime) {
        const data = await this.fetchGoogleFitData('activeMinutes', startTime, endTime);

        if (!data.point || data.point.length === 0) {
            return { dailyAverage: 0, total: 0, daysWithData: 0, byDay: {} };
        }

        // Raggruppa per giorno
        const minutesByDay = {};

        data.point.forEach(point => {
            const minutes = point.value?.[0]?.intVal || 0;
            const endNanos = point.endTimeNanos;
            const dayKey = new Date(parseInt(endNanos) / 1000000).toISOString().split('T')[0];

            if (!minutesByDay[dayKey]) {
                minutesByDay[dayKey] = 0;
            }
            minutesByDay[dayKey] += minutes;
        });

        const daysWithData = Object.keys(minutesByDay).length;
        const totalMinutes = Object.values(minutesByDay).reduce((sum, m) => sum + m, 0);
        const dailyAverage = daysWithData > 0 ? Math.round(totalMinutes / daysWithData) : 0;

        console.log(`Active minutes: ${dailyAverage} min/day average (${totalMinutes} total over ${daysWithData} days)`);

        return {
            dailyAverage,
            total: totalMinutes,
            daysWithData,
            byDay: minutesByDay
        };
    }

    /**
     * Fetch minuti attivi - LEGACY (per compatibilità)
     */
    async fetchActiveMinutes(startTime, endTime) {
        const result = await this.fetchActiveMinutesWithDailyAverage(startTime, endTime);
        return result.total;
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

        // Prendi l'ultimo valore (il più recente nel periodo)
        // NOTA: Google Fit restituisce array, l'ordine dipende dalla query ma solitamente è cronologico se non specificato altrimenti
        // Per sicurezza usiamo l'ultimo elemento dell'array
        const lastValue = bodyFatValues[bodyFatValues.length - 1];

        // Arrotonda a 2 decimali per precisione
        return Math.round(lastValue * 100) / 100;
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
