import { getRegion, regions, type RegionId } from './regions';
import type { OfficialSource, RiskId } from './types';
import { getRegionalRecommendations } from './regional-advice';

const national = (id: RiskId, name: string, url: string): OfficialSource => ({
  id: `national-${id}`, name, url, organization: 'Protección Civil y Emergencias · Ministerio del Interior', scope: 'national', kind: 'advice',
});

export const nationalSources: Record<RiskId, OfficialSource> = {
  flood: national('flood', 'Guía de autoprotección ante inundaciones', 'https://www.proteccioncivil.es/documents/20121/1069714/08-Inundaciones_accesible.pdf'),
  wildfire: national('wildfire', 'Guía de autoprotección ante incendios forestales', 'https://www.proteccioncivil.es/documents/20121/1069714/02-Incendios_Forestales_accesible.pdf'),
  earthquake: national('earthquake', 'Guía de autoprotección ante el riesgo sísmico', 'https://www.proteccioncivil.es/documents/20121/1069714/01-Riesgos_Sismico_accesible.pdf'),
};

/** Sources cited by the personalisation engine. Every quoted idea was checked against the original document. */
export const generalSources: Record<string, OfficialSource> = {
  'es-alert': { id: 'es-alert', name: 'ES-Alert: sistema de avisos a la población', organization: 'Protección Civil y Emergencias · Ministerio del Interior', url: 'https://www.proteccioncivil.es/coordinacion/redes/ran/public-warning-system', scope: 'national', kind: 'advice' },
  'eu-preparedness': { id: 'eu-preparedness', name: 'Estrategia de la Unión de Preparación (72 horas de autonomía)', organization: 'Comisión Europea · Protección Civil y Ayuda Humanitaria', url: 'https://civil-protection-humanitarian-aid.ec.europa.eu/news-stories/news/eu-preparedness-union-strategy-prevent-and-react-emerging-threats-and-crises-2025-03-26_en', scope: 'european', kind: 'advice' },
  'gencat-prepared': { id: 'gencat-prepared', name: 'Preparat per a les emergències (guía familiar, 2025)', organization: 'Generalitat de Catalunya · Protecció Civil', url: 'https://dsp.interior.gencat.cat/bitstream/20.500.14007/6517/1/Preparat-per-a-les-emergencies.pdf', scope: 'regional', kind: 'advice' },
  'sanidad-electro': { id: 'sanidad-electro', name: 'Personas electrodependientes: certificado y registro ante apagones', organization: 'Ministerio de Sanidad', url: 'https://www.sanidad.gob.es/gabinete/notasPrensa.do?id=6970', scope: 'national', kind: 'advice' },
  'sanidad-alone': { id: 'sanidad-alone', name: 'Plan Nacional de actuaciones preventivas ante el exceso de temperaturas 2024', organization: 'Ministerio de Sanidad', url: 'https://www.sanidad.gob.es/areas/sanidadAmbiental/riesgosAmbientales/calorExtremo/publicaciones/docs/planNacionalExcesoTemperaturas_2024.pdf', scope: 'national', kind: 'advice' },
  snczi: { id: 'snczi', name: 'Sistema Nacional de Cartografía de Zonas Inundables (SNCZI)', organization: 'Ministerio para la Transición Ecológica y el Reto Demográfico', url: 'https://www.miteco.gob.es/es/agua/temas/gestion-de-los-riesgos-de-inundacion/snczi.html', scope: 'national', kind: 'data' },
  effis: { id: 'effis', name: 'EFFIS · Índice meteorológico de peligro de incendio (FWI)', organization: 'Copernicus EMS · Comisión Europea', url: 'https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/fire-danger-forecast', scope: 'european', kind: 'data' },
  'ign-seismic': { id: 'ign-seismic', name: 'Mapa de peligrosidad sísmica de España 2015 (intensidad EMS-98 y aceleración, periodo de retorno de 475 años)', organization: 'Instituto Geográfico Nacional', url: 'https://www.ign.es/web/mapas-sismicidad', scope: 'national', kind: 'data' },
};

const regional = (id: RegionId, name: string, organization: string, url: string): OfficialSource => ({
  id: `regional-${id}`, name, organization, url, scope: 'regional', kind: 'portal',
});

