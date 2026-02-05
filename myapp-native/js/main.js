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
                for (let registration of registrations) {
                    registration.unregister();
                }
            }
        });
    }

    // Password Toggle Logic (Event Delegation)
    document.addEventListener('click', (e) => {
        const toggle = e.target.closest('.password-toggle');
        if (!toggle) return;

        e.preventDefault();
        const wrapper = toggle.closest('.password-wrapper');
        const input = wrapper ? wrapper.querySelector('input') : null;

        if (input) {
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            toggle.textContent = isPassword ? '🔒' : '👁️';
            toggle.title = isPassword ? 'Nascondi' : 'Mostra';
        }
    });
});
