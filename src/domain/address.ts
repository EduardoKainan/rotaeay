import { Coordinates, LocationConfidence, LocationSource, NormalizedAddressParts } from '../types/domain';

const ABBREVIATION_MAP: [RegExp, string][] = [
  [/\bR\.\s*/gi, 'Rua '],
  [/\bAV\.\s*/gi, 'Avenida '],
  [/\bAL\.\s*/gi, 'Alameda '],
  [/\bTRAV\.\s*/gi, 'Travessa '],
  [/\bTV\.\s*/gi, 'Travessa '],
  [/\bROD\.\s*/gi, 'Rodovia '],
  [/\bQD\.\s*/gi, 'Quadra '],
  [/\bQ\.\s*(?=\d)/gi, 'Quadra '],
  [/\bLT\.\s*/gi, 'Lote '],
  [/\bST\.\s*/gi, 'Setor '],
  [/\bSET\.\s*/gi, 'Setor '],
  [/\bJD\.\s*/gi, 'Jardim '],
  [/\bPQ\.\s*/gi, 'Parque '],
  [/\bVL\.\s*/gi, 'Vila '],
  [/\bCOND\.\s*/gi, 'Condomínio '],
  [/\bRES\.\s*/gi, 'Residencial '],
  [/\bED\.\s*/gi, 'Edifício '],
  [/\bBL\.\s*/gi, 'Bloco '],
  [/\bAPT\.\s*/gi, 'Apartamento '],
  [/\bAPTO\.?\s*/gi, 'Apartamento '],
  [/\bCHAC\.\s*/gi, 'Chácara '],
  [/\bFAZ\.\s*/gi, 'Fazenda '],
  [/\bS\/N\b/gi, 'S/N'],
];

const BRAZIL_STATES = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS',
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC',
  'SP', 'SE', 'TO',
]);

/**
 * Normalizes CEP while strictly preserving leading zeros (e.g. "01001000" -> "01001-000").
 */
export function normalizeBrazilianCep(raw?: string | number | null): { cep: string; valid: boolean } {
  if (raw === undefined || raw === null) return { cep: '', valid: false };
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return { cep: '', valid: false };
  // If spreadsheet stripped a single leading zero from an 8-digit CEP (rare edge case, only flag if 7 digits)
  if (digits.length === 8) {
    return { cep: `${digits.slice(0, 5)}-${digits.slice(5)}`, valid: true };
  }
  return { cep: digits, valid: false };
}

/**
 * Validates and detects inverted coordinates for Brazil (lat: -34..6, lng: -74..-32).
 * Never invents coordinates.
 */
export function validateCoordinates(
  rawLat?: string | number | null,
  rawLng?: string | number | null
): {
  coordinates?: Coordinates;
  invertedFixed?: boolean;
  valid: boolean;
  issue?: string;
} {
  if (rawLat === undefined || rawLat === null || rawLat === '' || rawLng === undefined || rawLng === null || rawLng === '') {
    return { valid: false };
  }

  const parseCoord = (v: string | number): number => {
    if (typeof v === 'number') return v;
    const cleaned = v.trim().replace(',', '.');
    return Number(cleaned);
  };

  const lat = parseCoord(rawLat);
  const lng = parseCoord(rawLng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { valid: false, issue: 'Coordenadas não numéricas na planilha.' };
  }
  if (lat === 0 && lng === 0) {
    return { valid: false, issue: 'Coordenada (0, 0) inválida.' };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    // Check if inverted (e.g. lat = -49.26, lng = -16.68 in Brazil)
    if (Math.abs(lng) <= 90 && Math.abs(lat) <= 180) {
      if (lng >= -34 && lng <= 6 && lat >= -75 && lat <= -32) {
        return {
          coordinates: { lat: lng, lng: lat },
          invertedFixed: true,
          valid: true,
          issue: 'Latitude e longitude estavam invertidas e foram corrigidas automaticamente.',
        };
      }
    }
    return { valid: false, issue: 'Coordenadas fora dos limites geográficos válidos.' };
  }

  // Detect Brazil lat/lng swap even when both are <= 90 (e.g. lat = -49.26, lng = -16.68)
  const looksLikeBrazilLat = lat >= -34 && lat <= 6;
  const looksLikeBrazilLng = lng >= -75 && lng <= -32;
  const looksSwappedBrazil = lng >= -34 && lng <= 6 && lat >= -75 && lat <= -32;

  if (!looksLikeBrazilLat && !looksLikeBrazilLng && looksSwappedBrazil) {
    return {
      coordinates: { lat: lng, lng: lat },
      invertedFixed: true,
      valid: true,
      issue: 'Latitude e longitude brasileiras pareciam invertidas e foram ajustadas; recomenda-se conferência.',
    };
  }

  if (!looksLikeBrazilLat || !looksLikeBrazilLng) {
    return {
      coordinates: { lat, lng },
      valid: true,
      issue: 'Coordenadas fora do território brasileiro — requer revisão manual.',
    };
  }

  return { coordinates: { lat, lng }, valid: true };
}