export const regionalSources: Record<RegionId, OfficialSource> = {
  andalucia: regional('andalucia', 'Qué hacer ante una emergencia', 'Junta de Andalucía · Emergencias 112', 'https://www.juntadeandalucia.es/temas/seguridad/emergencias/que-hacer.html'),
  aragon: regional('aragon', 'Consejos de autoprotección', 'Gobierno de Aragón · Protección Civil', 'https://www.aragon.es/-/consejos-de-autoproteccion-ante-emergencias'),
  asturias: regional('asturias', 'Consejos del 112 Asturias', 'Principado de Asturias · SEPA', 'https://www.112asturias.es/consejos'),
  baleares: regional('baleares', 'Illes Balears Segures', 'Govern de les Illes Balears · 112', 'https://apps.caib.es/sites/112/es/que_es_illes_balears_segures-7001/'),
  canarias: regional('canarias', 'Consejos ante emergencias', 'Gobierno de Canarias · Dirección General de Emergencias', 'https://www.gobiernodecanarias.org/emergencias/consejos/consejos.html'),
  cantabria: regional('cantabria', 'Consejos de autoprotección', 'Gobierno de Cantabria · 112', 'https://112.cantabria.es/consejos-de-autoproteccion'),
  'castilla-leon': regional('castilla-leon', 'Consejos de autoprotección', 'Junta de Castilla y León · Emergencias 112', 'https://112.jcyl.es/web/es/consejos-recomendaciones/consejos-autoproteccion.html'),
  'castilla-mancha': regional('castilla-mancha', 'Consejos de autoprotección', 'Junta de Castilla-La Mancha · 112', 'https://112.castillalamancha.es/proteccion-civil/autoproteccion/consejos-autoproteccion'),
  cataluna: regional('cataluna', 'Davant d’una emergència, prepara’t', 'Generalitat de Catalunya · Protecció Civil', 'https://dsp.interior.gencat.cat/handle/20.500.14007/3220'),
  valenciana: regional('valenciana', 'Autoprotección en la Comunitat Valenciana', 'Generalitat Valenciana · Emergencias 112CV', 'https://www.112cv.gva.es/es/autoproteccion'),
  extremadura: regional('extremadura', 'Emergencias y protección civil', 'Junta de Extremadura · 112', 'https://www.juntaex.es/temas/administracion-publica/emergencias-y-proteccion-civil'),
  galicia: regional('galicia', 'Medidas de autoprotección', 'Xunta de Galicia · AXEGA 112', 'https://www.axega112.gal/gl/content/medidas-de-autoproteccion'),
  madrid: regional('madrid', 'Biblioteca de prevención de emergencias', 'Comunidad de Madrid · ASEM 112', 'https://www.comunidad.madrid/seguridad-emergencias-asem-112/biblioteca-digital-prevencion-emergencias'),
  murcia: regional('murcia', 'Portal del 112 Región de Murcia', 'Región de Murcia · Emergencias 112', 'https://www.112rmurcia.es/'),
  navarra: regional('navarra', 'Seguridad y emergencias', 'Gobierno de Navarra · Protección Civil', 'https://www.navarra.es/es/seguridad-y-emergencias'),
  'pais-vasco': regional('pais-vasco', 'Recomendaciones de meteorología adversa', 'Gobierno Vasco · SOS Deiak 112', 'https://www.euskadi.eus/recomendaciones-meteorologia-adversa/web01-a2larri/es/'),
  rioja: regional('rioja', 'Consejos de autoprotección', 'Gobierno de La Rioja · SOS Rioja 112', 'https://www.larioja.org/emergencias-112/es/autoproteccion/consejos'),
  ceuta: regional('ceuta', 'Recomendaciones de Protección Civil', 'Ciudad Autónoma de Ceuta · ARCE', 'https://www.ceuta.es/arce/recomendaciones.html'),
  melilla: regional('melilla', 'Contacto de Protección Civil', 'Ciudad Autónoma de Melilla · Protección Civil', 'https://www.melilla.es/melillaportal/contenedor.jsp?seccion=s_floc_d4_v1.jsp&contenido=14539&nivel=1400&tipo=1&codMenu=114&codMenuPN=602&codMenuSN=604'),
};

export function getSources(location: string, risks: RiskId[], extra: string[] = []): OfficialSource[] {
  const region = getRegion(location) ?? regions.find(r => r.id === location);
  if (!region) throw new Error('No existe una comunidad para la ubicación seleccionada.');
  const contentSources: OfficialSource[] = getRegionalRecommendations(region.id, risks).map(item => ({
    id: item.sourceId, name: item.title, organization: item.organization, url: item.url, scope: 'regional', kind: 'advice',
  }));
  const general = extra.map(id => generalSources[id]).filter((source): source is OfficialSource => !!source);
  const sources = [...new Set(risks)].map(risk => nationalSources[risk]).concat(general, regionalSources[region.id], contentSources);
  return [...new Map(sources.map(source => [source.id, source])).values()];
}
