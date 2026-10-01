import type { SeismicPointResult } from './types';

/** EMS-98 degree names as published by the IGN (Escala Macrosísmica Europea) and colours of the IGN WMS legend. */
export const EMS_DEGREES: Record<number, { roman: string; name: string; color: string }> = {
  4: { roman: 'IV', name: 'Ampliamente observado', color: '#81FEF9' },
  5: { roman: 'V', name: 'Fuerte', color: '#8CFE94' },
  6: { roman: 'VI', name: 'Levemente dañino', color: '#FFFB00' },
  7: { roman: 'VII', name: 'Dañino', color: '#FCC407' },
  8: { roman: 'VIII', name: 'Gravemente dañino', color: '#F47A0E' },
};

/** From degree VI the EMS-98 scale describes damage to buildings. */
export const EMS_DAMAGE = 6;

export const SEISMIC_SOURCE_URL = 'https://www.ign.es/web/mapas-sismicidad';
export const EMS_SCALE_URL = 'https://www.ign.es/web/ign/portal/sis-escala-intensidad';

export function emsLabel(intensity: number) {
  const degree = EMS_DEGREES[intensity];
  return degree ? `${degree.roman} · ${degree.name}` : `Grado ${intensity}`;
}

export function seismicSummary(result?: SeismicPointResult) {
  if (!result || result.status !== 'ok' || result.intensity === undefined) return 'Sin datos del IGN';
  const pga = result.pga !== undefined ? ` · ${result.pga.toFixed(2).replace('.', ',')} g` : '';
  return `Intensidad ${emsLabel(result.intensity)}${pga}`;
}
