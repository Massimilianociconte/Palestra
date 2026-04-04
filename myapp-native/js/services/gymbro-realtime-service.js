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
} from "../firebase-config.js";

export class GymbRoomRealtimeService {
    constructor() {
        this.collectionName = "gymbro_rooms";
        this._listeners = new Map();
        this._debounceTimers = new Map();
        this._memberCache = new Map();
        this._config = {
            metricsDebounceMs: 300,
            membersDebounceMs: 100,
            retryDelayMs: 2000,
            maxRetries: 3
        };
        this._errorCounts = new Map();
    }

    _getUid() {
        const user = auth.currentUser;
        if (!user) {
            throw new Error("Utente non autenticato");
        }

        return user.uid;
    }

    _normalizeRoomId(roomId) {
        return String(roomId || "").trim().toUpperCase();
    }

    _getListenerKey(roomId, type) {
        return `${roomId}_${type}`;
    }

    _clearDebounce(key) {
        if (this._debounceTimers.has(key)) {
            clearTimeout(this._debounceTimers.get(key));
            this._debounceTimers.delete(key);
        }
    }

    _handleListenerError(key, error, retryFn) {
        const count = (this._errorCounts.get(key) || 0) + 1;
        this._errorCounts.set(key, count);
        console.error(`[GymbRoomRealtimeService] Listener error (${key}):`, error);

        if (count <= this._config.maxRetries) {
            const delay = this._config.retryDelayMs * (2 ** (count - 1));
            console.warn(`[GymbRoomRealtimeService] Retrying ${key} in ${delay}ms (attempt ${count})`);
            setTimeout(() => {
                retryFn();
            }, delay);
            return;
        }

        console.error(`[GymbRoomRealtimeService] Max retries exceeded for ${key}`);
    }

    _resetErrorCount(key) {
        this._errorCounts.delete(key);
    }

    watchRoom(roomId, callback) {
        const normalizedRoomId = this._normalizeRoomId(roomId);
        const key = this._getListenerKey(normalizedRoomId, "room");
        this._unsubscribeKey(key);

        const roomRef = doc(db, this.collectionName, normalizedRoomId);
        const setupListener = () => {
            const unsubscribe = onSnapshot(
                roomRef,
                (snapshot) => {
                    this._resetErrorCount(key);

                    if (!snapshot.exists()) {
                        callback({ exists: false, roomId: normalizedRoomId });
                        return;
                    }

                    const data = snapshot.data();
                    callback({
                        exists: true,
                        roomId: normalizedRoomId,
                        ...data,
                        createdAt: data.createdAt?.toDate?.(),
                        startedAt: data.startedAt?.toDate?.(),
                        finishedAt: data.finishedAt?.toDate?.(),
                        lastActivity: data.lastActivity?.toDate?.()
                    });
                },
                (error) => {
                    this._handleListenerError(key, error, setupListener);
                }
            );

            this._listeners.set(key, unsubscribe);
        };

        setupListener();
        console.log(`[GymbRoomRealtimeService] Watching room ${normalizedRoomId}`);
        return () => this._unsubscribeKey(key);
    }

    watchMembers(roomId, callback) {
        const normalizedRoomId = this._normalizeRoomId(roomId);
        const key = this._getListenerKey(normalizedRoomId, "members");
        this._unsubscribeKey(key);

        const membersRef = collection(db, this.collectionName, normalizedRoomId, "members");
        const setupListener = () => {
            const unsubscribe = onSnapshot(
                membersRef,
                (snapshot) => {
                    this._resetErrorCount(key);
                    this._clearDebounce(key);

                    this._debounceTimers.set(
                        key,
                        setTimeout(() => {
                            const members = snapshot.docs.map((memberDoc) => ({
                                uid: memberDoc.id,
                                ...memberDoc.data(),
                                joinedAt: memberDoc.data().joinedAt?.toDate?.()
                            }));

                            const changes = {
                                added: [],
                                modified: [],
                                removed: []
                            };

                            snapshot.docChanges().forEach((change) => {
                                const memberData = {
                                    uid: change.doc.id,
                                    ...change.doc.data()
                                };

                                if (change.type === "added") {
                                    changes.added.push(memberData);
                                } else if (change.type === "modified") {
                                    changes.modified.push(memberData);
                                } else if (change.type === "removed") {
                                    changes.removed.push(memberData);
                                }
                            });

                            this._memberCache.set(normalizedRoomId, members);
                            callback({ members, changes });
                        }, this._config.membersDebounceMs)
                    );
                },
                (error) => {
                    this._handleListenerError(key, error, setupListener);
                }
            );

            this._listeners.set(key, unsubscribe);
        };

        setupListener();
        console.log(`[GymbRoomRealtimeService] Watching members of room ${normalizedRoomId}`);
        return () => this._unsubscribeKey(key);
    }

