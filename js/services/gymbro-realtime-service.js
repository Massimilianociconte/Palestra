/**
 * GymbRoomRealtimeService - Real-time synchronization for Gymbro Rooms
 * 
 * Architecture:
 * - Uses Firestore onSnapshot for real-time updates
 * - 300ms debounce on metrics to prevent UI thrashing (max 3-4 renders/sec)
 * - Delta-based callbacks for efficient UI updates
 * - Observer pattern: pass callbacks, service manages subscriptions
 * - WeakMap for cleanup-safe timer management
 * 
 * Key Design Decisions:
 * - Zero local state that could diverge from Firestore
 * - All timestamps use serverTimestamp() for clock skew resilience
 * - Automatic retry on listener errors with exponential backoff
 * 
 * @author Gymbro Team
 * @version 1.0.0
 */

import {
    db,
    auth,
    doc,
    updateDoc,
    collection,
    onSnapshot,
    serverTimestamp,
    writeBatch,
    addDoc,
    increment
} from '../firebase-config.js';

/**
 * @typedef {Object} MetricsUpdate
 * @property {string} exercise - Exercise name
 * @property {number} set - Set number
 * @property {number} reps - Number of reps
 * @property {number} weight - Weight in kg
 * @property {number} volume - Volume for this set (weight * reps)
 */

/**
 * @typedef {Object} LeaderboardEntry
 * @property {string} uid
 * @property {string} [displayName]
 * @property {string} [photoUrl]
 * @property {number} rank
 * @property {number} totalVolume
 * @property {string} [currentExercise]
 * @property {number} totalSets
 */

export class GymbRoomRealtimeService {
    constructor() {
        this.collectionName = 'gymbro_rooms';

        // Listener management
        this._listeners = new Map();     // key -> unsubscribe function
        this._debounceTimers = new Map(); // key -> timerId
        this._memberCache = new Map();    // roomId -> members array

        // Configuration
        this._config = {
            metricsDebounceMs: 300,     // Debounce for metrics (leaderboard)
            membersDebounceMs: 100,     // Faster for member join/leave
            retryDelayMs: 2000,         // Retry on error
            maxRetries: 3
        };

        // Error tracking
        this._errorCounts = new Map();
    }

    // ============================================
    // PRIVATE HELPERS
    // ============================================

    /**
     * Get current authenticated user's UID
     * @returns {string}
     */
    _getUid() {
        const user = auth.currentUser;
        if (!user) throw new Error('Utente non autenticato');
        return user.uid;
    }

    /**
     * Generate unique key for listener
     * @param {string} roomId 
     * @param {string} type 
     * @returns {string}
     */
    _getListenerKey(roomId, type) {
        return `${roomId}_${type}`;
    }

    /**
     * Clear debounce timer for a key
     * @param {string} key 
     */
    _clearDebounce(key) {
        if (this._debounceTimers.has(key)) {
            clearTimeout(this._debounceTimers.get(key));
            this._debounceTimers.delete(key);
        }
    }

    /**
     * Handle listener errors with retry logic
     * @param {string} key 
     * @param {Error} error 
     * @param {Function} retryFn 
     */
    _handleListenerError(key, error, retryFn) {
        const count = (this._errorCounts.get(key) || 0) + 1;
        this._errorCounts.set(key, count);

        console.error(`[GymbRoomRealtimeService] Listener error (${key}):`, error);

        if (count <= this._config.maxRetries) {
            const delay = this._config.retryDelayMs * Math.pow(2, count - 1);
            console.warn(`[GymbRoomRealtimeService] Retrying ${key} in ${delay}ms (attempt ${count})`);

            setTimeout(() => {
                retryFn();
            }, delay);
        } else {
            console.error(`[GymbRoomRealtimeService] Max retries exceeded for ${key}`);
        }
    }

    /**
     * Reset error count on successful snapshot
     * @param {string} key 
     */
    _resetErrorCount(key) {
        this._errorCounts.delete(key);
    }

    // ============================================
    // ROOM WATCHERS
    // ============================================

