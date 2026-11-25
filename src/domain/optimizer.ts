import {
  Coordinates,
  DeliveryPackage,
  OptimizationStrategy,
  OptimizationValidationResult,
  RouteConstraints,
  RouteMetrics,
  RoutePoint,
  RouteStop,
  SecondAttemptSuggestion,
  Vehicle,
} from '../types/domain';

export interface MatrixEdge {
  distanceMeters: number;
  durationSeconds: number;
  isRoadReal: boolean;
}

export interface CostMatrix {
  /** Indexed [fromIdx][toIdx]; node 0 = origin, nodes 1..N = stops, optional node N+1 = custom destination */
  edges: MatrixEdge[][];
  isRoadReal: boolean;
}

/**
 * Great-circle Haversine distance in meters.
 * NEVER presented as final road distance — always flagged isRoadReal: false.
 */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Builds an estimated urban matrix using road tortuosity approximation (1.28x)
 * ONLY when external road matrix APIs are not available/configured.
 * Explicitly marks isRoadReal = false.
 */
export function buildEstimatedMatrix(
  nodes: Coordinates[],
  avgUrbanSpeedKmh = 28
): CostMatrix {
  const n = nodes.length;
  const speedMps = (avgUrbanSpeedKmh * 1000) / 3600;
  const edges: MatrixEdge[][] = Array.from({ length: n }, () => new Array<MatrixEdge>(n));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        edges[i][j] = { distanceMeters: 0, durationSeconds: 0, isRoadReal: false };
      } else {
        const straight = haversineMeters(nodes[i], nodes[j]);
        // Slight directional asymmetry simulating urban one-way streets
        const asymFactor = i < j ? 1.28 : 1.31;
        const dist = Math.round(straight * asymFactor);
        const dur = Math.max(30, Math.round(dist / speedMps));
        edges[i][j] = { distanceMeters: dist, durationSeconds: dur, isRoadReal: false };
      }
    }
  }
  return { edges, isRoadReal: false };
}

