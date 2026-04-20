const PR_STORAGE_KEY = "ironflow_personal_records";
const PR_HISTORY_KEY = "ironflow_pr_history";
const DEFAULT_NOTIFICATION_ICON = "assets/icon-512.png";
const DEFAULT_NOTIFICATION_BADGE = "assets/icon-192.png";
const PR_HUB_URL = "records.html";

function detectIOSDevice() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return /iPad|iPhone|iPod/.test(ua) || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalonePwa() {
    return Boolean(
        window.matchMedia?.("(display-mode: standalone)")?.matches ||
        window.navigator.standalone === true
    );
}

async function requestNotificationPermissionCompat() {
    if (typeof Notification?.requestPermission !== "function") {
        return "denied";
    }

    if (Notification.requestPermission.length > 0) {
        return new Promise((resolve) => {
            Notification.requestPermission((result) => resolve(result));
        });
    }

    const result = Notification.requestPermission();
    return typeof result === "string" ? result : await result;
}

export class PRTracker {
    constructor() {
        this.personalRecords = this.loadPRs();
        this.prHistory = this.loadPRHistory();
        this.sessionPRs = [];
        this.notificationPermission = "default";

        this.refreshPlatformFlags();
        void this.init();
    }

    refreshPlatformFlags() {
        const userAgent = navigator.userAgent || "";
        this.isIOS = detectIOSDevice();
        this.isAndroid = /Android/i.test(userAgent);
        this.isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
        this.isStandalone = isStandalonePwa();
    }

    async init() {
        await this.requestNotificationPermission();
        console.log(`🏆 PR Tracker inizializzato - Platform: ${this.getPlatformName()}`);
    }

    getPlatformName() {
        if (this.isNativeApp) {
            return "Native App";
        }

        if (this.isIOS) {
            return this.isStandalone ? "iOS Home Screen WebApp" : "iOS Browser";
        }

        if (this.isAndroid) {
            return "Android WebApp";
        }

        return "Desktop";
    }

    loadPRs() {
        try {
            return JSON.parse(localStorage.getItem(PR_STORAGE_KEY) || "{}");
        } catch {
            return {};
        }
    }

    savePRs() {
        localStorage.setItem(PR_STORAGE_KEY, JSON.stringify(this.personalRecords));
    }

    loadPRHistory() {
        try {
            return JSON.parse(localStorage.getItem(PR_HISTORY_KEY) || "[]");
        } catch {
            return [];
        }
    }

    savePRHistory() {
        const trimmedHistory = this.prHistory.slice(0, 100);
        localStorage.setItem(PR_HISTORY_KEY, JSON.stringify(trimmedHistory));
    }

    normalizeExerciseName(name) {
        return (name || "")
            .toLowerCase()
            .trim()
            .replace(/\s+/g, " ")
            .replace(/[()[\]{}]/g, "")
            .replace(/\d+\s*(kg|lb|lbs)?/gi, "")
            .trim();
    }

    calculate1RM(weight, reps) {
        if (reps <= 0 || weight <= 0) {
            return 0;
        }

        if (reps === 1) {
            return weight;
        }

        if (reps > 30) {
            console.debug(`[PRTracker] ${reps} reps troppo alto per stima 1RM, uso formula conservativa`);
            return Math.round(weight * 1.15);
        }

        if (reps <= 10) {
            return Math.round(weight * (36 / (37 - reps)));
        }

        return Math.round(weight * (1 + (reps / 30)));
    }

