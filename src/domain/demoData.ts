import {
  CargoZone,
  DeliveryPackage,
  DeliveryPriority,
  FavoriteAddress,
  Vehicle,
} from '../types/domain';
import { classifyLocationConfidence, normalizeBrazilianAddress } from './address';
import { exportSafeSpreadsheet } from './spreadsheet';

export const DEFAULT_CARGO_ZONES: CargoZone[] = [
  { id: 'A', name: 'Acesso rápido', description: 'Pacotes das primeiras entregas (banco/porta lateral)', color: '#F97316' },
  { id: 'B', name: 'Lateral direita', description: 'Segundo grupo de entregas', color: '#3B82F6' },
  { id: 'C', name: 'Lateral esquerda', description: 'Terceiro grupo de entregas', color: '#8B5CF6' },
  { id: 'D', name: 'Área de fundo', description: 'Pacotes das entregas finais e volumes pesados', color: '#0F172A' },
];

export const DEFAULT_DEMO_VEHICLE: Vehicle = {
  id: 'veh_demo_fiorino',
  ownerId: 'demo_user',
  organizationId: 'org_demo',
  name: 'Fiat Fiorino Furgão (Demo)',
  type: 'utility',
  fuelType: 'gasolina',
  consumptionKmPerLiter: 10.8,
  fuelPricePerLiter: 6.19,
  maintenanceCostPerKm: 0.38,
  hourlyCost: 35,
  maxWeightKg: 650,
  maxVolumeLiters: 3300,
  maxPackages: 180,
  compartments: DEFAULT_CARGO_ZONES,
};

export const GOIANIA_FAVORITE_ADDRESSES: FavoriteAddress[] = [
  {
    id: 'fav_cd_goiania',
    userId: 'demo_user',
    name: 'Centro de Distribuição Goiânia Norte (Demo)',
    address: 'Av. Perimetral Norte, 3850 - Fazenda Caveiras, Goiânia - GO, 74591-010',
    coordinates: { lat: -16.6315, lng: -49.2662 },
  },
  {
    id: 'fav_casa_bueno',
    userId: 'demo_user',
    name: 'Base Motorista — Setor Bueno (Demo)',
    address: 'Av. T-10, 1300 - Setor Bueno, Goiânia - GO, 74223-060',
    coordinates: { lat: -16.7076, lng: -49.2741 },
  },
];

interface GoianiaSpot {
  street: string;
  neighborhood: string;
  city: string;
  cep: string;
  lat: number;
  lng: number;
}

const GOIANIA_SPOTS: GoianiaSpot[] = [
  { street: 'Avenida T-63', neighborhood: 'Setor Bueno', city: 'Goiânia', cep: '74230-100', lat: -16.7132, lng: -49.2698 },
  { street: 'Rua T-37', neighborhood: 'Setor Bueno', city: 'Goiânia', cep: '74230-022', lat: -16.7061, lng: -49.2712 },
  { street: 'Avenida Ricardo Paranhos', neighborhood: 'Setor Marista', city: 'Goiânia', cep: '74175-020', lat: -16.7014, lng: -49.2572 },
  { street: 'Rua 135', neighborhood: 'Setor Marista', city: 'Goiânia', cep: '74180-020', lat: -16.7038, lng: -49.2624 },
  { street: 'Avenida Jamel Cecílio', neighborhood: 'Jardim Goiás', city: 'Goiânia', cep: '74810-100', lat: -16.7089, lng: -49.2405 },
  { street: 'Rua 52', neighborhood: 'Jardim Goiás', city: 'Goiânia', cep: '74810-200', lat: -16.7021, lng: -49.2368 },
  { street: 'Avenida República do Líbano', neighborhood: 'Setor Oeste', city: 'Goiânia', cep: '74115-030', lat: -16.6825, lng: -49.2669 },
  { street: 'Rua 9', neighborhood: 'Setor Oeste', city: 'Goiânia', cep: '74110-100', lat: -16.6873, lng: -49.2681 },
  { street: 'Avenida 85', neighborhood: 'Setor Bela Vista', city: 'Goiânia', cep: '74823-000', lat: -16.7186, lng: -49.2603 },
  { street: 'Avenida T-4', neighborhood: 'Setor Serrinha', city: 'Goiânia', cep: '74835-090', lat: -16.7235, lng: -49.2644 },
  { street: 'Avenida Circular', neighborhood: 'Setor Pedro Ludovico', city: 'Goiânia', cep: '74823-020', lat: -16.7165, lng: -49.2512 },
  { street: 'Avenida Castelo Branco', neighborhood: 'Setor Coimbra', city: 'Goiânia', cep: '74530-010', lat: -16.6801, lng: -49.2862 },
  { street: 'Avenida Rio Verde', neighborhood: 'Parque Amazônia', city: 'Goiânia', cep: '74840-000', lat: -16.7405, lng: -49.2749 },
  { street: 'Avenida Independência', neighborhood: 'Setor Leste Vila Nova', city: 'Goiânia', cep: '74645-010', lat: -16.6664, lng: -49.2478 },
  { street: 'Avenida Universitária', neighborhood: 'Setor Leste Universitário', city: 'Goiânia', cep: '74605-010', lat: -16.6782, lng: -49.2443 },
  { street: 'Avenida São Paulo', neighborhood: 'Vila Brasília', city: 'Aparecida de Goiânia', cep: '74911-260', lat: -16.7481, lng: -49.2651 },
  { street: 'Avenida Igualdade', neighborhood: 'Setor Garavelo', city: 'Aparecida de Goiânia', cep: '74930-530', lat: -16.7742, lng: -49.3358 },
  { street: 'Avenida Dom Emanuel', neighborhood: 'Centro', city: 'Senador Canedo', cep: '75250-000', lat: -16.7069, lng: -49.0928 },
];

