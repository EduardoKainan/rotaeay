import { DeliveryPackage, DeliveryRoute, FinancialEntry, Vehicle } from '../types/domain';

export interface FinancialSummary {
  grossRevenue: number;
  recordedExpenses: number;
  estimatedExpenses: number;
  applicableOperationalExpenses: number;
  operationalResult: number;
  workedHours: number;
  distanceKm: number;
  deliveredPackagesCount: number;
  completedStopsCount: number;
  profitPerHour: number | null;
  profitPerKm: number | null;
  revenuePerPackage: number | null;
  costPerPackage: number | null;
  costPerStop: number | null;
  estimatedFuelLiters: number;
  estimatedFuelCost: number;
  maintenanceReserve: number;
  distanceSavedKm: number | null;
  distanceSavingPercent: number | null;
  byCategory: { category: string; label: string; amount: number; type: 'revenue' | 'expense' }[];
  byPlatform: { platform: string; packages: number; revenue: number }[];
  denominatorsNote: string;
}

export const FINANCIAL_CATEGORY_LABELS: Record<string, string> = {
  valor_fixo_rota: 'Valor fixo por rota',
  valor_por_pacote: 'Valor por pacote',
  valor_por_parada: 'Valor por parada',
  bonificacao: 'Bonificação',
  receita_adicional: 'Receita adicional',
  combustivel: 'Combustível',
  pedagio: 'Pedágio',
  estacionamento: 'Estacionamento',
  manutencao: 'Manutenção',
  pneus: 'Pneus',
  depreciacao: 'Depreciação estimada',
  alimentacao: 'Alimentação',
  seguro: 'Seguro',
  outras_despesas: 'Outras despesas',
};

export function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

/**
 * Computes consistent operational profitability without division by zero
 * and without double-counting fuel or maintenance between recorded and estimated expenses.
 */
