import React, { useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  AlertTriangle,
  Bot,
  DollarSign,
  Home,
  Moon,
  Navigation,
  Package,
  Route as RouteIcon,
  Settings,
  Sun,
  X,
} from 'lucide-react';
import { auth, ensureUserProfileInFirestore } from './lib/firebase';
import { MainTab, useAppStore } from './store/useAppStore';
import { useOnlineStatus } from './hooks/usePWAInstall';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthView } from './components/AuthView';
import { DashboardView } from './components/DashboardView';
import { RoutesAndDriverView } from './components/RoutesAndDriverView';
import { PackagesAndLoadingView } from './components/PackagesAndLoadingView';
import { FinancialAndReportsView } from './components/FinancialAndReportsView';
import { MoreAndSettingsView } from './components/MoreAndSettingsView';
import { AssistantDrawer } from './components/AssistantDrawer';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';

const NAV_ITEMS: { id: MainTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Início', icon: Home },
  { id: 'routes', label: 'Rotas', icon: Navigation },
  { id: 'packages', label: 'Pacotes', icon: Package },
  { id: 'financial', label: 'Financeiro', icon: DollarSign },
  { id: 'more', label: 'Mais', icon: Settings },
];

function AppShell() {
  const user = useAppStore((s) => s.user);
  const authReady = useAppStore((s) => s.authReady);
  const isDemoMode = useAppStore((s) => s.isDemoMode);
  const activeTab = useAppStore((s) => s.activeTab);
  const theme = useAppStore((s) => s.theme);
  const quotaExceeded = useAppStore((s) => s.quotaExceeded);
  const toasts = useAppStore((s) => s.toasts);

  const setUser = useAppStore((s) => s.setUser);
  const setAuthReady = useAppStore((s) => s.setAuthReady);
  const setTheme = useAppStore((s) => s.setTheme);
  const setGoogleMapsKey = useAppStore((s) => s.setGoogleMapsKey);
  const setQuotaExceeded = useAppStore((s) => s.setQuotaExceeded);
  const setAssistantOpen = useAppStore((s) => s.setAssistantOpen);
  const navigate = useAppStore((s) => s.navigate);
  const hydrateWorkspace = useAppStore((s) => s.hydrateWorkspace);
  const syncPendingEvents = useAppStore((s) => s.syncPendingEvents);
  const exitDemoMode = useAppStore((s) => s.exitDemoMode);
  const dismissToast = useAppStore((s) => s.dismissToast);

  const isOnline = useOnlineStatus();

  // Listen for Google Maps Case A Demo Key quota exceeded event
  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, [setQuotaExceeded]);

  // Fetch safe public browser config (Google Maps browser key if server-provided)
  useEffect(() => {
    fetch('/api/config/public')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg?.googleMapsBrowserKey) {
          setGoogleMapsKey(cfg.googleMapsBrowserKey);
        }
      })
      .catch(() => undefined);
  }, [setGoogleMapsKey]);

  // Subscribe to Firebase Authentication state
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        try {
          const profile = await ensureUserProfileInFirestore(fbUser);
          setUser(profile);
          await hydrateWorkspace('real');
        } catch {
          setUser({
            id: fbUser.uid,
            name: fbUser.displayName || 'Entregador',
            email: fbUser.email || '',
            role: 'driver',
            organizationId: `org_${fbUser.uid.slice(0, 20)}`,
            city: 'Goiânia',
            state: 'GO',
            platforms: ['Shopee', 'Mercado Livre', 'Amazon'],
            preferredNavigator: 'google_maps',
          });
          await hydrateWorkspace('real');
        }
      } else if (!useAppStore.getState().isDemoMode) {
        setUser(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [setUser, setAuthReady, hydrateWorkspace]);

  // Auto-replay offline sync queue when connection returns
  useEffect(() => {
    if (isOnline && user && !isDemoMode) {
      void syncPendingEvents();
    }
  }, [isOnline, user, isDemoMode, syncPendingEvents]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-600 dark:text-slate-300 text-sm font-medium">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          Carregando Rota Express...
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthView />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Case A Mandatory Google Maps Demo Key Quota Exceeded Banner */}
      {quotaExceeded && (
        <div
          role="alert"
          className="sticky top-0 z-50 bg-amber-100 border-b border-amber-300 text-amber-950 px-4 py-2.5 text-xs flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-700" />
            <span>
              <strong>Limite de cota Google Maps atingido:</strong> a chave de demonstração atingiu o limite temporário de requisições.{' '}
              <a
                href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold"
              >
                Saiba como configurar seu projeto Google Cloud
              </a>
              .
            </span>
          </div>
          <button
            type="button"
            onClick={() => setQuotaExceeded(false)}
            aria-label="Dispensar aviso"
            className="p-1 rounded hover:bg-amber-200/70"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Explicit Permanent Demo Mode Banner */}
      {isDemoMode && (
        <div className="bg-orange-600 text-white px-4 py-1.5 text-xs font-semibold flex flex-wrap items-center justify-between gap-2 no-print">
          <span>
            MODO DEMONSTRAÇÃO ATIVO (Goiânia e Região) — Dados fictícios isolados do armazenamento real.
          </span>
          <button
            type="button"
            onClick={() => void exitDemoMode()}
            className="underline hover:opacity-90 whitespace-nowrap shrink-0"
          >
            Sair do modo demo
          </button>
        </div>
      )}

      <OfflineIndicator />

      <div className="flex-1 flex min-h-0">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex lg:flex-col lg:w-64 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0 no-print">
          <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center">
              <RouteIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-base font-bold tracking-tight leading-none truncate">Rota Express</div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">{user.name}</div>
            </div>
          </div>

          <nav className="flex-1 p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.id, null)}
                  className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 rounded-xl text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <button
              type="button"
              onClick={() => setAssistantOpen(true)}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3"
            >
              <Bot className="w-4 h-4" />
              Assistente de Rota
            </button>
            <div className="flex items-center justify-between gap-2 pt-1">
              <PWAInstallButton />
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label="Alternar tema claro/escuro"
                className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </aside>

        {/* Main Content Column */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Mobile Top Header */}
          <header className="lg:hidden sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800 px-4 py-2.5 flex items-center justify-between gap-2 no-print">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                <RouteIcon className="w-4 h-4" />
              </div>
              <span className="text-sm font-bold truncate">Rota Express</span>
            </div>
            <div className="flex items-center gap-1.5">
              <PWAInstallButton />
              <button
                type="button"
                onClick={() => setAssistantOpen(true)}
                aria-label="Abrir Assistente de Rota"
                className="min-h-[38px] min-w-[38px] rounded-lg bg-blue-600 text-white flex items-center justify-center"
              >
                <Bot className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                aria-label="Alternar tema"
                className="min-h-[38px] min-w-[38px] rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-center"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </header>

          {/* Active View Canvas */}
          <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-5 pb-24 lg:pb-8">
            {activeTab === 'dashboard' && <DashboardView />}
            {activeTab === 'routes' && <RoutesAndDriverView />}
            {activeTab === 'packages' && <PackagesAndLoadingView />}
            {activeTab === 'financial' && <FinancialAndReportsView />}
            {activeTab === 'more' && <MoreAndSettingsView />}
          </main>
        </div>
      </div>

      {/* Mobile Bottom Tab Bar (5 core items, 48px touch targets) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 pb-safe no-print">
        <div className="grid grid-cols-5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.id, null)}
                className={`min-h-[56px] flex flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors ${
                  active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* AI Route Assistant Drawer */}
      <AssistantDrawer />

      {/* Non-intrusive Toast Stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-20 lg:bottom-5 right-4 z-50 flex flex-col gap-2 max-w-sm w-[calc(100%-2rem)] no-print">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl border px-3.5 py-2.5 text-xs font-medium shadow-lg flex items-center justify-between gap-2 ${
                t.type === 'success'
                  ? 'bg-emerald-950 text-emerald-100 border-emerald-800'
                  : t.type === 'error'
                    ? 'bg-red-950 text-red-100 border-red-800'
                    : t.type === 'warning'
                      ? 'bg-amber-950 text-amber-100 border-amber-800'
                      : 'bg-slate-900 text-white border-slate-700'
              }`}
            >
              <span>{t.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(t.id)}
                aria-label="Fechar notificação"
                className="p-0.5 opacity-70 hover:opacity-100"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
