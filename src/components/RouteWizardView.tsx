import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Crosshair,
  Download,
  FileSpreadsheet,
  Globe,
  Layers,
  MapPin,
  Merge,
  Navigation,
  Sparkles,
  Split,
  Upload,
} from 'lucide-react';
import {
  CanonicalColumn,
  Coordinates,
  DeliveryPackage,
  ImportSummary,
  OptimizationStrategy,
  RouteConstraints,
  RoutePoint,
  RouteStop,
  RouteVersion,
} from '../types/domain';
import {
  CANONICAL_COLUMN_LABELS,
  ParsedSpreadsheet,
  autoMapColumns,
  buildPackagesFromSpreadsheet,
  computeStructureSignature,
  exportSafeSpreadsheet,
  extractSheetData,
  parseSpreadsheetFile,
} from '../domain/spreadsheet';
import {
  buildAddressDeduplicationKey,
  classifyLocationConfidence,
  normalizeBrazilianAddress,
} from '../domain/address';
import { groupPackagesIntoStops, mergeStops, splitStop } from '../domain/grouping';
import { optimizeRouteLocal } from '../domain/optimizer';
import { downloadDemoTemplateSpreadsheet, generateDemoPackages } from '../domain/demoData';
import { formatBRL } from '../domain/financial';
import { useAppStore } from '../store/useAppStore';
import { InteractiveMap } from './InteractiveMap';

const PLATFORMS = ['Shopee', 'Mercado Livre', 'Amazon', 'Transportadora', 'Personalizada'];

const STRATEGY_LABELS: Record<OptimizationStrategy, { title: string; desc: string }> = {
  balanced: { title: 'Equilibrada (Recomendada)', desc: 'Combina custo por km + tempo + janelas de entrega.' },
  fastest: { title: 'Mais rápida', desc: 'Prioriza menor tempo total de percurso.' },
  economic: { title: 'Mais econômica', desc: 'Minimiza distância e consumo de combustível.' },
  time_window: { title: 'Prioridade & Janelas', desc: 'Penaliza atrasos em janelas e prioriza urgentes.' },
  original: { title: 'Sequência original', desc: 'Mantém a ordem original da planilha sem reordenar.' },
};

