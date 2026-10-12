import { describe, it, expect } from 'vitest';
import { platformLink, sourceLink } from '../src/config';

describe('public destinations', () => {
  it('keeps an unverified platform out of navigation', () => {
    expect(platformLink({ ready: false, url: '/app' })).toBe(null);
    expect(platformLink({ ready: true, url: '/app' })).toBe('/app');
  });
  it('rejects credential-bearing and executable destinations', () => {
    expect(platformLink({ ready: true, url: 'javascript:alert(1)' })).toBe(null);
    expect(platformLink({ ready: true, url: 'https://token@example.com/app' })).toBe(null);
    expect(sourceLink('https://example.com/repo?token=secret')).toBe(null);
  });
  it('does not invent a public source repository', () => {
    expect(sourceLink('')).toBe(null);
    expect(sourceLink('https://github.com/sdawka/artyfact-cf')).toBe('https://github.com/sdawka/artyfact-cf');
  });
});
