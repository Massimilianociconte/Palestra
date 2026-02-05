/**
 * ProximityWebService - Geohash-based proximity detection for Web/PWA
 * 
 * Architecture:
 * - Uses Geolocation API for GPS tracking
 * - Geohash encoding for spatial proximity matching
 * - Calls Cloud Function for server-side matching
 * - Battery-optimized: 2-minute update intervals
 * 
 * Geohash Precision:
 * - Precision 7 ≈ 153m x 153m
 * - Precision 8 ≈ 19m x 19m
 * 
 * @author Gymbro Team
 * @version 1.0.0
 */

import {
    db,
    auth,
    doc,
    updateDoc,
    serverTimestamp
} from '../firebase-config.js';

// Geohash alphabet (32 characters)
const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

/**
 * @typedef {Object} ProximityConfig
 * @property {number} [updateIntervalMs=120000] - GPS update interval (default 2 min)
 * @property {number} [geohashPrecision=7] - Geohash precision (default 7 ≈ 150m)
 * @property {boolean} [enableHighAccuracy=true] - Use high accuracy GPS
 */

export class ProximityWebService {
    /**
     * @param {ProximityConfig} [config]
     */
    constructor(config = {}) {
        this._config = {
            updateIntervalMs: config.updateIntervalMs || 120000, // 2 minutes
            geohashPrecision: config.geohashPrecision || 7,      // ~150m radius
            enableHighAccuracy: config.enableHighAccuracy ?? true
        };

        this._intervalId = null;
        this._isTracking = false;
        this._lastGeohash = null;
        this._lastPosition = null;
        this._functions = null; // Lazy-loaded Firebase Functions
    }

    // ============================================
    // PUBLIC API
    // ============================================

    /**
     * Check if geolocation is supported
     * @returns {boolean}
     */
    isSupported() {
        return 'geolocation' in navigator;
    }

    /**
     * Request location permission
     * @returns {Promise<boolean>}
     */
    async requestPermission() {
        if (!this.isSupported()) {
            console.warn('[ProximityWebService] Geolocation not supported');
            return false;
        }

        try {
            // Attempt to get position to trigger permission dialog
            await this._getCurrentPosition();
            return true;
        } catch (error) {
            console.warn('[ProximityWebService] Permission denied or error:', error);
            return false;
        }
    }