export function RouteWizardView() {
  const user = useAppStore((s) => s.user);
  const vehicles = useAppStore((s) => s.vehicles);
  const favoriteAddresses = useAppStore((s) => s.favoriteAddresses);
  const importTemplates = useAppStore((s) => s.importTemplates);
  const isDemoMode = useAppStore((s) => s.isDemoMode);
  const saveImportTemplate = useAppStore((s) => s.saveImportTemplate);
  const createRouteFromImportedPackages = useAppStore((s) => s.createRouteFromImportedPackages);
  const navigate = useAppStore((s) => s.navigate);
  const pushToast = useAppStore((s) => s.pushToast);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [selectedPlatform, setSelectedPlatform] = useState('Shopee');
  const [parsedSheet, setParsedSheet] = useState<ParsedSpreadsheet | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, CanonicalColumn | ''>>({});
  const [saveTemplateChecked, setSaveTemplateChecked] = useState(true);
  const [aiSuggesting, setAiSuggesting] = useState(false);

  const [draftPackages, setDraftPackages] = useState<DeliveryPackage[]>([]);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [geocodingBusy, setGeocodingBusy] = useState(false);
  const [pinFixPkgId, setPinFixPkgId] = useState<string | null>(null);

  const [draftStops, setDraftStops] = useState<RouteStop[]>([]);
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);

  // Route configuration
  const [routeName, setRouteName] = useState(`Rota ${new Date().toLocaleDateString('pt-BR')}`);
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id || '');
  const [originMode, setOriginMode] = useState<'first_stop' | 'gps' | 'favorite' | 'manual'>('first_stop');
  const [originFavId, setOriginFavId] = useState(favoriteAddresses[0]?.id || '');
  const [originManualAddr, setOriginManualAddr] = useState('');
  const [originGpsCoords, setOriginGpsCoords] = useState<Coordinates | undefined>(undefined);
  const [strategy, setStrategy] = useState<OptimizationStrategy>('balanced');
  const [useRealRoadMatrix, setUseRealRoadMatrix] = useState(!isDemoMode);
  const [optimizing, setOptimizing] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [comparisons, setComparisons] = useState<
    Array<{ strategy: OptimizationStrategy; metrics: RouteVersion['metrics']; orderedStops: RouteStop[]; validation: RouteVersion['validation'] }>
  >([]);

  const [constraints, setConstraints] = useState<RouteConstraints>({
    routeDate: new Date().toISOString().slice(0, 10),
    startTime: '08:00',
    maxEndTime: '18:00',
    avgSecondsPerStop: 150,
    extraSecondsPerPackage: 25,
    lunchBreakMinutes: 45,
    avoidTolls: false,
    avoidHighways: false,
    considerTraffic: true,
    prioritizeUrgent: true,
    preserveOriginalRouteSplit: false,
    endMode: 'open_last_stop',
  });

  const activeVehicle = vehicles.find((v) => v.id === vehicleId) || vehicles[0];

  const handleFileUpload = async (file: File) => {
    try {
      const parsed = await parseSpreadsheetFile(file);
      const { mapping, matchedTemplate } = autoMapColumns(parsed.headers, importTemplates);
      setParsedSheet(parsed);
      setColumnMapping(mapping);
      if (matchedTemplate) {
        pushToast('success', `Template salvo "${matchedTemplate.platform}" aplicado automaticamente.`);
      }
      setStep(2);
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : 'Erro ao ler planilha.');
    }
  };

  const handleSheetChange = (sheetName: string) => {
    if (!parsedSheet?.rawWorkbook) return;
    const extracted = extractSheetData(parsedSheet.rawWorkbook, sheetName);
    const { mapping } = autoMapColumns(extracted.headers, importTemplates);
    setParsedSheet({
      ...parsedSheet,
      selectedSheet: sheetName,
      headers: extracted.headers,
      rows: extracted.rows,
    });
    setColumnMapping(mapping);
  };

  const handleAiSuggestMapping = async () => {
    if (!parsedSheet) return;
    setAiSuggesting(true);
    try {
      // Strictly anonymize samples before sending headers to Gemini backend
      const anonymizedSamples: Record<string, string[]> = {};
      for (const h of parsedSheet.headers) {
        const samples = parsedSheet.rows
          .slice(0, 2)
          .map((r) => (r[h] || '').replace(/\d{3,}/g, 'XXX').slice(0, 40))
          .filter(Boolean);
        anonymizedSamples[h] = samples;
      }

      const res = await fetch('/api/imports/suggest-mapping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers: parsedSheet.headers, anonymizedSamples }),
      });
      const data = await res.json();
      if (!res.ok) {
        pushToast('warning', data.error || 'Sugestão com IA indisponível.');
        return;
      }
      if (data.mapping) {
        setColumnMapping((prev) => ({ ...prev, ...data.mapping }));
        pushToast('success', 'Mapeamento sugerido pelo Gemini aplicado. Revise antes de continuar.');
      }
    } catch {
      pushToast('warning', 'Falha de rede ao consultar sugestão do Gemini.');
    } finally {
      setAiSuggesting(false);
    }
  };

  const handleBuildPackages = () => {
    if (!parsedSheet) return;
    const { packages: built, summary } = buildPackagesFromSpreadsheet({
      rows: parsedSheet.rows,
      mapping: columnMapping,
      defaultPlatform: selectedPlatform,
      userId: user?.id || 'local_user',
      organizationId: user?.organizationId || 'org_default',
      fileName: parsedSheet.fileName,
      fileHash: parsedSheet.fileHash,
      sheetName: parsedSheet.selectedSheet,
    });

    if (saveTemplateChecked) {
      saveImportTemplate({
        organizationId: user?.organizationId || 'org_default',
        platform: selectedPlatform,
        structureSignature: computeStructureSignature(parsedSheet.headers),
        headers: parsedSheet.headers,
        columnMapping,
      });
    }

    setDraftPackages(built);
    setImportSummary(summary);
    setRouteName(`${selectedPlatform} • ${parsedSheet.fileName.replace(/\.[^.]+$/, '')}`);
    setStep(3);
  };

  const handleLoadDemoIntoWizard = (size: 10 | 50 | 150 | 500) => {
    const pkgs = generateDemoPackages(size, user?.id || 'demo_user', user?.organizationId || 'org_demo');
    setDraftPackages(pkgs);
    setImportSummary({
      fileName: `base_demo_goiania_${size}.xlsx`,
      fileHash: `demo_${size}`,
      sheetName: 'Goiânia Demo',
      totalRowsRead: size,
      validPackages: pkgs.length,
      emptyRowsSkipped: 0,
      duplicatePackages: pkgs.filter((p) => p.isDuplicate).length,
      incompleteAddresses: pkgs.filter((p) => p.normalizedAddress.issues.length > 0).length,
      packagesWithCoordinates: pkgs.filter((p) => Boolean(p.coordinates)).length,
      packagesNeedingGeocoding: pkgs.filter((p) => !p.coordinates).length,
      packagesPendingReview: pkgs.filter((p) => p.validationIssues.length > 0).length,
      originalRoutesFound: ['ROTA-GYN-01', 'ROTA-GYN-02'],
    });
    setRouteName(`Rota Goiânia Demo (${size} pacotes)`);
    setStep(3);
  };

  const handleGeocodeMissing = async () => {
    const missing = draftPackages.filter((p) => !p.coordinates);
    if (missing.length === 0) {
      pushToast('info', 'Todos os pacotes já possuem coordenadas.');
      return;
    }

    setGeocodingBusy(true);
    try {
      const addressItems = missing.slice(0, 50).map((p) => ({
        key: buildAddressDeduplicationKey(p.normalizedAddress, p.originalAddress),
        query: `${p.normalizedAddress.formatted || p.originalAddress}, Brasil`,
      }));

      const res = await fetch('/api/addresses/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses: addressItems }),
      });
      const data = await res.json();

      if (data.quotaExceeded || res.status === 429) {
        window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      }
      if (!res.ok) {
        pushToast('warning', data.error || 'Geocodificação indisponível no momento.');
        return;
      }

      let resolved = 0;
      const nowIso = new Date().toISOString();
      const updated = draftPackages.map((pkg) => {
        if (pkg.coordinates) return pkg;
        const key = buildAddressDeduplicationKey(pkg.normalizedAddress, pkg.originalAddress);
        const match = data.results?.[key];
        if (match?.coordinates) {
          resolved += 1;
          const conf = classifyLocationConfidence({
            coordinates: match.coordinates,
            source: 'google_geocoding',
            normalized: pkg.normalizedAddress,
            geocoderLocationType: match.locationType,
          });
          return {
            ...pkg,
            coordinates: match.coordinates,
            locationSource: 'google_geocoding' as const,
            locationConfidence: conf,
            locationUpdatedAt: nowIso,
          };
        }
        return pkg;
      });

      setDraftPackages(updated);
      pushToast(
        resolved > 0 ? 'success' : 'warning',
        `${resolved} pacote(s) geocodificado(s) via Google Geocoding API (${data.uniqueProcessed} endereços únicos consultados).`
      );
    } catch {
      pushToast('error', 'Erro de rede ao geocodificar endereços.');
    } finally {
      setGeocodingBusy(false);
    }
  };

  const handleEditPackageAddressInline = (pkgId: string, newAddress: string) => {
    setDraftPackages((prev) =>
      prev.map((p) => {
        if (p.id !== pkgId) return p;
        const normalized = normalizeBrazilianAddress({
          fullAddress: newAddress,
          city: p.normalizedAddress.city,
          state: p.normalizedAddress.state,
        });
        return {
          ...p,
          originalAddress: newAddress,
          normalizedAddress: normalized,
          validationIssues: normalized.issues,
        };
      })
    );
  };

  const handleConfirmPinForDraft = (pkgId: string, coords: Coordinates) => {
    setDraftPackages((prev) =>
      prev.map((p) =>
        p.id === pkgId
          ? {
              ...p,
              coordinates: coords,
              locationSource: 'manual_pin',
              locationConfidence: 'confirmed',
              locationUpdatedAt: new Date().toISOString(),
            }
          : p
      )
    );
    setPinFixPkgId(null);
    pushToast('success', 'Coordenada confirmada manualmente no mapa.');
  };

  const handleExportProblemRows = () => {
    const problems = draftPackages.filter(
      (p) => !p.coordinates || p.validationIssues.length > 0 || p.isDuplicate
    );
    if (problems.length === 0) {
      pushToast('info', 'Nenhum registro com pendência para exportar.');
      return;
    }
    exportSafeSpreadsheet(
      problems.map((p) => ({
        Linha: p.sourceRow,
        Rastreio: p.trackingCode,
        Destinatario: p.recipientName,
        Endereco: p.originalAddress,
        Coordenadas: p.coordinates ? `${p.coordinates.lat}, ${p.coordinates.lng}` : 'Ausente',
        Alertas: p.validationIssues.join(' | ') || 'Sem coordenadas',
      })),
      'pendencias_importacao_rota_express.csv',
      'csv'
    );
  };

  const handleProceedToGrouping = () => {
    const grouped = groupPackagesIntoStops({
      packages: draftPackages,
      routeId: 'draft',
      routeVersion: 1,
      avgSecondsPerStop: constraints.avgSecondsPerStop,
      extraSecondsPerPackage: constraints.extraSecondsPerPackage,
    });
    setDraftStops(grouped);
    setStep(4);
  };

  const resolveOriginPoint = (): RoutePoint => {
    if (originMode === 'gps' && originGpsCoords) {
      return {
        label: 'Localização atual (GPS)',
        address: `${originGpsCoords.lat.toFixed(5)}, ${originGpsCoords.lng.toFixed(5)}`,
        coordinates: originGpsCoords,
        source: 'gps',
      };
    }
    if (originMode === 'favorite') {
      const fav = favoriteAddresses.find((f) => f.id === originFavId);
      if (fav) {
        return { label: fav.name, address: fav.address, coordinates: fav.coordinates, source: 'favorite' };
      }
    }
    if (originMode === 'manual' && originManualAddr.trim()) {
      const firstCoord = draftStops.find((s) => s.coordinates)?.coordinates;
      return {
        label: 'Ponto de partida manual',
        address: originManualAddr.trim(),
        coordinates: firstCoord,
        source: 'manual',
      };
    }
    const firstValid = draftStops.find((s) => s.coordinates);
    return {
      label: 'Primeira parada válida',
      address: firstValid?.address || 'Início da rota',
      coordinates: firstValid?.coordinates,
      source: 'first_stop',
    };
  };

  const handleCaptureGps = () => {
    if (!navigator.geolocation) {
      pushToast('warning', 'Geolocalização não suportada neste navegador.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setOriginGpsCoords({
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        });
        setOriginMode('gps');
        pushToast('success', 'Coordenadas GPS capturadas como ponto de partida.');
      },
      () => pushToast('warning', 'Permissão de localização negada ou indisponível.')
    );
  };

  const handleCompareStrategies = async () => {
    if (!activeVehicle || draftStops.length === 0) return;
    setComparing(true);
    try {
      const origin = resolveOriginPoint();
      const res = await fetch('/api/routes/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stops: draftStops,
          packages: draftPackages,
          origin,
          vehicle: activeVehicle,
          constraints,
          routeVersion: 1,
          strategies: ['balanced', 'fastest', 'economic', 'original'],
          isDemo: isDemoMode,
        }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.comparisons)) {
        setComparisons(data.comparisons);
      } else {
        pushToast('warning', data.error || 'Falha ao comparar estratégias.');
      }
    } catch {
      pushToast('error', 'Erro de rede ao comparar estratégias.');
    } finally {
      setComparing(false);
    }
  };

  const handleOptimizeAndCreate = async () => {
    if (!activeVehicle || draftStops.length === 0) return;
    setOptimizing(true);
    try {
      const origin = resolveOriginPoint();
      const hasOriginalSeq = draftPackages.some((p) => typeof p.originalSequence === 'number');

      let originalBaseline: RouteVersion | undefined;
      if (hasOriginalSeq) {
        const origRes = optimizeRouteLocal({
          stops: draftStops,
          allPackages: draftPackages,
          origin,
          vehicle: activeVehicle,
          constraints,
          strategy: 'original',
          routeVersion: 1,
          providerId: 'original_sequence',
          providerLabel: 'Sequência Original da Planilha',
        });
        originalBaseline = {
          version: 1,
          strategy: 'original',
          provider: origRes.provider,
          providerLabel: origRes.providerLabel,
          stops: origRes.orderedStops,
          metrics: origRes.metrics,
          validation: origRes.validation,
          createdAt: new Date().toISOString(),
          reason: 'Referência da ordem original importada',
        };
      }

      let optimizedOutput = optimizeRouteLocal({
        stops: draftStops,
        allPackages: draftPackages,
        origin,
        vehicle: activeVehicle,
        constraints,
        strategy,
        routeVersion: hasOriginalSeq ? 2 : 1,
        providerId: isDemoMode ? 'heuristic_demo_estimated' : 'heuristic_local_estimated',
      });

      if (useRealRoadMatrix && !isDemoMode) {
        try {
          const resp = await fetch('/api/routes/optimize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              stops: draftStops,
              packages: draftPackages,
              origin,
              vehicle: activeVehicle,
              constraints,
              strategy,
              routeVersion: hasOriginalSeq ? 2 : 1,
              useRealRoadMatrix: true,
              isDemo: false,
            }),
          });
          const data = await resp.json();
          if (data.quotaExceeded || resp.status === 429) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
          if (resp.ok && data.orderedStops) {
            optimizedOutput = data;
          }
        } catch {
          // Keeps local heuristic optimization safely
        }
      }

      const initialVersion: RouteVersion = {
        version: hasOriginalSeq ? 2 : 1,
        strategy,
        provider: optimizedOutput.provider,
        providerLabel: optimizedOutput.providerLabel,
        stops: optimizedOutput.orderedStops,
        metrics: optimizedOutput.metrics,
        validation: optimizedOutput.validation,
        createdAt: new Date().toISOString(),
        reason: `Otimização inicial (${STRATEGY_LABELS[strategy].title})`,
      };

      await createRouteFromImportedPackages({
        name: routeName,
        packages: draftPackages,
        stops: optimizedOutput.orderedStops,
        origin,
        vehicleId: activeVehicle.id,
        constraints,
        strategy,
        initialVersion,
        originalBaselineVersion: originalBaseline,
      });

      pushToast(
        'success',
        `Rota "${routeName}" criada com ${optimizedOutput.orderedStops.length} paradas (${optimizedOutput.metrics.isRoadDistanceReal ? 'malha rodoviária real' : 'estimativa local'}).`
      );
      navigate('routes', 'driver_mode');
    } finally {
      setOptimizing(false);
    }
  };

  const pkgById = useMemo(() => {
    const map: Record<string, DeliveryPackage> = {};
    for (const p of draftPackages) map[p.id] = p;
    return map;
  }, [draftPackages]);

  const pinFixStopPreview = useMemo<RouteStop[]>(() => {
    if (!pinFixPkgId) return [];
    const pkg = draftPackages.find((p) => p.id === pinFixPkgId);
    if (!pkg) return [];
    return [
      {
        id: pkg.id,
        routeId: 'pin_fix',
        routeVersion: 1,
        sequence: 1,
        groupKey: pkg.id,
        address: pkg.normalizedAddress.formatted || pkg.originalAddress,
        neighborhood: pkg.normalizedAddress.neighborhood || 'Goiânia',
        city: pkg.normalizedAddress.city || 'Goiânia',
        coordinates: pkg.coordinates || { lat: -16.6869, lng: -49.2648 },
        locationConfidence: pkg.locationConfidence,
        packageIds: [pkg.id],
        status: 'pending',
        priority: pkg.priority,
        serviceDurationSeconds: 120,
      },
    ];
  }, [pinFixPkgId, draftPackages]);

  return (
    <div className="space-y-6">
      {/* Header & Stepper */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Nova Rota & Importação</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Importe XLSX, XLS ou CSV real, valide endereços, revise o agrupamento e otimize a sequência.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
          {[1, 2, 3, 4, 5].map((num) => (
            <span
              key={num}
              className={`w-7 h-7 rounded-lg flex items-center justify-center tabular-nums font-semibold ${
                step === num
                  ? 'bg-blue-600 text-white'
                  : step > num
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
              }`}
            >
              {num}
            </span>
          ))}
        </div>
      </div>

      {/* STEP 1: Source & Upload */}
      {step === 1 && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              1. Selecione a origem operacional
            </h2>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelectedPlatform(p)}
                  className={`min-h-[40px] px-4 rounded-xl text-sm font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    selectedPlatform === p
                      ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-slate-900 dark:border-white'
                      : 'bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            <label className="mt-2 flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-500 bg-slate-50/60 dark:bg-slate-950/60 p-8 text-center cursor-pointer transition-colors">
              <Upload className="w-8 h-8 text-blue-600 mb-3" />
              <span className="text-sm font-semibold text-slate-900 dark:text-white">
                Clique para selecionar ou arraste sua planilha (.xlsx, .xls ou .csv)
              </span>
              <span className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                Suporta UTF-8 e Windows-1252, múltiplas abas, preserva zeros à esquerda em códigos de rastreio/CEP e bloqueia execução de fórmulas.
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileUpload(file);
                }}
              />
            </label>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadDemoTemplateSpreadsheet('xlsx')}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar modelo XLSX (Goiânia)
                </button>
                <button
                  type="button"
                  onClick={() => downloadDemoTemplateSpreadsheet('csv')}
                  className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  Baixar modelo CSV
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-slate-500">Testar direto com base Demo:</span>
                {([10, 50, 150, 500] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => handleLoadDemoIntoWizard(sz)}
                    className="min-h-[34px] px-2.5 rounded-lg bg-orange-50 dark:bg-orange-950/50 border border-orange-200 dark:border-orange-900 text-xs font-semibold text-orange-700 dark:text-orange-300 hover:bg-orange-100 whitespace-nowrap shrink-0"
                  >
                    {sz} pct
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: Column Mapping */}
      {step === 2 && parsedSheet && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                2. Mapeamento de Colunas · {parsedSheet.fileName}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {parsedSheet.rows.length} linha(s) lidas · {parsedSheet.headers.length} colunas detectadas
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {parsedSheet.sheetNames.length > 1 && (
                <select
                  value={parsedSheet.selectedSheet}
                  onChange={(e) => handleSheetChange(e.target.value)}
                  className="min-h-[38px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                >
                  {parsedSheet.sheetNames.map((sn) => (
                    <option key={sn} value={sn}>
                      Aba: {sn}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => void handleAiSuggestMapping()}
                disabled={aiSuggesting}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-3 text-xs font-semibold disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {aiSuggesting ? 'Analisando cabeçalhos...' : 'Sugerir com Gemini IA'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Coluna na Planilha</th>
                  <th className="px-3 py-2.5 font-semibold">Exemplo (1ª linha)</th>
                  <th className="px-3 py-2.5 font-semibold">Campo no Rota Express</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {parsedSheet.headers.map((header) => (
                  <tr key={header}>
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">{header}</td>
                    <td className="px-3 py-2 text-slate-500 dark:text-slate-400 font-mono truncate max-w-[220px]">
                      {parsedSheet.rows[0]?.[header] || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={columnMapping[header] || ''}
                        onChange={(e) =>
                          setColumnMapping((prev) => ({
                            ...prev,
                            [header]: e.target.value as CanonicalColumn | '',
                          }))
                        }
                        className="w-full min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs text-slate-900 dark:text-white"
                      >
                        <option value="">Ignorar coluna</option>
                        {Object.entries(CANONICAL_COLUMN_LABELS).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={saveTemplateChecked}
              onChange={(e) => setSaveTemplateChecked(e.target.checked)}
              className="rounded border-slate-300"
            />
            Salvar este mapeamento como template automático para futuras planilhas com esta estrutura
          </label>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
            <button
              type="button"
              onClick={handleBuildPackages}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
            >
              Validar endereços e pacotes <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Diagnostics, Geocoding & Pin Correction */}
      {step === 3 && importSummary && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  3. Diagnóstico da Importação & Coordenadas
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Nenhum pacote é descartado silenciosamente. Revise pendências ou geocodifique antes de roteirizar.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleGeocodeMissing()}
                  disabled={geocodingBusy || draftPackages.every((p) => Boolean(p.coordinates))}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3.5 text-xs font-semibold whitespace-nowrap shrink-0"
                >
                  <Globe className="w-4 h-4" />
                  {geocodingBusy
                    ? 'Geocodificando...'
                    : `Geocodificar pendentes (${draftPackages.filter((p) => !p.coordinates).length})`}
                </button>
                <button
                  type="button"
                  onClick={handleExportProblemRows}
                  className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-medium whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" /> Exportar pendências
                </button>
              </div>
            </div>

            {/* Traceability Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5 text-center">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {importSummary.validPackages}
                </div>
                <div className="text-[11px] text-slate-500">Pacotes válidos</div>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-lg font-bold tabular-nums text-emerald-600">
                  {draftPackages.filter((p) => Boolean(p.coordinates)).length}
                </div>
                <div className="text-[11px] text-slate-500">Com coordenadas</div>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-lg font-bold tabular-nums text-amber-600">
                  {draftPackages.filter((p) => !p.coordinates).length}
                </div>
                <div className="text-[11px] text-slate-500">Sem coordenadas</div>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-lg font-bold tabular-nums text-red-600">
                  {importSummary.duplicatePackages}
                </div>
                <div className="text-[11px] text-slate-500">Duplicados</div>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-lg font-bold tabular-nums text-purple-600">
                  {importSummary.incompleteAddresses}
                </div>
                <div className="text-[11px] text-slate-500">End. incompletos</div>
              </div>
              <div className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-2.5">
                <div className="text-lg font-bold tabular-nums text-slate-600 dark:text-slate-300">
                  {importSummary.emptyRowsSkipped}
                </div>
                <div className="text-[11px] text-slate-500">Linhas vazias</div>
              </div>
            </div>

            {/* Visual Pin Correction Drawer */}
            {pinFixPkgId && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-700 dark:text-purple-300">
                    Ajuste manual de pino no mapa para o pacote selecionado
                  </span>
                  <button
                    type="button"
                    onClick={() => setPinFixPkgId(null)}
                    className="text-xs text-slate-500 hover:underline"
                  >
                    Fechar mapa
                  </button>
                </div>
                <InteractiveMap
                  stops={pinFixStopPreview}
                  editablePinStopId={pinFixPkgId}
                  onConfirmPinMove={(id, coords) => handleConfirmPinForDraft(id, coords)}
                  heightClass="h-[340px]"
                  showRoadPolyline={false}
                />
              </div>
            )}

            {/* Package Preview Table */}
            <div className="overflow-x-auto max-h-[380px] border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Rastreio</th>
                    <th className="px-3 py-2 font-semibold">Destinatário</th>
                    <th className="px-3 py-2 font-semibold">Endereço (editável)</th>
                    <th className="px-3 py-2 font-semibold">Localização</th>
                    <th className="px-3 py-2 font-semibold">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {draftPackages.slice(0, 80).map((pkg) => (
                    <tr key={pkg.id} className={pkg.validationIssues.length > 0 ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''}>
                      <td className="px-3 py-2 font-mono text-[11px] whitespace-nowrap">
                        {pkg.trackingCode}
                        {pkg.isDuplicate && (
                          <span className="block text-[10px] text-red-600 font-sans font-semibold">Duplicado</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{pkg.recipientName}</td>
                      <td className="px-3 py-2 min-w-[240px]">
                        <input
                          type="text"
                          value={pkg.originalAddress}
                          onChange={(e) => handleEditPackageAddressInline(pkg.id, e.target.value)}
                          className="w-full rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                        />
                        {pkg.validationIssues.length > 0 && (
                          <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
                            {pkg.validationIssues[0]}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {pkg.coordinates ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            {pkg.locationConfidence === 'confirmed' ? 'Confirmada' : pkg.locationConfidence === 'high' ? 'Alta' : 'Média'}
                          </span>
                        ) : (
                          <span className="text-red-600 dark:text-red-400 font-medium">Sem coord.</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setPinFixPkgId(pkg.id)}
                          className="inline-flex items-center gap-1 text-purple-700 dark:text-purple-400 hover:underline font-medium"
                        >
                          <Crosshair className="w-3.5 h-3.5" />
                          Ajustar pino
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {draftPackages.length > 80 && (
              <p className="text-[11px] text-slate-500">
                Exibindo os primeiros 80 de {draftPackages.length} pacotes na prévia (todos serão processados na rota).
              </p>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(parsedSheet ? 2 : 1)}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                <ArrowLeft className="w-4 h-4" /> Voltar
              </button>
              <button
                type="button"
                onClick={handleProceedToGrouping}
                className="min-h-[42px] inline-flex items-center gap-1.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
              >
                Revisar agrupamento de paradas <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STEP 4: Grouping Review */}
      {step === 4 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                4. Agrupamento Seguro em Paradas ({draftPackages.length} pacotes → {draftStops.length} paradas)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pacotes no mesmo endereço e janela compatível foram agrupados mantendo status individual por pacote. Você pode desagrupar ou mesclar manualmente.
              </p>
            </div>
            {mergeSourceId && (
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                Selecione a parada de destino para mesclar...
              </span>
            )}
          </div>

          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {draftStops.slice(0, 100).map((stop) => (
              <div
                key={stop.id}
                className={`rounded-xl border p-3 flex flex-wrap items-center justify-between gap-3 ${
                  mergeSourceId === stop.id
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-950/40'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white">
                    <span className="tabular-nums">#{stop.sequence}</span>
                    <span className="truncate">{stop.address}</span>
                    <span className="text-blue-600 dark:text-blue-400 font-semibold shrink-0">
                      · {stop.packageIds.length} pct
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {stop.neighborhood}
                    {stop.complementSummary ? ` · ${stop.complementSummary}` : ''}
                    {!stop.coordinates ? ' · Sem coordenadas (não entrará na sequência até ajuste)' : ''}
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  {stop.packageIds.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraftStops((prev) =>
                          splitStop(
                            prev,
                            stop.id,
                            pkgById,
                            constraints.avgSecondsPerStop,
                            constraints.extraSecondsPerPackage
                          )
                        )
                      }
                      className="min-h-[34px] inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      <Split className="w-3.5 h-3.5" /> Desagrupar
                    </button>
                  )}

                  {mergeSourceId ? (
                    mergeSourceId === stop.id ? (
                      <button
                        type="button"
                        onClick={() => setMergeSourceId(null)}
                        className="min-h-[34px] rounded-lg border border-slate-300 px-2.5 text-xs"
                      >
                        Cancelar
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setDraftStops((prev) =>
                            mergeStops(
                              prev,
                              stop.id,
                              mergeSourceId,
                              pkgById,
                              constraints.avgSecondsPerStop,
                              constraints.extraSecondsPerPackage
                            )
                          );
                          setMergeSourceId(null);
                        }}
                        className="min-h-[34px] rounded-lg bg-blue-600 text-white px-2.5 text-xs font-semibold"
                      >
                        Mesclar aqui
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMergeSourceId(stop.id)}
                      className="min-h-[34px] inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      <Merge className="w-3.5 h-3.5" /> Mesclar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar
            </button>
            <button
              type="button"
              onClick={() => setStep(5)}
              className="min-h-[42px] inline-flex items-center gap-1.5 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
            >
              Configurar e otimizar rota <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: Configuration & Strategy Comparison */}
      {step === 5 && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              5. Configuração Operacional & Estratégia de Otimização
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Nome da rota</label>
                <input
                  type="text"
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Veículo</label>
                <select
                  value={vehicleId}
                  onChange={(e) => setVehicleId(e.target.value)}
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.consumptionKmPerLiter} km/L)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Encerramento</label>
                <select
                  value={constraints.endMode}
                  onChange={(e) =>
                    setConstraints((c) => ({ ...c, endMode: e.target.value as RouteConstraints['endMode'] }))
                  }
                  className="w-full min-h-[42px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                >
                  <option value="open_last_stop">Rota aberta (terminar na última parada)</option>
                  <option value="return_to_start">Rota fechada (retornar à origem)</option>
                </select>
              </div>
            </div>

            {/* Origin Selector */}
            <div className="rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Ponto de Partida</span>
                <button
                  type="button"
                  onClick={handleCaptureGps}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <MapPin className="w-3.5 h-3.5" /> Usar meu GPS atual
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {(['first_stop', 'favorite', 'manual'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setOriginMode(m)}
                    className={`min-h-[38px] rounded-lg border text-xs font-medium px-3 ${
                      originMode === m
                        ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                        : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900'
                    }`}
                  >
                    {m === 'first_stop' ? 'Primeira parada' : m === 'favorite' ? 'Endereço favorito / CD' : 'Digitar endereço'}
                  </button>
                ))}
              </div>
              {originMode === 'favorite' && favoriteAddresses.length > 0 && (
                <select
                  value={originFavId}
                  onChange={(e) => setOriginFavId(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs"
                >
                  {favoriteAddresses.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} — {f.address}
                    </option>
                  ))}
                </select>
              )}
              {originMode === 'manual' && (
                <input
                  type="text"
                  value={originManualAddr}
                  onChange={(e) => setOriginManualAddr(e.target.value)}
                  placeholder="Digite o endereço de saída"
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs"
                />
              )}
            </div>

            {/* Operational Timing & Preferences */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Início</label>
                <input
                  type="time"
                  value={constraints.startTime}
                  onChange={(e) => setConstraints((c) => ({ ...c, startTime: e.target.value }))}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Limite fim</label>
                <input
                  type="time"
                  value={constraints.maxEndTime || ''}
                  onChange={(e) => setConstraints((c) => ({ ...c, maxEndTime: e.target.value }))}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Seg./parada</label>
                <input
                  type="number"
                  min={30}
                  max={900}
                  value={constraints.avgSecondsPerStop}
                  onChange={(e) => setConstraints((c) => ({ ...c, avgSecondsPerStop: Number(e.target.value) || 120 }))}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Almoço (min)</label>
                <input
                  type="number"
                  min={0}
                  max={120}
                  value={constraints.lunchBreakMinutes}
                  onChange={(e) => setConstraints((c) => ({ ...c, lunchBreakMinutes: Number(e.target.value) || 0 }))}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-sm tabular-nums"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-slate-700 dark:text-slate-300">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={constraints.prioritizeUrgent}
                  onChange={(e) => setConstraints((c) => ({ ...c, prioritizeUrgent: e.target.checked }))}
                />
                Priorizar urgentes
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={constraints.considerTraffic}
                  onChange={(e) => setConstraints((c) => ({ ...c, considerTraffic: e.target.checked }))}
                />
                Considerar trânsito
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={constraints.avoidTolls}
                  onChange={(e) => setConstraints((c) => ({ ...c, avoidTolls: e.target.checked }))}
                />
                Evitar pedágios
              </label>
              {!isDemoMode && (
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={useRealRoadMatrix}
                    onChange={(e) => setUseRealRoadMatrix(e.target.checked)}
                  />
                  Consultar matriz rodoviária real Google Routes API (até 20 paradas)
                </label>
              )}
            </div>

            {/* Strategy Cards */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">Estratégia de Otimização</span>
                <button
                  type="button"
                  onClick={() => void handleCompareStrategies()}
                  disabled={comparing}
                  className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline disabled:opacity-50"
                >
                  {comparing ? 'Comparando...' : 'Comparar estratégias agora'}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
                {(Object.keys(STRATEGY_LABELS) as OptimizationStrategy[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setStrategy(key)}
                    className={`rounded-xl border p-3 text-left transition-colors ${
                      strategy === key
                        ? 'border-blue-600 bg-blue-50/70 dark:bg-blue-950/40'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-bold text-slate-900 dark:text-white">{STRATEGY_LABELS[key].title}</div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                      {STRATEGY_LABELS[key].desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            {/* Strategy Comparison Table */}
            {comparisons.length > 0 && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2">Estratégia</th>
                      <th className="px-3 py-2">Distância</th>
                      <th className="px-3 py-2">Tempo Total</th>
                      <th className="px-3 py-2">Custo Est.</th>
                      <th className="px-3 py-2">Atrasos Janela</th>
                      <th className="px-3 py-2">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 tabular-nums">
                    {comparisons.map((c) => (
                      <tr key={c.strategy}>
                        <td className="px-3 py-2 font-semibold">{STRATEGY_LABELS[c.strategy].title}</td>
                        <td className="px-3 py-2">{(c.metrics.totalDistanceMeters / 1000).toFixed(1)} km</td>
                        <td className="px-3 py-2">{Math.round(c.metrics.totalDurationSeconds / 60)} min</td>
                        <td className="px-3 py-2">{formatBRL(c.metrics.estimatedOperationalCost)}</td>
                        <td className="px-3 py-2">{c.metrics.lateStopsCount}</td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => setStrategy(c.strategy)}
                            className="text-blue-600 dark:text-blue-400 font-semibold hover:underline"
                          >
                            Selecionar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => setStep(4)}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium"
              >
                <ArrowLeft className="w-4 h-4" /> Voltar
              </button>
              <button
                type="button"
                onClick={() => void handleOptimizeAndCreate()}
                disabled={optimizing}
                className="min-h-[46px] inline-flex items-center gap-2 px-6 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white text-sm font-bold"
              >
                <Navigation className="w-4 h-4" />
                {optimizing ? 'Otimizando rota...' : 'Gerar Rota Otimizada'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
