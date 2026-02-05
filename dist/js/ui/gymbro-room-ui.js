/**
 * GymbRoomUI - UI Components for Gymbro Room Social Layer
 * 
 * Architecture:
 * - Observer pattern: services emit updates → UI re-renders
 * - requestAnimationFrame for batched DOM updates (60fps)
 * - Three distinct views: Lobby, Training, Summary
 * - Delta-based animations for volume changes
 * 
 * @author Gymbro Team
 * @version 1.0.0
 */

import { gymbRoomService } from '../services/gymbro-room-service.js';
import { gymbRoomRealtimeService } from '../services/gymbro-realtime-service.js';

/**
 * Generate a placeholder avatar SVG data URI
 * @param {string} initial - Single character to display
 * @returns {string} Data URI for SVG
 */
function getPlaceholderAvatar(initial) {
    const char = (initial || '?')[0].toUpperCase();
    return `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ccircle cx=%2250%22 cy=%2250%22 r=%2250%22 fill=%22%23333%22/%3E%3Ctext x=%2250%22 y=%2255%22 font-size=%2240%22 text-anchor=%22middle%22 fill=%22%23999%22%3E${char}%3C/text%3E%3C/svg%3E`;
}

/**
 * Generate a simple placeholder avatar SVG (no text)
 * @returns {string} Data URI for SVG
 */
function getEmptyPlaceholderAvatar() {
    return `data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Ccircle cx=%2250%22 cy=%2250%22 r=%2250%22 fill=%22%23333%22/%3E%3C/svg%3E`;
}

/**
 * @typedef {Object} RoomUIOptions
 * @property {HTMLElement} container - Container element
 * @property {string} roomId - Room ID
 * @property {string} userId - Current user's UID
 * @property {Function} [onRoomEnd] - Callback when room ends
 * @property {Function} [onError] - Error callback
 */

export class GymbRoomUI {
    /**
     * @param {RoomUIOptions} options 
     */
    constructor(options) {
        this.container = options.container;
        this.roomId = options.roomId;
        this.userId = options.userId;
        this.onRoomEnd = options.onRoomEnd || (() => { });
        this.onError = options.onError || console.error;

        // State
        this.state = {
            room: null,
            members: [],
            leaderboard: [],
            status: 'loading', // loading, lobby, active, finished
            isHost: false
        };

        // Render flags
        this._pendingRender = false;
        this._unsubscribers = [];

        // Badge thresholds
        this._badges = {
            volumeKing: '👑',
            onFire: '🔥',
            topThree: '🏆'
        };
    }

    // ============================================
    // LIFECYCLE
    // ============================================

    /**
     * Initialize the UI and start real-time listeners
     */
    async init() {
        try {
            this._renderLoading();

            // Get initial room data
            const roomResult = await gymbRoomService.getRoom(this.roomId);
            if (!roomResult.success) {
                throw new Error(roomResult.error || 'Room non trovata');
            }

            this.state.room = roomResult.data;
            this.state.isHost = roomResult.data.hostId === this.userId;
            this.state.status = roomResult.data.status;

            // Start real-time listeners
            this._setupListeners();

            // Initial render
            this._render();

        } catch (error) {
            this.onError(error);
            this._renderError(error.message);
        }
    }

    /**
     * Setup real-time Firestore listeners
     */
    _setupListeners() {
        // Room status listener
        const unsubRoom = gymbRoomRealtimeService.watchRoom(this.roomId, (data) => {
            if (!data.exists) {
                this.onError(new Error('Room eliminata'));
                this.cleanup();
                return;
            }

            const prevStatus = this.state.status;
            this.state.room = data;
            this.state.status = data.status;
            this.state.isHost = data.hostId === this.userId;

            // Handle status transitions
            if (prevStatus !== data.status) {
                if (data.status === 'active' && prevStatus === 'lobby') {
                    this._showToast('🏋️ Allenamento iniziato!', 'success');
                } else if (data.status === 'finished') {
                    this._showToast('🏁 Allenamento terminato!', 'success');
                    this.onRoomEnd(data);
                }
            }

            this._scheduleRender();
        });
        this._unsubscribers.push(unsubRoom);

        // Members listener
        const unsubMembers = gymbRoomRealtimeService.watchMembers(this.roomId, ({ members, changes }) => {
            this.state.members = members;

            // Show toast for join/leave
            if (changes.added.length > 0) {
                const newMember = changes.added[0];
                if (newMember.uid !== this.userId) {
                    this._showToast(`${newMember.displayName} è entrato`, 'info');
                }
            }

            if (changes.removed.length > 0) {
                const leftMember = changes.removed[0];
                if (leftMember.uid !== this.userId) {
                    this._showToast(`${leftMember.displayName} è uscito`, 'info');
                }
            }

            this._scheduleRender();
        });
        this._unsubscribers.push(unsubMembers);

        // Metrics listener (only during active workout)
        const unsubMetrics = gymbRoomRealtimeService.watchMetrics(this.roomId, ({ leaderboard, deltas }) => {
            const prevLeaderboard = this.state.leaderboard;
            this.state.leaderboard = leaderboard;

            // Animate volume changes
            this._animateVolumeChanges(deltas);

            this._scheduleRender();
        });
        this._unsubscribers.push(unsubMetrics);
    }

