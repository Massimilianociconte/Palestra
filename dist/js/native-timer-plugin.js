// Native Timer Plugin - Bridge to Android Foreground Service
// Provides lockscreen timer notifications on Android native app

class NativeTimerPlugin {
    constructor() {
        this.isNative = this.checkIfNative();
        this.plugin = null;
        this.listeners = {
            tick: [],
            complete: []
        };
        
        if (this.isNative) {
            this.initPlugin();
        }
    }
    
    checkIfNative() {
        // Check if running in Capacitor native app
        return typeof window !== 'undefined' && 
               window.Capacitor && 
               window.Capacitor.isNativePlatform();
    }
    
    async initPlugin() {
        try {
            // Import Capacitor core
            const { registerPlugin } = await import('@capacitor/core');
            this.plugin = registerPlugin('TimerNotification');
            
            // Set up event listeners
            this.plugin.addListener('timerTick', (data) => {
                this.listeners.tick.forEach(cb => cb(data.remaining));
            });
            
            this.plugin.addListener('timerComplete', () => {
                this.listeners.complete.forEach(cb => cb());
            });
            
            console.log('✅ Native Timer Plugin initialized');
        } catch (e) {
            console.log('Native Timer Plugin not available:', e.message);
            this.isNative = false;
        }
    }
    
    // Start timer with lockscreen notification
    async startTimer(seconds, exerciseName = 'Prossimo esercizio', workoutName = 'Allenamento') {
        if (!this.isNative || !this.plugin) {
            console.log('Native timer not available, using web fallback');
            return false;
        }
        
        try {
            await this.plugin.startTimer({
                seconds: seconds,
                exercise: exerciseName,
                workout: workoutName
            });
            console.log(`⏱️ Native timer started: ${seconds}s`);
            return true;
        } catch (e) {
            console.error('Failed to start native timer:', e);
            return false;
        }
    }
    
    // Stop timer
    async stopTimer() {
        if (!this.isNative || !this.plugin) return;
        
        try {
            await this.plugin.stopTimer();
            console.log('⏹️ Native timer stopped');
        } catch (e) {
            console.error('Failed to stop native timer:', e);
        }
    }
    
    // Pause timer
    async pauseTimer() {
        if (!this.isNative || !this.plugin) return;
        
        try {
            await this.plugin.pauseTimer();
        } catch (e) {
            console.error('Failed to pause native timer:', e);
        }
    }
    
    // Resume timer
    async resumeTimer() {
        if (!this.isNative || !this.plugin) return;
        
        try {
            await this.plugin.resumeTimer();
        } catch (e) {
            console.error('Failed to resume native timer:', e);
        }
    }
    
    // Check if timer is running
    async isRunning() {
        if (!this.isNative || !this.plugin) return { running: false, remaining: 0 };
        
        try {
            return await this.plugin.isRunning();
        } catch (e) {
            return { running: false, remaining: 0 };
        }
    }
    
    // Add tick listener
    onTick(callback) {
        this.listeners.tick.push(callback);
    }
    
    // Add complete listener
    onComplete(callback) {
        this.listeners.complete.push(callback);
    }
    
    // Remove listeners
    removeAllListeners() {
        this.listeners.tick = [];
        this.listeners.complete = [];
    }
    
    // Check if native timer is available
    isAvailable() {
        return this.isNative && this.plugin !== null;
    }
}

// Export singleton
export const nativeTimerPlugin = new NativeTimerPlugin();

// Also expose globally for non-module scripts
if (typeof window !== 'undefined') {
    window.NativeTimerPlugin = nativeTimerPlugin;
}
