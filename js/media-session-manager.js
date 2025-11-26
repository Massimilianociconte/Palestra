// Media Session Manager for Lockscreen Controls
// Provides lockscreen timer display and controls for Focus Mode
// UPDATED: Enhanced for better lockscreen support on Android and iOS
// UPDATED: Added native Android foreground service support

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
        this.nativePlugin = null;
        this.isNative = this.checkIfNative();
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
            console.log('📱 Running in native app - using foreground service for lockscreen');
        }
        
        if ('mediaSession' in navigator) {
            console.log('Media Session API available - initializing lockscreen support');
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
    setupActionHandlers() {
        if ('mediaSession' in navigator) {
            // Play/Pause for timer control
            navigator.mediaSession.setActionHandler('play', () => {
                console.log('Media Session: Play pressed');
                this.onPlayPause?.(true);
                if (this.audioElement && this.audioElement.paused) {
                    this.audioElement.play().catch(e => console.log('Play failed:', e));
                }
                navigator.mediaSession.playbackState = 'playing';
            });

            navigator.mediaSession.setActionHandler('pause', () => {
                console.log('Media Session: Pause pressed');
                this.onPlayPause?.(false);
                // Don't actually pause the audio - we need it for lockscreen
                // Just update the state
                navigator.mediaSession.playbackState = 'paused';
            });

            // Next/Previous for exercise navigation
            navigator.mediaSession.setActionHandler('previoustrack', () => {
                console.log('Media Session: Previous pressed');
                this.onPrevious?.();
            });

            navigator.mediaSession.setActionHandler('nexttrack', () => {
                console.log('Media Session: Next pressed');
                this.onNext?.();
            });

            // Seek handlers (for scrubbing the timer)
            try {
                navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                    console.log('Media Session: Seek backward', details);
                    this.onSeekBackward?.(details?.seekOffset || 10);
                });

                navigator.mediaSession.setActionHandler('seekforward', (details) => {
                    console.log('Media Session: Seek forward', details);
                    this.onSeekForward?.(details?.seekOffset || 10);
                });
            } catch (e) {
                console.log('Seek handlers not supported');
            }

            // Set initial playback state
            navigator.mediaSession.playbackState = 'none';
        }
    }

    // Start workout session (MUST be called from user interaction like button click)
    async startWorkout(workoutName) {
        this.isActive = true;
        this.currentWorkoutName = workoutName;
        
        // Update metadata first
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

        // Keep playing state to maintain lockscreen session
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'playing';
        }
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
