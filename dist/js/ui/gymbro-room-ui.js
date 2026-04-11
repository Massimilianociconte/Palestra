import { gymbRoomService } from "../services/gymbro-room-service.js";
import { gymbRoomRealtimeService } from "../services/gymbro-realtime-service.js";

function escapeHtml(value) {
    if (typeof window.escapeHtml === "function") {
        return window.escapeHtml(value);
    }

    if (value == null) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
    if (typeof window.escapeAttr === "function") {
        return window.escapeAttr(value);
    }

    return escapeHtml(value);
}

function safeImageUrl(url, fallback) {
    if (typeof url !== "string") {
        return fallback;
    }

    const trimmed = url.trim();
    if (!trimmed) {
        return fallback;
    }

    if (/^(https?:|data:image\/|blob:|\/)/i.test(trimmed)) {
        return trimmed;
    }

    return fallback;
}

function getPlaceholderAvatar(initial) {
    const char = String(initial || "?").trim().charAt(0).toUpperCase() || "?";
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" fill="#333" />
            <text x="50" y="55" font-size="40" text-anchor="middle" fill="#999">${char}</text>
        </svg>
    `.trim();

    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function getEmptyPlaceholderAvatar() {
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="50" fill="#333" />
        </svg>
    `.trim();

    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export class GymbRoomUI {
    constructor(options) {
        this.container = options.container;
        this.roomId = options.roomId;
        this.userId = options.userId;
        this.onRoomEnd = options.onRoomEnd || (() => {});
        this.onError = options.onError || console.error;

        this.state = {
            room: null,
            members: [],
            leaderboard: [],
            status: "loading",
            isHost: false
        };

        this._pendingRender = false;
        this._unsubscribers = [];
        this._toastTimeout = null;
        this._badges = {
            volumeKing: "👑",
            topThree: window.lucideIcon("trophy", { size: 14, color: "#ffd700" })
        };
    }

    async init() {
        try {
            this._renderLoading();

            const roomResult = await gymbRoomService.getRoom(this.roomId);
            if (!roomResult.success) {
                throw new Error(roomResult.error || "Room non trovata");
            }

            this.state.room = roomResult.data;
            this.state.isHost = roomResult.data.hostId === this.userId;
            this.state.status = roomResult.data.status;

            this._setupListeners();
            this._render();
        } catch (error) {
            this.onError(error);
            this._renderError(error.message);
        }
    }

    _setupListeners() {
        const unsubRoom = gymbRoomRealtimeService.watchRoom(this.roomId, (data) => {
            if (!data.exists) {
                this.onError(new Error("Room eliminata"));
                this._closeRoom();
                return;
            }

            const prevStatus = this.state.status;
            this.state.room = data;
            this.state.status = data.status;
            this.state.isHost = data.hostId === this.userId;

            if (prevStatus !== data.status) {
                if (data.status === "active" && prevStatus === "lobby") {
                    this._showToast("Allenamento iniziato!", "success");
                } else if (data.status === "finished") {
                    this._showToast("Allenamento terminato!", "success");
                    this.onRoomEnd(data);
                }
            }

            this._scheduleRender();
        });
        this._unsubscribers.push(unsubRoom);

        const unsubMembers = gymbRoomRealtimeService.watchMembers(this.roomId, ({ members, changes }) => {
            this.state.members = members;

            if (changes.added.length > 0) {
                const newMember = changes.added[0];
                if (newMember.uid !== this.userId) {
                    this._showToast(`${newMember.displayName || "Un utente"} e entrato`, "info");
                }
            }

            if (changes.removed.length > 0) {
                const leftMember = changes.removed[0];
                if (leftMember.uid !== this.userId) {
                    this._showToast(`${leftMember.displayName || "Un utente"} e uscito`, "info");
                }
            }

            this._scheduleRender();
        });
        this._unsubscribers.push(unsubMembers);

        const unsubMetrics = gymbRoomRealtimeService.watchMetrics(this.roomId, ({ leaderboard, deltas }) => {
            this.state.leaderboard = leaderboard;
            this._animateVolumeChanges(deltas);
            this._scheduleRender();
        });
        this._unsubscribers.push(unsubMetrics);
    }

    cleanup() {
        for (const unsub of this._unsubscribers) {
            try {
                unsub();
            } catch (error) {
                console.warn("[GymbRoomUI] Error unsubscribing:", error);
            }
        }

        this._unsubscribers = [];
        gymbRoomRealtimeService.unsubscribeRoom(this.roomId);

        if (this._toastTimeout) {
            clearTimeout(this._toastTimeout);
            this._toastTimeout = null;
        }

        if (window.gymbRoomUI === this) {
            delete window.gymbRoomUI;
        }
    }

    _scheduleRender() {
        if (this._pendingRender) {
            return;
        }

        this._pendingRender = true;
        requestAnimationFrame(() => {
            this._render();
            this._pendingRender = false;
        });
    }

    _render() {
        if (!this.container) {
            return;
        }

        switch (this.state.status) {
            case "lobby":
                this._renderLobby();
                break;
            case "active":
                this._renderTraining();
                break;
            case "finished":
                this._renderSummary();
                break;
            default:
                this._renderLoading();
        }
    }

    _renderLobby() {
        const { members, isHost } = this.state;
        const readyCount = members.filter((member) => member.readyStatus).length;
        const allReady = readyCount === members.length && members.length > 0;

        this.container.innerHTML = `
            <div class="gymbro-room">
                ${this._renderHeader()}

                <div class="gymbro-lobby">
                    <div class="gymbro-ready-counter">
                        <span>${readyCount}/${members.length}</span>
                        <small>pronti all'allenamento</small>
                    </div>

                    <div class="gymbro-members-grid">
                        ${members.map((member) => this._renderMemberCard(member)).join("")}
                    </div>

                    <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
                        ${isHost ? "" : `
                            <button
                                class="gymbro-btn gymbro-btn-${this._isMeReady() ? "secondary" : "success"}"
                                onclick="window.gymbRoomUI._toggleReady()"
                            >
                                ${this._isMeReady()
                                    ? `${window.lucideIcon("check-circle", { size: 14, color: "#00ff88" })} Pronto`
                                    : "Sono Pronto"}
                            </button>
                        `}

                        ${isHost ? `
                            <button
                                class="gymbro-btn gymbro-btn-primary gymbro-btn-lg"
                                onclick="window.gymbRoomUI._startWorkout()"
                                ${allReady ? "" : "disabled"}
                            >
                                ${window.lucideIcon("rocket", { size: 16 })} Inizia Allenamento
                            </button>
                        ` : ""}

                        <button class="gymbro-btn gymbro-btn-secondary" onclick="window.gymbRoomUI._leaveRoom()">
                            ${window.lucideIcon("door-open", { size: 16 })} Esci
                        </button>
                    </div>
                </div>
            </div>
        `;

        window.gymbRoomUI = this;
        window.refreshLucideIcons?.(this.container);
    }

    _renderMemberCard(member) {
        const isReady = Boolean(member.readyStatus);
        const isHost = member.role === "host";
        const isMe = member.uid === this.userId;
        const displayName = member.displayName || "Utente";
        const avatarPlaceholder = getPlaceholderAvatar(displayName);
        const fallbackAvatar = getEmptyPlaceholderAvatar();
        const photoUrl = safeImageUrl(member.photoUrl, avatarPlaceholder);

        return `
            <div class="gymbro-member-card ${isReady ? "ready" : ""} ${isHost ? "host" : ""}" data-uid="${escapeAttr(member.uid || "")}">
                <img
                    class="gymbro-member-avatar"
                    src="${escapeAttr(photoUrl)}"
                    alt="${escapeAttr(displayName)}"
                    onerror="this.onerror=null;this.src='${escapeAttr(fallbackAvatar)}'"
                />
                <span class="gymbro-member-name">${escapeHtml(displayName)}${isMe ? " (tu)" : ""}</span>
                <span class="gymbro-member-status">${isReady ? "Pronto" : "In attesa"}</span>
            </div>
        `;
    }

    _isMeReady() {
        const me = this.state.members.find((member) => member.uid === this.userId);
        return me?.readyStatus || false;
    }

    _renderTraining() {
        const { leaderboard } = this.state;

        this.container.innerHTML = `
            <div class="gymbro-room">
                ${this._renderHeader()}

                <div class="gymbro-leaderboard">
                    <div class="gymbro-leaderboard-header">
                        <h3>Classifica Live</h3>
                        ${this.state.isHost ? `
                            <button class="gymbro-btn gymbro-btn-danger gymbro-btn-sm" onclick="window.gymbRoomUI._endWorkout()">
                                ${window.lucideIcon("flag", { size: 16 })} Termina
                            </button>
                        ` : ""}
                    </div>

                    <div class="gymbro-leaderboard-list">
                        ${leaderboard.length > 0
                            ? leaderboard.map((entry) => this._renderLeaderboardItem(entry)).join("")
                            : '<p style="text-align: center; color: var(--gymbro-text-dim);">Nessuna attivita ancora...</p>'}
                    </div>
                </div>
            </div>
        `;

        window.gymbRoomUI = this;
        window.refreshLucideIcons?.(this.container);
    }

    _renderLeaderboardItem(entry) {
        const isMe = entry.uid === this.userId;
        const badges = this._getBadges(entry);
        const displayName = entry.displayName || "Utente";
        const avatarPlaceholder = getPlaceholderAvatar(displayName);
        const photoUrl = safeImageUrl(entry.photoUrl, avatarPlaceholder);
        const totalVolume = Number(entry.totalVolume || 0);
        const volumeDisplay = totalVolume >= 1000 ? `${(totalVolume / 1000).toFixed(1)}k` : String(totalVolume);

        return `
            <div class="gymbro-leaderboard-item rank-${escapeAttr(entry.rank || "")}" data-uid="${escapeAttr(entry.uid || "")}">
                <div class="gymbro-leaderboard-rank">#${entry.rank}</div>

                <img
                    class="gymbro-leaderboard-avatar"
                    src="${escapeAttr(photoUrl)}"
                    alt="${escapeAttr(displayName)}"
                />

                <div class="gymbro-leaderboard-info">
                    <div class="gymbro-leaderboard-name">${escapeHtml(displayName)}${isMe ? " (tu)" : ""}</div>
                    <div class="gymbro-leaderboard-exercise">
                        ${escapeHtml(entry.currentExercise || "-")}
                        ${entry.totalSets > 0 ? `• Set ${entry.totalSets}` : ""}
                    </div>
                </div>

                <div class="gymbro-leaderboard-volume">
                    <div class="gymbro-leaderboard-volume-value" id="volume-${escapeAttr(entry.uid || "")}">
                        ${volumeDisplay}
                    </div>
                    <div class="gymbro-leaderboard-volume-unit">kg</div>
                </div>

                ${badges.length > 0 ? `
                    <div class="gymbro-badges">
                        ${badges.map((badge) => `<span class="gymbro-badge">${badge}</span>`).join("")}
                    </div>
                ` : ""}
            </div>
        `;
    }

    _getBadges(entry) {
        const badges = [];

        if (entry.rank === 1 && entry.totalVolume > 0) {
            badges.push(this._badges.volumeKing);
        }

        if (entry.rank <= 3 && entry.totalVolume > 0) {
            badges.push(this._badges.topThree);
        }

        return badges;
    }

    _renderSummary() {
        const { leaderboard } = this.state;
        const top3 = leaderboard.slice(0, 3);
        const totalVolume = leaderboard.reduce((sum, entry) => sum + (entry.totalVolume || 0), 0);
        const totalSets = leaderboard.reduce((sum, entry) => sum + (entry.totalSets || 0), 0);

        this.container.innerHTML = `
            <div class="gymbro-room">
                ${this._renderHeader()}

                <div class="gymbro-summary">
                    <h2 class="gymbro-summary-title">
                        ${window.lucideIcon("party-popper", { size: 20 })} Allenamento Completato!
                    </h2>

                    <div class="gymbro-podium">
                        ${top3.map((entry, index) => this._renderPodiumPlace(entry, index)).join("")}
                    </div>

                    <div class="gymbro-stats-grid">
                        <div class="gymbro-stat-card">
                            <div class="gymbro-stat-value">${(totalVolume / 1000).toFixed(1)}k</div>
                            <div class="gymbro-stat-label">Volume Totale (kg)</div>
                        </div>
                        <div class="gymbro-stat-card">
                            <div class="gymbro-stat-value">${totalSets}</div>
                            <div class="gymbro-stat-label">Serie Totali</div>
                        </div>
                        <div class="gymbro-stat-card">
                            <div class="gymbro-stat-value">${leaderboard.length}</div>
                            <div class="gymbro-stat-label">Partecipanti</div>
                        </div>
                    </div>

                    <div style="margin-top: 2rem; display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
                        <button class="gymbro-btn gymbro-btn-primary" onclick="window.gymbRoomUI._closeRoom()">
                            ${window.lucideIcon("check-circle", { size: 14, color: "#00ff88" })} Chiudi
                        </button>
                    </div>
                </div>
            </div>
        `;

        window.gymbRoomUI = this;
        window.refreshLucideIcons?.(this.container);
    }

    _renderPodiumPlace(entry, index) {
        const medals = ["🥇", "🥈", "🥉"];
        const displayName = entry.displayName || "Utente";
        const volume = Number(entry.totalVolume || 0);
        const volumeDisplay = volume >= 1000 ? `${(volume / 1000).toFixed(1)}k kg` : `${volume} kg`;
        const avatarPlaceholder = getPlaceholderAvatar(displayName);
        const photoUrl = safeImageUrl(entry.photoUrl, avatarPlaceholder);

        return `
            <div class="gymbro-podium-place">
                <img class="gymbro-podium-avatar" src="${escapeAttr(photoUrl)}" alt="${escapeAttr(displayName)}" />
                <div class="gymbro-podium-name">${escapeHtml(displayName)}</div>
                <div class="gymbro-podium-volume">${volumeDisplay}</div>
                <div class="gymbro-podium-bar">${medals[index] || `#${index + 1}`}</div>
            </div>
        `;
    }

    _renderHeader() {
        const { room, status } = this.state;
        const statusLabels = {
            lobby: "In attesa",
            active: "In corso",
            finished: "Terminato"
        };

        return `
            <div class="gymbro-room-header">
                <div class="gymbro-room-title">
                    <h2>${escapeHtml(room?.name || "Gymbro Room")}</h2>
                    <span class="gymbro-room-status ${escapeAttr(status || "loading")}">${statusLabels[status] || escapeHtml(status || "loading")}</span>
                </div>

                <div class="gymbro-room-code" style="font-family: monospace; font-size: 0.875rem; color: var(--gymbro-text-dim);">
                    Room: <strong style="color: var(--gymbro-primary);">${escapeHtml(this.roomId)}</strong>
                </div>
            </div>
        `;
    }

    _renderLoading() {
        this.container.innerHTML = `
            <div class="gymbro-room" style="display: flex; align-items: center; justify-content: center; min-height: 300px;">
                <div class="gymbro-loading-spinner"></div>
            </div>
        `;
    }

    _renderError(message) {
        this.container.innerHTML = `
            <div class="gymbro-room" style="padding: 2rem; text-align: center;">
                <p style="color: var(--gymbro-danger); margin-bottom: 1rem;">
                    ${window.lucideIcon("x-circle", { size: 16, color: "#ff6b6b" })} ${escapeHtml(message)}
                </p>
                <button class="gymbro-btn gymbro-btn-secondary" onclick="window.gymbRoomUI._closeRoom()">
                    Chiudi
                </button>
            </div>
        `;

        window.gymbRoomUI = this;
        window.refreshLucideIcons?.(this.container);
    }

    _animateVolumeChanges(deltas) {
        if (!Array.isArray(deltas) || deltas.length === 0) {
            return;
        }

        for (const delta of deltas) {
            if (delta.volumeDelta <= 0) {
                continue;
            }

            const element = document.getElementById(`volume-${delta.uid}`);
            if (!element) {
                continue;
            }

            element.classList.add("updating");
            setTimeout(() => element.classList.remove("updating"), 300);
        }
    }

    _showToast(message, type = "info") {
        const existing = document.querySelector(".gymbro-toast");
        if (existing) {
            existing.remove();
        }

        const icons = {
            success: window.lucideIcon("check-circle", { size: 14, color: "#00ff88" }),
            error: window.lucideIcon("x-circle", { size: 14, color: "#ff6b6b" }),
            info: window.lucideIcon("info", { size: 14 }),
            warning: window.lucideIcon("alert-triangle", { size: 14, color: "#ffaa00" })
        };

        const toast = document.createElement("div");
        toast.className = `gymbro-toast ${type}`;
        toast.innerHTML = `
            <span class="gymbro-toast-icon">${icons[type] || ""}</span>
            <span class="gymbro-toast-message">${escapeHtml(message)}</span>
        `;

        document.body.appendChild(toast);
        window.refreshLucideIcons?.(toast);

        requestAnimationFrame(() => {
            toast.classList.add("show");
        });

        this._toastTimeout = setTimeout(() => {
            toast.classList.remove("show");
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    async _toggleReady() {
        try {
            const isReady = this._isMeReady();
            await gymbRoomService.setReadyStatus(this.roomId, !isReady);
        } catch (error) {
            this._showToast(error.message, "error");
        }
    }

    async _startWorkout() {
        try {
            const result = await gymbRoomService.startWorkout(this.roomId);
            if (!result.success) {
                throw new Error(result.error);
            }
        } catch (error) {
            this._showToast(error.message, "error");
        }
    }

    async _endWorkout() {
        if (!confirm("Sei sicuro di voler terminare l'allenamento per tutti?")) {
            return;
        }

        try {
            const result = await gymbRoomService.endWorkout(this.roomId);
            if (!result.success) {
                throw new Error(result.error);
            }
        } catch (error) {
            this._showToast(error.message, "error");
        }
    }

    async _leaveRoom() {
        if (!confirm("Sei sicuro di voler uscire dalla room?")) {
            return;
        }

        try {
            const result = await gymbRoomService.leaveRoom(this.roomId);
            if (!result.success) {
                throw new Error(result.error);
            }

            this._closeRoom();
        } catch (error) {
            this._showToast(error.message, "error");
        }
    }

    _closeRoom() {
        const room = this.state.room;
        this.cleanup();

        if (this.container) {
            this.container.innerHTML = "";
        }

        this.onRoomEnd(room);
    }
}

export function createGymbRoomUI(container, roomId, userId, options = {}) {
    const ui = new GymbRoomUI({
        container,
        roomId,
        userId,
        ...options
    });

    void ui.init();
    return ui;
}
