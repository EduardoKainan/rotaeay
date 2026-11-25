import React, { useState } from 'react';
import { CloudOff, Download, RefreshCw, Share, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { useAppStore } from '../store/useAppStore';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else if (isIOS) {
      setShowIOSModal(true);
    }
  };

  if (!isInstallable && !isIOS) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-100 px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
      >
        <Download className="w-3.5 h-3.5 text-orange-500" />
        Instalar App
      </button>

      {showIOSModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setShowIOSModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-sm w-full p-5 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">
                Instalar Rota Express no iPhone/iPad
              </h3>
              <button
                type="button"
                onClick={() => setShowIOSModal(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <ol className="text-sm text-slate-600 dark:text-slate-300 space-y-2.5 list-decimal list-inside">
              <li>
                Toque no ícone <strong>Compartilhar</strong>{' '}
                <Share className="inline w-3.5 h-3.5 text-blue-600" /> na barra inferior do Safari.
              </li>
              <li>
                Role as opções e toque em <strong>Adicionar à Tela de Início</strong>.
              </li>
              <li>
                Toque em <strong>Adicionar</strong> no canto superior direito.
              </li>
            </ol>
            <button
              type="button"
              onClick={() => setShowIOSModal(false)}
              className="w-full min-h-[44px] rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-medium text-sm"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  const pendingSyncCount = useAppStore((s) => s.pendingSyncCount);
  const isSyncing = useAppStore((s) => s.isSyncing);
  const isDemoMode = useAppStore((s) => s.isDemoMode);
  const syncPendingEvents = useAppStore((s) => s.syncPendingEvents);
  const pushToast = useAppStore((s) => s.pushToast);

  if (isOnline && (pendingSyncCount === 0 || isDemoMode)) return null;

  const handleManualSync = async () => {
    const synced = await syncPendingEvents();
    pushToast(
      synced > 0 ? 'success' : 'info',
      synced > 0
        ? `${synced} evento(s) sincronizados com o Cloud Firestore.`
        : 'Nenhum evento novo sincronizado agora.'
    );
  };

  return (
    <div
      role="status"
      className={`px-4 py-2 text-xs font-medium flex flex-wrap items-center justify-between gap-2 border-b ${
        !isOnline
          ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-900'
          : 'bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-200 border-blue-200 dark:border-blue-900'
      }`}
    >
      <div className="flex items-center gap-2">
        <CloudOff className="w-4 h-4 shrink-0" />
        <span>
          {!isOnline
            ? `Modo offline ativo — entregas e alterações são salvas localmente em IndexedDB (${pendingSyncCount} pendente(s) na fila).`
            : `${pendingSyncCount} evento(s) registrados offline aguardando sincronização na nuvem.`}
        </span>
      </div>
      {isOnline && !isDemoMode && pendingSyncCount > 0 && (
        <button
          type="button"
          onClick={handleManualSync}
          disabled={isSyncing}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Sincronizando...' : 'Sincronizar agora'}
        </button>
      )}
    </div>
  );
}
