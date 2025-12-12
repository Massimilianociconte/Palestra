document.addEventListener('DOMContentLoaded', () => {
    // Mobile Menu Toggle
    const mobileToggle = document.getElementById('mobileToggle');
    const navLinks = document.getElementById('navLinks');

    if (mobileToggle && navLinks) {
        mobileToggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            mobileToggle.textContent = navLinks.classList.contains('active') ? '✕' : '☰';
        });
    }

    console.log('GYMBRO initialized.');

    // Service Worker Management
    if ('serviceWorker' in navigator) {
        // Check if running in Capacitor Native
        const isNative = window.Capacitor && window.Capacitor.isNativePlatform();

        if (isNative) {
            console.log('Running in Native mode: Unregistering Service Workers to prevent conflicts.');
            navigator.serviceWorker.getRegistrations().then(registrations => {
                for(let registration of registrations) {
                    registration.unregister().then(success => {
                        console.log('Service Worker unregistered:', success);
                    });
                }
            });
        } else {
            // Standard PWA registration for web
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('service-worker.js')
                    .then(registration => {
                        console.log('ServiceWorker registration successful with scope: ', registration.scope);
                    })
                    .catch(err => {
                        console.log('ServiceWorker registration failed: ', err);
                    });
            });
        }
    }
});
