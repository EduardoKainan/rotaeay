import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  Crosshair,
  ExternalLink,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
} from 'lucide-react';
import { Coordinates, RoutePoint, RouteStop } from '../types/domain';
import { buildExternalNavigationUrl } from '../domain/optimizer';
import { useAppStore } from '../store/useAppStore';

interface InteractiveMapProps {
  origin?: RoutePoint;
  stops: RouteStop[];
  nextStopId?: string;
  selectedStopId?: string | null;
  onSelectStop?: (stopId: string | null) => void;
  editablePinStopId?: string | null;
  onConfirmPinMove?: (stopId: string, coords: Coordinates) => void;
  heightClass?: string;
  showRoadPolyline?: boolean;
  onNavigateToDriverStop?: (stopId: string) => void;
}

const DEFAULT_GOIANIA_CENTER: Coordinates = { lat: -16.6869, lng: -49.2648 };

function getStopColor(stop: RouteStop, isNext: boolean): { bg: string; border: string; label: string } {
  if (stop.locationConfidence === 'low') {
    return { bg: '#A855F7', border: '#6B21A8', label: 'Revisão' };
  }
  if (isNext && (stop.status === 'pending' || stop.status === 'in_progress' || stop.status === 'partial')) {
    return { bg: '#F97316', border: '#9A3412', label: 'Próxima' };
  }
  switch (stop.status) {
    case 'completed':
      return { bg: '#22C55E', border: '#15803D', label: 'Entregue' };
    case 'failed':
      return { bg: '#EF4444', border: '#991B1B', label: 'Falha' };
    case 'postponed':
      return { bg: '#EAB308', border: '#854D0E', label: 'Adiada' };
    case 'partial':
      return { bg: '#F97316', border: '#9A3412', label: 'Parcial' };
    case 'in_progress':
      return { bg: '#F97316', border: '#9A3412', label: 'Ativa' };
    default:
      return { bg: '#3B82F6', border: '#1D4ED8', label: 'Pendente' };
  }
}

interface MapPolylineLike {
  setMap: (map: unknown | null) => void;
}

interface LatLngBoundsLike {
  extend: (pt: Coordinates) => void;
}

/**
 * Computes real road-network polylines using the modern Google Maps JS `routes` library
 * (`Route.computeRoutes` + `createPolylines()`). NEVER uses legacy DirectionsService.
 * Caps intermediates to <= 20 to respect Routes API waypoint limits and quota budget.
 */
function RoadPolylineLayer({
  origin,
  stops,
  enabled,
  onRoadStatus,
}: {
  origin?: RoutePoint;
  stops: RouteStop[];
  enabled: boolean;
  onRoadStatus: (info: { realSegments: number; omittedStops: number; error?: string }) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes') as unknown as {
    Route?: {
      computeRoutes: (req: unknown) => Promise<{
        routes?: Array<{
          createPolylines: (opts?: { polylineOptions?: Record<string, unknown> }) => MapPolylineLike[];
        }>;
      }>;
    };
  } | null;

  const polylinesRef = useRef<MapPolylineLike[]>([]);

  const coordKey = useMemo(() => {
    const valid = stops.filter((s) => Boolean(s.coordinates)).slice(0, 22);
    return [
      origin?.coordinates ? `${origin.coordinates.lat.toFixed(4)},${origin.coordinates.lng.toFixed(4)}` : 'none',
      ...valid.map((s) => `${s.id}:${s.coordinates!.lat.toFixed(4)},${s.coordinates!.lng.toFixed(4)}`),
    ].join('|');
  }, [origin, stops]);

  useEffect(() => {
    // Cleanup previous polylines
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!enabled || !map || !routesLib?.Route) return;

    const validStops = stops.filter((s) => Boolean(s.coordinates));
    if (validStops.length === 0) return;

    const startCoord = origin?.coordinates || validStops[0].coordinates!;
    const routeStops = origin?.coordinates ? validStops : validStops.slice(1);
    if (routeStops.length === 0) return;

    // Respect Routes API max 25 intermediates (cap at 18 for fast UX and quota discipline)
    const capped = routeStops.slice(0, 19);
    const omittedStops = Math.max(0, routeStops.length - capped.length);
    const destination = capped[capped.length - 1].coordinates!;
    const intermediates = capped.slice(0, -1).map((s) => ({
      location: { lat: s.coordinates!.lat, lng: s.coordinates!.lng },
    }));

    let cancelled = false;

    const compute = async () => {
      try {
        const res = await routesLib.Route!.computeRoutes({
          origin: { lat: startCoord.lat, lng: startCoord.lng },
          destination: { lat: destination.lat, lng: destination.lng },
          intermediates,
          travelMode: 'DRIVING',
          fields: ['path', 'distanceMeters', 'durationMillis'],
        });

        if (cancelled) return;
        const firstRoute = res?.routes?.[0];
        if (!firstRoute) {
          onRoadStatus({ realSegments: 0, omittedStops, error: 'Malha viária não retornada para estes pontos.' });
          return;
        }

        const lines = firstRoute.createPolylines({
          polylineOptions: {
            strokeColor: '#2563EB',
            strokeOpacity: 0.85,
            strokeWeight: 4,
          },
        });
        lines.forEach((line) => line.setMap(map));
        polylinesRef.current = lines;
        onRoadStatus({ realSegments: capped.length, omittedStops });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('OVER_QUERY_LIMIT') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onRoadStatus({
          realSegments: 0,
          omittedStops,
          error: 'Polilinha viária indisponível no momento — exibindo marcadores exatos.',
        });
      }
    };

    void compute();

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [enabled, map, routesLib, coordKey]);

  return null;
}

