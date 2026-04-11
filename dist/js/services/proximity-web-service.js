import {
    db,
    auth,
    doc,
    updateDoc,
    serverTimestamp,
    functions,
    httpsCallable
} from "../firebase-config.js";

const GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export class ProximityWebService {
    constructor(config = {}) {
        this._config = {
            updateIntervalMs: config.updateIntervalMs || 120000,
            geohashPrecision: config.geohashPrecision || 7,
            enableHighAccuracy: config.enableHighAccuracy ?? true
        };
        this._intervalId = null;
        this._isTracking = false;
        this._lastGeohash = null;
        this._lastPosition = null;
    }

    isSupported() {
        return "geolocation" in navigator;
    }

    async requestPermission() {
        if (!this.isSupported()) {
            console.warn("[ProximityWebService] Geolocation not supported");
            return false;
        }

        try {
            await this._getCurrentPosition();
            return true;
        } catch (error) {
            console.warn("[ProximityWebService] Permission denied or error:", error);
            return false;
        }
    }

    async startTracking(uid = null) {
        if (!this.isSupported()) {
            return { success: false, error: "Geolocation non supportato" };
        }

        if (this._isTracking) {
            return { success: true, message: "Already tracking" };
        }

        const userId = uid || auth.currentUser?.uid;
        if (!userId) {
            return { success: false, error: "Utente non autenticato" };
        }

        try {
            await this._updatePosition(userId);
            this._intervalId = setInterval(async () => {
                try {
                    await this._updatePosition(userId);
                } catch (error) {
                    console.error("[ProximityWebService] Update error:", error);
                }
            }, this._config.updateIntervalMs);

            this._isTracking = true;
            console.log(`[ProximityWebService] Tracking started (interval: ${this._config.updateIntervalMs}ms)`);
            return { success: true };
        } catch (error) {
            console.error("[ProximityWebService] Start tracking error:", error);
            return { success: false, error: error.message };
        }
    }

    stopTracking() {
        if (this._intervalId) {
            clearInterval(this._intervalId);
            this._intervalId = null;
        }

        this._isTracking = false;
        console.log("[ProximityWebService] Tracking stopped");
    }

    getStatus() {
        return {
            isTracking: this._isTracking,
            lastGeohash: this._lastGeohash,
            lastPosition: this._lastPosition
        };
    }

    cleanup() {
        this.stopTracking();
        this._lastGeohash = null;
        this._lastPosition = null;
    }

    async _updatePosition(uid) {
        const position = await this._getCurrentPosition();
        const { latitude, longitude, accuracy } = position.coords;
        const geohash = this.encodeGeohash(latitude, longitude, this._config.geohashPrecision);

        this._lastPosition = { latitude, longitude, accuracy };
        this._lastGeohash = geohash;

        const userRef = doc(db, "users", uid);
        await updateDoc(userRef, {
            last_geohash: geohash,
            proximity_status: "training",
            proximity_last_update: serverTimestamp()
        });

        console.log(`[ProximityWebService] Position updated: ${geohash} (accuracy: ${accuracy.toFixed(0)}m)`);
        await this._findNearbyUsers(geohash);
    }

    _getCurrentPosition() {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: this._config.enableHighAccuracy,
                timeout: 10000,
                maximumAge: 60000
            });
        });
    }

    async _findNearbyUsers(geohash) {
        try {
            const findNearby = httpsCallable(functions, "findNearbyUsers");
            const result = await findNearby({ geohash });
            if (result.data?.checked > 0) {
                console.log(`[ProximityWebService] Checked ${result.data.checked} nearby users`);
            }
        } catch (error) {
            console.warn("[ProximityWebService] Cloud Function error (may not be deployed):", error.message);
        }
    }

    encodeGeohash(lat, lng, precision = 7) {
        let latMin = -90;
        let latMax = 90;
        let lngMin = -180;
        let lngMax = 180;
        let hash = "";
        let isLon = true;
        let bit = 0;
        let ch = 0;

        while (hash.length < precision) {
            if (isLon) {
                const mid = (lngMin + lngMax) / 2;
                if (lng >= mid) {
                    ch |= 1 << (4 - bit);
                    lngMin = mid;
                } else {
                    lngMax = mid;
                }
            } else {
                const mid = (latMin + latMax) / 2;
                if (lat >= mid) {
                    ch |= 1 << (4 - bit);
                    latMin = mid;
                } else {
                    latMax = mid;
                }
            }

            isLon = !isLon;
            bit += 1;

            if (bit === 5) {
                hash += GEOHASH_BASE32[ch];
                bit = 0;
                ch = 0;
            }
        }

        return hash;
    }

    decodeGeohash(geohash) {
        let latMin = -90;
        let latMax = 90;
        let lngMin = -180;
        let lngMax = 180;
        let isLon = true;

        for (const char of geohash.toLowerCase()) {
            const index = GEOHASH_BASE32.indexOf(char);
            if (index === -1) {
                continue;
            }

            for (let bit = 4; bit >= 0; bit -= 1) {
                const mask = 1 << bit;
                if (isLon) {
                    const mid = (lngMin + lngMax) / 2;
                    if (index & mask) {
                        lngMin = mid;
                    } else {
                        lngMax = mid;
                    }
                } else {
                    const mid = (latMin + latMax) / 2;
                    if (index & mask) {
                        latMin = mid;
                    } else {
                        latMax = mid;
                    }
                }

                isLon = !isLon;
            }
        }

        return {
            minLat: latMin,
            maxLat: latMax,
            minLng: lngMin,
            maxLng: lngMax
        };
    }

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
            const newLat = lat + dLat * latDelta;
            const newLng = lng + dLng * lngDelta;
            let normalizedLng = newLng;

            if (normalizedLng > 180) {
                normalizedLng -= 360;
            } else if (normalizedLng < -180) {
                normalizedLng += 360;
            }

            const normalizedLat = Math.max(-89.9, Math.min(89.9, newLat));
            neighbors.push(this.encodeGeohash(normalizedLat, normalizedLng, geohash.length));
        }

        return neighbors;
    }

    estimateDistance(hash1, hash2) {
        const bounds1 = this.decodeGeohash(hash1);
        const bounds2 = this.decodeGeohash(hash2);
        const lat1 = (bounds1.minLat + bounds1.maxLat) / 2;
        const lng1 = (bounds1.minLng + bounds1.maxLng) / 2;
        const lat2 = (bounds2.minLat + bounds2.maxLat) / 2;
        const lng2 = (bounds2.minLng + bounds2.maxLng) / 2;
        const earthRadius = 6371000;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        return earthRadius * c;
    }
}

export const proximityWebService = new ProximityWebService();
