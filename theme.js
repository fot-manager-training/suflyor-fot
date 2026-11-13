/* Apply the shared choice before first paint; storage can be disabled. */
(() => {
  const key = 'szb-color-theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let choice;
  const valid = value => value === 'light' || value === 'dark';
  try { choice = localStorage.getItem(key); } catch (_) {}
  function apply() {
    const dark = valid(choice) ? choice === 'dark' : system.matches;
    root.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#0E1613' : '#F5F8F5';
    document.querySelectorAll('.theme-toggle').forEach(button => {
      button.hidden = false;
      const label = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
      button.setAttribute('aria-label', label);
      button.title = label;
      button.setAttribute('aria-pressed', String(dark));
    });
  }
  apply();
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('.theme-toggle').forEach(button => {
      button.addEventListener('click', () => {
        choice = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(key, choice); } catch (_) {}
        apply();
      });
    });
  });
  system.addEventListener('change', () => { if (!valid(choice)) apply(); });
  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) {
      choice = event.newValue;
      apply();
    }
  });
})();
