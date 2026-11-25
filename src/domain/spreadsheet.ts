import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  CanonicalColumn,
  DeliveryPackage,
  DeliveryPriority,
  ImportSummary,
  ImportTemplate,
} from '../types/domain';
import {
  classifyLocationConfidence,
  normalizeBrazilianAddress,
  validateCoordinates,
} from './address';

export const CANONICAL_COLUMN_LABELS: Record<CanonicalColumn, string> = {
  package_id: 'ID do Pacote',
  tracking_code: 'Código de Rastreio',
  barcode: 'Código de Barras',
  order_id: 'Número do Pedido',
  shipment_id: 'ID da Remessa',
  platform: 'Plataforma / Origem',
  original_route_id: 'ID da Rota Original',
  original_sequence: 'Sequência Original',
  delivery_sequence: 'Ordem de Entrega',
  recipient_name: 'Nome do Destinatário',
  recipient_phone: 'Telefone / Celular',
  full_address: 'Endereço Completo',
  street: 'Rua / Logradouro',
  number: 'Número',
  complement: 'Complemento',
  neighborhood: 'Bairro',
  city: 'Cidade',
  state: 'UF / Estado',
  postal_code: 'CEP',
  country: 'País',
  latitude: 'Latitude',
  longitude: 'Longitude',
  reference_point: 'Ponto de Referência',
  quantity: 'Quantidade',
  weight: 'Peso (kg)',
  width: 'Largura (cm)',
  height: 'Altura (cm)',
  length: 'Comprimento (cm)',
  priority: 'Prioridade',
  time_window_start: 'Janela Início',
  time_window_end: 'Janela Fim',
  delivery_instructions: 'Instruções de Entrega',
  original_status: 'Status Original',
  observations: 'Observações',
};

const COLUMN_ALIASES: Record<CanonicalColumn, string[]> = {
  package_id: ['package_id', 'id_pacote', 'id pacote', 'pkg_id', 'pacote_id'],
  tracking_code: [
    'tracking_code', 'rastreio', 'tracking', 'tracking_id', 'awb',
    'codigo de rastreio', 'codigo do pacote', 'etiqueta', 'waybill',
    'spx_tn', 'codigo_rastreio', 'codigo rastreamento', 'codigo',
  ],
  barcode: ['barcode', 'codigo de barras', 'ean', 'cod_barras', 'qr'],
  order_id: ['order_id', 'pedido', 'order', 'numero do pedido', 'num_pedido', 'id_pedido'],
  shipment_id: ['shipment_id', 'remessa', 'shipment', 'id_remessa', 'envio'],
  platform: ['platform', 'plataforma', 'canal', 'origem', 'marketplace', 'transportadora'],
  original_route_id: ['original_route_id', 'rota', 'route', 'route_id', 'numero da rota', 'id_rota', 'gaiola', 'corredor'],
  original_sequence: ['original_sequence', 'sequencia', 'sequence', 'stop_number', 'ordem', 'ordem de entrega', 'seq', 'parada'],
  delivery_sequence: ['delivery_sequence', 'sequencia_entrega', 'stop_seq'],
  recipient_name: ['recipient_name', 'destinatario', 'cliente', 'receiver', 'recipient', 'customer', 'nome', 'nome do cliente', 'recebedor'],
  recipient_phone: ['recipient_phone', 'telefone', 'celular', 'phone', 'mobile', 'whatsapp', 'contato', 'fone'],
  full_address: ['full_address', 'endereco', 'address', 'delivery_address', 'destination', 'endereco completo', 'destination address'],
  street: ['street', 'rua', 'logradouro', 'endereco_rua', 'via'],
  number: ['number', 'numero', 'num', 'nro', 'nº', 'no'],
  complement: ['complement', 'complemento', 'apto', 'bloco', 'apt', 'sala', 'casa'],
  neighborhood: ['neighborhood', 'bairro', 'setor', 'district', 'suburb'],
  city: ['city', 'cidade', 'municipio', 'localidade'],
  state: ['state', 'estado', 'uf', 'province'],
  postal_code: ['postal_code', 'cep', 'zip', 'zipcode', 'codigo postal'],
  country: ['country', 'pais'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon', 'long'],
  reference_point: ['reference_point', 'referencia', 'ponto de referencia', 'landmark'],
  quantity: ['quantity', 'quantidade', 'qtd', 'qty', 'volumes', 'itens'],
  weight: ['weight', 'peso', 'weight_kg', 'peso_kg'],
  width: ['width', 'largura'],
  height: ['height', 'altura'],
  length: ['length', 'comprimento'],
  priority: ['priority', 'prioridade', 'urgente', 'urgencia', 'sla'],
  time_window_start: ['time_window_start', 'janela_inicio', 'horario_inicio', 'inicio', 'hora_inicio', 'de'],
  time_window_end: ['time_window_end', 'janela_fim', 'horario_fim', 'fim', 'hora_fim', 'ate'],
  delivery_instructions: ['delivery_instructions', 'instrucoes', 'instrucoes de entrega', 'instructions'],
  original_status: ['original_status', 'status', 'situacao', 'estado_pacote'],
  observations: ['observations', 'observacoes', 'obs', 'notas', 'notes', 'comentarios'],
};

export function normalizeHeaderName(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Generates a stable structural signature for template learning & reuse.
 */
export function computeStructureSignature(headers: string[]): string {
  return headers.map(normalizeHeaderName).filter(Boolean).sort().join('|');
}

/**
 * Simple FNV-1a hash for reimport detection without crypto dependencies in browser.
 */
export function computeContentHash(content: string): string {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}

/**
 * Strips leading spreadsheet formula characters to protect against CSV/Excel formula injection.
 */
export function sanitizeSpreadsheetCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  let str = String(value).trim();
  // Never execute or preserve raw executable formulas from untrusted uploads
  if (/^[=+\-@\t\r]/.test(str)) {
    // Allow negative numbers (e.g., coordinates like -16.6869) and phone numbers starting with +55
    const isNegativeCoordinate = /^-\d+(\.\d+)?$/.test(str);
    const isPhoneWithPlus = /^\+\d[\d\s()-]{6,}$/.test(str);
    if (!isNegativeCoordinate && !isPhoneWithPlus) {
      str = str.replace(/^[=+\-@\t\r]+/, '').trim();
    }
  }
  return str;
}

/**
 * Safe cell sanitizer for CSV/XLSX export (prefixes formula-triggering characters with apostrophe).
 */
export function escapeCsvFormulaInjection(value: unknown): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str) && !/^-\d+(\.\d+)?$/.test(str)) {
    return `'${str}`;
  }
  return str;
}

