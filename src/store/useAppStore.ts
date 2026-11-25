import { create } from 'zustand';
import {
  CargoZone,
  Coordinates,
  DeliveryEvent,
  DeliveryPackage,
  DeliveryPriority,
  DeliveryRoute,
  FavoriteAddress,
  FinancialEntry,
  ImportTemplate,
  LocationConfidence,
  LocationSource,
  OptimizationStrategy,
  PackageStatus,
  RouteConstraints,
  RoutePoint,
  RouteStop,
  RouteVersion,
  UserProfile,
  Vehicle,
} from '../types/domain';
import {
  DEFAULT_CARGO_ZONES,
  DEFAULT_DEMO_VEHICLE,
  GOIANIA_FAVORITE_ADDRESSES,
  generateDemoPackages,
} from '../domain/demoData';
import {
  deriveStopStatusFromPackages,
  groupPackagesIntoStops,
  mergeStops,
  splitStop,
} from '../domain/grouping';
import { optimizeRouteLocal } from '../domain/optimizer';
import { classifyLocationConfidence, normalizeBrazilianAddress } from '../domain/address';
import {
  clearWorkspaceOffline,
  enqueueOfflineEvent,
  getPendingOfflineEvents,
  loadWorkspaceOffline,
  markOfflineEventSynced,
  saveWorkspaceOffline,
} from '../lib/offlineDb';
import {
  saveRouteSummaryToFirestore,
  saveVehicleToFirestore,
  syncDeliveryEventToFirestore,
  syncFavoriteAddressToFirestore,
  syncFinancialEntryToFirestore,
  syncPackageSnapshotToFirestore,
} from '../lib/firebase';

export type MainTab = 'dashboard' | 'routes' | 'packages' | 'financial' | 'more';
export type SubView =
  | null
  | 'new_route'
  | 'driver_mode'
  | 'map'
  | 'stops_list'
  | 'reoptimize'
  | 'history'
  | 'packages_list'
  | 'loading'
  | 'scanner'
  | 'financial_overview'
  | 'reports'
  | 'vehicles'
  | 'favorites'
  | 'integrations'
  | 'profile'
  | 'privacy'
  | 'help';

export interface ToastNotice {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

interface AppState {
  // Session & Environment
  user: UserProfile | null;
  authReady: boolean;
  isDemoMode: boolean;
  theme: 'light' | 'dark';
  googleMapsKey: string | null;
  quotaExceeded: boolean;
  assistantOpen: boolean;

  // Navigation
  activeTab: MainTab;
  subView: SubView;

  // Operational Data (strictly isolated between real & demo)
  routes: DeliveryRoute[];
  activeRouteId: string | null;
  packages: DeliveryPackage[];
  vehicles: Vehicle[];
  events: DeliveryEvent[];
  financialEntries: FinancialEntry[];
  importTemplates: ImportTemplate[];
  favoriteAddresses: FavoriteAddress[];

  // Sync & Feedback
  lastSyncedAt: string | null;
  pendingSyncCount: number;
  isSyncing: boolean;
  toasts: ToastNotice[];