function FitBoundsHelper({ origin, stops }: { origin?: RoutePoint; stops: RouteStop[] }) {
  const map = useMap();
  const fittedRef = useRef<string>('');

  useEffect(() => {
    if (!map) return;
    const pts: Coordinates[] = [];
    if (origin?.coordinates) pts.push(origin.coordinates);
    stops.forEach((s) => {
      if (s.coordinates) pts.push(s.coordinates);
    });
    if (pts.length === 0) return;

    const key = `${pts.length}:${pts[0].lat.toFixed(3)},${pts[0].lng.toFixed(3)}`;
    if (fittedRef.current === key) return;
    fittedRef.current = key;

    if (pts.length === 1) {
      map.panTo(pts[0]);
      map.setZoom(15);
      return;
    }

    const gMaps = (window as unknown as { google?: { maps?: { LatLngBounds?: new () => LatLngBoundsLike } } }).google?.maps;
    if (!gMaps?.LatLngBounds) return;
    const bounds = new gMaps.LatLngBounds();
    pts.forEach((p) => bounds.extend(p));
    (map as unknown as { fitBounds: (b: LatLngBoundsLike, pad: Record<string, number>) => void }).fitBounds(bounds, {
      top: 48,
      right: 48,
      bottom: 48,
      left: 48,
    });
  }, [map, origin, stops]);

  return null;
}

