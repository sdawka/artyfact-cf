import './styles/site.css';
if (document.querySelector('[data-system-explorer]')) {
  void import('./hydrate').then(({ hydrateExamples }) => hydrateExamples());
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
