import React, { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  BarChart3,
  DollarSign,
  Download,
  Plus,
  Printer,
  Trash2,
} from 'lucide-react';
import {
  FINANCIAL_CATEGORY_LABELS,
  computeFinancialSummary,
  formatBRL,
} from '../domain/financial';
import { exportSafeSpreadsheet } from '../domain/spreadsheet';
import { useAppStore } from '../store/useAppStore';

const REVENUE_CATEGORIES = [
  'valor_fixo_rota',
  'valor_por_pacote',
  'valor_por_parada',
  'bonificacao',
  'receita_adicional',
];

const EXPENSE_CATEGORIES = [
  'combustivel',
  'pedagio',
  'estacionamento',
  'manutencao',
  'pneus',
  'depreciacao',
  'alimentacao',
  'seguro',
  'outras_despesas',
];

const CHART_COLORS = ['#2563EB', '#F97316', '#22C55E', '#8B5CF6', '#EF4444', '#0EA5E9', '#EAB308'];

export function FinancialAndReportsView() {
  const routes = useAppStore((s) => s.routes);
  const packages = useAppStore((s) => s.packages);
  const vehicles = useAppStore((s) => s.vehicles);
  const financialEntries = useAppStore((s) => s.financialEntries);
  const subView = useAppStore((s) => s.subView);
  const navigate = useAppStore((s) => s.navigate);
  const addFinancialEntry = useAppStore((s) => s.addFinancialEntry);
  const deleteFinancialEntry = useAppStore((s) => s.deleteFinancialEntry);
  const pushToast = useAppStore((s) => s.pushToast);

  const currentTab = subView === 'reports' ? 'reports' : 'financial_overview';

  // Entry form state
  const [entryType, setEntryType] = useState<'revenue' | 'expense'>('revenue');
  const [category, setCategory] = useState('valor_fixo_rota');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [platform, setPlatform] = useState('Shopee');
  const [isEstimated, setIsEstimated] = useState(false);
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));

  // Report filters
  const [reportPlatformFilter, setReportPlatformFilter] = useState('all');

  const summary = useMemo(
    () =>
      computeFinancialSummary({
        entries: financialEntries,
        routes,
        packages,
        vehicle: vehicles[0],
      }),
    [financialEntries, routes, packages, vehicles]
  );

  const filteredReportPackages = useMemo(
    () =>
      packages.filter(
        (p) => reportPlatformFilter === 'all' || p.platform === reportPlatformFilter
      ),
    [packages, reportPlatformFilter]
  );

  const statusBreakdown = useMemo(() => {
    const counts = {
      Entregues: filteredReportPackages.filter((p) => p.status === 'delivered').length,
      Pendentes: filteredReportPackages.filter((p) => ['pending', 'loaded', 'in_transit'].includes(p.status)).length,
      Frustradas: filteredReportPackages.filter((p) => p.status === 'failed_attempt').length,
      Adiadas: filteredReportPackages.filter((p) => p.status === 'postponed').length,
    };
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredReportPackages]);

  const handleAddEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = Number(amount.replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric <= 0) {
      pushToast('warning', 'Informe um valor positivo em reais.');
      return;
    }
    addFinancialEntry({
      type: entryType,
      category,
      description: description.trim() || FINANCIAL_CATEGORY_LABELS[category] || category,
      amount: numeric,
      isEstimated,
      platform: entryType === 'revenue' ? platform : undefined,
      date: entryDate,
    });
    setDescription('');
    setAmount('');
  };

  const handleExportReport = (format: 'csv' | 'xlsx') => {
    const rows = filteredReportPackages.map((p) => ({
      Rastreio: p.trackingCode,
      Plataforma: p.platform,
      Destinatario: p.recipientName,
      Endereco: p.normalizedAddress.formatted,
      Bairro: p.normalizedAddress.neighborhood,
      Cidade: p.normalizedAddress.city,
      Status: p.status,
      Tentativas: p.attemptCount,
      Zona_Carga: p.physicalLocationId || '',
      Observacoes: p.observations || '',
    }));
    exportSafeSpreadsheet(rows, `relatorio_entregas_rota_express.${format}`, format);
    pushToast('success', `Relatório exportado em ${format.toUpperCase()} com proteção contra injeção de fórmulas.`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Financeiro & Relatórios</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Apuração operacional em reais (BRL) separando despesas lançadas de custos estimados, sem dupla contagem.
          </p>
        </div>
        <div className="flex items-center gap-2 no-print">
          <button
            type="button"
            onClick={() => handleExportReport('xlsx')}
            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" /> Exportar XLSX
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" /> Imprimir PDF
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-1 no-print">
        <button
          type="button"
          onClick={() => navigate('financial', 'financial_overview')}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 rounded-lg text-xs font-semibold ${
            currentTab === 'financial_overview'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <DollarSign className="w-3.5 h-3.5" /> Financeiro Operacional
        </button>
        <button
          type="button"
          onClick={() => navigate('financial', 'reports')}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-3.5 rounded-lg text-xs font-semibold ${
            currentTab === 'reports'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" /> Relatórios & Produtividade
        </button>
      </div>

      {/* TAB 1: FINANCIAL OVERVIEW */}
      {currentTab === 'financial_overview' && (
        <div className="space-y-5">
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-xs text-slate-500">Receita Bruta</div>
              <div className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                {formatBRL(summary.grossRevenue)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                Por pacote: {formatBRL(summary.revenuePerPackage)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-xs text-slate-500">Despesas Operacionais</div>
              <div className="text-2xl font-bold text-red-600 dark:text-red-400 tabular-nums mt-1">
                {formatBRL(summary.applicableOperationalExpenses)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                Reais: {formatBRL(summary.recordedExpenses)} · Est.: {formatBRL(summary.estimatedExpenses)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-xs text-slate-500">Resultado Operacional Est.</div>
              <div
                className={`text-2xl font-bold tabular-nums mt-1 ${
                  summary.operationalResult >= 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {formatBRL(summary.operationalResult)}
              </div>
              <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
                Custo/pacote: {formatBRL(summary.costPerPackage)} · Custo/parada: {formatBRL(summary.costPerStop)}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
              <div className="text-xs text-slate-500">Rentabilidade Unitária</div>
              <div className="text-xl font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                {formatBRL(summary.profitPerHour)} /h
              </div>
              <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 tabular-nums mt-0.5">
                {formatBRL(summary.profitPerKm)} /km
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                Combustível est.: {summary.estimatedFuelLiters} L
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400">{summary.denominatorsNote}</p>

          {/* Form + Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <form
              onSubmit={handleAddEntry}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3.5 no-print"
            >
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Novo Lançamento Financeiro</h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEntryType('revenue');
                    setCategory('valor_fixo_rota');
                  }}
                  className={`min-h-[40px] rounded-xl text-xs font-semibold border ${
                    entryType === 'revenue'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  + Receita
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEntryType('expense');
                    setCategory('combustivel');
                  }}
                  className={`min-h-[40px] rounded-xl text-xs font-semibold border ${
                    entryType === 'expense'
                      ? 'bg-red-600 text-white border-red-600'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  - Despesa
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Categoria</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
                  >
                    {(entryType === 'revenue' ? REVENUE_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                      <option key={c} value={c}>
                        {FINANCIAL_CATEGORY_LABELS[c] || c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Valor (R$) *</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="Ex.: 180,00"
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Data</label>
                  <input
                    type="date"
                    value={entryDate}
                    onChange={(e) => setEntryDate(e.target.value)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
                  />
                </div>
                {entryType === 'revenue' ? (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Plataforma</label>
                    <select
                      value={platform}
                      onChange={(e) => setPlatform(e.target.value)}
                      className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
                    >
                      <option>Shopee</option>
                      <option>Mercado Livre</option>
                      <option>Amazon</option>
                      <option>Transportadora</option>
                      <option>Particular</option>
                    </select>
                  </div>
                ) : (
                  <div className="flex items-end pb-2">
                    <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isEstimated}
                        onChange={(e) => setIsEstimated(e.target.checked)}
                      />
                      Lançamento estimado
                    </label>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Descrição</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Ex.: Abastecimento posto Av. T-63"
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
                />
              </div>

              <button
                type="submit"
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
              >
                <Plus className="w-4 h-4" /> Registrar lançamento
              </button>
            </form>

            {/* Category Breakdown Chart */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
                Composição por Categoria (R$)
              </h2>
              <div className="flex-1 min-h-[240px]">
                {summary.byCategory.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-xs text-slate-400">
                    Adicione receitas ou despesas para visualizar o gráfico.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={summary.byCategory} margin={{ top: 8, right: 8, left: 0, bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-15} textAnchor="end" />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(val: unknown) => formatBRL(Number(val))} />
                      <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                        {summary.byCategory.map((entry, idx) => (
                          <Cell
                            key={entry.category}
                            fill={entry.type === 'revenue' ? '#22C55E' : CHART_COLORS[idx % CHART_COLORS.length]}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* Ledger Table */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                <tr>
                  <th className="px-3 py-2.5">Data</th>
                  <th className="px-3 py-2.5">Tipo</th>
                  <th className="px-3 py-2.5">Categoria</th>
                  <th className="px-3 py-2.5">Descrição</th>
                  <th className="px-3 py-2.5 text-right">Valor</th>
                  <th className="px-3 py-2.5 text-right no-print">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 tabular-nums">
                {financialEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                      Nenhum lançamento registrado ainda.
                    </td>
                  </tr>
                ) : (
                  financialEntries.map((entry) => (
                    <tr key={entry.id}>
                      <td className="px-3 py-2">{entry.date}</td>
                      <td className="px-3 py-2 font-semibold">
                        <span className={entry.type === 'revenue' ? 'text-emerald-600' : 'text-red-600'}>
                          {entry.type === 'revenue' ? 'Receita' : 'Despesa'}
                        </span>
                        {entry.isEstimated && <span className="text-slate-400 font-normal"> (Est.)</span>}
                      </td>
                      <td className="px-3 py-2">{FINANCIAL_CATEGORY_LABELS[entry.category] || entry.category}</td>
                      <td className="px-3 py-2">{entry.description}</td>
                      <td className="px-3 py-2 text-right font-bold">{formatBRL(entry.amount)}</td>
                      <td className="px-3 py-2 text-right no-print">
                        <button
                          type="button"
                          onClick={() => deleteFinancialEntry(entry.id)}
                          aria-label="Excluir lançamento"
                          className="text-slate-400 hover:text-red-600 p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: REPORTS & PRODUCTIVITY */}
      {currentTab === 'reports' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 no-print">
            <select
              value={reportPlatformFilter}
              onChange={(e) => setReportPlatformFilter(e.target.value)}
              className="min-h-[38px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs"
            >
              <option value="all">Todas plataformas ({packages.length} pacotes)</option>
              {Array.from(new Set(packages.map((p) => p.platform))).map((pl) => (
                <option key={pl} value={pl}>
                  {pl}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => handleExportReport('csv')}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" /> Exportar CSV seguro
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
                Distribuição de Status das Entregas
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={statusBreakdown}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label
                  >
                    {statusBreakdown.map((item, idx) => (
                      <Cell key={item.name} fill={['#22C55E', '#3B82F6', '#EF4444', '#EAB308'][idx]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
                Volume por Plataforma
              </h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={summary.byPlatform}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.2} />
                  <XAxis dataKey="platform" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="packages" name="Pacotes" fill="#2563EB" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
