
export class NotificationManager {
    constructor() {
        this.audioCtx = null;
        this.gainNode = null;
        this.silentOscillator = null;
        this.isAudioUnlocked = false;
        this.notificationPermission = 'default';

        this.init();
    }

    async init() {
        if ('Notification' in window) {
            this.notificationPermission = Notification.permission;
        }
    }

    // Call this on the first user interaction (e.g. Start Workout button)
    async requestPermission() {
        if ('Notification' in window && this.notificationPermission === 'default') {
            try {
                const permission = await Notification.requestPermission();
                this.notificationPermission = permission;
                console.log('Notification permission:', permission);
            } catch (e) {
                console.error('Error requesting notification permission:', e);
            }
        }
        this.unlockAudio();
    }

    // Call this on "Start Rest" or any button click to ensure AudioContext is active
    unlockAudio() {
        if (!this.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.audioCtx = new AudioContext();
            }
        }

        if (this.audioCtx && (this.audioCtx.state === 'suspended' || !this.isAudioUnlocked)) {
            this.audioCtx.resume().then(() => {
                this.isAudioUnlocked = true;
                // Play a tiny silent buffer to really unlock iOS
                this.playSilence();
            }).catch(e => console.error("Audio resume failed", e));
        }
    }

    playSilence() {
        if (!this.audioCtx) return;

        // Create a silent buffer
        const buffer = this.audioCtx.createBuffer(1, 1, 22050);
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.audioCtx.destination);
        source.start(0);
    }

    // Initialize silent audio for iOS background persistence
    initSilentAudio() {
        if (!this.audioCtx) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.audioCtx = new AudioContext();
            }
        }
        this.unlockAudio();
    }

    // Start playing a silent loop to keep the session active in background
    // This is crucial for iOS to prevent the OS from suspending the app
    startSilentLoop() {
        this.unlockAudio();
        if (!this.audioCtx) return;

        // If already running, don't start another
        if (this.silentOscillator) return;

        try {
            // Create a very low frequency oscillator (inaudible)
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.value = 1; // 1Hz (inaudible)

            // Extremely low gain, effectively silent but active
            gain.gain.value = 0.001;

            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            osc.start();
            this.silentOscillator = osc;
            console.log("Silent audio loop started for background persistence.");
        } catch (e) {
            console.error("Failed to start silent loop:", e);
        }
    }

    stopSilentLoop() {
        if (this.silentOscillator) {
            try {
                this.silentOscillator.stop();
                this.silentOscillator.disconnect();
                this.silentOscillator = null;
                console.log("Silent audio loop stopped.");
            } catch (e) {
                console.warn("Error stopping silent loop:", e);
            }
        }
    }

    playDoubleBeep() {
        this.unlockAudio();
        if (!this.audioCtx) return;

        const playTone = (freq, time, duration) => {
            const osc = this.audioCtx.createOscillator();
            const gain = this.audioCtx.createGain();

            osc.type = 'sine';
            osc.frequency.value = freq;
            osc.connect(gain);
            gain.connect(this.audioCtx.destination);

            const now = this.audioCtx.currentTime + time;
            osc.start(now);
            gain.gain.setValueAtTime(1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
            osc.stop(now + duration);
        };

        // First beep
        playTone(880, 0, 0.3);
        // Second beep
        playTone(880, 0.4, 0.3);
    }

    triggerNotification() {
        // 1. Vibration (Android) - Double vibration
        if ("vibrate" in navigator) {
            // Vibrate 500ms, pause 200ms, vibrate 500ms
            navigator.vibrate([500, 200, 500]);
        }

        // 2. Audio
        this.playDoubleBeep();

        // 3. System Notification
        if ("Notification" in window && this.notificationPermission === 'granted') {
            const title = "Recupero Terminato!";
            const options = {
                body: "Torna ad allenarti!",
                icon: "assets/icon.svg",
                vibrate: [500, 200, 500], // Android Notification Vibration
                requireInteraction: true, // Keeps notification on screen
                tag: 'timer-complete'
            };

            // Try Service Worker first (better for background)
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(registration => {
                    registration.showNotification(title, options);
                }).catch(e => {
                    console.error('SW Notification failed', e);
                    // Fallback
                    new Notification(title, options);
                });
            } else {
                try {
                    new Notification(title, options);
                } catch (e) {
                    console.error('Notification API failed', e);
                }
            }
        }
    }
}

export const notificationManager = new NotificationManager();

