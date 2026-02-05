/**
 * ProximityNativePlugin - Capacitor bridge for native proximity detection
 * 
 * This is the JavaScript interface to the native Nearby Connections API.
 * The actual native implementation is in ProximityService.kt (Android).
 * 
 * Architecture:
 * - Uses Capacitor plugin bridge pattern
 * - Wraps Nearby Connections API for Android
 * - Falls back to web service if not on native
 * - Battery-optimized: 30s scan / 3 min duty cycle
 * 
 * @author Gymbro Team
 * @version 1.0.0
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { auth, db, doc, updateDoc, serverTimestamp } from '../firebase-config.js';

/**
 * @typedef {Object} NativeProximityPlugin
 * @property {Function} startAdvertising - Start broadcasting proximity ID
 * @property {Function} startDiscovery - Start scanning for nearby users
 * @property {Function} stopAll - Stop all proximity operations
 * @property {Function} getState - Get current plugin state
 * @property {Function} addListener - Add event listener
 */

// Register the native plugin (if available)
const NativeProximity = registerPlugin('NativeProximity', {
    // Web implementation (fallback)
    web: () => import('../services/proximity-web-service.js').then(m => ({
        startAdvertising: async () => ({ success: false, error: 'Use web service instead' }),
        startDiscovery: async () => ({ success: false, error: 'Use web service instead' }),
        stopAll: async () => ({ success: true }),
        getState: async () => ({ isAdvertising: false, isDiscovering: false })
    }))
});

export class ProximityNativePlugin {
    constructor() {
        this._isNative = Capacitor.isNativePlatform();
        this._proximityId = null;
        this._discoveredEndpoints = new Set();
        this._listeners = [];
        this._dutyEnabled = false;
        this._dutyInterval = null;

        // Configuration
        this._config = {
            scanDurationMs: 30000,     // 30 seconds scan
            scanIntervalMs: 180000,   // 3 minutes between scans
            serviceId: 'io.gymbro.proximity' // Unique service identifier
        };

        // Lazy load functions
        this._functions = null;
    }

    // ============================================
    // PUBLIC API
    // ============================================

    /**
     * Check if running on native platform
     * @returns {boolean}
     */
    isNativeAvailable() {
        return this._isNative;
    }

