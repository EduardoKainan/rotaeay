import { Coordinates, OptimizationStrategy, RouteConstraints, RoutePoint, RouteStop, Vehicle } from '../types/domain';
import { CostMatrix } from './optimizer';

export interface GeocodingResult {
  query: string;
  coordinates?: Coordinates;
  formattedAddress?: string;
  locationType?: string;
  provider: string;
  cached?: boolean;
  error?: string;
}

export interface GeocodingProvider {
  readonly id: string;
  readonly label: string;
  geocode(address: string, region?: string): Promise<GeocodingResult>;
}

export interface AddressValidationProvider {
  readonly id: string;
  validate(address: string): Promise<{ valid: boolean; standardizedAddress?: string; issues: string[] }>;
}

export interface RoutingProvider {
  readonly id: string;
  computePolyline(waypoints: Coordinates[], options?: { avoidTolls?: boolean; avoidHighways?: boolean }): Promise<{
    encodedPolyline?: string;
    distanceMeters: number;
    durationSeconds: number;
    isRoadReal: boolean;
  }>;
}

export interface DistanceMatrixProvider {
  readonly id: string;
  computeMatrix(nodes: Coordinates[], options?: { considerTraffic?: boolean; avoidTolls?: boolean }): Promise<CostMatrix>;
}

export interface OptimizationProvider {
  readonly id: string;
  readonly label: string;
  optimize(params: {
    stops: RouteStop[];
    origin: RoutePoint;
    destination?: RoutePoint;
    vehicle: Vehicle;
    constraints: RouteConstraints;
    strategy: OptimizationStrategy;
  }): Promise<{
    orderedStopIds: string[];
    totalDistanceMeters: number;
    travelDurationSeconds: number;
    encodedPolyline?: string;
    isRoadReal: boolean;
    warnings: string[];
  }>;
}

export interface NavigationProvider {
  readonly id: 'google_maps' | 'waze';
  buildUrl(destination: { coordinates?: Coordinates; address: string }): string;
}

export interface TrafficProvider {
  readonly id: string;
  readonly supportsLiveTraffic: boolean;
}