export interface ParsedSpreadsheet {
  fileName: string;
  fileType: 'xlsx' | 'xls' | 'csv';
  fileHash: string;
  sheetNames: string[];
  selectedSheet: string;
  headers: string[];
  rows: Record<string, string>[];
  rawWorkbook?: XLSX.WorkBook;
  detectedDelimiter?: string;
}

/**
 * Parses XLSX, XLS, or CSV (UTF-8 and Windows-1252 fallback) while strictly preserving
 * leading zeros and never evaluating formulas.
 */
export async function parseSpreadsheetFile(file: File): Promise<ParsedSpreadsheet> {
  const lower = file.name.toLowerCase();
  const isCsv = lower.endsWith('.csv') || file.type.includes('csv') || lower.endsWith('.txt');
  const buffer = await file.arrayBuffer();

  if (isCsv) {
    // Decode UTF-8 first; if replacement characters appear, fallback to Windows-1252
    let text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    if (text.includes('\uFFFD')) {
      try {
        text = new TextDecoder('windows-1252').decode(buffer);
      } catch {
        // Keep UTF-8 text if windows-1252 decoder unavailable
      }
    }
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: false,
      dynamicTyping: false, // CRITICAL: keep leading zeros in tracking codes and CEPs!
      transform: (val) => sanitizeSpreadsheetCell(val),
    });

    const headers = (parsed.meta.fields || []).map((h) => h.trim()).filter(Boolean);
    const rows = (parsed.data || []).map((row) => {
      const cleaned: Record<string, string> = {};
      for (const h of headers) {
        cleaned[h] = sanitizeSpreadsheetCell(row[h]);
      }
      return cleaned;
    });

    return {
      fileName: file.name,
      fileType: 'csv',
      fileHash: computeContentHash(`${file.name}:${text.slice(0, 8000)}:${rows.length}`),
      sheetNames: ['CSV'],
      selectedSheet: 'CSV',
      headers,
      rows,
      detectedDelimiter: parsed.meta.delimiter,
    };
  }

  // SheetJS for XLSX / XLS — raw: false & cellFormula: false ensures strings preserve leading zeros and formulas are not executed
  const workbook = XLSX.read(buffer, {
    type: 'array',
    raw: false,
    cellFormula: false,
    cellDates: false,
  });

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    throw new Error('A planilha não contém abas válidas.');
  }

  const selectedSheet = workbook.SheetNames[0];
  const extracted = extractSheetData(workbook, selectedSheet);

  return {
    fileName: file.name,
    fileType: lower.endsWith('.xls') ? 'xls' : 'xlsx',
    fileHash: computeContentHash(`${file.name}:${selectedSheet}:${extracted.headers.join(',')}:${extracted.rows.length}`),
    sheetNames: workbook.SheetNames,
    selectedSheet,
    headers: extracted.headers,
    rows: extracted.rows,
    rawWorkbook: workbook,
  };
}

