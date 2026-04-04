import {
    db,
    auth,
    doc,
    getDoc,
    updateDoc,
    deleteDoc,
    collection,
    query,
    where,
    orderBy,
    limit,
    getDocs,
    serverTimestamp,
    writeBatch,
    runTransaction,
    addDoc,
    increment
} from "../firebase-config.js";

export class GymbRoomService {
    constructor() {
        this.collectionName = "gymbro_rooms";
        this._retryConfig = {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 8000
        };
    }

    _getUid() {
        const user = auth.currentUser;
        if (!user) {
            throw new Error("Utente non autenticato");
        }

        return user.uid;
    }

    async _getUserProfile() {
        const user = auth.currentUser;
        if (!user) {
            throw new Error("Utente non autenticato");
        }

        return {
            displayName: user.displayName || "Utente",
            photoUrl: user.photoURL || null,
            email: user.email
        };
    }

    _normalizeRoomId(roomId) {
        return String(roomId || "").trim().toUpperCase();
    }

    _generateRoomId() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let result = "";

        for (let index = 0; index < 6; index += 1) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        return result;
    }

    async _generateUniqueRoomId() {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            const roomId = this._generateRoomId();
            const roomRef = doc(db, this.collectionName, roomId);
            const roomSnap = await getDoc(roomRef);

            if (!roomSnap.exists()) {
                return roomId;
            }
        }

        throw new Error("Impossibile generare un codice stanza univoco");
    }

    _isNonRetryableError(error) {
        const nonRetryableCodes = new Set([
            "permission-denied",
            "invalid-argument",
            "not-found",
            "already-exists",
            "failed-precondition"
        ]);

        if (nonRetryableCodes.has(error?.code)) {
            return true;
        }

        const message = String(error?.message || "").toLowerCase();
        const nonRetryableMessages = [
            "utente non autenticato",
            "nome room",
            "nome troppo lungo",
            "room non trovata",
            "room terminata",
            "room piena",
            "sei gia nella room",
            "sei già nella room",
            "solo l'host",
            "questo invito non è per te",
            "questo invito non e per te",
            "invito non trovato",
            "usa leaveroom",
            "il nuovo host deve essere un membro",
            "impossibile generare un codice stanza univoco"
        ];

        return nonRetryableMessages.some((fragment) => message.includes(fragment));
    }

    async _withRetry(operation, operationName) {
        let lastError;

        for (let attempt = 0; attempt < this._retryConfig.maxRetries; attempt += 1) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;

                if (this._isNonRetryableError(error)) {
                    throw error;
                }

                const delay = Math.min(
                    this._retryConfig.baseDelay * (2 ** attempt),
                    this._retryConfig.maxDelay
                );

                console.warn(
                    `[GymbRoomService] ${operationName} attempt ${attempt + 1} failed, retrying in ${delay}ms...`
                );

                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        throw lastError;
    }

    async createRoom(config) {
        return this._withRetry(async () => {
            const hostUid = this._getUid();
            const profile = await this._getUserProfile();
            const name = typeof config?.name === "string" ? config.name.trim() : "";

            if (!name) {
                return { success: false, error: "Nome room richiesto", code: "invalid-argument" };
            }

            if (name.length > 50) {
                return { success: false, error: "Nome troppo lungo (max 50 caratteri)", code: "invalid-argument" };
            }

            const parsedCapacity = Number.parseInt(config?.maxCapacity, 10);
            const maxCapacity = Number.isFinite(parsedCapacity) ? Math.max(2, parsedCapacity) : 8;
            const roomId = await this._generateUniqueRoomId();
            const roomRef = doc(db, this.collectionName, roomId);
            const memberRef = doc(db, this.collectionName, roomId, "members", hostUid);
            const metricsRef = doc(db, this.collectionName, roomId, "activeMetrics", hostUid);
            const batch = writeBatch(db);

            batch.set(roomRef, {
                hostId: hostUid,
                name,
                workoutId: config?.workoutId || null,
                status: "lobby",
                maxCapacity,
                memberCount: 1,
                privacy: config?.privacy || "friends_only",
                createdAt: serverTimestamp(),
                lastActivity: serverTimestamp()
            });

            batch.set(memberRef, {
                displayName: profile.displayName,
                photoUrl: profile.photoUrl,
                readyStatus: true,
                role: "host",
                joinedAt: serverTimestamp()
            });

            batch.set(metricsRef, {
                currentExercise: null,
                currentSet: 0,
                totalVolume: 0,
                totalSets: 0,
                lastSetWeight: 0,
                lastSetReps: 0,
                lastUpdate: serverTimestamp()
            });

            await batch.commit();

            console.log(`[GymbRoomService] Room ${roomId} created by ${hostUid}`);
            return {
                success: true,
                data: {
                    roomId,
                    status: "lobby"
                }
            };
        }, "createRoom");
    }

    async joinRoom(roomId) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();
            const profile = await this._getUserProfile();

            if (!normalizedRoomId) {
                return { success: false, error: "ID room non valido", code: "invalid-argument" };
            }

            const roomRef = doc(db, this.collectionName, normalizedRoomId);
            const memberRef = doc(db, this.collectionName, normalizedRoomId, "members", uid);
            const metricsRef = doc(db, this.collectionName, normalizedRoomId, "activeMetrics", uid);

            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (!roomSnap.exists()) {
                    throw Object.assign(new Error("Room non trovata"), { code: "not-found" });
                }

                const roomData = roomSnap.data();
                if (roomData.status === "finished" || roomData.status === "archived") {
                    throw new Error("Room terminata");
                }

                const memberSnap = await transaction.get(memberRef);
                if (memberSnap.exists()) {
                    throw Object.assign(new Error("Sei già nella room"), { code: "already-exists" });
                }

                const currentCount = roomData.memberCount || 0;
                if (currentCount >= roomData.maxCapacity) {
                    throw new Error("Room piena");
                }

                transaction.update(roomRef, {
                    memberCount: increment(1),
                    lastActivity: serverTimestamp()
                });

                transaction.set(memberRef, {
                    displayName: profile.displayName,
                    photoUrl: profile.photoUrl,
                    readyStatus: false,
                    role: "member",
                    joinedAt: serverTimestamp()
                });

                transaction.set(metricsRef, {
                    currentExercise: null,
                    currentSet: 0,
                    totalVolume: 0,
                    totalSets: 0,
                    lastSetWeight: 0,
                    lastSetReps: 0,
                    lastUpdate: serverTimestamp()
                });
            });

            console.log(`[GymbRoomService] User ${uid} joined room ${normalizedRoomId}`);
            return {
                success: true,
                data: { roomId: normalizedRoomId }
            };
        }, "joinRoom");
    }

    async leaveRoom(roomId) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();

            if (!normalizedRoomId) {
                return { success: false, error: "ID room non valido", code: "invalid-argument" };
            }

            const roomRef = doc(db, this.collectionName, normalizedRoomId);
            const memberRef = doc(db, this.collectionName, normalizedRoomId, "members", uid);
            const metricsRef = doc(db, this.collectionName, normalizedRoomId, "activeMetrics", uid);
            const roomSnap = await getDoc(roomRef);

            if (!roomSnap.exists()) {
                return { success: false, error: "Room non trovata", code: "not-found" };
            }

            const roomData = roomSnap.data();
            const isHost = roomData.hostId === uid;
            const batch = writeBatch(db);

            batch.delete(memberRef);
            batch.delete(metricsRef);

            if (isHost) {
                batch.update(roomRef, {
                    status: "archived",
                    memberCount: increment(-1),
                    archivedAt: serverTimestamp(),
                    archivedReason: "host_left"
                });
                console.log(`[GymbRoomService] Host ${uid} left, archiving room ${normalizedRoomId}`);
            } else {
                batch.update(roomRef, {
                    memberCount: increment(-1),
                    lastActivity: serverTimestamp()
                });
            }

            await batch.commit();

            console.log(`[GymbRoomService] User ${uid} left room ${normalizedRoomId}`);
            return {
                success: true,
                data: { wasHost: isHost }
            };
        }, "leaveRoom");
    }

    async setReadyStatus(roomId, isReady) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();
            const memberRef = doc(db, this.collectionName, normalizedRoomId, "members", uid);

            await updateDoc(memberRef, { readyStatus: Boolean(isReady) });
            return { success: true };
        }, "setReadyStatus");
    }

    async startWorkout(roomId) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();

            if (!normalizedRoomId) {
                return { success: false, error: "ID room richiesto", code: "invalid-argument" };
            }

            const roomRef = doc(db, this.collectionName, normalizedRoomId);

            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (!roomSnap.exists()) {
                    throw Object.assign(new Error("Room non trovata"), { code: "not-found" });
                }

                const roomData = roomSnap.data();
                if (roomData.hostId !== uid) {
                    throw Object.assign(new Error("Solo l'host può avviare l'allenamento"), { code: "permission-denied" });
                }

                if (roomData.status !== "lobby") {
                    throw new Error("L'allenamento è già in corso o terminato");
                }

                transaction.update(roomRef, {
                    status: "active",
                    startedAt: serverTimestamp(),
                    lastActivity: serverTimestamp()
                });
            });

            console.log(`[GymbRoomService] Workout started in room ${normalizedRoomId}`);
            return {
                success: true,
                data: { status: "active" }
            };
        }, "startWorkout");
    }

    async endWorkout(roomId) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();

            if (!normalizedRoomId) {
                return { success: false, error: "ID room richiesto", code: "invalid-argument" };
            }

            const roomRef = doc(db, this.collectionName, normalizedRoomId);
            let finalMetrics = [];

            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (!roomSnap.exists()) {
                    throw Object.assign(new Error("Room non trovata"), { code: "not-found" });
                }

                const roomData = roomSnap.data();
                if (roomData.hostId !== uid) {
                    throw Object.assign(new Error("Solo l'host può terminare l'allenamento"), { code: "permission-denied" });
                }

                if (roomData.status !== "active") {
                    throw new Error("L'allenamento non è in corso");
                }

                const metricsSnap = await getDocs(collection(db, this.collectionName, normalizedRoomId, "activeMetrics"));
                finalMetrics = metricsSnap.docs.map((metricsDoc) => ({
                    uid: metricsDoc.id,
                    ...metricsDoc.data()
                }));

                transaction.update(roomRef, {
                    status: "finished",
                    finishedAt: serverTimestamp(),
                    lastActivity: serverTimestamp(),
                    finalLeaderboard: [...finalMetrics].sort((left, right) => (right.totalVolume || 0) - (left.totalVolume || 0))
                });
            });

            const leaderboard = [...finalMetrics].sort((left, right) => (right.totalVolume || 0) - (left.totalVolume || 0));

            console.log(`[GymbRoomService] Workout ended in room ${normalizedRoomId}`);
            return {
                success: true,
                data: {
                    status: "finished",
                    leaderboard
                }
            };
        }, "endWorkout");
    }

    async getRoom(roomId) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const roomRef = doc(db, this.collectionName, normalizedRoomId);
            const roomSnap = await getDoc(roomRef);

            if (!roomSnap.exists()) {
                return { success: false, error: "Room non trovata", code: "not-found" };
            }

            const data = roomSnap.data();
            return {
                success: true,
                data: {
                    roomId: normalizedRoomId,
                    ...data,
                    createdAt: data.createdAt?.toDate?.(),
                    startedAt: data.startedAt?.toDate?.(),
                    finishedAt: data.finishedAt?.toDate?.()
                }
            };
        }, "getRoom");
    }

    async getRoomMembers(roomId) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const membersRef = collection(db, this.collectionName, normalizedRoomId, "members");
            const membersSnap = await getDocs(query(membersRef, orderBy("joinedAt", "asc")));
            const members = membersSnap.docs.map((memberDoc) => ({
                uid: memberDoc.id,
                ...memberDoc.data(),
                joinedAt: memberDoc.data().joinedAt?.toDate?.()
            }));

            return { success: true, data: members };
        }, "getRoomMembers");
    }

    async getLeaderboard(roomId) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const metricsRef = collection(db, this.collectionName, normalizedRoomId, "activeMetrics");
            const metricsSnap = await getDocs(metricsRef);
            const leaderboard = metricsSnap.docs
                .map((metricsDoc) => ({
                    uid: metricsDoc.id,
                    ...metricsDoc.data(),
                    lastUpdate: metricsDoc.data().lastUpdate?.toDate?.()
                }))
                .sort((left, right) => (right.totalVolume || 0) - (left.totalVolume || 0))
                .map((entry, index) => ({
                    ...entry,
                    rank: index + 1
                }));

            return { success: true, data: leaderboard };
        }, "getLeaderboard");
    }

    async getMyActiveRooms() {
        return this._withRetry(async () => {
            const uid = this._getUid();
            const roomsRef = collection(db, this.collectionName);
            const roomsSnap = await getDocs(
                query(
                    roomsRef,
                    where("status", "in", ["lobby", "active"]),
                    orderBy("lastActivity", "desc"),
                    limit(20)
                )
            );

            const memberChecks = roomsSnap.docs.map(async (roomDoc) => {
                const memberRef = doc(db, this.collectionName, roomDoc.id, "members", uid);
                const memberSnap = await getDoc(memberRef);

                if (!memberSnap.exists()) {
                    return null;
                }

                return {
                    roomId: roomDoc.id,
                    ...roomDoc.data(),
                    myRole: memberSnap.data().role,
                    createdAt: roomDoc.data().createdAt?.toDate?.()
                };
            });

            const myRooms = (await Promise.all(memberChecks)).filter(Boolean);
            return { success: true, data: myRooms };
        }, "getMyActiveRooms");
    }

    async inviteMember(roomId, inviteeUid) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();
            const profile = await this._getUserProfile();

            if (!inviteeUid) {
                return { success: false, error: "ID utente richiesto", code: "invalid-argument" };
            }

            const roomRef = doc(db, this.collectionName, normalizedRoomId);
            const roomSnap = await getDoc(roomRef);
            if (!roomSnap.exists()) {
                return { success: false, error: "Room non trovata", code: "not-found" };
            }

            const roomData = roomSnap.data();
            if (roomData.hostId !== uid) {
                return { success: false, error: "Solo l'host può invitare", code: "permission-denied" };
            }

            const invitesRef = collection(db, this.collectionName, normalizedRoomId, "invites");
            const existingInvite = await getDocs(query(invitesRef, where("inviteeUid", "==", inviteeUid)));
            if (!existingInvite.empty) {
                return { success: false, error: "Utente già invitato", code: "already-exists" };
            }

            const memberRef = doc(db, this.collectionName, normalizedRoomId, "members", inviteeUid);
            const memberSnap = await getDoc(memberRef);
            if (memberSnap.exists()) {
                return { success: false, error: "Utente già nella room", code: "already-exists" };
            }

            await addDoc(invitesRef, {
                inviteeUid,
                invitedBy: uid,
                inviterName: profile.displayName,
                roomName: roomData.name,
                status: "pending",
                createdAt: serverTimestamp()
            });

            console.log(`[GymbRoomService] User ${inviteeUid} invited to room ${normalizedRoomId}`);
            return { success: true };
        }, "inviteMember");
    }

    async getMyInvites() {
        return this._withRetry(async () => {
            const uid = this._getUid();
            const roomsRef = collection(db, this.collectionName);
            const roomsSnap = await getDocs(query(roomsRef, where("status", "in", ["lobby", "active"])));

            const inviteChecks = roomsSnap.docs.map(async (roomDoc) => {
                const invitesRef = collection(db, this.collectionName, roomDoc.id, "invites");
                const inviteSnap = await getDocs(
                    query(invitesRef, where("inviteeUid", "==", uid), where("status", "==", "pending"))
                );

                return inviteSnap.docs.map((inviteDoc) => ({
                    inviteId: inviteDoc.id,
                    roomId: roomDoc.id,
                    roomName: roomDoc.data().name,
                    ...inviteDoc.data(),
                    createdAt: inviteDoc.data().createdAt?.toDate?.()
                }));
            });

            const invites = (await Promise.all(inviteChecks)).flat();
            return { success: true, data: invites };
        }, "getMyInvites");
    }

    async acceptInvite(roomId, inviteId) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();
            const profile = await this._getUserProfile();
            const roomRef = doc(db, this.collectionName, normalizedRoomId);
            const inviteRef = doc(db, this.collectionName, normalizedRoomId, "invites", inviteId);
            const memberRef = doc(db, this.collectionName, normalizedRoomId, "members", uid);
            const metricsRef = doc(db, this.collectionName, normalizedRoomId, "activeMetrics", uid);

            await runTransaction(db, async (transaction) => {
                const inviteSnap = await transaction.get(inviteRef);
                if (!inviteSnap.exists()) {
                    throw Object.assign(new Error("Invito non trovato"), { code: "not-found" });
                }

                const inviteData = inviteSnap.data();
                if (inviteData.inviteeUid !== uid) {
                    throw Object.assign(new Error("Questo invito non è per te"), { code: "permission-denied" });
                }

                const roomSnap = await transaction.get(roomRef);
                if (!roomSnap.exists()) {
                    throw Object.assign(new Error("Room non trovata"), { code: "not-found" });
                }

                const roomData = roomSnap.data();
                if (roomData.status === "finished" || roomData.status === "archived") {
                    throw new Error("Room terminata");
                }

                const memberSnap = await transaction.get(memberRef);
                if (!memberSnap.exists()) {
                    const currentCount = roomData.memberCount || 0;
                    if (currentCount >= roomData.maxCapacity) {
                        throw new Error("Room piena");
                    }

                    transaction.update(roomRef, {
                        memberCount: increment(1),
                        lastActivity: serverTimestamp()
                    });

                    transaction.set(memberRef, {
                        displayName: profile.displayName,
                        photoUrl: profile.photoUrl,
                        readyStatus: false,
                        role: "member",
                        joinedAt: serverTimestamp()
                    });

                    transaction.set(metricsRef, {
                        currentExercise: null,
                        currentSet: 0,
                        totalVolume: 0,
                        totalSets: 0,
                        lastSetWeight: 0,
                        lastSetReps: 0,
                        lastUpdate: serverTimestamp()
                    });
                }

                transaction.delete(inviteRef);
            });

            console.log(`[GymbRoomService] Invite ${inviteId} accepted for room ${normalizedRoomId}`);
            return {
                success: true,
                data: { roomId: normalizedRoomId }
            };
        }, "acceptInvite");
    }

    async declineInvite(roomId, inviteId) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();
            const inviteRef = doc(db, this.collectionName, normalizedRoomId, "invites", inviteId);
            const inviteSnap = await getDoc(inviteRef);

            if (!inviteSnap.exists()) {
                return { success: false, error: "Invito non trovato", code: "not-found" };
            }

            const inviteData = inviteSnap.data();
            if (inviteData.inviteeUid !== uid) {
                return { success: false, error: "Questo invito non è per te", code: "permission-denied" };
            }

            await deleteDoc(inviteRef);
            return { success: true };
        }, "declineInvite");
    }

    async kickMember(roomId, memberUid) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();
            const roomRef = doc(db, this.collectionName, normalizedRoomId);
            const memberRef = doc(db, this.collectionName, normalizedRoomId, "members", memberUid);
            const metricsRef = doc(db, this.collectionName, normalizedRoomId, "activeMetrics", memberUid);

            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                if (!roomSnap.exists()) {
                    throw Object.assign(new Error("Room non trovata"), { code: "not-found" });
                }

                if (roomSnap.data().hostId !== uid) {
                    throw Object.assign(new Error("Solo l'host può rimuovere membri"), { code: "permission-denied" });
                }

                if (memberUid === uid) {
                    throw Object.assign(new Error("Usa leaveRoom per uscire"), { code: "invalid-argument" });
                }

                const memberSnap = await transaction.get(memberRef);
                if (!memberSnap.exists()) {
                    throw Object.assign(new Error("Membro non trovato"), { code: "not-found" });
                }

                transaction.delete(memberRef);
                transaction.delete(metricsRef);
                transaction.update(roomRef, {
                    memberCount: increment(-1),
                    lastActivity: serverTimestamp()
                });
            });

            console.log(`[GymbRoomService] User ${memberUid} kicked from room ${normalizedRoomId}`);
            return { success: true };
        }, "kickMember");
    }

    async transferHost(roomId, newHostUid) {
        return this._withRetry(async () => {
            const normalizedRoomId = this._normalizeRoomId(roomId);
            const uid = this._getUid();

            if (uid === newHostUid) {
                return { success: false, error: "Sei già l'host", code: "invalid-argument" };
            }

            const roomRef = doc(db, this.collectionName, normalizedRoomId);
            const currentHostMemberRef = doc(db, this.collectionName, normalizedRoomId, "members", uid);
            const newHostMemberRef = doc(db, this.collectionName, normalizedRoomId, "members", newHostUid);

            await runTransaction(db, async (transaction) => {
                const roomSnap = await transaction.get(roomRef);
                const newHostSnap = await transaction.get(newHostMemberRef);

                if (!roomSnap.exists()) {
                    throw Object.assign(new Error("Room non trovata"), { code: "not-found" });
                }

                if (roomSnap.data().hostId !== uid) {
                    throw Object.assign(new Error("Solo l'host può trasferire il ruolo"), { code: "permission-denied" });
                }

                if (!newHostSnap.exists()) {
                    throw new Error("Il nuovo host deve essere un membro della room");
                }

                transaction.update(roomRef, {
                    hostId: newHostUid,
                    lastActivity: serverTimestamp()
                });
                transaction.update(currentHostMemberRef, { role: "member" });
                transaction.update(newHostMemberRef, { role: "host" });
            });

            console.log(`[GymbRoomService] Host transferred from ${uid} to ${newHostUid} in room ${normalizedRoomId}`);
            return { success: true };
        }, "transferHost");
    }
}

export const gymbRoomService = new GymbRoomService();
