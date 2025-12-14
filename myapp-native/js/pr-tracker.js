/**
 * PR Tracker Service
 * Rileva e notifica automaticamente i Personal Records
 * Cross-platform: APK Android, WebApp Android, WebApp iOS
 */

const PR_STORAGE_KEY = 'ironflow_personal_records';
const PR_HISTORY_KEY = 'ironflow_pr_history';

export class PRTracker {
    constructor() {
        this.personalRecords = this.loadPRs();
        this.prHistory = this.loadPRHistory();
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        this.isAndroid = /Android/.test(navigator.userAgent);
        this.isNativeApp = window.Capacitor?.isNativePlatform?.() || false;
        this.notificationPermission = 'default';
        
        this.init();
    }

    async init() {
        // Richiedi permesso notifiche
        await this.requestNotificationPermission();
        
        console.log(`🏆 PR Tracker inizializzato - Platform: ${this.getPlatformName()}`);
    }

    getPlatformName() {
        if (this.isNativeApp) return 'Native Android';
        if (this.isIOS) return 'iOS WebApp';
        if (this.isAndroid) return 'Android WebApp';
        return 'Desktop';
    }

    // --- Storage Methods ---
    loadPRs() {
        try {
            return JSON.parse(localStorage.getItem(PR_STORAGE_KEY) || '{}');
        } catch {
            return {};
        }
    }

    savePRs() {
        localStorage.setItem(PR_STORAGE_KEY, JSON.stringify(this.personalRecords));
    }

    loadPRHistory() {
        try {
            return JSON.parse(localStorage.getItem(PR_HISTORY_KEY) || '[]');
        } catch {
            return [];
        }
    }

    savePRHistory() {
        // Mantieni solo gli ultimi 100 PR
        const trimmed = this.prHistory.slice(0, 100);
        localStorage.setItem(PR_HISTORY_KEY, JSON.stringify(trimmed));
    }

    // --- PR Detection ---
    
    /**
     * Normalizza il nome dell'esercizio per il confronto
     */
    normalizeExerciseName(name) {
        return (name || '')
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .replace(/[()[\]{}]/g, '')
            .replace(/\d+\s*(kg|lb|lbs)?/gi, '')
            .trim();
    }

    /**
     * Calcola 1RM stimato usando la formula di Brzycki
     */
    calculate1RM(weight, reps) {
        if (reps <= 0 || weight <= 0) return 0;
        if (reps === 1) return weight;
        if (reps > 12) return weight; // Oltre 12 reps non è affidabile per 1RM
        
        // Formula Brzycki: 1RM = weight * (36 / (37 - reps))
        return Math.round(weight * (36 / (37 - reps)));
    }

