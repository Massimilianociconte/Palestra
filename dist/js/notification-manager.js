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

export class NotificationManager {
    constructor() {
        this.audioCtx = null;
        this.gainNode = null;
        this.silentOscillator = null;
        this.isAudioUnlocked = false;
        this.notificationPermission = "default";
        this.isIOS = detectIOSDevice();
        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        this.isNative = typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
        this.isStandalone = isStandalonePwa();
        this.audioElement = null;
        this.notificationSound = null;
        this.wakeLock = null;
        this.activeTimerWorker = null;
        void this.init();
    }

    async init() {
        this.refreshPlatformFlags();

        if ("Notification" in window) {
            this.notificationPermission = Notification.permission;
        }

        this.preloadNotificationSound();
        console.log(
            `[NotificationManager] Platform: ${
                this.isNative ? "native" : this.isIOS ? "iOS web" : "web"
            }, standalone=${this.isStandalone}, safari=${this.isSafari}`
        );
    }

    refreshPlatformFlags() {
        this.isIOS = detectIOSDevice();
        this.isStandalone = isStandalonePwa();
    }

    supportsSystemNotifications() {
        if (!("Notification" in window)) {
            return false;
        }

        // iOS supports web notifications only for installed Home Screen web apps.
        if (this.isIOS && !this.isStandalone) {
            return false;
        }

        return true;
    }

    canUseNotificationConstructor() {
        return !this.isIOS && !/Android/i.test(navigator.userAgent || "");
    }

    preloadNotificationSound() {
        this.notificationSound = new Audio();
        this.notificationSound.preload = "auto";
        this.notificationSound.setAttribute("playsinline", "");
        this.notificationSound.setAttribute("webkit-playsinline", "");

        void this.generateBeepDataURI().then((dataURI) => {
            this.notificationSound.src = dataURI;
            this.notificationSound.volume = 1;
            this.notificationSound.load();
        });
    }

    async generateBeepDataURI() {
        return new Promise((resolve) => {
            try {
                const sampleRate = 44100;
                const duration = 0.8;
                const numSamples = Math.floor(sampleRate * duration);
                const buffer = new ArrayBuffer(44 + numSamples * 2);
                const view = new DataView(buffer);
                const writeString = (offset, string) => {
                    for (let i = 0; i < string.length; i++) {
                        view.setUint8(offset + i, string.charCodeAt(i));
                    }
                };

                writeString(0, "RIFF");
                view.setUint32(4, 36 + numSamples * 2, true);
                writeString(8, "WAVE");
                writeString(12, "fmt ");
                view.setUint32(16, 16, true);
                view.setUint16(20, 1, true);
                view.setUint16(22, 1, true);
                view.setUint32(24, sampleRate, true);
                view.setUint32(28, sampleRate * 2, true);
                view.setUint16(32, 2, true);
                view.setUint16(34, 16, true);
                writeString(36, "data");
                view.setUint32(40, numSamples * 2, true);

                const frequency = 880;
                const beepDuration = 0.25;
                const pauseDuration = 0.15;

                for (let i = 0; i < numSamples; i++) {
                    const t = i / sampleRate;
                    let sample = 0;

                    if (t < beepDuration) {
                        const envelope = Math.min(1, t * 20) * Math.max(0, 1 - (t / beepDuration) * 0.5);
                        sample = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.8;
                    } else if (t >= beepDuration + pauseDuration && t < (beepDuration * 2) + pauseDuration) {
                        const t2 = t - beepDuration - pauseDuration;
                        const envelope = Math.min(1, t2 * 20) * Math.max(0, 1 - (t2 / beepDuration) * 0.5);
                        sample = Math.sin(2 * Math.PI * frequency * t2) * envelope * 0.8;
                    }

                    const pcm = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
                    view.setInt16(44 + i * 2, pcm, true);
                }

                const blob = new Blob([buffer], { type: "audio/wav" });
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            } catch (error) {
                console.error("Error generating beep:", error);
                resolve("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAGZGF0YQQAAAAAAA==");
            }
        });
    }

    async requestPermission() {
        this.refreshPlatformFlags();
        this.unlockAudio();
        this.isIOS && this.unlockIOSAudio();
        void this.requestWakeLock();

        if (!this.supportsSystemNotifications()) {
            console.info("[NotificationManager] System notifications unavailable on this platform/context");
            return this.notificationPermission;
        }

        if (!("Notification" in window) || this.notificationPermission !== "default") {
            return this.notificationPermission;
        }

        try {
            this.notificationPermission = await this.requestNotificationPermissionCompat();
            console.log("Notification permission:", this.notificationPermission);
        } catch (error) {
            console.error("Error requesting notification permission:", error);
        }

        return this.notificationPermission;
    }