export function InteractiveMap({
  origin,
  stops,
  nextStopId,
  selectedStopId,
  onSelectStop,
  editablePinStopId,
  onConfirmPinMove,
  heightClass = 'h-[440px] lg:h-[580px]',
  showRoadPolyline = true,
  onNavigateToDriverStop,
}: InteractiveMapProps) {
  const googleMapsKey = useAppStore((s) => s.googleMapsKey);
  const [mapTypeId, setMapTypeId] = useState<'roadmap' | 'hybrid'>('roadmap');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [neighborhoodFilter, setNeighborhoodFilter] = useState<string>('all');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [roadOverlayEnabled, setRoadOverlayEnabled] = useState(showRoadPolyline);
  const [roadStatus, setRoadStatus] = useState<{ realSegments: number; omittedStops: number; error?: string }>({
    realSegments: 0,
    omittedStops: 0,
  });

  const activeSelectedId = selectedStopId !== undefined ? selectedStopId : internalSelectedId;
  const setSelected = (id: string | null) => {
    setInternalSelectedId(id);
    onSelectStop?.(id);
  };

  const neighborhoods = useMemo(
    () => Array.from(new Set(stops.map((s) => s.neighborhood).filter(Boolean))).sort(),
    [stops]
  );

  const filteredStops = useMemo(() => {
    return stops.filter((s) => {
      if (!s.coordinates) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (neighborhoodFilter !== 'all' && s.neighborhood !== neighborhoodFilter) return false;
      return true;
    });
  }, [stops, statusFilter, neighborhoodFilter]);

  const missingCoordsCount = stops.filter((s) => !s.coordinates).length;
  const selectedStop = filteredStops.find((s) => s.id === activeSelectedId) || null;

  const initialCenter = useMemo<Coordinates>(() => {
    if (origin?.coordinates) return origin.coordinates;
    const firstValid = filteredStops[0]?.coordinates;
    return firstValid || DEFAULT_GOIANIA_CENTER;
  }, [origin, filteredStops]);

  if (!googleMapsKey) {
    return (
      <div className={`rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-6 flex flex-col items-center justify-center text-center gap-3 ${heightClass}`}>
        <MapPin className="w-8 h-8 text-slate-400" />
        <div className="space-y-1 max-w-md">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Google Maps JavaScript API não configurada
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Configure a chave pública em <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> ou verifique o diagnóstico em Configurações &gt; Integrações. As paradas continuam disponíveis em lista com links diretos para Google Maps e Waze.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${
        isFullscreen
          ? 'fixed inset-0 z-50 bg-white dark:bg-slate-950 p-3 flex flex-col'
          : 'rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden'
      }`}
    >
      {/* Top Map Toolbar */}
      <div className="px-3 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filtrar paradas por status"
            className="min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 px-2.5"
          >
            <option value="all">Todos status ({stops.filter((s) => s.coordinates).length})</option>
            <option value="pending">Pendentes</option>
            <option value="in_progress">Em andamento</option>
            <option value="completed">Entregues</option>
            <option value="partial">Parciais</option>
            <option value="failed">Falhas</option>
            <option value="postponed">Adiadas</option>
          </select>

          {neighborhoods.length > 1 && (
            <select
              value={neighborhoodFilter}
              onChange={(e) => setNeighborhoodFilter(e.target.value)}
              aria-label="Filtrar por bairro"
              className="min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200 px-2.5 max-w-[180px]"
            >
              <option value="all">Todos bairros</option>
              {neighborhoods.map((nb) => (
                <option key={nb} value={nb}>
                  {nb}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={() => setRoadOverlayEnabled((v) => !v)}
            className={`min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              roadOverlayEnabled
                ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300'
            }`}
          >
            <Navigation className="w-3.5 h-3.5" />
            Traçado viário
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMapTypeId((t) => (t === 'roadmap' ? 'hybrid' : 'roadmap'))}
            className="min-h-[36px] inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 px-2.5 whitespace-nowrap shrink-0"
          >
            <Layers className="w-3.5 h-3.5" />
            {mapTypeId === 'roadmap' ? 'Satélite' : 'Mapa'}
          </button>
          <button
            type="button"
            onClick={() => setIsFullscreen((f) => !f)}
            className="min-h-[36px] inline-flex items-center justify-center rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 px-2.5"
            aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Editable Pin Notice */}
      {editablePinStopId && (
        <div className="px-3 py-2 bg-purple-50 dark:bg-purple-950/50 border-b border-purple-200 dark:border-purple-900 text-xs text-purple-900 dark:text-purple-200 flex items-center gap-2">
          <Crosshair className="w-4 h-4 shrink-0" />
          <span>
            <strong>Modo Correção de Pino ativo:</strong> arraste o marcador selecionado para o portão/entrada exata do destinatário para confirmar a coordenada manualmente.
          </span>
        </div>
      )}

      {/* Explicit sized container prevents 0x0 Google Maps collapse */}
      <div className={`relative w-full ${isFullscreen ? 'flex-1 min-h-0' : heightClass}`}>
        <APIProvider apiKey={googleMapsKey} language="pt-BR" region="BR">
          <GoogleMap
            defaultCenter={initialCenter}
            defaultZoom={12}
            mapId="DEMO_MAP_ID"
            mapTypeId={mapTypeId}
            gestureHandling="greedy"
            disableDefaultUI={false}
            streetViewControl={false}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            className="w-full h-full"
          >
            <FitBoundsHelper origin={origin} stops={filteredStops} />

            <RoadPolylineLayer
              origin={origin}
              stops={filteredStops}
              enabled={roadOverlayEnabled}
              onRoadStatus={setRoadStatus}
            />

            {/* Origin / Depot Marker */}
            {origin?.coordinates && (
              <AdvancedMarker position={origin.coordinates} title={origin.label}>
                <Pin background="#38BDF8" borderColor="#0369A1" glyphColor="#FFFFFF" glyph="CD" />
              </AdvancedMarker>
            )}

            {/* Numbered Stop Markers */}
            {filteredStops.map((stop) => {
              const isNext = stop.id === nextStopId;
              const isEditable = stop.id === editablePinStopId;
              const style = getStopColor(stop, isNext);
              return (
                <AdvancedMarker
                  key={stop.id}
                  position={stop.coordinates!}
                  title={`Parada #${stop.sequence} — ${stop.address}`}
                  draggable={isEditable}
                  onClick={() => setSelected(stop.id)}
                  onDragEnd={(e) => {
                    if (isEditable && e.latLng && onConfirmPinMove) {
                      onConfirmPinMove(stop.id, {
                        lat: Number(e.latLng.lat().toFixed(6)),
                        lng: Number(e.latLng.lng().toFixed(6)),
                      });
                    }
                  }}
                >
                  <Pin
                    background={isEditable ? '#9333EA' : style.bg}
                    borderColor={isEditable ? '#581C87' : style.border}
                    glyphColor="#FFFFFF"
                    glyph={String(stop.sequence)}
                    scale={isNext || isEditable ? 1.2 : 1.0}
                  />
                </AdvancedMarker>
              );
            })}

            {selectedStop && selectedStop.coordinates && (
              <InfoWindow
                position={selectedStop.coordinates}
                onCloseClick={() => setSelected(null)}
              >
                <div className="p-1 max-w-[240px] text-slate-900 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold tabular-nums">Parada #{selectedStop.sequence}</span>
                    <span className="text-[11px] font-medium text-slate-600">
                      {selectedStop.packageIds.length} pacote(s)
                    </span>
                  </div>
                  <p className="text-xs font-medium leading-snug">{selectedStop.address}</p>
                  <p className="text-[11px] text-slate-600">
                    {selectedStop.neighborhood}
                    {selectedStop.complementSummary ? ` · ${selectedStop.complementSummary}` : ''}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <a
                      href={buildExternalNavigationUrl('google_maps', selectedStop)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded bg-blue-600 text-white px-2 py-1 text-[11px] font-medium"
                    >
                      Maps <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={buildExternalNavigationUrl('waze', selectedStop)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded bg-sky-500 text-white px-2 py-1 text-[11px] font-medium"
                    >
                      Waze <ExternalLink className="w-3 h-3" />
                    </a>
                    {onNavigateToDriverStop && (
                      <button
                        type="button"
                        onClick={() => onNavigateToDriverStop(selectedStop.id)}
                        className="inline-flex items-center gap-1 rounded bg-slate-900 text-white px-2 py-1 text-[11px] font-medium"
                      >
                        Abrir parada
                      </button>
                    )}
                  </div>
                </div>
              </InfoWindow>
            )}
          </GoogleMap>
        </APIProvider>
      </div>

      {/* Honest Legend & Status Footer */}
      <div className="px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-400">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Próxima</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Pendente</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> Entregue</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500" /> Falha</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-500" /> Adiada</span>
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-purple-500" /> Revisão</span>
        </div>

        <div className="flex items-center gap-2">
          {missingCoordsCount > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              {missingCoordsCount} sem coordenadas
            </span>
          )}
          {roadOverlayEnabled && roadStatus.omittedStops > 0 && (
            <span className="text-slate-500">
              Traçado viário exibido nos primeiros {roadStatus.realSegments} trechos ({roadStatus.omittedStops} paradas adicionais exibidas como marcadores)
            </span>
          )}
          {roadOverlayEnabled && roadStatus.error && (
            <span className="text-amber-700 dark:text-amber-400">{roadStatus.error}</span>
          )}
        </div>
      </div>
    </div>
  );
}