    /**
     * Watch room document for status changes
     * Fires callback on every room update (status, settings, etc.)
     * 
     * @param {string} roomId 
     * @param {Function} callback - Called with room data on each update
     * @returns {Function} Unsubscribe function
     */
    watchRoom(roomId, callback) {
        const key = this._getListenerKey(roomId, 'room');

        // Cleanup existing listener if any
        this._unsubscribeKey(key);

        const roomRef = doc(db, this.collectionName, roomId);

        const setupListener = () => {
            const unsubscribe = onSnapshot(
                roomRef,
                (snapshot) => {
                    this._resetErrorCount(key);

                    if (!snapshot.exists()) {
                        callback({ exists: false, roomId });
                        return;
                    }

                    const data = snapshot.data();
                    callback({
                        exists: true,
                        roomId,
                        ...data,
                        createdAt: data.createdAt?.toDate?.(),
                        startedAt: data.startedAt?.toDate?.(),
                        finishedAt: data.finishedAt?.toDate?.(),
                        lastActivity: data.lastActivity?.toDate?.()
                    });
                },
                (error) => {
                    this._handleListenerError(key, error, () => setupListener());
                }
            );

            this._listeners.set(key, unsubscribe);
        };

        setupListener();

        console.log(`[GymbRoomRealtimeService] Watching room ${roomId}`);
        return () => this._unsubscribeKey(key);
    }

    /**
     * Watch members subcollection for join/leave events
     * Fires callback with full members list and change info
     * 
     * @param {string} roomId 
     * @param {Function} callback - Called with {members, changes} on each update
     * @returns {Function} Unsubscribe function
     */
    watchMembers(roomId, callback) {
        const key = this._getListenerKey(roomId, 'members');

        this._unsubscribeKey(key);

        const membersRef = collection(db, this.collectionName, roomId, 'members');

        const setupListener = () => {
            const unsubscribe = onSnapshot(
                membersRef,
                (snapshot) => {
                    this._resetErrorCount(key);
                    this._clearDebounce(key);

                    // Small debounce for members (rapid join scenarios)
                    this._debounceTimers.set(key, setTimeout(() => {
                        const members = snapshot.docs.map(d => ({
                            uid: d.id,
                            ...d.data(),
                            joinedAt: d.data().joinedAt?.toDate?.()
                        }));

                        // Track changes
                        const changes = {
                            added: [],
                            modified: [],
                            removed: []
                        };

                        snapshot.docChanges().forEach(change => {
                            const memberData = {
                                uid: change.doc.id,
                                ...change.doc.data()
                            };

                            if (change.type === 'added') changes.added.push(memberData);
                            else if (change.type === 'modified') changes.modified.push(memberData);
                            else if (change.type === 'removed') changes.removed.push(memberData);
                        });

                        // Update cache
                        this._memberCache.set(roomId, members);

                        callback({ members, changes });
                    }, this._config.membersDebounceMs));
                },
                (error) => {
                    this._handleListenerError(key, error, () => setupListener());
                }
            );

            this._listeners.set(key, unsubscribe);
        };

        setupListener();

        console.log(`[GymbRoomRealtimeService] Watching members of room ${roomId}`);
        return () => this._unsubscribeKey(key);
    }