    watchMetrics(roomId, callback) {
        const normalizedRoomId = this._normalizeRoomId(roomId);
        const key = this._getListenerKey(normalizedRoomId, "metrics");
        this._unsubscribeKey(key);

        const metricsRef = collection(db, this.collectionName, normalizedRoomId, "activeMetrics");
        let previousLeaderboard = [];

        const setupListener = () => {
            const unsubscribe = onSnapshot(
                metricsRef,
                (snapshot) => {
                    this._resetErrorCount(key);
                    this._clearDebounce(key);

                    this._debounceTimers.set(
                        key,
                        setTimeout(() => {
                            const metrics = snapshot.docs.map((metricsDoc) => ({
                                uid: metricsDoc.id,
                                ...metricsDoc.data(),
                                lastUpdate: metricsDoc.data().lastUpdate?.toDate?.()
                            }));

                            const sortedMetrics = [...metrics].sort(
                                (left, right) => (right.totalVolume || 0) - (left.totalVolume || 0)
                            );

                            const leaderboard = sortedMetrics.map((entry, index) => ({
                                ...entry,
                                rank: index + 1
                            }));

                            const membersCache = this._memberCache.get(normalizedRoomId) || [];
                            const enrichedLeaderboard = leaderboard.map((entry) => {
                                const member = membersCache.find((cachedMember) => cachedMember.uid === entry.uid);
                                return {
                                    ...entry,
                                    displayName: member?.displayName || "Utente",
                                    photoUrl: member?.photoUrl || null,
                                    role: member?.role || "member"
                                };
                            });

                            const deltas = enrichedLeaderboard.map((entry) => {
                                const previous = previousLeaderboard.find((cachedEntry) => cachedEntry.uid === entry.uid);
                                return {
                                    uid: entry.uid,
                                    volumeDelta: previous ? entry.totalVolume - previous.totalVolume : 0,
                                    rankDelta: previous ? previous.rank - entry.rank : 0,
                                    isNew: !previous
                                };
                            });

                            previousLeaderboard = enrichedLeaderboard;
                            callback({
                                leaderboard: enrichedLeaderboard,
                                deltas,
                                timestamp: new Date()
                            });
                        }, this._config.metricsDebounceMs)
                    );
                },
                (error) => {
                    this._handleListenerError(key, error, setupListener);
                }
            );

            this._listeners.set(key, unsubscribe);
        };

        setupListener();
        console.log(
            `[GymbRoomRealtimeService] Watching metrics of room ${normalizedRoomId} (debounce: ${this._config.metricsDebounceMs}ms)`
        );
        return () => this._unsubscribeKey(key);
    }

    watchWorkoutLog(roomId, callback) {
        const normalizedRoomId = this._normalizeRoomId(roomId);
        const key = this._getListenerKey(normalizedRoomId, "log");
        this._unsubscribeKey(key);

        const logRef = collection(db, this.collectionName, normalizedRoomId, "workoutLog");
        const setupListener = () => {
            const unsubscribe = onSnapshot(
                logRef,
                (snapshot) => {
                    this._resetErrorCount(key);

                    const log = snapshot.docs
                        .map((logDoc) => ({
                            logId: logDoc.id,
                            ...logDoc.data(),
                            timestamp: logDoc.data().timestamp?.toDate?.()
                        }))
                        .sort((left, right) => {
                            if (!left.timestamp) return 1;
                            if (!right.timestamp) return -1;
                            return left.timestamp - right.timestamp;
                        });

                    callback({ log });
                },
                (error) => {
                    this._handleListenerError(key, error, setupListener);
                }
            );

            this._listeners.set(key, unsubscribe);
        };

        setupListener();
        console.log(`[GymbRoomRealtimeService] Watching workout log of room ${normalizedRoomId}`);
        return () => this._unsubscribeKey(key);
    }

