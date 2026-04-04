import {
    auth,
    db,
    doc,
    updateDoc,
    serverTimestamp,
    functions,
    httpsCallable
} from "../firebase-config.js";

function getCapacitor() {
    return typeof window !== "undefined" ? window.Capacitor || null : null;
}

function getNativeProximityPlugin() {
    const capacitor = getCapacitor();
    if (!capacitor) {
        return {
            startAdvertising: async () => ({ success: false, error: "Capacitor non disponibile" }),
            startDiscovery: async () => ({ success: false, error: "Capacitor non disponibile" }),
            stopDiscovery: async () => ({ success: true }),
            stopAll: async () => ({ success: true }),
            getState: async () => ({ isAdvertising: false, isDiscovering: false }),
            addListener: () => ({ remove() {} })
        };
    }

    if (capacitor.Plugins?.NativeProximity) {
        return capacitor.Plugins.NativeProximity;
    }

    if (typeof capacitor.registerPlugin === "function") {
        return capacitor.registerPlugin("NativeProximity");
    }

    return {
        startAdvertising: async () => ({ success: false, error: "Plugin non disponibile" }),
        startDiscovery: async () => ({ success: false, error: "Plugin non disponibile" }),
        stopDiscovery: async () => ({ success: true }),
        stopAll: async () => ({ success: true }),
        getState: async () => ({ isAdvertising: false, isDiscovering: false }),
        addListener: () => ({ remove() {} })
    };
}

export class ProximityNativePlugin {
    constructor() {
        this._capacitor = getCapacitor();
        this._isNative = this._capacitor?.isNativePlatform?.() ?? false;
        this._nativePlugin = getNativeProximityPlugin();
        this._proximityId = null;
        this._discoveredEndpoints = new Set();
        this._listeners = [];
        this._dutyEnabled = false;
        this._dutyInterval = null;
        this._config = {
            scanDurationMs: 30000,
            scanIntervalMs: 180000,
            serviceId: "io.gymbro.proximity"
        };
    }

    isNativeAvailable() {
        return this._isNative;
    }

    getProximityId() {
        if (!this._proximityId) {
            this._proximityId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
                const random = (Math.random() * 16) | 0;
                return (char === "x" ? random : ((random & 0x3) | 0x8)).toString(16);
            });
        }

        return this._proximityId;
    }

    async startProximityDetection() {
        if (!this._isNative) {
            return { success: false, error: "Not on native platform" };
        }

        try {
            const uid = auth.currentUser?.uid;
            if (!uid) {
                return { success: false, error: "Not authenticated" };
            }

            const proximityId = this.getProximityId();
            await this._updateUserProximityId(uid, proximityId);
            await this._nativePlugin.startAdvertising({
                proximityId,
                serviceId: this._config.serviceId
            });

            this._setupDiscoveryListener();
            this._startDutyCycle();

            console.log(`[ProximityNativePlugin] Started with ID: ${proximityId.substring(0, 8)}...`);
            return { success: true, proximityId };
        } catch (error) {
            console.error("[ProximityNativePlugin] Start error:", error);
            return { success: false, error: error.message };
        }
    }

    async stopProximityDetection() {
        try {
            this._stopDutyCycle();

            if (this._isNative) {
                await this._nativePlugin.stopAll();
            }

            const uid = auth.currentUser?.uid;
            if (uid) {
                await updateDoc(doc(db, "users", uid), {
                    proximity_status: "offline",
                    proximity_id: null
                });
            }

            this._discoveredEndpoints.clear();
            console.log("[ProximityNativePlugin] Stopped");
        } catch (error) {
            console.error("[ProximityNativePlugin] Stop error:", error);
        }
    }

    async getState() {
        if (!this._isNative) {
            return { isNative: false, isActive: false };
        }

        const state = await this._nativePlugin.getState();
        return {
            isNative: true,
            ...state,
            proximityId: this._proximityId?.substring(0, 8),
            discoveredCount: this._discoveredEndpoints.size
        };
    }

    _startDutyCycle() {
        if (this._dutyEnabled) {
            return;
        }

        this._dutyEnabled = true;
        void this._runScanCycle();
        this._dutyInterval = setInterval(() => {
            void this._runScanCycle();
        }, this._config.scanIntervalMs);

        console.log(
            `[ProximityNativePlugin] Duty cycle started (${this._config.scanDurationMs}ms scan every ${this._config.scanIntervalMs}ms)`
        );
    }

    _stopDutyCycle() {
        this._dutyEnabled = false;

        if (this._dutyInterval) {
            clearInterval(this._dutyInterval);
            this._dutyInterval = null;
        }
    }

    async _runScanCycle() {
        if (!this._dutyEnabled || !this._isNative) {
            return;
        }

        try {
            console.log("[ProximityNativePlugin] Starting scan cycle...");
            await this._nativePlugin.startDiscovery({ serviceId: this._config.serviceId });

            setTimeout(async () => {
                if (!this._isNative || !this._dutyEnabled) {
                    return;
                }

                const state = await this._nativePlugin.getState();
                if (state.isDiscovering) {
                    await this._nativePlugin.stopDiscovery();
                }

                console.log("[ProximityNativePlugin] Scan cycle completed");
            }, this._config.scanDurationMs);
        } catch (error) {
            console.error("[ProximityNativePlugin] Scan cycle error:", error);
        }
    }

    _setupDiscoveryListener() {
        if (!this._isNative) {
            return;
        }

        const listener = this._nativePlugin.addListener("endpointDiscovered", async (data) => {
            const { proximityId } = data;
            if (this._discoveredEndpoints.has(proximityId)) {
                return;
            }

            this._discoveredEndpoints.add(proximityId);
            console.log(`[ProximityNativePlugin] Discovered: ${proximityId.substring(0, 8)}...`);
            await this._reportDiscovery(proximityId);
        });

        this._listeners.push(listener);
    }

    async _reportDiscovery(discoveredProximityId) {
        try {
            const reportDiscovery = httpsCallable(functions, "reportProximityDiscovery");
            const result = await reportDiscovery({ discoveredProximityId });

            if (result.data?.notified) {
                console.log("[ProximityNativePlugin] Successfully notified nearby user");
            } else if (result.data?.reason === "debounced") {
                console.log("[ProximityNativePlugin] Notification debounced (already notified recently)");
            }
        } catch (error) {
            console.warn("[ProximityNativePlugin] Report discovery error:", error.message);
        }
    }

    async _updateUserProximityId(uid, proximityId) {
        await updateDoc(doc(db, "users", uid), {
            proximity_id: proximityId,
            proximity_status: "training",
            proximity_last_update: serverTimestamp()
        });
    }

    cleanup() {
        this._stopDutyCycle();

        for (const listener of this._listeners) {
            try {
                listener.remove();
            } catch (error) {
                console.warn("[ProximityNativePlugin] Listener cleanup error:", error);
            }
        }

        this._listeners = [];
        this._discoveredEndpoints.clear();
        this._proximityId = null;
    }
}

export const proximityNativePlugin = new ProximityNativePlugin();