    detectPRsFromLog(logData) {
        const newPRs = [];

        if (!logData?.exercises) {
            return newPRs;
        }

        logData.exercises.forEach((exercise) => {
            const exerciseName = (exercise.name || "").trim();
            if (!exerciseName) {
                return;
            }

            const normalizedName = this.normalizeExerciseName(exerciseName);
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

            (exercise.sets || []).forEach((set) => {
                const weight = parseFloat(set.weight) || 0;
                const reps = parseInt(set.reps, 10) || 0;

                if (weight <= 0 || reps <= 0) {
                    return;
                }

                if (weight > currentPR.maxWeight) {
                    prDetails.records.push({
                        type: "weight",
                        label: "💪 Peso Massimo",
                        oldValue: currentPR.maxWeight,
                        newValue: weight,
                        unit: "kg"
                    });
                    currentPR.maxWeight = weight;
                    hasPR = true;
                }

                const estimated1RM = this.calculate1RM(weight, reps);
                if (estimated1RM > currentPR.max1RM) {
                    prDetails.records.push({
                        type: "1rm",
                        label: "🎯 1RM Stimato",
                        oldValue: currentPR.max1RM,
                        newValue: estimated1RM,
                        unit: "kg"
                    });
                    currentPR.max1RM = estimated1RM;
                    hasPR = true;
                }

                if (currentPR.maxWeight > 0 && weight >= currentPR.maxWeight * 0.7 && reps > currentPR.maxReps) {
                    prDetails.records.push({
                        type: "reps",
                        label: "🔥 Max Ripetizioni",
                        oldValue: currentPR.maxReps,
                        newValue: reps,
                        unit: "reps",
                        context: `@ ${weight}kg`
                    });
                    currentPR.maxReps = reps;
                    hasPR = true;
                }
            });

            const exerciseVolume = (exercise.sets || []).reduce((sum, set) => {
                return sum + ((parseFloat(set.weight) || 0) * (parseInt(set.reps, 10) || 0));
            }, 0);

            if (exerciseVolume > currentPR.maxVolume) {
                prDetails.records.push({
                    type: "volume",
                    label: "📊 Volume Massimo",
                    oldValue: currentPR.maxVolume,
                    newValue: Math.round(exerciseVolume),
                    unit: "kg"
                });
                currentPR.maxVolume = Math.round(exerciseVolume);
                hasPR = true;
            }

            if (!hasPR) {
                return;
            }

            currentPR.lastUpdated = new Date().toISOString();
            currentPR.displayName = exerciseName;
            newPRs.push(prDetails);
        });

        if (newPRs.length > 0) {
            this.savePRs();
            newPRs.forEach((pr) => {
                this.prHistory.unshift({
                    ...pr,
                    timestamp: new Date().toISOString()
                });
            });
            this.savePRHistory();
            this.sessionPRs.push(...newPRs);
        }

        return newPRs;
    }

    resetSessionPRs() {
        this.sessionPRs = [];
        console.log("🏆 Session PRs reset");
    }

    getSessionPRs() {
        return this.sessionPRs;
    }

    supportsSystemNotifications() {
        if (!("Notification" in window)) {
            return false;
        }

        // iOS only exposes web notifications for installed Home Screen apps.
        if (this.isIOS && !this.isStandalone) {
            return false;
        }

        return true;
    }

    canUseNotificationConstructor() {
        return !this.isIOS && !this.isAndroid;
    }

    async getServiceWorkerRegistration() {
        if (!("serviceWorker" in navigator)) {
            return null;
        }

        try {
            const registration = await navigator.serviceWorker.getRegistration?.();
            if (registration) {
                return registration;
            }
        } catch (error) {
            console.warn("[PRTracker] Service worker lookup failed:", error);
        }

        try {
            return await Promise.race([
                navigator.serviceWorker.ready,
                new Promise((resolve) => {
                    setTimeout(() => resolve(null), 1000);
                })
            ]);
        } catch (error) {
            console.warn("[PRTracker] Service worker not ready:", error);
            return null;
        }
    }

    async showWebNotification(title, options, onClick) {
        if (this.notificationPermission !== "granted" || !this.supportsSystemNotifications()) {
            return false;
        }

        const normalizedOptions = {
            icon: DEFAULT_NOTIFICATION_ICON,
            badge: DEFAULT_NOTIFICATION_BADGE,
            ...options
        };

        try {
            const registration = await this.getServiceWorkerRegistration();
            if (registration?.showNotification) {
                await registration.showNotification(title, normalizedOptions);
                return true;
            }

            if (this.canUseNotificationConstructor()) {
                const notification = new Notification(title, normalizedOptions);
                notification.onclick = () => {
                    window.focus();
                    onClick?.();
                    notification.close();
                };

                const autoCloseMs = normalizedOptions.requireInteraction ? 15000 : 10000;
                setTimeout(() => notification.close(), autoCloseMs);
                return true;
            }
        } catch (error) {
            console.warn("[PRTracker] Web notification failed:", error);
        }

        return false;
    }

