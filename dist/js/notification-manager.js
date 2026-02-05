// Notification Manager for Focus Mode
// Enhanced for iOS compatibility with multiple fallback strategies
// v2.0 - Added Cross-Platform Kill Switch for workout completion/abort

export class NotificationManager {
    constructor() {
        this.audioCtx = null;
        this.gainNode = null;
        this.silentOscillator = null;
        this.isAudioUnlocked = false;
        this.notificationPermission = 'default';
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        this.isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
        this.audioElement = null;
        this.notificationSound = null;
        this.wakeLock = null;
        this.activeTimerWorker = null; // Track Web Worker for timer

        this.init();
    }

    async init() {
        if ('Notification' in window) {
            this.notificationPermission = Notification.permission;
        }
        
        // Pre-load notification sound for iOS
        this.preloadNotificationSound();
        
        // Log platform info
        console.log(`📱 Platform: ${this.isIOS ? 'iOS' : 'Other'}, Safari: ${this.isSafari}`);
    }

    // Pre-load notification sound as HTML5 Audio element (works better on iOS)
    preloadNotificationSound() {
        // Create an Audio element with a data URI for the notification sound
        // This is a short beep sound encoded as base64
        this.notificationSound = new Audio();
        
        // Generate a beep sound programmatically and convert to data URI
        this.generateBeepDataURI().then(dataURI => {
            this.notificationSound.src = dataURI;
            this.notificationSound.preload = 'auto';
            this.notificationSound.volume = 1.0;
            
            // iOS requires user interaction to load audio
            this.notificationSound.load();
        });
    }

    // Generate a beep sound as a data URI
    async generateBeepDataURI() {
        return new Promise((resolve) => {
            try {
                const sampleRate = 44100;
                const duration = 0.8; // 800ms total (two beeps)
                const numSamples = Math.floor(sampleRate * duration);
                
                // Create WAV file
                const buffer = new ArrayBuffer(44 + numSamples * 2);
                const view = new DataView(buffer);
                
                // WAV header
                const writeString = (offset, string) => {
                    for (let i = 0; i < string.length; i++) {
                        view.setUint8(offset + i, string.charCodeAt(i));
                    }
                };
                
                writeString(0, 'RIFF');
                view.setUint32(4, 36 + numSamples * 2, true);
                writeString(8, 'WAVE');
                writeString(12, 'fmt ');
                view.setUint32(16, 16, true);
                view.setUint16(20, 1, true);
                view.setUint16(22, 1, true); // Mono
                view.setUint32(24, sampleRate, true);
                view.setUint32(28, sampleRate * 2, true);
                view.setUint16(32, 2, true);
                view.setUint16(34, 16, true);
                writeString(36, 'data');
                view.setUint32(40, numSamples * 2, true);
                
                // Generate two beeps at 880Hz
                const frequency = 880;
                const beepDuration = 0.25; // 250ms per beep
                const pauseDuration = 0.15; // 150ms pause
                
                for (let i = 0; i < numSamples; i++) {
                    const t = i / sampleRate;
                    let sample = 0;
                    
                    // First beep (0 - 0.25s)
                    if (t < beepDuration) {
                        const envelope = Math.min(1, t * 20) * Math.max(0, 1 - (t / beepDuration) * 0.5);
                        sample = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.8;
                    }
                    // Pause (0.25 - 0.4s)
                    // Second beep (0.4 - 0.65s)
                    else if (t >= beepDuration + pauseDuration && t < beepDuration * 2 + pauseDuration) {
                        const t2 = t - beepDuration - pauseDuration;
                        const envelope = Math.min(1, t2 * 20) * Math.max(0, 1 - (t2 / beepDuration) * 0.5);
                        sample = Math.sin(2 * Math.PI * frequency * t2) * envelope * 0.8;
                    }
                    
                    // Convert to 16-bit PCM
                    const pcm = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
                    view.setInt16(44 + i * 2, pcm, true);
                }
                
                // Convert to base64 data URI
                const blob = new Blob([buffer], { type: 'audio/wav' });
                const reader = new FileReader();
                reader.onloadend = () => {
                    resolve(reader.result);
                };
                reader.readAsDataURL(blob);
            } catch (e) {
                console.error('Error generating beep:', e);
                // Fallback to a simple silent audio
                resolve('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAGZGF0YQQAAAAAAA==');
            }
        });
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
        
        // Unlock audio on user interaction
        this.unlockAudio();
        
        // Try to acquire wake lock (keeps screen on)
        this.requestWakeLock();
        
        // Pre-play silent audio to unlock iOS audio
        if (this.isIOS) {
            this.unlockIOSAudio();
        }
    }