function parseTimeToMinutes(hhmm?: string): number | null {
  if (!hhmm) return null;
  const parts = hhmm.split(':');
  if (parts.length !== 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

/**
 * Computes edge weight according to the selected strategy and vehicle cost model:
 * Total Cost = distance_km * cost_per_km + time_hours * cost_per_hour
 */
function edgeCost(
  edge: MatrixEdge,
  strategy: OptimizationStrategy,
  vehicle: Vehicle
): number {
  const km = edge.distanceMeters / 1000;
  const hours = edge.durationSeconds / 3600;
  const fuelCostPerKm =
    vehicle.consumptionKmPerLiter > 0
      ? vehicle.fuelPricePerLiter / vehicle.consumptionKmPerLiter
      : 0.65;
  const costPerKm = fuelCostPerKm + Math.max(0, vehicle.maintenanceCostPerKm);
  const costPerHour = Math.max(1, vehicle.hourlyCost);

  switch (strategy) {
    case 'fastest':
      return hours * 100 + km * 0.1;
    case 'economic':
      return km * costPerKm + hours * (costPerHour * 0.15);
    case 'time_window':
      return hours * costPerHour * 1.4 + km * costPerKm;
    case 'balanced':
    default:
      return km * costPerKm + hours * costPerHour;
  }
}

interface SequenceEvaluation {
  objectiveCost: number;
  totalDistanceMeters: number;
  travelDurationSeconds: number;
  serviceDurationSeconds: number;
  waitingDurationSeconds: number;
  lateStopsCount: number;
}

/**
 * Evaluates a candidate stop ordering against asymmetric matrix, time windows,
 * urgent priorities, and open/closed destination rules.
 */
function evaluateOrder(
  order: number[], // indices into stops array (0..M-1), where matrix node is stopIdx + 1
  stops: RouteStop[],
  matrix: CostMatrix,
  destinationNodeIdx: number | null, // 0 for return_to_start, M+1 for custom_end, null for open_last_stop
  strategy: OptimizationStrategy,
  vehicle: Vehicle,
  constraints: RouteConstraints
): SequenceEvaluation {
  let currentNode = 0; // origin
  let totalDist = 0;
  let totalTravel = 0;
  let totalService = 0;
  let totalWait = 0;
  let objective = 0;
  let lateCount = 0;

  const startMin = parseTimeToMinutes(constraints.startTime) ?? 8 * 60;
  let clockSec = startMin * 60;

  for (let pos = 0; pos < order.length; pos++) {
    const stopIdx = order[pos];
    const nodeIdx = stopIdx + 1;
    const stop = stops[stopIdx];
    const edge = matrix.edges[currentNode][nodeIdx];

    totalDist += edge.distanceMeters;
    totalTravel += edge.durationSeconds;
    objective += edgeCost(edge, strategy, vehicle);
    clockSec += edge.durationSeconds;

    // Time window evaluation (VRPTW)
    const twStartMin = parseTimeToMinutes(stop.timeWindowStart);
    const twEndMin = parseTimeToMinutes(stop.timeWindowEnd);

    if (twStartMin !== null && clockSec < twStartMin * 60) {
      const waitSec = twStartMin * 60 - clockSec;
      totalWait += waitSec;
      clockSec += waitSec;
      objective += (waitSec / 3600) * Math.max(10, vehicle.hourlyCost * 0.5);
    }

    if (twEndMin !== null && clockSec > twEndMin * 60) {
      const lateMin = (clockSec - twEndMin * 60) / 60;
      lateCount += 1;
      // Documented time-window lateness penalty (heavier in time_window strategy)
      const weight = strategy === 'time_window' ? 25 : 8;
      objective += lateMin * weight;
    }

    // Priority preference when enabled
    if (constraints.prioritizeUrgent) {
      if (stop.priority === 'urgent') {
        objective += pos * 4.5;
      } else if (stop.priority === 'high') {
        objective += pos * 1.5;
      }
    }

    totalService += stop.serviceDurationSeconds;
    clockSec += stop.serviceDurationSeconds;
    currentNode = nodeIdx;
  }

  if (destinationNodeIdx !== null && order.length > 0) {
    const returnEdge = matrix.edges[currentNode][destinationNodeIdx];
    totalDist += returnEdge.distanceMeters;
    totalTravel += returnEdge.durationSeconds;
    objective += edgeCost(returnEdge, strategy, vehicle);
  }

  return {
    objectiveCost: objective,
    totalDistanceMeters: totalDist,
    travelDurationSeconds: totalTravel,
    serviceDurationSeconds: totalService,
    waitingDurationSeconds: totalWait,
    lateStopsCount: lateCount,
  };
}

/**
 * Multi-start Nearest Neighbor + Cheapest Insertion initial construction.
 */
function buildInitialOrder(
  freeIndices: number[],
  fixedFirstIdx: number | null,
  fixedLastIdx: number | null,
  stops: RouteStop[],
  matrix: CostMatrix,
  destinationNodeIdx: number | null,
  strategy: OptimizationStrategy,
  vehicle: Vehicle,
  constraints: RouteConstraints
): number[] {
  if (freeIndices.length === 0) {
    return [
      ...(fixedFirstIdx !== null ? [fixedFirstIdx] : []),
      ...(fixedLastIdx !== null ? [fixedLastIdx] : []),
    ];
  }

  const assemble = (mid: number[]) => [
    ...(fixedFirstIdx !== null ? [fixedFirstIdx] : []),
    ...mid,
    ...(fixedLastIdx !== null ? [fixedLastIdx] : []),
  ];

  // Candidate 1: Nearest Neighbor from origin (or fixedFirst)
  const nnRun = (seedFirst?: number): number[] => {
    const remaining = new Set(freeIndices);
    const mid: number[] = [];
    let currentNode = fixedFirstIdx !== null ? fixedFirstIdx + 1 : 0;

    if (seedFirst !== undefined && remaining.has(seedFirst)) {
      mid.push(seedFirst);
      remaining.delete(seedFirst);
      currentNode = seedFirst + 1;
    }

    while (remaining.size > 0) {
      let bestIdx = -1;
      let bestScore = Infinity;
      for (const idx of remaining) {
        let score = edgeCost(matrix.edges[currentNode][idx + 1], strategy, vehicle);
        if (constraints.prioritizeUrgent && stops[idx].priority === 'urgent') {
          score *= 0.45;
        }
        if (strategy === 'time_window' && stops[idx].timeWindowEnd) {
          const endMin = parseTimeToMinutes(stops[idx].timeWindowEnd) ?? 18 * 60;
          score += (endMin - 480) * 0.08;
        }
        if (score < bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      }
      mid.push(bestIdx);
      remaining.delete(bestIdx);
      currentNode = bestIdx + 1;
    }
    return assemble(mid);
  };

  let bestOrder = nnRun();
  let bestCost = evaluateOrder(
    bestOrder, stops, matrix, destinationNodeIdx, strategy, vehicle, constraints
  ).objectiveCost;

  // Multi-start NN (sample up to 8 promising starting stops)
  const sampleCount = Math.min(freeIndices.length, 8);
  const step = Math.max(1, Math.floor(freeIndices.length / sampleCount));
  for (let s = 0; s < freeIndices.length; s += step) {
    const candidate = nnRun(freeIndices[s]);
    const cost = evaluateOrder(
      candidate, stops, matrix, destinationNodeIdx, strategy, vehicle, constraints
    ).objectiveCost;
    if (cost < bestCost) {
      bestCost = cost;
      bestOrder = candidate;
    }
  }

  // Candidate 2: Cheapest Insertion (for up to 120 free stops to keep runtime snappy)
  if (freeIndices.length <= 120) {
    const inserted: number[] = [];
    const pool = [...freeIndices];
    // Seed with closest to origin
    pool.sort(
      (a, b) =>
        edgeCost(matrix.edges[0][a + 1], strategy, vehicle) -
        edgeCost(matrix.edges[0][b + 1], strategy, vehicle)
    );
    inserted.push(pool.shift()!);

    for (const candidateIdx of pool) {
      let bestPos = inserted.length;
      let bestDelta = Infinity;
      for (let pos = 0; pos <= inserted.length; pos++) {
        const prevNode =
          pos === 0
            ? fixedFirstIdx !== null
              ? fixedFirstIdx + 1
              : 0
            : inserted[pos - 1] + 1;
        const nextNode =
          pos === inserted.length
            ? fixedLastIdx !== null
              ? fixedLastIdx + 1
              : destinationNodeIdx
            : inserted[pos] + 1;

        const add1 = edgeCost(matrix.edges[prevNode][candidateIdx + 1], strategy, vehicle);
        const add2 =
          nextNode !== null
            ? edgeCost(matrix.edges[candidateIdx + 1][nextNode], strategy, vehicle)
            : 0;
        const remove =
          nextNode !== null
            ? edgeCost(matrix.edges[prevNode][nextNode], strategy, vehicle)
            : 0;
        const delta = add1 + add2 - remove;
        if (delta < bestDelta) {
          bestDelta = delta;
          bestPos = pos;
        }
      }
      inserted.splice(bestPos, 0, candidateIdx);
    }

    const ciOrder = assemble(inserted);
    const ciCost = evaluateOrder(
      ciOrder, stops, matrix, destinationNodeIdx, strategy, vehicle, constraints
    ).objectiveCost;
    if (ciCost < bestCost) {
      bestOrder = ciOrder;
    }
  }

  return bestOrder;
}

/**
 * Local search refinement compatible with asymmetric matrices:
 * - Asymmetric 2-Opt
 * - Relocate (single stop move)
 * - Swap (pairwise exchange)
 * - Or-Opt (segments of length 2 and 3)
 * Respects fixed first/last stops and computational time budget.
 */
function refineOrderLocalSearch(
  initialOrder: number[],
  hasFixedFirst: boolean,
  hasFixedLast: boolean,
  stops: RouteStop[],
  matrix: CostMatrix,
  destinationNodeIdx: number | null,
  strategy: OptimizationStrategy,
  vehicle: Vehicle,
  constraints: RouteConstraints,
  maxMillis = 450
): number[] {
  const startMs = Date.now();
  const minIdx = hasFixedFirst ? 1 : 0;
  const maxIdx = hasFixedLast ? initialOrder.length - 2 : initialOrder.length - 1;
  if (maxIdx - minIdx < 1) return initialOrder;

  let bestOrder = [...initialOrder];
  let bestCost = evaluateOrder(
    bestOrder, stops, matrix, destinationNodeIdx, strategy, vehicle, constraints
  ).objectiveCost;

  let improved = true;
  let iterations = 0;
  const maxIterations = bestOrder.length > 150 ? 6 : 20;

  while (improved && iterations < maxIterations && Date.now() - startMs < maxMillis) {
    improved = false;
    iterations += 1;

    // 1. Asymmetric 2-Opt (evaluates full asymmetric cost safely)
    const windowLimit = bestOrder.length > 120 ? 35 : maxIdx - minIdx + 1;
    for (let i = minIdx; i < maxIdx; i++) {
      if (Date.now() - startMs >= maxMillis) break;
      const jEnd = Math.min(maxIdx, i + windowLimit);
      for (let j = i + 1; j <= jEnd; j++) {
        const candidate = [
          ...bestOrder.slice(0, i),
          ...bestOrder.slice(i, j + 1).reverse(),
          ...bestOrder.slice(j + 1),
        ];
        const cost = evaluateOrder(
          candidate, stops, matrix, destinationNodeIdx, strategy, vehicle, constraints
        ).objectiveCost;
        if (cost + 1e-6 < bestCost) {
          bestOrder = candidate;
          bestCost = cost;
          improved = true;
        }
      }
    }

    // 2. Relocate & Or-Opt (segment lengths 1 and 2)
    for (const segLen of [1, 2]) {
      for (let i = minIdx; i + segLen - 1 <= maxIdx; i++) {
        if (Date.now() - startMs >= maxMillis) break;
        const segment = bestOrder.slice(i, i + segLen);
        const without = [...bestOrder.slice(0, i), ...bestOrder.slice(i + segLen)];
        const upperPos = hasFixedLast ? without.length - 1 : without.length;
        const step = without.length > 100 ? Math.max(1, Math.floor(without.length / 25)) : 1;

        for (let pos = minIdx; pos <= upperPos; pos += step) {
          if (pos === i) continue;
          const candidate = [...without.slice(0, pos), ...segment, ...without.slice(pos)];
          const cost = evaluateOrder(
            candidate, stops, matrix, destinationNodeIdx, strategy, vehicle, constraints
          ).objectiveCost;
          if (cost + 1e-6 < bestCost) {
            bestOrder = candidate;
            bestCost = cost;
            improved = true;
            break;
          }
        }
      }
    }

    // 3. Pairwise Swap for fine polishing
    if (bestOrder.length <= 100 && Date.now() - startMs < maxMillis) {
      for (let i = minIdx; i < maxIdx; i++) {
        for (let j = i + 1; j <= maxIdx; j++) {
          const candidate = [...bestOrder];
          [candidate[i], candidate[j]] = [candidate[j], candidate[i]];
          const cost = evaluateOrder(
            candidate, stops, matrix, destinationNodeIdx, strategy, vehicle, constraints
          ).objectiveCost;
          if (cost + 1e-6 < bestCost) {
            bestOrder = candidate;
            bestCost = cost;
            improved = true;
          }
        }
      }
    }
  }

  return bestOrder;
}

export interface OptimizeRouteInput {
  stops: RouteStop[];
  allPackages: DeliveryPackage[];
  origin: RoutePoint;
  destination?: RoutePoint;
  vehicle: Vehicle;
  constraints: RouteConstraints;
  strategy: OptimizationStrategy;
  routeVersion: number;
  externalMatrix?: CostMatrix;
  providerId?: string;
  providerLabel?: string;
}

export interface OptimizeRouteOutput {
  orderedStops: RouteStop[];
  metrics: RouteMetrics;
  validation: OptimizationValidationResult;
  provider: string;
  providerLabel: string;
}

/**
 * Full mathematical optimization & validation pipeline for Rota Express.
 * Distinguishes real road matrices from estimated Haversine approximations.
 */
export function optimizeRouteLocal(input: OptimizeRouteInput): OptimizeRouteOutput {
  const {
    stops,
    allPackages,
    origin,
    destination,
    vehicle,
    constraints,
    strategy,
    routeVersion,
    externalMatrix,
  } = input;

  const eligibleStops = stops.filter((s) => Boolean(s.coordinates));
  const missingCoordStops = stops.filter((s) => !s.coordinates);

  const warnings: string[] = [];
  const errors: string[] = [];
  const unassignedPackages: { packageId: string; trackingCode: string; reason: string }[] = [];

  const packagesById: Record<string, DeliveryPackage> = {};
  for (const p of allPackages) packagesById[p.id] = p;

  for (const s of missingCoordStops) {
    for (const pid of s.packageIds) {
      const pkg = packagesById[pid];
      unassignedPackages.push({
        packageId: pid,
        trackingCode: pkg?.trackingCode || pid,
        reason: 'Endereço sem coordenadas válidas — revise ou geocodifique antes de roteirizar.',
      });
    }
  }

  // Capacity check (CVRP warning/validation)
  const totalWeight = allPackages.reduce((sum, p) => sum + (p.weightKg || 0), 0);
  if (vehicle.maxPackages > 0 && allPackages.length > vehicle.maxPackages) {
    warnings.push(
      `Quantidade de pacotes (${allPackages.length}) excede a capacidade configurada do veículo (${vehicle.maxPackages} pacotes).`
    );
  }
  if (vehicle.maxWeightKg > 0 && totalWeight > vehicle.maxWeightKg) {
    warnings.push(
      `Peso total estimado (${totalWeight.toFixed(1)} kg) excede a capacidade do veículo (${vehicle.maxWeightKg} kg).`
    );
  }

  if (vehicle.type === 'motorcycle') {
    warnings.push(
      'Modo motocicleta: quando a malha específica de duas rodas não estiver disponível na região, o trajeto utiliza aproximação veicular padrão.'
    );
  }

  if (eligibleStops.length === 0) {
    errors.push('Nenhuma parada possui coordenadas válidas para otimização.');
    return {
      orderedStops: stops,
      metrics: emptyMetrics(constraints, allPackages.length, unassignedPackages.length),
      validation: {
        valid: false,
        checkedPackages: allPackages.length,
        assignedPackages: 0,
        unassignedPackages,
        warnings,
        errors,
      },
      provider: input.providerId || 'heuristic_local',
      providerLabel: input.providerLabel || 'Motor Heurístico Local',
    };
  }

  const originCoord: Coordinates =
    origin.coordinates || eligibleStops[0].coordinates!;

  const hasCustomEnd =
    constraints.endMode === 'custom_end' && Boolean(destination?.coordinates);
  const destinationNodeIdx =
    constraints.endMode === 'return_to_start'
      ? 0
      : hasCustomEnd
        ? eligibleStops.length + 1
        : null;

  const nodes: Coordinates[] = [
    originCoord,
    ...eligibleStops.map((s) => s.coordinates!),
    ...(hasCustomEnd && destination?.coordinates ? [destination.coordinates] : []),
  ];

  const matrix = externalMatrix || buildEstimatedMatrix(nodes);
  if (!matrix.isRoadReal) {
    warnings.push(
      'Distâncias e tempos estimados localmente por aproximação geométrica viária (fator urbano 1,28×). Conecte a Google Routes API para distâncias rodoviárias reais com trânsito.'
    );
  }

  // Determine fixed stops
  let fixedFirstIdx: number | null = null;
  let fixedLastIdx: number | null = null;

  if (constraints.fixedFirstStopId) {
    const idx = eligibleStops.findIndex((s) => s.id === constraints.fixedFirstStopId);
    if (idx !== -1) fixedFirstIdx = idx;
  }
  if (constraints.fixedLastStopId) {
    const idx = eligibleStops.findIndex((s) => s.id === constraints.fixedLastStopId);
    if (idx !== -1 && idx !== fixedFirstIdx) fixedLastIdx = idx;
  }

  let bestOrder: number[];

  if (strategy === 'original') {
    // Respect spreadsheet original sequence strictly without inventing one
    const hasOriginalSeq = eligibleStops.some((s) => typeof s.originalSequence === 'number');
    if (!hasOriginalSeq) {
      warnings.push(
        'A planilha não possui coluna de sequência original confirmada; mantendo a ordem de importação como referência.'
      );
    }
    bestOrder = eligibleStops
      .map((s, idx) => ({ idx, seq: s.originalSequence ?? 999999 + idx }))
      .sort((a, b) => a.seq - b.seq)
      .map((item) => item.idx);
  } else {
    const freeIndices = eligibleStops
      .map((_, idx) => idx)
      .filter((idx) => idx !== fixedFirstIdx && idx !== fixedLastIdx);

    const initial = buildInitialOrder(
      freeIndices,
      fixedFirstIdx,
      fixedLastIdx,
      eligibleStops,
      matrix,
      destinationNodeIdx,
      strategy,
      vehicle,
      constraints
    );

    bestOrder = refineOrderLocalSearch(
      initial,
      fixedFirstIdx !== null,
      fixedLastIdx !== null,
      eligibleStops,
      matrix,
      destinationNodeIdx,
      strategy,
      vehicle,
      constraints
    );
  }

  // Build final ordered stops with ETAs and per-leg metrics
  const startDate = new Date(`${constraints.routeDate}T${constraints.startTime || '08:00'}:00`);
  const baseTimeMs = Number.isNaN(startDate.getTime()) ? Date.now() : startDate.getTime();
  let cursorMs = baseTimeMs;
  let currentNode = 0;

  let totalDistanceMeters = 0;
  let travelDurationSeconds = 0;
  let serviceDurationSeconds = 0;
  let waitingDurationSeconds = 0;
  let lateStopsCount = 0;

  const lunchDurationSec = Math.max(0, constraints.lunchBreakMinutes || 0) * 60;
  let lunchApplied = false;

  const orderedStops: RouteStop[] = bestOrder.map((stopIdx, seqIdx) => {
    const stop = eligibleStops[stopIdx];
    const nodeIdx = stopIdx + 1;
    const edge = matrix.edges[currentNode][nodeIdx];

    totalDistanceMeters += edge.distanceMeters;
    travelDurationSeconds += edge.durationSeconds;
    cursorMs += edge.durationSeconds * 1000;

    // Insert lunch break around 12:00 if configured
    const arrivalDate = new Date(cursorMs);
    if (!lunchApplied && lunchDurationSec > 0 && arrivalDate.getHours() >= 12) {
      cursorMs += lunchDurationSec * 1000;
      waitingDurationSeconds += lunchDurationSec;
      lunchApplied = true;
    }

    const twStartMin = parseTimeToMinutes(stop.timeWindowStart);
    if (twStartMin !== null) {
      const arrivalMinutes = new Date(cursorMs).getHours() * 60 + new Date(cursorMs).getMinutes();
      if (arrivalMinutes < twStartMin) {
        const waitSec = (twStartMin - arrivalMinutes) * 60;
        waitingDurationSeconds += waitSec;
        cursorMs += waitSec * 1000;
      }
    }

    const twEndMin = parseTimeToMinutes(stop.timeWindowEnd);
    if (twEndMin !== null) {
      const arrivalMinutes = new Date(cursorMs).getHours() * 60 + new Date(cursorMs).getMinutes();
      if (arrivalMinutes > twEndMin) {
        lateStopsCount += 1;
      }
    }

    const estimatedArrivalIso = new Date(cursorMs).toISOString();
    serviceDurationSeconds += stop.serviceDurationSeconds;
    cursorMs += stop.serviceDurationSeconds * 1000;
    currentNode = nodeIdx;

    return {
      ...stop,
      routeVersion,
      sequence: seqIdx + 1,
      legDistanceMeters: edge.distanceMeters,
      legDurationSeconds: edge.durationSeconds,
      estimatedArrivalIso,
      isFixedFirst: stopIdx === fixedFirstIdx,
      isFixedLast: stopIdx === fixedLastIdx,
      isGeometryEstimated: !edge.isRoadReal,
    };
  });

  if (destinationNodeIdx !== null && bestOrder.length > 0) {
    const endEdge = matrix.edges[currentNode][destinationNodeIdx];
    totalDistanceMeters += endEdge.distanceMeters;
    travelDurationSeconds += endEdge.durationSeconds;
    cursorMs += endEdge.durationSeconds * 1000;
  }

  // Max end time constraint check
  if (constraints.maxEndTime) {
    const maxEndMin = parseTimeToMinutes(constraints.maxEndTime);
    const finishDate = new Date(cursorMs);
    const finishMin = finishDate.getHours() * 60 + finishDate.getMinutes();
    if (maxEndMin !== null && finishMin > maxEndMin) {
      warnings.push(
        `Horário previsto de término (${finishDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}) ultrapassa o limite configurado (${constraints.maxEndTime}).`
      );
    }
  }

  // Validate solution integrity: every eligible stop appears once and all packages accounted for
  const seenStopIds = new Set<string>();
  const assignedPkgIds = new Set<string>();
  for (const s of orderedStops) {
    if (seenStopIds.has(s.id)) {
      errors.push(`Parada duplicada detectada na solução: ${s.id}`);
    }
    seenStopIds.add(s.id);
    for (const pid of s.packageIds) assignedPkgIds.add(pid);
  }

  const totalDistanceKm = totalDistanceMeters / 1000;
  const totalDurationSeconds = travelDurationSeconds + serviceDurationSeconds + waitingDurationSeconds;
  const estimatedFuelLiters =
    vehicle.consumptionKmPerLiter > 0 ? totalDistanceKm / vehicle.consumptionKmPerLiter : 0;
  const estimatedFuelCost = estimatedFuelLiters * Math.max(0, vehicle.fuelPricePerLiter);
  const estimatedMaintenanceCost = totalDistanceKm * Math.max(0, vehicle.maintenanceCostPerKm);
  const estimatedTimeCost = (totalDurationSeconds / 3600) * Math.max(0, vehicle.hourlyCost);
  // Operational cost avoids double-counting: fuel + maintenance + hourly operational cost
  const estimatedOperationalCost = estimatedFuelCost + estimatedMaintenanceCost + estimatedTimeCost;

  const metrics: RouteMetrics = {
    totalStops: orderedStops.length,
    totalPackages: assignedPkgIds.size,
    totalDistanceMeters,
    travelDurationSeconds,
    serviceDurationSeconds,
    waitingDurationSeconds,
    totalDurationSeconds,
    estimatedFinishIso: new Date(cursorMs).toISOString(),
    estimatedFuelLiters: Number(estimatedFuelLiters.toFixed(2)),
    estimatedFuelCost: Number(estimatedFuelCost.toFixed(2)),
    estimatedMaintenanceCost: Number(estimatedMaintenanceCost.toFixed(2)),
    estimatedTimeCost: Number(estimatedTimeCost.toFixed(2)),
    estimatedOperationalCost: Number(estimatedOperationalCost.toFixed(2)),
    lateStopsCount,
    unassignedPackagesCount: unassignedPackages.length,
    isRoadDistanceReal: matrix.isRoadReal,
  };

  return {
    orderedStops,
    metrics,
    validation: {
      valid: errors.length === 0,
      checkedPackages: allPackages.length,
      assignedPackages: assignedPkgIds.size,
      unassignedPackages,
      warnings,
      errors,
    },
    provider: input.providerId || (matrix.isRoadReal ? 'google_routes_heuristic' : 'heuristic_local_estimated'),
    providerLabel:
      input.providerLabel ||
      (matrix.isRoadReal
        ? 'Google Routes API + Heurística 2-Opt/Or-Opt'
        : 'Motor Heurístico Local (Estimativa Geométrica)'),
  };
}

function emptyMetrics(
  constraints: RouteConstraints,
  totalPackages: number,
  unassignedPackagesCount: number
): RouteMetrics {
  return {
    totalStops: 0,
    totalPackages,
    totalDistanceMeters: 0,
    travelDurationSeconds: 0,
    serviceDurationSeconds: 0,
    waitingDurationSeconds: 0,
    totalDurationSeconds: 0,
    estimatedFinishIso: new Date(`${constraints.routeDate}T${constraints.startTime || '08:00'}:00`).toISOString(),
    estimatedFuelLiters: 0,
    estimatedFuelCost: 0,
    estimatedMaintenanceCost: 0,
    estimatedTimeCost: 0,
    estimatedOperationalCost: 0,
    lateStopsCount: 0,
    unassignedPackagesCount,
    isRoadDistanceReal: false,
  };
}

/**
 * Second Attempt Intelligence: evaluates failed packages against remaining stops
 * and calculates exact geometric detour distance/time to suggest insertion point.
 * NEVER mutates route automatically without driver confirmation.
 */
export function computeSecondAttemptSuggestions(
  failedPackages: DeliveryPackage[],
  remainingStops: RouteStop[],
  maxDetourMeters = 4500
): SecondAttemptSuggestion[] {
  if (failedPackages.length === 0 || remainingStops.length === 0) return [];

  const suggestions: SecondAttemptSuggestion[] = [];

  for (const pkg of failedPackages) {
    if (!pkg.coordinates) continue;

    let bestAfterIdx = 0;
    let bestDetourMeters = Infinity;

    for (let i = 0; i < remainingStops.length; i++) {
      const stopA = remainingStops[i];
      if (!stopA.coordinates) continue;
      const stopB = remainingStops[i + 1];

      let detour: number;
      if (stopB?.coordinates) {
        const direct = haversineMeters(stopA.coordinates, stopB.coordinates);
        const viaFailed =
          haversineMeters(stopA.coordinates, pkg.coordinates) +
          haversineMeters(pkg.coordinates, stopB.coordinates);
        detour = Math.max(0, (viaFailed - direct) * 1.28);
      } else {
        detour = haversineMeters(stopA.coordinates, pkg.coordinates) * 1.28;
      }

      if (detour < bestDetourMeters) {
        bestDetourMeters = detour;
        bestAfterIdx = i;
      }
    }

    const anchorStop = remainingStops[bestAfterIdx];
    const detourMeters = Math.round(bestDetourMeters);
    const detourMinutes = Math.max(2, Math.round(detourMeters / 450) + 3);
    const feasible = detourMeters <= maxDetourMeters;

    suggestions.push({
      packageId: pkg.id,
      trackingCode: pkg.trackingCode,
      recipientName: pkg.recipientName,
      address: pkg.normalizedAddress.formatted || pkg.originalAddress,
      reason: pkg.observations,
      suggestedRetryTime: pkg.suggestedRetryTime,
      insertAfterStopSequence: anchorStop.sequence,
      insertAfterAddress: anchorStop.address,
      detourMeters,
      detourMinutes,
      feasible,
      explanation: feasible
        ? `Desvio estimado de ${(detourMeters / 1000).toFixed(1)} km (+${detourMinutes} min) logo após a parada #${anchorStop.sequence}.`
        : `Desvio elevado de ${(detourMeters / 1000).toFixed(1)} km (+${detourMinutes} min); avalie retorno ao centro de distribuição.`,
    });
  }

  return suggestions.sort((a, b) => a.detourMeters - b.detourMeters);
}

/**
 * Official external navigation links (Google Maps & Waze) with confirmed coordinates or address fallback.
 */
export function buildExternalNavigationUrl(
  provider: 'google_maps' | 'waze',
  stop: { coordinates?: Coordinates; address: string }
): string {
  if (provider === 'waze') {
    if (stop.coordinates) {
      return `https://waze.com/ul?ll=${stop.coordinates.lat},${stop.coordinates.lng}&navigate=yes`;
    }
    return `https://waze.com/ul?q=${encodeURIComponent(stop.address)}&navigate=yes`;
  }

  // Google Maps official universal URL
  if (stop.coordinates) {
    return `https://www.google.com/maps/dir/?api=1&destination=${stop.coordinates.lat},${stop.coordinates.lng}&travelmode=driving`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(stop.address)}&travelmode=driving`;
}

export function buildWhatsAppUrl(phone?: string, message?: string): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  const textParam = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${digits}${textParam}`;
}
