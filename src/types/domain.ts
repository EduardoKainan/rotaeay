export type UserRole = 'driver' | 'fleet_manager' | 'organization_admin' | 'platform_admin';

export type SubscriptionPlan = 'free' | 'professional' | 'premium' | 'enterprise';

export type VehicleType = 'motorcycle' | 'car' | 'utility' | 'van' | 'truck';

export type NavigatorPreference = 'google_maps' | 'waze';

export type LocationConfidence = 'confirmed' | 'high' | 'medium' | 'low';

export type LocationSource =
  | 'spreadsheet'
  | 'google_geocoding'
  | 'manual_pin'
  | 'manual_coordinates'
  | 'demo_dataset'
  | 'unresolved';

export type PackageStatus =
  | 'pending'
  | 'loaded'
  | 'in_transit'
  | 'delivered'
  | 'failed_attempt'
  | 'postponed'
  | 'return_required'
  | 'returned'
  | 'cancelled';

export type StopStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'postponed';

export type RouteStatus = 'draft' | 'planned' | 'active' | 'finished' | 'cancelled';

export type OptimizationStrategy = 'fastest' | 'economic' | 'balanced' | 'time_window' | 'original';

export type DeliveryPriority = 'normal' | 'high' | 'urgent';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  photoUrl?: string;
  role: UserRole;
  organizationId: string;
  city: string;
  state: string;
  platforms: string[];
  defaultVehicleId?: string;
  preferredNavigator: NavigatorPreference;
  favoriteStartAddressId?: string;
  favoriteEndAddressId?: string;
  isDemo?: boolean;
}

export interface Vehicle {
  id: string;
  ownerId: string;
  organizationId: string;
  name: string;
  type: VehicleType;
  fuelType: 'gasolina' | 'etanol' | 'diesel' | 'gnv' | 'eletrico';
  consumptionKmPerLiter: number;
  fuelPricePerLiter: number;
  maintenanceCostPerKm: number;
  hourlyCost: number;
  maxWeightKg: number;
  maxVolumeLiters: number;
  maxPackages: number;
  compartments: CargoZone[];
}

export interface CargoZone {
  id: string;
  name: string;
  description: string;
  maxPackages?: number;
  color: string;
}

export interface FavoriteAddress {
  id: string;
  userId: string;
  name: string;
  address: string;
  coordinates?: Coordinates;
}

export interface NormalizedAddressParts {
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  referencePoint: string;
  formatted: string;
  isRuralOrIncomplete: boolean;
  issues: string[];
}

export interface DeliveryPackage {
  id: string;
  userId: string;
  organizationId: string;
  importJobId?: string;
  sourceRow: number;
  platform: string;
  trackingCode: string;
  barcode?: string;
  orderId?: string;
  shipmentId?: string;
  originalRouteId?: string;
  originalSequence?: number;
  recipientName: string;
  recipientPhone?: string;
  originalAddress: string;
  normalizedAddress: NormalizedAddressParts;
  coordinates?: Coordinates;
  locationSource: LocationSource;
  locationConfidence: LocationConfidence;
  locationUpdatedAt?: string;
  quantity: number;
  weightKg?: number;
  isFragile?: boolean;
  priority: DeliveryPriority;
  timeWindowStart?: string; // HH:mm
  timeWindowEnd?: string; // HH:mm
  deliveryInstructions?: string;
  originalStatus?: string;
  observations?: string;
  status: PackageStatus;
  /** Independent physical cargo location — NEVER overwritten by route reoptimization */
  physicalLocationId?: string;
  attemptCount: number;
  suggestedRetryTime?: string;
  isDuplicate?: boolean;
  validationIssues: string[];
  routeId?: string;
  stopId?: string;
}

export interface RouteStop {
  id: string;
  routeId: string;
  routeVersion: number;
  sequence: number;
  originalSequence?: number;
  groupKey: string;
  address: string;
  neighborhood: string;
  city: string;
  complementSummary?: string;
  coordinates?: Coordinates;
  locationConfidence: LocationConfidence;
  packageIds: string[];
  status: StopStatus;
  priority: DeliveryPriority;
  timeWindowStart?: string;
  timeWindowEnd?: string;
  serviceDurationSeconds: number;
  legDistanceMeters?: number;
  legDurationSeconds?: number;
  estimatedArrivalIso?: string;
  isFixedFirst?: boolean;
  isFixedLast?: boolean;
  isFixedPosition?: boolean;
  isGeometryEstimated?: boolean;
}

export interface RouteConstraints {
  routeDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  maxEndTime?: string; // HH:mm
  avgSecondsPerStop: number;
  extraSecondsPerPackage: number;
  lunchBreakMinutes: number;
  avoidTolls: boolean;
  avoidHighways: boolean;
  considerTraffic: boolean;
  prioritizeUrgent: boolean;
  preserveOriginalRouteSplit: boolean;
  endMode: 'open_last_stop' | 'return_to_start' | 'custom_end';
  fixedFirstStopId?: string;
  fixedLastStopId?: string;
}

export interface RoutePoint {
  label: string;
  address: string;
  coordinates?: Coordinates;
  source: 'gps' | 'manual' | 'favorite' | 'depot' | 'first_stop' | 'last_stop';
}

