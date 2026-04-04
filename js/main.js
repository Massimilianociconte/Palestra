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
            }
            return;
        }

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
        initHeaderNav(currentPage);
        initQuickNav(currentPage);
        initPasswordToggles();
        initServiceWorker();
        console.log('GYMBRO initialized.');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