    /**
     * Analizza un log di allenamento e rileva i PR
     * @returns {Array} Lista di nuovi PR rilevati
     */
    detectPRsFromLog(logData) {
        const newPRs = [];
        
        if (!logData || !logData.exercises) return newPRs;

        logData.exercises.forEach(exercise => {
            const exerciseName = (exercise.name || '').trim();
            if (!exerciseName) return;

            const normalizedName = this.normalizeExerciseName(exerciseName);
            
            // Inizializza il record se non esiste
            if (!this.personalRecords[normalizedName]) {
                this.personalRecords[normalizedName] = {
                    displayName: exerciseName,
                    maxWeight: 0,
                    max1RM: 0,
                    maxVolume: 0,
                    maxReps: 0,
                    lastUpdated: null
                };
            }

            const currentPR = this.personalRecords[normalizedName];
            let hasPR = false;
            const prDetails = {
                exercise: exerciseName,
                date: logData.date,
                records: []
            };

            // Analizza ogni set
            (exercise.sets || []).forEach(set => {
                const weight = parseFloat(set.weight) || 0;
                const reps = parseInt(set.reps) || 0;
                
                if (weight <= 0 || reps <= 0) return;

                // 1. PR Peso Massimo
                if (weight > currentPR.maxWeight) {
                    prDetails.records.push({
                        type: 'weight',
                        label: '💪 Peso Massimo',
                        oldValue: currentPR.maxWeight,
                        newValue: weight,
                        unit: 'kg'
                    });
                    currentPR.maxWeight = weight;
                    hasPR = true;
                }

                // 2. PR 1RM Stimato
                const estimated1RM = this.calculate1RM(weight, reps);
                if (estimated1RM > currentPR.max1RM) {
                    prDetails.records.push({
                        type: '1rm',
                        label: '🎯 1RM Stimato',
                        oldValue: currentPR.max1RM,
                        newValue: estimated1RM,
                        unit: 'kg'
                    });
                    currentPR.max1RM = estimated1RM;
                    hasPR = true;
                }

                // 3. PR Reps Massime (con almeno 70% del peso max)
                if (currentPR.maxWeight > 0 && weight >= currentPR.maxWeight * 0.7) {
                    if (reps > currentPR.maxReps) {
                        prDetails.records.push({
                            type: 'reps',
                            label: '🔥 Max Ripetizioni',
                            oldValue: currentPR.maxReps,
                            newValue: reps,
                            unit: 'reps',
                            context: `@ ${weight}kg`
                        });
                        currentPR.maxReps = reps;
                        hasPR = true;
                    }
                }
            });

            // 4. PR Volume Totale per Esercizio
            const exerciseVolume = (exercise.sets || []).reduce((sum, set) => {
                return sum + ((parseFloat(set.weight) || 0) * (parseInt(set.reps) || 0));
            }, 0);

            if (exerciseVolume > currentPR.maxVolume) {
                prDetails.records.push({
                    type: 'volume',
                    label: '📊 Volume Massimo',
                    oldValue: currentPR.maxVolume,
                    newValue: Math.round(exerciseVolume),
                    unit: 'kg'
                });
                currentPR.maxVolume = Math.round(exerciseVolume);
                hasPR = true;
            }

            if (hasPR) {
                currentPR.lastUpdated = new Date().toISOString();
                currentPR.displayName = exerciseName; // Aggiorna il nome visualizzato
                newPRs.push(prDetails);
            }
        });

        // Salva i PR aggiornati
        if (newPRs.length > 0) {
            this.savePRs();
            
            // Aggiungi allo storico
            newPRs.forEach(pr => {
                this.prHistory.unshift({
                    ...pr,
                    timestamp: new Date().toISOString()
                });
            });
            this.savePRHistory();
        }

        return newPRs;
    }

    // --- Notification System ---

    async requestNotificationPermission() {
        try {
            if ('Notification' in window) {
                const permission = await Notification.requestPermission();
                this.notificationPermission = permission;
                console.log(`🔔 Permesso notifiche: ${permission}`);
                return permission === 'granted';
            }
        } catch (error) {
            console.warn('Notifiche non supportate:', error);
        }
        return false;
    }

    /**
     * Invia notifica PR - Cross-platform
     */
    async notifyPR(prDetails) {
        const { exercise, records } = prDetails;
        
        if (records.length === 0) return;

        // Costruisci il messaggio
        const mainRecord = records[0];
        const title = `🏆 NUOVO PR: ${exercise}`;
        const improvement = mainRecord.oldValue > 0 
            ? ` (+${(mainRecord.newValue - mainRecord.oldValue).toFixed(1)}${mainRecord.unit})`
            : '';
        const body = `${mainRecord.label}: ${mainRecord.newValue}${mainRecord.unit}${improvement}`;

        console.log(`🏆 PR Notification: ${title} - ${body}`);

        // 1. Notifica Native (Android APK via Capacitor)
        if (this.isNativeApp) {
            await this.sendNativeNotification(title, body);
        }

        // 2. Web Notification API
        if (this.notificationPermission === 'granted') {
            this.sendWebNotification(title, body);
        }

        // 3. In-App Toast (sempre visibile)
        this.showInAppToast(title, body, records);

        // 4. Vibrazione (se supportata)
        this.vibrateDevice();
    }

    async sendNativeNotification(title, body) {
        try {
            if (window.Capacitor?.Plugins?.LocalNotifications) {
                await window.Capacitor.Plugins.LocalNotifications.schedule({
                    notifications: [{
                        id: Date.now(),
                        title: title,
                        body: body,
                        channelId: 'pr_notifications',
                        sound: 'default',
                        smallIcon: 'ic_stat_icon',
                        largeIcon: 'ic_launcher'
                    }]
                });
                console.log('✅ Native notification sent');
            }
        } catch (error) {
            console.warn('Native notification failed:', error);
        }
    }