    async requestNotificationPermissionCompat() {
        if (typeof Notification.requestPermission !== "function") {
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

    unlockIOSAudio() {
        console.log("[NotificationManager] Unlocking iOS audio...");

        if (this.notificationSound) {
            this.notificationSound.volume = 0.01;
            const playPromise = this.notificationSound.play();
            playPromise?.then(() => {
                this.notificationSound.pause();
                this.notificationSound.currentTime = 0;
                this.notificationSound.volume = 1;
                console.log("[NotificationManager] iOS audio unlocked via Audio element");
            }).catch((error) => {
                console.warn("[NotificationManager] iOS audio unlock failed:", error);
            });
        }

        this.unlockAudio();
    }

    async requestWakeLock() {
        if (!("wakeLock" in navigator)) {
            return;
        }

        try {
            this.wakeLock = await navigator.wakeLock.request("screen");
            console.log("[NotificationManager] Wake Lock acquired");
            this.wakeLock.addEventListener("release", () => {
                console.log("[NotificationManager] Wake Lock released");
            });
        } catch (error) {
            console.log("[NotificationManager] Wake Lock unavailable:", error.message);
        }
    }

    releaseWakeLock() {
        if (!this.wakeLock) {
            return;
        }

        void this.wakeLock.release();
        this.wakeLock = null;
    }

    unlockAudio() {
        if (this.isNative) {
            console.log("[NotificationManager] Skipping AudioContext on native app");
            return;
        }

        if (!this.audioCtx || this.audioCtx.state === "closed") {
            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            if (AudioContextCtor) {
                this.audioCtx = new AudioContextCtor();
                this.isAudioUnlocked = false;
                console.log("[NotificationManager] AudioContext created");
            }
        }

        if (!this.audioCtx) {
            return;
        }

        if (this.audioCtx.state === "suspended" || !this.isAudioUnlocked) {
            void this.audioCtx.resume().then(() => {
                this.isAudioUnlocked = true;
                this.playSilence();
                console.log("[NotificationManager] AudioContext unlocked");
            }).catch((error) => {
                console.error("[NotificationManager] Audio resume failed:", error);
            });
        }
    }

    playSilence() {
        if (!this.audioCtx) {
            return;
        }

        try {
            const buffer = this.audioCtx.createBuffer(1, 1, 22050);
            const source = this.audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioCtx.destination);
            source.start(0);
        } catch (error) {
            console.warn("[NotificationManager] playSilence failed:", error);
        }
    }

    startSilentLoop() {
        if (this.isNative) {
            console.log("[NotificationManager] Skipping silent loop on native app");
            return;
        }

        // On iOS web apps the lock screen integration is driven by the Media Session
        // audio element, not by a Web Audio oscillator.
        if (this.isIOS) {
            this.unlockIOSAudio();
            console.log("[NotificationManager] iOS web app uses Media Session audio for background persistence");
            return;
        }

        this.unlockAudio();

        if (!this.audioCtx || this.silentOscillator) {
            return;
        }

        try {
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();
            osc.type = "sine";
            osc.frequency.value = 1;
            gain.gain.value = 0.001;
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);
            osc.start();
            this.silentOscillator = osc;
            this.gainNode = gain;
            console.log("[NotificationManager] Silent loop started");
        } catch (error) {
            console.error("[NotificationManager] Failed to start silent loop:", error);
        }
    }

    stopSilentLoop() {
        if (!this.silentOscillator) {
            return;
        }

        try {
            this.silentOscillator.stop();
            this.silentOscillator.disconnect();
        } catch (error) {
            console.warn("[NotificationManager] Error stopping silent loop:", error);
        }

        this.silentOscillator = null;
        this.gainNode = null;
    }

    playDoubleBeepWebAudio() {
        this.unlockAudio();
        if (!this.audioCtx) {
            return false;
        }

        try {
            const playTone = (frequency, time, duration) => {
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();
                const now = this.audioCtx.currentTime + time;

                osc.type = "sine";
                osc.frequency.value = frequency;
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);

                osc.start(now);
                gain.gain.setValueAtTime(0.8, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
                osc.stop(now + duration);
            };

            playTone(880, 0, 0.3);
            playTone(880, 0.4, 0.3);
            return true;
        } catch (error) {
            console.error("[NotificationManager] Web Audio beep failed:", error);
            return false;
        }
    }