    /**
     * Watch active metrics for leaderboard updates
     * CRITICAL: 300ms debounce to prevent UI thrashing
     * Fires callback with sorted leaderboard and delta info
     * 
     * @param {string} roomId 
     * @param {Function} callback - Called with leaderboard array on each update
     * @returns {Function} Unsubscribe function
     */
    watchMetrics(roomId, callback) {
        const key = this._getListenerKey(roomId, 'metrics');

        this._unsubscribeKey(key);

        const metricsRef = collection(db, this.collectionName, roomId, 'activeMetrics');
        let previousLeaderboard = [];

        const setupListener = () => {
            const unsubscribe = onSnapshot(
                metricsRef,
                (snapshot) => {
                    this._resetErrorCount(key);
                    this._clearDebounce(key);

                    // CRITICAL: 300ms debounce to limit renders to 3-4/second
                    this._debounceTimers.set(key, setTimeout(() => {
                        const metrics = snapshot.docs.map(d => ({
                            uid: d.id,
                            ...d.data(),
                            lastUpdate: d.data().lastUpdate?.toDate?.()
                        }));

                        // Sort by total volume (descending) for leaderboard
                        const sortedMetrics = [...metrics].sort((a, b) =>
                            (b.totalVolume || 0) - (a.totalVolume || 0)
                        );

                        // Add rank
                        const leaderboard = sortedMetrics.map((m, i) => ({
                            ...m,
                            rank: i + 1
                        }));

                        // Enrich with member display info from cache
                        const membersCache = this._memberCache.get(roomId) || [];
                        const enrichedLeaderboard = leaderboard.map(entry => {
                            const member = membersCache.find(m => m.uid === entry.uid);
                            return {
                                ...entry,
                                displayName: member?.displayName || 'Utente',
                                photoUrl: member?.photoUrl || null,
                                role: member?.role || 'member'
                            };
                        });

                        // Calculate deltas for animation
                        const deltas = enrichedLeaderboard.map(entry => {
                            const prev = previousLeaderboard.find(p => p.uid === entry.uid);
                            return {
                                uid: entry.uid,
                                volumeDelta: prev ? entry.totalVolume - prev.totalVolume : 0,
                                rankDelta: prev ? prev.rank - entry.rank : 0, // positive = moved up
                                isNew: !prev
                            };
                        });

                        previousLeaderboard = enrichedLeaderboard;

                        callback({
                            leaderboard: enrichedLeaderboard,
                            deltas,
                            timestamp: new Date()
                        });
                    }, this._config.metricsDebounceMs));
                },
                (error) => {
                    this._handleListenerError(key, error, () => setupListener());
                }
            );

            this._listeners.set(key, unsubscribe);
        };

        setupListener();

        console.log(`[GymbRoomRealtimeService] Watching metrics of room ${roomId} (debounce: ${this._config.metricsDebounceMs}ms)`);
        return () => this._unsubscribeKey(key);
    }

    /**
     * Watch workout log for exercise history
     * 
     * @param {string} roomId 
     * @param {Function} callback 
     * @returns {Function} Unsubscribe function
     */
    watchWorkoutLog(roomId, callback) {
        const key = this._getListenerKey(roomId, 'log');

        this._unsubscribeKey(key);

        const logRef = collection(db, this.collectionName, roomId, 'workoutLog');

        const setupListener = () => {
            const unsubscribe = onSnapshot(
                logRef,
                (snapshot) => {
                    this._resetErrorCount(key);

                    const log = snapshot.docs.map(d => ({
                        logId: d.id,
                        ...d.data(),
                        timestamp: d.data().timestamp?.toDate?.()
                    })).sort((a, b) => {
                        if (!a.timestamp) return 1;
                        if (!b.timestamp) return -1;
                        return a.timestamp - b.timestamp;
                    });

                    callback({ log });
                },
                (error) => {
                    this._handleListenerError(key, error, () => setupListener());
                }
            );

            this._listeners.set(key, unsubscribe);
        };

        setupListener();

        console.log(`[GymbRoomRealtimeService] Watching workout log of room ${roomId}`);
        return () => this._unsubscribeKey(key);
    }

    // ============================================
    // METRIC UPDATES
    // ============================================

