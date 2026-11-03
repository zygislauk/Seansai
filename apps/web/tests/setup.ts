import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest globals are off, so Testing Library cannot register its own cleanup hook.
afterEach(() => {
  cleanup();
  // After unmounting, as effects flushed by it can still write. A test's own afterEach runs before
  // this one, so clearing there can leave a city remembered for the next test.
  if (typeof window !== 'undefined') window.localStorage.clear();
});
