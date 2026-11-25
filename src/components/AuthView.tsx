import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Compass,
  Lock,
  Mail,
  MapPin,
  Play,
  Route as RouteIcon,
  ShieldCheck,
  User as UserIcon,
} from 'lucide-react';
import {
  registerWithEmail,
  resetUserPassword,
  signInWithEmail,
  signInWithGooglePopup,
} from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';

export function AuthView() {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const enterDemoMode = useAppStore((s) => s.enterDemoMode);

  const handleGoogle = async () => {
    setError(null);
    setInfoMessage(null);
    setLoading(true);
    try {
      await signInWithGooglePopup();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao entrar com Google.';
      setError(
        msg.includes('popup-closed-by-user')
          ? 'Login com Google cancelado.'
          : `Não foi possível entrar com Google: ${msg}`
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setLoading(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email.trim(), password);
      } else if (mode === 'register') {
        if (password.length < 6) {
          setError('A senha deve ter pelo menos 6 caracteres.');
          setLoading(false);
          return;
        }
        await registerWithEmail(name.trim() || 'Entregador', email.trim(), password);
      } else {
        await resetUserPassword(email.trim());
        setInfoMessage('Enviamos um link de recuperação para seu e-mail.');
        setMode('login');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro na autenticação.';
      if (msg.includes('invalid-credential') || msg.includes('wrong-password')) {
        setError('E-mail ou senha incorretos.');
      } else if (msg.includes('email-already-in-use')) {
        setError('Este e-mail já está cadastrado. Tente entrar ou recuperar sua senha.');
      } else if (msg.includes('operation-not-allowed')) {
        setError('Login por e-mail/senha não habilitado no projeto Firebase. Utilize "Entrar com Google" ou o Modo Demonstração.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col lg:flex-row">
      {/* Left Brand / Operational Summary */}
      <div className="lg:w-1/2 bg-slate-900 text-white p-8 lg:p-14 flex flex-col justify-between">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center shadow-sm">
              <RouteIcon className="w-6 h-6 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight block leading-none">Rota Express</span>
              <span className="text-xs text-slate-400">Operação Last-Mile Inteligente • pt-BR</span>
            </div>
          </div>

          <div className="space-y-3 pt-4 max-w-lg">
            <h1 className="text-3xl lg:text-4xl font-bold tracking-tight leading-tight">
              Transforme planilhas reais em rotas otimizadas e entregas mais rentáveis.
            </h1>
            <p className="text-sm lg:text-base text-slate-300 leading-relaxed">
              Importe arquivos XLSX, XLS e CSV da Shopee, Mercado Livre, Amazon ou transportadoras, organize a carga no veículo com independência da sequência da rota e acompanhe seu resultado operacional em reais.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 max-w-lg">
            <div className="rounded-xl bg-slate-800/70 border border-slate-700/80 p-4 space-y-1">
              <div className="flex items-center gap-2 text-orange-400 text-xs font-semibold">
                <MapPin className="w-4 h-4" />
                Agrupamento & Otimização
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Paradas agrupadas com segurança, matriz rodoviária real quando configurada e heurística 2-Opt / Or-Opt.
              </p>
            </div>
            <div className="rounded-xl bg-slate-800/70 border border-slate-700/80 p-4 space-y-1">
              <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold">
                <Compass className="w-4 h-4" />
                Modo Motorista & Offline
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Navegação direta no Google Maps e Waze, scanner de etiquetas, zonas de carga e fila offline em IndexedDB.
              </p>
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-slate-800 flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Dados isolados por usuário (Firebase Auth + Firestore)
          </span>
          <span>•</span>
          <span>Sem cobrança oculta</span>
        </div>
      </div>

      {/* Right Auth Card */}
      <div className="lg:w-1/2 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 sm:p-8 shadow-sm space-y-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                {mode === 'login'
                  ? 'Entrar na sua conta'
                  : mode === 'register'
                    ? 'Criar conta operacional'
                    : 'Recuperar senha'}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                {mode === 'login'
                  ? 'Sincronize suas rotas, veículos e histórico financeiro na nuvem.'
                  : mode === 'register'
                    ? 'Comece gratuitamente com armazenamento local e sincronização.'
                    : 'Informe o e-mail cadastrado para receber instruções.'}
              </p>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 p-3 flex items-start gap-2.5 text-xs text-red-700 dark:text-red-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {infoMessage && (
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 p-3 flex items-start gap-2.5 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{infoMessage}</span>
              </div>
            )}

            {mode !== 'reset' && (
              <>
                <button
                  type="button"
                  onClick={handleGoogle}
                  disabled={loading}
                  className="w-full min-h-[46px] inline-flex items-center justify-center gap-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold text-sm px-4 transition-colors disabled:opacity-60"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      fill="#4285F4"
                      d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3h3.88c2.27-2.09 3.54-5.17 3.54-8.87z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.09A12 12 0 0 0 12 24z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.28 14.29A7.18 7.18 0 0 1 4.9 12c0-.79.14-1.56.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.99-3.09z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.62l3.99 3.09c.95-2.85 3.6-4.96 6.72-4.96z"
                    />
                  </svg>
                  Continuar com Google
                </button>

                <div className="relative flex items-center py-1">
                  <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                  <span className="shrink-0 mx-3 text-xs text-slate-400">ou use e-mail</span>
                  <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                </div>
              </>
            )}

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Nome completo
                  </label>
                  <div className="relative">
                    <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex.: Carlos Eduardo"
                      className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  E-mail
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="motorista@exemplo.com"
                    className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              {mode !== 'reset' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Senha
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="w-full min-h-[44px] pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full min-h-[46px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors disabled:opacity-60"
              >
                {loading
                  ? 'Processando...'
                  : mode === 'login'
                    ? 'Entrar'
                    : mode === 'register'
                      ? 'Criar conta'
                      : 'Enviar e-mail de recuperação'}
              </button>
            </form>

            <div className="flex items-center justify-between text-xs pt-1">
              {mode === 'login' ? (
                <>
                  <button
                    type="button"
                    onClick={() => setMode('register')}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                  >
                    Criar nova conta
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('reset')}
                    className="text-slate-500 dark:text-slate-400 hover:underline"
                  >
                    Esqueci minha senha
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setMode('login')}
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  Voltar para entrar
                </button>
              )}
            </div>
          </div>

          {/* Explicit Isolated Demo Mode CTA */}
          <div className="rounded-2xl border border-orange-200 dark:border-orange-900/70 bg-orange-50/70 dark:bg-orange-950/30 p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-orange-700 dark:text-orange-300">
                Modo Demonstração (Goiânia)
              </span>
              <span className="text-[11px] text-orange-700/80 dark:text-orange-300/80">
                Dados fictícios isolados
              </span>
            </div>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Explore todas as telas imediatamente com uma rota fictícia em Goiânia e Região Metropolitana (50 pacotes pré-carregados, mapa interativo, organização de carga e painel financeiro) sem criar conta.
            </p>
            <button
              type="button"
              onClick={() => void enterDemoMode(50)}
              className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm transition-colors"
            >
              <Play className="w-4 h-4" />
              Testar agora em Modo Demonstração
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