const FICTITIOUS_RECIPIENTS = [
  'Cliente Demo Ana Paula',
  'Cliente Demo Carlos Eduardo',
  'Cliente Demo Mariana Souza',
  'Cliente Demo Roberto Lima',
  'Cliente Demo Fernanda Costa',
  'Cliente Demo Lucas Oliveira',
  'Cliente Demo Patrícia Alves',
  'Cliente Demo Rafael Mendes',
  'Cliente Demo Juliana Rocha',
  'Cliente Demo Thiago Martins',
  'Cliente Demo Beatriz Gomes',
  'Cliente Demo Marcos Pereira',
];

const PLATFORMS = ['Shopee', 'Mercado Livre', 'Amazon'];

/**
 * Generates deterministic, obviously fictitious Goiânia & Região Metropolitana
 * demo datasets (10, 50, 150, or 500 packages) including:
 * - Multi-package same-address buildings
 * - Priority & time window deliveries
 * - Duplicate tracking code edge case
 * - Incomplete address needing review
 * - Multiple original routes
 */
export function generateDemoPackages(
  size: 10 | 50 | 150 | 500,
  userId = 'demo_user',
  organizationId = 'org_demo'
): DeliveryPackage[] {
  const packages: DeliveryPackage[] = [];

  for (let i = 0; i < size; i++) {
    // Deliberately group ~25% of packages onto same building address as previous item
    const sharePrevAddress = i > 0 && i % 4 === 0;
    const spotIdx = sharePrevAddress ? (i - 1) % GOIANIA_SPOTS.length : i % GOIANIA_SPOTS.length;
    const spot = GOIANIA_SPOTS[spotIdx];

    const jitterSeed = sharePrevAddress ? i - 1 : i;
    const latOffset = (((jitterSeed * 37) % 19) - 9) * 0.00055;
    const lngOffset = (((jitterSeed * 53) % 19) - 9) * 0.00055;

    const isIncompleteCase = i === Math.min(size - 1, 7);
    const isDuplicateCase = size >= 10 && i === 5;
    const numberStr = isIncompleteCase ? '' : String(120 + ((jitterSeed * 17) % 1800));
    const complement = sharePrevAddress
      ? `Condomínio Demo • Bloco B • Apto ${(i % 12) + 1}02`
      : i % 3 === 0
        ? `Quadra ${(i % 15) + 1} Lote ${(i % 10) + 1}`
        : '';

    const platform = PLATFORMS[i % PLATFORMS.length];
    const prefix = platform === 'Shopee' ? 'DEMO-SPX' : platform === 'Mercado Livre' ? 'DEMO-MLB' : 'DEMO-AMZ';
    const trackingCode = isDuplicateCase
      ? `${prefix}-000003`
      : `${prefix}-${String(i + 1).padStart(6, '0')}`;

    const priority: DeliveryPriority = i % 11 === 0 ? 'urgent' : i % 5 === 0 ? 'high' : 'normal';
    const timeWindowStart = priority === 'urgent' ? '09:00' : i % 6 === 0 ? '13:30' : undefined;
    const timeWindowEnd = priority === 'urgent' ? '11:30' : i % 6 === 0 ? '17:00' : undefined;

    const fullAddress = isIncompleteCase
      ? `${spot.street} - ${spot.neighborhood}, ${spot.city} - GO`
      : `${spot.street}, ${numberStr}${complement ? `, ${complement}` : ''} - ${spot.neighborhood}, ${spot.city} - GO, ${spot.cep}`;

    const normalized = normalizeBrazilianAddress({
      fullAddress,
      street: spot.street,
      number: numberStr,
      complement,
      neighborhood: spot.neighborhood,
      city: spot.city,
      state: 'GO',
      postalCode: spot.cep,
      referencePoint: i % 4 === 1 ? 'Portaria principal próxima à praça (Demo)' : '',
    });

    const coordinates = isIncompleteCase
      ? undefined
      : {
          lat: Number((spot.lat + latOffset).toFixed(6)),
          lng: Number((spot.lng + lngOffset).toFixed(6)),
        };

    const validationIssues: string[] = [...normalized.issues];
    if (isDuplicateCase) {
      validationIssues.push(`Código de rastreio duplicado na demonstração: ${trackingCode}`);
    }

    const locationSource = coordinates ? 'demo_dataset' : 'unresolved';
    const locationConfidence = classifyLocationConfidence({
      coordinates,
      source: locationSource,
      normalized,
    });

    const originalRouteId = i < size / 2 ? 'ROTA-GYN-01' : 'ROTA-GYN-02';

    packages.push({
      id: `demo_pkg_${size}_${i + 1}`,
      userId,
      organizationId,
      importJobId: `demo_import_${size}`,
      sourceRow: i + 2,
      platform,
      trackingCode,
      barcode: `789000${String(i + 1).padStart(7, '0')}`,
      orderId: `PED-DEMO-${String(1000 + i)}`,
      originalRouteId,
      // Deliberately scrambled original sequence to highlight route optimization gains
      originalSequence: ((i * 7) % size) + 1,
      recipientName: FICTITIOUS_RECIPIENTS[i % FICTITIOUS_RECIPIENTS.length],
      recipientPhone: `(62) 99900-${String(1000 + (i % 8999)).padStart(4, '0')}`,
      originalAddress: fullAddress,
      normalizedAddress: normalized,
      coordinates,
      locationSource,
      locationConfidence,
      locationUpdatedAt: coordinates ? new Date().toISOString() : undefined,
      quantity: i % 9 === 0 ? 2 : 1,
      weightKg: Number((0.4 + ((i * 13) % 45) / 10).toFixed(1)),
      isFragile: i % 8 === 0,
      priority,
      timeWindowStart,
      timeWindowEnd,
      deliveryInstructions: i % 8 === 0 ? 'Pacote frágil — manter na parte superior.' : undefined,
      observations: i % 10 === 0 ? 'Interfone com defeito, ligar ao chegar.' : undefined,
      status: 'pending',
      attemptCount: 0,
      isDuplicate: isDuplicateCase,
      validationIssues,
    });
  }

  return packages;
}

