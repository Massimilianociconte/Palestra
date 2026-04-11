/**
 * Lucide Icons - Initialization & Helpers
 * Provides: refreshLucideIcons(), lucideIcon()
 */
(function () {
    'use strict';

    function init() {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons();
        }
    }

    /**
     * Refresh/re-render Lucide icons in the DOM.
     * Call after dynamic content updates.
     * @param {HTMLElement} [root] - Optional root element to scope icon creation
     */
    window.refreshLucideIcons = function (root) {
        if (typeof lucide !== 'undefined') {
            lucide.createIcons(root ? { root: root } : undefined);
        }
    };

    /**
     * Generate an <i data-lucide> HTML string for use in dynamic content.
     * After inserting into the DOM, call refreshLucideIcons().
     * @param {string} name - Lucide icon name (e.g. 'heart', 'zap')
     * @param {Object} [opts] - Options: size (px), color, class
     * @returns {string} HTML string
     */
    window.lucideIcon = function (name, opts) {
        var o = opts || {};
        var size = o.size || '';
        var color = o.color || '';
        var cls = o.class || '';
        var style = '';
        if (size) style += 'width:' + size + 'px;height:' + size + 'px;';
        if (color) style += 'color:' + color + ';';
        return '<i data-lucide="' + name + '"' +
            (style ? ' style="' + style + '"' : '') +
            (cls ? ' class="' + cls + '"' : '') +
            '></i>';
    };

    // Auto-init
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