  // Actions
  setUser: (user: UserProfile | null) => void;
  setAuthReady: (ready: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setGoogleMapsKey: (key: string | null) => void;
  setQuotaExceeded: (flag: boolean) => void;
  setAssistantOpen: (open: boolean) => void;
  navigate: (tab: MainTab, subView?: SubView) => void;
  pushToast: (type: ToastNotice['type'], message: string) => void;
  dismissToast: (id: string) => void;

  // Workspace Lifecycle
  hydrateWorkspace: (mode: 'real' | 'demo') => Promise<void>;
  persistCurrentWorkspace: () => Promise<void>;
  enterDemoMode: (size?: 10 | 50 | 150 | 500) => Promise<void>;
  resetDemoMode: (size?: 10 | 50 | 150 | 500) => Promise<void>;
  exitDemoMode: () => Promise<void>;
  syncPendingEvents: () => Promise<number>;

  // Route & Package Operations
  createRouteFromImportedPackages: (params: {
    name: string;
    packages: DeliveryPackage[];
    stops: RouteStop[];
    origin: RoutePoint;
    destination?: RoutePoint;
    vehicleId: string;
    constraints: RouteConstraints;
    strategy: OptimizationStrategy;
    initialVersion: RouteVersion;
    originalBaselineVersion?: RouteVersion;
  }) => Promise<DeliveryRoute>;
  setActiveRouteId: (routeId: string | null) => void;
  startActiveRoute: () => void;
  finishActiveRoute: (recordedDistanceKm?: number) => void;
  applyNewRouteVersion: (routeId: string, version: RouteVersion, strategy?: OptimizationStrategy) => void;
  reoptimizeRemainingStops: (strategy?: OptimizationStrategy, useRealRoadMatrix?: boolean) => Promise<{
    previousDistanceMeters: number;
    newDistanceMeters: number;
    previousDurationSeconds: number;
    newDurationSeconds: number;
    version: RouteVersion;
  } | null>;
  recalculateSecondAttemptInsertion: (packageId: string, afterStopSequence: number) => void;

  // Stop & Package Actions
  updatePackageStatus: (params: {
    packageId: string;
    newStatus: PackageStatus;
    reason?: string;
    notes?: string;
    suggestedRetryTime?: string;
    eventType?: DeliveryEvent['eventType'];
  }) => void;
  markStopDeliveredBatch: (stopId: string, notes?: string) => void;
  updatePackageAddressAndCoords: (params: {
    packageId: string;
    addressText?: string;
    coordinates: Coordinates;
    source: LocationSource;
    confidence?: LocationConfidence;
  }) => void;
  assignCargoZone: (packageId: string, zoneId: string | undefined) => void;
  autoSuggestCargoZones: () => number;
  addManualPackage: (params: {
    trackingCode: string;
    recipientName: string;
    recipientPhone?: string;
    address: string;
    neighborhood?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    coordinates?: Coordinates;
    platform: string;
    priority: DeliveryPriority;
    observations?: string;
    addToActiveRoute: boolean;
  }) => DeliveryPackage;
  mergeRouteStops: (targetStopId: string, sourceStopId: string) => void;
  splitRouteStop: (stopId: string) => void;
  reorderStopManually: (stopId: string, direction: 'up' | 'down' | 'pin_next') => void;

  // Vehicles, Financials, Favorites, Templates, Profile
  saveVehicle: (vehicle: Vehicle) => void;
  deleteVehicle: (vehicleId: string) => void;
  addCargoZoneToVehicle: (vehicleId: string, zone: CargoZone) => void;
  addFinancialEntry: (entry: Omit<FinancialEntry, 'id' | 'userId' | 'createdAt'>) => void;
  deleteFinancialEntry: (entryId: string) => void;
  saveFavoriteAddress: (fav: Omit<FavoriteAddress, 'id' | 'userId'>) => void;
  deleteFavoriteAddress: (favId: string) => void;
  saveImportTemplate: (tpl: Omit<ImportTemplate, 'id' | 'createdAt'>) => void;
  updateUserProfileLocal: (patch: Partial<UserProfile>) => void;
  exportAllUserDataJson: () => string;
}

const DEFAULT_REAL_VEHICLE: Vehicle = {
  id: 'veh_default_user',
  ownerId: 'local_user',
  organizationId: 'org_default',
  name: 'Meu Veículo Principal',
  type: 'car',
  fuelType: 'gasolina',
  consumptionKmPerLiter: 11.5,
  fuelPricePerLiter: 6.19,
  maintenanceCostPerKm: 0.35,
  hourlyCost: 32,
  maxWeightKg: 450,
  maxVolumeLiters: 1800,
  maxPackages: 140,
  compartments: DEFAULT_CARGO_ZONES,
};

function getInitialTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem('rota_express_theme');
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

function getActiveVersion(route?: DeliveryRoute | null): RouteVersion | undefined {
  if (!route || route.versions.length === 0) return undefined;
  return route.versions.find((v) => v.version === route.activeVersion) || route.versions[route.versions.length - 1];
}

function syncStopStatusesForRoute(route: DeliveryRoute, packages: DeliveryPackage[]): DeliveryRoute {
  const pkgMap: Record<string, DeliveryPackage> = {};
  for (const p of packages) pkgMap[p.id] = p;

  return {
    ...route,
    updatedAt: new Date().toISOString(),
    versions: route.versions.map((ver) => {
      if (ver.version !== route.activeVersion) return ver;
      return {
        ...ver,
        stops: ver.stops.map((stop) => {
          const stopPkgs = stop.packageIds.map((id) => pkgMap[id]).filter(Boolean);
          return {
            ...stop,
            status: deriveStopStatusFromPackages(stopPkgs),
          };
        }),
      };
    }),
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  authReady: false,
  isDemoMode: false,
  theme: getInitialTheme(),
  googleMapsKey: (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || null,
  quotaExceeded: false,
  assistantOpen: false,

  activeTab: 'dashboard',
  subView: null,

  routes: [],
  activeRouteId: null,
  packages: [],
  vehicles: [DEFAULT_REAL_VEHICLE],
  events: [],
  financialEntries: [],
  importTemplates: [],
  favoriteAddresses: [],

  lastSyncedAt: null,
  pendingSyncCount: 0,
  isSyncing: false,
  toasts: [],

  setUser: (user) => set({ user }),
  setAuthReady: (authReady) => set({ authReady }),

  setTheme: (theme) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('rota_express_theme', theme);
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
    set({ theme });
  },

  setGoogleMapsKey: (googleMapsKey) => set({ googleMapsKey }),
  setQuotaExceeded: (quotaExceeded) => set({ quotaExceeded }),
  setAssistantOpen: (assistantOpen) => set({ assistantOpen }),

  navigate: (activeTab, subView = null) => set({ activeTab, subView }),

  pushToast: (type, message) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, type, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4500);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  hydrateWorkspace: async (mode) => {
    const saved = await loadWorkspaceOffline(mode);
    const pending = await getPendingOfflineEvents();
    if (saved) {
      set({
        routes: saved.routes || [],
        activeRouteId: saved.activeRouteId || saved.routes?.[0]?.id || null,
        packages: saved.packages || [],
        vehicles:
          saved.vehicles && saved.vehicles.length > 0
            ? saved.vehicles
            : [mode === 'demo' ? DEFAULT_DEMO_VEHICLE : DEFAULT_REAL_VEHICLE],
        events: saved.events || [],
        financialEntries: saved.financialEntries || [],
        importTemplates: saved.importTemplates || [],
        favoriteAddresses:
          saved.favoriteAddresses && saved.favoriteAddresses.length > 0
            ? saved.favoriteAddresses
            : mode === 'demo'
              ? GOIANIA_FAVORITE_ADDRESSES
              : [],
        lastSyncedAt: saved.lastSyncedAt || null,
        pendingSyncCount: pending.length,
      });
    } else if (mode === 'real') {
      set({
        routes: [],
        activeRouteId: null,
        packages: [],
        vehicles: [DEFAULT_REAL_VEHICLE],
        events: [],
        financialEntries: [],
        importTemplates: [],
        favoriteAddresses: [],
        pendingSyncCount: pending.length,
      });
    }
  },

  persistCurrentWorkspace: async () => {
    const state = get();
    const key = state.isDemoMode ? 'demo' : 'real';
    await saveWorkspaceOffline({
      key,
      routes: state.routes,
      activeRouteId: state.activeRouteId,
      packages: state.packages,
      vehicles: state.vehicles,
      events: state.events,
      financialEntries: state.financialEntries,
      importTemplates: state.importTemplates,
      favoriteAddresses: state.favoriteAddresses,
      lastSyncedAt: state.lastSyncedAt,
      updatedAt: new Date().toISOString(),
    });
  },

  enterDemoMode: async (size = 50) => {
    const demoProfile: UserProfile = {
      id: 'demo_user',
      name: 'Entregador Demonstração',
      email: 'demo@rotaexpress.local',
      role: 'driver',
      organizationId: 'org_demo',
      city: 'Goiânia',
      state: 'GO',
      platforms: ['Shopee', 'Mercado Livre', 'Amazon'],
      defaultVehicleId: DEFAULT_DEMO_VEHICLE.id,
      preferredNavigator: 'google_maps',
      favoriteStartAddressId: GOIANIA_FAVORITE_ADDRESSES[0].id,
      isDemo: true,
    };

    const existing = await loadWorkspaceOffline('demo');
    if (existing && existing.routes.length > 0 && size === 50) {
      set({
        user: demoProfile,
        isDemoMode: true,
        authReady: true,
        activeTab: 'dashboard',
        subView: null,
      });
      await get().hydrateWorkspace('demo');
      get().pushToast('info', 'Modo Demonstração (Goiânia) carregado — dados fictícios isolados.');
      return;
    }

    set({
      user: demoProfile,
      isDemoMode: true,
      authReady: true,
      activeTab: 'dashboard',
      subView: null,
    });
    await get().resetDemoMode(size);
  },

  resetDemoMode: async (size = 50) => {
    await clearWorkspaceOffline('demo');
    const demoPkgs = generateDemoPackages(size, 'demo_user', 'org_demo');
    const routeId = `route_demo_gyn_${size}`;
    const today = new Date().toISOString().slice(0, 10);

    const constraints: RouteConstraints = {
      routeDate: today,
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
    };

    const origin: RoutePoint = {
      label: GOIANIA_FAVORITE_ADDRESSES[0].name,
      address: GOIANIA_FAVORITE_ADDRESSES[0].address,
      coordinates: GOIANIA_FAVORITE_ADDRESSES[0].coordinates,
      source: 'depot',
    };

    const groupedStops = groupPackagesIntoStops({
      packages: demoPkgs,
      routeId,
      routeVersion: 1,
      avgSecondsPerStop: constraints.avgSecondsPerStop,
      extraSecondsPerPackage: constraints.extraSecondsPerPackage,
    });

    const baselineOrig = optimizeRouteLocal({
      stops: groupedStops,
      allPackages: demoPkgs,
      origin,
      vehicle: DEFAULT_DEMO_VEHICLE,
      constraints,
      strategy: 'original',
      routeVersion: 1,
      providerId: 'heuristic_demo_estimated',
      providerLabel: 'Sequência Original da Planilha (Demonstração)',
    });

    const optimized = optimizeRouteLocal({
      stops: groupedStops,
      allPackages: demoPkgs,
      origin,
      vehicle: DEFAULT_DEMO_VEHICLE,
      constraints,
      strategy: 'balanced',
      routeVersion: 2,
      providerId: 'heuristic_demo_estimated',
      providerLabel: 'Motor Heurístico Local (Modo Demonstração — Estimativa Geométrica)',
    });

    // Mark first few packages delivered and 1 failed attempt for realistic demo inspection
    const updatedPkgs = demoPkgs.map((p, idx) => {
      const assignedStop = optimized.orderedStops.find((s) => s.packageIds.includes(p.id));
      const zoneIdx = assignedStop
        ? Math.min(3, Math.floor(((assignedStop.sequence - 1) / Math.max(1, optimized.orderedStops.length)) * 4))
        : 3;
      const zoneId = DEFAULT_CARGO_ZONES[zoneIdx].id;

      let status: PackageStatus = 'pending';
      let attemptCount = 0;
      let observations = p.observations;
      let suggestedRetryTime = p.suggestedRetryTime;

      if (assignedStop && assignedStop.sequence <= 2) {
        status = 'delivered';
        attemptCount = 1;
      } else if (assignedStop && assignedStop.sequence === 3 && idx % 2 === 0) {
        status = 'failed_attempt';
        attemptCount = 1;
        observations = 'Cliente ausente (Demo) — vizinho informou retorno às 15:30.';
        suggestedRetryTime = '15:30';
      }

      return {
        ...p,
        routeId,
        stopId: assignedStop?.id,
        physicalLocationId: zoneId,
        status,
        attemptCount,
        observations,
        suggestedRetryTime,
      };
    });

    const nowIso = new Date().toISOString();
    const demoRouteBase: DeliveryRoute = {
      id: routeId,
      userId: 'demo_user',
      organizationId: 'org_demo',
      name: `Rota Goiânia Demo (${size} pacotes)`,
      vehicleId: DEFAULT_DEMO_VEHICLE.id,
      status: 'active',
      activeVersion: 2,
      origin,
      constraints,
      selectedStrategy: 'balanced',
      isDemo: true,
      versions: [
        {
          version: 1,
          strategy: 'original',
          provider: baselineOrig.provider,
          providerLabel: baselineOrig.providerLabel,
          stops: baselineOrig.orderedStops,
          metrics: baselineOrig.metrics,
          validation: baselineOrig.validation,
          createdAt: nowIso,
          reason: 'Referência da sequência original (Demonstração)',
        },
        {
          version: 2,
          strategy: 'balanced',
          provider: optimized.provider,
          providerLabel: optimized.providerLabel,
          stops: optimized.orderedStops,
          metrics: optimized.metrics,
          validation: optimized.validation,
          createdAt: nowIso,
          reason: 'Otimização Equilibrada inicial (Demonstração)',
        },
      ],
      createdAt: nowIso,
      startedAt: nowIso,
      updatedAt: nowIso,
    };

    const syncedRoute = syncStopStatusesForRoute(demoRouteBase, updatedPkgs);

    const demoFinancials: FinancialEntry[] = [
      {
        id: 'fin_demo_rev_1',
        userId: 'demo_user',
        routeId,
        platform: 'Shopee',
        type: 'revenue',
        category: 'valor_fixo_rota',
        description: 'Diária rota Shopee/ML (Exemplo Demo)',
        amount: size >= 150 ? 340 : 210,
        isEstimated: false,
        date: today,
        createdAt: nowIso,
      },
      {
        id: 'fin_demo_rev_2',
        userId: 'demo_user',
        routeId,
        platform: 'Mercado Livre',
        type: 'revenue',
        category: 'bonificacao',
        description: 'Bônus meta entrega rápida (Exemplo Demo)',
        amount: 45,
        isEstimated: false,
        date: today,
        createdAt: nowIso,
      },
      {
        id: 'fin_demo_exp_1',
        userId: 'demo_user',
        routeId,
        type: 'expense',
        category: 'alimentacao',
        description: 'Almoço em rota (Exemplo Demo)',
        amount: 28,
        isEstimated: false,
        date: today,
        createdAt: nowIso,
      },
    ];

    set({
      routes: [syncedRoute],
      activeRouteId: syncedRoute.id,
      packages: updatedPkgs,
      vehicles: [DEFAULT_DEMO_VEHICLE],
      events: [],
      financialEntries: demoFinancials,
      favoriteAddresses: GOIANIA_FAVORITE_ADDRESSES,
      lastSyncedAt: null,
    });

    await get().persistCurrentWorkspace();
    get().pushToast('success', `Base de demonstração Goiânia (${size} pacotes) pronta.`);
  },

  exitDemoMode: async () => {
    set({
      isDemoMode: false,
      user: null,
      routes: [],
      activeRouteId: null,
      packages: [],
      events: [],
      financialEntries: [],
      activeTab: 'dashboard',
      subView: null,
    });
  },

  syncPendingEvents: async () => {
    const state = get();
    if (state.isDemoMode || !state.user) return 0;
    const pending = await getPendingOfflineEvents();
    if (pending.length === 0) {
      set({ pendingSyncCount: 0 });
      return 0;
    }

    set({ isSyncing: true });
    let synced = 0;
    for (const evt of pending) {
      try {
        await syncDeliveryEventToFirestore(evt);
        await markOfflineEventSynced(evt.eventId);
        synced += 1;
      } catch {
        // Keep in queue for retry when online/authenticated
      }
    }

    const remaining = await getPendingOfflineEvents();
    const nowIso = new Date().toISOString();
    set((s) => ({
      isSyncing: false,
      pendingSyncCount: remaining.length,
      lastSyncedAt: synced > 0 ? nowIso : s.lastSyncedAt,
      events: s.events.map((e) =>
        pending.some((p) => p.eventId === e.eventId) && !remaining.some((r) => r.eventId === e.eventId)
          ? { ...e, syncStatus: 'synced' }
          : e
      ),
    }));
    await get().persistCurrentWorkspace();
    return synced;
  },

  createRouteFromImportedPackages: async (params) => {
    const state = get();
    const userId = state.user?.id || 'local_user';
    const orgId = state.user?.organizationId || 'org_default';
    const routeId = `route_${Date.now().toString(36)}`;
    const nowIso = new Date().toISOString();

    const versions: RouteVersion[] = [];
    if (params.originalBaselineVersion) {
      versions.push({ ...params.originalBaselineVersion, version: 1 });
      versions.push({ ...params.initialVersion, version: 2 });
    } else {
      versions.push({ ...params.initialVersion, version: 1 });
    }
    const activeVersionNum = versions[versions.length - 1].version;
    const activeStops = versions[versions.length - 1].stops;

    const updatedNewPackages = params.packages.map((pkg) => {
      const stop = activeStops.find((s) => s.packageIds.includes(pkg.id));
      return {
        ...pkg,
        userId,
        organizationId: orgId,
        routeId,
        stopId: stop?.id,
      };
    });

    const newRoute: DeliveryRoute = syncStopStatusesForRoute(
      {
        id: routeId,
        userId,
        organizationId: orgId,
        name: params.name.trim() || `Rota ${new Date().toLocaleDateString('pt-BR')}`,
        vehicleId: params.vehicleId,
        status: 'planned',
        activeVersion: activeVersionNum,
        origin: params.origin,
        destination: params.destination,
        constraints: params.constraints,
        selectedStrategy: params.strategy,
        versions,
        isDemo: state.isDemoMode,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      updatedNewPackages
    );

    set((s) => ({
      routes: [newRoute, ...s.routes],
      activeRouteId: newRoute.id,
      packages: [...updatedNewPackages, ...s.packages.filter((p) => p.routeId !== routeId)],
    }));

    await get().persistCurrentWorkspace();

    if (!state.isDemoMode) {
      void saveRouteSummaryToFirestore(newRoute).catch(() => undefined);
    }

    return newRoute;
  },

  setActiveRouteId: (routeId) => {
    set({ activeRouteId: routeId });
    void get().persistCurrentWorkspace();
  },

  startActiveRoute: () => {
    const state = get();
    if (!state.activeRouteId) return;
    const nowIso = new Date().toISOString();
    set((s) => ({
      routes: s.routes.map((r) =>
        r.id === s.activeRouteId ? { ...r, status: 'active', startedAt: r.startedAt || nowIso, updatedAt: nowIso } : r
      ),
    }));
    const updated = get().routes.find((r) => r.id === state.activeRouteId);
    if (updated && !state.isDemoMode) {
      void saveRouteSummaryToFirestore(updated).catch(() => undefined);
    }
    void get().persistCurrentWorkspace();
    get().pushToast('success', 'Rota iniciada! Modo motorista pronto para entregas.');
  },

  finishActiveRoute: (recordedDistanceKm) => {
    const state = get();
    if (!state.activeRouteId) return;
    const nowIso = new Date().toISOString();
    set((s) => ({
      routes: s.routes.map((r) =>
        r.id === s.activeRouteId
          ? {
              ...r,
              status: 'finished',
              finishedAt: nowIso,
              recordedDistanceKm: recordedDistanceKm ?? r.recordedDistanceKm,
              updatedAt: nowIso,
            }
          : r
      ),
    }));
    const updated = get().routes.find((r) => r.id === state.activeRouteId);
    if (updated && !state.isDemoMode) {
      void saveRouteSummaryToFirestore(updated).catch(() => undefined);
    }
    void get().persistCurrentWorkspace();
    get().pushToast('success', 'Rota finalizada e salva no histórico.');
  },

  applyNewRouteVersion: (routeId, version, strategy) => {
    const state = get();
    const nowIso = new Date().toISOString();
    set((s) => ({
      routes: s.routes.map((r) => {
        if (r.id !== routeId) return r;
        const nextVerNum = Math.max(...r.versions.map((v) => v.version), 0) + 1;
        const stamped: RouteVersion = { ...version, version: nextVerNum, createdAt: nowIso };
        const updatedRoute: DeliveryRoute = {
          ...r,
          activeVersion: nextVerNum,
          selectedStrategy: strategy || version.strategy,
          versions: [...r.versions, stamped],
          updatedAt: nowIso,
        };
        return syncStopStatusesForRoute(updatedRoute, s.packages);
      }),
    }));
    // CRITICAL INVARIANT: We NEVER overwrite pkg.physicalLocationId during reoptimization!
    void get().persistCurrentWorkspace();
    const route = get().routes.find((r) => r.id === routeId);
    if (route && !state.isDemoMode) {
      void saveRouteSummaryToFirestore(route).catch(() => undefined);
    }
  },

  reoptimizeRemainingStops: async (strategyOverride, useRealRoadMatrix = false) => {
    const state = get();
    const route = state.routes.find((r) => r.id === state.activeRouteId);
    if (!route) return null;
    const activeVer = getActiveVersion(route);
    if (!activeVer) return null;

    const completedStops = activeVer.stops.filter(
      (s) => s.status === 'completed' || s.status === 'failed' || s.status === 'postponed'
    );
    const remainingStops = activeVer.stops.filter(
      (s) => s.status === 'pending' || s.status === 'in_progress' || s.status === 'partial'
    );

    if (remainingStops.length < 2) {
      get().pushToast('info', 'Há menos de 2 paradas pendentes — reotimização não necessária.');
      return null;
    }

    const vehicle = state.vehicles.find((v) => v.id === route.vehicleId) || state.vehicles[0] || DEFAULT_REAL_VEHICLE;
    const routePkgs = state.packages.filter((p) => p.routeId === route.id);
    const strategy = strategyOverride || route.selectedStrategy;
    const nextVerNum = Math.max(...route.versions.map((v) => v.version), 0) + 1;

    // Anchor origin at last completed stop if available, otherwise route origin
    const lastCompleted = completedStops[completedStops.length - 1];
    const dynamicOrigin: RoutePoint = lastCompleted?.coordinates
      ? {
          label: `Última parada concluída (#${lastCompleted.sequence})`,
          address: lastCompleted.address,
          coordinates: lastCompleted.coordinates,
          source: 'manual',
        }
      : route.origin;

    // Compute current remaining metrics baseline
    const currentRemDist = remainingStops.reduce((sum, s) => sum + (s.legDistanceMeters || 0), 0);
    const currentRemDur = remainingStops.reduce(
      (sum, s) => sum + (s.legDurationSeconds || 0) + s.serviceDurationSeconds,
      0
    );

    let optimizedRes = optimizeRouteLocal({
      stops: remainingStops,
      allPackages: routePkgs.filter((p) => remainingStops.some((s) => s.packageIds.includes(p.id))),
      origin: dynamicOrigin,
      destination: route.destination,
      vehicle,
      constraints: route.constraints,
      strategy,
      routeVersion: nextVerNum,
      providerId: state.isDemoMode ? 'heuristic_demo_estimated' : 'heuristic_local_estimated',
    });

    if (useRealRoadMatrix && !state.isDemoMode) {
      try {
        const resp = await fetch('/api/routes/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stops: remainingStops,
            packages: routePkgs.filter((p) => remainingStops.some((s) => s.packageIds.includes(p.id))),
            origin: dynamicOrigin,
            destination: route.destination,
            vehicle,
            constraints: route.constraints,
            strategy,
            routeVersion: nextVerNum,
            useRealRoadMatrix: true,
            isDemo: false,
          }),
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.quotaExceeded) {
            window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
          }
          if (data.orderedStops) {
            optimizedRes = data;
          }
        }
      } catch {
        // Fallback already computed locally
      }
    }