export function computeFinancialSummary(params: {
  entries: FinancialEntry[];
  routes: DeliveryRoute[];
  packages: DeliveryPackage[];
  vehicle?: Vehicle;
  referenceDistanceMeters?: number;
}): FinancialSummary {
  const { entries, routes, packages, vehicle, referenceDistanceMeters } = params;

  const grossRevenue = entries
    .filter((e) => e.type === 'revenue')
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);

  const recordedExpenseEntries = entries.filter((e) => e.type === 'expense' && !e.isEstimated);
  const recordedExpenses = recordedExpenseEntries.reduce((sum, e) => sum + Math.max(0, e.amount), 0);

  const hasRecordedFuel = recordedExpenseEntries.some((e) => e.category === 'combustivel');
  const hasRecordedMaintenance = recordedExpenseEntries.some((e) => e.category === 'manutencao');

  let totalDistanceKm = 0;
  let totalDurationHours = 0;
  let completedStopsCount = 0;

  for (const r of routes) {
    const activeVer = r.versions.find((v) => v.version === r.activeVersion) || r.versions[r.versions.length - 1];
    if (!activeVer) continue;
    totalDistanceKm += r.recordedDistanceKm ?? activeVer.metrics.totalDistanceMeters / 1000;
    totalDurationHours += activeVer.metrics.totalDurationSeconds / 3600;
    completedStopsCount += activeVer.stops.filter((s) => s.status === 'completed').length;
  }

  const consumption = vehicle?.consumptionKmPerLiter || 11;
  const fuelPrice = vehicle?.fuelPricePerLiter || 6.19;
  const maintenanceRate = vehicle?.maintenanceCostPerKm || 0.35;

  const estimatedFuelLiters = consumption > 0 ? totalDistanceKm / consumption : 0;
  const estimatedFuelCost = estimatedFuelLiters * fuelPrice;
  const maintenanceReserve = totalDistanceKm * maintenanceRate;

  // Explicit estimated entries added by user + auto fuel/maintenance ONLY if not already recorded (no double counting!)
  const explicitEstimatedExpenses = entries
    .filter((e) => e.type === 'expense' && e.isEstimated)
    .reduce((sum, e) => sum + Math.max(0, e.amount), 0);

  const autoEstimatedFuel = hasRecordedFuel ? 0 : estimatedFuelCost;
  const autoEstimatedMaintenance = hasRecordedMaintenance ? 0 : maintenanceReserve;
  const estimatedExpenses = explicitEstimatedExpenses + autoEstimatedFuel + autoEstimatedMaintenance;

  const applicableOperationalExpenses = recordedExpenses + estimatedExpenses;
  const operationalResult = grossRevenue - applicableOperationalExpenses;

  const deliveredPackagesCount = packages.filter((p) => p.status === 'delivered').length;
  const denomPackages = deliveredPackagesCount > 0 ? deliveredPackagesCount : packages.length;
  const denomStops = completedStopsCount > 0 ? completedStopsCount : routes.reduce((acc, r) => {
    const v = r.versions.find((ver) => ver.version === r.activeVersion);
    return acc + (v?.stops.length || 0);
  }, 0);

  let distanceSavedKm: number | null = null;
  let distanceSavingPercent: number | null = null;
  if (referenceDistanceMeters && referenceDistanceMeters > 0 && totalDistanceKm > 0) {
    const refKm = referenceDistanceMeters / 1000;
    distanceSavedKm = Number((refKm - totalDistanceKm).toFixed(2));
    distanceSavingPercent = Number(((distanceSavedKm / refKm) * 100).toFixed(1));
  }

  // Group by category
  const catMap: Record<string, { amount: number; type: 'revenue' | 'expense' }> = {};
  for (const e of entries) {
    const key = `${e.type}:${e.category}`;
    if (!catMap[key]) catMap[key] = { amount: 0, type: e.type };
    catMap[key].amount += e.amount;
  }
  if (!hasRecordedFuel && estimatedFuelCost > 0) {
    catMap['expense:combustivel_est'] = { amount: estimatedFuelCost, type: 'expense' };
  }
  if (!hasRecordedMaintenance && maintenanceReserve > 0) {
    catMap['expense:manutencao_est'] = { amount: maintenanceReserve, type: 'expense' };
  }

  const byCategory = Object.entries(catMap).map(([key, val]) => {
    const rawCat = key.split(':')[1];
    const label =
      rawCat === 'combustivel_est'
        ? 'Combustível (estimado)'
        : rawCat === 'manutencao_est'
          ? 'Reserva de manutenção (estimada)'
          : FINANCIAL_CATEGORY_LABELS[rawCat] || rawCat;
    return {
      category: rawCat,
      label,
      amount: Number(val.amount.toFixed(2)),
      type: val.type,
    };
  });

  // Group by platform
  const platMap: Record<string, { packages: number; revenue: number }> = {};
  for (const p of packages) {
    const plat = p.platform || 'Outros';
    if (!platMap[plat]) platMap[plat] = { packages: 0, revenue: 0 };
    platMap[plat].packages += 1;
  }
  for (const e of entries) {
    if (e.type === 'revenue') {
      const plat = e.platform || 'Geral';
      if (!platMap[plat]) platMap[plat] = { packages: 0, revenue: 0 };
      platMap[plat].revenue += e.amount;
    }
  }
  const byPlatform = Object.entries(platMap).map(([platform, data]) => ({
    platform,
    packages: data.packages,
    revenue: Number(data.revenue.toFixed(2)),
  }));

  const pkgDenomLabel =
    deliveredPackagesCount > 0
      ? `${deliveredPackagesCount} pacotes entregues`
      : `${packages.length} pacotes planejados`;

  return {
    grossRevenue: Number(grossRevenue.toFixed(2)),
    recordedExpenses: Number(recordedExpenses.toFixed(2)),
    estimatedExpenses: Number(estimatedExpenses.toFixed(2)),
    applicableOperationalExpenses: Number(applicableOperationalExpenses.toFixed(2)),
    operationalResult: Number(operationalResult.toFixed(2)),
    workedHours: Number(totalDurationHours.toFixed(2)),
    distanceKm: Number(totalDistanceKm.toFixed(2)),
    deliveredPackagesCount,
    completedStopsCount,
    profitPerHour: safeDivide(operationalResult, totalDurationHours),
    profitPerKm: safeDivide(operationalResult, totalDistanceKm),
    revenuePerPackage: safeDivide(grossRevenue, denomPackages),
    costPerPackage: safeDivide(applicableOperationalExpenses, denomPackages),
    costPerStop: safeDivide(applicableOperationalExpenses, denomStops),
    estimatedFuelLiters: Number(estimatedFuelLiters.toFixed(2)),
    estimatedFuelCost: Number(estimatedFuelCost.toFixed(2)),
    maintenanceReserve: Number(maintenanceReserve.toFixed(2)),
    distanceSavedKm,
    distanceSavingPercent,
    byCategory,
    byPlatform,
    denominatorsNote: `Base de cálculo: ${pkgDenomLabel}, ${denomStops} paradas, ${totalDistanceKm.toFixed(1)} km e ${totalDurationHours.toFixed(1)} h. Resultado operacional estimado — não substitui apuração contábil/fiscal completa.`,
  };
}

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}
