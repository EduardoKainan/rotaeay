import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  errorMessage: string;
  isPermissionError: boolean;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '', isPermissionError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    const raw = error?.message || 'Erro inesperado na aplicação.';
    let friendly = raw;
    let isPerm = false;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.operationType && parsed.error) {
        isPerm = String(parsed.error).toLowerCase().includes('permission');
        friendly = isPerm
          ? `Permissão insuficiente no Cloud Firestore ao executar "${parsed.operationType}" em "${parsed.path || 'coleção'}". Verifique se sua conta está autenticada com e-mail verificado.`
          : parsed.error;
      }
    } catch {
      // Plain error message
    }
    return { hasError: true, errorMessage: friendly, isPermissionError: isPerm };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold">Ocorreu um problema na interface</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {this.state.errorMessage}
            </p>
            {this.state.isPermissionError && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Seus dados locais continuam salvos em IndexedDB. Faça login novamente ou recarregue a página.
              </p>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm px-4 py-2.5 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Recarregar Rota Express
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
