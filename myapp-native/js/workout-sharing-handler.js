export class WorkoutSharingHandler {
    constructor(firestoreService) {
        this.firestoreService = firestoreService;
    }

    // HTML escape to prevent XSS from imported/shared data
    _esc(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    async shareWorkout(workout) {
        try {
            if (!workout || !workout.name) throw new Error("Workout non valido");
            const shortId = await this.firestoreService.createSharedWorkout(workout);
            let baseUrl;
            baseUrl = window.location.origin.includes("localhost") || window.location.origin.includes("capacitor")
                ? "https://massimilianociconte.github.io/Palestra/user.html"
                : `${window.location.origin}${window.location.pathname}`;
            const shareUrl = `${baseUrl}?s=${shortId}`;
            const deepLink = `gymbro://workout?id=${shortId}`;
            return { success: true, shortId, shareUrl, deepLink };
        } catch (error) {
            console.error("Error sharing workout:", error);
            return { success: false, error: error.message || "Errore durante la condivisione" };
        }
    }

    async importWorkout(shortId) {
        try {
            const workoutData = await this.firestoreService.getSharedWorkout(shortId);
            if (!workoutData) throw new Error("Workout non trovato");

            const workouts = JSON.parse(localStorage.getItem("ironflow_workouts") || "[]");

            // Prevent duplicate import: check if already imported from this shortId
            const alreadyImported = workouts.find(w => w.importedFrom === shortId);
            if (alreadyImported) {
                console.log("Workout already imported from:", shortId);
                return { success: true, workout: alreadyImported, alreadyExisted: true };
            }

            // Spread workoutData first, then override id/importedFrom/importedAt to prevent
            // Firestore data from overwriting critical fields
            const importedWorkout = {
                ...workoutData,
                id: Date.now(),
                createdAt: new Date().toISOString(),
                importedFrom: shortId,
                importedAt: new Date().toISOString()
            };
            // Remove any stale id that may have leaked from shared data
            delete importedWorkout._id;

            workouts.unshift(importedWorkout);
            localStorage.setItem("ironflow_workouts", JSON.stringify(workouts));

            try {
                await this.firestoreService.syncToCloud();
            } catch (syncError) {
                console.warn("Cloud sync failed after import:", syncError);
            }
            return { success: true, workout: importedWorkout };
        } catch (error) {
            console.error("Error importing workout:", error);
            return { success: false, error: error.message || "Errore durante l'importazione" };
        }
    }

    async checkForSharedWorkout() {
        const urlParams = new URLSearchParams(window.location.search);
        let shareId = urlParams.get("s");
        if (!shareId) shareId = urlParams.get("shareId");

        if (!shareId && window.location.href.includes("gymbro://")) {
            try {
                const deepLinkUrl = new URL(window.location.href.replace("gymbro://", "https://"));
                shareId = deepLinkUrl.searchParams.get("id");
                console.log("Deep link workout detected:", shareId);
            } catch (e) {
                console.warn("Could not parse deep link:", e);
            }
        }

        if (shareId) {
            console.log("Shared workout detected:", shareId);
            const result = await this.importWorkout(shareId);
            window.history.replaceState({}, document.title, window.location.pathname);
            return result;
        }
        return null;
    }

    static setupDeepLinkListener(firestoreService) {
        const capacitor = typeof window !== "undefined" ? window.Capacitor : null;
        if (!capacitor?.isNativePlatform?.()) {
            return;
        }

        if (WorkoutSharingHandler._deepLinkListenerInstalled) {
            return;
        }

        let appPlugin = capacitor.Plugins?.App || capacitor.App || null;
        if (!appPlugin && typeof capacitor.registerPlugin === "function") {
            appPlugin = capacitor.registerPlugin("App");
        }

        if (!appPlugin?.addListener) {
            console.warn("Could not load Capacitor App plugin");
            return;
        }

        WorkoutSharingHandler._deepLinkListenerInstalled = true;

        appPlugin.addListener("appUrlOpen", async (event) => {
            if (!event.url.startsWith("gymbro://")) {
                return;
            }

            try {
                const url = new URL(event.url.replace("gymbro://", "https://"));
                const shareId = url.searchParams.get("id");
                if (shareId) {
                    const handler = new WorkoutSharingHandler(firestoreService);
                    handler.showImportOverlay();
                    const result = await handler.importWorkout(shareId);
                    handler.hideImportOverlay();
                    if (result.success) {
                        if (result.alreadyExisted) {
                            handler.showAlreadyImported(result.workout.name);
                        } else {
                            handler.showImportSuccess(result.workout.name, result.workout.exercises?.length);
                            if (typeof window.renderWorkouts === "function") window.renderWorkouts();
                        }
                    } else {
                        handler.showImportError(result.error);
                    }
                }
            } catch (e) {
                console.error("Error handling deep link:", e);
            }
        });

        console.log("🔗 Deep link listener installed");
    }

    showShareModal(workoutName, shareUrl, deepLink = null) {
        const safeName = this._esc(workoutName);
        const shareText = `Dai un'occhiata a questa scheda di allenamento: ${workoutName}`;
        const fullShareText = deepLink
            ? `${shareText}\n\n📱 Apri nell'app: ${deepLink}\n🌐 Apri nel browser: ${shareUrl}`
            : `${shareText}\n${shareUrl}`;

        const modalHTML = `
            <div id="workoutShareModal" style="
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.95);
                z-index: 3000;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 1rem;
                overflow-y: auto;
            ">
                <div class="card" style="max-width: 500px; width: 100%;">
                    <h3 style="margin-bottom: 1rem; color: var(--color-primary);">
                        ${window.lucideIcon("link",{size:18,color:"var(--color-primary)"})} Condividi Scheda
                    </h3>
                    
                    <p style="margin-bottom: 1rem; color: var(--color-text-muted);">
                        Condividi <strong style="color: var(--color-text);">${safeName}</strong>
                    </p>
                    
                    <!-- Smart Link -->
                    <div style="margin-bottom: 1rem;">
                        <div id="shareLinkBox" style="
                            background: rgba(255,255,255,0.05);
                            padding: 1rem;
                            border-radius: var(--radius-sm);
                            border: 1px solid var(--color-primary);
                            word-break: break-all;
                            font-family: monospace;
                            font-size: 0.85rem;
                            color: var(--color-primary);
                            cursor: pointer;
                        ">${this._esc(shareUrl)}</div>
                        <p style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.5rem; text-align: center;">
                            ${window.lucideIcon("smartphone",{size:14})} Su Android si apre automaticamente nell'app se installata
                        </p>
                    </div>
                    
                    <!-- Social Share Buttons -->
                    <div style="margin-bottom: 1rem;">
                        <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">Condividi su:</p>
                        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                            <button class="share-social-btn" data-platform="native" data-fulltext="${this._esc(encodeURIComponent(fullShareText))}" style="
                                background: linear-gradient(135deg, #00f3ff, #0099ff);
                                border: none;
                                color: white;
                                padding: 0.5rem 1rem;
                                border-radius: var(--radius-sm);
                                cursor: pointer;
                                font-size: 0.85rem;
                                display: flex;
                                align-items: center;
                                gap: 0.3rem;
                            ">${window.lucideIcon("share-2",{size:14})} Condividi</button>
                            <button class="share-social-btn" data-platform="whatsapp" style="
                                background: #25D366;
                                border: none;
                                color: white;
                                padding: 0.5rem 1rem;
                                border-radius: var(--radius-sm);
                                cursor: pointer;
                                font-size: 0.85rem;
                            ">WhatsApp</button>
                            <button class="share-social-btn" data-platform="telegram" style="
                                background: #0088cc;
                                border: none;
                                color: white;
                                padding: 0.5rem 1rem;
                                border-radius: var(--radius-sm);
                                cursor: pointer;
                                font-size: 0.85rem;
                            ">Telegram</button>
                            <button class="share-social-btn" data-platform="twitter" style="
                                background: #1DA1F2;
                                border: none;
                                color: white;
                                padding: 0.5rem 1rem;
                                border-radius: var(--radius-sm);
                                cursor: pointer;
                                font-size: 0.85rem;
                            ">X/Twitter</button>
                            <button class="share-social-btn" data-platform="facebook" style="
                                background: #1877F2;
                                border: none;
                                color: white;
                                padding: 0.5rem 1rem;
                                border-radius: var(--radius-sm);
                                cursor: pointer;
                                font-size: 0.85rem;
                            ">Facebook</button>
                            <button class="share-social-btn" data-platform="email" style="
                                background: #666;
                                border: none;
                                color: white;
                                padding: 0.5rem 1rem;
                                border-radius: var(--radius-sm);
                                cursor: pointer;
                                font-size: 0.85rem;
                            ">${window.lucideIcon("mail",{size:14})} Email</button>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 0.75rem;">
                        <button id="shareModalClose" class="btn btn-outline" style="flex: 1;">
                            Chiudi
                        </button>
                        <button id="shareModalCopy" class="btn btn-primary" style="flex: 1;">
                            ${window.lucideIcon("clipboard",{size:14})} Copia Link
                        </button>
                    </div>
                    
                    <p id="shareCopyFeedback" style="
                        text-align: center;
                        margin-top: 1rem;
                        margin-bottom: 0;
                        font-size: 0.85rem;
                        color: var(--color-primary);
                        min-height: 1.5em;
                    "></p>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML("beforeend", modalHTML);

        const modal = document.getElementById("workoutShareModal");
        const closeBtn = document.getElementById("shareModalClose");
        const copyBtn = document.getElementById("shareModalCopy");
        const feedback = document.getElementById("shareCopyFeedback");

        // Use textContent for the link box click-to-copy instead of inline onclick
        const linkBox = document.getElementById("shareLinkBox");
        linkBox.addEventListener("click", () => {
            navigator.clipboard.writeText(shareUrl).then(() => {
                linkBox.textContent = '✅ Link Copiato!';
            });
        });

        closeBtn.addEventListener("click", () => modal.remove());

        modal.querySelectorAll(".share-social-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const platform = btn.dataset.platform;
                const textToShare = btn.dataset.fulltext ? decodeURIComponent(btn.dataset.fulltext) : shareText;
                this.shareToSocialPlatform(platform, shareUrl, textToShare);
            });
        });

        copyBtn.addEventListener("click", async () => {
            try {
                await navigator.clipboard.writeText(shareUrl);
                feedback.textContent = "✅ Link copiato negli appunti!";
                copyBtn.textContent = "✅ Copiato!";
                setTimeout(() => { copyBtn.textContent = "📋 Copia Link"; }, 2000);
            } catch (error) {
                console.error("Copy failed:", error);
                const range = document.createRange();
                const selection = window.getSelection();
                range.selectNodeContents(modal.querySelector('div[style*="monospace"]'));
                selection.removeAllRanges();
                selection.addRange(range);
                feedback.textContent = "📋 Testo selezionato, premi Ctrl+C (Cmd+C su Mac)";
            }
        });
    }

    shareToSocialPlatform(platform, shareUrl, shareText) {
        const encodedUrl = encodeURIComponent(shareUrl);
        const encodedText = encodeURIComponent(shareText);
        const socialUrls = {
            whatsapp: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
            telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
            twitter: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
            facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
            email: `mailto:?subject=${encodeURIComponent("Scheda di Allenamento")}&body=${encodedText}%20${encodedUrl}`
        };

        if (platform === "native" && navigator.share) {
            navigator.share({ title: "Scheda di Allenamento", text: shareText, url: shareUrl })
                .catch(err => console.log("Share cancelled:", err));
        } else if (platform === "native") {
            navigator.clipboard.writeText(shareUrl).then(() => {
                const feedback = document.getElementById("shareCopyFeedback");
                if (feedback) feedback.textContent = "✅ Link copiato!";
            });
        } else if (socialUrls[platform]) {
            window.open(socialUrls[platform], "_blank", "width=600,height=400");
        }
    }

    // --- Import Overlay (Spinner) ---
    showImportOverlay() {
        document.querySelectorAll('.gymbro-import-overlay').forEach(o => o.remove());
        const overlay = document.createElement('div');
        overlay.className = 'gymbro-import-overlay';
        overlay.innerHTML = `
            <div class="gymbro-import-overlay-content">
                <div class="gymbro-import-spinner"></div>
                <div class="gymbro-import-overlay-text">Importazione scheda in corso...</div>
            </div>
        `;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));
    }

    hideImportOverlay() {
        const overlay = document.querySelector('.gymbro-import-overlay');
        if (overlay) {
            overlay.classList.remove('show');
            setTimeout(() => overlay.remove(), 300);
        }
    }

    // --- Notification helpers ---
    _createNotification(icon, title, subtitle, cls) {
        document.querySelectorAll('.gymbro-import-notification').forEach(n => n.remove());
        const el = document.createElement('div');
        el.className = `gymbro-import-notification ${cls}`;
        el.innerHTML = `
            <span class="gymbro-import-icon">${icon}</span>
            <div class="gymbro-import-content">
                <div class="gymbro-import-title">${title}</div>
                <div class="gymbro-import-subtitle">${subtitle}</div>
            </div>
            <button class="gymbro-import-close" aria-label="Chiudi">&times;</button>
        `;
        el.querySelector('.gymbro-import-close').addEventListener('click', () => {
            el.classList.remove('show');
            setTimeout(() => el.remove(), 400);
        });
        document.body.appendChild(el);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
        setTimeout(() => {
            if (el.parentElement) {
                el.classList.remove('show');
                setTimeout(() => el.remove(), 400);
            }
        }, 5000);
    }

    showImportSuccess(workoutName, exerciseCount) {
        const sub = this._esc(workoutName) + (exerciseCount ? ` · ${exerciseCount} esercizi` : '');
        this._createNotification('✅', 'Scheda importata con successo!', sub, 'gymbro-import-success');
    }

    showAlreadyImported(workoutName) {
        this._createNotification('ℹ️', 'Scheda già importata', `${this._esc(workoutName)} è già nella tua lista`, 'gymbro-import-info');
    }

    showImportError(message) {
        this._createNotification('❌', 'Importazione fallita', this._esc(message), 'gymbro-import-error');
    }

    static addStyles() {
        const style = document.createElement("style");
        style.textContent = `
            /* --- Import Overlay --- */
            .gymbro-import-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0,0,0,0.7);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                z-index: 9999;
                display: flex; align-items: center; justify-content: center;
                opacity: 0; transition: opacity 0.3s ease;
            }
            .gymbro-import-overlay.show { opacity: 1; }
            .gymbro-import-overlay-content { text-align: center; }
            .gymbro-import-spinner {
                width: 52px; height: 52px;
                border: 4px solid rgba(255,255,255,0.15);
                border-top-color: var(--color-primary, #00f3ff);
                border-radius: 50%;
                animation: gymbro-spin 0.75s linear infinite;
                margin: 0 auto 18px;
            }
            .gymbro-import-overlay-text {
                font-size: 16px; font-weight: 600;
                color: var(--color-text, #fff);
                letter-spacing: 0.02em;
            }
            @keyframes gymbro-spin {
                to { transform: rotate(360deg); }
            }

            /* --- Import Notification Banner --- */
            .gymbro-import-notification {
                position: fixed; top: 20px; left: 50%;
                transform: translateX(-50%) translateY(-120px);
                padding: 16px 20px; border-radius: 16px;
                z-index: 10000;
                display: flex; align-items: center; gap: 12px;
                max-width: 92vw; min-width: 280px;
                font-family: 'Inter', system-ui, sans-serif;
                opacity: 0;
                transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease;
                box-shadow: 0 8px 32px rgba(0,0,0,0.35);
            }
            .gymbro-import-notification.show {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
            }
            .gymbro-import-success {
                background: linear-gradient(135deg, #00f3ff 0%, #00c853 100%);
                color: #000;
            }
            .gymbro-import-info {
                background: linear-gradient(135deg, #2196F3 0%, #00BCD4 100%);
                color: #fff;
            }
            .gymbro-import-error {
                background: linear-gradient(135deg, #ff5252 0%, #ff1744 100%);
                color: #fff;
            }
            .gymbro-import-icon {
                font-size: 28px;
                animation: gymbro-bounceIn 0.5s ease 0.2s both;
            }
            .gymbro-import-content { flex: 1; min-width: 0; }
            .gymbro-import-title {
                font-weight: 700; font-size: 15px; margin-bottom: 2px;
            }
            .gymbro-import-subtitle {
                font-size: 13px; opacity: 0.85;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            }
            .gymbro-import-close {
                background: rgba(0,0,0,0.15); border: none; color: inherit;
                width: 28px; height: 28px; border-radius: 50%;
                cursor: pointer; font-size: 18px;
                display: flex; align-items: center; justify-content: center;
                transition: background 0.2s; flex-shrink: 0;
            }
            .gymbro-import-close:hover { background: rgba(0,0,0,0.25); }
            @keyframes gymbro-bounceIn {
                0% { transform: scale(0); }
                50% { transform: scale(1.2); }
                100% { transform: scale(1); }
            }
        `;
        document.head.appendChild(style);
    }
}