    const mergedStops: RouteStop[] = [
      ...completedStops,
      ...optimizedRes.orderedStops,
    ].map((s, idx) => ({
      ...s,
      routeVersion: nextVerNum,
      sequence: idx + 1,
    }));

    const completedDist = completedStops.reduce((sum, s) => sum + (s.legDistanceMeters || 0), 0);
    const completedTravel = completedStops.reduce((sum, s) => sum + (s.legDurationSeconds || 0), 0);
    const completedService = completedStops.reduce((sum, s) => sum + s.serviceDurationSeconds, 0);

    const newVersion: RouteVersion = {
      version: nextVerNum,
      strategy,
      provider: optimizedRes.provider,
      providerLabel: optimizedRes.providerLabel,
      stops: mergedStops,
      metrics: {
        ...optimizedRes.metrics,
        totalStops: mergedStops.length,
        totalPackages: routePkgs.length,
        totalDistanceMeters: completedDist + optimizedRes.metrics.totalDistanceMeters,
        travelDurationSeconds: completedTravel + optimizedRes.metrics.travelDurationSeconds,
        serviceDurationSeconds: completedService + optimizedRes.metrics.serviceDurationSeconds,
        totalDurationSeconds: completedTravel + completedService + optimizedRes.metrics.totalDurationSeconds,
      },
      validation: optimizedRes.validation,
      createdAt: new Date().toISOString(),
      reason: 'Reotimização dinâmica das paradas restantes (posições físicas preservadas)',
    };

