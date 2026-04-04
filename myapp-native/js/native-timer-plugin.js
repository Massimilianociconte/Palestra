class NativeTimerPlugin {
    constructor() {
        this.isNative = this.checkIfNative();
        this.plugin = null;
        this.listeners = {
            tick: [],
            complete: []
        };

        if (this.isNative) {
            void this.initPlugin();
        }
    }

    checkIfNative() {
        return typeof window !== "undefined" && Boolean(window.Capacitor?.isNativePlatform?.());
    }

    async initPlugin() {
        try {
            const capacitor = window.Capacitor;
            if (capacitor?.Plugins?.TimerNotification) {
                this.plugin = capacitor.Plugins.TimerNotification;
            } else if (typeof capacitor?.registerPlugin === "function") {
                this.plugin = capacitor.registerPlugin("TimerNotification");
            } else {
                throw new Error("Capacitor non disponibile");
            }

            this.plugin.addListener("timerTick", (data) => {
                this.listeners.tick.forEach((callback) => callback(data.remaining));
            });

            this.plugin.addListener("timerComplete", () => {
                this.listeners.complete.forEach((callback) => callback());
            });

            console.log("✅ Native Timer Plugin initialized");
        } catch (error) {
            console.log("Native Timer Plugin not available:", error.message);
            this.isNative = false;
        }
    }

    async startTimer(seconds, exerciseName = "Prossimo esercizio", workoutName = "Allenamento") {
        if (!this.isNative || !this.plugin) {
            console.log("Native timer not available, using web fallback");
            return false;
        }

        try {
            await this.plugin.startTimer({
                seconds,
                exercise: exerciseName,
                workout: workoutName
            });
            console.log(`⏱️ Native timer started: ${seconds}s`);
            return true;
        } catch (error) {
            console.error("Failed to start native timer:", error);
            return false;
        }
    }

    async stopTimer() {
        if (!this.isNative || !this.plugin) {
            return;
        }

        try {
            await this.plugin.stopTimer();
            console.log("⏹️ Native timer stopped");
        } catch (error) {
            console.error("Failed to stop native timer:", error);
        }
    }

    async pauseTimer() {
        if (!this.isNative || !this.plugin) {
            return;
        }

        try {
            await this.plugin.pauseTimer();
        } catch (error) {
            console.error("Failed to pause native timer:", error);
        }
    }

    async resumeTimer() {
        if (!this.isNative || !this.plugin) {
            return;
        }

        try {
            await this.plugin.resumeTimer();
        } catch (error) {
            console.error("Failed to resume native timer:", error);
        }
    }

    async isRunning() {
        if (!this.isNative || !this.plugin) {
            return { running: false, remaining: 0 };
        }

        try {
            return await this.plugin.isRunning();
        } catch (error) {
            console.error("Failed to read native timer state:", error);
            return { running: false, remaining: 0 };
        }
    }

    onTick(callback) {
        this.listeners.tick.push(callback);
    }

    onComplete(callback) {
        this.listeners.complete.push(callback);
    }

    removeAllListeners() {
        this.listeners.tick = [];
        this.listeners.complete = [];
    }

    isAvailable() {
        return this.isNative && this.plugin !== null;
    }
}

export const nativeTimerPlugin = new NativeTimerPlugin();

if (typeof window !== "undefined") {
    window.NativeTimerPlugin = nativeTimerPlugin;
}
