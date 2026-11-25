import { describe, expect, it } from 'vitest';
import {
  buildAddressDeduplicationKey,
  classifyLocationConfidence,
  normalizeBrazilianAddress,
  normalizeBrazilianCep,
  validateCoordinates,
} from '../address';
import {
  autoMapColumns,
  buildPackagesFromSpreadsheet,
  escapeCsvFormulaInjection,
  sanitizeSpreadsheetCell,
} from '../spreadsheet';
import { deriveStopStatusFromPackages, groupPackagesIntoStops, mergeStops, splitStop } from '../grouping';
import {
  buildEstimatedMatrix,
  buildExternalNavigationUrl,
  buildWhatsAppUrl,
  computeSecondAttemptSuggestions,
  optimizeRouteLocal,
} from '../optimizer';
import { computeFinancialSummary, safeDivide } from '../financial';
import { DEFAULT_DEMO_VEHICLE, generateDemoPackages } from '../demoData';
import { DeliveryPackage, RouteConstraints, RoutePoint } from '../../types/domain';

describe('Brazilian Address & Coordinate Engine', () => {
  it('preserves leading zeros in Brazilian CEPs', () => {
    expect(normalizeBrazilianCep('01001000')).toEqual({ cep: '01001-000', valid: true });
    expect(normalizeBrazilianCep('04538-132')).toEqual({ cep: '04538-132', valid: true });
    expect(normalizeBrazilianCep('1234')).toEqual({ cep: '1234', valid: false });
  });

  it('normalizes Quadra/Lote/Setor and never invents missing property numbers', () => {
    const quadraLote = normalizeBrazilianAddress({
      street: 'R. T-37',
      complement: 'Qd. 12 Lt. 04',
      neighborhood: 'St. Bueno',
      city: 'Goiânia',
      state: 'go',
      postalCode: '74230022',
    });
    expect(quadraLote.street).toBe('Rua T-37');
    expect(quadraLote.neighborhood).toBe('Setor Bueno');
    expect(quadraLote.postalCode).toBe('74230-022');
    expect(quadraLote.issues).toHaveLength(0);

    const missingNumber = normalizeBrazilianAddress({
      street: 'Av. Goiás',
      neighborhood: 'Centro',
      city: 'Goiânia',
      state: 'GO',
    });
    expect(missingNumber.number).toBe('');
    expect(missingNumber.issues.some((i) => i.includes('nunca inventado'))).toBe(true);
  });

  it('detects and fixes inverted lat/lng coordinates for Brazil', () => {
    const swapped = validateCoordinates('-49.2648', '-16.6869');
    expect(swapped.valid).toBe(true);
    expect(swapped.invertedFixed).toBe(true);
    expect(swapped.coordinates).toEqual({ lat: -16.6869, lng: -49.2648 });

    const zero = validateCoordinates('0', '0');
    expect(zero.valid).toBe(false);
  });

  it('produces stable deduplication keys and strict confidence levels', () => {
    const a = normalizeBrazilianAddress({ street: 'Av. T-63', number: '1200', neighborhood: 'Setor Bueno', city: 'Goiânia', state: 'GO' });
    const b = normalizeBrazilianAddress({ street: 'Avenida T-63', number: '1200', neighborhood: 'St. Bueno', city: 'Goiania', state: 'GO' });
    expect(buildAddressDeduplicationKey(a, '')).toBe(buildAddressDeduplicationKey(b, ''));

    expect(
      classifyLocationConfidence({
        coordinates: { lat: -16.7, lng: -49.2 },
        source: 'manual_pin',
        normalized: a,
      })
    ).toBe('confirmed');
    expect(
      classifyLocationConfidence({
        coordinates: undefined,
        source: 'unresolved',
        normalized: a,
      })
    ).toBe('low');
  });
});

