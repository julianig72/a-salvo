export type RiskId = 'flood' | 'wildfire' | 'earthquake';
export type Page = 'home' | 'plan' | 'map' | 'kit' | 'sources' | 'help';
export type NeedId = 'children' | 'elderly' | 'mobility' | 'medication' | 'power' | 'sensory' | 'pets';
export type DwellingId = 'flat' | 'house';
export type LevelId = 'basement' | 'ground' | 'upper';
export type HomeFeatureId = 'garage-below' | 'near-water' | 'near-vegetation' | 'vehicle';
export type PhaseId = 'prepare' | 'warning' | 'during' | 'after';

export interface HomeAddress {
  label: string;
  kind: 'street' | 'portal';
  lat: number;
  lon: number;
  postalCode?: string;
}

export interface MunicipalitySuggestion { code: string; name: string; provinceCode: string; province: string }
export interface AddressSuggestion { id: string; type: 'callejero' | 'portal'; label: string; postalCode?: string; place?: string }

export interface Household {
  municipality: string;
  /** INE code, set only when the municipality was chosen from the official list. */
  municipalityCode: string;
  provinceCode: string;
  /** Street (and number) validated against CartoCiudad; optional. */
  address: HomeAddress | null;
  people: number;
  needs: NeedId[];
  risks: RiskId[];
  dwelling: DwellingId;
  level: LevelId;
  features: HomeFeatureId[];
  contact: string;
  outsideContact: string;
  meetingPoint: string;
  outsideMeetingPoint: string;
}

export interface OfficialSource {
  id: string;
  name: string;
  organization: string;
  url: string;
  scope: 'national' | 'regional' | 'european';
  kind: 'advice' | 'portal' | 'data';
}

export interface SourceCheck {
  id: string;
  status: 'available' | 'unavailable';
  checkedAt: string;
  detail: string;
}

export interface Recommendation {
  title: string;
  text: string;
  sourceId: string;
}

export interface RegionalRecommendation extends Recommendation {
  regionId: string;
  organization: string;
  url: string;
  risks: RiskId[] | 'general';
  reviewedAt: string;
  reviewNote?: string;
}

/** A single step of the personalised plan. `sourceId` is required for official content; household suggestions are labelled as such. */
export interface PlanAction {
  id: string;
  phase: PhaseId;
  risk: RiskId | 'general';
  title: string;
  text: string;
  why?: string;
  sourceId?: string;
  priority: number;
}

export interface KitLine {
  id: string;
  title: string;
  detail: string;
  quantity?: string;
  group: 'Lo esencial' | 'Comunicación y documentos' | 'Cuidados' | 'Tu hogar';
  why?: string;
  sourceId?: string;
}

export type MapLayerId = 'base' | 'flood100' | 'flood500' | 'fire' | 'seismic';

export interface MapLayerInfo {
  id: MapLayerId;
  title: string;
  attribution: string;
  sourceUrl: string;
  description: string;
  available: boolean;
  date: string | null;
  error?: string;
}

export interface MapCatalog {
  layers: MapLayerInfo[];
  checkedAt: string;
}

export interface MapLocation {
  municipality: string;
  provinceCode: string;
  lat: number;
  lon: number;
}

export interface MapSnapshot {
  dataUrl: string;
  width: number;
  height: number;
  municipality: string;
  provinceCode: string;
  createdAt: string;
  layers: MapLayerInfo[];
}

/** IGN 2015 seismic hazard at a point: EMS-98 intensity and rock PGA (g) for a 475-year return period. */
export interface SeismicPointResult {
  status: 'ok' | 'unknown';
  intensity?: number;
  pga?: number;
  detail?: string;
}

export type FloodStatus = 'inside' | 'outside' | 'unknown';

export interface FloodPointResult {
  status: FloodStatus;
  zone?: string;
  river?: string;
  study?: string;
  approved?: string;
  detail?: string;
}

/** Official map layers queried at one point chosen by the user. It is never a risk verdict for a dwelling. */
export interface PointCheck {
  municipality: string;
  provinceCode: string;
  lat: number;
  lon: number;
  checkedAt: string;
  flood100: FloodPointResult;
  flood500: FloodPointResult;
  fwi?: { value: number; date: string; className: string } | null;
  fwiError?: string;
  seismic?: SeismicPointResult;
}

export interface RiskAdvice {
  id: RiskId;
  title: string;
  short: string;
  color: string;
}

export interface PreparedPlan {
  household: Household;
  createdAt: string;
  region: string;
  sources: OfficialSource[];
  checks: SourceCheck[];
  sourceError?: string;
  pointCheck?: PointCheck;
}