    return {
      previousDistanceMeters: currentRemDist,
      newDistanceMeters: optimizedRes.metrics.totalDistanceMeters,
      previousDurationSeconds: currentRemDur,
      newDurationSeconds: optimizedRes.metrics.totalDurationSeconds,
      version: newVersion,
    };
  },

  recalculateSecondAttemptInsertion: (packageId, afterStopSequence) => {
    const state = get();
    const route = state.routes.find((r) => r.id === state.activeRouteId);
    if (!route) return;
    const activeVer = getActiveVersion(route);
    if (!activeVer) return;

    const pkg = state.packages.find((p) => p.id === packageId);
    if (!pkg) return;

    // Reset package status back to pending for retry and move/insert its stop right after target sequence
    const updatedPkgs = state.packages.map((p) =>
      p.id === packageId
        ? {
            ...p,
            status: 'pending' as PackageStatus,
            observations: `${p.observations ? p.observations + ' • ' : ''}2ª tentativa reagendada após parada #${afterStopSequence}.`,
          }
        : p
    );

    const retryStop: RouteStop = {
      id: `stop_retry_${packageId}_${Date.now().toString(36)}`,
      routeId: route.id,
      routeVersion: activeVer.version + 1,
      sequence: afterStopSequence + 1,
      groupKey: `retry:${packageId}`,
      address: pkg.normalizedAddress.formatted || pkg.originalAddress,
      neighborhood: pkg.normalizedAddress.neighborhood || 'Bairro não informado',
      city: pkg.normalizedAddress.city || '',
      complementSummary: pkg.normalizedAddress.complement || undefined,
      coordinates: pkg.coordinates,
      locationConfidence: pkg.locationConfidence,
      packageIds: [pkg.id],
      status: 'pending',
      priority: 'high',
      timeWindowStart: pkg.suggestedRetryTime || pkg.timeWindowStart,
      timeWindowEnd: pkg.timeWindowEnd,
      serviceDurationSeconds: route.constraints.avgSecondsPerStop,
    };

    const insertIdx = activeVer.stops.findIndex((s) => s.sequence === afterStopSequence);
    const nextStops = [...activeVer.stops];
    if (insertIdx >= 0) {
      nextStops.splice(insertIdx + 1, 0, retryStop);
    } else {
      nextStops.push(retryStop);
    }

    const renumbered = nextStops.map((s, idx) => ({ ...s, sequence: idx + 1 }));
    const nextVerNum = activeVer.version + 1;
    const newVersion: RouteVersion = {
      ...activeVer,
      version: nextVerNum,
      stops: renumbered,
      createdAt: new Date().toISOString(),
      reason: `2ª tentativa inserida para pacote ${pkg.trackingCode} após parada #${afterStopSequence}`,
    };

    set((s) => ({
      packages: updatedPkgs,
      routes: s.routes.map((r) =>
        r.id === route.id
          ? syncStopStatusesForRoute(
              {
                ...r,
                activeVersion: nextVerNum,
                versions: [...r.versions, newVersion],
              },
              updatedPkgs
            )
          : r
      ),
    }));
    void get().persistCurrentWorkspace();
    get().pushToast('success', `2ª tentativa de ${pkg.trackingCode} agendada após parada #${afterStopSequence}.`);
  },

