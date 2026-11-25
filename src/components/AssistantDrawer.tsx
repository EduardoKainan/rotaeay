import React, { useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { computeFinancialSummary } from '../domain/financial';
import { useAppStore } from '../store/useAppStore';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolsUsed?: string[];
  pendingConfirmation?: { actionType: string; summary: string } | null;
}

const QUICK_PROMPTS = [
  'Qual minha próxima entrega?',
  'Quantas entregas ainda faltam?',
  'Quais entregas frustradas podem ter 2ª tentativa?',
  'Quanto lucrei hoje?',
  'Reotimizar as paradas restantes',
];

export function AssistantDrawer() {
  const open = useAppStore((s) => s.assistantOpen);
  const setOpen = useAppStore((s) => s.setAssistantOpen);
  const routes = useAppStore((s) => s.routes);
  const activeRouteId = useAppStore((s) => s.activeRouteId);
  const packages = useAppStore((s) => s.packages);
  const vehicles = useAppStore((s) => s.vehicles);
  const financialEntries = useAppStore((s) => s.financialEntries);
  const isDemoMode = useAppStore((s) => s.isDemoMode);
  const reoptimizeRemainingStops = useAppStore((s) => s.reoptimizeRemainingStops);
  const applyNewRouteVersion = useAppStore((s) => s.applyNewRouteVersion);
  const pushToast = useAppStore((s) => s.pushToast);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [listening, setListening] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: 'Olá! Sou o Assistente de Rota. Pergunte sobre sua próxima parada, localização física de pacotes, 2ª tentativa ou resumo financeiro. Nenhuma alteração na rota é aplicada sem sua confirmação.',
    },
  ]);

  const activeRoute = useMemo(
    () => routes.find((r) => r.id === activeRouteId) || routes[0] || null,
    [routes, activeRouteId]
  );

  const activeVersion = useMemo(() => {
    if (!activeRoute) return null;
    return (
      activeRoute.versions.find((v) => v.version === activeRoute.activeVersion) ||
      activeRoute.versions[activeRoute.versions.length - 1] ||
      null
    );
  }, [activeRoute]);

  const routePackages = useMemo(
    () => (activeRoute ? packages.filter((p) => p.routeId === activeRoute.id) : packages),
    [packages, activeRoute]
  );

  const financialSummary = useMemo(
    () =>
      computeFinancialSummary({
        entries: financialEntries,
        routes: activeRoute ? [activeRoute] : routes,
        packages: routePackages,
        vehicle: vehicles[0],
      }),
    [financialEntries, activeRoute, routes, routePackages, vehicles]
  );

  if (!open) return null;

  const speakText = (text: string) => {
    if (!voiceOutput || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'pt-BR';
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech failure
    }
  };

  const sendMessage = async (textToSend: string) => {
    const clean = textToSend.trim();
    if (!clean || busy) return;

    setMessages((prev) => [
      ...prev,
      { id: `u_${Date.now()}`, role: 'user', text: clean },
    ]);
    setInput('');
    setBusy(true);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: clean,
          context: {
            activeRoute: activeRoute
              ? {
                  id: activeRoute.id,
                  name: activeRoute.name,
                  status: activeRoute.status,
                  activeVersion: activeRoute.activeVersion,
                  selectedStrategy: activeRoute.selectedStrategy,
                  stops: activeVersion?.stops || [],
                  metrics: activeVersion?.metrics || null,
                }
              : null,
            packages: routePackages.slice(0, 500),
            financialSummary,
            isDemo: isDemoMode,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const errReply = data.error || 'Assistente Gemini indisponível no momento.';
        setMessages((prev) => [
          ...prev,
          { id: `a_${Date.now()}`, role: 'assistant', text: errReply },
        ]);
        return;
      }

      const replyText = data.reply || 'Consulta concluída.';
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          text: replyText,
          toolsUsed: data.toolsUsed || [],
          pendingConfirmation: data.pendingConfirmation || null,
        },
      ]);
      speakText(replyText);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: 'assistant',
          text: 'Sem conexão com o servidor do Assistente no momento. Suas entregas continuam funcionando offline.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmPendingAction = async (msgId: string, actionType: string) => {
    if (!activeRoute) {
      pushToast('warning', 'Nenhuma rota ativa para alterar.');
      return;
    }

    const strategy = actionType === 'prioritize_urgent' ? 'time_window' : activeRoute.selectedStrategy;
    const preview = await reoptimizeRemainingStops(strategy, false);
    if (preview) {
      applyNewRouteVersion(activeRoute.id, preview.version, strategy);
      pushToast('success', 'Alteração confirmada e aplicada à rota ativa (zonas físicas mantidas).');
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, pendingConfirmation: null } : m))
      );
    }
  };

  const handleVoiceInput = () => {
    const SpeechRec =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SpeechRec) {
      pushToast('info', 'Reconhecimento de voz não suportado neste navegador. Digite sua pergunta abaixo.');
      return;
    }

    try {
      const rec = new SpeechRec() as {
        lang: string;
        interimResults: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
        onerror: () => void;
        onend: () => void;
        start: () => void;
      };
      rec.lang = 'pt-BR';
      rec.interimResults = false;
      setListening(true);
      rec.onresult = (e) => {
        const transcript = e.results?.[0]?.[0]?.transcript;
        if (transcript) void sendMessage(transcript);
      };
      rec.onerror = () => setListening(false);
      rec.onend = () => setListening(false);
      rec.start();
    } catch {
      setListening(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/50 flex justify-end"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white leading-none">Assistente de Rota</h2>
              <span className="text-[11px] text-slate-500">Gemini Function Calling · Dados reais da rota</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setVoiceOutput((v) => !v)}
              title={voiceOutput ? 'Desativar leitura em voz alta' : 'Ativar leitura em voz alta'}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {voiceOutput ? <Volume2 className="w-4 h-4 text-blue-600" /> : <VolumeX className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar assistente"
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
            >
              <div
                className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                }`}
              >
                {msg.text}
                {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-slate-200/60 dark:border-slate-700 text-[10px] text-slate-500 dark:text-slate-400">
                    Consultado: {msg.toolsUsed.join(', ')}
                  </div>
                )}
              </div>

              {msg.pendingConfirmation && (
                <div className="mt-2 max-w-[88%] rounded-xl border border-orange-300 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/50 p-3 space-y-2 text-xs">
                  <div className="font-bold text-orange-900 dark:text-orange-200">
                    Confirmação necessária
                  </div>
                  <p className="text-orange-800 dark:text-orange-300">{msg.pendingConfirmation.summary}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleConfirmPendingAction(msg.id, msg.pendingConfirmation!.actionType)}
                      className="min-h-[34px] inline-flex items-center gap-1 rounded-lg bg-orange-600 hover:bg-orange-700 text-white px-3 text-xs font-semibold"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Confirmar alteração
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setMessages((prev) =>
                          prev.map((m) => (m.id === msg.id ? { ...m, pendingConfirmation: null } : m))
                        )
                      }
                      className="min-h-[34px] rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 text-xs"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 animate-pulse text-blue-600" />
              Consultando dados da rota...
            </div>
          )}
        </div>

        {/* Quick Prompts */}
        <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5 overflow-x-auto">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void sendMessage(q)}
              disabled={busy}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2.5 py-1.5 text-[11px] text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage(input);
          }}
          className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
        >
          <button
            type="button"
            onClick={handleVoiceInput}
            aria-label="Comando por voz"
            className={`min-h-[42px] min-w-[42px] rounded-xl border flex items-center justify-center shrink-0 ${
              listening
                ? 'border-red-500 bg-red-50 text-red-600'
                : 'border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte sobre paradas, carga ou lucro..."
            className="flex-1 min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            aria-label="Enviar"
            className="min-h-[42px] min-w-[42px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white flex items-center justify-center shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
