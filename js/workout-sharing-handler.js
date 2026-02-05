// Workout Sharing Handler for short link generation and import
// Manages workout sharing via short URLs

export class WorkoutSharingHandler {
    constructor(firestoreService) {
        this.firestoreService = firestoreService;
    }

    // Share a workout and return short URL
    async shareWorkout(workout) {
        try {
            // Validate workout
            if (!workout || !workout.name) {
                throw new Error('Workout non valido');
            }

            // Create share via firestore service (returns short ID)
            const shortId = await this.firestoreService.createSharedWorkout(workout);

            // Build clean share URL - use production URL, not localhost
            let baseUrl;
            if (window.location.origin.includes('localhost') || window.location.origin.includes('capacitor')) {
                // APK nativo o localhost - usa l'URL di produzione
                baseUrl = 'https://massimilianociconte.github.io/Palestra/user.html';
            } else {
                baseUrl = `${window.location.origin}${window.location.pathname}`;
            }
            const shareUrl = `${baseUrl}?s=${shortId}`;

            // Deep link for direct app opening (Android/iOS)
            const deepLink = `gymbro://workout?id=${shortId}`;

            return {
                success: true,
                shortId: shortId,
                shareUrl: shareUrl,
                deepLink: deepLink
            };
        } catch (error) {
            console.error('Error sharing workout:', error);
            return {
                success: false,
                error: error.message || 'Errore durante la condivisione'
            };
        }
    }

    // Import workout from short link
    async importWorkout(shortId) {
        try {
            // Get workout from Firestore
            const workoutData = await this.firestoreService.getSharedWorkout(shortId);

            if (!workoutData) {
                throw new Error('Workout non trovato');
            }

            // Generate new local ID
            const importedWorkout = {
                id: Date.now(),
                ...workoutData,
                importedFrom: shortId,
                importedAt: new Date().toISOString()
            };

            // Save to local storage
            const workouts = JSON.parse(localStorage.getItem('ironflow_workouts') || '[]');
            workouts.unshift(importedWorkout);
            localStorage.setItem('ironflow_workouts', JSON.stringify(workouts));

            // Sync to cloud if logged in
            try {
                await this.firestoreService.syncToCloud();
            } catch (syncError) {
                console.warn('Cloud sync failed after import:', syncError);
            }

            return {
                success: true,
                workout: importedWorkout
            };
        } catch (error) {
            console.error('Error importing workout:', error);
            return {
                success: false,
                error: error.message || 'Errore durante l\'importazione'
            };
        }
    }

    // Check URL for shared workout on page load (supports both web URLs and deep links)
    async checkForSharedWorkout() {
        const urlParams = new URLSearchParams(window.location.search);

        // Check for new format (?s=)
        let shareId = urlParams.get('s');

        // Fallback to old format for backward compatibility
        if (!shareId) {
            shareId = urlParams.get('shareId');
        }

        // Check for gymbro:// deep link format (from Capacitor App plugin)
        if (!shareId && window.location.href.includes('gymbro://')) {
            try {
                const deepLinkUrl = new URL(window.location.href.replace('gymbro://', 'https://'));
                shareId = deepLinkUrl.searchParams.get('id');
                console.log('Deep link workout detected:', shareId);
            } catch (e) {
                console.warn('Could not parse deep link:', e);
            }
        }

        if (shareId) {
            console.log('Shared workout detected:', shareId);

            const result = await this.importWorkout(shareId);

            // Clean URL
            window.history.replaceState({}, document.title, window.location.pathname);

            return result;
        }

        return null;
    }

