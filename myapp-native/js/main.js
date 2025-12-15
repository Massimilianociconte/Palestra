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

    // FORCE UNREGISTER SERVICE WORKER (Fix for Black Screen / Cache Issues)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
            if (registrations.length > 0) {
                console.log('Found existing Service Workers. Unregistering to ensure stability...');
                for(let registration of registrations) {
                    registration.unregister();
                }
                // Optional: Reload page once if we found one, to ensure fresh start? 
                // Better not to loop. Just unregister for next run.
            }
        });
    }

    // Explicitly hide Splash Screen if Capacitor is available
    /*
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SplashScreen) {
        window.Capacitor.Plugins.SplashScreen.hide();
    }
    */
});