    // Special unlock for iOS - must be called from user interaction
    unlockIOSAudio() {
        console.log('🔓 Unlocking iOS audio...');
        
        // Method 1: Play and immediately pause the notification sound
        if (this.notificationSound) {
            this.notificationSound.volume = 0.01;
            const playPromise = this.notificationSound.play();
            if (playPromise) {
                playPromise.then(() => {
                    this.notificationSound.pause();
                    this.notificationSound.currentTime = 0;
                    this.notificationSound.volume = 1.0;
                    console.log('✅ iOS audio unlocked via Audio element');
                }).catch(e => {
                    console.warn('iOS audio unlock failed:', e);
                });
            }
        }
        
        // Method 2: Also unlock AudioContext
        this.unlockAudio();
    }

    // Request Wake Lock to prevent screen from sleeping
    async requestWakeLock() {
        if ('wakeLock' in navigator) {
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('🔒 Wake Lock acquired - screen will stay on');
                
                // Re-acquire if released
                this.wakeLock.addEventListener('release', () => {
                    console.log('Wake Lock released');
                });
            } catch (e) {
                console.log('Wake Lock not available:', e.message);
            }
        }
    }

    // Release Wake Lock
    releaseWakeLock() {
        if (this.wakeLock) {
            this.wakeLock.release();
            this.wakeLock = null;
        }
    }

    // Call this on "Start Rest" or any button click to ensure AudioContext is active
    // NOTE: Su APK nativo, NON creiamo AudioContext - interferisce con app musicali
    unlockAudio() {
        // Su APK nativo, skip AudioContext - lascia le app musicali in pace
        if (this.isNative) {
            console.log('📱 Skipping AudioContext on native app');
            return;
        }
        
        // Crea nuovo AudioContext se non esiste O se è stato chiuso dal kill switch
        if (!this.audioCtx || this.audioCtx.state === 'closed') {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                this.audioCtx = new AudioContext();
                this.isAudioUnlocked = false; // Reset flag per nuovo context
                console.log('🔊 New AudioContext created');
            }
        }

        if (this.audioCtx && (this.audioCtx.state === 'suspended' || !this.isAudioUnlocked)) {
            this.audioCtx.resume().then(() => {
                this.isAudioUnlocked = true;
                // Play a tiny silent buffer to really unlock iOS
                this.playSilence();
                console.log('✅ AudioContext unlocked');
            }).catch(e => console.error("Audio resume failed", e));
        }
    }

    playSilence() {
        if (!this.audioCtx) return;

        try {
            // Create a silent buffer
            const buffer = this.audioCtx.createBuffer(1, 1, 22050);
            const source = this.audioCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(this.audioCtx.destination);
            source.start(0);
        } catch (e) {
            console.warn('playSilence failed:', e);
        }
    }

    // Start playing a silent loop to keep the session active in background
    // This is crucial for iOS to prevent the OS from suspending the app
    // NOTE: Su APK nativo, NON usiamo audio silenzioso - interferisce con app musicali
    startSilentLoop() {
        // Su APK nativo, il TimerService gestisce tutto - non serve audio silenzioso
        if (this.isNative) {
            console.log('📱 Skipping silent loop on native app - using TimerService');
            return;
        }
        
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
            this.gainNode = gain;
            console.log("🔊 Silent audio loop started for background persistence.");
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

    // Play double beep using Web Audio API
    playDoubleBeepWebAudio() {
        this.unlockAudio();
        if (!this.audioCtx) return false;

        try {
            const playTone = (freq, time, duration) => {
                const osc = this.audioCtx.createOscillator();
                const gain = this.audioCtx.createGain();

                osc.type = 'sine';
                osc.frequency.value = freq;
                osc.connect(gain);
                gain.connect(this.audioCtx.destination);

                const now = this.audioCtx.currentTime + time;
                osc.start(now);
                gain.gain.setValueAtTime(0.8, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
                osc.stop(now + duration);
            };

            // First beep
            playTone(880, 0, 0.3);
            // Second beep
            playTone(880, 0.4, 0.3);
            
            return true;
        } catch (e) {
            console.error('Web Audio beep failed:', e);
            return false;
        }
    }

    // Play double beep using HTML5 Audio element (better iOS support)
    playDoubleBeepAudioElement() {
        if (!this.notificationSound) return false;
        
        try {
            this.notificationSound.currentTime = 0;
            this.notificationSound.volume = 1.0;
            
            const playPromise = this.notificationSound.play();
            if (playPromise) {
                playPromise.catch(e => {
                    console.warn('Audio element play failed:', e);
                });
            }
            return true;
        } catch (e) {
            console.error('Audio element beep failed:', e);
            return false;
        }
    }

    // Main beep function - tries multiple methods
    playDoubleBeep() {
        console.log('🔔 Playing notification sound...');
        
        // On iOS, prefer Audio element as it's more reliable
        if (this.isIOS) {
            const audioSuccess = this.playDoubleBeepAudioElement();
            if (!audioSuccess) {
                // Fallback to Web Audio
                this.playDoubleBeepWebAudio();
            }
        } else {
            // On other platforms, try Web Audio first (lower latency)
            const webAudioSuccess = this.playDoubleBeepWebAudio();
            if (!webAudioSuccess) {
                // Fallback to Audio element
                this.playDoubleBeepAudioElement();
            }
        }
    }

    // Trigger vibration (Android only, iOS doesn't support this API)
    triggerVibration() {
        if ("vibrate" in navigator) {
            try {
                // Double vibration pattern: 500ms on, 200ms off, 500ms on
                navigator.vibrate([500, 200, 500]);
                console.log('📳 Vibration triggered');
                return true;
            } catch (e) {
                console.warn('Vibration failed:', e);
                return false;
            }
        }
        return false;
    }

    // iOS alternative to vibration: Use haptic feedback if available (requires native app)
    // For PWA, we can only rely on audio
    triggerIOSFeedback() {
        // On iOS, we can't vibrate, so we play a more prominent sound
        // and show a visual indicator
        
        // Play sound multiple times for emphasis
        this.playDoubleBeep();
        
        // Flash the screen (visual feedback)
        this.flashScreen();
        
        // Try to use the Vibration API anyway (might work on some iOS versions)
        if ("vibrate" in navigator) {
            try {
                navigator.vibrate([100, 50, 100]);
            } catch (e) {
                // Expected to fail on iOS
            }
        }
    }

    // Flash the screen as visual feedback (useful when audio might not work)
    flashScreen() {
        const flash = document.createElement('div');
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
        
        // Add animation keyframes if not already present
        if (!document.getElementById('flashAnimStyle')) {
            const style = document.createElement('style');
            style.id = 'flashAnimStyle';
            style.textContent = `
                @keyframes flashAnim {
                    0% { opacity: 1; }
                    100% { opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(flash);
        
        // Remove after animation
        setTimeout(() => {
            flash.remove();
        }, 500);
    }

    // Main notification trigger - handles all platforms
    triggerNotification() {
        console.log('🔔 Triggering notification...');
        
        // 1. Audio (works on all platforms if unlocked)
        this.playDoubleBeep();
        
        // 2. Vibration (Android only)
        if (!this.isIOS) {
            this.triggerVibration();
        } else {
            // iOS alternative feedback
            this.triggerIOSFeedback();
        }
        
        // 3. Visual feedback (all platforms)
        this.flashScreen();

        // 4. System Notification (if permitted)
        this.showSystemNotification();
        
        // 5. Try to bring app to foreground (limited support)
        this.tryBringToForeground();
    }

    // Show system notification
    showSystemNotification() {
        if ("Notification" in window && this.notificationPermission === 'granted') {
            const title = "⏱️ Recupero Terminato!";
            const options = {
                body: "Torna ad allenarti! 💪",
                icon: "assets/icon.svg",
                badge: "assets/icon.svg",
                vibrate: [500, 200, 500], // Android only
                requireInteraction: true,
                tag: 'timer-complete',
                renotify: true,
                silent: false // Ensure notification sound plays
            };

            // Try Service Worker first (better for background)
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.ready.then(registration => {
                    registration.showNotification(title, options).catch(e => {
                        console.warn('SW Notification failed:', e);
                        this.showFallbackNotification(title, options);
                    });
                }).catch(e => {
                    console.warn('SW ready failed:', e);
                    this.showFallbackNotification(title, options);
                });
            } else {
                this.showFallbackNotification(title, options);
            }
        }
    }

    // Fallback notification using Notification API directly
    showFallbackNotification(title, options) {
        try {
            const notification = new Notification(title, options);
            
            // Auto-close after 10 seconds
            setTimeout(() => {
                notification.close();
            }, 10000);
            
            // Handle click - bring app to foreground
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
        } catch (e) {
            console.error('Notification API failed:', e);
        }
    }

    // Try to bring the app to foreground (limited browser support)
    tryBringToForeground() {
        try {
            // This might work if the window is minimized but not if the browser is in background
            window.focus();
            
            // For PWA, try to use the Window Management API if available
            if ('getScreenDetails' in window) {
                // Future API for better window management
            }
        } catch (e) {
            // Expected to fail in most cases
        }
    }

    // Check if audio is ready to play
    isAudioReady() {
        return this.isAudioUnlocked && this.audioCtx && this.audioCtx.state === 'running';
    }

    // Get platform info for debugging
    getPlatformInfo() {
        return {
            isIOS: this.isIOS,
            isSafari: this.isSafari,
            isNative: this.isNative,
            audioUnlocked: this.isAudioUnlocked,
            audioContextState: this.audioCtx?.state || 'not created',
            notificationPermission: this.notificationPermission,
            vibrationSupported: 'vibrate' in navigator,
            wakeLockSupported: 'wakeLock' in navigator,
            wakeLockActive: !!this.wakeLock
        };
    }

    // ============================================
    // CROSS-PLATFORM KILL SWITCH v2.0
    // Chiamare su workout complete/abort
    // ============================================

    /**
     * Kill Switch Totale - Ferma tutto e pulisce le notifiche
     * Differenziato per piattaforma:
     * - APK Nativo: Termina Foreground Service
     * - PWA Android: Service Worker cancel notification
     * - PWA iOS: Distrugge audio loop + nullifica MediaSession
     */
    async killAllTimersAndNotifications() {
        console.log('🔴 KILL SWITCH ATTIVATO - Piattaforma:', this.isNative ? 'Native' : (this.isIOS ? 'iOS' : 'Web'));

        try {
            // 1. Stop silent audio loop (CRUCIALE per iOS)
            this.stopSilentLoop();

            // 2. Release Wake Lock
            this.releaseWakeLock();

            // 3. Terminate Web Worker timer se attivo
            if (this.activeTimerWorker) {
                this.activeTimerWorker.postMessage({ action: 'stop' });
                this.activeTimerWorker.terminate();
                this.activeTimerWorker = null;
                console.log('✅ Timer Web Worker terminato');
            }

            // 4. Platform-specific notification cleanup
            if (this.isNative) {
                await this.killNativeNotifications();
            } else if (this.isIOS) {
                await this.killIOSSession();
            } else {
                await this.killWebNotifications();
            }

            // 5. Close AudioContext completamente
            if (this.audioCtx && this.audioCtx.state !== 'closed') {
                await this.audioCtx.close();
                this.audioCtx = null;
                this.isAudioUnlocked = false;
                console.log('✅ AudioContext chiuso');
            }

            // 6. Clear any persistent media session
            this.clearMediaSession();

            console.log('✅ KILL SWITCH COMPLETATO');
        } catch (error) {
            console.error('❌ Kill Switch error:', error);
        }
    }

    /**
     * APK Nativo - Termina Foreground Service
     */
    async killNativeNotifications() {
        try {
            // Via Capacitor Plugin - TimerNotification
            if (window.Capacitor?.Plugins?.TimerNotification) {
                await window.Capacitor.Plugins.TimerNotification.stopTimer();
                console.log('✅ Native Foreground Service terminato');
            }

            // Via LocalNotifications - cancel all timer notifications
            if (window.Capacitor?.Plugins?.LocalNotifications) {
                const pending = await window.Capacitor.Plugins.LocalNotifications.getPending();
                if (pending.notifications?.length > 0) {
                    const ids = pending.notifications.map(n => n.id);
                    await window.Capacitor.Plugins.LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) });
                    console.log('✅ Notifiche locali native cancellate:', ids.length);
                }
            }
        } catch (e) {
            console.warn('Native notification kill failed:', e);
        }
    }

    /**
     * PWA Android - Cancel via Service Worker
     */
    async killWebNotifications() {
        try {
            // Method 1: Service Worker getNotifications
            if (navigator.serviceWorker?.controller) {
                const registration = await navigator.serviceWorker.ready;
                const notifications = await registration.getNotifications({ tag: 'timer-complete' });
                notifications.forEach(n => n.close());
                console.log('✅ SW Notifications chiuse:', notifications.length);
                
                // Prova anche senza tag per catturare tutte le notifiche
                const allNotifications = await registration.getNotifications();
                allNotifications.forEach(n => n.close());

                // Invia messaggio al SW per cancellare tutto
                registration.active?.postMessage({ type: 'CANCEL_ALL_NOTIFICATIONS' });
            }

            // Method 2: Distruggi TUTTI gli elementi audio nella pagina
            const allAudio = document.querySelectorAll('audio');
            allAudio.forEach(el => {
                try {
                    el.pause();
                    el.src = '';
                    el.remove();
                } catch (e) {}
            });
            if (allAudio.length > 0) {
                console.log(`✅ Destroyed ${allAudio.length} audio elements`);
            }
        } catch (e) {
            console.warn('Web notification kill failed:', e);
        }
    }

    /**
     * iOS Safari - Distrugge audio loop e MediaSession
     * CRITICO: iOS rimuove automaticamente il widget lockscreen quando non c'è audio attivo
     */
    async killIOSSession() {
        console.log('🍎 iOS Kill Switch...');

        // 1. Stop silent oscillator (MUST do first)
        this.stopSilentLoop();

        // 2. Stop e rimuovi audio element
        if (this.notificationSound) {
            this.notificationSound.pause();
            this.notificationSound.src = '';
            this.notificationSound = null;
        }

        // 3. Distruggi TUTTI gli AudioElement nella pagina
        const audioElements = document.querySelectorAll('audio');
        audioElements.forEach(el => {
            try {
                el.pause();
                el.src = '';
                el.remove();
            } catch (e) {}
        });
        console.log(`✅ Destroyed ${audioElements.length} audio elements`);

        // 4. Nullifica MediaSession metadata (rimuove widget lockscreen)
        this.clearMediaSession();

        // 5. Close AudioContext se esiste (non solo suspend)
        if (this.audioCtx) {
            try {
                if (this.audioCtx.state !== 'closed') {
                    await this.audioCtx.close();
                }
                this.audioCtx = null;
                this.isAudioUnlocked = false;
            } catch (e) {}
        }

        console.log('✅ iOS session killed - lockscreen widget dovrebbe scomparire');
    }

    /**
     * Pulisce MediaSession - Rimuove controlli lockscreen
     * v2.1 - Pulizia più aggressiva con retry per Chrome Android
     */
    clearMediaSession() {
        if ('mediaSession' in navigator) {
            try {
                // Imposta metadata a null per rimuovere dal lockscreen
                navigator.mediaSession.metadata = null;
                
                // Chrome Android a volte richiede la sequenza: paused -> none
                navigator.mediaSession.playbackState = 'paused';
                
                // Rimuovi action handlers
                const actions = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'stop'];
                actions.forEach(action => {
                    try {
                        navigator.mediaSession.setActionHandler(action, null);
                    } catch (e) {
                        // Ignora se l'azione non è supportata
                    }
                });
                
                // Prova a resettare position state
                try {
                    navigator.mediaSession.setPositionState(null);
                } catch (e) {}

                // Delay e secondo tentativo per Chrome Android
                setTimeout(() => {
                    try {
                        navigator.mediaSession.metadata = null;
                        navigator.mediaSession.playbackState = 'none';
                    } catch (e) {}
                }, 50);

                console.log('✅ MediaSession cleared');
            } catch (e) {
                console.warn('MediaSession clear failed:', e);
            }
        }
    }

    /**
     * Registra il Web Worker del timer per poterlo terminare
     */
    registerTimerWorker(worker) {
        this.activeTimerWorker = worker;
    }
}

export const notificationManager = new NotificationManager();
