/**
 * GYMBRO Sanitization Utilities
 * Prevents XSS when injecting user/DB content into the DOM.
 */
(function () {
    'use strict';

    /**
     * Escape HTML entities to prevent XSS in innerHTML contexts.
     * Use for any user-controlled or Firestore-sourced text.
     */
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Sanitize a data attribute value (escape quotes).
     */
    function escapeAttr(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    // Expose globally
    window.escapeHtml = escapeHtml;
    window.escapeAttr = escapeAttr;
})();
