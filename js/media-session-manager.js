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

export class MediaSessionManager {
    constructor() {
        this.isActive = false;
        this.currentWorkoutName = "Allenamento";
        this.currentExercise = "";
        this.currentSet = 1;
        this.totalSets = 3;
        this.timerValue = 0;
        this.timerInterval = null;
        this.audioElement = null;
        this.audioReadyPromise = null;
        this.audioBlobUrl = null;
        this.audioContext = null;
        this.oscillator = null;
        this.gainNode = null;
        this.isPlaying = false;
        this.isPaused = false;
        this.timerSessionCounter = 0;
        this.activeTimerSessionId = null;
        this.nativePlugin = null;
        this.initialTimerDuration = null;
        this.onTimerComplete = null;
        this.isNative = this.checkIfNative();
        this.isIOS = detectIOSDevice();
        this.isStandalone = isStandalonePwa();
    }

    checkIfNative() {
        return typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
    }

    async initNativePlugin() {
        if (!this.isNative) {
            return;
        }

        try {
            const capacitor = window.Capacitor;
            if (capacitor?.Plugins?.TimerNotification) {
                this.nativePlugin = capacitor.Plugins.TimerNotification;
                console.log("[MediaSessionManager] Native timer plugin found via Capacitor.Plugins");
            } else if (typeof capacitor?.registerPlugin === "function") {
                this.nativePlugin = capacitor.registerPlugin("TimerNotification");
                console.log("[MediaSessionManager] Native timer plugin registered dynamically");
            } else {
                throw new Error("Capacitor not available");
            }

            if (this.nativePlugin.addListener) {
                this.nativePlugin.addListener("timerTick", (data) => {
                    this.timerValue = data.remaining;
                });

                this.nativePlugin.addListener("timerComplete", () => {
                    if (this.activeTimerSessionId === null) {
                        return;
                    }

                    this.stopTimerDisplay();
                    this.onTimerComplete?.();
                });
            }

            console.log("[MediaSessionManager] Native timer plugin initialized");
        } catch (error) {
            console.log("[MediaSessionManager] Native timer plugin unavailable:", error.message);
            this.isNative = false;
            this.nativePlugin = null;
        }
    }

    async init() {
        if (this.isNative) {
            await this.initNativePlugin();
            console.log("[MediaSessionManager] Native app mode: using foreground service only");
            return;
        }

        if (!("mediaSession" in navigator)) {
            console.warn("[MediaSessionManager] Media Session API unavailable");
            return;
        }

        await this.createPersistentAudio();
        this.setupActionHandlers();
        this.updateMetadata({
            title: "GymBro",
            artist: "Focus Mode",
            album: "Allenamento"
        });
        console.log(
            `[MediaSessionManager] Web mode initialized, standalone=${this.isStandalone}, ios=${this.isIOS}`
        );
    }

    async createPersistentAudio(forceRecreate = false) {
        if (this.isNative) {
            return null;
        }

        if (!forceRecreate && this.audioElement && this.audioReadyPromise) {
            return this.audioReadyPromise;
        }

        if (forceRecreate) {
            this.destroyAudioElement();
        }

        const audio = document.createElement("audio");
        audio.loop = true;
        audio.volume = 0.01;
        audio.preload = "auto";
        audio.setAttribute("playsinline", "");
        audio.setAttribute("webkit-playsinline", "");
        audio.style.display = "none";

        this.audioElement = audio;
        this.audioReadyPromise = this.generateSilentAudioBlob().then((blob) => new Promise((resolve) => {
            let settled = false;

            const finish = () => {
                if (settled) {
                    return;
                }

                settled = true;
                audio.removeEventListener("canplaythrough", finish);
                audio.removeEventListener("loadeddata", finish);
                audio.removeEventListener("error", handleError);

                if (!audio.isConnected) {
                    document.body.appendChild(audio);
                }

                resolve(audio);
            };

            const handleError = (error) => {
                console.warn("[MediaSessionManager] Silent audio failed to preload:", error);
                finish();
            };

            if (this.audioBlobUrl) {
                URL.revokeObjectURL(this.audioBlobUrl);
            }

            this.audioBlobUrl = URL.createObjectURL(blob);

            audio.addEventListener("canplaythrough", finish, { once: true });
            audio.addEventListener("loadeddata", finish, { once: true });
            audio.addEventListener("error", handleError, { once: true });
            audio.src = this.audioBlobUrl;

            if (!audio.isConnected) {
                document.body.appendChild(audio);
            }

            audio.load();

            // The generated audio is local and tiny; this keeps slow Safari devices deterministic.
            setTimeout(finish, 150);
        }));

        return this.audioReadyPromise;
    }