    playDoubleBeepAudioElement() {
        if (!this.notificationSound) {
            return false;
        }

        try {
            this.notificationSound.currentTime = 0;
            this.notificationSound.volume = 1;
            void this.notificationSound.play().catch((error) => {
                console.warn("[NotificationManager] Audio element play failed:", error);
            });
            return true;
        } catch (error) {
            console.error("[NotificationManager] Audio element beep failed:", error);
            return false;
        }
    }

    playDoubleBeep() {
        console.log("[NotificationManager] Playing notification sound");

        if (this.isIOS) {
            const audioSuccess = this.playDoubleBeepAudioElement();
            if (!audioSuccess) {
                this.playDoubleBeepWebAudio();
            }
            return;
        }

        const webAudioSuccess = this.playDoubleBeepWebAudio();
        if (!webAudioSuccess) {
            this.playDoubleBeepAudioElement();
        }
    }

    triggerVibration(pattern = [500, 200, 500]) {
        if (!("vibrate" in navigator)) {
            return false;
        }

        try {
            navigator.vibrate(pattern);
            console.log("[NotificationManager] Vibration triggered");
            return true;
        } catch (error) {
            console.warn("[NotificationManager] Vibration failed:", error);
            return false;
        }
    }

    triggerIOSFeedback() {
        this.flashScreen();
        void this.triggerVibration([100, 50, 100]);
    }

    flashScreen() {
        const flash = document.createElement("div");
        flash.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 243, 255, 0.3);
            z-index: 9999;
            pointer-events: none;
            animation: flashAnim 0.5s ease-out;
        `;

        if (!document.getElementById("flashAnimStyle")) {
            const style = document.createElement("style");
            style.id = "flashAnimStyle";
            style.textContent = `
                @keyframes flashAnim {
                    0% { opacity: 1; }
                    100% { opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }

        document.body.appendChild(flash);
        setTimeout(() => flash.remove(), 500);
    }

    triggerNotification() {
        console.log("[NotificationManager] Triggering notification");
        this.playDoubleBeep();

        if (this.isIOS) {
            this.triggerIOSFeedback();
        } else {
            this.triggerVibration();
            this.flashScreen();
        }

        this.showSystemNotification();
        this.tryBringToForeground();
    }

    async getServiceWorkerRegistration() {
        if (!("serviceWorker" in navigator)) {
            return null;
        }

        try {
            const existing = await navigator.serviceWorker.getRegistration();
            if (existing) {
                return existing;
            }

            return await navigator.serviceWorker.ready;
        } catch (error) {
            console.warn("[NotificationManager] Service worker registration unavailable:", error);
            return null;
        }
    }

    showSystemNotification() {
        if (this.notificationPermission !== "granted" || !this.supportsSystemNotifications()) {
            return;
        }

        const title = "⏱️ Recupero Terminato!";
        const options = {
            body: "Torna ad allenarti! 💪",
            icon: "assets/icon-512.png",
            badge: "assets/icon-192.png",
            vibrate: [500, 200, 500],
            requireInteraction: true,
            tag: "timer-complete",
            renotify: true,
            silent: false
        };

        void (async () => {
            const registration = await this.getServiceWorkerRegistration();

            if (registration?.showNotification) {
                try {
                    await registration.showNotification(title, options);
                    return;
                } catch (error) {
                    console.warn("[NotificationManager] Service worker notification failed:", error);
                }
            }

            this.showFallbackNotification(title, options);
        })();
    }

    showFallbackNotification(title, options) {
        if (!this.canUseNotificationConstructor()) {
            return;
        }

        try {
            const notification = new Notification(title, options);
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
            setTimeout(() => notification.close(), 10000);
        } catch (error) {
            console.warn("[NotificationManager] Notification constructor failed:", error);
        }
    }

    tryBringToForeground() {
        try {
            window.focus();
        } catch (error) {
            console.warn("[NotificationManager] Focus request failed:", error);
        }
    }

    isAudioReady() {
        return Boolean(this.isAudioUnlocked && this.audioCtx && this.audioCtx.state === "running");
    }

    getPlatformInfo() {
        this.refreshPlatformFlags();
        return {
            isIOS: this.isIOS,
            isSafari: this.isSafari,
            isNative: this.isNative,
            isStandalone: this.isStandalone,
            audioUnlocked: this.isAudioUnlocked,
            audioContextState: this.audioCtx?.state || "not created",
            notificationPermission: this.notificationPermission,
            vibrationSupported: "vibrate" in navigator,
            wakeLockSupported: "wakeLock" in navigator,
            wakeLockActive: Boolean(this.wakeLock),
            supportsSystemNotifications: this.supportsSystemNotifications()
        };
    }