export function cleanSpacesAndAbbreviations(text: string): string {
  let out = text.replace(/\s+/g, ' ').trim();
  for (const [regex, replacement] of ABBREVIATION_MAP) {
    out = out.replace(regex, replacement);
  }
  return out.replace(/\s+/g, ' ').trim();
}

export interface RawAddressInput {
  fullAddress?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  referencePoint?: string;
}

/**
 * Normalizes Brazilian addresses supporting Rua, Av, Quadra, Lote, Setor, Condomínio,
 * Apartamento, Bloco, Chácara, Fazenda, Zona Rural, S/N, and Ponto de Referência.
 * Never invents missing property numbers.
 */
export function normalizeBrazilianAddress(input: RawAddressInput): NormalizedAddressParts {
  const issues: string[] = [];

  let street = cleanSpacesAndAbbreviations(input.street || '');
  let number = (input.number || '').trim();
  let complement = cleanSpacesAndAbbreviations(input.complement || '');
  let neighborhood = cleanSpacesAndAbbreviations(input.neighborhood || '');
  let city = cleanSpacesAndAbbreviations(input.city || '');
  let state = (input.state || '').trim().toUpperCase();
  const { cep: postalCode, valid: cepValid } = normalizeBrazilianCep(input.postalCode);
  const country = (input.country || 'Brasil').trim();
  const referencePoint = cleanSpacesAndAbbreviations(input.referencePoint || '');

  const rawFull = cleanSpacesAndAbbreviations(input.fullAddress || '');

  // If fullAddress is provided and structured fields are missing, parse components safely
  if (rawFull && !street) {
    const parts = rawFull.split(/\s*[,|-]\s*/).filter(Boolean);
    if (parts.length > 0) {
      street = parts[0];
    }
    if (parts.length > 1 && !number) {
      const candidateNum = parts[1].trim();
      if (/^(s\/n|sn|\d+[a-z]?|qd\.?\s*\w+|quadra\s*\w+|lote\s*\w+|km\s*\d+)/i.test(candidateNum)) {
        number = candidateNum.toUpperCase() === 'SN' ? 'S/N' : candidateNum;
      } else if (!neighborhood) {
        neighborhood = candidateNum;
      }
    }
    // Extract CEP if embedded in fullAddress
    const cepMatch = rawFull.match(/\b(\d{5}-?\d{3})\b/);
    const effectiveCep = postalCode || (cepMatch ? normalizeBrazilianCep(cepMatch[1]).cep : '');

    // Extract UF if embedded at end
    if (!state) {
      const ufMatch = rawFull.match(/\b([A-Z]{2})\b(?=\s*(?:,|-|\d{5}|Brasil|$))/);
      if (ufMatch && BRAZIL_STATES.has(ufMatch[1])) {
        state = ufMatch[1];
      }
    }

    if (!neighborhood && parts.length >= 3) {
      neighborhood = parts[2];
    }
    if (!city && parts.length >= 4) {
      city = parts[3].replace(/\b[A-Z]{2}\b/, '').trim();
    }

    // Preserve CEP extracted from fullAddress
    if (!postalCode && effectiveCep) {
      const normalized = normalizeBrazilianCep(effectiveCep);
      if (normalized.valid) {
        input.postalCode = normalized.cep;
      }
    }
  }

  const finalCep = postalCode || normalizeBrazilianCep(input.postalCode).cep;
  const finalCepValid = cepValid || normalizeBrazilianCep(finalCep).valid;

  if (state && !BRAZIL_STATES.has(state)) {
    issues.push(`UF "${state}" não reconhecida.`);
  }
  if (finalCep && !finalCepValid) {
    issues.push(`CEP "${finalCep}" em formato inválido (esperado 8 dígitos).`);
  }

  const combinedText = `${rawFull} ${street} ${number} ${complement}`.toLowerCase();
  const isRural = /\b(zona rural|fazenda|chácara|chacara|sítio|sitio|estrada vicinal|rodovia|distrito|km\s*\d+)\b/i.test(combinedText);
  const hasQuadraLote = /\b(quadra|qd|lote|lt)\b/i.test(combinedText);
  const hasNumberOrLot = Boolean(number && number !== 'S/N') || /\b\d+\b/.test(street) || hasQuadraLote;

  if (!street && !rawFull) {
    issues.push('Logradouro ausente.');
  }
  if (!hasNumberOrLot && !isRural) {
    issues.push('Número ou Quadra/Lote ausente — nunca inventado automaticamente.');
  }
  if (!city) {
    issues.push('Município não informado.');
  }

  const mainLine = [street, number].filter(Boolean).join(', ');
  const locationLine = [neighborhood, city && state ? `${city} - ${state}` : city || state]
    .filter(Boolean)
    .join(', ');
  const formatted = [mainLine || rawFull, locationLine, finalCep].filter(Boolean).join(' • ');

  return {
    street,
    number,
    complement,
    neighborhood,
    city,
    state,
    postalCode: finalCep,
    country,
    referencePoint,
    formatted: formatted || rawFull || 'Endereço não informado',
    isRuralOrIncomplete: isRural || issues.length > 0,
    issues,
  };
}