    async generateSilentAudioBlob() {
        return new Promise((resolve) => {
            const sampleRate = 44100;
            const duration = 30;
            const numChannels = 2;
            const numSamples = sampleRate * duration;
            const buffer = new ArrayBuffer(44 + (numSamples * numChannels * 2));
            const view = new DataView(buffer);
            const writeString = (offset, string) => {
                for (let i = 0; i < string.length; i++) {
                    view.setUint8(offset + i, string.charCodeAt(i));
                }
            };

            writeString(0, "RIFF");
            view.setUint32(4, 36 + (numSamples * numChannels * 2), true);
            writeString(8, "WAVE");
            writeString(12, "fmt ");
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, numChannels, true);
            view.setUint32(24, sampleRate, true);
            view.setUint32(28, sampleRate * numChannels * 2, true);
            view.setUint16(32, numChannels * 2, true);
            view.setUint16(34, 16, true);
            writeString(36, "data");
            view.setUint32(40, numSamples * numChannels * 2, true);

            resolve(new Blob([buffer], { type: "audio/wav" }));
        });
    }

    async startAudioSession() {
        if (this.isNative) {
            console.log("[MediaSessionManager] Skipping web audio session on native app");
            return true;
        }

        await this.createPersistentAudio();

        if (!this.audioElement) {
            console.warn("[MediaSessionManager] Audio element not ready");
            return false;
        }

        try {
            await this.audioReadyPromise;
            await this.audioElement.play();
            this.isPlaying = true;

            if ("mediaSession" in navigator) {
                navigator.mediaSession.playbackState = "playing";
            }

            console.log("[MediaSessionManager] Audio session started");
            return true;
        } catch (error) {
            console.error("[MediaSessionManager] Failed to start audio session:", error);
            return false;
        }
    }

    updateMetadata({ title, artist, album, artwork }) {
        if (this.isNative || !("mediaSession" in navigator)) {
            return;
        }

        try {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: title || this.currentExercise || "Allenamento",
                artist: artist || `Set ${this.currentSet}/${this.totalSets}`,
                album: album || this.currentWorkoutName,
                artwork: artwork || [
                    { src: "assets/icon-192.png", sizes: "192x192", type: "image/png" },
                    { src: "assets/icon-512.png", sizes: "512x512", type: "image/png" }
                ]
            });
        } catch (error) {
            console.warn("[MediaSessionManager] Failed to update metadata:", error);
        }
    }

    setupActionHandlers() {
        if (this.isNative || !("mediaSession" in navigator)) {
            return;
        }

        try {
            navigator.mediaSession.setActionHandler("previoustrack", () => {
                console.log("[MediaSessionManager] Previous track pressed");
                this.onPrevious?.();
            });

            navigator.mediaSession.setActionHandler("nexttrack", () => {
                console.log("[MediaSessionManager] Next track pressed");
                this.onNext?.();
            });
        } catch (error) {
            console.log("[MediaSessionManager] Track handlers not supported:", error);
        }

        navigator.mediaSession.playbackState = "none";
        console.log("[MediaSessionManager] Display-only mode enabled");
    }

    async reinitializeAudioAfterPause() {
        console.log("[MediaSessionManager] Reinitializing audio after pause");

        if (this.audioContext?.state === "suspended") {
            try {
                await this.audioContext.resume();
                console.log("[MediaSessionManager] AudioContext resumed");
            } catch (error) {
                console.warn("[MediaSessionManager] AudioContext resume failed:", error);
            }
        }

        if (this.isIOS && this.audioElement && (this.audioElement.error || this.audioElement.networkState === 3)) {
            await this.recreateAudioElement();
        }
    }

    async recreateAudioElement() {
        console.log("[MediaSessionManager] Recreating persistent audio element");
        this.destroyAudioElement();
        await this.createPersistentAudio(true);

        if (this.audioElement) {
            await this.audioElement.play().catch((error) => {
                console.log("[MediaSessionManager] Recreated audio play failed:", error);
            });
        }
    }

    async startWorkout(workoutName) {
        this.isActive = true;
        this.currentWorkoutName = workoutName;

        if (this.isNative) {
            console.log("[MediaSessionManager] Native workout session started");
            return true;
        }

        this.updateMetadata({
            title: workoutName,
            artist: "GymBro Focus Mode",
            album: "Allenamento in corso"
        });

        const success = await this.startAudioSession();
        if (success) {
            console.log("[MediaSessionManager] Workout session started with lockscreen support");
        } else {
            console.warn("[MediaSessionManager] Lockscreen support may be degraded");
        }

        return success;
    }

    updateExercise(exerciseName, currentSet, totalSets) {
        this.currentExercise = exerciseName;
        this.currentSet = currentSet;
        this.totalSets = totalSets;

        this.updateMetadata({
            title: `💪 ${exerciseName}`,
            artist: `Set ${currentSet}/${totalSets}`,
            album: this.currentWorkoutName
        });

        this.updatePositionState(currentSet, totalSets);
    }

    updatePositionState(current, total) {
        if (this.isNative || !("mediaSession" in navigator) || !("setPositionState" in navigator.mediaSession)) {
            return;
        }

        try {
            navigator.mediaSession.setPositionState({
                duration: total * 60,
                playbackRate: 1,
                position: current * 60
            });
        } catch (error) {
            console.warn("[MediaSessionManager] Position state update failed:", error);
        }
    }

    updateTimer(seconds) {
        this.timerValue = seconds;
        if (this.isNative) {
            return;
        }

        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        const timerText = `${minutes}:${secs.toString().padStart(2, "0")}`;

        this.updateMetadata({
            title: `⏱️ Riposo: ${timerText}`,
            artist: `Prossimo: ${this.currentExercise || "Set successivo"}`,
            album: this.currentWorkoutName
        });

        if ("mediaSession" in navigator && "setPositionState" in navigator.mediaSession) {
            try {
                const initialDuration = this.initialTimerDuration || seconds;
                const elapsed = initialDuration - seconds;
                navigator.mediaSession.setPositionState({
                    duration: initialDuration,
                    playbackRate: 1,
                    position: Math.max(0, elapsed)
                });
            } catch (error) {
                console.warn("[MediaSessionManager] Timer position update failed:", error);
            }
        }
    }

    async startTimerDisplay(initialSeconds, onTick, onComplete) {
        this.stopTimerDisplay();
        this.initialTimerDuration = initialSeconds;
        this.onTimerComplete = onComplete;
        const timerSessionId = ++this.timerSessionCounter;
        this.activeTimerSessionId = timerSessionId;
        let remainingSeconds = initialSeconds;

        if (this.isNative && this.nativePlugin) {
            try {
                await this.nativePlugin.startTimer({
                    seconds: initialSeconds,
                    exercise: this.currentExercise || "Prossimo esercizio",
                    workout: this.currentWorkoutName
                });

                console.log(`[MediaSessionManager] Native timer started: ${initialSeconds}s`);
                this.timerInterval = setInterval(() => {
                    remainingSeconds--;
                    if (remainingSeconds >= 0) {
                        onTick?.(remainingSeconds);
                    }
                    if (remainingSeconds <= 0) {
                        if (this.activeTimerSessionId !== timerSessionId) {
                            return;
                        }

                        this.activeTimerSessionId = null;
                        this.stopTimerDisplay();
                        onComplete?.();
                    }
                }, 1000);
                return;
            } catch (error) {
                console.log("[MediaSessionManager] Native timer failed, falling back to web:", error);
            }
        }

        await this.createPersistentAudio();
        this.updateTimer(remainingSeconds);

        if (this.audioElement?.paused) {
            await this.audioElement.play().catch((error) => {
                console.log("[MediaSessionManager] Audio play failed during timer:", error);
            });
        }

        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "playing";
        }

        this.timerInterval = setInterval(() => {
            remainingSeconds--;

            if (remainingSeconds >= 0) {
                this.updateTimer(remainingSeconds);
                onTick?.(remainingSeconds);
            }

            if (remainingSeconds <= 0) {
                if (this.activeTimerSessionId !== timerSessionId) {
                    return;
                }

                this.activeTimerSessionId = null;
                this.stopTimerDisplay();
                this.updateMetadata({
                    title: "✅ Riposo completato!",
                    artist: `Inizia: ${this.currentExercise || "Set successivo"}`,
                    album: this.currentWorkoutName
                });
                onComplete?.();
            }
        }, 1000);

        console.log(`[MediaSessionManager] Web timer started: ${initialSeconds}s`);
    }

    stopTimerDisplay() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        this.initialTimerDuration = null;
        this.activeTimerSessionId = null;

        if (this.isNative && this.nativePlugin) {
            void this.nativePlugin.stopTimer().catch((error) => {
                console.log("[MediaSessionManager] Native timer stop failed:", error);
            });
        }
    }

    endWorkout() {
        this.isActive = false;
        this.stopTimerDisplay();
        this.updateMetadata({
            title: "🎉 Allenamento Completato!",
            artist: "Ottimo lavoro!",
            album: this.currentWorkoutName
        });

        setTimeout(() => {
            this.audioElement?.pause();
            this.isPlaying = false;

            if ("mediaSession" in navigator) {
                navigator.mediaSession.playbackState = "none";
            }
        }, 3000);
    }

    async killSession() {
        console.log("[MediaSessionManager] Kill session");

        this.isActive = false;
        this.isPlaying = false;
        this.isPaused = false;

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        if (this.isNative && this.nativePlugin) {
            try {
                await this.nativePlugin.stopTimer();
                console.log("[MediaSessionManager] Native timer service stopped");
            } catch (error) {
                console.warn("[MediaSessionManager] Native timer stop failed:", error);
            }
        }

        this.destroyAudioElement();

        try {
            const allAudio = document.querySelectorAll("audio");
            allAudio.forEach((element) => {
                element.pause();
                element.src = "";
                element.remove();
            });

            if (allAudio.length) {
                console.log(`[MediaSessionManager] Destroyed ${allAudio.length} audio elements`);
            }
        } catch (error) {
            console.warn("[MediaSessionManager] Failed to destroy audio elements:", error);
        }

        if (this.oscillator) {
            try {
                this.oscillator.stop();
                this.oscillator.disconnect();
            } catch (error) {
                console.warn("[MediaSessionManager] Failed to stop oscillator:", error);
            }
            this.oscillator = null;
        }

        if (this.audioContext && this.audioContext.state !== "closed") {
            try {
                await this.audioContext.close();
                console.log("[MediaSessionManager] AudioContext closed");
            } catch (error) {
                console.warn("[MediaSessionManager] AudioContext close failed:", error);
            }
        }
        this.audioContext = null;

        if ("mediaSession" in navigator) {
            try {
                navigator.mediaSession.metadata = null;
                navigator.mediaSession.playbackState = "paused";

                try {
                    navigator.mediaSession.setPositionState(null);
                } catch (error) {
                    console.warn("[MediaSessionManager] Failed to clear MediaSession position state:", error);
                }

                const actions = [ "play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward", "stop" ];
                actions.forEach((action) => {
                    try {
                        navigator.mediaSession.setActionHandler(action, null);
                    } catch (error) {
                        console.warn(`[MediaSessionManager] Failed to clear action ${action}:`, error);
                    }
                });

                setTimeout(() => {
                    try {
                        navigator.mediaSession.metadata = null;
                        navigator.mediaSession.playbackState = "none";
                    } catch (error) {
                        console.warn("[MediaSessionManager] Delayed MediaSession clear failed:", error);
                    }
                }, 50);
            } catch (error) {
                console.warn("[MediaSessionManager] MediaSession clear failed:", error);
            }
        }
    }

    destroyAudioElement() {
        if (!this.audioElement) {
            return;
        }

        try {
            this.audioElement.pause();
            this.audioElement.src = "";
            this.audioElement.remove();
        } catch (error) {
            console.warn("[MediaSessionManager] Failed to destroy audio element:", error);
        }

        if (this.audioBlobUrl) {
            URL.revokeObjectURL(this.audioBlobUrl);
            this.audioBlobUrl = null;
        }

        this.audioElement = null;
        this.audioReadyPromise = null;
    }

    pauseSession() {
        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
        }

        this.updateMetadata({
            title: "⏸️ In pausa",
            artist: this.currentExercise || "Allenamento",
            album: this.currentWorkoutName
        });
    }

    resumeSession() {
        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "playing";
        }

        this.audioElement?.paused && void this.audioElement.play().catch((error) => {
            console.log("[MediaSessionManager] Resume audio failed:", error);
        });
    }

    onPlayPauseCallback(callback) {
        this.onPlayPause = callback;
    }

    onPreviousCallback(callback) {
        this.onPrevious = callback;
    }

    onNextCallback(callback) {
        this.onNext = callback;
    }

    onSeekBackwardCallback(callback) {
        this.onSeekBackward = callback;
    }

    onSeekForwardCallback(callback) {
        this.onSeekForward = callback;
    }

    isLockscreenSupported() {
        return this.isNative || "mediaSession" in navigator;
    }

    getStatus() {
        return {
            isActive: this.isActive,
            isPlaying: this.isPlaying,
            currentExercise: this.currentExercise,
            currentSet: this.currentSet,
            totalSets: this.totalSets,
            timerValue: this.timerValue,
            lockscreenSupported: this.isLockscreenSupported(),
            isStandalone: this.isStandalone,
            isIOS: this.isIOS
        };
    }
}

export const mediaSessionManager = new MediaSessionManager();
