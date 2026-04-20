/**
 * P2.24 — iOS PWA install banner
 *
 * On iOS Safari (not in standalone), notifications and background timers do
 * NOT work. This helper shows a small, dismissible banner inviting the user
 * to "Add to Home Screen" so the PWA behaviour kicks in. It is deliberately
 * lightweight (no external deps) and no-ops on non-iOS / already-installed.
 *
 * Usage: just include this script on any page that uses notifications.
 *   <script type="module" src="./js/ios-pwa-banner.js"></script>
 */
(function () {
    "use strict";

    const DISMISS_KEY = "ironflow_ios_banner_dismissed_at";
    const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

    function isIOS() {
        const ua = navigator.userAgent || "";
        const platform = navigator.platform || "";
        return /iPad|iPhone|iPod/.test(ua) ||
            (platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function isStandalone() {
        return Boolean(
            window.matchMedia?.("(display-mode: standalone)")?.matches ||
            window.navigator.standalone === true
        );
    }

    function recentlyDismissed() {
        try {
            const raw = localStorage.getItem(DISMISS_KEY);
            if (!raw) return false;
            const ts = Number(raw);
            return Number.isFinite(ts) && (Date.now() - ts < DISMISS_TTL_MS);
        } catch (_) { return false; }
    }

    function inNativeApp() {
        return Boolean(window.Capacitor?.isNativePlatform?.());
    }

    function renderBanner() {
        if (document.getElementById("iosPwaInstallBanner")) return;

        const el = document.createElement("div");
        el.id = "iosPwaInstallBanner";
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-label", "Installa GymBro come app");
        el.style.cssText = [
            "position:fixed",
            "left:12px",
            "right:12px",
            "bottom:12px",
            "z-index:2147483000",
            "background:#0f172a",
            "color:#e2e8f0",
            "border:1px solid rgba(0,243,255,0.35)",
            "border-radius:14px",
            "padding:14px 16px",
            "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
            "font-size:0.85rem",
            "line-height:1.35",
            "box-shadow:0 10px 30px rgba(0,0,0,0.45)",
            "display:flex",
            "gap:12px",
            "align-items:flex-start"
        ].join(";");

        el.innerHTML = `
            <div style="flex:1;min-width:0">
                <div style="font-weight:700;color:#00f3ff;margin-bottom:4px;">
                    Installa GymBro per le notifiche
                </div>
                <div style="opacity:0.9">
                    Su iPhone le notifiche di recupero e PR funzionano solo
                    dopo aver aggiunto l'app alla schermata Home.
                    Tocca il pulsante <b>Condividi</b> di Safari, poi
                    <b>«Aggiungi alla schermata Home»</b>.
                </div>
            </div>
            <button type="button" id="iosPwaBannerDismiss"
                aria-label="Chiudi avviso"
                style="background:transparent;border:0;color:#94a3b8;
                    font-size:1.4rem;line-height:1;padding:0 2px;cursor:pointer">×</button>
        `;

        document.body.appendChild(el);
        const btn = el.querySelector("#iosPwaBannerDismiss");
        if (btn) {
            btn.addEventListener("click", () => {
                try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch (_) {}
                el.remove();
            });
        }
    }

    function maybeShow() {
        if (inNativeApp()) return;
        if (!isIOS()) return;
        if (isStandalone()) return;
        if (recentlyDismissed()) return;
        renderBanner();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", maybeShow, { once: true });
    } else {
        maybeShow();
    }
})();
