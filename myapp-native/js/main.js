(function () {
    'use strict';

    if (window.__gymbroMainInitialized) {
        return;
    }
    window.__gymbroMainInitialized = true;

    var QUICK_NAV_ITEMS = [
        { label: 'Schede', href: 'creator.html', icon: 'file-pen-line', matches: ['creator.html'] },
        { label: 'Diario', href: 'diary.html', icon: 'book-open', matches: ['diary.html'] },
        { label: 'Corpo', href: 'body.html', icon: 'ruler', matches: ['body.html'] },
        { label: 'Analisi', href: 'analysis.html', icon: 'trending-up', matches: ['analysis.html', 'records.html'] },
        { label: 'Social', href: 'friends.html', icon: 'users', matches: ['friends.html', 'rooms.html'] },
        { label: 'Profilo', href: 'user.html', icon: 'user', matches: ['user.html'] }
    ];

    var QUICK_NAV_PAGES = new Set([
        'index.html',
        'creator.html',
        'diary.html',
        'analysis.html',
        'body.html',
        'friends.html',
        'rooms.html',
        'records.html',
        'user.html'
    ]);
    var CLICKABLE_CARD_SELECTORS = [
        '.action-card',
        '.rooms-action-card',
        '.friend-card'
    ];

    function getCurrentPage() {
        var path = window.location.pathname || '';
        var page = path.split('/').pop();
        return page || 'index.html';
    }

    function normalizeHref(href) {
        return (href || '').split('#')[0].split('?')[0];
    }

    function shouldManageNavToggle(toggle) {
        if (!toggle) {
            return false;
        }

        var inlineHandler = toggle.getAttribute('onclick') || '';
        return !/history\.back\s*\(/.test(inlineHandler);
    }

    function refreshLucide(target) {
        if (window.refreshLucideIcons) {
            window.refreshLucideIcons(target);
        }
    }

    function initViewportUnits() {
        var frameId = null;

        function updateViewportUnits() {
            var viewport = window.visualViewport;
            var height = (viewport && viewport.height) || window.innerHeight || 0;
            var width = (viewport && viewport.width) || window.innerWidth || 0;

            frameId = null;

            if (!height || !width) {
                return;
            }

            document.documentElement.style.setProperty('--app-height', (height * 0.01) + 'px');
            document.documentElement.style.setProperty('--app-width', (width * 0.01) + 'px');
        }

        function scheduleViewportUpdate() {
            if (frameId !== null) {
                return;
            }

            frameId = window.requestAnimationFrame(updateViewportUnits);
        }

        updateViewportUnits();
        window.addEventListener('resize', scheduleViewportUpdate, { passive: true });
        window.addEventListener('pageshow', scheduleViewportUpdate, { passive: true });
        window.addEventListener('orientationchange', scheduleViewportUpdate);
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                scheduleViewportUpdate();
            }
        });

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', scheduleViewportUpdate);
            window.visualViewport.addEventListener('scroll', scheduleViewportUpdate);
        }
    }

    function normalizeControlLabel(text) {
        return (text || '').replace(/\s+/g, ' ').trim();
    }

    function makeKeyboardClickable(element, label) {
        if (!element || element.dataset.keyboardClickable === 'true') {
            return;
        }

        if (!element.hasAttribute('role')) {
            element.setAttribute('role', 'button');
        }

        if (!element.hasAttribute('tabindex')) {
            element.tabIndex = 0;
        }

        if (label && !element.getAttribute('aria-label')) {
            element.setAttribute('aria-label', label);
        }

        element.classList.add('is-clickable-control');
        element.dataset.keyboardClickable = 'true';
        element.addEventListener('keydown', function (event) {
            if (event.defaultPrevented || event.target !== element) {
                return;
            }

            if (event.key !== 'Enter' && event.key !== ' ') {
                return;
            }

            event.preventDefault();
            element.click();
        });
    }

    function getControlLabel(element) {
        if (!element) {
            return '';
        }

        var labelNode = element.querySelector('.action-card-label, .friend-name, .rooms-action-card-label');
        return normalizeControlLabel(labelNode ? labelNode.textContent : element.textContent);
    }

    function updateMobileToggleIcon(toggle, navLinks) {
        if (!toggle || !navLinks) {
            return;
        }

        var isOpen = navLinks.classList.contains('active');
        toggle.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        toggle.setAttribute('aria-label', isOpen ? 'Chiudi navigazione' : 'Apri navigazione');
        toggle.innerHTML = isOpen ? '<i data-lucide="x"></i>' : '<i data-lucide="menu"></i>';
        refreshLucide(toggle);
    }

    function initHeaderNav(currentPage) {
        var navLinks = document.getElementById('navLinks');
        var mobileToggle = document.getElementById('mobileToggle');
        var navMatchPage = currentPage === 'records.html' ? 'analysis.html' : currentPage;

        if (navLinks) {
            var links = navLinks.querySelectorAll('a[href]');
            links.forEach(function (link) {
                var href = normalizeHref(link.getAttribute('href'));
                var isActive = href === navMatchPage;
                link.classList.toggle('active', isActive);
                if (isActive) {
                    link.setAttribute('aria-current', 'page');
                } else {
                    link.removeAttribute('aria-current');
                }
            });
        }

        if (!mobileToggle || !navLinks || !shouldManageNavToggle(mobileToggle)) {
            if (mobileToggle && !shouldManageNavToggle(mobileToggle)) {
                mobileToggle.setAttribute('aria-label', 'Torna indietro');
                makeKeyboardClickable(mobileToggle, 'Torna indietro');
            }
            return;
        }

        makeKeyboardClickable(mobileToggle, 'Apri navigazione');
        mobileToggle.setAttribute('aria-controls', navLinks.id);
        updateMobileToggleIcon(mobileToggle, navLinks);
        mobileToggle.addEventListener('click', function (event) {
            event.preventDefault();
            navLinks.classList.toggle('active');
            updateMobileToggleIcon(mobileToggle, navLinks);
        });

        navLinks.querySelectorAll('a[href]').forEach(function (link) {
            link.addEventListener('click', function () {
                navLinks.classList.remove('active');
                updateMobileToggleIcon(mobileToggle, navLinks);
            });
        });

        document.addEventListener('click', function (event) {
            if (!navLinks.classList.contains('active')) {
                return;
            }
            if (navLinks.contains(event.target) || mobileToggle.contains(event.target)) {
                return;
            }

            navLinks.classList.remove('active');
            updateMobileToggleIcon(mobileToggle, navLinks);
        });

        document.addEventListener('keydown', function (event) {
            if (event.key !== 'Escape' || !navLinks.classList.contains('active')) {
                return;
            }

            navLinks.classList.remove('active');
            updateMobileToggleIcon(mobileToggle, navLinks);
            mobileToggle.focus();
        });
    }

    function initQuickNav(currentPage) {
        if (!QUICK_NAV_PAGES.has(currentPage) || document.body.hasAttribute('data-disable-quick-nav')) {
            return;
        }

        if (document.querySelector('.mobile-quick-nav')) {
            document.body.classList.add('has-mobile-quick-nav');
            return;
        }

        var quickNav = document.createElement('nav');
        quickNav.className = 'mobile-quick-nav';
        quickNav.setAttribute('aria-label', 'Navigazione rapida');

        QUICK_NAV_ITEMS.forEach(function (item) {
            var link = document.createElement('a');
            var isActive = item.matches.indexOf(currentPage) !== -1;

            link.className = 'mobile-quick-nav__item' + (isActive ? ' active' : '');
            link.href = item.href;
            if (isActive) {
                link.setAttribute('aria-current', 'page');
            }

            link.innerHTML = [
                '<span class="mobile-quick-nav__icon"><i data-lucide="', item.icon, '"></i></span>',
                '<span class="mobile-quick-nav__label">', item.label, '</span>'
            ].join('');

            quickNav.appendChild(link);
        });

        document.body.appendChild(quickNav);
        document.body.classList.add('has-mobile-quick-nav');
        refreshLucide(quickNav);
    }

    function initPasswordToggles() {
        document.addEventListener('click', function (event) {
            var toggle = event.target.closest('.password-toggle');
            if (!toggle) {
                return;
            }

            event.preventDefault();

            var wrapper = toggle.closest('.password-wrapper');
            var input = wrapper ? wrapper.querySelector('input') : null;
            if (!input) {
                return;
            }

            var isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            toggle.innerHTML = isPassword ? '<i data-lucide="lock"></i>' : '<i data-lucide="eye"></i>';
            toggle.title = isPassword ? 'Nascondi' : 'Mostra';
            refreshLucide(toggle);
        });
    }

    function enhanceClickableCards(root) {
        var selector = CLICKABLE_CARD_SELECTORS.join(', ');
        var elements = [];

        if (root && root.nodeType === 1 && root.matches && root.matches(selector)) {
            elements.push(root);
        }

        if (root && root.querySelectorAll) {
            root.querySelectorAll(selector).forEach(function (element) {
                elements.push(element);
            });
        }

        elements.forEach(function (element) {
            makeKeyboardClickable(element, getControlLabel(element));
        });
    }

    function initClickableCardAccessibility() {
        enhanceClickableCards(document);

        if (!document.body || window.__gymbroCardAccessibilityObserver) {
            return;
        }

        window.__gymbroCardAccessibilityObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1) {
                        enhanceClickableCards(node);
                    }
                });
            });
        });

        window.__gymbroCardAccessibilityObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    function bindEnterToButton(inputId, buttonId) {
        var input = document.getElementById(inputId);
        var button = document.getElementById(buttonId);

        if (!input || !button || input.dataset.enterBound === 'true') {
            return;
        }

        input.dataset.enterBound = 'true';
        if (!input.getAttribute('enterkeyhint')) {
            input.setAttribute('enterkeyhint', 'go');
        }
        input.addEventListener('keydown', function (event) {
            if (event.isComposing || event.key !== 'Enter') {
                return;
            }

            event.preventDefault();

            if (!button.disabled) {
                button.click();
            }
        });
    }

    function initInputShortcuts() {
        bindEnterToButton('roomNameInput', 'createRoomSubmitBtn');
        bindEnterToButton('roomCodeInput', 'joinRoomSubmitBtn');
    }

    function initServiceWorker() {
        if (!('serviceWorker' in navigator)) {
            return;
        }

        navigator.serviceWorker.register('./service-worker.js').then(function (registration) {
            console.log('Service Worker registered, scope:', registration.scope);
        }).catch(function (error) {
            console.warn('Service Worker registration failed:', error);
        });
    }

    function init() {
        var currentPage = getCurrentPage();
        initViewportUnits();
        initHeaderNav(currentPage);
        initQuickNav(currentPage);
        initPasswordToggles();
        initClickableCardAccessibility();
        initInputShortcuts();
        initServiceWorker();
        console.log('GYMBRO initialized.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
