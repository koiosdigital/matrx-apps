/**
 * Shared types for the Flights port. The API response shapes below are the
 * subset of the aeronav `/flights/*` JSON the app actually reads; everything
 * is optional because the Starlark original probed each field with `.get`.
 */

/** One entry from `/flights/nearby` — only id + distance are used here. */
export interface NearbyFlight {
  id: string;
  distance?: number;
}

interface Airport {
  iata?: string;
  icao?: string;
  name?: string;
}

interface TimingLeg {
  departure?: number;
  arrival?: number;
}

/** `/flights/{id}` detail — the nested pixlet dict, typed loosely. */
export interface FlightDetail {
  identification?: {
    displayName?: string;
    callsign?: string;
    airline?: { logoUrl?: string };
  };
  aircraft?: { model?: string; typeCode?: string; registration?: string };
  route?: { origin?: Airport; destination?: Airport };
  telemetry?: {
    groundSpeed?: number;
    altitude?: number;
    verticalSpeed?: number | null;
    onGround?: boolean;
  };
  observer?: { distance?: number; cardinalDirection?: string };
  timing?: { actual?: TimingLeg; estimated?: TimingLeg; scheduled?: TimingLeg };
  units?: {
    distance?: string;
    speed?: string;
    altitude?: string;
    verticalSpeed?: string;
  };
  phase?: { label?: string };
}

/** Normalized flight the render/subscreen builders consume. */
export interface FlightData {
  carrier: string;
  route: string;
  aircraftModel: string;
  aircraftReg: string;
  logo: Uint8Array | null;
  depTime: number | null;
  arrTime: number | null;
  distance: string;
  cardinal: string;
  speed?: number;
  altitude?: number;
  speedUnit: string;
  altUnit: string;
  verticalSpeed: number | null;
  vspeedUnit: string;
  originName: string | null;
  destName: string | null;
  phaseLabel: string | null;
  onGround?: boolean;
  delaySeconds: number;
}

/** Resolved animation/display config, mirrors the Starlark `anim_config` dict. */
export interface AnimConfig {
  style: string;
  holdFrames: number;
  transitionFrames: number;
  showTiming: boolean;
  showTelemetry: boolean;
  showAirports: boolean;
  showStatus: boolean;
  metric: boolean;
  callsignColor: string;
  routeCode: string;
  expandedCallsign: boolean;
}