  updatePackageStatus: ({ packageId, newStatus, reason, notes, suggestedRetryTime, eventType }) => {
    const state = get();
    const target = state.packages.find((p) => p.id === packageId);
    if (!target) return;

    const nowIso = new Date().toISOString();
    const isAttemptEvent = newStatus === 'delivered' || newStatus === 'failed_attempt';
    const event: DeliveryEvent = {
      eventId: `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      packageId,
      stopId: target.stopId || 'unassigned',
      routeId: target.routeId || state.activeRouteId || 'none',
      userId: state.user?.id || 'local_user',
      eventType:
        eventType ||
        (newStatus === 'delivered'
          ? 'delivered'
          : newStatus === 'failed_attempt'
            ? 'failed_attempt'
            : newStatus === 'postponed'
              ? 'postponed'
              : newStatus === 'loaded'
                ? 'loaded_scan'
                : 'status_change'),
      previousStatus: target.status,
      newStatus,
      timestamp: nowIso,
      location: target.coordinates,
      reason,
      notes,
      syncStatus: state.isDemoMode ? 'synced' : 'pending',
    };

    const nextPackages = state.packages.map((p) =>
      p.id === packageId
        ? {
            ...p,
            status: newStatus,
            attemptCount: isAttemptEvent ? p.attemptCount + 1 : p.attemptCount,
            suggestedRetryTime: suggestedRetryTime ?? p.suggestedRetryTime,
            observations: notes ? `${notes}${reason ? ` (${reason})` : ''}` : reason || p.observations,
          }
        : p
    );

    const nextRoutes = state.routes.map((r) =>
      r.id === target.routeId ? syncStopStatusesForRoute(r, nextPackages) : r
    );

    set((s) => ({
      packages: nextPackages,
      routes: nextRoutes,
      events: [event, ...s.events],
      pendingSyncCount: state.isDemoMode ? s.pendingSyncCount : s.pendingSyncCount + 1,
    }));

    void get().persistCurrentWorkspace();

    if (!state.isDemoMode) {
      const updatedPkg = nextPackages.find((p) => p.id === packageId);
      void enqueueOfflineEvent(event).then(async () => {
        if (navigator.onLine) {
          try {
            await syncDeliveryEventToFirestore(event);
            if (updatedPkg) await syncPackageSnapshotToFirestore(updatedPkg);
            await markOfflineEventSynced(event.eventId);
            const rem = await getPendingOfflineEvents();
            set((s) => ({
              pendingSyncCount: rem.length,
              lastSyncedAt: new Date().toISOString(),
              events: s.events.map((e) => (e.eventId === event.eventId ? { ...e, syncStatus: 'synced' } : e)),
            }));
          } catch {
            // Kept safely in IndexedDB sync_queue
          }
        }
      });
    }
  },

  markStopDeliveredBatch: (stopId, notes) => {
    const state = get();
    const route = state.routes.find((r) => r.id === state.activeRouteId);
    const activeVer = getActiveVersion(route);
    const stop = activeVer?.stops.find((s) => s.id === stopId);
    if (!stop) return;

    const pendingIds = stop.packageIds.filter((pid) => {
      const p = state.packages.find((x) => x.id === pid);
      return p && p.status !== 'delivered' && p.status !== 'cancelled';
    });

    for (const pid of pendingIds) {
      get().updatePackageStatus({
        packageId: pid,
        newStatus: 'delivered',
        notes: notes || 'Entrega confirmada em lote na parada (controle interno Rota Express).',
        eventType: 'delivered',
      });
    }
    get().pushToast('success', `${pendingIds.length} pacote(s) marcados como entregues.`);
  },

  updatePackageAddressAndCoords: ({ packageId, addressText, coordinates, source, confidence }) => {
    const state = get();
    const nowIso = new Date().toISOString();
    const nextPackages = state.packages.map((p) => {
      if (p.id !== packageId) return p;
      const normalized = addressText
        ? normalizeBrazilianAddress({
            fullAddress: addressText,
            city: p.normalizedAddress.city,
            state: p.normalizedAddress.state,
            postalCode: p.normalizedAddress.postalCode,
          })
        : p.normalizedAddress;
      const finalConfidence =
        confidence ||
        classifyLocationConfidence({
          coordinates,
          source,
          normalized,
        });
      return {
        ...p,
        originalAddress: addressText || p.originalAddress,
        normalizedAddress: normalized,
        coordinates,
        locationSource: source,
        locationConfidence: finalConfidence,
        locationUpdatedAt: nowIso,
        validationIssues: normalized.issues,
      };
    });

    const nextRoutes = state.routes.map((r) => ({
      ...r,
      versions: r.versions.map((v) => ({
        ...v,
        stops: v.stops.map((stop) => {
          if (!stop.packageIds.includes(packageId)) return stop;
          const updatedPkg = nextPackages.find((p) => p.id === packageId);
          return {
            ...stop,
            coordinates,
            address: addressText || stop.address,
            locationConfidence: updatedPkg?.locationConfidence || 'confirmed',
          };
        }),
      })),
    }));

    set({ packages: nextPackages, routes: nextRoutes });
    void get().persistCurrentWorkspace();
    get().pushToast('success', 'Localização atualizada e confirmada manualmente.');
  },

  // CRITICAL: Physical cargo location is strictly independent of route optimization/sequence!
  assignCargoZone: (packageId, zoneId) => {
    set((s) => ({
      packages: s.packages.map((p) => (p.id === packageId ? { ...p, physicalLocationId: zoneId } : p)),
    }));
    void get().persistCurrentWorkspace();
  },

  autoSuggestCargoZones: () => {
    const state = get();
    const route = state.routes.find((r) => r.id === state.activeRouteId);
    const activeVer = getActiveVersion(route);
    if (!route || !activeVer) return 0;

    const vehicle = state.vehicles.find((v) => v.id === route.vehicleId) || state.vehicles[0] || DEFAULT_REAL_VEHICLE;
    const zones = vehicle.compartments.length > 0 ? vehicle.compartments : DEFAULT_CARGO_ZONES;
    const totalStops = activeVer.stops.length;
    if (totalStops === 0) return 0;

    const stopSeqByPkg: Record<string, number> = {};
    for (const s of activeVer.stops) {
      for (const pid of s.packageIds) {
        stopSeqByPkg[pid] = s.sequence;
      }
    }

    let updatedCount = 0;
    const nextPackages = state.packages.map((p) => {
      if (p.routeId !== route.id) return p;
      const seq = stopSeqByPkg[p.id];
      if (!seq) return p;

      // Fragile packages prefer top/quick access zone A/B; heavy packages (>12kg) prefer floor/back zone D
      let targetZoneIdx = Math.min(zones.length - 1, Math.floor(((seq - 1) / totalStops) * zones.length));
      if ((p.weightKg || 0) >= 12) {
        targetZoneIdx = zones.length - 1;
      } else if (p.isFragile && targetZoneIdx > 1) {
        targetZoneIdx = Math.min(1, zones.length - 1);
      }

      updatedCount += 1;
      return {
        ...p,
        physicalLocationId: zones[targetZoneIdx].id,
      };
    });

    set({ packages: nextPackages });
    void get().persistCurrentWorkspace();
    get().pushToast('success', `${updatedCount} pacotes organizados por ordem reversa de carregamento.`);
    return updatedCount;
  },

  addManualPackage: (params) => {
    const state = get();
    const normalized = normalizeBrazilianAddress({
      fullAddress: params.address,
      neighborhood: params.neighborhood,
      city: params.city || state.user?.city || 'Goiânia',
      state: params.state || state.user?.state || 'GO',
      postalCode: params.postalCode,
    });
    const source: LocationSource = params.coordinates ? 'manual_coordinates' : 'unresolved';
    const pkg: DeliveryPackage = {
      id: `pkg_man_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      userId: state.user?.id || 'local_user',
      organizationId: state.user?.organizationId || 'org_default',
      sourceRow: 0,
      platform: params.platform,
      trackingCode: params.trackingCode.trim() || `MANUAL-${Date.now().toString().slice(-6)}`,
      recipientName: params.recipientName.trim() || 'Destinatário Manual',
      recipientPhone: params.recipientPhone?.trim() || undefined,
      originalAddress: params.address,
      normalizedAddress: normalized,
      coordinates: params.coordinates,
      locationSource: source,
      locationConfidence: classifyLocationConfidence({ coordinates: params.coordinates, source, normalized }),
      locationUpdatedAt: params.coordinates ? new Date().toISOString() : undefined,
      quantity: 1,
      priority: params.priority,
      observations: params.observations?.trim() || undefined,
      status: 'pending',
      attemptCount: 0,
      validationIssues: normalized.issues,
      routeId: params.addToActiveRoute && state.activeRouteId ? state.activeRouteId : undefined,
    };

    let nextRoutes = state.routes;
    if (params.addToActiveRoute && state.activeRouteId) {
      nextRoutes = state.routes.map((r) => {
        if (r.id !== state.activeRouteId) return r;
        const activeVer = getActiveVersion(r);
        if (!activeVer) return r;
        const newStop: RouteStop = {
          id: `stop_man_${Date.now().toString(36)}`,
          routeId: r.id,
          routeVersion: activeVer.version,
          sequence: activeVer.stops.length + 1,
          groupKey: `manual:${pkg.id}`,
          address: normalized.formatted || params.address,
          neighborhood: normalized.neighborhood || 'Bairro não informado',
          city: normalized.city || '',
          coordinates: params.coordinates,
          locationConfidence: pkg.locationConfidence,
          packageIds: [pkg.id],
          status: 'pending',
          priority: params.priority,
          serviceDurationSeconds: r.constraints.avgSecondsPerStop,
        };
        pkg.stopId = newStop.id;
        return {
          ...r,
          updatedAt: new Date().toISOString(),
          versions: r.versions.map((v) =>
            v.version === r.activeVersion
              ? {
                  ...v,
                  stops: [...v.stops, newStop],
                  metrics: {
                    ...v.metrics,
                    totalStops: v.stops.length + 1,
                    totalPackages: v.metrics.totalPackages + 1,
                  },
                }
              : v
          ),
        };
      });
    }

    set((s) => ({
      packages: [pkg, ...s.packages],
      routes: nextRoutes,
    }));
    void get().persistCurrentWorkspace();
    get().pushToast('success', `Entrega manual ${pkg.trackingCode} adicionada.`);
    return pkg;
  },

