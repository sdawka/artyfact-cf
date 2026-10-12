import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { SystemExplorer } from './SystemExplorer';
export function hydrateExamples() {
  for (const element of document.querySelectorAll<HTMLElement>('[data-system-explorer]')) {
    hydrateRoot(element, <SystemExplorer />);
  }
}
