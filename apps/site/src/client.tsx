import './styles/site.css';
// The static markup is already usable, so a failed chunk load (flaky network, stale cache after a deploy) is not an error.
const hydrated = document.querySelector('[data-system-explorer]')
  ? import('./hydrate').then(({ hydrateExamples }) => hydrateExamples()).catch(() => {})
  : Promise.resolve();
// Decorative WebGL effects load last: after hydration, the load event and an idle moment, so they never delay first paint.
if (document.querySelector('[data-hero-orb], [data-ambient]')) {
  const whenIdle = (run: () => void) => 'requestIdleCallback' in window ? requestIdleCallback(run, { timeout: 1500 }) : setTimeout(run, 200);
  const afterLoad = document.readyState === 'complete' ? Promise.resolve() : new Promise(resolve => addEventListener('load', resolve, { once: true }));
  Promise.all([hydrated, afterLoad]).then(() => whenIdle(() => {
    import('./effects').then(({ mountEffects }) => mountEffects()).catch(() => {});
  }));
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.hidden = false;
  button.addEventListener('click', async () => {
    const code = document.getElementById(button.dataset.copy!)?.textContent ?? '';
    const feedback = button.parentElement?.querySelector<HTMLElement>('[role="status"]');
    try {
      await navigator.clipboard.writeText(code);
      if (feedback) feedback.textContent = 'Copied.';
    } catch {
      if (feedback) feedback.textContent = 'Select the code and copy it manually.';
    }
  });
}
