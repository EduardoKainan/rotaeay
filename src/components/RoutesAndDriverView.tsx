import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Crosshair,
  ExternalLink,
  Flag,
  History,
  ListOrdered,
  Map as MapIcon,
  MessageCircle,
  Navigation,
  Package,
  Phone,
  Pin as PinIcon,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Split,
  XCircle,
} from 'lucide-react';
import { DeliveryPackage, OptimizationStrategy, PackageStatus, RouteStop, RouteVersion } from '../types/domain';
import {
  buildExternalNavigationUrl,
  buildWhatsAppUrl,
  computeSecondAttemptSuggestions,
} from '../domain/optimizer';
import { useAppStore } from '../store/useAppStore';
import { InteractiveMap } from './InteractiveMap';
import { RouteWizardView } from './RouteWizardView';

const FAILURE_REASONS = [
  'Cliente ausente',
  'Endereço incorreto ou não localizado',
  'Estabelecimento / comércio fechado',
  'Portaria ou condomínio recusou recebimento',
  'Destinatário recusou o pacote',
  'Local inacessível ou área de risco',
  'Chuva forte / ocorrência viária',
  'Horário comercial encerrado',
  'Outro motivo',
];

const PACKAGE_STATUS_LABEL: Record<PackageStatus, { label: string; color: string }> = {
  pending: { label: 'Pendente', color: 'text-blue-700 dark:text-blue-400' },
  loaded: { label: 'Carregado', color: 'text-sky-700 dark:text-sky-400' },
  in_transit: { label: 'Em rota', color: 'text-orange-700 dark:text-orange-400' },
  delivered: { label: 'Entregue', color: 'text-emerald-700 dark:text-emerald-400' },
  failed_attempt: { label: 'Tentativa frustrada', color: 'text-red-700 dark:text-red-400' },
  postponed: { label: 'Adiado', color: 'text-amber-700 dark:text-amber-400' },
  return_required: { label: 'Retorno ao CD', color: 'text-red-700 dark:text-red-400' },
  returned: { label: 'Devolvido', color: 'text-slate-600 dark:text-slate-400' },
  cancelled: { label: 'Cancelado', color: 'text-slate-500 dark:text-slate-500' },
};