/**
 * Downloads a realistic Goiânia demo template spreadsheet (XLSX or CSV)
 * so the driver can immediately test real file upload!
 */
export function downloadDemoTemplateSpreadsheet(format: 'csv' | 'xlsx' = 'xlsx'): void {
  const sample = generateDemoPackages(10);
  const rows = sample.map((p) => ({
    Rastreio: p.trackingCode,
    Pedido: p.orderId || '',
    Plataforma: p.platform,
    Rota: p.originalRouteId || '',
    Sequencia: p.originalSequence ?? '',
    Destinatario: p.recipientName,
    Telefone: p.recipientPhone || '',
    Logradouro: p.normalizedAddress.street,
    Numero: p.normalizedAddress.number,
    Complemento: p.normalizedAddress.complement,
    Bairro: p.normalizedAddress.neighborhood,
    Cidade: p.normalizedAddress.city,
    UF: p.normalizedAddress.state,
    CEP: p.normalizedAddress.postalCode,
    Latitude: p.coordinates ? String(p.coordinates.lat) : '',
    Longitude: p.coordinates ? String(p.coordinates.lng) : '',
    Prioridade: p.priority,
    Janela_Inicio: p.timeWindowStart || '',
    Janela_Fim: p.timeWindowEnd || '',
    Peso_Kg: p.weightKg ?? '',
    Observacoes: p.observations || p.deliveryInstructions || '',
  }));

  exportSafeSpreadsheet(rows, `modelo_rota_express_goiania.${format}`, format);
}
