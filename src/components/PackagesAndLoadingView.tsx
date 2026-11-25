import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { BrowserMultiFormatReader } from '@zxing/browser';
import {
  AlertTriangle,
  Box,
  Camera,
  CameraOff,
  CheckCircle2,
  Download,
  Package,
  Plus,
  Printer,
  QrCode,
  Search,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { DEFAULT_CARGO_ZONES } from '../domain/demoData';
import { exportSafeSpreadsheet } from '../domain/spreadsheet';
import { DeliveryPackage, PackageStatus } from '../types/domain';
import { useAppStore } from '../store/useAppStore';

function playScanBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch {
    // Ignore audio blocked
  }
}

export function PackagesAndLoadingView() {
  const routes = useAppStore((s) => s.routes);
  const activeRouteId = useAppStore((s) => s.activeRouteId);
  const packages = useAppStore((s) => s.packages);
  const vehicles = useAppStore((s) => s.vehicles);
  const subView = useAppStore((s) => s.subView);
  const navigate = useAppStore((s) => s.navigate);
  const assignCargoZone = useAppStore((s) => s.assignCargoZone);
  const autoSuggestCargoZones = useAppStore((s) => s.autoSuggestCargoZones);
  const updatePackageStatus = useAppStore((s) => s.updatePackageStatus);
  const addCargoZoneToVehicle = useAppStore((s) => s.addCargoZoneToVehicle);
  const pushToast = useAppStore((s) => s.pushToast);

  const currentTab =
    subView === 'loading' ? 'loading' : subView === 'scanner' ? 'scanner' : 'packages_list';

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

  const activeVehicle = useMemo(
    () => vehicles.find((v) => v.id === activeRoute?.vehicleId) || vehicles[0],
    [vehicles, activeRoute]
  );

  const cargoZones = activeVehicle?.compartments?.length ? activeVehicle.compartments : DEFAULT_CARGO_ZONES;

  const routePackages = useMemo(() => {
    if (!activeRoute) return packages;
    return packages.filter((p) => p.routeId === activeRoute.id);
  }, [packages, activeRoute]);

  const stopSeqByPkgId = useMemo(() => {
    const m: Record<string, number> = {};
    if (activeVersion) {
      for (const s of activeVersion.stops) {
        for (const pid of s.packageIds) m[pid] = s.sequence;
      }
    }
    return m;
  }, [activeVersion]);

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [zoneFilter, setZoneFilter] = useState<string>('all');

  // Custom zone state
  const [newZoneCode, setNewZoneCode] = useState('');
  const [newZoneName, setNewZoneName] = useState('');

  // QR label modal state
  const [qrLabels, setQrLabels] = useState<Array<{ code: string; stopSeq: number | null; zone: string; recipient: string; dataUrl: string }>>([]);
  const [showQrModal, setShowQrModal] = useState(false);

  // Scanner state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [beepEnabled, setBeepEnabled] = useState(true);
  const [manualScanCode, setManualScanCode] = useState('');
  const [scannedResult, setScannedResult] = useState<{
    code: string;
    pkg: DeliveryPackage | null;
    stopSeq: number | null;
  } | null>(null);

  useEffect(() => {
    return () => {
      controlsRef.current?.stop();
    };
  }, []);

  const filteredPackages = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return routePackages.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false;
      if (zoneFilter !== 'all' && (p.physicalLocationId || 'none') !== zoneFilter) return false;
      if (!q) return true;
      return (
        p.trackingCode.toLowerCase().includes(q) ||
        (p.barcode || '').toLowerCase().includes(q) ||
        p.recipientName.toLowerCase().includes(q) ||
        p.normalizedAddress.formatted.toLowerCase().includes(q) ||
        p.normalizedAddress.neighborhood.toLowerCase().includes(q)
      );
    });
  }, [routePackages, searchQuery, statusFilter, zoneFilter]);

  const handleLookupScannedCode = (rawCode: string) => {
    const clean = rawCode.trim();
    if (!clean) return;
    if (beepEnabled) playScanBeep();
    const q = clean.toLowerCase();
    const match = routePackages.find(
      (p) =>
        p.trackingCode.toLowerCase() === q ||
        (p.barcode || '').toLowerCase() === q ||
        p.trackingCode.toLowerCase().includes(q) ||
        (p.orderId || '').toLowerCase() === q
    );
    setScannedResult({
      code: clean,
      pkg: match || null,
      stopSeq: match ? stopSeqByPkgId[match.id] ?? null : null,
    });
  };

  const startCameraScanner = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Câmera não disponível neste navegador. Use a digitação manual abaixo.');
      return;
    }
    try {
      setCameraActive(true);
      const reader = new BrowserMultiFormatReader();
      const videoEl = videoRef.current;
      if (!videoEl) return;
      const controls = await reader.decodeFromVideoDevice(undefined, videoEl, (result) => {
        if (result) {
          handleLookupScannedCode(result.getText());
        }
      });
      controlsRef.current = controls;
    } catch (err) {
      setCameraActive(false);
      setCameraError(
        err instanceof Error
          ? `Não foi possível acessar a câmera (${err.message}). Utilize a entrada manual abaixo.`
          : 'Permissão de câmera negada ou indisponível.'
      );
    }
  };

  const stopCameraScanner = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraActive(false);
  };

  const handleGenerateQrLabels = async () => {
    const sample = routePackages.slice(0, 24);
    const items = await Promise.all(
      sample.map(async (p) => {
        const payload = JSON.stringify({
          rastreio: p.trackingCode,
          zona: p.physicalLocationId || 'N/A',
          parada: stopSeqByPkgId[p.id] ?? null,
        });
        const dataUrl = await QRCode.toDataURL(payload, { width: 120, margin: 1 });
        return {
          code: p.trackingCode,
          stopSeq: stopSeqByPkgId[p.id] ?? null,
          zone: p.physicalLocationId || 'Sem zona',
          recipient: p.recipientName,
          dataUrl,
        };
      })
    );
    setQrLabels(items);
    setShowQrModal(true);
  };

  const handleExportLoadingManifest = (format: 'csv' | 'xlsx') => {
    const rows = routePackages
      .slice()
      .sort((a, b) => (stopSeqByPkgId[b.id] || 0) - (stopSeqByPkgId[a.id] || 0))
      .map((p) => ({
        Ordem_Carregamento: stopSeqByPkgId[p.id] ? `Parada #${stopSeqByPkgId[p.id]}` : 'Sem parada',
        Zona_Fisica: p.physicalLocationId ? `Zona ${p.physicalLocationId}` : 'Não atribuída',
        Rastreio: p.trackingCode,
        Destinatario: p.recipientName,
        Endereco: p.normalizedAddress.formatted,
        Peso_Kg: p.weightKg ?? '',
        Fragil: p.isFragile ? 'Sim' : 'Não',
        Status: p.status,
      }));
    exportSafeSpreadsheet(rows, `lista_carregamento_rota_express.${format}`, format);
    pushToast('success', `Lista de carregamento exportada (${format.toUpperCase()}).`);
  };

  const handleAddCustomZone = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVehicle || !newZoneCode.trim() || !newZoneName.trim()) return;
    addCargoZoneToVehicle(activeVehicle.id, {
      id: newZoneCode.trim().toUpperCase().slice(0, 8),
      name: newZoneName.trim(),
      description: 'Compartimento personalizado',
      color: '#0EA5E9',
    });
    setNewZoneCode('');
    setNewZoneName('');
    pushToast('success', 'Nova zona/caixa de carga adicionada ao veículo.');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Pacotes, Carga & Scanner</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Controle individual de pacotes, organização física por zonas (independente de reotimizações) e leitor de etiquetas.
          </p>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800">
        {[
          { id: 'packages_list', label: `Pacotes (${routePackages.length})`, icon: Package },
          { id: 'loading', label: 'Organização de Carga (Smart Loading)', icon: Box },
          { id: 'scanner', label: 'Scanner de Etiquetas', icon: QrCode },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate('packages', tab.id as typeof subView)}
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

      {/* TAB 1: PACKAGES LIST */}
      {currentTab === 'packages_list' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar rastreio, destinatário, bairro ou endereço..."
                className="w-full min-h-[40px] pl-9 pr-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
            >
              <option value="all">Todos status</option>
              <option value="pending">Pendente</option>
              <option value="loaded">Carregado</option>
              <option value="delivered">Entregue</option>
              <option value="failed_attempt">Tentativa frustrada</option>
              <option value="postponed">Adiado</option>
            </select>
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
            >
              <option value="all">Todas zonas</option>
              {cargoZones.map((z) => (
                <option key={z.id} value={z.id}>
                  Zona {z.id} — {z.name}
                </option>
              ))}
              <option value="none">Sem zona atribuída</option>
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2.5">Parada</th>
                  <th className="px-3 py-2.5">Rastreio / Plataforma</th>
                  <th className="px-3 py-2.5">Destinatário & Endereço</th>
                  <th className="px-3 py-2.5">Zona Física</th>
                  <th className="px-3 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredPackages.slice(0, 120).map((pkg) => (
                  <tr key={pkg.id}>
                    <td className="px-3 py-2.5 font-bold tabular-nums whitespace-nowrap">
                      {stopSeqByPkgId[pkg.id] ? `#${stopSeqByPkgId[pkg.id]}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="font-mono font-semibold text-slate-900 dark:text-white">{pkg.trackingCode}</div>
                      <div className="text-[11px] text-slate-500">{pkg.platform}</div>
                    </td>
                    <td className="px-3 py-2.5 max-w-[280px]">
                      <div className="font-medium text-slate-900 dark:text-white truncate">{pkg.recipientName}</div>
                      <div className="text-[11px] text-slate-500 truncate">{pkg.normalizedAddress.formatted}</div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <select
                        value={pkg.physicalLocationId || ''}
                        onChange={(e) => assignCargoZone(pkg.id, e.target.value || undefined)}
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                      >
                        <option value="">Sem zona</option>
                        {cargoZones.map((z) => (
                          <option key={z.id} value={z.id}>
                            Zona {z.id}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <select
                        value={pkg.status}
                        onChange={(e) =>
                          updatePackageStatus({
                            packageId: pkg.id,
                            newStatus: e.target.value as PackageStatus,
                          })
                        }
                        className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                      >
                        <option value="pending">Pendente</option>
                        <option value="loaded">Carregado</option>
                        <option value="in_transit">Em rota</option>
                        <option value="delivered">Entregue</option>
                        <option value="failed_attempt">Tentativa frustrada</option>
                        <option value="postponed">Adiado</option>
                        <option value="return_required">Retorno ao CD</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: SMART LOADING (PHYSICAL CARGO ZONES) */}
      {currentTab === 'loading' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-blue-200 dark:border-blue-900/70 bg-blue-50/70 dark:bg-blue-950/30 p-4 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-blue-950 dark:text-blue-200 max-w-2xl leading-relaxed">
              <strong>Independência de Carga Física:</strong> a zona onde você coloca cada pacote no veículo (A, B, C, D ou caixas personalizadas) é armazenada de forma independente da sequência da rota. Reotimizar entregas depois <strong>nunca apaga</strong> onde o pacote foi guardado. Auxílio operacional — respeite limites físicos e segurança do veículo.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => autoSuggestCargoZones()}
                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-3.5 text-xs font-semibold whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-4 h-4" />
                Sugerir por ordem reversa
              </button>
              <button
                type="button"
                onClick={() => void handleGenerateQrLabels()}
                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-semibold whitespace-nowrap shrink-0"
              >
                <QrCode className="w-4 h-4" /> Etiquetas QR
              </button>
              <button
                type="button"
                onClick={() => handleExportLoadingManifest('xlsx')}
                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-semibold whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4" /> Lista XLSX
              </button>
            </div>
          </div>

          {/* Zone Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {cargoZones.map((zone) => {
              const zonePkgs = routePackages
                .filter((p) => p.physicalLocationId === zone.id)
                .sort((a, b) => (stopSeqByPkgId[a.id] || 999) - (stopSeqByPkgId[b.id] || 999));
              const totalKg = zonePkgs.reduce((sum, p) => sum + (p.weightKg || 0), 0);

              return (
                <div
                  key={zone.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        Zona {zone.id} · {zone.name}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">{zone.description}</p>
                    </div>
                    <span className="text-xs font-bold tabular-nums text-blue-600 dark:text-blue-400 shrink-0">
                      {zonePkgs.length} pct
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    Peso estimado: {totalKg.toFixed(1)} kg
                  </div>
                  <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                    {zonePkgs.length === 0 ? (
                      <p className="text-xs text-slate-400 italic py-2">Nenhum pacote nesta zona.</p>
                    ) : (
                      zonePkgs.map((p) => (
                        <div
                          key={p.id}
                          className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2 text-[11px] flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-mono font-semibold text-slate-900 dark:text-white truncate">
                              {stopSeqByPkgId[p.id] ? `#${stopSeqByPkgId[p.id]} · ` : ''}
                              {p.trackingCode}
                            </div>
                            <div className="text-slate-500 truncate">
                              {p.recipientName}
                              {p.isFragile ? ' · Frágil' : ''}
                            </div>
                          </div>
                          <select
                            aria-label={`Mover ${p.trackingCode} de zona`}
                            value={p.physicalLocationId || ''}
                            onChange={(e) => assignCargoZone(p.id, e.target.value || undefined)}
                            className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-1.5 py-0.5 text-[11px]"
                          >
                            {cargoZones.map((zOpt) => (
                              <option key={zOpt.id} value={zOpt.id}>
                                {zOpt.id}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Add Custom Compartment / Box / Bag */}
          <form
            onSubmit={handleAddCustomZone}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-end gap-3"
          >
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Código da Zona/Caixa</label>
              <input
                type="text"
                value={newZoneCode}
                onChange={(e) => setNewZoneCode(e.target.value)}
                placeholder="Ex.: BAG1"
                className="min-h-[40px] w-32 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Descrição do compartimento</label>
              <input
                type="text"
                value={newZoneName}
                onChange={(e) => setNewZoneName(e.target.value)}
                placeholder="Ex.: Bag Térmica / Caixa Pequenos Pacotes"
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
              />
            </div>
            <button
              type="submit"
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 text-xs font-semibold whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar compartimento
            </button>
          </form>
        </div>
      )}

      {/* TAB 3: BARCODE / QR SCANNER */}
      {currentTab === 'scanner' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Leitor de Código de Barras & QR</h2>
              <button
                type="button"
                onClick={() => setBeepEnabled((b) => !b)}
                className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 text-xs"
              >
                {beepEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                {beepEnabled ? 'Bipe ativo' : 'Silencioso'}
              </button>
            </div>

            <div className="relative rounded-xl overflow-hidden bg-slate-950 aspect-video flex items-center justify-center">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              {!cameraActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
                  <Camera className="w-8 h-8 text-slate-400" />
                  <p className="text-xs text-slate-300 max-w-xs">
                    Aponte para a etiqueta da Shopee, Mercado Livre, Amazon ou QR interno do Rota Express.
                  </p>
                  <button
                    type="button"
                    onClick={() => void startCameraScanner()}
                    className="min-h-[42px] inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 text-xs font-semibold"
                  >
                    <Camera className="w-4 h-4" /> Ativar Câmera
                  </button>
                </div>
              )}
            </div>

            {cameraActive && (
              <button
                type="button"
                onClick={stopCameraScanner}
                className="w-full min-h-[42px] inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
              >
                <CameraOff className="w-4 h-4" /> Desligar câmera
              </button>
            )}

            {cameraError && (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{cameraError}</span>
              </div>
            )}

            {/* Manual Fallback Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleLookupScannedCode(manualScanCode);
              }}
              className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800"
            >
              <input
                type="text"
                value={manualScanCode}
                onChange={(e) => setManualScanCode(e.target.value)}
                placeholder="Ou digite/cole o código de rastreio..."
                className="flex-1 min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm font-mono"
              />
              <button
                type="submit"
                className="min-h-[42px] px-4 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-semibold whitespace-nowrap shrink-0"
              >
                Buscar
              </button>
            </form>
          </div>

          {/* Scan Result Panel */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Resultado da Leitura</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Por segurança operacional, escanear um pacote localiza a parada e a zona de carga ou confirma o carregamento no veículo — <strong>nunca marca como entregue automaticamente sem sua ação explícita</strong>.
            </p>

            {!scannedResult ? (
              <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-500">
                Aguardando leitura de código de barras ou digitação manual...
              </div>
            ) : !scannedResult.pkg ? (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-4 space-y-1">
                <div className="text-sm font-bold text-red-700 dark:text-red-300">
                  Pacote não encontrado na rota ativa
                </div>
                <p className="text-xs text-red-600 dark:text-red-400 font-mono">Código lido: {scannedResult.code}</p>
              </div>
            ) : (
              <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-bold text-slate-900 dark:text-white">
                    {scannedResult.pkg.trackingCode}
                  </span>
                  <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                    {scannedResult.stopSeq ? `Parada #${scannedResult.stopSeq}` : 'Sem parada'}
                  </span>
                </div>
                <div className="text-sm font-semibold text-slate-900 dark:text-white">
                  {scannedResult.pkg.recipientName}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-300">
                  {scannedResult.pkg.normalizedAddress.formatted}
                </div>
                <div className="rounded-lg bg-slate-900 text-white px-3 py-2 flex items-center justify-between text-xs">
                  <span>Zona física no veículo</span>
                  <strong className="text-sm">
                    {scannedResult.pkg.physicalLocationId ? `Zona ${scannedResult.pkg.physicalLocationId}` : 'Não atribuída'}
                  </strong>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      updatePackageStatus({
                        packageId: scannedResult.pkg!.id,
                        newStatus: 'loaded',
                        notes: 'Conferido no carregamento via scanner.',
                        eventType: 'loaded_scan',
                      });
                      pushToast('success', `${scannedResult.pkg!.trackingCode} confirmado como carregado no veículo.`);
                    }}
                    className="min-h-[42px] inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white px-4 text-xs font-semibold"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Confirmar Carregamento
                  </button>
                  <select
                    value={scannedResult.pkg.physicalLocationId || ''}
                    onChange={(e) => {
                      const z = e.target.value || undefined;
                      assignCargoZone(scannedResult.pkg!.id, z);
                      setScannedResult((prev) =>
                        prev && prev.pkg ? { ...prev, pkg: { ...prev.pkg, physicalLocationId: z } } : prev
                      );
                    }}
                    className="min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                  >
                    <option value="">Atribuir zona...</option>
                    {cargoZones.map((z) => (
                      <option key={z.id} value={z.id}>
                        Zona {z.id} — {z.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* QR LABELS PRINT MODAL */}
      {showQrModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
          onClick={() => setShowQrModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col shadow-xl"
          >
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between no-print">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Etiquetas Internas de Carga ({qrLabels.length})
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-3 text-xs font-semibold"
                >
                  <Printer className="w-3.5 h-3.5" /> Imprimir
                </button>
                <button
                  type="button"
                  onClick={() => setShowQrModal(false)}
                  className="min-h-[36px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs"
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="p-5 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-3">
              {qrLabels.map((lbl) => (
                <div
                  key={lbl.code}
                  className="rounded-xl border border-slate-300 dark:border-slate-700 p-3 flex flex-col items-center text-center gap-1.5 bg-white text-slate-900"
                >
                  <img src={lbl.dataUrl} alt={`QR ${lbl.code}`} className="w-24 h-24" />
                  <div className="text-xs font-bold tabular-nums">
                    {lbl.stopSeq ? `Parada #${lbl.stopSeq}` : 'Sem parada'} · Zona {lbl.zone}
                  </div>
                  <div className="text-[11px] font-mono">{lbl.code}</div>
                  <div className="text-[10px] text-slate-600 truncate max-w-full">{lbl.recipient}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