export interface RouteMetrics {
  totalStops: number;
  totalPackages: number;
  totalDistanceMeters: number;
  travelDurationSeconds: number;
  serviceDurationSeconds: number;
  waitingDurationSeconds: number;
  totalDurationSeconds: number;
  estimatedFinishIso: string;
  estimatedFuelLiters: number;
  estimatedFuelCost: number;
  estimatedMaintenanceCost: number;
  estimatedTimeCost: number;
  estimatedOperationalCost: number;
  lateStopsCount: number;
  unassignedPackagesCount: number;
  isRoadDistanceReal: boolean;
}

export interface OptimizationValidationResult {
  valid: boolean;
  checkedPackages: number;
  assignedPackages: number;
  unassignedPackages: { packageId: string; trackingCode: string; reason: string }[];
  warnings: string[];
  errors: string[];
}

export interface RouteVersion {
  version: number;
  strategy: OptimizationStrategy;
  provider: string;
  providerLabel: string;
  stops: RouteStop[];
  metrics: RouteMetrics;
  encodedPolyline?: string;
  validation: OptimizationValidationResult;
  createdAt: string;
  reason?: string;
}

export interface DeliveryRoute {
  id: string;
  userId: string;
  organizationId: string;
  name: string;
  vehicleId: string;
  status: RouteStatus;
  activeVersion: number;
  origin: RoutePoint;
  destination?: RoutePoint;
  constraints: RouteConstraints;
  selectedStrategy: OptimizationStrategy;
  versions: RouteVersion[];
  isDemo: boolean;
  recordedDistanceKm?: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

export interface DeliveryEvent {
  eventId: string;
  packageId: string;
  stopId: string;
  routeId: string;
  userId: string;
  eventType:
    | 'status_change'
    | 'loaded_scan'
    | 'delivered'
    | 'partial_delivery'
    | 'failed_attempt'
    | 'postponed'
    | 'address_corrected'
    | 'cargo_moved';
  previousStatus?: PackageStatus;
  newStatus: PackageStatus;
  timestamp: string;
  location?: Coordinates;
  reason?: string;
  notes?: string;
  syncStatus: 'pending' | 'synced' | 'conflict';
}

export type RevenueCategory =
  | 'valor_fixo_rota'
  | 'valor_por_pacote'
  | 'valor_por_parada'
  | 'bonificacao'
  | 'receita_adicional';

export type ExpenseCategory =
  | 'combustivel'
  | 'pedagio'
  | 'estacionamento'
  | 'manutencao'
  | 'pneus'
  | 'depreciacao'
  | 'alimentacao'
  | 'seguro'
  | 'outras_despesas';

export interface FinancialEntry {
  id: string;
  userId: string;
  routeId?: string;
  platform?: string;
  type: 'revenue' | 'expense';
  category: RevenueCategory | ExpenseCategory | string;
  description: string;
  amount: number;
  isEstimated: boolean;
  date: string; // YYYY-MM-DD
  createdAt: string;
}

export interface ImportTemplate {
  id: string;
  organizationId: string;
  platform: string;
  structureSignature: string;
  headers: string[];
  columnMapping: Record<string, CanonicalColumn | ''>;
  createdAt: string;
}

export type CanonicalColumn =
  | 'package_id'
  | 'tracking_code'
  | 'barcode'
  | 'order_id'
  | 'shipment_id'
  | 'platform'
  | 'original_route_id'
  | 'original_sequence'
  | 'delivery_sequence'
  | 'recipient_name'
  | 'recipient_phone'
  | 'full_address'
  | 'street'
  | 'number'
  | 'complement'
  | 'neighborhood'
  | 'city'
  | 'state'
  | 'postal_code'
  | 'country'
  | 'latitude'
  | 'longitude'
  | 'reference_point'
  | 'quantity'
  | 'weight'
  | 'width'
  | 'height'
  | 'length'
  | 'priority'
  | 'time_window_start'
  | 'time_window_end'
  | 'delivery_instructions'
  | 'original_status'
  | 'observations';

export interface ImportSummary {
  fileName: string;
  fileHash: string;
  sheetName: string;
  totalRowsRead: number;
  validPackages: number;
  emptyRowsSkipped: number;
  duplicatePackages: number;
  incompleteAddresses: number;
  packagesWithCoordinates: number;
  packagesNeedingGeocoding: number;
  packagesPendingReview: number;
  originalRoutesFound: string[];
}

export interface IntegrationStatusItem {
  id: string;
  name: string;
  required: boolean;
  status:
    | 'Configurado'
    | 'Não configurado'
    | 'Funcionando'
    | 'Erro de autenticação'
    | 'Permissão insuficiente'
    | 'API desabilitada'
    | 'Limite atingido'
    | 'Indisponível';
  details: string;
  missingConfig?: string[];
  lastTestedAt?: string;
}

export interface ApiUsageEntry {
  id: string;
  provider: string;
  operation: string;
  billingUnits: number;
  estimatedCostBrl: number;
  routeId?: string;
  timestamp: string;
}

export interface SecondAttemptSuggestion {
  packageId: string;
  trackingCode: string;
  recipientName: string;
  address: string;
  reason?: string;
  suggestedRetryTime?: string;
  insertAfterStopSequence: number;
  insertAfterAddress: string;
  detourMeters: number;
  detourMinutes: number;
  feasible: boolean;
  explanation: string;
}