    async notifyAggregatedPRs() {
        if (this.sessionPRs.length === 0) {
            console.log("🏆 Nessun nuovo PR in questa sessione");
            return false;
        }

        const totalRecords = this.sessionPRs.reduce((sum, pr) => sum + pr.records.length, 0);
        const exerciseCount = this.sessionPRs.length;
        const title = "🏆 Progressi Straordinari!";
        const body = `Hai superato ${totalRecords} record personali in ${exerciseCount} esercizi. Tocca per analizzarli.`;

        console.log(`🏆 Sessione completata: ${totalRecords} record in ${exerciseCount} esercizi`);

        if (this.isNativeApp) {
            await this.sendAggregatedNativeNotification(title, body, totalRecords);
        }

        if (this.notificationPermission === "granted") {
            await this.sendAggregatedWebNotification(title, body);
        }

        this.showAggregatedToast(totalRecords, exerciseCount);
        this.vibrateDevice([100, 50, 100, 50, 100, 50, 200]);
        return true;
    }

    navigateToPRHub() {
        if (this.sessionPRs.length === 0) {
            return;
        }

        // P1.15: persist session PRs via sessionStorage instead of query string.
        // Large sessions (many exercises × many record types) can easily exceed
        // browser URL limits (~8KB on WebView), which caused silent failures.
        try {
            sessionStorage.setItem(
                "ironflow_session_prs",
                JSON.stringify({
                    prs: this.sessionPRs,
                    savedAt: Date.now()
                })
            );
        } catch (err) {
            console.warn("[PRTracker] sessionStorage write failed, falling back to URL:", err);
            const encodedPRs = encodeURIComponent(JSON.stringify(this.sessionPRs));
            // Keep a safety upper bound (~6 KB) to stay below WebView URL limits
            if (encodedPRs.length < 6000) {
                window.location.href = `${PR_HUB_URL}?session_prs=${encodedPRs}`;
                return;
            }
        }
        window.location.href = `${PR_HUB_URL}?session_prs=1`;
    }

    async sendAggregatedNativeNotification(title, body, count) {
        try {
            if (window.Capacitor?.Plugins?.LocalNotifications) {
                await window.Capacitor.Plugins.LocalNotifications.schedule({
                    notifications: [
                        {
                            id: Date.now(),
                            title,
                            body,
                            channelId: "pr_notifications",
                            sound: "default",
                            smallIcon: "ic_stat_icon",
                            largeIcon: "ic_launcher",
                            extra: {
                                type: "pr_aggregated",
                                count,
                                action: "open_pr_hub"
                            }
                        }
                    ]
                });
                console.log("✅ Aggregated native notification sent");
            }
        } catch (error) {
            console.warn("Native notification failed:", error);
        }
    }

    async sendAggregatedWebNotification(title, body) {
        return this.showWebNotification(
            title,
            {
                body,
                tag: "pr-aggregated",
                renotify: true,
                requireInteraction: true,
                vibrate: [100, 50, 100, 50, 200],
                data: {
                    type: "pr_aggregated",
                    action: "open_pr_hub",
                    url: PR_HUB_URL
                }
            },
            () => this.navigateToPRHub()
        );
    }