export function RoutesAndDriverView() {
  const routes = useAppStore((s) => s.routes);
  const activeRouteId = useAppStore((s) => s.activeRouteId);
  const packages = useAppStore((s) => s.packages);
  const subView = useAppStore((s) => s.subView);
  const navigate = useAppStore((s) => s.navigate);
  const setActiveRouteId = useAppStore((s) => s.setActiveRouteId);
  const startActiveRoute = useAppStore((s) => s.startActiveRoute);
  const finishActiveRoute = useAppStore((s) => s.finishActiveRoute);
  const updatePackageStatus = useAppStore((s) => s.updatePackageStatus);
  const markStopDeliveredBatch = useAppStore((s) => s.markStopDeliveredBatch);
  const updatePackageAddressAndCoords = useAppStore((s) => s.updatePackageAddressAndCoords);
  const reorderStopManually = useAppStore((s) => s.reorderStopManually);
  const splitRouteStop = useAppStore((s) => s.splitRouteStop);
  const reoptimizeRemainingStops = useAppStore((s) => s.reoptimizeRemainingStops);
  const applyNewRouteVersion = useAppStore((s) => s.applyNewRouteVersion);
  const recalculateSecondAttemptInsertion = useAppStore((s) => s.recalculateSecondAttemptInsertion);
  const pushToast = useAppStore((s) => s.pushToast);

  const [focusedStopId, setFocusedStopId] = useState<string | null>(null);
  const [pinEditStopId, setPinEditStopId] = useState<string | null>(null);
  const [failModalPkg, setFailModalPkg] = useState<DeliveryPackage | null>(null);
  const [failReason, setFailReason] = useState(FAILURE_REASONS[0]);
  const [failNotes, setFailNotes] = useState('');
  const [failRetryTime, setFailRetryTime] = useState('');
  const [batchConfirmStop, setBatchConfirmStop] = useState<RouteStop | null>(null);

  const [reoptStrategy, setReoptStrategy] = useState<OptimizationStrategy>('balanced');
  const [reoptPreview, setReoptPreview] = useState<{
    previousDistanceMeters: number;
    newDistanceMeters: number;
    previousDurationSeconds: number;
    newDurationSeconds: number;
    version: RouteVersion;
  } | null>(null);
  const [reoptBusy, setReoptBusy] = useState(false);

  const [showFinishModal, setShowFinishModal] = useState(false);
  const [odometerKm, setOdometerKm] = useState('');

  const currentTab =
    subView === 'new_route'
      ? 'new_route'
      : subView === 'map'
        ? 'map'
        : subView === 'stops_list'
          ? 'stops_list'
          : subView === 'reoptimize'
            ? 'reoptimize'
            : subView === 'history'
              ? 'history'
              : 'driver_mode';

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

  const stops = activeVersion?.stops || [];

  const routePackages = useMemo(() => {
    if (!activeRoute) return [];
    return packages.filter((p) => p.routeId === activeRoute.id);
  }, [packages, activeRoute]);

  const pkgMap = useMemo(() => {
    const m: Record<string, DeliveryPackage> = {};
    for (const p of routePackages) m[p.id] = p;
    return m;
  }, [routePackages]);

  const remainingStops = useMemo(
    () => stops.filter((s) => s.status === 'pending' || s.status === 'in_progress' || s.status === 'partial'),
    [stops]
  );

  const nextStop = remainingStops[0] || null;
  const activeDriverStop =
    (focusedStopId ? stops.find((s) => s.id === focusedStopId) : null) || nextStop || stops[0] || null;

  const secondAttemptSuggestions = useMemo(() => {
    const failedPkgs = routePackages.filter((p) => p.status === 'failed_attempt');
    return computeSecondAttemptSuggestions(failedPkgs, remainingStops);
  }, [routePackages, remainingStops]);

  if (currentTab === 'new_route') {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => navigate('routes', 'driver_mode')}
          className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
        >
          ← Voltar para Rotas
        </button>
        <RouteWizardView />
      </div>
    );
  }

  const handleCopyAddress = (text: string) => {
    void navigator.clipboard?.writeText(text);
    pushToast('info', 'Endereço copiado para a área de transferência.');
  };

  const handleConfirmFail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!failModalPkg) return;
    updatePackageStatus({
      packageId: failModalPkg.id,
      newStatus: 'failed_attempt',
      reason: failReason,
      notes: failNotes.trim() || undefined,
      suggestedRetryTime: failRetryTime || undefined,
      eventType: 'failed_attempt',
    });
    setFailModalPkg(null);
    setFailNotes('');
    setFailRetryTime('');
    pushToast('warning', `Tentativa frustrada registrada para ${failModalPkg.trackingCode}.`);
  };

  const handleSimulateReopt = async () => {
    setReoptBusy(true);
    try {
      const preview = await reoptimizeRemainingStops(reoptStrategy, false);
      setReoptPreview(preview);
    } finally {
      setReoptBusy(false);
    }
  };

  const handleApplyReopt = () => {
    if (!activeRoute || !reoptPreview) return;
    applyNewRouteVersion(activeRoute.id, reoptPreview.version, reoptStrategy);
    setReoptPreview(null);
    pushToast('success', 'Nova versão da rota aplicada! As zonas físicas de carga foram mantidas intactas.');
    navigate('routes', 'driver_mode');
  };

  const handleConfirmFinish = (e: React.FormEvent) => {
    e.preventDefault();
    const parsedKm = odometerKm.trim() ? Number(odometerKm.replace(',', '.')) : undefined;
    finishActiveRoute(Number.isFinite(parsedKm) && (parsedKm || 0) > 0 ? parsedKm : undefined);
    setShowFinishModal(false);
    setOdometerKm('');
  };

  return (
    <div className="space-y-5">
      {/* Header + Sub-tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {activeRoute ? activeRoute.name : 'Rotas & Execução'}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {activeRoute && activeVersion
              ? `Versão v${activeRoute.activeVersion} · ${stops.length} paradas · ${remainingStops.length} pendentes · ${activeVersion.providerLabel}`
              : 'Crie ou selecione uma rota para iniciar as entregas.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('routes', 'new_route')}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-3.5 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" /> Nova rota
          </button>
          {activeRoute && activeRoute.status === 'planned' && (
            <button
              type="button"
              onClick={startActiveRoute}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <Play className="w-4 h-4" /> Iniciar rota
            </button>
          )}
          {activeRoute && activeRoute.status === 'active' && (
            <button
              type="button"
              onClick={() => setShowFinishModal(true)}
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 px-3.5 text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <Flag className="w-4 h-4 text-emerald-600" /> Finalizar rota
            </button>
          )}
        </div>
      </div>

      {/* Horizontal Sub-Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800">
        {[
          { id: 'driver_mode', label: 'Modo Motorista', icon: Navigation },
          { id: 'map', label: 'Mapa Operacional', icon: MapIcon },
          { id: 'stops_list', label: `Paradas (${stops.length})`, icon: ListOrdered },
          { id: 'reoptimize', label: `Reotimizar & 2ª Tentativa`, icon: RefreshCw },
          { id: 'history', label: `Histórico (${routes.length})`, icon: History },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate('routes', tab.id as typeof subView)}
              className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                active
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {!activeRoute && currentTab !== 'history' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center space-y-3">
          <Navigation className="w-8 h-8 text-slate-400 mx-auto" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Nenhuma rota ativa</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            Importe uma planilha XLSX/CSV ou gere uma rota no assistente para ativar o Modo Motorista e o Mapa.
          </p>
          <button
            type="button"
            onClick={() => navigate('routes', 'new_route')}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-blue-600 text-white px-5 text-sm font-semibold"
          >
            <Plus className="w-4 h-4" /> Criar primeira rota
          </button>
        </div>
      )}

      {/* TAB 1: DRIVER MODE (NEXT DELIVERY) */}
      {activeRoute && currentTab === 'driver_mode' && activeDriverStop && (
        <div className="space-y-4">
          {/* Operational disclaimer: internal status vs external marketplace */}
          <div className="rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3.5 py-2 text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>Controle interno Rota Express:</strong> confirmações de entrega aqui registradas atualizam seu painel e histórico operacional; realize a baixa oficial no aplicativo da plataforma (Shopee/ML/Amazon) quando exigido.
            </span>
          </div>

          {/* Primary Stop Execution Card */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-orange-600 dark:text-orange-400 tabular-nums">
                  <span>PARADA #{activeDriverStop.sequence} DE {stops.length}</span>
                  {activeDriverStop.originalSequence && (
                    <span className="text-slate-500 dark:text-slate-400 font-normal">
                      · Orig. #{activeDriverStop.originalSequence}
                    </span>
                  )}
                  {activeDriverStop.priority !== 'normal' && (
                    <span className="text-red-600 dark:text-red-400 uppercase font-bold">
                      · {activeDriverStop.priority}
                    </span>
                  )}
                </div>
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white leading-tight">
                  {activeDriverStop.address}
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {activeDriverStop.neighborhood}
                  {activeDriverStop.city ? `, ${activeDriverStop.city}` : ''}
                  {activeDriverStop.complementSummary ? ` · ${activeDriverStop.complementSummary}` : ''}
                </p>
              </div>

              <div className="text-right tabular-nums space-y-0.5">
                {activeDriverStop.estimatedArrivalIso && (
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    ETA{' '}
                    {new Date(activeDriverStop.estimatedArrivalIso).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                )}
                {typeof activeDriverStop.legDistanceMeters === 'number' && (
                  <div className="text-xs text-slate-500">
                    {(activeDriverStop.legDistanceMeters / 1000).toFixed(1)} km ·{' '}
                    {Math.round((activeDriverStop.legDurationSeconds || 0) / 60)} min
                  </div>
                )}
                {(activeDriverStop.timeWindowStart || activeDriverStop.timeWindowEnd) && (
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    Janela: {activeDriverStop.timeWindowStart || '—'} às {activeDriverStop.timeWindowEnd || '—'}
                  </div>
                )}
              </div>
            </div>

            {/* External Navigation & Quick Driver Actions (48px touch targets) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <a
                href={buildExternalNavigationUrl('google_maps', activeDriverStop)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm px-3"
              >
                <Navigation className="w-4 h-4" />
                Google Maps
                <ExternalLink className="w-3.5 h-3.5 opacity-80" />
              </a>
              <a
                href={buildExternalNavigationUrl('waze', activeDriverStop)}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-sm px-3"
              >
                <Navigation className="w-4 h-4" />
                Waze
                <ExternalLink className="w-3.5 h-3.5 opacity-80" />
              </a>
              <button
                type="button"
                onClick={() => handleCopyAddress(`${activeDriverStop.address} - ${activeDriverStop.neighborhood}, ${activeDriverStop.city}`)}
                className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-sm px-3"
              >
                <Copy className="w-4 h-4" />
                Copiar endereço
              </button>
              <button
                type="button"
                onClick={() => navigate('packages', 'scanner')}
                className="min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-sm px-3"
              >
                <QrCode className="w-4 h-4" />
                Escanear
              </button>
            </div>

            {/* Individual Packages at this Stop (with Physical Cargo Zone!) */}
            <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Pacotes nesta parada ({activeDriverStop.packageIds.length})
                </h3>
                {activeDriverStop.packageIds.length > 1 &&
                  activeDriverStop.status !== 'completed' && (
                    <button
                      type="button"
                      onClick={() => setBatchConfirmStop(activeDriverStop)}
                      className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 text-xs font-semibold"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      Entregar todos desta parada
                    </button>
                  )}
              </div>

              <div className="space-y-3">
                {activeDriverStop.packageIds.map((pid) => {
                  const pkg = pkgMap[pid];
                  if (!pkg) return null;
                  const stInfo = PACKAGE_STATUS_LABEL[pkg.status];
                  const waUrl = buildWhatsAppUrl(
                    pkg.recipientPhone,
                    `Olá ${pkg.recipientName}, sou o entregador da sua encomenda ${pkg.trackingCode} (${pkg.platform}). Estou chegando ao endereço.`
                  );

                  return (
                    <div
                      key={pkg.id}
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/70 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono font-bold text-slate-900 dark:text-white">
                              {pkg.trackingCode}
                            </span>
                            <span className="text-slate-500">· {pkg.platform}</span>
                            <span className={`font-semibold ${stInfo.color}`}>· {stInfo.label}</span>
                          </div>
                          <div className="text-sm font-bold text-slate-900 dark:text-white">
                            {pkg.recipientName}
                          </div>
                          {pkg.normalizedAddress.complement && (
                            <div className="text-xs text-slate-600 dark:text-slate-300">
                              Complemento: <strong>{pkg.normalizedAddress.complement}</strong>
                            </div>
                          )}
                          {(pkg.normalizedAddress.referencePoint || pkg.observations || pkg.deliveryInstructions) && (
                            <div className="text-xs text-amber-800 dark:text-amber-300">
                              {[pkg.normalizedAddress.referencePoint, pkg.deliveryInstructions, pkg.observations]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          )}
                        </div>

                        {/* Physical Cargo Zone Display (Independent of sequence!) */}
                        <div className="rounded-lg bg-slate-900 dark:bg-slate-800 text-white px-3 py-1.5 text-center shrink-0">
                          <div className="text-[10px] uppercase tracking-wider text-slate-400">Zona de Carga</div>
                          <div className="text-sm font-bold tabular-nums">
                            {pkg.physicalLocationId ? `Zona ${pkg.physicalLocationId}` : 'Não alocada'}
                          </div>
                        </div>
                      </div>

                      {/* Contact + Individual Status Action Buttons */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {pkg.status !== 'delivered' && (
                          <button
                            type="button"
                            onClick={() => {
                              updatePackageStatus({
                                packageId: pkg.id,
                                newStatus: 'delivered',
                                notes: 'Entregue no Modo Motorista (controle interno).',
                                eventType: 'delivered',
                              });
                              pushToast('success', `Pacote ${pkg.trackingCode} marcado como entregue.`);
                            }}
                            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 text-xs font-bold whitespace-nowrap shrink-0"
                          >
                            <Check className="w-4 h-4" /> Entregue
                          </button>
                        )}
                        {pkg.status !== 'delivered' && (
                          <button
                            type="button"
                            onClick={() => setFailModalPkg(pkg)}
                            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white px-3.5 text-xs font-bold whitespace-nowrap shrink-0"
                          >
                            <XCircle className="w-4 h-4" /> Tentativa frustrada
                          </button>
                        )}
                        {pkg.status !== 'delivered' && pkg.status !== 'postponed' && (
                          <button
                            type="button"
                            onClick={() => {
                              updatePackageStatus({
                                packageId: pkg.id,
                                newStatus: 'postponed',
                                reason: 'Adiado pelo motorista em rota',
                                eventType: 'postponed',
                              });
                              pushToast('info', `Pacote ${pkg.trackingCode} adiado.`);
                            }}
                            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 px-3 text-xs font-semibold whitespace-nowrap shrink-0"
                          >
                            <Clock className="w-4 h-4" /> Adiar
                          </button>
                        )}
                        {pkg.recipientPhone && (
                          <a
                            href={`tel:${pkg.recipientPhone.replace(/\D/g, '')}`}
                            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                          >
                            <Phone className="w-3.5 h-3.5" /> Ligar
                          </a>
                        )}
                        {waUrl && (
                          <a
                            href={waUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 px-3 text-xs font-medium whitespace-nowrap shrink-0"
                          >
                            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Footer Stop Switcher */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                disabled={activeDriverStop.sequence <= 1}
                onClick={() => {
                  const prev = stops.find((s) => s.sequence === activeDriverStop.sequence - 1);
                  if (prev) setFocusedStopId(prev.id);
                }}
                className="min-h-[40px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 disabled:opacity-40 text-xs font-semibold"
              >
                ← Parada anterior
              </button>
              <button
                type="button"
                onClick={() => setFocusedStopId(null)}
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                Ir para próxima pendente
              </button>
              <button
                type="button"
                disabled={activeDriverStop.sequence >= stops.length}
                onClick={() => {
                  const next = stops.find((s) => s.sequence === activeDriverStop.sequence + 1);
                  if (next) setFocusedStopId(next.id);
                }}
                className="min-h-[40px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 disabled:opacity-40 text-xs font-semibold"
              >
                Pular / Próxima →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: INTERACTIVE OPERATIONAL MAP */}
      {activeRoute && currentTab === 'map' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Toque em qualquer marcador para abrir navegação ou selecione uma parada para corrigir o pino no portão exato.
            </p>
            <div className="flex items-center gap-2">
              <select
                value={pinEditStopId || ''}
                onChange={(e) => setPinEditStopId(e.target.value || null)}
                className="min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
              >
                <option value="">Corrigir pino de uma parada...</option>
                {stops.map((s) => (
                  <option key={s.id} value={s.id}>
                    #{s.sequence} — {s.address}
                  </option>
                ))}
              </select>
              {pinEditStopId && (
                <button
                  type="button"
                  onClick={() => setPinEditStopId(null)}
                  className="text-xs text-purple-600 font-semibold hover:underline"
                >
                  Concluir ajuste
                </button>
              )}
            </div>
          </div>

          <InteractiveMap
            origin={activeRoute.origin}
            stops={stops}
            nextStopId={nextStop?.id}
            editablePinStopId={pinEditStopId}
            onConfirmPinMove={(stopId, coords) => {
              const targetStop = stops.find((s) => s.id === stopId);
              if (!targetStop) return;
              targetStop.packageIds.forEach((pid) => {
                updatePackageAddressAndCoords({
                  packageId: pid,
                  coordinates: coords,
                  source: 'manual_pin',
                  confidence: 'confirmed',
                });
              });
              setPinEditStopId(null);
            }}
            onNavigateToDriverStop={(stopId) => {
              setFocusedStopId(stopId);
              navigate('routes', 'driver_mode');
            }}
          />
        </div>
      )}

      {/* TAB 3: FULL STOPS LIST */}
      {activeRoute && currentTab === 'stops_list' && (
        <div className="space-y-2.5">
          {stops.map((stop) => (
            <div
              key={stop.id}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                  <span className="tabular-nums text-blue-600 dark:text-blue-400">#{stop.sequence}</span>
                  <span className="text-slate-900 dark:text-white truncate">{stop.address}</span>
                  <span className="text-slate-500 font-normal">· {stop.packageIds.length} pct</span>
                  <span className="text-slate-500 font-normal uppercase">· {stop.status}</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {stop.neighborhood}
                  {stop.complementSummary ? ` · ${stop.complementSummary}` : ''}
                  {stop.estimatedArrivalIso
                    ? ` · ETA ${new Date(stop.estimatedArrivalIso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setFocusedStopId(stop.id);
                    navigate('routes', 'driver_mode');
                  }}
                  className="min-h-[36px] px-3 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold"
                >
                  Abrir
                </button>
                <button
                  type="button"
                  onClick={() => reorderStopManually(stop.id, 'pin_next')}
                  title="Fixar como próxima entrega"
                  className="min-h-[36px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
                >
                  <PinIcon className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => reorderStopManually(stop.id, 'up')}
                  title="Mover acima"
                  className="min-h-[36px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => reorderStopManually(stop.id, 'down')}
                  title="Mover abaixo"
                  className="min-h-[36px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                {stop.packageIds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => splitRouteStop(stop.id)}
                    title="Desagrupar parada"
                    className="min-h-[36px] px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs"
                  >
                    <Split className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 4: DYNAMIC REOPTIMIZATION & SECOND ATTEMPT INTELLIGENCE */}
      {activeRoute && currentTab === 'reoptimize' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Dynamic Reoptimization */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Reotimização Dinâmica das Paradas Restantes
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Recalcula apenas as {remainingStops.length} paradas ainda pendentes mantendo entregas concluídas intactas e <strong>sem alterar a zona física dos pacotes no veículo</strong>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={reoptStrategy}
                onChange={(e) => setReoptStrategy(e.target.value as OptimizationStrategy)}
                className="min-h-[42px] flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
              >
                <option value="balanced">Equilibrada</option>
                <option value="fastest">Mais rápida</option>
                <option value="economic">Mais econômica</option>
                <option value="time_window">Prioridade e Janelas</option>
              </select>
              <button
                type="button"
                onClick={() => void handleSimulateReopt()}
                disabled={reoptBusy}
                className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 text-sm font-semibold whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-4 h-4 ${reoptBusy ? 'animate-spin' : ''}`} />
                Simular ganho
              </button>
            </div>

            {reoptPreview && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 p-4 space-y-3">
                <div className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                  Comparativo Antes × Depois (Requer sua confirmação)
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs tabular-nums">
                  <div>
                    <div className="text-slate-500">Restante atual</div>
                    <div className="text-base font-bold text-slate-900 dark:text-white">
                      {(reoptPreview.previousDistanceMeters / 1000).toFixed(1)} km ·{' '}
                      {Math.round(reoptPreview.previousDurationSeconds / 60)} min
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500">Nova sequência (v{reoptPreview.version.version})</div>
                    <div className="text-base font-bold text-emerald-700 dark:text-emerald-400">
                      {(reoptPreview.newDistanceMeters / 1000).toFixed(1)} km ·{' '}
                      {Math.round(reoptPreview.newDurationSeconds / 60)} min
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleApplyReopt}
                    className="min-h-[40px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                  >
                    Confirmar e aplicar nova versão
                  </button>
                  <button
                    type="button"
                    onClick={() => setReoptPreview(null)}
                    className="min-h-[40px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium"
                  >
                    Descartar
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Second Attempt Intelligence */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Inteligência de Segunda Tentativa ({secondAttemptSuggestions.length})
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Avalia o desvio geométrico estimado para encaixar pacotes com tentativa frustrada no restante da rota. Nunca altera a rota sem sua aprovação.
              </p>
            </div>

            {secondAttemptSuggestions.length === 0 ? (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 text-xs text-slate-500">
                Nenhuma tentativa frustrada pendente de encaixe nesta rota.
              </div>
            ) : (
              <div className="space-y-3">
                {secondAttemptSuggestions.map((sug) => (
                  <div
                    key={sug.packageId}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-bold text-slate-900 dark:text-white">{sug.trackingCode}</span>
                      <span
                        className={`font-semibold tabular-nums ${
                          sug.feasible ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        +{(sug.detourMeters / 1000).toFixed(1)} km · +{sug.detourMinutes} min
                      </span>
                    </div>
                    <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                      {sug.recipientName} — {sug.address}
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">{sug.explanation}</p>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() =>
                          recalculateSecondAttemptInsertion(sug.packageId, sug.insertAfterStopSequence)
                        }
                        className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white px-3 text-xs font-semibold"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Encaixar após parada #{sug.insertAfterStopSequence}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: ROUTE HISTORY & VERSIONS */}
      {currentTab === 'history' && (
        <div className="space-y-3">
          {routes.length === 0 ? (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center text-sm text-slate-500">
              Nenhuma rota salva no histórico ainda.
            </div>
          ) : (
            routes.map((r) => {
              const ver = r.versions.find((v) => v.version === r.activeVersion) || r.versions[r.versions.length - 1];
              const isCurrent = r.id === activeRoute?.id;
              return (
                <div
                  key={r.id}
                  className={`rounded-xl border p-4 flex flex-wrap items-center justify-between gap-3 ${
                    isCurrent
                      ? 'border-blue-600 bg-blue-50/40 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{r.name}</span>
                      <span className="text-xs font-semibold uppercase text-slate-500">
                        · {r.status} · v{r.activeVersion} ({r.versions.length} versões)
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                      {ver ? `${ver.metrics.totalStops} paradas · ${(ver.metrics.totalDistanceMeters / 1000).toFixed(1)} km` : ''}
                      {r.recordedDistanceKm ? ` · Odômetro real: ${r.recordedDistanceKm} km` : ''}
                      {` · Criada em ${new Date(r.createdAt).toLocaleString('pt-BR')}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveRouteId(r.id);
                      navigate('routes', 'driver_mode');
                    }}
                    className="min-h-[38px] px-3.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold"
                  >
                    {isCurrent ? 'Abrir ativa' : 'Selecionar rota'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* FAILED ATTEMPT MODAL */}
      {failModalPkg && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setFailModalPkg(null)}
        >
          <form
            onSubmit={handleConfirmFail}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl"
          >
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Registrar Tentativa Frustrada
              </h3>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{failModalPkg.trackingCode}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Motivo *</label>
              <select
                value={failReason}
                onChange={(e) => setFailReason(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
              >
                {FAILURE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Horário sugerido para 2ª tentativa (opcional)
              </label>
              <input
                type="time"
                value={failRetryTime}
                onChange={(e) => setFailRetryTime(e.target.value)}
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Observações</label>
              <textarea
                rows={2}
                value={failNotes}
                onChange={(e) => setFailNotes(e.target.value)}
                placeholder="Ex.: Porteiro informou retorno após 16h..."
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-sm"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setFailModalPkg(null)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold"
              >
                Confirmar ocorrência
              </button>
            </div>
          </form>
        </div>
      )}

      {/* BATCH DELIVERY CONFIRMATION MODAL */}
      {batchConfirmStop && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setBatchConfirmStop(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Confirmar entrega em lote?
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Todos os pacotes pendentes da parada <strong>#{batchConfirmStop.sequence} ({batchConfirmStop.address})</strong> serão marcados como entregues no controle interno do Rota Express.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setBatchConfirmStop(null)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  markStopDeliveredBatch(batchConfirmStop.id);
                  setBatchConfirmStop(null);
                }}
                className="min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                Confirmar todos
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FINISH ROUTE MODAL */}
      {showFinishModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setShowFinishModal(false)}
        >
          <form
            onSubmit={handleConfirmFinish}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-xl"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Encerrar Rota Ativa</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Opcionalmente, informe a quilometragem real percorrida no odômetro do veículo para apuração financeira mais precisa.
            </p>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Distância real percorrida (km) — opcional
              </label>
              <input
                type="text"
                inputMode="decimal"
                value={odometerKm}
                onChange={(e) => setOdometerKm(e.target.value)}
                placeholder="Ex.: 48,5"
                className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowFinishModal(false)}
                className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
              >
                Encerrar rota
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