    /**
     * Generate or get existing proximity ID
     * @returns {string}
     */
    getProximityId() {
        if (!this._proximityId) {
            // Generate UUID v4
            this._proximityId = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
                const r = Math.random() * 16 | 0;
                return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
            });
        }
        return this._proximityId;
    }

    /**
     * Start advertising and discovery with duty cycling
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async startProximityDetection() {
        if (!this._isNative) {
            return { success: false, error: 'Not on native platform' };
        }

        try {
            const uid = auth.currentUser?.uid;
            if (!uid) {
                return { success: false, error: 'Not authenticated' };
            }

            const proximityId = this.getProximityId();

            // Store proximity ID in Firestore
            await this._updateUserProximityId(uid, proximityId);

            // Start advertising our proximity ID
            await NativeProximity.startAdvertising({
                proximityId,
                serviceId: this._config.serviceId
            });

            // Setup discovery listener
            this._setupDiscoveryListener();

            // Start duty cycling
            this._startDutyCycle();

            console.log(`[ProximityNativePlugin] Started with ID: ${proximityId.substring(0, 8)}...`);
            return { success: true, proximityId };

        } catch (error) {
            console.error('[ProximityNativePlugin] Start error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Stop all proximity detection
     */
    async stopProximityDetection() {
        try {
            this._stopDutyCycle();

            if (this._isNative) {
                await NativeProximity.stopAll();
            }

            // Clear proximity status in Firestore
            const uid = auth.currentUser?.uid;
            if (uid) {
                await updateDoc(doc(db, 'users', uid), {
                    proximity_status: 'offline',
                    proximity_id: null
                });
            }

            this._discoveredEndpoints.clear();
            console.log('[ProximityNativePlugin] Stopped');

        } catch (error) {
            console.error('[ProximityNativePlugin] Stop error:', error);
        }
    }

    /**
     * Get current state
     * @returns {Promise<Object>}
     */
    async getState() {
        if (!this._isNative) {
            return { isNative: false, isActive: false };
        }

        const state = await NativeProximity.getState();
        return {
            isNative: true,
            ...state,
            proximityId: this._proximityId?.substring(0, 8),
            discoveredCount: this._discoveredEndpoints.size
        };
    }

    // ============================================
    // DUTY CYCLING (Battery Optimization)
    // ============================================

    /**
     * Start duty cycle: 30s scan every 3 minutes
     */
    _startDutyCycle() {
        if (this._dutyEnabled) return;

        this._dutyEnabled = true;

        // Initial scan
        this._runScanCycle();

        // Schedule recurring scans
        this._dutyInterval = setInterval(() => {
            this._runScanCycle();
        }, this._config.scanIntervalMs);

        console.log(`[ProximityNativePlugin] Duty cycle started (${this._config.scanDurationMs}ms scan every ${this._config.scanIntervalMs}ms)`);
    }

    /**
     * Stop duty cycle
     */
    _stopDutyCycle() {
        this._dutyEnabled = false;

        if (this._dutyInterval) {
            clearInterval(this._dutyInterval);
            this._dutyInterval = null;
        }
    }

    /**
     * Run a single scan cycle
     */
    async _runScanCycle() {
        if (!this._dutyEnabled || !this._isNative) return;

        try {
            console.log('[ProximityNativePlugin] Starting scan cycle...');

            // Start discovery
            await NativeProximity.startDiscovery({
                serviceId: this._config.serviceId
            });

            // Stop after scan duration
            setTimeout(async () => {
                if (this._isNative && this._dutyEnabled) {
                    // Keep advertising but stop discovery
                    const state = await NativeProximity.getState();
                    if (state.isDiscovering) {
                        await NativeProximity.stopDiscovery();
                    }
                    console.log('[ProximityNativePlugin] Scan cycle completed');
                }
            }, this._config.scanDurationMs);

        } catch (error) {
            console.error('[ProximityNativePlugin] Scan cycle error:', error);
        }
    }

    // ============================================
    // EVENT HANDLING
    // ============================================

    /**
     * Setup listener for discovered endpoints
     */
    _setupDiscoveryListener() {
        if (!this._isNative) return;

        const listener = NativeProximity.addListener('endpointDiscovered', async (data) => {
            const { endpointId, proximityId } = data;

            // Skip if already discovered
            if (this._discoveredEndpoints.has(proximityId)) {
                return;
            }

            this._discoveredEndpoints.add(proximityId);
            console.log(`[ProximityNativePlugin] Discovered: ${proximityId.substring(0, 8)}...`);

            // Report to Cloud Function
            await this._reportDiscovery(proximityId);
        });

        this._listeners.push(listener);
    }

    /**
     * Report discovered proximity ID to Cloud Function
     * @param {string} discoveredProximityId 
     */
    async _reportDiscovery(discoveredProximityId) {
        try {
            // Lazy load Firebase Functions
            if (!this._functions) {
                const { getFunctions, httpsCallable } = await import('firebase/functions');
                this._functions = { getFunctions, httpsCallable };
            }

            const functions = this._functions.getFunctions();
            const reportDiscovery = this._functions.httpsCallable(functions, 'reportProximityDiscovery');

            const result = await reportDiscovery({ discoveredProximityId });

            if (result.data?.notified) {
                console.log('[ProximityNativePlugin] Successfully notified nearby user');
            } else if (result.data?.reason === 'debounced') {
                console.log('[ProximityNativePlugin] Notification debounced (already notified recently)');
            }

        } catch (error) {
            console.warn('[ProximityNativePlugin] Report discovery error:', error.message);
        }
    }

    // ============================================
    // FIRESTORE UPDATES
    // ============================================

    /**
     * Update user's proximity ID in Firestore
     * @param {string} uid 
     * @param {string} proximityId 
     */
    async _updateUserProximityId(uid, proximityId) {
        await updateDoc(doc(db, 'users', uid), {
            proximity_id: proximityId,
            proximity_status: 'training',
            proximity_last_update: serverTimestamp()
        });
    }

    // ============================================
    // CLEANUP
    // ============================================

    /**
     * Cleanup all resources
     */
    cleanup() {
        this._stopDutyCycle();

        for (const listener of this._listeners) {
            try {
                listener.remove();
            } catch (e) {
                // Ignore
            }
        }
        this._listeners = [];

        this._discoveredEndpoints.clear();
        this._proximityId = null;
    }
}

// Export singleton instance
export const proximityNativePlugin = new ProximityNativePlugin();