  mergeRouteStops: (targetStopId, sourceStopId) => {
    const state = get();
    const route = state.routes.find((r) => r.id === state.activeRouteId);
    if (!route) return;
    const pkgMap: Record<string, DeliveryPackage> = {};
    for (const p of state.packages) pkgMap[p.id] = p;

    set((s) => ({
      routes: s.routes.map((r) => {
        if (r.id !== route.id) return r;
        return {
          ...r,
          versions: r.versions.map((v) =>
            v.version === r.activeVersion
              ? {
                  ...v,
                  stops: mergeStops(
                    v.stops,
                    targetStopId,
                    sourceStopId,
                    pkgMap,
                    r.constraints.avgSecondsPerStop,
                    r.constraints.extraSecondsPerPackage
                  ),
                }
              : v
          ),
        };
      }),
    }));
    void get().persistCurrentWorkspace();
    get().pushToast('info', 'Paradas mescladas manualmente preservando todos os pacotes.');
  },

  splitRouteStop: (stopId) => {
    const state = get();
    const route = state.routes.find((r) => r.id === state.activeRouteId);
    if (!route) return;
    const pkgMap: Record<string, DeliveryPackage> = {};
    for (const p of state.packages) pkgMap[p.id] = p;

    set((s) => ({
      routes: s.routes.map((r) => {
        if (r.id !== route.id) return r;
        return {
          ...r,
          versions: r.versions.map((v) =>
            v.version === r.activeVersion
              ? {
                  ...v,
                  stops: splitStop(
                    v.stops,
                    stopId,
                    pkgMap,
                    r.constraints.avgSecondsPerStop,
                    r.constraints.extraSecondsPerPackage
                  ),
                }
              : v
          ),
        };
      }),
    }));
    void get().persistCurrentWorkspace();
    get().pushToast('info', 'Parada desagrupada em paradas individuais.');
  },