describe('Spreadsheet Parsing, Column Mapping & Formula Injection Protection', () => {
  it('escapes spreadsheet formula payloads on export and strips untrusted formulas on import', () => {
    expect(escapeCsvFormulaInjection('=HYPERLINK("http://evil","click")')).toBe('\'=HYPERLINK("http://evil","click")');
    expect(escapeCsvFormulaInjection('+cmd|\' /C calc\'!A0')).toBe('\'+cmd|\' /C calc\'!A0');
    expect(escapeCsvFormulaInjection('-16.6869')).toBe('-16.6869'); // Preserves valid negative coordinates
    expect(sanitizeSpreadsheetCell('=SUM(A1:A10)')).toBe('SUM(A1:A10)');
    expect(sanitizeSpreadsheetCell('-49.2648')).toBe('-49.2648');
  });

  it('recognizes Brazilian logistics headers and preserves leading zeros in tracking codes', () => {
    const headers = ['Rastreio', 'Destinatario', 'Logradouro', 'Numero', 'Bairro', 'Cidade', 'UF', 'CEP', 'Latitude', 'Longitude'];
    const { mapping } = autoMapColumns(headers);
    expect(mapping['Rastreio']).toBe('tracking_code');
    expect(mapping['Destinatario']).toBe('recipient_name');
    expect(mapping['CEP']).toBe('postal_code');

    const { packages, summary } = buildPackagesFromSpreadsheet({
      rows: [
        {
          Rastreio: '000987654321',
          Destinatario: 'Cliente Teste',
          Logradouro: 'Av. T-63',
          Numero: '500',
          Bairro: 'Setor Bueno',
          Cidade: 'Goiânia',
          UF: 'GO',
          CEP: '01001000',
          Latitude: '-16.7132',
          Longitude: '-49.2698',
        },
        {
          Rastreio: '000987654321', // Duplicate
          Destinatario: 'Cliente Teste 2',
          Logradouro: 'Av. T-63',
          Numero: '500',
          Bairro: 'Setor Bueno',
          Cidade: 'Goiânia',
          UF: 'GO',
          CEP: '01001000',
          Latitude: '-16.7132',
          Longitude: '-49.2698',
        },
        { Rastreio: '', Destinatario: '', Logradouro: '', Numero: '', Bairro: '', Cidade: '', UF: '', CEP: '', Latitude: '', Longitude: '' },
      ],
      mapping,
      defaultPlatform: 'Shopee',
      userId: 'u1',
      organizationId: 'o1',
      fileName: 'teste.csv',
      fileHash: 'h_1',
      sheetName: 'CSV',
    });

    expect(packages).toHaveLength(2);
    expect(packages[0].trackingCode).toBe('000987654321');
    expect(packages[0].normalizedAddress.postalCode).toBe('01001-000');
    expect(summary.duplicatePackages).toBe(1);
    expect(summary.emptyRowsSkipped).toBe(1);
  });
});

describe('Stop Grouping & Status Derivation', () => {
  it('groups same-address packages while preserving individual package IDs and derives partial status accurately', () => {
    const pkgs = generateDemoPackages(10);
    const stops = groupPackagesIntoStops({
      packages: pkgs,
      routeId: 'r1',
      routeVersion: 1,
      avgSecondsPerStop: 120,
      extraSecondsPerPackage: 20,
    });
    const totalGroupedPackageIds = stops.reduce((sum, s) => sum + s.packageIds.length, 0);
    expect(totalGroupedPackageIds).toBe(10); // No package silently dropped

    const multiStop = stops.find((s) => s.packageIds.length > 1);
    expect(multiStop).toBeDefined();

    const pkgMap: Record<string, DeliveryPackage> = {};
    pkgs.forEach((p) => (pkgMap[p.id] = p));

    // Split and merge preserve all package IDs
    const afterSplit = splitStop(stops, multiStop!.id, pkgMap, 120, 20);
    expect(afterSplit.length).toBeGreaterThan(stops.length);
    const afterMerge = mergeStops(afterSplit, afterSplit[0].id, afterSplit[1].id, pkgMap, 120, 20);
    expect(afterMerge.length).toBe(afterSplit.length - 1);

    // Partial status check
    const pair = [
      { ...pkgs[0], status: 'delivered' as const },
      { ...pkgs[1], status: 'pending' as const },
    ];
    expect(deriveStopStatusFromPackages(pair)).toBe('partial');
  });
});