    /**
     * Cleanup all listeners and state
     */
    cleanup() {
        for (const unsub of this._unsubscribers) {
            try {
                unsub();
            } catch (e) {
                console.warn('[GymbRoomUI] Error unsubscribing:', e);
            }
        }
        this._unsubscribers = [];

        gymbRoomRealtimeService.unsubscribeRoom(this.roomId);

        if (this._toastTimeout) {
            clearTimeout(this._toastTimeout);
        }
    }

    // ============================================
    // RENDER SCHEDULING
    // ============================================

    /**
     * Schedule a render on the next animation frame
     */
    _scheduleRender() {
        if (this._pendingRender) return;

        this._pendingRender = true;
        requestAnimationFrame(() => {
            this._render();
            this._pendingRender = false;
        });
    }

    // ============================================
    // MAIN RENDER FUNCTION
    // ============================================

    /**
     * Main render function - delegates to view-specific renderers
     */
    _render() {
        if (!this.container) return;

        const { status } = this.state;

        switch (status) {
            case 'lobby':
                this._renderLobby();
                break;
            case 'active':
                this._renderTraining();
                break;
            case 'finished':
                this._renderSummary();
                break;
            default:
                this._renderLoading();
        }
    }

    // ============================================
    // LOBBY VIEW
    // ============================================

