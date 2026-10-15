/**
 * Vitest + @testing-library/react global setup.
 * Imported by vite.config.ts → test.setupFiles
 */
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// ── Stub window.ethereum (MetaMask) ──────────────────────────────────────────
Object.defineProperty(window, 'ethereum', {
  writable: true,
  value: {
    request: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    isMetaMask: true,
  },
});

// ── Stub window.localStorage ──────────────────────────────────────────────────
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// ── Stub HTMLCanvasElement.getContext ─────────────────────────────────────────
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  createRadialGradient: vi.fn().mockReturnValue({
    addColorStop: vi.fn(),
  }),
  createLinearGradient: vi.fn().mockReturnValue({
    addColorStop: vi.fn(),
  }),
  drawImage: vi.fn(),
  fillText: vi.fn(),
  measureText: vi.fn().mockReturnValue({ width: 50 }),
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;