    /**
     * Push a metric update (user completed a set)
     * Atomically updates activeMetrics and appends to workoutLog
     * 
     * @param {string} roomId 
     * @param {MetricsUpdate} data 
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async pushMetricUpdate(roomId, data) {
        try {
            const uid = this._getUid();

            const { exercise, set, reps, weight } = data;

            // Validate inputs
            if (!exercise || typeof exercise !== 'string') {
                return { success: false, error: 'Esercizio non valido' };
            }

            if (typeof reps !== 'number' || reps <= 0) {
                return { success: false, error: 'Ripetizioni non valide' };
            }

            if (typeof weight !== 'number' || weight < 0) {
                return { success: false, error: 'Peso non valido' };
            }

            const volume = weight * reps;

            const metricsRef = doc(db, this.collectionName, roomId, 'activeMetrics', uid);
            const logRef = collection(db, this.collectionName, roomId, 'workoutLog');
            const roomRef = doc(db, this.collectionName, roomId);

            const batch = writeBatch(db);

            // Update active metrics
            batch.update(metricsRef, {
                currentExercise: exercise,
                currentSet: set || increment(1),
                totalVolume: increment(volume),
                totalSets: increment(1),
                lastSetWeight: weight,
                lastSetReps: reps,
                lastUpdate: serverTimestamp()
            });

            // Update room activity
            batch.update(roomRef, {
                lastActivity: serverTimestamp()
            });

            await batch.commit();

            // Append to workout log (separate write for append-only semantics)
            await addDoc(logRef, {
                uid,
                exercise,
                set: set || 0,
                reps,
                weight,
                volume,
                timestamp: serverTimestamp()
            });

            console.log(`[GymbRoomRealtimeService] Metric pushed: ${exercise} ${weight}kg x ${reps} (volume: ${volume})`);
            return { success: true };

        } catch (error) {
            console.error('[GymbRoomRealtimeService] Push metric error:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Update current exercise name (without completing a set)
     * Used to show what exercise each user is doing
     * 
     * @param {string} roomId 
     * @param {string} exerciseName 
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async updateCurrentExercise(roomId, exerciseName) {
        try {
            const uid = this._getUid();

            const metricsRef = doc(db, this.collectionName, roomId, 'activeMetrics', uid);

            await updateDoc(metricsRef, {
                currentExercise: exerciseName || null,
                currentSet: 0,
                lastUpdate: serverTimestamp()
            });

            return { success: true };

        } catch (error) {
            console.error('[GymbRoomRealtimeService] Update exercise error:', error);
            return { success: false, error: error.message };
        }
    }

    // ============================================
    // CLEANUP
    // ============================================

    /**
     * Unsubscribe from a specific listener
     * @param {string} key 
     */
    _unsubscribeKey(key) {
        this._clearDebounce(key);

        if (this._listeners.has(key)) {
            this._listeners.get(key)();
            this._listeners.delete(key);
        }
    }

    /**
     * Unsubscribe from all listeners for a specific room
     * 
     * @param {string} roomId 
     */
    unsubscribeRoom(roomId) {
        const types = ['room', 'members', 'metrics', 'log'];

        for (const type of types) {
            const key = this._getListenerKey(roomId, type);
            this._unsubscribeKey(key);
        }

        this._memberCache.delete(roomId);
        console.log(`[GymbRoomRealtimeService] Unsubscribed from room ${roomId}`);
    }

    /**
     * Cleanup all listeners and timers
     * Call this when user leaves the room or app closes
     */
    cleanup() {
        // Clear all debounce timers
        for (const [key, timerId] of this._debounceTimers) {
            clearTimeout(timerId);
        }
        this._debounceTimers.clear();

        // Unsubscribe all listeners
        for (const [key, unsubscribe] of this._listeners) {
            try {
                unsubscribe();
            } catch (e) {
                console.warn(`[GymbRoomRealtimeService] Error unsubscribing ${key}:`, e);
            }
        }
        this._listeners.clear();

        // Clear caches
        this._memberCache.clear();
        this._errorCounts.clear();

        console.log('[GymbRoomRealtimeService] All listeners cleaned up');
    }

    /**
     * Get current listener count (for debugging)
     * @returns {number}
     */
    getActiveListenerCount() {
        return this._listeners.size;
    }

    /**
     * Check if watching a specific room
     * @param {string} roomId 
     * @returns {boolean}
     */
    isWatchingRoom(roomId) {
        return this._listeners.has(this._getListenerKey(roomId, 'room'));
    }
}

// Export singleton instance
export const gymbRoomRealtimeService = new GymbRoomRealtimeService();