/**
 * Classifies location confidence strictly without inventing statistical probabilities.
 */
export function classifyLocationConfidence(params: {
  coordinates?: Coordinates;
  source: LocationSource;
  normalized: NormalizedAddressParts;
  coordIssue?: string;
  geocoderLocationType?: string;
}): LocationConfidence {
  const { coordinates, source, normalized, coordIssue, geocoderLocationType } = params;

  if (!coordinates) return 'low';
  if (source === 'manual_pin' || source === 'manual_coordinates') return 'confirmed';
  if (coordIssue) return 'medium';

  if (source === 'google_geocoding') {
    if (geocoderLocationType === 'ROOFTOP') return 'high';
    if (geocoderLocationType === 'RANGE_INTERPOLATED') return normalized.issues.length === 0 ? 'high' : 'medium';
    // Never auto-confirm CEP or neighborhood centroid
    return 'medium';
  }

  if (source === 'spreadsheet' || source === 'demo_dataset') {
    return normalized.issues.length === 0 ? 'confirmed' : 'medium';
  }

  return 'low';
}

/**
 * Builds a deterministic deduplication key for distinct addresses to avoid redundant geocoding API calls.
 */
export function buildAddressDeduplicationKey(normalized: NormalizedAddressParts, rawFallback: string): string {
  const base = `${normalized.street}|${normalized.number}|${normalized.neighborhood}|${normalized.city}|${normalized.state}|${normalized.postalCode}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9|]/g, '');
  if (base.replace(/\|/g, '').length < 4) {
    return rawFallback
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }
  return base;
}