export function extractSheetData(
  workbook: XLSX.WorkBook,
  sheetName: string
): { headers: string[]; rows: Record<string, string>[] } {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    return { headers: [], rows: [] };
  }

  // Read as 2D array of formatted strings to detect header row and preserve leading zeros
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  });

  if (matrix.length === 0) {
    return { headers: [], rows: [] };
  }

  // Auto-detect header row (first row with >= 2 non-empty cells)
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    const nonEmpty = (matrix[i] || []).filter((cell) => String(cell ?? '').trim().length > 0);
    if (nonEmpty.length >= 2) {
      headerRowIdx = i;
      break;
    }
  }

  const rawHeaders = (matrix[headerRowIdx] || []).map((c, idx) => {
    const label = sanitizeSpreadsheetCell(c);
    return label || `Coluna_${idx + 1}`;
  });

  // Deduplicate identical header names
  const seen: Record<string, number> = {};
  const headers = rawHeaders.map((h) => {
    seen[h] = (seen[h] || 0) + 1;
    return seen[h] > 1 ? `${h}_${seen[h]}` : h;
  });

  const rows: Record<string, string>[] = [];
  for (let r = headerRowIdx + 1; r < matrix.length; r++) {
    const rowArr = matrix[r] || [];
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      obj[headers[c]] = sanitizeSpreadsheetCell(rowArr[c]);
    }
    rows.push(obj);
  }

  return { headers, rows };
}

/**
 * Deterministic + similarity header matcher with saved template lookup.
 */
export function autoMapColumns(
  headers: string[],
  savedTemplates: ImportTemplate[] = []
): {
  mapping: Record<string, CanonicalColumn | ''>;
  matchedTemplate?: ImportTemplate;
  ambiguousHeaders: string[];
} {
  const signature = computeStructureSignature(headers);
  const matchedTemplate = savedTemplates.find((t) => t.structureSignature === signature);

  const mapping: Record<string, CanonicalColumn | ''> = {};
  const usedTargets = new Set<CanonicalColumn>();
  const ambiguousHeaders: string[] = [];

  if (matchedTemplate) {
    for (const h of headers) {
      const target = matchedTemplate.columnMapping[h] || '';
      mapping[h] = target;
      if (target) usedTargets.add(target);
    }
    return { mapping, matchedTemplate, ambiguousHeaders };
  }

  // Pass 1: Exact normalized alias match
  for (const h of headers) {
    const norm = normalizeHeaderName(h);
    let matched: CanonicalColumn | '' = '';
    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES) as [CanonicalColumn, string[]][]) {
      if (usedTargets.has(canonical)) continue;
      if (aliases.some((alias) => normalizeHeaderName(alias) === norm)) {
        matched = canonical;
        break;
      }
    }
    mapping[h] = matched;
    if (matched) usedTargets.add(matched);
  }

  // Pass 2: Token inclusion similarity for remaining headers
  for (const h of headers) {
    if (mapping[h]) continue;
    const norm = normalizeHeaderName(h);
    let bestTarget: CanonicalColumn | '' = '';
    let bestScore = 0;

    for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES) as [CanonicalColumn, string[]][]) {
      if (usedTargets.has(canonical)) continue;
      for (const alias of aliases) {
        const normAlias = normalizeHeaderName(alias);
        if (normAlias.length < 3) continue;
        if (norm.includes(normAlias) || normAlias.includes(norm)) {
          const score = Math.min(norm.length, normAlias.length) / Math.max(norm.length, normAlias.length);
          if (score > bestScore && score >= 0.45) {
            bestScore = score;
            bestTarget = canonical;
          }
        }
      }
    }

    if (bestTarget && bestScore >= 0.6) {
      mapping[h] = bestTarget;
      usedTargets.add(bestTarget);
    } else {
      mapping[h] = '';
      if (norm.length > 0) ambiguousHeaders.push(h);
    }
  }

  return { mapping, ambiguousHeaders };
}