    sendWebNotification(title, body) {
        try {
            // Crea notifica con opzioni ottimizzate per mobile
            const notification = new Notification(title, {
                body: body,
                icon: '/assets/icon.svg',
                badge: '/assets/icon.svg',
                tag: 'pr-notification',
                renotify: true,
                requireInteraction: !this.isIOS, // iOS non supporta bene
                vibrate: [200, 100, 200],
                data: { type: 'pr' }
            });

            notification.onclick = () => {
                window.focus();
                notification.close();
            };

            // Auto-close dopo 10 secondi
            setTimeout(() => notification.close(), 10000);
        } catch (error) {
            console.warn('Web notification failed:', error);
        }
    }

    showInAppToast(title, body, records) {
        // Rimuovi toast esistenti
        const existingToast = document.getElementById('pr-toast');
        if (existingToast) existingToast.remove();

        // Crea il toast
        const toast = document.createElement('div');
        toast.id = 'pr-toast';
        toast.innerHTML = `
            <div class="pr-toast-content">
                <div class="pr-toast-icon">🏆</div>
                <div class="pr-toast-text">
                    <div class="pr-toast-title">${title}</div>
                    <div class="pr-toast-body">${body}</div>
                    ${records.length > 1 ? `<div class="pr-toast-extra">+${records.length - 1} altri record!</div>` : ''}
                </div>
                <button class="pr-toast-close" onclick="this.parentElement.parentElement.remove()">×</button>
            </div>
        `;

        // Stili inline per garantire visibilità
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 99999;
            background: linear-gradient(135deg, #FFD700, #FFA500);
            color: #1a1a2e;
            padding: 16px 20px;
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(255, 215, 0, 0.4);
            animation: prToastSlide 0.4s ease-out;
            max-width: 90vw;
            font-family: var(--font-body, system-ui, sans-serif);
        `;

        // Aggiungi stili di animazione se non esistono
        if (!document.getElementById('pr-toast-styles')) {
            const styles = document.createElement('style');
            styles.id = 'pr-toast-styles';
            styles.textContent = `
                @keyframes prToastSlide {
                    from {
                        opacity: 0;
                        transform: translateX(-50%) translateY(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                }
                .pr-toast-content {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }
                .pr-toast-icon {
                    font-size: 2rem;
                    animation: bounce 0.5s ease infinite alternate;
                }
                @keyframes bounce {
                    from { transform: scale(1); }
                    to { transform: scale(1.2); }
                }
                .pr-toast-title {
                    font-weight: 700;
                    font-size: 1rem;
                }
                .pr-toast-body {
                    font-size: 0.9rem;
                    opacity: 0.9;
                }
                .pr-toast-extra {
                    font-size: 0.75rem;
                    opacity: 0.7;
                    margin-top: 4px;
                }
                .pr-toast-close {
                    background: none;
                    border: none;
                    font-size: 1.5rem;
                    cursor: pointer;
                    opacity: 0.6;
                    padding: 0 0 0 10px;
                    color: inherit;
                }
                .pr-toast-close:hover {
                    opacity: 1;
                }
            `;
            document.head.appendChild(styles);
        }

        document.body.appendChild(toast);

        // Auto-remove dopo 8 secondi
        setTimeout(() => {
            toast.style.animation = 'prToastSlide 0.3s ease-in reverse';
            setTimeout(() => toast.remove(), 300);
        }, 8000);
    }

    vibrateDevice() {
        try {
            if ('vibrate' in navigator) {
                navigator.vibrate([100, 50, 100, 50, 200]);
            }
        } catch (e) {
            // Vibrazione non supportata
        }
    }

    // --- Utility Methods ---

    /**
     * Ottieni tutti i PR per un esercizio specifico
     */
    getPRsForExercise(exerciseName) {
        const normalized = this.normalizeExerciseName(exerciseName);
        return this.personalRecords[normalized] || null;
    }

    /**
     * Ottieni tutti i PR
     */
    getAllPRs() {
        return Object.entries(this.personalRecords)
            .map(([key, pr]) => ({
                normalizedName: key,
                ...pr
            }))
            .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
    }

    /**
     * Ottieni lo storico PR
     */
    getPRHistory(limit = 20) {
        return this.prHistory.slice(0, limit);
    }

    /**
     * Ottieni lista esercizi per l'AI (per normalizzazione)
     */
    getExerciseListForAI() {
        return Object.values(this.personalRecords)
            .map(pr => pr.displayName)
            .filter(Boolean);
    }
}

// Singleton export
export const prTracker = new PRTracker();
