// Runs before the stylesheet so a remembered light or dark choice paints first (MV3 forbids inline scripts, hence this file).
// Same key and values as THEME_KEY and restoreTheme in preferences.js; anything else, or unreadable storage, leaves the system scheme.
(() => {
  let theme = null;
  try { theme = localStorage.getItem('giga-pinax-theme-v1'); } catch { /* follow the system */ }
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
})();
