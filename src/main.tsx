import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

// Google Maps Demo Key Quota Detection (Case A — Two-Tier Quota Handling)
// Registered BEFORE React mounts so early Maps auth/quota events are captured cleanly.
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const joined = args.map((a) => String(a ?? '')).join(' ');
  if (
    joined.includes('OverQuotaMapError') ||
    joined.includes('QuotaExceededError') ||
    joined.includes('OVER_QUERY_LIMIT')
  ) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
  originalConsoleError.apply(console, args);
};

// Apply persisted theme before initial paint
if (typeof window !== 'undefined') {
  const storedTheme = window.localStorage.getItem('rota_express_theme');
  if (storedTheme === 'dark') {
    document.documentElement.classList.add('dark');
  }
}

// Register PWA Service Worker cleanly
registerSW({
  immediate: true,
  onOfflineReady() {
    console.info('[Rota Express PWA] App pronto para operação offline.');
  },
});

createRoot(document.getElementById('root')!).render(<App />);