    showAggregatedToast(totalRecords, exerciseCount) {
        const existingToast = document.getElementById("pr-toast");
        existingToast?.remove();

        const toast = document.createElement("div");
        toast.id = "pr-toast";
        toast.innerHTML = `
            <button class="pr-toast-close" id="prToastClose" aria-label="Chiudi">×</button>
            <div class="pr-toast-content">
                <div class="pr-toast-icon">${window.lucideIcon?.("trophy", { size: 20, color: "#ffd700" }) || "🏆"}</div>
                <div class="pr-toast-text">
                    <div class="pr-toast-title">Nuovi Record!</div>
                    <div class="pr-toast-body">${totalRecords} PR in ${exerciseCount} esercizi</div>
                </div>
                <button class="pr-toast-cta" id="prToastCTA">Vedi →</button>
            </div>
        `;
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 16px;
            z-index: 9999;
            background: rgba(26, 26, 46, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 215, 0, 0.3);
            color: #fff;
            padding: 12px 16px;
            border-radius: 14px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            animation: prToastSlideIn 0.3s ease-out;
            max-width: 280px;
            font-family: var(--font-body, system-ui, sans-serif);
        `;

        if (!document.getElementById("pr-toast-styles")) {
            const styles = document.createElement("style");
            styles.id = "pr-toast-styles";
            styles.textContent = `
                @keyframes prToastSlideIn {
                    from { opacity: 0; transform: translateX(20px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                @keyframes prToastSlideOut {
                    from { opacity: 1; transform: translateX(0); }
                    to { opacity: 0; transform: translateX(20px); }
                }
                .pr-toast-close {
                    position: absolute;
                    top: 6px;
                    right: 8px;
                    background: none;
                    border: none;
                    color: rgba(255,255,255,0.5);
                    font-size: 1.2rem;
                    cursor: pointer;
                    padding: 2px 6px;
                    line-height: 1;
                    transition: color 0.2s;
                }
                .pr-toast-close:hover {
                    color: #fff;
                }
                .pr-toast-content {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .pr-toast-icon {
                    font-size: 1.5rem;
                }
                .pr-toast-text {
                    flex: 1;
                }
                .pr-toast-title {
                    font-weight: 700;
                    font-size: 0.9rem;
                    color: #FFD700;
                }
                .pr-toast-body {
                    font-size: 0.75rem;
                    opacity: 0.8;
                }
                .pr-toast-cta {
                    background: linear-gradient(135deg, #FFD700, #FFA500);
                    border: none;
                    color: #1a1a2e;
                    padding: 6px 12px;
                    border-radius: 8px;
                    font-weight: 700;
                    font-size: 0.75rem;
                    cursor: pointer;
                    white-space: nowrap;
                    transition: transform 0.2s, box-shadow 0.2s;
                }
                .pr-toast-cta:hover {
                    transform: scale(1.05);
                    box-shadow: 0 2px 8px rgba(255, 215, 0, 0.4);
                }
            `;
            document.head.appendChild(styles);
        }

        document.body.appendChild(toast);
        window.refreshLucideIcons?.(toast);

        document.getElementById("prToastClose")?.addEventListener("click", () => {
            this.dismissToast(toast);
        });
        document.getElementById("prToastCTA")?.addEventListener("click", () => {
            toast.remove();
            this.navigateToPRHub();
        });

        setTimeout(() => {
            this.dismissToast(toast);
        }, 5000);
    }

    dismissToast(toast) {
        if (!toast?.parentNode) {
            return;
        }

        toast.style.animation = "prToastSlideOut 0.3s ease-in forwards";
        setTimeout(() => toast.remove(), 300);
    }

    async requestNotificationPermission() {
        this.refreshPlatformFlags();

        if (!this.supportsSystemNotifications()) {
            console.info("[PRTracker] Web notifications unavailable on this platform/context");
            this.notificationPermission = "denied";
            return false;
        }

        try {
            if ("Notification" in window) {
                if (Notification.permission === "default") {
                    this.notificationPermission = await requestNotificationPermissionCompat();
                } else {
                    this.notificationPermission = Notification.permission;
                }

                console.log(`🔔 Permesso notifiche PR: ${this.notificationPermission}`);
                return this.notificationPermission === "granted";
            }
        } catch (error) {
            console.warn("Notifiche non supportate:", error);
        }

        return false;
    }

    async notifyPR(prDetails) {
        const { exercise, records } = prDetails;
        if (!records?.length) {
            return;
        }

        const mainRecord = records[0];
        const improvement = mainRecord.oldValue > 0
            ? ` (+${(mainRecord.newValue - mainRecord.oldValue).toFixed(1)}${mainRecord.unit})`
            : "";

        const title = `🏆 NUOVO PR: ${exercise}`;
        const body = `${mainRecord.label}: ${mainRecord.newValue}${mainRecord.unit}${improvement}`;

        console.log(`🏆 PR Notification: ${title} - ${body}`);

        if (this.isNativeApp) {
            await this.sendNativeNotification(title, body);
        }

        if (this.notificationPermission === "granted") {
            await this.sendWebNotification(title, body);
        }

        this.showInAppToast(title, body, records);
        this.vibrateDevice();
    }

    async sendNativeNotification(title, body) {
        try {
            if (window.Capacitor?.Plugins?.LocalNotifications) {
                await window.Capacitor.Plugins.LocalNotifications.schedule({
                    notifications: [
                        {
                            id: Date.now(),
                            title,
                            body,
                            channelId: "pr_notifications",
                            sound: "default",
                            smallIcon: "ic_stat_icon",
                            largeIcon: "ic_launcher"
                        }
                    ]
                });
                console.log("✅ Native notification sent");
            }
        } catch (error) {
            console.warn("Native notification failed:", error);
        }
    }

    async sendWebNotification(title, body) {
        return this.showWebNotification(title, {
            body,
            tag: "pr-notification",
            renotify: true,
            requireInteraction: !this.isIOS,
            vibrate: [200, 100, 200],
            data: {
                type: "pr",
                url: PR_HUB_URL
            }
        });
    }

    showInAppToast(title, body, records) {
        const existingToast = document.getElementById("pr-toast");
        existingToast?.remove();

        const shortTitle = title.replace("🏆 NUOVO PR: ", "");
        const toast = document.createElement("div");
        toast.id = "pr-toast";
        toast.innerHTML = `
            <button class="pr-toast-close" id="prSingleToastClose" aria-label="Chiudi">×</button>
            <div class="pr-toast-content">
                <div class="pr-toast-icon">${window.lucideIcon?.("trophy", { size: 20, color: "#ffd700" }) || "🏆"}</div>
                <div class="pr-toast-text">
                    <div class="pr-toast-title">${shortTitle}</div>
                    <div class="pr-toast-body">${body}</div>
                    ${records.length > 1 ? `<div class="pr-toast-extra">+${records.length - 1} altri</div>` : ""}
                </div>
            </div>
        `;
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 16px;
            z-index: 9999;
            background: rgba(26, 26, 46, 0.95);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 215, 0, 0.3);
            color: #fff;
            padding: 12px 16px;
            border-radius: 14px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            animation: prToastSlideIn 0.3s ease-out;
            max-width: 260px;
            font-family: var(--font-body, system-ui, sans-serif);
        `;

        if (!document.getElementById("pr-toast-styles")) {
            const styles = document.createElement("style");
            styles.id = "pr-toast-styles";
            styles.textContent = `
                @keyframes prToastSlideIn {
                    from { opacity: 0; transform: translateX(20px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                @keyframes prToastSlideOut {
                    from { opacity: 1; transform: translateX(0); }
                    to { opacity: 0; transform: translateX(20px); }
                }
                .pr-toast-close {
                    position: absolute;
                    top: 6px;
                    right: 8px;
                    background: none;
                    border: none;
                    color: rgba(255,255,255,0.5);
                    font-size: 1.2rem;
                    cursor: pointer;
                    padding: 2px 6px;
                    line-height: 1;
                    transition: color 0.2s;
                }
                .pr-toast-close:hover {
                    color: #fff;
                }
                .pr-toast-content {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                }
                .pr-toast-icon {
                    font-size: 1.5rem;
                }
                .pr-toast-text {
                    flex: 1;
                }
                .pr-toast-title {
                    font-weight: 700;
                    font-size: 0.85rem;
                    color: #FFD700;
                }
                .pr-toast-body {
                    font-size: 0.75rem;
                    opacity: 0.8;
                }
                .pr-toast-extra {
                    font-size: 0.65rem;
                    opacity: 0.6;
                    margin-top: 2px;
                }
            `;
            document.head.appendChild(styles);
        }

        document.body.appendChild(toast);
        window.refreshLucideIcons?.(toast);

        document.getElementById("prSingleToastClose")?.addEventListener("click", () => {
            this.dismissToast(toast);
        });

        setTimeout(() => {
            this.dismissToast(toast);
        }, 5000);
    }

    vibrateDevice(pattern = [100, 50, 100, 50, 200]) {
        try {
            if ("vibrate" in navigator) {
                navigator.vibrate(pattern);
            }
        } catch {
            // No-op on unsupported platforms.
        }
    }

    getPRsForExercise(exerciseName) {
        const normalizedName = this.normalizeExerciseName(exerciseName);
        return this.personalRecords[normalizedName] || null;
    }

    getAllPRs() {
        return Object.entries(this.personalRecords)
            .map(([normalizedName, pr]) => ({ normalizedName, ...pr }))
            .sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
    }

    getPRHistory(limit = 20) {
        return this.prHistory.slice(0, limit);
    }

    getExerciseListForAI() {
        return Object.values(this.personalRecords)
            .map((pr) => pr.displayName)
            .filter(Boolean);
    }
}

export const prTracker = new PRTracker();
