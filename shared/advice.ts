import type { DwellingId, HomeFeatureId, Household, LevelId, NeedId, RiskAdvice, RiskId } from './types';

export const CONTENT_VERSION = '2026-09-27';
export const DISCLAIMER = 'Esta guía contiene recomendaciones orientativas. No es un plan oficial de emergencia ni sustituye las instrucciones de las autoridades. Un plan real de evacuación o puesta a salvo debe contrastarse con los equipos de Protección Civil de tu municipio.';
export const EMERGENCY_NOTICE = 'Si existe peligro inmediato, llama al 112. Sigue las instrucciones de las autoridades y los avisos ES-Alert. No esperes a completar esta guía.';
export const LOCATION_NOTICE = 'El municipio selecciona las fuentes autonómicas. Si indicas tu calle, la guía consulta la cartografía oficial en ese punto (SNCZI y EFFIS). No es un servicio de alertas y no determina rutas, refugios ni si debes evacuar o confinarte.';

export const riskAdvice: RiskAdvice[] = [
  { id: 'flood', title: 'Inundaciones', short: 'Lluvias intensas, DANA y crecidas', color: 'blue' },
  { id: 'wildfire', title: 'Incendios forestales', short: 'Fuego y humo cerca de ti', color: 'orange' },
  { id: 'earthquake', title: 'Terremotos', short: 'Movimientos sísmicos', color: 'purple' },
];

export const needs: { id: NeedId; title: string; description: string }[] = [
  { id: 'children', title: 'Niños y niñas', description: 'Menores a tu cargo o en el colegio' },
  { id: 'elderly', title: 'Personas mayores', description: 'Que viven contigo o solas cerca' },
  { id: 'mobility', title: 'Movilidad reducida', description: 'Silla de ruedas, andador, encamados' },
  { id: 'medication', title: 'Medicación habitual', description: 'Tratamientos que no pueden faltar' },
  { id: 'power', title: 'Equipos médicos eléctricos', description: 'Oxígeno, respirador, diálisis…' },
  { id: 'sensory', title: 'Discapacidad auditiva o visual', description: 'Avisos accesibles' },
  { id: 'pets', title: 'Animales de compañía', description: 'Transporte y necesidades básicas' },
];

export const dwellings: { id: DwellingId; title: string }[] = [
  { id: 'flat', title: 'Piso o apartamento' },
  { id: 'house', title: 'Casa o vivienda unifamiliar' },
];

export const levels: { id: LevelId; title: string; description: string }[] = [
  { id: 'basement', title: 'Sótano o semisótano', description: 'Por debajo del nivel de la calle' },
  { id: 'ground', title: 'Planta baja', description: 'A nivel de la calle' },
  { id: 'upper', title: 'Planta alta', description: 'Primera planta o superior' },
];

export const homeFeatures: { id: HomeFeatureId; title: string; description: string; suggests?: RiskId }[] = [
  { id: 'garage-below', title: 'Garaje, trastero o sótano', description: 'En el edificio o la vivienda', suggests: 'flood' },
  { id: 'near-water', title: 'Cerca de un río, barranco o rambla', description: 'Aunque suela estar seco', suggests: 'flood' },
  { id: 'near-vegetation', title: 'Junto a monte o zona forestal', description: 'Urbanización o casa rodeada de vegetación', suggests: 'wildfire' },
  { id: 'vehicle', title: 'Usamos coche a diario', description: 'Para ir a trabajar o al colegio' },
];

export const initialHousehold: Household = {
  municipality: '', municipalityCode: '', provinceCode: '', address: null, people: 2, needs: [], risks: ['flood', 'wildfire'],
  dwelling: 'flat', level: 'upper', features: [],
  contact: '', outsideContact: '', meetingPoint: '', outsideMeetingPoint: '',
};

export const MUNICIPALITY_NOT_VERIFIED = 'Elige tu municipio de la lista de sugerencias para validarlo.';

/** `requireVerified: false` accepts guides saved before municipality validation existed. */
export function validateHousehold(h: Household, { requireVerified = true } = {}): string | undefined {
  if (!h.municipality.trim() || h.municipality.trim().length > 100) return 'Escribe un municipio de entre 1 y 100 caracteres.';
  if (!/^\d{2}$/.test(h.provinceCode) || Number(h.provinceCode) < 1 || Number(h.provinceCode) > 52) return 'Selecciona una provincia o ciudad autónoma.';
  if (typeof h.municipalityCode !== 'string' || (h.municipalityCode && !/^\d{5}$/.test(h.municipalityCode))) return MUNICIPALITY_NOT_VERIFIED;
  if (requireVerified && !h.municipalityCode) return MUNICIPALITY_NOT_VERIFIED;
  if (h.municipalityCode && h.municipalityCode.slice(0, 2) !== h.provinceCode) return 'El municipio no pertenece a la provincia seleccionada.';
  if (h.address !== null && (typeof h.address !== 'object' || !h.municipalityCode || typeof h.address.label !== 'string' || !h.address.label || h.address.label.length > 160
    || !['street', 'portal'].includes(h.address.kind) || typeof h.address.lat !== 'number' || typeof h.address.lon !== 'number'
    || !(h.address.lat >= 27 && h.address.lat <= 44 && h.address.lon >= -19 && h.address.lon <= 5)
    || (h.address.postalCode !== undefined && (typeof h.address.postalCode !== 'string' || !/^\d{5}$/.test(h.address.postalCode))))) return 'Revisa la dirección: elígela de la lista de sugerencias.';
  if (!Number.isInteger(h.people) || h.people < 1 || h.people > 30) return 'Indica entre 1 y 30 personas.';
  if (!h.risks.length || h.risks.some(id => !riskAdvice.some(r => r.id === id)) || new Set(h.risks).size !== h.risks.length) return 'Selecciona al menos una emergencia.';
  if (h.needs.some(id => !needs.some(n => n.id === id))) return 'Revisa las necesidades del hogar.';
  if (!dwellings.some(d => d.id === h.dwelling) || !levels.some(l => l.id === h.level) || h.features.some(id => !homeFeatures.some(f => f.id === id))) return 'Revisa los datos de la vivienda.';
  if ([h.contact, h.outsideContact, h.meetingPoint, h.outsideMeetingPoint].some(v => typeof v !== 'string' || v.length > 180)) return 'Los campos opcionales no pueden superar los 180 caracteres.';
}