    _renderLobby() {
        const { room, members, isHost } = this.state;
        const readyCount = members.filter(m => m.readyStatus).length;
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
            ${members.map(m => this._renderMemberCard(m)).join('')}
          </div>
          
          <div style="display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
            ${!isHost ? `
              <button class="gymbro-btn gymbro-btn-${this._isMeReady() ? 'secondary' : 'success'}" 
                      onclick="window.gymbRoomUI._toggleReady()">
                ${this._isMeReady() ? '✓ Pronto' : 'Sono Pronto'}
              </button>
            ` : ''}
            
            ${isHost ? `
              <button class="gymbro-btn gymbro-btn-primary gymbro-btn-lg" 
                      onclick="window.gymbRoomUI._startWorkout()"
                      ${!allReady ? 'disabled' : ''}>
                🚀 Inizia Allenamento
              </button>
            ` : ''}
            
            <button class="gymbro-btn gymbro-btn-secondary" onclick="window.gymbRoomUI._leaveRoom()">
              🚪 Esci
            </button>
          </div>
        </div>
      </div>
    `;

        // Expose for onclick handlers
        window.gymbRoomUI = this;
    }

    _renderMemberCard(member) {
        const isReady = member.readyStatus;
        const isHost = member.role === 'host';
        const isMe = member.uid === this.userId;
        const avatarPlaceholder = getPlaceholderAvatar(member.displayName);
        const fallbackAvatar = getEmptyPlaceholderAvatar();

        return `
      <div class="gymbro-member-card ${isReady ? 'ready' : ''} ${isHost ? 'host' : ''}" 
           data-uid="${member.uid}">
        <img class="gymbro-member-avatar" 
             src="${member.photoUrl || avatarPlaceholder}" 
             alt="${member.displayName}"
             onerror="this.src='${fallbackAvatar}'" />
        <span class="gymbro-member-name">${member.displayName}${isMe ? ' (tu)' : ''}</span>
        <span class="gymbro-member-status">${isReady ? 'Pronto' : 'In attesa'}</span>
      </div>
    `;
    }

    _isMeReady() {
        const me = this.state.members.find(m => m.uid === this.userId);
        return me?.readyStatus || false;
    }

    // ============================================
    // TRAINING VIEW (Competition Board)
    // ============================================

    _renderTraining() {
        const { leaderboard } = this.state;

        this.container.innerHTML = `
      <div class="gymbro-room">
        ${this._renderHeader()}
        
        <div class="gymbro-leaderboard">
          <div class="gymbro-leaderboard-header">
            <h3>Classifica Live</h3>
            ${this.state.isHost ? `
              <button class="gymbro-btn gymbro-btn-danger gymbro-btn-sm" 
                      onclick="window.gymbRoomUI._endWorkout()">
                🏁 Termina
              </button>
            ` : ''}
          </div>
          
          <div class="gymbro-leaderboard-list">
            ${leaderboard.length > 0
                ? leaderboard.map(entry => this._renderLeaderboardItem(entry)).join('')
                : '<p style="text-align: center; color: var(--gymbro-text-dim);">Nessuna attività ancora...</p>'
            }
          </div>
        </div>
      </div>
    `;

        window.gymbRoomUI = this;
    }

    _renderLeaderboardItem(entry) {
        const isMe = entry.uid === this.userId;
        const badges = this._getBadges(entry);
        const avatarPlaceholder = getPlaceholderAvatar(entry.displayName);

        // Format volume (convert to kg display)
        const volumeDisplay = entry.totalVolume >= 1000
            ? `${(entry.totalVolume / 1000).toFixed(1)}k`
            : entry.totalVolume.toString();

        return `
      <div class="gymbro-leaderboard-item rank-${entry.rank}" data-uid="${entry.uid}">
        <div class="gymbro-leaderboard-rank">#${entry.rank}</div>
        
        <img class="gymbro-leaderboard-avatar" 
             src="${entry.photoUrl || avatarPlaceholder}" 
             alt="${entry.displayName}" />
        
        <div class="gymbro-leaderboard-info">
          <div class="gymbro-leaderboard-name">${entry.displayName}${isMe ? ' (tu)' : ''}</div>
          <div class="gymbro-leaderboard-exercise">${entry.currentExercise || '-'} ${entry.totalSets > 0 ? `• Set ${entry.totalSets}` : ''}</div>
        </div>
        
        <div class="gymbro-leaderboard-volume">
          <div class="gymbro-leaderboard-volume-value" id="volume-${entry.uid}">
            ${volumeDisplay}
          </div>
          <div class="gymbro-leaderboard-volume-unit">kg</div>
        </div>
        
        ${badges.length > 0 ? `
          <div class="gymbro-badges">
            ${badges.map(b => `<span class="gymbro-badge">${b}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
    }

    _getBadges(entry) {
        const badges = [];

        // Volume King - #1 position
        if (entry.rank === 1 && entry.totalVolume > 0) {
            badges.push(this._badges.volumeKing);
        }

        // Top 3
        if (entry.rank <= 3 && entry.totalVolume > 0) {
            badges.push(this._badges.topThree);
        }

        return badges;
    }

    // ============================================
    // SUMMARY VIEW (Podium)
    // ============================================

    _renderSummary() {
        const { room, leaderboard } = this.state;
        const top3 = leaderboard.slice(0, 3);

        // Calculate stats
        const totalVolume = leaderboard.reduce((sum, e) => sum + (e.totalVolume || 0), 0);
        const totalSets = leaderboard.reduce((sum, e) => sum + (e.totalSets || 0), 0);

        this.container.innerHTML = `
      <div class="gymbro-room">
        ${this._renderHeader()}
        
        <div class="gymbro-summary">
          <h2 class="gymbro-summary-title">🎉 Allenamento Completato!</h2>
          
          <div class="gymbro-podium">
            ${top3.map((entry, i) => this._renderPodiumPlace(entry, i)).join('')}
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
              ✓ Chiudi
            </button>
          </div>
        </div>
      </div>
    `;

        window.gymbRoomUI = this;
    }

    _renderPodiumPlace(entry, index) {
        const medals = ['🥇', '🥈', '🥉'];
        const volumeDisplay = entry.totalVolume >= 1000
            ? `${(entry.totalVolume / 1000).toFixed(1)}k kg`
            : `${entry.totalVolume} kg`;
        const avatarPlaceholder = getPlaceholderAvatar(entry.displayName);

        return `
      <div class="gymbro-podium-place">
        <img class="gymbro-podium-avatar" 
             src="${entry.photoUrl || avatarPlaceholder}" 
             alt="${entry.displayName}" />
        <div class="gymbro-podium-name">${entry.displayName}</div>
        <div class="gymbro-podium-volume">${volumeDisplay}</div>
        <div class="gymbro-podium-bar">
          ${medals[index] || '#' + (index + 1)}
        </div>
      </div>
    `;
    }

    // ============================================
    // SHARED COMPONENTS
    // ============================================

    _renderHeader() {
        const { room, status, isHost } = this.state;

        const statusLabels = {
            lobby: 'In attesa',
            active: 'In corso',
            finished: 'Terminato'
        };

        return `
      <div class="gymbro-room-header">
        <div class="gymbro-room-title">
          <h2>${room?.name || 'Gymbro Room'}</h2>
          <span class="gymbro-room-status ${status}">${statusLabels[status] || status}</span>
        </div>
        
        <div class="gymbro-room-code" style="font-family: monospace; font-size: 0.875rem; color: var(--gymbro-text-dim);">
          Room: <strong style="color: var(--gymbro-primary);">${this.roomId}</strong>
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
        <p style="color: var(--gymbro-danger); margin-bottom: 1rem;">❌ ${message}</p>
        <button class="gymbro-btn gymbro-btn-secondary" onclick="window.gymbRoomUI._closeRoom()">
          Chiudi
        </button>
      </div>
    `;
        window.gymbRoomUI = this;
    }

    // ============================================
    // ANIMATIONS
    // ============================================

    _animateVolumeChanges(deltas) {
        if (!deltas || deltas.length === 0) return;

        for (const delta of deltas) {
            if (delta.volumeDelta <= 0) continue;

            const el = document.getElementById(`volume-${delta.uid}`);
            if (el) {
                el.classList.add('updating');
                setTimeout(() => el.classList.remove('updating'), 300);
            }
        }
    }

    // ============================================
    // TOAST NOTIFICATIONS
    // ============================================

    _showToast(message, type = 'info') {
        // Remove existing toast
        const existing = document.querySelector('.gymbro-toast');
        if (existing) existing.remove();

        const icons = {
            success: '✓',
            error: '✗',
            info: 'ℹ',
            warning: '⚠'
        };

        const toast = document.createElement('div');
        toast.className = `gymbro-toast ${type}`;
        toast.innerHTML = `
      <span class="gymbro-toast-icon">${icons[type] || ''}</span>
      <span class="gymbro-toast-message">${message}</span>
    `;

        document.body.appendChild(toast);

        // Trigger animation
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });

