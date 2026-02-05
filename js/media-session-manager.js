// Media Session Manager for Lockscreen Controls
// Provides lockscreen timer display and controls for Focus Mode
// UPDATED: Enhanced for better lockscreen support on Android and iOS
// UPDATED: Added native Android foreground service support
// v2.0: Added Play after Pause fix and Kill Switch integration

export class MediaSessionManager {
    constructor() {
        this.isActive = false;
        this.currentWorkoutName = 'Allenamento';
        this.currentExercise = '';
        this.currentSet = 1;
        this.totalSets = 3;
        this.timerValue = 0;
        this.timerInterval = null;
        this.audioElement = null;
        this.audioContext = null;
        this.oscillator = null;
        this.gainNode = null;
        this.isPlaying = false;
        this.isPaused = false; // Track pause state for Play fix
        this.nativePlugin = null;
        this.isNative = this.checkIfNative();
        this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    }
    
    // Check if running in Capacitor native app
    checkIfNative() {
        return typeof window !== 'undefined' && 
               window.Capacitor && 
               window.Capacitor.isNativePlatform();
    }
    
    // Initialize native plugin
    async initNativePlugin() {
        if (!this.isNative) return;
        
        try {
            // Use global Capacitor object instead of dynamic import
            if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.TimerNotification) {
                this.nativePlugin = window.Capacitor.Plugins.TimerNotification;
                console.log('✅ Native Timer Plugin found via Capacitor.Plugins');
            } else if (window.Capacitor && window.Capacitor.registerPlugin) {
                this.nativePlugin = window.Capacitor.registerPlugin('TimerNotification');
                console.log('✅ Native Timer Plugin registered via Capacitor.registerPlugin');
            } else {
                throw new Error('Capacitor not available');
            }
            
            // Set up event listeners
            if (this.nativePlugin.addListener) {
                this.nativePlugin.addListener('timerTick', (data) => {
                    this.timerValue = data.remaining;
                });
                
                this.nativePlugin.addListener('timerComplete', () => {
                    this.onTimerComplete?.();
                });
            }
            
            console.log('✅ Native Timer Plugin initialized for lockscreen');
        } catch (e) {
            console.log('Native Timer Plugin not available:', e.message);
            this.isNative = false;
            this.nativePlugin = null;
        }
    }

    // Initialize Media Session
    async init() {
        // Initialize native plugin first if available
        if (this.isNative) {
            await this.initNativePlugin();
            console.log('📱 Running in native app - using ONLY foreground service for lockscreen');
            console.log('📱 MediaSession web DISABLED to avoid interfering with music apps');
            // Su APK nativo, NON usiamo la MediaSession web
            // Il TimerService nativo gestisce la notifica
            // Questo permette alle app musicali di mantenere il controllo delle cuffie
            return;
        }
        
        // Solo su PWA/Web usiamo la MediaSession
        if ('mediaSession' in navigator) {
            console.log('Media Session API available - initializing lockscreen support (PWA mode)');
            this.createPersistentAudio();
            this.setupActionHandlers();
            
            // Set default metadata
            this.updateMetadata({
                title: 'GymBro',
                artist: 'Focus Mode',
                album: 'Allenamento'
            });
        } else {
            console.warn('Media Session API not supported on this browser');
        }
    }

    // Create persistent audio that keeps the media session alive on lockscreen
    createPersistentAudio() {
        // Su APK nativo, NON creare audio - lascia le app musicali in pace
        if (this.isNative) {
            console.log('📱 Skipping persistent audio creation (native mode)');
            return;
        }
        
        // Method 1: Create an Audio element with a longer silent audio
        // This is a 10-second silent WAV file encoded in base64
        // The longer duration helps maintain the session on lockscreen
        this.audioElement = document.createElement('audio');
        
        // Generate a longer silent audio using Web Audio API
        this.generateSilentAudioBlob().then(blob => {
            this.audioElement.src = URL.createObjectURL(blob);
            this.audioElement.loop = true;
            this.audioElement.volume = 0.01; // Nearly silent but not zero (some browsers ignore zero volume)
            this.audioElement.preload = 'auto';
            
            // Important: Set attributes for background playback
            this.audioElement.setAttribute('playsinline', '');
            this.audioElement.setAttribute('webkit-playsinline', '');
            
            document.body.appendChild(this.audioElement);
            console.log('Persistent audio element created for lockscreen');
        });
    }

    // Generate a silent audio blob using Web Audio API
    async generateSilentAudioBlob() {
        return new Promise((resolve) => {
            // Create a 30-second silent audio buffer
            const sampleRate = 44100;
            const duration = 30; // 30 seconds
            const numChannels = 2;
            const numSamples = sampleRate * duration;
            
            // Create WAV file header and data
            const buffer = new ArrayBuffer(44 + numSamples * numChannels * 2);
            const view = new DataView(buffer);
            
            // WAV header
            const writeString = (offset, string) => {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            };
            
            writeString(0, 'RIFF');
            view.setUint32(4, 36 + numSamples * numChannels * 2, true);
            writeString(8, 'WAVE');
            writeString(12, 'fmt ');
            view.setUint32(16, 16, true); // Subchunk1Size
            view.setUint16(20, 1, true); // AudioFormat (PCM)
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * 2, true); // ByteRate
            view.setUint16(32, numChannels * 2, true); // BlockAlign
            view.setUint16(34, 16, true); // BitsPerSample
            writeString(36, 'data');
            view.setUint32(40, numSamples * numChannels * 2, true);
            
            // Silent audio data (all zeros = silence)
            // Data is already zero-initialized in ArrayBuffer
            
            resolve(new Blob([buffer], { type: 'audio/wav' }));
        });
    }

    // Start playing audio to activate media session (MUST be called from user interaction)
    async startAudioSession() {
        // Su APK nativo, non avviare audio session - il servizio nativo gestisce tutto
        if (this.isNative) {
            console.log('📱 Skipping web audio session (native mode)');
            return true;
        }
        
        if (!this.audioElement) {
            console.warn('Audio element not ready');
            return false;
        }

        try {
            // Play the audio element
            await this.audioElement.play();
            this.isPlaying = true;
            
            // Set playback state
            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'playing';
            }
            
            console.log('✅ Audio session started - lockscreen should now show controls');
            return true;
        } catch (error) {
            console.error('Failed to start audio session:', error);
            return false;
        }
    }

    // Update metadata with current workout info
    updateMetadata({ title, artist, album, artwork }) {
        // Su APK nativo, non toccare la MediaSession
        if (this.isNative) return;
        
        if ('mediaSession' in navigator) {
            try {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: title || this.currentExercise || 'Allenamento',
                    artist: artist || `Set ${this.currentSet}/${this.totalSets}`,
                    album: album || this.currentWorkoutName,
                    artwork: artwork || [
                        {
                            src: 'assets/icon.svg',
                            sizes: '512x512',
                            type: 'image/svg+xml'
                        }
                    ]
                });
            } catch (e) {
                console.warn('Failed to update media metadata:', e);
            }
        }
    }

    // Set up action handlers for media controls
    // NOTA: Non registriamo più play/pause handler per non interferire con app musicali
    // GymBro usa MediaSession SOLO per mostrare info sulla lockscreen, non per controlli
    setupActionHandlers() {
        // Su APK nativo, non registrare nessun handler
        if (this.isNative) return;
        
        if ('mediaSession' in navigator) {
            // NON registriamo play/pause - lasciamo che l'app musicale li gestisca
            // Questo permette alle cuffie di controllare la musica invece di GymBro
            
            // Solo handler per navigazione esercizi (opzionali, meno invasivi)
            try {
                navigator.mediaSession.setActionHandler('previoustrack', () => {
                    console.log('Media Session: Previous pressed - adjusting timer');
                    this.onPrevious?.();
                });

                navigator.mediaSession.setActionHandler('nexttrack', () => {
                    console.log('Media Session: Next pressed - skipping timer');
                    this.onNext?.();
                });
            } catch (e) {
                console.log('Track handlers not supported');
            }

            // Set initial playback state to 'none' - non interferisce con altre app
            navigator.mediaSession.playbackState = 'none';
            
            console.log('📱 MediaSession setup: Display-only mode (no play/pause capture)');
        }
    }

    // FIX v2.0: Reinizializza audio dopo pause prolungata
    async reinitializeAudioAfterPause() {
        console.log('🔄 Reinitializing audio after pause...');
        
        // 1. Resume AudioContext se sospeso
        if (this.audioContext && this.audioContext.state === 'suspended') {
            try {
                await this.audioContext.resume();
                console.log('✅ AudioContext resumed');
            } catch (e) {
                console.warn('AudioContext resume failed:', e);
            }
        }
        
        // 2. Su iOS, potremmo dover ricreare l'elemento audio
        if (this.isIOS && this.audioElement) {
            // Check if audio is in a bad state
            if (this.audioElement.error || this.audioElement.networkState === 3) {
                await this.recreateAudioElement();
            }
        }
    }

    // Ricrea l'elemento audio (per recovery da stati invalidi)
    async recreateAudioElement() {
        console.log('🔄 Recreating audio element...');
        
        // Remove old element
        if (this.audioElement) {
            this.audioElement.pause();
            this.audioElement.src = '';
            this.audioElement.remove();
        }
        
        // Regenerate
        await this.createPersistentAudio();
        
        // Start playing
        if (this.audioElement) {
            await this.audioElement.play().catch(e => console.log('Recreated audio play failed:', e));
        }
    }

    // Start workout session (MUST be called from user interaction like button click)
    async startWorkout(workoutName) {
        this.isActive = true;
        this.currentWorkoutName = workoutName;
        
        // Su APK nativo, non usiamo MediaSession web - il servizio nativo gestisce tutto
        if (this.isNative) {
            console.log('🏋️ Workout session started (native mode - no web MediaSession)');
            return true;
        }
        
        // Update metadata first (solo PWA/Web)
        this.updateMetadata({
            title: workoutName,
            artist: 'GymBro Focus Mode',
            album: 'Allenamento in corso'
        });

        // Start audio session (this activates the lockscreen controls)
        const success = await this.startAudioSession();
        
        if (success) {
            console.log('🏋️ Workout session started with lockscreen support');
        } else {
            console.warn('⚠️ Lockscreen support may not work - audio session failed');
        }

        return success;
    }

    // Update current exercise
    updateExercise(exerciseName, currentSet, totalSets) {
        this.currentExercise = exerciseName;
        this.currentSet = currentSet;
        this.totalSets = totalSets;

        this.updateMetadata({
            title: `💪 ${exerciseName}`,
            artist: `Set ${currentSet}/${totalSets}`,
            album: this.currentWorkoutName
        });

        // Update position state to show progress
        this.updatePositionState(currentSet, totalSets);
    }

    // Update position state (shows progress bar on lockscreen)
    updatePositionState(current, total) {
        // Su APK nativo, non toccare la MediaSession
        if (this.isNative) return;
        
        if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            try {
                // Use position state to show set progress
                navigator.mediaSession.setPositionState({
                    duration: total * 60, // Total "duration" based on sets
                    playbackRate: 1,
                    position: current * 60 // Current "position" based on current set
                });
            } catch (e) {
                // Position state not supported or invalid values
            }
        }
    }

    // Update timer display (for rest periods) - THIS IS THE KEY METHOD FOR LOCKSCREEN TIMER
    updateTimer(seconds) {
        this.timerValue = seconds;
        
        // Su APK nativo, il servizio nativo gestisce l'aggiornamento della notifica
        if (this.isNative) return;

        // Format timer text
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        const timerText = `${minutes}:${secs.toString().padStart(2, '0')}`;

        // Update metadata to show timer on lockscreen
        this.updateMetadata({
            title: `⏱️ Riposo: ${timerText}`,
            artist: `Prossimo: ${this.currentExercise || 'Set successivo'}`,
            album: this.currentWorkoutName
        });

        // Update position state to show timer progress
        if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
            try {
                // This creates a progress bar on the lockscreen
                // Duration = initial timer value, Position = elapsed time
                const initialDuration = this.initialTimerDuration || seconds;
                const elapsed = initialDuration - seconds;
                
                navigator.mediaSession.setPositionState({
                    duration: initialDuration,
                    playbackRate: 1,
                    position: Math.max(0, elapsed)
                });
            } catch (e) {
                // Ignore errors
            }
        }
    }

    // Start timer countdown on lockscreen
    async startTimerDisplay(initialSeconds, onTick, onComplete) {
        this.stopTimerDisplay(); // Clear any existing timer
        
        this.initialTimerDuration = initialSeconds;
        this.onTimerComplete = onComplete;
        let remainingSeconds = initialSeconds;
        
        // Use native plugin if available (Android foreground service)
        if (this.isNative && this.nativePlugin) {
            try {
                await this.nativePlugin.startTimer({
                    seconds: initialSeconds,
                    exercise: this.currentExercise || 'Prossimo esercizio',
                    workout: this.currentWorkoutName
                });
                console.log(`⏱️ Native timer started: ${initialSeconds}s - lockscreen notification active`);
                
                // Still run local interval for UI updates
                this.timerInterval = setInterval(() => {
                    remainingSeconds--;
                    if (remainingSeconds >= 0) {
                        onTick?.(remainingSeconds);
                    }
                    if (remainingSeconds <= 0) {
                        this.stopTimerDisplay();
                        onComplete?.();
                    }
                }, 1000);
                
                return;
            } catch (e) {
                console.log('Native timer failed, falling back to web:', e);
            }
        }
        
        // Fallback: Web-based timer with Media Session API
        // REINIT: Se l'audio element è stato distrutto dal kill switch, ricrealo
        if (!this.audioElement && !this.isNative) {
            console.log('🔄 Recreating persistent audio after kill...');
            this.createPersistentAudio();
            this.setupActionHandlers();
            // Aspetta che l'audio sia pronto
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Initial update
        this.updateTimer(remainingSeconds);
        
        // Ensure audio is playing for lockscreen
        if (this.audioElement && this.audioElement.paused) {
            this.audioElement.play().catch(e => console.log('Audio play failed:', e));
        }

        // Set playback state to playing
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }

        // Start countdown interval
        this.timerInterval = setInterval(() => {
            remainingSeconds--;
            
            if (remainingSeconds >= 0) {
                this.updateTimer(remainingSeconds);
                onTick?.(remainingSeconds);
            }

            if (remainingSeconds <= 0) {
                this.stopTimerDisplay();
                
                // Update metadata to show timer complete
                this.updateMetadata({
                    title: '✅ Riposo completato!',
                    artist: `Inizia: ${this.currentExercise || 'Set successivo'}`,
                    album: this.currentWorkoutName
                });
                
                onComplete?.();
            }
        }, 1000);

        console.log(`⏱️ Timer started: ${initialSeconds}s - lockscreen should update`);
    }

    // Stop timer display
    stopTimerDisplay() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.initialTimerDuration = null;

        // Stop native timer if running
        if (this.isNative && this.nativePlugin) {
            this.nativePlugin.stopTimer().catch(e => console.log('Stop native timer error:', e));
        }

        // NON mantenere playbackState a 'playing' - causa persistenza della sessione
        // La sessione verrà terminata esplicitamente da killSession() o endWorkout()
    }

    // End workout session
    endWorkout() {
        this.isActive = false;
        this.stopTimerDisplay();

        this.updateMetadata({
            title: '🎉 Allenamento Completato!',
            artist: 'Ottimo lavoro!',
            album: this.currentWorkoutName
        });

        // Stop audio after a short delay
        setTimeout(() => {
            if (this.audioElement) {
                this.audioElement.pause();
            }
            this.isPlaying = false;

            if ('mediaSession' in navigator) {
                navigator.mediaSession.playbackState = 'none';
            }
        }, 3000); // Keep showing "completed" for 3 seconds
    }

    /**
     * KILL SESSION v2.0 - Terminazione immediata e completa
     * Chiamare su abort/cancel workout per rimuovere TUTTO istantaneamente
     */
    async killSession() {
        console.log('🔴 MediaSession KILL - Terminazione immediata...');
        
        this.isActive = false;
        this.isPlaying = false;
        this.isPaused = false;

        // 1. Stop timer interval
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // 2. Stop native timer (Android Foreground Service)
        if (this.isNative && this.nativePlugin) {
            try {
                await this.nativePlugin.stopTimer();
                console.log('✅ Native timer service stopped');
            } catch (e) {
                console.warn('Native timer stop failed:', e);
            }
        }

        // 3. Stop e rimuovi audio element (il nostro)
        if (this.audioElement) {
            try {
                this.audioElement.pause();
                this.audioElement.src = '';
                this.audioElement.remove();
            } catch (e) {}
            this.audioElement = null;
            console.log('✅ Audio element destroyed');
        }
        
        // 3b. WEBAPP FIX: Cerca e distruggi TUTTI gli elementi audio creati da noi
        try {
            const allAudio = document.querySelectorAll('audio');
            allAudio.forEach(el => {
                el.pause();
                el.src = '';
                el.remove();
            });
            if (allAudio.length > 0) {
                console.log(`✅ Destroyed ${allAudio.length} audio elements`);
            }
        } catch (e) {}

        // 4. Stop oscillator se presente
        if (this.oscillator) {
            try {
                this.oscillator.stop();
                this.oscillator.disconnect();
                this.oscillator = null;
            } catch (e) {}
        }

        // 5. Close AudioContext
        if (this.audioContext && this.audioContext.state !== 'closed') {
            try {
                await this.audioContext.close();
                this.audioContext = null;
                console.log('✅ AudioContext closed');
            } catch (e) {}
        }

        // 6. Clear MediaSession completamente (rimuove widget lockscreen)
        // v2.1 - Pulizia più aggressiva per Chrome Android
        if ('mediaSession' in navigator) {
            try {
                // Imposta metadata vuoto/null
                navigator.mediaSession.metadata = null;
                
                // Chrome Android: prima paused, poi none
                navigator.mediaSession.playbackState = 'paused';
                
                // Prova anche a resettare position state
                try {
                    navigator.mediaSession.setPositionState(null);
                } catch (e) {}
                
                // Remove all action handlers
                const actions = ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'stop'];
                actions.forEach(action => {
                    try {
                        navigator.mediaSession.setActionHandler(action, null);
                    } catch (e) {}
                });
                
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

        console.log('✅ MediaSession KILL completato');
    }

    // Pause the session (but keep lockscreen active)
    pauseSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'paused';
        }
        
        this.updateMetadata({
            title: '⏸️ In pausa',
            artist: this.currentExercise || 'Allenamento',
            album: this.currentWorkoutName
        });
    }

    // Resume the session
    resumeSession() {
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }
        
        // Ensure audio is playing
        if (this.audioElement && this.audioElement.paused) {
            this.audioElement.play().catch(e => console.log('Resume audio failed:', e));
        }
    }

    // Set callback for play/pause button
    onPlayPauseCallback(callback) {
        this.onPlayPause = callback;
    }

    // Set callback for previous track
    onPreviousCallback(callback) {
        this.onPrevious = callback;
    }

    // Set callback for next track
    onNextCallback(callback) {
        this.onNext = callback;
    }

    // Set callback for seek backward
    onSeekBackwardCallback(callback) {
        this.onSeekBackward = callback;
    }

    // Set callback for seek forward
    onSeekForwardCallback(callback) {
        this.onSeekForward = callback;
    }

    // Check if lockscreen is supported
    isLockscreenSupported() {
        return 'mediaSession' in navigator;
    }

    // Get current status
    getStatus() {
        return {
            isActive: this.isActive,
            isPlaying: this.isPlaying,
            currentExercise: this.currentExercise,
            currentSet: this.currentSet,
            totalSets: this.totalSets,
            timerValue: this.timerValue,
            lockscreenSupported: this.isLockscreenSupported()
        };
    }
}

// Export singleton instance
export const mediaSessionManager = new MediaSessionManager();