    async pushMetricUpdate(roomId, data) {
        try {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();
            const { exercise, set, reps, weight } = data;

            if (!normalizedRoomId) {
                return { success: false, error: "ID room non valido" };
            }

            if (!exercise || typeof exercise !== "string") {
                return { success: false, error: "Esercizio non valido" };
            }

            if (typeof reps !== "number" || reps <= 0) {
                return { success: false, error: "Ripetizioni non valide" };
            }

            if (typeof weight !== "number" || weight < 0) {
                return { success: false, error: "Peso non valido" };
            }

            const explicitSet = Number.isFinite(set) && set > 0 ? set : null;
            const volume = weight * reps;
            const metricsRef = doc(db, this.collectionName, normalizedRoomId, "activeMetrics", uid);
            const logRef = collection(db, this.collectionName, normalizedRoomId, "workoutLog");
            const roomRef = doc(db, this.collectionName, normalizedRoomId);
            const batch = writeBatch(db);

            batch.update(metricsRef, {
                currentExercise: exercise,
                currentSet: explicitSet ?? increment(1),
                totalVolume: increment(volume),
                totalSets: increment(1),
                lastSetWeight: weight,
                lastSetReps: reps,
                lastUpdate: serverTimestamp()
            });

            batch.update(roomRef, {
                lastActivity: serverTimestamp()
            });

            await batch.commit();

            const logEntry = {
                uid,
                exercise,
                reps,
                weight,
                volume,
                timestamp: serverTimestamp()
            };

            if (explicitSet !== null) {
                logEntry.set = explicitSet;
            }

            await addDoc(logRef, logEntry);

            console.log(
                `[GymbRoomRealtimeService] Metric pushed: ${exercise} ${weight}kg x ${reps} (volume: ${volume})`
            );
            return { success: true };
        } catch (error) {
            console.error("[GymbRoomRealtimeService] Push metric error:", error);
            return { success: false, error: error.message };
        }
    }

    async updateCurrentExercise(roomId, exerciseName) {
        try {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();
            const metricsRef = doc(db, this.collectionName, normalizedRoomId, "activeMetrics", uid);

            await updateDoc(metricsRef, {
                currentExercise: exerciseName || null,
                currentSet: 0,
                lastUpdate: serverTimestamp()
            });

            return { success: true };
        } catch (error) {
            console.error("[GymbRoomRealtimeService] Update exercise error:", error);
            return { success: false, error: error.message };
        }
    }

    _unsubscribeKey(key) {
        this._clearDebounce(key);

        if (this._listeners.has(key)) {
            this._listeners.get(key)();
            this._listeners.delete(key);
        }
    }

    unsubscribeRoom(roomId) {
        const normalizedRoomId = this._normalizeRoomId(roomId);
        const types = ["room", "members", "metrics", "log"];

        for (const type of types) {
            const key = this._getListenerKey(normalizedRoomId, type);
            this._unsubscribeKey(key);
        }

        this._memberCache.delete(normalizedRoomId);
        console.log(`[GymbRoomRealtimeService] Unsubscribed from room ${normalizedRoomId}`);
    }

    cleanup() {
        for (const timerId of this._debounceTimers.values()) {
            clearTimeout(timerId);
        }
        this._debounceTimers.clear();

        for (const [key, unsubscribe] of this._listeners) {
            try {
                unsubscribe();
            } catch (error) {
                console.warn(`[GymbRoomRealtimeService] Error unsubscribing ${key}:`, error);
            }
        }

        this._listeners.clear();
        this._memberCache.clear();
        this._errorCounts.clear();
        console.log("[GymbRoomRealtimeService] All listeners cleaned up");
    }

    getActiveListenerCount() {
        return this._listeners.size;
    }

    isWatchingRoom(roomId) {
        const normalizedRoomId = this._normalizeRoomId(roomId);
        return this._listeners.has(this._getListenerKey(normalizedRoomId, "room"));
    }
}

export const gymbRoomRealtimeService = new GymbRoomRealtimeService();