    // Setup Capacitor deep link listener (call this once on app init)
    static setupDeepLinkListener(firestoreService) {
        // Only run in Capacitor environment
        if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
            import('@capacitor/app').then(({ App }) => {
                App.addListener('appUrlOpen', async (event) => {
                    console.log('Deep link received:', event.url);

                    // Parse gymbro://workout?id=ABC123
                    if (event.url.startsWith('gymbro://')) {
                        try {
                            const url = new URL(event.url.replace('gymbro://', 'https://'));
                            const shareId = url.searchParams.get('id');

                            if (shareId) {
                                // Import the workout
                                const handler = new WorkoutSharingHandler(firestoreService);
                                const result = await handler.importWorkout(shareId);

                                if (result.success) {
                                    handler.showImportSuccess(result.workout.name);
                                    // Reload workouts list
                                    if (typeof window.renderWorkouts === 'function') {
                                        window.renderWorkouts();
                                    }
                                } else {
                                    handler.showImportError(result.error);
                                }
                            }
                        } catch (e) {
                            console.error('Error handling deep link:', e);
                        }
                    }
                });
                console.log('🔗 Deep link listener installed');
            }).catch(e => {
                console.warn('Could not load Capacitor App plugin:', e);
            });
        }
    }

    // Show share modal with copy button and social sharing
    showShareModal(workoutName, shareUrl, deepLink = null) {
        const shareText = `Dai un'occhiata a questa scheda di allenamento: ${workoutName}`;
        const encodedUrl = encodeURIComponent(shareUrl);
        const encodedText = encodeURIComponent(shareText);

        // Combine message for native share (includes deep link for app users)
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
                        🔗 Condividi Scheda
                    </h3>
                    
                    <p style="margin-bottom: 1rem; color: var(--color-text-muted);">
                        Condividi <strong style="color: var(--color-text);">${workoutName}</strong>
                    </p>
                    
                    <!-- Smart Link (opens app on Android if installed, otherwise web) -->
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
                        " onclick="navigator.clipboard.writeText('${shareUrl}').then(() => this.innerHTML = '✅ Link Copiato!')">
                            ${shareUrl}
                        </div>
                        <p style="font-size: 0.75rem; color: var(--color-text-muted); margin-top: 0.5rem; text-align: center;">
                            📱 Su Android si apre automaticamente nell'app se installata
                        </p>
                    </div>
                    
                    <!-- Social Share Buttons -->
                    <div style="margin-bottom: 1rem;">
                        <p style="font-size: 0.8rem; color: var(--color-text-muted); margin-bottom: 0.5rem;">Condividi su:</p>
                        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
                            <button class="share-social-btn" data-platform="native" data-fulltext="${encodeURIComponent(fullShareText)}" style="
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
                            ">📤 Condividi</button>
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
                            ">📧 Email</button>
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 0.75rem;">
                        <button id="shareModalClose" class="btn btn-outline" style="flex: 1;">
                            Chiudi
                        </button>
                        <button id="shareModalCopy" class="btn btn-primary" style="flex: 1;">
                            📋 Copia Link
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

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const modal = document.getElementById('workoutShareModal');
        const closeBtn = document.getElementById('shareModalClose');
        const copyBtn = document.getElementById('shareModalCopy');
        const feedback = document.getElementById('shareCopyFeedback');

        closeBtn.addEventListener('click', () => modal.remove());

        // Social share button handlers
        modal.querySelectorAll('.share-social-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const platform = btn.dataset.platform;
                // For native share, use fullShareText if available (includes both app and web links)
                const textToShare = btn.dataset.fulltext
                    ? decodeURIComponent(btn.dataset.fulltext)
                    : shareText;
                this.shareToSocialPlatform(platform, shareUrl, textToShare);
            });
        });

        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(shareUrl);
                feedback.textContent = '✅ Link copiato negli appunti!';
                copyBtn.textContent = '✅ Copiato!';

                setTimeout(() => {
                    copyBtn.textContent = '📋 Copia Link';
                }, 2000);
            } catch (error) {
                console.error('Copy failed:', error);

                // Fallback: select text
                const range = document.createRange();
                const selection = window.getSelection();
                range.selectNodeContents(modal.querySelector('div[style*="monospace"]'));
                selection.removeAllRanges();
                selection.addRange(range);

                feedback.textContent = '📋 Testo selezionato, premi Ctrl+C (Cmd+C su Mac)';
            }
        });
    }

    // Share to social platform
    shareToSocialPlatform(platform, shareUrl, shareText) {
        const encodedUrl = encodeURIComponent(shareUrl);
        const encodedText = encodeURIComponent(shareText);

        const socialUrls = {
            whatsapp: `https://wa.me/?text=${encodedText}%20${encodedUrl}`,
            telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`,
            twitter: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
            facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
            email: `mailto:?subject=${encodeURIComponent('Scheda di Allenamento')}&body=${encodedText}%20${encodedUrl}`
        };

        if (platform === 'native' && navigator.share) {
            navigator.share({
                title: 'Scheda di Allenamento',
                text: shareText,
                url: shareUrl
            }).catch(err => console.log('Share cancelled:', err));
        } else if (platform === 'native') {
            // Fallback: copy to clipboard
            navigator.clipboard.writeText(shareUrl).then(() => {
                const feedback = document.getElementById('shareCopyFeedback');
                if (feedback) feedback.textContent = '✅ Link copiato!';
            });
        } else if (socialUrls[platform]) {
            window.open(socialUrls[platform], '_blank', 'width=600,height=400');
        }
    }

    // Show import success notification
    showImportSuccess(workoutName) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--color-surface);
            border: 1px solid var(--color-primary);
            padding: 1rem 1.5rem;
            border-radius: var(--radius-md);
            z-index: 4000;
            box-shadow: 0 4px 12px rgba(0, 243, 255, 0.3);
            animation: slideDown 0.3s ease-out;
        `;

        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="font-size: 1.5rem;">✅</span>
                <div>
                    <strong style="color: var(--color-primary);">Scheda Importata!</strong>
                    <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem;">
                        ${workoutName}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideUp 0.3s ease-in';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    // Show import error notification
    showImportError(message) {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 100px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--color-surface);
            border: 1px solid #ff4444;
            padding: 1rem 1.5rem;
            border-radius: var(--radius-md);
            z-index: 4000;
            box-shadow: 0 4px 12px rgba(255, 68, 68, 0.3);
        `;

        notification.innerHTML = `
            <div style="display: flex; align-items: center; gap: 0.75rem;">
                <span style="font-size: 1.5rem;">❌</span>
                <div>
                    <strong style="color: #ff4444;">Errore Importazione</strong>
                    <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem;">
                        ${message}
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(notification);

        setTimeout(() => notification.remove(), 4000);
    }

    // Add animation CSS (call once on init)
    static addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            @keyframes slideDown {
                from {
                    transform: translateX(-50%) translateY(-20px);
                    opacity: 0;
                }
                to {
                    transform: translateX(-50%) translateY(0);
                    opacity: 1;
                }
            }
            
            @keyframes slideUp {
                from {
                    transform: translateX(-50%) translateY(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(-50%) translateY(-20px);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// Export class (not singleton, needs firestoreService instance)