function parsePriority(raw?: string): DeliveryPriority {
  if (!raw) return 'normal';
  const v = raw.toLowerCase();
  if (v.includes('urg') || v.includes('crit') || v === '1' || v.includes('express')) return 'urgent';
  if (v.includes('alt') || v.includes('high') || v.includes('prio') || v === '2') return 'high';
  return 'normal';
}

function parseTimeHHmm(raw?: string): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/(\d{1,2})[:h](\d{2})/);
  if (!match) return undefined;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return undefined;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/**
 * Converts parsed spreadsheet rows into traceable DeliveryPackages with full diagnostics.
 * CRITICAL RULE: No package silently disappears; every row gets a traceable result.
 */
export function buildPackagesFromSpreadsheet(params: {
  rows: Record<string, string>[];
  mapping: Record<string, CanonicalColumn | ''>;
  defaultPlatform: string;
  userId: string;
  organizationId: string;
  fileName: string;
  fileHash: string;
  sheetName: string;
  existingTrackingCodes?: Set<string>;
  maxRows?: number;
}): {
  packages: DeliveryPackage[];
  summary: ImportSummary;
} {
  const {
    rows,
    mapping,
    defaultPlatform,
    userId,
    organizationId,
    fileName,
    fileHash,
    sheetName,
    existingTrackingCodes = new Set<string>(),
    maxRows = 500,
  } = params;

  // Invert mapping: canonical -> source header(s)
  const canonicalToHeaders: Partial<Record<CanonicalColumn, string[]>> = {};
  for (const [header, canonical] of Object.entries(mapping)) {
    if (!canonical) continue;
    if (!canonicalToHeaders[canonical]) canonicalToHeaders[canonical] = [];
    canonicalToHeaders[canonical]!.push(header);
  }

  const getVal = (row: Record<string, string>, col: CanonicalColumn): string => {
    const hs = canonicalToHeaders[col];
    if (!hs || hs.length === 0) return '';
    for (const h of hs) {
      const v = (row[h] ?? '').trim();
      if (v) return v;
    }
    return '';
  };

  const packages: DeliveryPackage[] = [];
  const seenTracking = new Set<string>(existingTrackingCodes);
  const originalRoutes = new Set<string>();

  let emptyRowsSkipped = 0;
  let duplicatePackages = 0;
  let incompleteAddresses = 0;
  let packagesWithCoordinates = 0;
  let packagesNeedingGeocoding = 0;
  let packagesPendingReview = 0;

  const slicedRows = rows.slice(0, maxRows);

  slicedRows.forEach((row, idx) => {
    const sourceRow = idx + 2; // 1-indexed with header row
    const hasAnyData = Object.values(row).some((v) => v && v.trim().length > 0);
    if (!hasAnyData) {
      emptyRowsSkipped += 1;
      return;
    }

    const rawTracking =
      getVal(row, 'tracking_code') ||
      getVal(row, 'barcode') ||
      getVal(row, 'package_id') ||
      getVal(row, 'order_id') ||
      `LINHA-${String(sourceRow).padStart(4, '0')}`;

    const validationIssues: string[] = [];
    let isDuplicate = false;

    if (seenTracking.has(rawTracking)) {
      isDuplicate = true;
      duplicatePackages += 1;
      validationIssues.push(`Código de rastreio duplicado: ${rawTracking}`);
    } else {
      seenTracking.add(rawTracking);
    }

    const originalRouteId = getVal(row, 'original_route_id') || undefined;
    if (originalRouteId) originalRoutes.add(originalRouteId);

    const rawSeqStr = getVal(row, 'original_sequence') || getVal(row, 'delivery_sequence');
    const parsedSeq = rawSeqStr && /^\d+$/.test(rawSeqStr) ? Number(rawSeqStr) : undefined;

    const fullAddress = getVal(row, 'full_address');
    const street = getVal(row, 'street');
    const number = getVal(row, 'number');
    const complement = getVal(row, 'complement');
    const neighborhood = getVal(row, 'neighborhood');
    const city = getVal(row, 'city');
    const state = getVal(row, 'state');
    const postalCode = getVal(row, 'postal_code');
    const country = getVal(row, 'country') || 'Brasil';
    const referencePoint = getVal(row, 'reference_point');

    const normalized = normalizeBrazilianAddress({
      fullAddress,
      street,
      number,
      complement,
      neighborhood,
      city,
      state,
      postalCode,
      country,
      referencePoint,
    });

    if (normalized.issues.length > 0) {
      incompleteAddresses += 1;
      validationIssues.push(...normalized.issues);
    }

    const coordCheck = validateCoordinates(getVal(row, 'latitude'), getVal(row, 'longitude'));
    if (coordCheck.issue) {
      validationIssues.push(coordCheck.issue);
    }

    const locationSource = coordCheck.coordinates ? 'spreadsheet' : 'unresolved';
    const locationConfidence = classifyLocationConfidence({
      coordinates: coordCheck.coordinates,
      source: locationSource,
      normalized,
      coordIssue: coordCheck.issue,
    });

    if (coordCheck.coordinates) {
      packagesWithCoordinates += 1;
    } else {
      packagesNeedingGeocoding += 1;
    }

    if (locationConfidence === 'low' || locationConfidence === 'medium' || validationIssues.length > 0) {
      packagesPendingReview += 1;
    }

    const rawQty = Number(getVal(row, 'quantity').replace(',', '.'));
    const quantity = Number.isFinite(rawQty) && rawQty > 0 ? Math.round(rawQty) : 1;

    const rawWeight = Number(getVal(row, 'weight').replace(',', '.'));
    const weightKg = Number.isFinite(rawWeight) && rawWeight > 0 ? rawWeight : undefined;

    const originalAddress =
      fullAddress ||
      [street, number, complement, neighborhood, city, state, postalCode].filter(Boolean).join(', ') ||
      'Endereço ausente na planilha';

    const pkg: DeliveryPackage = {
      id: `pkg_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      userId,
      organizationId,
      sourceRow,
      platform: getVal(row, 'platform') || defaultPlatform,
      trackingCode: rawTracking, // Always string, preserving leading zeros!
      barcode: getVal(row, 'barcode') || undefined,
      orderId: getVal(row, 'order_id') || undefined,
      shipmentId: getVal(row, 'shipment_id') || undefined,
      originalRouteId,
      originalSequence: parsedSeq,
      recipientName: getVal(row, 'recipient_name') || 'Destinatário não informado',
      recipientPhone: getVal(row, 'recipient_phone') || undefined,
      originalAddress,
      normalizedAddress: normalized,
      coordinates: coordCheck.coordinates,
      locationSource,
      locationConfidence,
      locationUpdatedAt: coordCheck.coordinates ? new Date().toISOString() : undefined,
      quantity,
      weightKg,
      isFragile: /fr[aá]gil/i.test(`${getVal(row, 'observations')} ${getVal(row, 'delivery_instructions')}`),
      priority: parsePriority(getVal(row, 'priority')),
      timeWindowStart: parseTimeHHmm(getVal(row, 'time_window_start')),
      timeWindowEnd: parseTimeHHmm(getVal(row, 'time_window_end')),
      deliveryInstructions: getVal(row, 'delivery_instructions') || undefined,
      originalStatus: getVal(row, 'original_status') || undefined,
      observations: getVal(row, 'observations') || undefined,
      status: 'pending',
      attemptCount: 0,
      isDuplicate,
      validationIssues,
    };

    packages.push(pkg);
  });

  return {
    packages,
    summary: {
      fileName,
      fileHash,
      sheetName,
      totalRowsRead: slicedRows.length,
      validPackages: packages.length,
      emptyRowsSkipped,
      duplicatePackages,
      incompleteAddresses,
      packagesWithCoordinates,
      packagesNeedingGeocoding,
      packagesPendingReview,
      originalRoutesFound: Array.from(originalRoutes),
    },
  };
}

/**
 * Exports rows safely to CSV or XLSX with formula-injection protection.
 */
export function exportSafeSpreadsheet(
  rows: Record<string, string | number | boolean | undefined>[],
  fileName: string,
  format: 'csv' | 'xlsx'
): void {
  const safeRows = rows.map((row) => {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'number' || typeof v === 'boolean') {
        out[k] = v;
      } else {
        out[k] = escapeCsvFormulaInjection(v ?? '');
      }
    }
    return out;
  });

  if (format === 'csv') {
    const csv = Papa.unparse(safeRows);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, fileName.endsWith('.csv') ? fileName : `${fileName}.csv`);
    return;
  }

  const ws = XLSX.utils.json_to_sheet(safeRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'RotaExpress');
  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