    async killAllTimersAndNotifications() {
        console.log(
            `[NotificationManager] Kill switch on ${
                this.isNative ? "native" : this.isIOS ? "iOS web" : "web"
            }`
        );

        try {
            this.stopSilentLoop();
            this.releaseWakeLock();

            if (this.activeTimerWorker) {
                this.activeTimerWorker.postMessage({ action: "stop" });
                this.activeTimerWorker.terminate();
                this.activeTimerWorker = null;
                console.log("[NotificationManager] Timer worker terminated");
            }

            if (this.isNative) {
                await this.killNativeNotifications();
            } else if (this.isIOS) {
                await this.killIOSSession();
            } else {
                await this.killWebNotifications();
            }

            if (this.audioCtx && this.audioCtx.state !== "closed") {
                await this.audioCtx.close();
                this.audioCtx = null;
                this.isAudioUnlocked = false;
                console.log("[NotificationManager] AudioContext closed");
            }

            this.clearMediaSession();
            console.log("[NotificationManager] Kill switch completed");
        } catch (error) {
            console.error("[NotificationManager] Kill switch error:", error);
        }
    }

    async killNativeNotifications() {
        try {
            if (window.Capacitor?.Plugins?.TimerNotification) {
                await window.Capacitor.Plugins.TimerNotification.stopTimer();
                console.log("[NotificationManager] Native timer stopped");
            }

            if (window.Capacitor?.Plugins?.LocalNotifications) {
                const pending = await window.Capacitor.Plugins.LocalNotifications.getPending();
                if (pending.notifications?.length) {
                    const notifications = pending.notifications.map((notification) => ({ id: notification.id }));
                    await window.Capacitor.Plugins.LocalNotifications.cancel({ notifications });
                    console.log(`[NotificationManager] Native notifications cancelled: ${notifications.length}`);
                }
            }
        } catch (error) {
            console.warn("[NotificationManager] Native notification kill failed:", error);
        }
    }

    async killWebNotifications() {
        try {
            const registration = await this.getServiceWorkerRegistration();

            if (registration) {
                const notifications = await registration.getNotifications();
                notifications.forEach((notification) => notification.close());
                registration.active?.postMessage({ type: "CANCEL_ALL_NOTIFICATIONS" });
                console.log(`[NotificationManager] Web notifications closed: ${notifications.length}`);
            }

            this.destroyAudioElements();
        } catch (error) {
            console.warn("[NotificationManager] Web notification kill failed:", error);
        }
    }

    async killIOSSession() {
        console.log("[NotificationManager] iOS session cleanup");

        this.stopSilentLoop();

        if (this.notificationSound) {
            this.notificationSound.pause();
            this.notificationSound.src = "";
            this.notificationSound = null;
        }

        this.destroyAudioElements();
        this.clearMediaSession();

        if (this.audioCtx) {
            try {
                if (this.audioCtx.state !== "closed") {
                    await this.audioCtx.close();
                }
                this.audioCtx = null;
                this.isAudioUnlocked = false;
            } catch (error) {
                console.warn("[NotificationManager] Failed to close AudioContext on iOS:", error);
            }
        }
    }

    destroyAudioElements() {
        const audioElements = document.querySelectorAll("audio");
        audioElements.forEach((element) => {
            try {
                element.pause();
                element.src = "";
                element.remove();
            } catch (error) {
                console.warn("[NotificationManager] Failed to destroy audio element:", error);
            }
        });

        if (audioElements.length) {
            console.log(`[NotificationManager] Audio elements destroyed: ${audioElements.length}`);
        }
    }

    clearMediaSession() {
        if (!("mediaSession" in navigator)) {
            return;
        }

        try {
            navigator.mediaSession.metadata = null;
            navigator.mediaSession.playbackState = "paused";

            const actions = [ "play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward", "stop" ];
            actions.forEach((action) => {
                try {
                    navigator.mediaSession.setActionHandler(action, null);
                } catch (error) {
                    console.warn(`[NotificationManager] Failed to clear MediaSession action ${action}:`, error);
                }
            });

            try {
                navigator.mediaSession.setPositionState(null);
            } catch (error) {
                console.warn("[NotificationManager] Failed to clear MediaSession position state:", error);
            }

            setTimeout(() => {
                try {
                    navigator.mediaSession.metadata = null;
                    navigator.mediaSession.playbackState = "none";
                } catch (error) {
                    console.warn("[NotificationManager] Delayed MediaSession clear failed:", error);
                }
            }, 50);
        } catch (error) {
            console.warn("[NotificationManager] MediaSession clear failed:", error);
        }
    }

    registerTimerWorker(worker) {
        this.activeTimerWorker = worker;
    }
}

export const notificationManager = new NotificationManager();
