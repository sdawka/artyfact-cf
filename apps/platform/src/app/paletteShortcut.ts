/** The current overlay owns keyboard input; the palette may toggle its own dialog. */
export function handlePaletteShortcut(event: KeyboardEvent, toggle: () => void): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return false;
  if (event.defaultPrevented) return true;
  event.preventDefault();
  const overlays = document.querySelectorAll('[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="listbox"]');
  if ([...overlays].some(overlay => overlay.getAttribute("role") !== "dialog" || !overlay.querySelector("[cmdk-root]"))) return true;
  toggle();
  return true;
}