  reorderStopManually: (stopId, direction) => {
    const state = get();
    const route = state.routes.find((r) => r.id === state.activeRouteId);
    if (!route) return;

    set((s) => ({
      routes: s.routes.map((r) => {
        if (r.id !== route.id) return r;
        return {
          ...r,
          versions: r.versions.map((v) => {
            if (v.version !== r.activeVersion) return v;
            const list = [...v.stops];
            const idx = list.findIndex((st) => st.id === stopId);
            if (idx === -1) return v;

            if (direction === 'up' && idx > 0) {
              [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
            } else if (direction === 'down' && idx < list.length - 1) {
              [list[idx], list[idx + 1]] = [list[idx + 1], list[idx]];
            } else if (direction === 'pin_next') {
              const firstPendingIdx = list.findIndex(
                (st) => st.status === 'pending' || st.status === 'in_progress' || st.status === 'partial'
              );
              if (firstPendingIdx >= 0 && firstPendingIdx !== idx) {
                const [item] = list.splice(idx, 1);
                list.splice(firstPendingIdx, 0, item);
              }
            }

            return {
              ...v,
              stops: list.map((st, i) => ({ ...st, sequence: i + 1 })),
            };
          }),
        };
      }),
    }));
    void get().persistCurrentWorkspace();
  },

  saveVehicle: (vehicle) => {
    const state = get();
    set((s) => {
      const exists = s.vehicles.some((v) => v.id === vehicle.id);
      return {
        vehicles: exists ? s.vehicles.map((v) => (v.id === vehicle.id ? vehicle : v)) : [...s.vehicles, vehicle],
      };
    });
    void get().persistCurrentWorkspace();
    if (!state.isDemoMode) {
      void saveVehicleToFirestore(vehicle).catch(() => undefined);
    }
    get().pushToast('success', `Veículo "${vehicle.name}" salvo.`);
  },

  deleteVehicle: (vehicleId) => {
    set((s) => {
      if (s.vehicles.length <= 1) return s;
      return { vehicles: s.vehicles.filter((v) => v.id !== vehicleId) };
    });
    void get().persistCurrentWorkspace();
  },

  addCargoZoneToVehicle: (vehicleId, zone) => {
    set((s) => ({
      vehicles: s.vehicles.map((v) =>
        v.id === vehicleId ? { ...v, compartments: [...v.compartments, zone] } : v
      ),
    }));
    void get().persistCurrentWorkspace();
  },

  addFinancialEntry: (entry) => {
    const state = get();
    const fullEntry: FinancialEntry = {
      ...entry,
      id: `fin_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      userId: state.user?.id || 'local_user',
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ financialEntries: [fullEntry, ...s.financialEntries] }));
    void get().persistCurrentWorkspace();
    if (!state.isDemoMode) {
      void syncFinancialEntryToFirestore(fullEntry).catch(() => undefined);
    }
    get().pushToast('success', 'Lançamento financeiro registrado.');
  },

  deleteFinancialEntry: (entryId) => {
    set((s) => ({ financialEntries: s.financialEntries.filter((e) => e.id !== entryId) }));
    void get().persistCurrentWorkspace();
  },

  saveFavoriteAddress: (fav) => {
    const state = get();
    const fullFav: FavoriteAddress = {
      ...fav,
      id: `fav_${Date.now().toString(36)}`,
      userId: state.user?.id || 'local_user',
    };
    set((s) => ({ favoriteAddresses: [fullFav, ...s.favoriteAddresses] }));
    void get().persistCurrentWorkspace();
    if (!state.isDemoMode) {
      void syncFavoriteAddressToFirestore(fullFav).catch(() => undefined);
    }
    get().pushToast('success', `Endereço favorito "${fav.name}" salvo.`);
  },

  deleteFavoriteAddress: (favId) => {
    set((s) => ({ favoriteAddresses: s.favoriteAddresses.filter((f) => f.id !== favId) }));
    void get().persistCurrentWorkspace();
  },

  saveImportTemplate: (tpl) => {
    const full: ImportTemplate = {
      ...tpl,
      id: `tpl_${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
    };
    set((s) => ({
      importTemplates: [full, ...s.importTemplates.filter((t) => t.structureSignature !== full.structureSignature)],
    }));
    void get().persistCurrentWorkspace();
    get().pushToast('success', `Template de importação "${tpl.platform}" salvo para reutilização.`);
  },

  updateUserProfileLocal: (patch) => {
    set((s) => ({
      user: s.user ? { ...s.user, ...patch } : null,
    }));
    get().pushToast('success', 'Perfil atualizado.');
  },

  exportAllUserDataJson: () => {
    const s = get();
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        mode: s.isDemoMode ? 'demo' : 'real',
        user: s.user,
        vehicles: s.vehicles,
        routes: s.routes,
        packages: s.packages,
        events: s.events,
        financialEntries: s.financialEntries,
        favoriteAddresses: s.favoriteAddresses,
      },
      null,
      2
    );
  },
}));
