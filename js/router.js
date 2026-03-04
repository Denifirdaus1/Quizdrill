/**
 * router.js — Loads screen HTML fragments into the main app shell
 */
const Router = (() => {
    const screenMap = {
        'dashboard': 'screens/dashboard.html',
        'questions': 'screens/questions.html',
        'quiz': 'screens/quiz-setup.html',
        'stats': 'screens/stats.html',
        'quiz-active': 'screens/quiz-active.html',
        'results': 'screens/results.html'
    };

    const modalFiles = [
        'screens/modals/question-modal.html',
        'screens/modals/import-modal.html'
    ];

    const loadedScreens = new Set();

    async function fetchHTML(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
        return await response.text();
    }

    /**
     * Load all screens and modals into the DOM
     */
    async function loadAll() {
        const mainContent = document.getElementById('mainContent');
        const modalContainer = document.getElementById('modalContainer');

        if (!mainContent || !modalContainer) {
            throw new Error('Missing #mainContent or #modalContainer');
        }

        // Load all screens in parallel
        const screenEntries = Object.entries(screenMap);
        const screenPromises = screenEntries.map(([name, url]) => fetchHTML(url).then(html => ({ name, html })));
        const screens = await Promise.all(screenPromises);

        for (const { name, html } of screens) {
            mainContent.insertAdjacentHTML('beforeend', html);
            loadedScreens.add(name);
        }

        // Load all modals in parallel
        const modalPromises = modalFiles.map(url => fetchHTML(url));
        const modals = await Promise.all(modalPromises);

        for (const html of modals) {
            modalContainer.insertAdjacentHTML('beforeend', html);
        }
    }

    return { loadAll };
})();