    /**
     * Start proximity tracking
     * Updates location and triggers Cloud Function matching
     * 
     * @param {string} [uid] - User ID (defaults to current auth user)
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async startTracking(uid = null) {
        if (!this.isSupported()) {
            return { success: false, error: 'Geolocation non supportato' };
        }

        if (this._isTracking) {
            return { success: true, message: 'Already tracking' };
        }

        const userId = uid || auth.currentUser?.uid;
        if (!userId) {
            return { success: false, error: 'Utente non autenticato' };
        }

        try {
            // Initial position update
            await this._updatePosition(userId);

            // Start periodic updates
            this._intervalId = setInterval(async () => {
                try {
                    await this._updatePosition(userId);
                } catch (error) {
                    console.error('[ProximityWebService] Update error:', error);
                }
            }, this._config.updateIntervalMs);

            this._isTracking = true;

            console.log(`[ProximityWebService] Tracking started (interval: ${this._config.updateIntervalMs}ms)`);
            return { success: true };

        } catch (error) {
            console.error('[ProximityWebService] Start tracking error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Stop proximity tracking
     */
    stopTracking() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }

        this._isTracking = false;
        console.log('[ProximityWebService] Tracking stopped');
    }

    /**
     * Get current tracking status
     * @returns {{isTracking: boolean, lastGeohash: string|null, lastPosition: Object|null}}
     */
    getStatus() {
        return {
            isTracking: this._isTracking,
            lastGeohash: this._lastGeohash,
            lastPosition: this._lastPosition
        };
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        this.stopTracking();
        this._lastGeohash = null;
        this._lastPosition = null;
    }

    // ============================================
    // PRIVATE: Position Updates
    // ============================================

    /**
     * Update user's position in Firestore and trigger matching
     * @param {string} uid 
     */
    async _updatePosition(uid) {
        const position = await this._getCurrentPosition();

        const { latitude, longitude, accuracy } = position.coords;

        // Encode to geohash
        const geohash = this.encodeGeohash(latitude, longitude, this._config.geohashPrecision);

        this._lastPosition = { latitude, longitude, accuracy };
        this._lastGeohash = geohash;

        // Update Firestore
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, {
            last_geohash: geohash,
            proximity_status: 'training',
            proximity_last_update: serverTimestamp()
        });

        console.log(`[ProximityWebService] Position updated: ${geohash} (accuracy: ${accuracy.toFixed(0)}m)`);

        // Trigger Cloud Function for matching
        await this._findNearbyUsers(geohash);
    }

    /**
     * Get current position as Promise
     * @returns {Promise<GeolocationPosition>}
     */
    _getCurrentPosition() {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                resolve,
                reject,
                {
                    enableHighAccuracy: this._config.enableHighAccuracy,
                    timeout: 10000,
                    maximumAge: 60000 // Accept cached position up to 1 minute old
                }
            );
        });
    }

    /**
     * Call Cloud Function to find nearby users
     * @param {string} geohash 
     */
    async _findNearbyUsers(geohash) {
        try {
            // Lazy load Firebase Functions
            if (!this._functions) {
                const { getFunctions, httpsCallable } = await import('firebase/functions');
                this._functions = { getFunctions, httpsCallable };
            }

            const functions = this._functions.getFunctions();
            const findNearby = this._functions.httpsCallable(functions, 'findNearbyUsers');

            const result = await findNearby({ geohash });

            if (result.data?.checked > 0) {
                console.log(`[ProximityWebService] Checked ${result.data.checked} nearby users`);
            }

        } catch (error) {
            // Cloud Function may not be deployed yet - don't throw
            console.warn('[ProximityWebService] Cloud Function error (may not be deployed):', error.message);
        }
    }

    // ============================================
    // GEOHASH ENCODING
    // ============================================

    /**
     * Encode latitude/longitude to geohash
     * 
     * @param {number} lat - Latitude (-90 to 90)
     * @param {number} lng - Longitude (-180 to 180)
     * @param {number} [precision=7] - Number of characters (default 7)
     * @returns {string}
     */
    encodeGeohash(lat, lng, precision = 7) {
        let latMin = -90, latMax = 90;
        let lngMin = -180, lngMax = 180;

        let hash = '';
        let isLon = true;
        let bit = 0;
        let ch = 0;

        while (hash.length < precision) {
            if (isLon) {
                const mid = (lngMin + lngMax) / 2;
                if (lng >= mid) {
                    ch |= (1 << (4 - bit));
                    lngMin = mid;
                } else {
                    lngMax = mid;
                }
            } else {
                const mid = (latMin + latMax) / 2;
                if (lat >= mid) {
                    ch |= (1 << (4 - bit));
                    latMin = mid;
                } else {
                    latMax = mid;
                }
            }

            isLon = !isLon;
            bit++;

            if (bit === 5) {
                hash += GEOHASH_BASE32[ch];
                bit = 0;
                ch = 0;
            }
        }

        return hash;
    }

    /**
     * Decode geohash to bounding box
     * 
     * @param {string} geohash 
     * @returns {{minLat: number, maxLat: number, minLng: number, maxLng: number}}
     */
    decodeGeohash(geohash) {
        let latMin = -90, latMax = 90;
        let lngMin = -180, lngMax = 180;
        let isLon = true;

        for (const c of geohash.toLowerCase()) {
            const idx = GEOHASH_BASE32.indexOf(c);
            if (idx === -1) continue;

            for (let bit = 4; bit >= 0; bit--) {
                const mask = 1 << bit;

                if (isLon) {
                    const mid = (lngMin + lngMax) / 2;
                    if (idx & mask) {
                        lngMin = mid;
                    } else {
                        lngMax = mid;
                    }
                } else {
                    const mid = (latMin + latMax) / 2;
                    if (idx & mask) {
                        latMin = mid;
                    } else {
                        latMax = mid;
                    }
                }

                isLon = !isLon;
            }
        }

        return { minLat: latMin, maxLat: latMax, minLng: lngMin, maxLng: lngMax };
    }

    /**
     * Get the 8 adjacent geohash cells
     * Used for edge-case coverage (user on cell boundary)
     * 
     * @param {string} geohash 
     * @returns {string[]}
     */
    getAdjacentGeohashes(geohash) {
        const bounds = this.decodeGeohash(geohash);
        const lat = (bounds.minLat + bounds.maxLat) / 2;
        const lng = (bounds.minLng + bounds.maxLng) / 2;

        const latDelta = bounds.maxLat - bounds.minLat;
        const lngDelta = bounds.maxLng - bounds.minLng;

        const neighbors = [];
        const directions = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1], [0, 1],
            [1, -1], [1, 0], [1, 1]
        ];

        for (const [dLat, dLng] of directions) {
            const newLat = lat + (dLat * latDelta);
            const newLng = lng + (dLng * lngDelta);

            // Handle wrap-around for longitude
            let normalizedLng = newLng;
            if (normalizedLng > 180) normalizedLng -= 360;
            if (normalizedLng < -180) normalizedLng += 360;

            // Clamp latitude
            const normalizedLat = Math.max(-89.9, Math.min(89.9, newLat));

            neighbors.push(this.encodeGeohash(normalizedLat, normalizedLng, geohash.length));
        }

        return neighbors;
    }

    /**
     * Calculate approximate distance between two geohash cells
     * @param {string} hash1 
     * @param {string} hash2 
     * @returns {number} Distance in meters (approximate)
     */
    estimateDistance(hash1, hash2) {
        const bounds1 = this.decodeGeohash(hash1);
        const bounds2 = this.decodeGeohash(hash2);

        const lat1 = (bounds1.minLat + bounds1.maxLat) / 2;
        const lng1 = (bounds1.minLng + bounds1.maxLng) / 2;
        const lat2 = (bounds2.minLat + bounds2.maxLat) / 2;
        const lng2 = (bounds2.minLng + bounds2.maxLng) / 2;

        // Haversine formula
        const R = 6371000; // Earth's radius in meters
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;

        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return R * c;
    }
}

// Export singleton instance
export const proximityWebService = new ProximityWebService();
