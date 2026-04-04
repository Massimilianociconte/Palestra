(function () {
    if (typeof window === "undefined") {
        return;
    }

    const capacitor = window.Capacitor || {};

    if (typeof capacitor.isNativePlatform !== "function") {
        capacitor.isNativePlatform = function () {
            return false;
        };
    }

    if (!capacitor.Plugins || typeof capacitor.Plugins !== "object") {
        capacitor.Plugins = {};
    }

    if (typeof capacitor.triggerEvent !== "function") {
        capacitor.triggerEvent = function (eventName, target, eventData) {
            const doc = window.document;
            if (!doc || typeof doc.createEvent !== "function") {
                return false;
            }

            try {
                const payload = eventData && typeof eventData === "object" ? eventData : {};
                const ev = doc.createEvent("Events");
                ev.initEvent(eventName, false, false);
                Object.assign(ev, payload);

                if (target === "document" && typeof doc.dispatchEvent === "function") {
                    return doc.dispatchEvent(ev);
                }

                if (target === "window" && typeof window.dispatchEvent === "function") {
                    return window.dispatchEvent(ev);
                }

                if (typeof target === "string" && typeof doc.querySelector === "function") {
                    const targetEl = doc.querySelector(target);
                    return !!targetEl && typeof targetEl.dispatchEvent === "function" && targetEl.dispatchEvent(ev);
                }
            } catch (error) {
                console.warn("[CapacitorBootstrap] triggerEvent fallback failed:", error);
            }

            return false;
        };
    }

    window.Capacitor = capacitor;
})();
