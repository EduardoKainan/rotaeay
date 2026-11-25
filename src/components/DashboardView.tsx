import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Fuel,
  History,
  MapPin,
  Navigation,
  Package,
  Plus,
  QrCode,
  RefreshCw,
  Route as RouteIcon,
  TrendingUp,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { computeFinancialSummary, formatBRL } from '../domain/financial';

function formatDurationPt(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0 min';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.round((totalSeconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}min` : `${m} min`;
}

export function DashboardView() {
  const routes = useAppStore((s) => s.routes);
  const activeRouteId = useAppStore((s) => s.activeRouteId);
  const packages = useAppStore((s) => s.packages);
  const vehicles = useAppStore((s) => s.vehicles);
  const financialEntries = useAppStore((s) => s.financialEntries);
  const isDemoMode = useAppStore((s) => s.isDemoMode);
  const navigate = useAppStore((s) => s.navigate);
  const resetDemoMode = useAppStore((s) => s.resetDemoMode);
  const addManualPackage = useAppStore((s) => s.addManualPackage);

  const [showManualModal, setShowManualModal] = useState(false);
  const [manualTracking, setManualTracking] = useState('');
  const [manualRecipient, setManualRecipient] = useState('');
  const [manualPhone, setManualPhone] = useState('');
  const [manualAddress, setManualAddress] = useState('');
  const [manualNeighborhood, setManualNeighborhood] = useState('');
  const [manualPlatform, setManualPlatform] = useState('Shopee');

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

  const originalVersion = useMemo(() => {
    if (!activeRoute) return null;
    return activeRoute.versions.find((v) => v.strategy === 'original') || null;
  }, [activeRoute]);

  const routePackages = useMemo(() => {
    if (!activeRoute) return packages;
    return packages.filter((p) => p.routeId === activeRoute.id);
  }, [packages, activeRoute]);

  const activeVehicle = useMemo(
    () => vehicles.find((v) => v.id === activeRoute?.vehicleId) || vehicles[0],
    [vehicles, activeRoute]
  );

  const stats = useMemo(() => {
    const total = routePackages.length;
    const delivered = routePackages.filter((p) => p.status === 'delivered').length;
    const failed = routePackages.filter((p) => p.status === 'failed_attempt').length;
    const postponed = routePackages.filter((p) => p.status === 'postponed').length;
    const pending = routePackages.filter((p) => ['pending', 'loaded', 'in_transit'].includes(p.status)).length;
    const completionPct = total > 0 ? Math.round((delivered / total) * 100) : 0;

    const stops = activeVersion?.stops || [];
    const remainingStops = stops.filter(
      (s) => s.status === 'pending' || s.status === 'in_progress' || s.status === 'partial'
    );
    const remainingDistanceMeters = remainingStops.reduce((sum, s) => sum + (s.legDistanceMeters || 0), 0);
    const remainingDurationSeconds = remainingStops.reduce(
      (sum, s) => sum + (s.legDurationSeconds || 0) + s.serviceDurationSeconds,
      0
    );

    const plannedDistanceKm = (activeVersion?.metrics.totalDistanceMeters || 0) / 1000;
    const origDistanceKm = originalVersion ? originalVersion.metrics.totalDistanceMeters / 1000 : null;
    const savedKm =
      origDistanceKm && origDistanceKm > plannedDistanceKm
        ? Number((origDistanceKm - plannedDistanceKm).toFixed(1))
        : null;
    const savedPct =
      savedKm && origDistanceKm && origDistanceKm > 0
        ? Number(((savedKm / origDistanceKm) * 100).toFixed(1))
        : null;

    return {
      total,
      stopsCount: stops.length,
      delivered,
      pending,
      failed,
      postponed,
      completionPct,
      plannedDistanceKm,
      remainingDistanceKm: remainingDistanceMeters / 1000,
      recordedDistanceKm: activeRoute?.recordedDistanceKm ?? null,
      remainingDurationSeconds,
      estimatedFinishIso: activeVersion?.metrics.estimatedFinishIso || null,
      isRoadReal: activeVersion?.metrics.isRoadDistanceReal ?? false,
      savedKm,
      savedPct,
      nextStop: remainingStops[0] || null,
    };
  }, [routePackages, activeVersion, originalVersion, activeRoute]);

  const financial = useMemo(
    () =>
      computeFinancialSummary({
        entries: activeRoute
          ? financialEntries.filter((e) => !e.routeId || e.routeId === activeRoute.id)
          : financialEntries,
        routes: activeRoute ? [activeRoute] : routes,
        packages: routePackages,
        vehicle: activeVehicle,
        referenceDistanceMeters: originalVersion?.metrics.totalDistanceMeters,
      }),
    [financialEntries, activeRoute, routes, routePackages, activeVehicle, originalVersion]
  );

  const handleSaveManual = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualAddress.trim()) return;
    addManualPackage({
      trackingCode: manualTracking,
      recipientName: manualRecipient,
      recipientPhone: manualPhone,
      address: manualAddress,
      neighborhood: manualNeighborhood,
      platform: manualPlatform,
      priority: 'normal',
      addToActiveRoute: Boolean(activeRoute),
    });
    setManualTracking('');
    setManualRecipient('');
    setManualPhone('');
    setManualAddress('');
    setManualNeighborhood('');
    setShowManualModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Painel Operacional
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {activeRoute
              ? `${activeRoute.name} · v${activeRoute.activeVersion} · ${
                  stats.isRoadReal ? 'Distância rodoviária real' : 'Estimativa geométrica local'
                }`
              : 'Importe uma planilha XLSX/CSV ou inicie uma nova rota para começar.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('routes', 'new_route')}
            className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm px-4 whitespace-nowrap shrink-0 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Importar planilha / Nova rota
          </button>
          {activeRoute && (
            <button
              type="button"
              onClick={() => navigate('routes', 'driver_mode')}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-semibold text-sm px-4 whitespace-nowrap shrink-0 transition-colors"
            >
              <Navigation className="w-4 h-4" />
              Continuar rota ativa
            </button>
          )}
        </div>
      </div>

      {/* Demo Dataset Switcher (only shown in Demo Mode) */}
      {isDemoMode && (
        <div className="rounded-xl border border-orange-200 dark:border-orange-900/70 bg-orange-50/70 dark:bg-orange-950/30 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-orange-950 dark:text-orange-200">
            <strong className="font-semibold">Cenário Demonstração Goiânia:</strong> alterne o volume para validar desempenho e escalabilidade (10, 50, 150 ou 500 pacotes fictícios).
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {([10, 50, 150, 500] as const).map((sz) => (
              <button
                key={sz}
                type="button"
                onClick={() => void resetDemoMode(sz)}
                className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap shrink-0 ${
                  routePackages.length === sz
                    ? 'bg-orange-600 text-white border-orange-600'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-orange-100 dark:hover:bg-slate-800'
                }`}
              >
                {sz} pacotes
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Progresso de Entregas</span>
            <Package className="w-4 h-4 text-blue-600" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
              {stats.delivered}/{stats.total}
            </span>
            <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {stats.completionPct}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${stats.completionPct}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            {stats.stopsCount} paradas · {stats.pending} pend. · {stats.failed} falhas · {stats.postponed} adiadas
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Distância & Economia</span>
            <RouteIcon className="w-4 h-4 text-sky-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {stats.plannedDistanceKm.toFixed(1)} km
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Restante: {stats.remainingDistanceKm.toFixed(1)} km
            {stats.recordedDistanceKm !== null ? ` · Reg.: ${stats.recordedDistanceKm.toFixed(1)} km` : ''}
          </p>
          <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 tabular-nums">
            {stats.savedKm !== null
              ? `Economia vs original: -${stats.savedKm} km (-${stats.savedPct}%)`
              : 'Sem sequência original de referência'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Tempo & Término Previsto</span>
            <Clock className="w-4 h-4 text-orange-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {stats.estimatedFinishIso
              ? new Date(stats.estimatedFinishIso).toLocaleTimeString('pt-BR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Restante: {formatDurationPt(stats.remainingDurationSeconds)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Combustível est.: {financial.estimatedFuelLiters.toFixed(1)} L ({formatBRL(financial.estimatedFuelCost)})
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Resultado Operacional</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </div>
          <div
            className={`text-2xl font-bold tabular-nums ${
              financial.operationalResult >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-red-600 dark:text-red-400'
            }`}
          >
            {formatBRL(financial.operationalResult)}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Receita: {formatBRL(financial.grossRevenue)} · Desp.: {formatBRL(financial.applicableOperationalExpenses)}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
            Ganho/h: {formatBRL(financial.profitPerHour)} · Ganho/km: {formatBRL(financial.profitPerKm)}
          </p>
        </div>
      </div>

      {/* Next Delivery Highlight Card + Quick Operational Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                Próxima Parada em Fila
              </span>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white mt-0.5">
                {stats.nextStop
                  ? `Parada #${stats.nextStop.sequence} · ${stats.nextStop.address}`
                  : activeRoute
                    ? 'Todas as paradas da rota ativa foram tratadas'
                    : 'Nenhuma rota ativa no momento'}
              </h2>
            </div>
            {stats.nextStop && (
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                {stats.nextStop.packageIds.length} pacote(s)
              </span>
            )}
          </div>

          {stats.nextStop ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                {stats.nextStop.neighborhood}
                {stats.nextStop.city ? `, ${stats.nextStop.city}` : ''}
                {stats.nextStop.complementSummary ? ` · ${stats.nextStop.complementSummary}` : ''}
              </p>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {stats.nextStop.estimatedArrivalIso && (
                  <span>
                    ETA:{' '}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {new Date(stats.nextStop.estimatedArrivalIso).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </strong>
                  </span>
                )}
                {typeof stats.nextStop.legDistanceMeters === 'number' && (
                  <span>
                    Trecho:{' '}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {(stats.nextStop.legDistanceMeters / 1000).toFixed(1)} km
                    </strong>
                  </span>
                )}
                <span>
                  Prioridade:{' '}
                  <strong className="text-slate-800 dark:text-slate-200 uppercase">
                    {stats.nextStop.priority}
                  </strong>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => navigate('routes', 'driver_mode')}
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-semibold text-sm px-4 whitespace-nowrap shrink-0"
                >
                  Abrir Modo Motorista
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => navigate('routes', 'map')}
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium text-sm px-4 whitespace-nowrap shrink-0"
                >
                  <MapPin className="w-4 h-4 text-blue-600" />
                  Ver no Mapa
                </button>
                <button
                  type="button"
                  onClick={() => navigate('packages', 'loading')}
                  className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 font-medium text-sm px-4 whitespace-nowrap shrink-0"
                >
                  <Package className="w-4 h-4 text-orange-500" />
                  Zonas de Carga
                </button>
              </div>
            </div>
          ) : (
            <div className="pt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate('routes', 'new_route')}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm px-4"
              >
                <Plus className="w-4 h-4" />
                Criar Nova Rota
              </button>
              <button
                type="button"
                onClick={() => setShowManualModal(true)}
                className="min-h-[44px] inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 font-medium text-sm px-4"
              >
                Adicionar Entrega Manual
              </button>
            </div>
          )}
        </div>

        {/* Operational Quick Actions */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Ações Rápidas</h3>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => navigate('packages', 'scanner')}
              className="min-h-[52px] flex flex-col items-start justify-center gap-1 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 p-3 text-left transition-colors"
            >
              <QrCode className="w-4 h-4 text-blue-600" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">Escanear pacote</span>
            </button>
            <button
              type="button"
              onClick={() => setShowManualModal(true)}
              className="min-h-[52px] flex flex-col items-start justify-center gap-1 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 p-3 text-left transition-colors"
            >
              <Plus className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">Entrega manual</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('routes', 'history')}
              className="min-h-[52px] flex flex-col items-start justify-center gap-1 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 p-3 text-left transition-colors"
            >
              <History className="w-4 h-4 text-slate-600 dark:text-slate-300" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">Histórico ({routes.length})</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('financial', 'financial_overview')}
              className="min-h-[52px] flex flex-col items-start justify-center gap-1 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 p-3 text-left transition-colors"
            >
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">Financeiro</span>
            </button>
          </div>
          {activeVehicle && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1.5 truncate">
                <Fuel className="w-3.5 h-3.5 shrink-0" />
                {activeVehicle.name}
              </span>
              <span className="tabular-nums shrink-0">{activeVehicle.consumptionKmPerLiter} km/L</span>
            </div>
          )}
        </div>
      </div>

      {/* Add Manual Delivery Modal */}
      {showManualModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setShowManualModal(false)}
        >
          <form
            onSubmit={handleSaveManual}
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-5 space-y-3.5 shadow-xl"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Nova Entrega Manual</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Rastreio</label>
                <input
                  type="text"
                  value={manualTracking}
                  onChange={(e) => setManualTracking(e.target.value)}
                  placeholder="Opcional"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Plataforma</label>
                <select
                  value={manualPlatform}
                  onChange={(e) => setManualPlatform(e.target.value)}
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                >
                  <option>Shopee</option>
                  <option>Mercado Livre</option>
                  <option>Amazon</option>
                  <option>Transportadora</option>
                  <option>Particular</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Destinatário</label>
              <input
                type="text"
                required
                value={manualRecipient}
                onChange={(e) => setManualRecipient(e.target.value)}
                placeholder="Nome completo"
                className="w-full min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Endereço completo *
              </label>
              <input
                type="text"
                required
                value={manualAddress}
                onChange={(e) => setManualAddress(e.target.value)}
                placeholder="Ex.: Avenida T-63, 1240 - Setor Bueno, Goiânia - GO"
                className="w-full min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Bairro</label>
                <input
                  type="text"
                  value={manualNeighborhood}
                  onChange={(e) => setManualNeighborhood(e.target.value)}
                  placeholder="Ex.: Setor Bueno"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Telefone</label>
                <input
                  type="text"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  placeholder="(62) 99999-0000"
                  className="w-full min-h-[42px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="min-h-[42px] px-4 rounded-lg border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="min-h-[42px] px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
              >
                Salvar entrega
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