describe('Combinatorial Route Optimizer & Second Attempt Intelligence', () => {
  const constraints: RouteConstraints = {
    routeDate: '2026-11-24',
    startTime: '08:00',
    maxEndTime: '18:00',
    avgSecondsPerStop: 120,
    extraSecondsPerPackage: 20,
    lunchBreakMinutes: 30,
    avoidTolls: false,
    avoidHighways: false,
    considerTraffic: true,
    prioritizeUrgent: true,
    preserveOriginalRouteSplit: false,
    endMode: 'open_last_stop',
  };

  it('optimizes route distance vs scrambled original order, respects fixed first/last stops, and validates all packages', () => {
    const pkgs = generateDemoPackages(50);
    const stops = groupPackagesIntoStops({
      packages: pkgs,
      routeId: 'r_opt',
      routeVersion: 1,
      avgSecondsPerStop: 120,
      extraSecondsPerPackage: 20,
    });
    const origin: RoutePoint = {
      label: 'CD Goiânia',
      address: 'Av. Perimetral Norte',
      coordinates: { lat: -16.6315, lng: -49.2662 },
      source: 'depot',
    };

    const origRes = optimizeRouteLocal({
      stops,
      allPackages: pkgs,
      origin,
      vehicle: DEFAULT_DEMO_VEHICLE,
      constraints,
      strategy: 'original',
      routeVersion: 1,
    });

    const optRes = optimizeRouteLocal({
      stops,
      allPackages: pkgs,
      origin,
      vehicle: DEFAULT_DEMO_VEHICLE,
      constraints,
      strategy: 'economic',
      routeVersion: 2,
    });

    expect(optRes.validation.valid).toBe(true);
    expect(optRes.metrics.totalDistanceMeters).toBeLessThan(origRes.metrics.totalDistanceMeters);
    expect(optRes.metrics.isRoadDistanceReal).toBe(false);

    // Fixed first/last stops test
    const validStops = stops.filter((s) => Boolean(s.coordinates));
    const fixedFirst = validStops[3].id;
    const fixedLast = validStops[1].id;
    const fixedRes = optimizeRouteLocal({
      stops: validStops,
      allPackages: pkgs,
      origin,
      vehicle: DEFAULT_DEMO_VEHICLE,
      constraints: { ...constraints, fixedFirstStopId: fixedFirst, fixedLastStopId: fixedLast },
      strategy: 'balanced',
      routeVersion: 3,
    });
    expect(fixedRes.orderedStops[0].id).toBe(fixedFirst);
    expect(fixedRes.orderedStops[fixedRes.orderedStops.length - 1].id).toBe(fixedLast);
  });

  it('supports asymmetric matrices cleanly and builds valid navigation & second-attempt suggestions', () => {
    const matrix = buildEstimatedMatrix([
      { lat: -16.68, lng: -49.26 },
      { lat: -16.70, lng: -49.27 },
    ]);
    expect(matrix.edges[0][1].distanceMeters).not.toBe(matrix.edges[1][0].distanceMeters);

    const pkgs = generateDemoPackages(10);
    const stops = groupPackagesIntoStops({
      packages: pkgs,
      routeId: 'r2',
      routeVersion: 1,
      avgSecondsPerStop: 120,
      extraSecondsPerPackage: 20,
    });
    const failed = [{ ...pkgs[0], status: 'failed_attempt' as const }];
    const suggestions = computeSecondAttemptSuggestions(failed, stops.slice(1));
    expect(suggestions.length).toBe(1);
    expect(suggestions[0].detourMeters).toBeGreaterThanOrEqual(0);

    expect(buildExternalNavigationUrl('google_maps', { coordinates: { lat: -16.7, lng: -49.2 }, address: 'Av T-63' })).toContain(
      'google.com/maps/dir'
    );
    expect(buildExternalNavigationUrl('waze', { coordinates: { lat: -16.7, lng: -49.2 }, address: 'Av T-63' })).toContain(
      'waze.com/ul'
    );
    expect(buildWhatsAppUrl('(62) 99900-1234', 'Olá')).toContain('wa.me/5562999001234');
  });
});