        // Auto-hide
        this._toastTimeout = setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // ============================================
    // ACTION HANDLERS
    // ============================================

    async _toggleReady() {
        try {
            const isReady = this._isMeReady();
            await gymbRoomService.setReadyStatus(this.roomId, !isReady);
        } catch (error) {
            this._showToast(error.message, 'error');
        }
    }

    async _startWorkout() {
        try {
            const result = await gymbRoomService.startWorkout(this.roomId);
            if (!result.success) {
                throw new Error(result.error);
            }
        } catch (error) {
            this._showToast(error.message, 'error');
        }
    }

    async _endWorkout() {
        if (!confirm('Sei sicuro di voler terminare l\'allenamento per tutti?')) {
            return;
        }

        try {
            const result = await gymbRoomService.endWorkout(this.roomId);
            if (!result.success) {
                throw new Error(result.error);
            }
        } catch (error) {
            this._showToast(error.message, 'error');
        }
    }

    async _leaveRoom() {
        if (!confirm('Sei sicuro di voler uscire dalla room?')) {
            return;
        }

        try {
            const result = await gymbRoomService.leaveRoom(this.roomId);
            if (!result.success) {
                throw new Error(result.error);
            }
            this.cleanup();
            this._closeRoom();
        } catch (error) {
            this._showToast(error.message, 'error');
        }
    }

    _closeRoom() {
        this.cleanup();
        this.container.innerHTML = '';
        this.onRoomEnd(this.state.room);
    }
}

// Factory function for easy initialization
export function createGymbRoomUI(container, roomId, userId, options = {}) {
    const ui = new GymbRoomUI({
        container,
        roomId,
        userId,
        ...options
    });
    ui.init();
    return ui;
}
