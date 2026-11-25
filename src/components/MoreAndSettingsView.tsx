import React, { useEffect, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Download,
  HelpCircle,
  LogOut,
  MapPin,
  Plug,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
  Truck,
  User as UserIcon,
} from 'lucide-react';
import { DEFAULT_CARGO_ZONES } from '../domain/demoData';
import { formatBRL } from '../domain/financial';
import { deleteCurrentFirebaseAccount, logoutFirebase } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { IntegrationStatusItem, Vehicle, VehicleType } from '../types/domain';

export function MoreAndSettingsView() {
  const user = useAppStore((s) => s.user);
  const isDemoMode = useAppStore((s) => s.isDemoMode);
  const vehicles = useAppStore((s) => s.vehicles);
  const favoriteAddresses = useAppStore((s) => s.favoriteAddresses);
  const subView = useAppStore((s) => s.subView);
  const navigate = useAppStore((s) => s.navigate);
  const saveVehicle = useAppStore((s) => s.saveVehicle);
  const deleteVehicle = useAppStore((s) => s.deleteVehicle);
  const saveFavoriteAddress = useAppStore((s) => s.saveFavoriteAddress);
  const deleteFavoriteAddress = useAppStore((s) => s.deleteFavoriteAddress);
  const updateUserProfileLocal = useAppStore((s) => s.updateUserProfileLocal);
  const exportAllUserDataJson = useAppStore((s) => s.exportAllUserDataJson);
  const resetDemoMode = useAppStore((s) => s.resetDemoMode);
  const exitDemoMode = useAppStore((s) => s.exitDemoMode);
  const pushToast = useAppStore((s) => s.pushToast);

  const currentSection =
    subView === 'vehicles'
      ? 'vehicles'
      : subView === 'favorites'
        ? 'favorites'
        : subView === 'profile'
          ? 'profile'
          : subView === 'privacy'
            ? 'privacy'
            : subView === 'help'
              ? 'help'
              : 'integrations';

  // Integrations diagnostics state
  const [services, setServices] = useState<IntegrationStatusItem[]>([]);
  const [usageStats, setUsageStats] = useState<{
    todayUnits: number;
    dailyLimit: number;
    monthEstimatedCostBrl: number;
    monthlyBudgetBrl: number;
  } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);

  // New vehicle form
  const [vehName, setVehName] = useState('');
  const [vehType, setVehType] = useState<VehicleType>('car');
  const [vehFuel, setVehFuel] = useState<Vehicle['fuelType']>('gasolina');
  const [vehKmL, setVehKmL] = useState('11.5');
  const [vehFuelPrice, setVehFuelPrice] = useState('6.19');
  const [vehMaintKm, setVehMaintKm] = useState('0.35');
  const [vehHourly, setVehHourly] = useState('35');
  const [vehMaxKg, setVehMaxKg] = useState('450');
  const [vehMaxPkgs, setVehMaxPkgs] = useState('150');

  // New favorite address form
  const [favName, setFavName] = useState('');
  const [favAddress, setFavAddress] = useState('');

  // Profile form
  const [profName, setProfName] = useState(user?.name || '');
  const [profCity, setProfCity] = useState(user?.city || 'Goiânia');
  const [profState, setProfState] = useState(user?.state || 'GO');
  const [profNav, setProfNav] = useState(user?.preferredNavigator || 'google_maps');

  const fetchDiagnostics = async () => {
    setLoadingDiag(true);
    try {
      const res = await fetch('/api/integrations/status');
      if (res.ok) {
        const data = await res.json();
        setServices(data.services || []);
        setUsageStats(data.usage || null);
      }
    } catch {
      pushToast('warning', 'Não foi possível carregar o diagnóstico de integrações.');
    } finally {
      setLoadingDiag(false);
    }
  };

  useEffect(() => {
    if (currentSection === 'integrations') {
      void fetchDiagnostics();
    }
  }, [currentSection]);

  const handleTestService = async (serviceId: string) => {
    setTestingId(serviceId);
    try {
      const res = await fetch('/api/integrations/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId }),
      });
      const data = await res.json();
      setServices((prev) =>
        prev.map((s) =>
          s.id === serviceId
            ? { ...s, status: data.status || s.status, details: data.details || s.details, lastTestedAt: data.testedAt }
            : s
        )
      );
      pushToast('info', `${serviceId}: ${data.status}`);
    } catch {
      pushToast('error', 'Erro ao testar integração.');
    } finally {
      setTestingId(null);
    }
  };

  const handleCreateVehicle = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehName.trim()) return;
    saveVehicle({
      id: `veh_${Date.now().toString(36)}`,
      ownerId: user?.id || 'local_user',
      organizationId: user?.organizationId || 'org_default',
      name: vehName.trim(),
      type: vehType,
      fuelType: vehFuel,
      consumptionKmPerLiter: Math.max(1, Number(vehKmL.replace(',', '.')) || 10),
      fuelPricePerLiter: Math.max(0, Number(vehFuelPrice.replace(',', '.')) || 6),
      maintenanceCostPerKm: Math.max(0, Number(vehMaintKm.replace(',', '.')) || 0.35),
      hourlyCost: Math.max(0, Number(vehHourly.replace(',', '.')) || 30),
      maxWeightKg: Math.max(10, Number(vehMaxKg) || 400),
      maxVolumeLiters: 1800,
      maxPackages: Math.max(1, Number(vehMaxPkgs) || 120),
      compartments: DEFAULT_CARGO_ZONES,
    });
    setVehName('');
  };

  const handleDownloadJsonData = () => {
    const json = exportAllUserDataJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meus_dados_rota_express_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('success', 'Exportação LGPD concluída em JSON.');
  };

  const handleSignOut = async () => {
    if (isDemoMode) {
      await exitDemoMode();
      return;
    }
    await logoutFirebase();
  };

  const handleDeleteAccount = async () => {
    if (isDemoMode) {
      await exitDemoMode();
      return;
    }
    try {
      await deleteCurrentFirebaseAccount();
      pushToast('info', 'Conta excluída com sucesso.');
    } catch (err) {
      pushToast(
        'warning',
        err instanceof Error
          ? `Para excluir sua conta por segurança, faça login recente e tente novamente (${err.message}).`
          : 'Erro ao excluir conta.'
      );
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Configurações & Diagnóstico</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Gerencie veículos, endereços favoritos, integrações de API, perfil, governança de custos e privacidade (LGPD).
        </p>
      </div>

      {/* Section Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800">
        {[
          { id: 'integrations', label: 'Integrações & API', icon: Plug },
          { id: 'vehicles', label: `Veículos (${vehicles.length})`, icon: Truck },
          { id: 'favorites', label: `Favoritos (${favoriteAddresses.length})`, icon: MapPin },
          { id: 'profile', label: 'Perfil & Planos', icon: UserIcon },
          { id: 'privacy', label: 'Privacidade & LGPD', icon: Shield },
          { id: 'help', label: 'Ajuda', icon: HelpCircle },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = currentSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigate('more', tab.id as typeof subView)}
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

      {/* SECTION 1: INTEGRATIONS DIAGNOSTICS */}
      {currentSection === 'integrations' && (
        <div className="space-y-4">
          {usageStats && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Uso Diário de Unidades API</span>
                  <Activity className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {usageStats.todayUnits} / {usageStats.dailyLimit} unidades
                </div>
                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full"
                    style={{ width: `${Math.min(100, (usageStats.todayUnits / Math.max(1, usageStats.dailyLimit)) * 100)}%` }}
                  />
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                  <span>Orçamento Mensal Estimado de APIs</span>
                  <Activity className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                  {formatBRL(usageStats.monthEstimatedCostBrl)} / {formatBRL(usageStats.monthlyBudgetBrl)}
                </div>
                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-full"
                    style={{
                      width: `${Math.min(100, (usageStats.monthEstimatedCostBrl / Math.max(1, usageStats.monthlyBudgetBrl)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Testes reais só são disparados ao clicar em <strong>Testar conexão</strong>. Chaves secretas nunca são exibidas no frontend.
            </p>
            <button
              type="button"
              onClick={() => void fetchDiagnostics()}
              disabled={loadingDiag}
              className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-medium"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingDiag ? 'animate-spin' : ''}`} /> Atualizar
            </button>
          </div>

          <div className="space-y-2.5">
            {services.map((svc) => {
              const isOk = svc.status === 'Funcionando' || svc.status === 'Configurado';
              return (
                <div
                  key={svc.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-white">{svc.name}</span>
                      <span
                        className={`text-xs font-semibold ${
                          isOk
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : svc.status === 'Não configurado'
                              ? 'text-slate-500'
                              : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        · {svc.status}
                      </span>
                      {svc.required && <span className="text-[11px] text-blue-600 font-medium">· Essencial</span>}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">{svc.details}</p>
                    {svc.missingConfig && svc.missingConfig.length > 0 && (
                      <p className="text-[11px] font-mono text-amber-700 dark:text-amber-400">
                        Variáveis esperadas: {svc.missingConfig.join(', ')}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleTestService(svc.id)}
                    disabled={testingId === svc.id}
                    className="min-h-[38px] px-3.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold whitespace-nowrap shrink-0"
                  >
                    {testingId === svc.id ? 'Testando...' : 'Testar conexão'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 2: VEHICLES */}
      {currentSection === 'vehicles' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-3">
            {vehicles.map((v) => (
              <div
                key={v.id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-start justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="text-sm font-bold text-slate-900 dark:text-white">{v.name}</div>
                  <p className="text-xs text-slate-500 tabular-nums">
                    Tipo: {v.type} · {v.fuelType} · {v.consumptionKmPerLiter} km/L · {formatBRL(v.fuelPricePerLiter)}/L
                  </p>
                  <p className="text-xs text-slate-500 tabular-nums">
                    Manut.: {formatBRL(v.maintenanceCostPerKm)}/km · Hora: {formatBRL(v.hourlyCost)}/h · Cap.: {v.maxWeightKg} kg / {v.maxPackages} pct
                  </p>
                </div>
                {vehicles.length > 1 && (
                  <button
                    type="button"
                    onClick={() => deleteVehicle(v.id)}
                    className="p-2 text-slate-400 hover:text-red-600"
                    aria-label="Excluir veículo"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <form
            onSubmit={handleCreateVehicle}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
          >
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Cadastrar Novo Veículo</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs text-slate-500 mb-1">Nome / Modelo *</label>
                <input
                  type="text"
                  required
                  value={vehName}
                  onChange={(e) => setVehName(e.target.value)}
                  placeholder="Ex.: Fiat Fiorino 1.4"
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Tipo</label>
                <select
                  value={vehType}
                  onChange={(e) => setVehType(e.target.value as VehicleType)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
                >
                  <option value="motorcycle">Moto</option>
                  <option value="car">Carro</option>
                  <option value="utility">Utilitário</option>
                  <option value="van">Van</option>
                  <option value="truck">Caminhão leve</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Combustível</label>
                <select
                  value={vehFuel}
                  onChange={(e) => setVehFuel(e.target.value as Vehicle['fuelType'])}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
                >
                  <option value="gasolina">Gasolina</option>
                  <option value="etanol">Etanol</option>
                  <option value="diesel">Diesel</option>
                  <option value="gnv">GNV</option>
                  <option value="eletrico">Elétrico</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Consumo (km/L)</label>
                <input
                  type="text"
                  value={vehKmL}
                  onChange={(e) => setVehKmL(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Preço Comb. (R$/L)</label>
                <input
                  type="text"
                  value={vehFuelPrice}
                  onChange={(e) => setVehFuelPrice(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Manutenção (R$/km)</label>
                <input
                  type="text"
                  value={vehMaintKm}
                  onChange={(e) => setVehMaintKm(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Custo Hora (R$/h)</label>
                <input
                  type="text"
                  value={vehHourly}
                  onChange={(e) => setVehHourly(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Cap. Peso (kg)</label>
                <input
                  type="number"
                  value={vehMaxKg}
                  onChange={(e) => setVehMaxKg(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm tabular-nums"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Cap. Pacotes</label>
                <input
                  type="number"
                  value={vehMaxPkgs}
                  onChange={(e) => setVehMaxPkgs(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm tabular-nums"
                />
              </div>
            </div>
            <button
              type="submit"
              className="w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
            >
              <Plus className="w-4 h-4" /> Salvar veículo
            </button>
          </form>
        </div>
      )}

      {/* SECTION 3: FAVORITE ADDRESSES */}
      {currentSection === 'favorites' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2.5">
            {favoriteAddresses.length === 0 ? (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 text-xs text-slate-500">
                Nenhum endereço favorito cadastrado. Salve seu CD ou endereço de partida para agilizar novas rotas.
              </div>
            ) : (
              favoriteAddresses.map((fav) => (
                <div
                  key={fav.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{fav.name}</div>
                    <p className="text-xs text-slate-500">{fav.address}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteFavoriteAddress(fav.id)}
                    className="p-2 text-slate-400 hover:text-red-600"
                    aria-label="Remover favorito"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!favName.trim() || !favAddress.trim()) return;
              saveFavoriteAddress({ name: favName.trim(), address: favAddress.trim() });
              setFavName('');
              setFavAddress('');
            }}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3"
          >
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Novo Endereço Favorito / CD</h2>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Apelido *</label>
              <input
                type="text"
                required
                value={favName}
                onChange={(e) => setFavName(e.target.value)}
                placeholder="Ex.: CD Shopee Goiânia"
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Endereço completo *</label>
              <input
                type="text"
                required
                value={favAddress}
                onChange={(e) => setFavAddress(e.target.value)}
                placeholder="Rua, número, bairro, cidade - UF"
                className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full min-h-[42px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold"
            >
              Salvar favorito
            </button>
          </form>
        </div>
      )}

      {/* SECTION 4: PROFILE & FUTURE SAAS PLANS */}
      {currentSection === 'profile' && (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Perfil Operacional</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Nome</label>
                <input
                  type="text"
                  value={profName}
                  onChange={(e) => setProfName(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Cidade</label>
                <input
                  type="text"
                  value={profCity}
                  onChange={(e) => setProfCity(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">UF</label>
                <input
                  type="text"
                  maxLength={2}
                  value={profState}
                  onChange={(e) => setProfState(e.target.value.toUpperCase())}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Navegador preferido</label>
                <select
                  value={profNav}
                  onChange={(e) => setProfNav(e.target.value as 'google_maps' | 'waze')}
                  className="w-full min-h-[40px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 text-xs"
                >
                  <option value="google_maps">Google Maps</option>
                  <option value="waze">Waze</option>
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-slate-500">
                Organização: <strong className="font-mono">{user?.organizationId}</strong> · Papel: <strong>{user?.role}</strong>
              </span>
              <button
                type="button"
                onClick={() =>
                  updateUserProfileLocal({
                    name: profName,
                    city: profCity,
                    state: profState,
                    preferredNavigator: profNav,
                  })
                }
                className="min-h-[40px] px-4 rounded-xl bg-blue-600 text-white text-xs font-semibold"
              >
                Salvar perfil
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Arquitetura Preparada para Planos Futuros (Sem cobrança ativa)
            </h2>
            <p className="text-xs text-slate-500">
              Estrutura multi-tenant pronta para evolução SaaS (Gratuito, Profissional, Premium e Transportadora). Nenhuma cobrança ou gateway de pagamento está ativo nesta versão.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              {[
                { name: 'Gratuito', desc: 'Uso individual, importação XLSX/CSV e motor heurístico local.' },
                { name: 'Profissional', desc: 'Matriz rodoviária Google Routes, histórico em nuvem e Assistente IA.' },
                { name: 'Premium', desc: 'Otimização avançada de alta capacidade, múltiplos veículos e relatórios avançados.' },
                { name: 'Transportadora', desc: 'Multi-motoristas, gestão de frota (fleet_manager) e RBAC organizacional.' },
              ].map((plan) => (
                <div key={plan.name} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-1">
                  <div className="font-bold text-slate-900 dark:text-white">{plan.name}</div>
                  <p className="text-slate-500 leading-relaxed">{plan.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SECTION 5: PRIVACY & LGPD */}
      {currentSection === 'privacy' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Privacidade, LGPD & Controle de Conta</h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            Os dados dos destinatários importados por você são isolados sob sua conta autenticada (Firebase Security Rules por titular) e salvos localmente no IndexedDB do seu dispositivo para uso offline. Nomes e telefones de destinatários nunca são enviados ao mapeamento de cabeçalhos por IA.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleDownloadJsonData}
              className="min-h-[42px] inline-flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-xs font-semibold"
            >
              <Download className="w-4 h-4" /> Exportar todos meus dados (JSON)
            </button>

            {isDemoMode && (
              <button
                type="button"
                onClick={() => void resetDemoMode(50)}
                className="min-h-[42px] inline-flex items-center gap-2 rounded-xl border border-orange-300 dark:border-orange-800 text-orange-700 dark:text-orange-300 px-4 text-xs font-semibold"
              >
                <RefreshCw className="w-4 h-4" /> Reiniciar base de demonstração
              </button>
            )}

            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="min-h-[42px] inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-4 text-xs font-semibold"
            >
              <LogOut className="w-4 h-4" /> {isDemoMode ? 'Sair do Modo Demonstração' : 'Sair da conta'}
            </button>

            {!isDemoMode && (
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                className="min-h-[42px] inline-flex items-center gap-2 rounded-xl bg-red-600 hover:bg-red-700 text-white px-4 text-xs font-semibold"
              >
                <Trash2 className="w-4 h-4" /> Excluir minha conta
              </button>
            )}
          </div>
        </div>
      )}

      {/* SECTION 6: HELP */}
      {currentSection === 'help' && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Guia Rápido do Motorista</h2>
          <p>
            <strong>1. Importação de planilhas:</strong> vá em <em>Rotas &gt; Nova rota</em> para subir arquivos XLSX, XLS ou CSV da Shopee, Mercado Livre, Amazon ou transportadoras. O sistema preserva zeros à esquerda em códigos de rastreio e CEPs.
          </p>
          <p>
            <strong>2. Carga física independente:</strong> em <em>Pacotes &gt; Organização de Carga</em>, distribua os volumes nas zonas A–D ou em caixas próprias. Mesmo se você reotimizar a rota durante o dia, o app nunca sobrescreve onde você guardou cada caixa.
          </p>
          <p>
            <strong>3. Navegação externa:</strong> no <em>Modo Motorista</em>, toque em <strong>Google Maps</strong> ou <strong>Waze</strong> para abrir a rota curva a curva direto no endereço ou coordenada confirmada.
          </p>
          <p>
            <strong>4. Operação Offline:</strong> sua rota ativa e eventos de entrega ficam salvos no navegador (IndexedDB). Quando o sinal 4G/5G voltar, o sistema sincroniza automaticamente com o Cloud Firestore.
          </p>
        </div>
      )}
    </div>
  );
}