describe('Financial Engine Safety & No Double-Counting', () => {
  it('prevents division by zero and avoids double-counting fuel when real fuel expense is recorded', () => {
    expect(safeDivide(100, 0)).toBeNull();
    expect(safeDivide(100, 4)).toBe(25);

    const summaryWithoutFuel = computeFinancialSummary({
      entries: [
        {
          id: 'r1',
          userId: 'u1',
          type: 'revenue',
          category: 'valor_fixo_rota',
          description: 'Diária',
          amount: 200,
          isEstimated: false,
          date: '2026-11-24',
          createdAt: '2026-11-24T08:00:00Z',
        },
      ],
      routes: [
        {
          id: 'route_1',
          userId: 'u1',
          organizationId: 'org_1',
          name: 'Rota Teste',
          vehicleId: DEFAULT_DEMO_VEHICLE.id,
          status: 'finished',
          activeVersion: 1,
          origin: { label: 'CD', address: 'CD', source: 'depot' },
          constraints: {
            routeDate: '2026-11-24',
            startTime: '08:00',
            avgSecondsPerStop: 120,
            extraSecondsPerPackage: 20,
            lunchBreakMinutes: 0,
            avoidTolls: false,
            avoidHighways: false,
            considerTraffic: false,
            prioritizeUrgent: false,
            preserveOriginalRouteSplit: false,
            endMode: 'open_last_stop',
          },
          selectedStrategy: 'balanced',
          isDemo: false,
          recordedDistanceKm: 50,
          versions: [
            {
              version: 1,
              strategy: 'balanced',
              provider: 'local',
              providerLabel: 'Local',
              stops: [],
              metrics: {
                totalStops: 10,
                totalPackages: 20,
                totalDistanceMeters: 50000,
                travelDurationSeconds: 7200,
                serviceDurationSeconds: 3600,
                waitingDurationSeconds: 0,
                totalDurationSeconds: 10800,
                estimatedFinishIso: '2026-11-24T11:00:00Z',
                estimatedFuelLiters: 4.6,
                estimatedFuelCost: 28.65,
                estimatedMaintenanceCost: 19,
                estimatedTimeCost: 105,
                estimatedOperationalCost: 152.65,
                lateStopsCount: 0,
                unassignedPackagesCount: 0,
                isRoadDistanceReal: false,
              },
              validation: { valid: true, checkedPackages: 20, assignedPackages: 20, unassignedPackages: [], warnings: [], errors: [] },
              createdAt: '2026-11-24T08:00:00Z',
            },
          ],
          createdAt: '2026-11-24T08:00:00Z',
          updatedAt: '2026-11-24T11:00:00Z',
        },
      ],
      packages: [],
      vehicle: DEFAULT_DEMO_VEHICLE,
    });

    // Should include auto estimated fuel + maintenance when none recorded
    expect(summaryWithoutFuel.estimatedExpenses).toBeGreaterThan(0);

    const summaryWithRealFuel = computeFinancialSummary({
      entries: [
        {
          id: 'r1',
          userId: 'u1',
          type: 'revenue',
          category: 'valor_fixo_rota',
          description: 'Diária',
          amount: 200,
          isEstimated: false,
          date: '2026-11-24',
          createdAt: '2026-11-24T08:00:00Z',
        },
        {
          id: 'e1',
          userId: 'u1',
          type: 'expense',
          category: 'combustivel',
          description: 'Posto Shell',
          amount: 35,
          isEstimated: false,
          date: '2026-11-24',
          createdAt: '2026-11-24T09:00:00Z',
        },
      ],
      routes: [
        {
          id: 'route_1',
          userId: 'u1',
          organizationId: 'org_1',
          name: 'Rota Teste',
          vehicleId: DEFAULT_DEMO_VEHICLE.id,
          status: 'finished',
          activeVersion: 1,
          origin: { label: 'CD', address: 'CD', source: 'depot' },
          constraints: {
            routeDate: '2026-11-24',
            startTime: '08:00',
            avgSecondsPerStop: 120,
            extraSecondsPerPackage: 20,
            lunchBreakMinutes: 0,
            avoidTolls: false,
            avoidHighways: false,
            considerTraffic: false,
            prioritizeUrgent: false,
            preserveOriginalRouteSplit: false,
            endMode: 'open_last_stop',
          },
          selectedStrategy: 'balanced',
          isDemo: false,
          recordedDistanceKm: 50,
          versions: [
            {
              version: 1,
              strategy: 'balanced',
              provider: 'local',
              providerLabel: 'Local',
              stops: [],
              metrics: {
                totalStops: 10,
                totalPackages: 20,
                totalDistanceMeters: 50000,
                travelDurationSeconds: 7200,
                serviceDurationSeconds: 3600,
                waitingDurationSeconds: 0,
                totalDurationSeconds: 10800,
                estimatedFinishIso: '2026-11-24T11:00:00Z',
                estimatedFuelLiters: 4.6,
                estimatedFuelCost: 28.65,
                estimatedMaintenanceCost: 19,
                estimatedTimeCost: 105,
                estimatedOperationalCost: 152.65,
                lateStopsCount: 0,
                unassignedPackagesCount: 0,
                isRoadDistanceReal: false,
              },
              validation: { valid: true, checkedPackages: 20, assignedPackages: 20, unassignedPackages: [], warnings: [], errors: [] },
              createdAt: '2026-11-24T08:00:00Z',
            },
          ],
          createdAt: '2026-11-24T08:00:00Z',
          updatedAt: '2026-11-24T11:00:00Z',
        },
      ],
      packages: [],
      vehicle: DEFAULT_DEMO_VEHICLE,
    });

    // Estimated expenses must drop because auto estimated fuel is NOT double-counted
    expect(summaryWithRealFuel.estimatedExpenses).toBeLessThan(summaryWithoutFuel.estimatedExpenses);
  });
});
