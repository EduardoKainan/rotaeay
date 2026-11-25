import {
  DeliveryPackage,
  DeliveryPriority,
  RouteStop,
  StopStatus,
} from '../types/domain';

const PRIORITY_RANK: Record<DeliveryPriority, number> = {
  normal: 0,
  high: 1,
  urgent: 2,
};

/**
 * Generates an operational stop grouping key.
 * CRITICAL RULES:
 * - Geographic proximity alone NEVER confirms two addresses are the same stop.
 * - Group only by normalized street + number + neighborhood + city (or shared confirmed condominium).
 * - Respect incompatible time windows (packages with non-overlapping windows stay separate).
 * - Never discard different packages because they share coordinates or address.
 */
export function buildStopGroupKey(pkg: DeliveryPackage): string {
  const norm = pkg.normalizedAddress;
  const street = norm.street
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  const number = (norm.number || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  const neighborhood = (norm.neighborhood || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
  const city = (norm.city || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

  // Include time window bucket so conflicting time windows aren't merged blindly
  const twKey = pkg.timeWindowStart || pkg.timeWindowEnd
    ? `tw:${pkg.timeWindowStart || ''}-${pkg.timeWindowEnd || ''}`
    : 'tw:any';

  if (!street || (!number && !norm.formatted)) {
    // Incomplete address: keep isolated by package id so it never silently merges with wrong neighbors
    return `isolated:${pkg.id}`;
  }

  return `addr:${street}|${number}|${neighborhood}|${city}|${twKey}`;
}

/**
 * Derives the stop status strictly from its associated packages.
 * Never marks a stop completed if any package is still pending/in_transit/loaded.
 */
export function deriveStopStatusFromPackages(packages: DeliveryPackage[]): StopStatus {
  if (packages.length === 0) return 'pending';

  const statuses = packages.map((p) => p.status);
  const deliveredCount = statuses.filter((s) => s === 'delivered').length;
  const failedCount = statuses.filter((s) => s === 'failed_attempt' || s === 'return_required' || s === 'returned').length;
  const postponedCount = statuses.filter((s) => s === 'postponed').length;
  const cancelledCount = statuses.filter((s) => s === 'cancelled').length;
  const activePendingCount = statuses.filter((s) => s === 'pending' || s === 'loaded' || s === 'in_transit').length;

  const total = packages.length;
  if (deliveredCount + cancelledCount === total && deliveredCount > 0) return 'completed';
  if (deliveredCount > 0 && (activePendingCount > 0 || failedCount > 0 || postponedCount > 0)) return 'partial';
  if (failedCount === total) return 'failed';
  if (postponedCount === total) return 'postponed';
  if (failedCount + postponedCount === total && failedCount > 0) return 'failed';
  if (statuses.some((s) => s === 'in_transit')) return 'in_progress';
  return 'pending';
}

/**
 * Groups packages into physical RouteStops while preserving every single package ID,
 * individual recipients/apartments, and computing realistic service durations.
 */
export function groupPackagesIntoStops(params: {
  packages: DeliveryPackage[];
  routeId: string;
  routeVersion: number;
  avgSecondsPerStop: number;
  extraSecondsPerPackage: number;
}): RouteStop[] {
  const { packages, routeId, routeVersion, avgSecondsPerStop, extraSecondsPerPackage } = params;

  const groups: Record<string, DeliveryPackage[]> = {};
  const groupOrder: string[] = [];

  for (const pkg of packages) {
    // Only exclude explicitly cancelled duplicates if user removed them; otherwise keep traceable
    const key = buildStopGroupKey(pkg);
    if (!groups[key]) {
      groups[key] = [];
      groupOrder.push(key);
    }
    groups[key].push(pkg);
  }

  return groupOrder.map((key, idx) => {
    const groupPkgs = groups[key];
    const primary = groupPkgs.find((p) => p.coordinates) || groupPkgs[0];

    // Highest priority among grouped packages
    let highestPriority: DeliveryPriority = 'normal';
    for (const p of groupPkgs) {
      if (PRIORITY_RANK[p.priority] > PRIORITY_RANK[highestPriority]) {
        highestPriority = p.priority;
      }
    }

    // Earliest original sequence if available
    const originalSeqs = groupPkgs
      .map((p) => p.originalSequence)
      .filter((n): n is number => typeof n === 'number');
    const originalSequence = originalSeqs.length > 0 ? Math.min(...originalSeqs) : undefined;

    // Distinct complements summary (apartments, blocks)
    const complements = Array.from(
      new Set(groupPkgs.map((p) => p.normalizedAddress.complement).filter(Boolean))
    );

    const totalItems = groupPkgs.reduce((acc, p) => acc + Math.max(1, p.quantity), 0);
    const serviceDurationSeconds =
      avgSecondsPerStop + Math.max(0, totalItems - 1) * extraSecondsPerPackage;

    // Best confidence among packages at same confirmed address
    const confidenceOrder = { confirmed: 3, high: 2, medium: 1, low: 0 };
    let bestConf = primary.locationConfidence;
    for (const p of groupPkgs) {
      if (confidenceOrder[p.locationConfidence] > confidenceOrder[bestConf]) {
        bestConf = p.locationConfidence;
      }
    }

    const addressLabel =
      primary.normalizedAddress.street && primary.normalizedAddress.number
        ? `${primary.normalizedAddress.street}, ${primary.normalizedAddress.number}`
        : primary.normalizedAddress.formatted || primary.originalAddress;

    return {
      id: `stop_${routeId}_v${routeVersion}_${idx + 1}`,
      routeId,
      routeVersion,
      sequence: idx + 1,
      originalSequence,
      groupKey: key,
      address: addressLabel,
      neighborhood: primary.normalizedAddress.neighborhood || 'Bairro não informado',
      city: primary.normalizedAddress.city || '',
      complementSummary: complements.length > 0 ? complements.join(' / ') : undefined,
      coordinates: primary.coordinates,
      locationConfidence: bestConf,
      packageIds: groupPkgs.map((p) => p.id),
      status: deriveStopStatusFromPackages(groupPkgs),
      priority: highestPriority,
      timeWindowStart: primary.timeWindowStart,
      timeWindowEnd: primary.timeWindowEnd,
      serviceDurationSeconds,
    };
  });
}

/**
 * Splits a multi-package stop into individual stops (manual ungroup).
 */
export function splitStop(
  stops: RouteStop[],
  stopId: string,
  packagesById: Record<string, DeliveryPackage>,
  avgSecondsPerStop: number,
  extraSecondsPerPackage: number
): RouteStop[] {
  const result: RouteStop[] = [];
  for (const stop of stops) {
    if (stop.id !== stopId || stop.packageIds.length <= 1) {
      result.push(stop);
      continue;
    }
    stop.packageIds.forEach((pkgId, i) => {
      const pkg = packagesById[pkgId];
      result.push({
        ...stop,
        id: `${stop.id}_split_${i + 1}`,
        groupKey: `manual_split:${pkgId}`,
        packageIds: [pkgId],
        complementSummary: pkg?.normalizedAddress.complement || stop.complementSummary,
        status: pkg ? deriveStopStatusFromPackages([pkg]) : stop.status,
        serviceDurationSeconds:
          avgSecondsPerStop + Math.max(0, (pkg?.quantity || 1) - 1) * extraSecondsPerPackage,
      });
    });
  }
  return result.map((s, idx) => ({ ...s, sequence: idx + 1 }));
}

/**
 * Merges two stops manually into one stop while preserving all packageIds and individual statuses.
 */
export function mergeStops(
  stops: RouteStop[],
  targetStopId: string,
  sourceStopId: string,
  packagesById: Record<string, DeliveryPackage>,
  avgSecondsPerStop: number,
  extraSecondsPerPackage: number
): RouteStop[] {
  const target = stops.find((s) => s.id === targetStopId);
  const source = stops.find((s) => s.id === sourceStopId);
  if (!target || !source || targetStopId === sourceStopId) return stops;

  const mergedIds = Array.from(new Set([...target.packageIds, ...source.packageIds]));
  const mergedPkgs = mergedIds.map((id) => packagesById[id]).filter(Boolean);
  const complements = Array.from(
    new Set(mergedPkgs.map((p) => p.normalizedAddress.complement).filter(Boolean))
  );
  const totalItems = mergedPkgs.reduce((acc, p) => acc + Math.max(1, p.quantity), 0);

  return stops
    .filter((s) => s.id !== sourceStopId)
    .map((s) =>
      s.id === targetStopId
        ? {
            ...s,
            packageIds: mergedIds,
            complementSummary: complements.length > 0 ? complements.join(' / ') : s.complementSummary,
            status: deriveStopStatusFromPackages(mergedPkgs),
            serviceDurationSeconds:
              avgSecondsPerStop + Math.max(0, totalItems - 1) * extraSecondsPerPackage,
          }
        : s
    )
    .map((s, idx) => ({ ...s, sequence: idx + 1 }));
}
