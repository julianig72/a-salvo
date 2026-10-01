import { homeFeatures, levels, needs } from './advice';
import { EMS_DAMAGE, EMS_DEGREES, emsLabel } from './seismic';
import type { Household, KitLine, PhaseId, PlanAction, PointCheck, RiskId } from './types';

/**
 * Ids of the sources cited by the engine (defined in `sources.ts`). Each sourced text paraphrases
 * an idea checked in the original document; texts without `sourceId` are shown as household suggestions.
 */
export const SRC = {
  flood: 'national-flood',
  wildfire: 'national-wildfire',
  earthquake: 'national-earthquake',
  esAlert: 'es-alert',
  kit: 'eu-preparedness',
  family: 'gencat-prepared',
  electro: 'sanidad-electro',
  alone: 'sanidad-alone',
  snczi: 'snczi',
  effis: 'effis',
  ign: 'ign-seismic',
} as const;

export const phaseLabels: Record<PhaseId, { title: string; short: string; hint: string }> = {
  prepare: { title: 'Prepárate ahora', short: 'Antes', hint: 'Con calma, hoy mismo' },
  warning: { title: 'Cuando haya aviso', short: 'Aviso', hint: 'Aviso naranja o rojo, o ES-Alert' },
  during: { title: 'Durante la emergencia', short: 'Durante', hint: 'Prioriza tu vida, no tus bienes' },
  after: { title: 'Después', short: 'Después', hint: 'Cuando las autoridades lo indiquen' },
};

export interface PersonalPlan {
  profile: string[];
  actions: PlanAction[];
  priorities: PlanAction[];
  kit: KitLine[];
}

type Rule = PlanAction & { when?: boolean };

const phaseOrder: PhaseId[] = ['prepare', 'warning', 'during', 'after'];
const has = (list: readonly string[], item: string) => list.includes(item);
export const WATER_LITRES_PER_DAY = 3;
export const KIT_DAYS = 3;
export const FWI_HIGH = 21.3;

export function pointFlags(point?: PointCheck) {
  const flood100 = point?.flood100.status === 'inside';
  const flood500 = flood100 || point?.flood500.status === 'inside';
  const fwiHigh = !!point?.fwi && point.fwi.value >= FWI_HIGH;
  const intensity = point?.seismic?.status === 'ok' ? point.seismic.intensity : undefined;
  const seismicDamage = intensity !== undefined && intensity >= EMS_DAMAGE;
  return { flood100, flood500, fwiHigh, intensity, seismicDamage };
}

/** Scenarios the official layers point to at the user's address. */
export function mapSuggestedRisks(point?: PointCheck | null): RiskId[] {
  const { flood500, fwiHigh, seismicDamage } = pointFlags(point ?? undefined);
  return [...(flood500 ? ['flood' as const] : []), ...(fwiHigh ? ['wildfire' as const] : []), ...(seismicDamage ? ['earthquake' as const] : [])];
}

function floodRules(h: Household, point?: PointCheck): Rule[] {
  const low = h.level === 'basement' || h.level === 'ground';
  const garage = has(h.features, 'garage-below');
  const water = has(h.features, 'near-water');
  const car = has(h.features, 'vehicle');
  const { flood100, flood500 } = pointFlags(point);
  const boost = flood100 ? 25 : flood500 ? 15 : 0;
  return [
    { id: 'flood-zone-t100', phase: 'prepare', risk: 'flood', when: flood100, priority: 130, sourceId: SRC.snczi,
      title: 'Tu vivienda está en una zona inundable cartografiada (T100)',
      text: 'El SNCZI sitúa el punto que marcaste dentro de la zona inundable con un periodo de retorno de 100 años: un 1 % de probabilidad cada año, alrededor de un 26 % en 30 años. Consulta la ficha oficial del tramo y pregunta a tu ayuntamiento por el plan de actuación municipal ante inundaciones.',
      why: 'Resultado de la consulta a la cartografía oficial en tu punto.' },
    { id: 'flood-zone-t500', phase: 'prepare', risk: 'flood', when: flood500 && !flood100, priority: 110, sourceId: SRC.snczi,
      title: 'Tu vivienda está en la zona inundable de baja probabilidad (T500)',
      text: 'El SNCZI sitúa tu punto en la zona que se inundaría en una avenida extraordinaria, con un 0,2 % de probabilidad cada año. Es poco frecuente, pero no imposible: prepárate como si pudiera ocurrir.',
      why: 'Resultado de la consulta a la cartografía oficial en tu punto.' },
    { id: 'flood-check-zone', phase: 'prepare', risk: 'flood', when: !point, priority: 60, sourceId: SRC.snczi,
      title: 'Comprueba si tu calle está en zona inundable',
      text: 'Marca tu vivienda en el mapa de esta aplicación o consulta el visor del SNCZI. La cartografía solo cubre los ríos estudiados: barrancos, ramblas y lluvia intensa local pueden inundar zonas sin color.',
      why: 'Todavía no has marcado tu vivienda en el mapa.' },
    { id: 'flood-upper-refuge', phase: 'prepare', risk: 'flood', when: low, priority: 90 + boost, sourceId: SRC.flood,
      title: 'Decide ya a qué planta alta subiríais',
      text: 'Si se inunda la vivienda, hay que salir de sótanos y plantas bajas lo antes posible y dirigirse a las zonas más elevadas. Habla hoy con un vecino de una planta alta o identifica la zona más alta de tu casa, y cómo llegaría cada persona del hogar.',
      why: h.level === 'basement' ? 'Vives por debajo del nivel de la calle: el agua entra primero y más rápido.' : 'Vives en planta baja, a nivel de la calle.' },
    { id: 'flood-no-garage', phase: 'warning', risk: 'flood', when: garage, priority: 95 + boost, sourceId: SRC.flood,
      title: 'No bajes al garaje, al sótano ni al trastero',
      text: 'Si hay aviso o empieza a entrar agua, sal de sótanos y plantas bajas: no bajes a por el coche ni a salvar objetos. El nivel puede subir muy deprisa y bloquear puertas y rampas.',
      why: 'Tu edificio o vivienda tiene garaje, trastero o sótano.' },
    { id: 'flood-valuables-high', phase: 'prepare', risk: 'flood', priority: 45 + boost, sourceId: SRC.flood,
      title: 'Guarda documentos y productos peligrosos en alto',
      text: 'Coloca los documentos importantes y los productos peligrosos en la parte alta de la casa, mejor en bolsas impermeables.',
      why: low ? 'En planta baja o sótano el agua alcanza antes los muebles bajos.' : undefined },
    { id: 'flood-drains', phase: 'prepare', risk: 'flood', when: h.dwelling === 'house', priority: 50 + boost, sourceId: SRC.flood,
      title: 'Revisa tejado, canalones y desagües',
      text: 'Comprueba el estado del tejado, la canalización y los desagües cercanos para que el agua drene bien, sobre todo antes de la temporada de lluvias.',
      why: 'Vives en una casa: el mantenimiento depende de ti.' },
    { id: 'flood-car-plan', phase: 'warning', risk: 'flood', when: car, priority: 80 + boost, sourceId: SRC.flood,
      title: 'Con aviso, no cruces tramos inundados en coche',
      text: 'Evita los desplazamientos que no sean imprescindibles. No atravieses tramos inundados ni a pie ni con el vehículo: la fuerza del agua puede arrastrarte a ti y a tu coche. No aparques en cauces secos ni en la orilla de los ríos.',
      why: 'Usáis el coche a diario.' },
    { id: 'flood-away-riverbeds', phase: 'during', risk: 'flood', priority: water ? 88 + boost : 55, sourceId: SRC.flood,
      title: 'Aléjate de ríos, barrancos y zonas bajas',
      text: 'Dirígete a las zonas más elevadas. No te acerques a mirar, aunque el cauce suela estar seco.',
      why: water ? 'Vives cerca de un río, barranco o rambla.' : undefined },
    { id: 'flood-power-off', phase: 'during', risk: 'flood', priority: 50 + boost, sourceId: SRC.flood,
      title: 'Si se inunda la vivienda, corta la electricidad',
      text: 'Desconecta la energía eléctrica y utiliza una linterna. Hazlo solo si puedes llegar al cuadro sin pisar agua.' },
    { id: 'flood-no-crossing', phase: 'during', risk: 'flood', priority: 70, sourceId: SRC.flood,
      title: 'No cruces zonas inundadas, ni a pie ni en coche',
      text: 'Aunque parezca poca profundidad, la fuerza del agua puede arrastrarte. Busca un lugar elevado y espera instrucciones.' },
    { id: 'flood-after', phase: 'after', risk: 'flood', priority: 40,
      title: 'Vuelve solo cuando lo autoricen',
      text: 'No consumas alimentos ni agua que hayan tocado la riada, revisa la instalación antes de conectar la luz y haz fotos de los daños para el seguro.' },
  ];
}

function wildfireRules(h: Household, point?: PointCheck): Rule[] {
  const forest = has(h.features, 'near-vegetation');
  const house = h.dwelling === 'house';
  const car = has(h.features, 'vehicle');
  const { fwiHigh } = pointFlags(point);
  const boost = forest ? 20 : 0;
  const exterior = forest ? 'Tu vivienda está junto a monte o zona forestal.' : 'Vives en una casa con exterior propio.';
  return [
    { id: 'fire-fwi-high', phase: 'warning', risk: 'wildfire', when: fwiHigh, priority: 92, sourceId: SRC.effis,
      title: `El peligro meteorológico de incendio era ${point?.fwi?.className.toLowerCase()} al consultar tu punto`,
      text: `El índice FWI (${point?.fwi?.value.toFixed(1)}, ${point?.fwi?.date}) indica condiciones meteorológicas que favorecen la propagación del fuego. No es una probabilidad de incendio, pero es momento de extremar la precaución y revisar tu plan.`,
      why: 'Resultado de la consulta al servicio europeo EFFIS en tu punto.' },
    { id: 'fire-defense-strip', phase: 'prepare', risk: 'wildfire', when: forest || house, priority: 70 + boost, sourceId: SRC.wildfire,
      title: 'Mantén el tejado y el entorno de la casa sin combustible',
      text: 'Mantén limpios los tejados y canalones de hojas, ramas y otros materiales combustibles, y no acumules leña ni restos vegetales junto a la vivienda. Tu comunidad autónoma o tu ayuntamiento pueden exigir franjas de protección con distancias concretas: pregúntales.',
      why: exterior },
    { id: 'fire-urbanization-plan', phase: 'prepare', risk: 'wildfire', when: forest, priority: 85, sourceId: SRC.wildfire,
      title: 'Pregunta por el plan de autoprotección de tu urbanización',
      text: 'Las urbanizaciones y núcleos de población en zona forestal deben contar con un plan de autoprotección. Pregunta a tu comunidad de vecinos o al ayuntamiento si existe, qué prevé y cómo se avisa a los vecinos.',
      why: 'Vives en la interfaz urbano-forestal, donde los incendios alcanzan viviendas.' },
    { id: 'fire-no-burning', phase: 'prepare', risk: 'wildfire', priority: 35,
      title: 'No uses fuego en el monte ni cerca de él',
      text: 'Respeta las prohibiciones de quemas y barbacoas. Si ves humo o fuego, llama al 112 indicando el lugar con la mayor precisión posible.' },
    { id: 'fire-wet-roof', phase: 'warning', risk: 'wildfire', when: forest || house, priority: 72, sourceId: SRC.wildfire,
      title: 'Si el fuego se acerca y tienes mangueras, moja el tejado',
      text: 'Usa las mangueras para mojar el tejado y los alrededores de la vivienda, siempre que puedas hacerlo sin ponerte en peligro y sin desobedecer una orden de evacuación.',
      why: exterior },
    { id: 'fire-follow-orders', phase: 'warning', risk: 'wildfire', priority: 65 + boost,
      title: 'Confinarse o evacuar lo deciden las autoridades',
      text: 'Sigue ES-Alert, el 112 y los canales oficiales. Si te piden confinarte, hazlo; si te piden evacuar, sal por las vías que te indiquen. Ten el kit y a las personas que necesitan ayuda preparadas desde el primer aviso.',
      why: car ? 'Si hay que salir en coche, la decisión y el recorrido los marcan las autoridades.' : undefined },
    { id: 'fire-confine', phase: 'during', risk: 'wildfire', priority: 60 + boost, sourceId: SRC.wildfire,
      title: 'Si te confinas: cierra y sella',
      text: 'Entra en casa y cierra todas las puertas, ventanas y persianas. Tapona las rendijas al exterior con paños mojados y desconecta los suministros.' },
    { id: 'fire-smoke', phase: 'during', risk: 'wildfire', priority: 50,
      title: 'Protégete del humo',
      text: 'Si te alcanza el humo, cúbrete la boca y la nariz con un paño húmedo y mantente lo más cerca posible del suelo. No te acerques a mirar el incendio.' },
    { id: 'fire-after', phase: 'after', risk: 'wildfire', priority: 35,
      title: 'Regresa solo cuando esté autorizado',
      text: 'Revisa la vivienda por si quedan brasas y ten cuidado con árboles y estructuras debilitadas.' },
  ];
}

function earthquakeRules(h: Household, point?: PointCheck): Rule[] {
  const upper = h.level === 'upper' && h.dwelling === 'flat';
  const { intensity, seismicDamage } = pointFlags(point);
  const boost = seismicDamage ? 10 + (intensity! - EMS_DAMAGE) * 10 : 0;
  const pga = point?.seismic?.pga !== undefined ? ` La aceleración de referencia en roca es de ${point.seismic.pga.toFixed(2).replace('.', ',')} g.` : '';
  return [
    { id: 'quake-zone', phase: 'prepare', risk: 'earthquake', when: seismicDamage, priority: 70 + (seismicDamage ? (intensity! - EMS_DAMAGE) * 15 : 0), sourceId: SRC.ign,
      title: `Tu zona tiene una peligrosidad sísmica de grado ${seismicDamage ? emsLabel(intensity!).toLowerCase() : ''}`,
      text: `El mapa de peligrosidad sísmica del IGN asigna a tu dirección una intensidad ${seismicDamage ? emsLabel(intensity!) : ''} en la escala EMS-98 para un periodo de retorno de 475 años (un 10 % de probabilidad de superarse en 50 años).${pga} No es una predicción de terremotos ni evalúa tu edificio: pregunta a tu ayuntamiento o a un técnico si la vivienda cumple la norma sismorresistente.`,
      why: 'Resultado de la consulta al Instituto Geográfico Nacional en tu dirección.' },
    { id: 'quake-fasten', phase: 'prepare', risk: 'earthquake', priority: 60 + boost, sourceId: SRC.earthquake,
      title: 'Fija muebles altos y objetos pesados',
      text: 'Revisa los anclajes a la pared de estanterías y armarios, y coloca los objetos pesados en las baldas bajas, lejos de camas y sofás.',
      why: has(h.needs, 'children') ? 'Hay niños en casa: revisa especialmente sus habitaciones.' : seismicDamage ? 'En tu zona la intensidad de referencia puede causar daños.' : undefined },
    { id: 'quake-shutoff', phase: 'prepare', risk: 'earthquake', priority: 55 + boost, sourceId: SRC.family,
      title: 'Decidid quién cierra el agua, la luz y el gas',
      text: 'Localiza las llaves de paso y el cuadro eléctrico, y acordad quién se encarga de cerrarlos. Los adultos del hogar deben saber hacerlo.' },
    { id: 'quake-cover', phase: 'during', risk: 'earthquake', priority: 70,
      title: 'Agáchate, cúbrete y agárrate',
      text: 'Si estás dentro, quédate dentro: protégete bajo una mesa firme o junto a un muro de carga, lejos de ventanas. Si estás en la calle, aléjate de fachadas, cables y postes.' },
    { id: 'quake-no-lift', phase: 'after', risk: 'earthquake', priority: upper ? 60 : 45,
      title: 'Sal con calma y sin usar el ascensor',
      text: 'Espera réplicas. No enciendas fuego ni interruptores si huele a gas y usa el teléfono solo para emergencias.',
      why: upper ? 'Vives en una planta alta: la salida será por las escaleras.' : undefined },
  ];
}

function generalRules(h: Household): Rule[] {
  const n = (id: string) => has(h.needs, id);
  return [
    { id: 'general-es-alert', phase: 'prepare', risk: 'general', priority: 75, sourceId: SRC.esAlert,
      title: 'Comprueba que tu móvil puede recibir ES-Alert',
      text: 'ES-Alert envía los avisos por difusión celular a los móviles que están en la zona afectada. Funciona en Android 11 e iOS 15.6 o posteriores: actualiza los teléfonos del hogar y comprueba en los ajustes que las alertas de emergencia están activadas.' },
    { id: 'general-kit', phase: 'prepare', risk: 'general', priority: 68, sourceId: SRC.kit,
      title: `Prepara el kit para ${h.people} ${h.people === 1 ? 'persona' : 'personas'} y 72 horas`,
      text: 'La Unión Europea recomienda disponer de suministros esenciales para un mínimo de 72 horas. La lista de esta guía ya calcula el agua y la comida para tu hogar.',
      why: `Sois ${h.people}: ${h.people * KIT_DAYS * WATER_LITRES_PER_DAY} litros de agua (3 litros por persona y día).` },
    { id: 'general-outside-contact', phase: 'prepare', risk: 'general', priority: h.outsideContact ? 20 : 58, sourceId: SRC.family,
      title: h.outsideContact ? 'Comparte vuestro contacto fuera de la zona' : 'Elige un contacto que viva fuera de tu zona',
      text: 'Escoged a una persona de confianza que viva fuera del municipio y que sirva de punto de referencia si las comunicaciones locales se colapsan. Apunta los teléfonos también en papel.',
      why: h.outsideContact ? `Ya has indicado: ${h.outsideContact}.` : 'Aún no has indicado ningún contacto fuera de tu zona.' },
    { id: 'general-meeting-point', phase: 'prepare', risk: 'general', priority: h.meetingPoint ? 18 : 52, sourceId: SRC.family,
      title: h.meetingPoint ? 'Recorre vuestro punto de encuentro' : 'Acordad un punto de encuentro',
      text: 'Uno cerca de casa y otro fuera del barrio o del pueblo, por si no podéis volver a casa. Evita sótanos, cauces y zonas bajas si hay riesgo de inundación, y zonas con vegetación si hay riesgo de incendio. Contrástalos con Protección Civil.',
      why: h.meetingPoint ? `Has propuesto: ${h.meetingPoint}.` : 'Aún no habéis acordado dónde reuniros.' },
    { id: 'general-follow-official', phase: 'warning', risk: 'general', priority: 62,
      title: 'Infórmate y actúa solo con fuentes oficiales',
      text: 'Sigue ES-Alert, el 112 de tu comunidad, AEMET y los medios. Carga el móvil y la batería externa, ten el kit a mano y evita los desplazamientos innecesarios.' },
    { id: 'general-call-112', phase: 'during', risk: 'general', priority: 58,
      title: 'Llama al 112 solo si hay peligro inmediato',
      text: 'Las líneas se saturan. Para informarte usa canales oficiales; para tranquilizar a tu familia, un mensaje corto al contacto de fuera.' },
    { id: 'need-children-school', phase: 'prepare', risk: 'general', when: n('children'), priority: 64,
      title: 'Conoce el plan del colegio o la escuela infantil',
      text: 'Pregunta qué hace el centro ante un aviso y quién puede recoger a los menores. Si el centro los mantiene protegidos, sigue sus indicaciones antes de ir a buscarlos.',
      why: 'Hay niños o niñas en tu hogar.' },
    { id: 'need-elderly-check', phase: 'prepare', risk: 'general', when: n('elderly'), priority: 66, sourceId: SRC.alone,
      title: 'Acordad quién ayudará a las personas mayores',
      text: 'Vivir solo aumenta la vulnerabilidad. Implica a la familia y a los vecinos para que puedan comunicar una emergencia, y decide quién avisará y acompañará a cada persona mayor si hay que ponerse a salvo.',
      why: 'Hay personas mayores en tu hogar o a tu cargo.' },
    { id: 'need-mobility-plan', phase: 'prepare', risk: 'general', when: n('mobility'), priority: 82, sourceId: SRC.family,
      title: 'Planifica cómo salir sin ascensor',
      text: 'Asegúrate de que el recorrido es accesible, de que tiene a mano sus ayudas técnicas y de que hay un transporte adaptado organizado si hace falta. Decide quién ayudará y pregunta a los servicios sociales municipales si pueden tenerlo en cuenta.',
      why: 'Hay una persona con movilidad reducida: necesita más tiempo y ayuda para ponerse a salvo.' },
    { id: 'need-medication', phase: 'prepare', risk: 'general', when: n('medication'), priority: 72,
      title: 'Ten una reserva de medicación y los informes médicos',
      text: 'Guarda medicación para varios días y una copia de recetas e informes en el kit. Revisa las caducidades cada pocos meses.',
      why: 'Alguien del hogar sigue un tratamiento que no puede interrumpirse.' },
    { id: 'need-power-backup', phase: 'prepare', risk: 'general', when: n('power'), priority: 94, sourceId: SRC.electro,
      title: 'Prepara la autonomía de los equipos médicos',
      text: 'El Ministerio de Sanidad impulsa un certificado y un registro de personas electrodependientes para mejorar la respuesta ante apagones. Pregunta en tu centro sanitario cómo acceder, anota cuántas horas de batería tiene cada equipo y qué hacer si se corta la luz.',
      why: 'Hay equipos médicos que dependen de la electricidad; los cortes son frecuentes en emergencias.' },
    { id: 'need-sensory-alerts', phase: 'prepare', risk: 'general', when: n('sensory'), priority: 70, sourceId: SRC.family,
      title: 'Asegura que los avisos llegan a todos',
      text: 'Que tenga siempre a mano sus dispositivos y materiales de apoyo (gafas, audífonos, pilas de repuesto). Activa alertas con vibración y luz y acordad señales sencillas con convivientes y vecinos.',
      why: 'Hay personas con discapacidad auditiva o visual en tu hogar.' },
    { id: 'need-pets', phase: 'prepare', risk: 'general', when: n('pets'), priority: 48, sourceId: SRC.family,
      title: 'Prepara a tus animales',
      text: 'Ten preparados su identificación, la cartilla veterinaria, el transportín o la correa, comida y agua. Si hay que ponerse a salvo, llévalos contigo si es posible, pero no arriesgues tu vida por ellos.',
      why: 'Tenéis animales de compañía.' },
    { id: 'general-after-neighbours', phase: 'after', risk: 'general', priority: 40,
      title: 'Comprueba cómo están tus vecinos',
      text: 'Especialmente las personas mayores o que viven solas. Llama al 112 si alguien necesita ayuda urgente.' },
  ];
}

const riskRules: Record<RiskId, (h: Household, point?: PointCheck) => Rule[]> = {
  flood: floodRules, wildfire: wildfireRules, earthquake: earthquakeRules,
};

const strip = <T extends { when?: boolean }>(items: T[]) => items.filter(item => item.when !== false).map(({ when: _when, ...item }) => item);

export function buildActions(h: Household, point?: PointCheck): PlanAction[] {
  const rules = [...generalRules(h), ...[...new Set(h.risks)].flatMap(risk => riskRules[risk](h, point))];
  return strip(rules).sort((a, b) => phaseOrder.indexOf(a.phase) - phaseOrder.indexOf(b.phase) || b.priority - a.priority);
}

export function buildKit(h: Household): KitLine[] {
  const people = Math.max(1, h.people);
  const n = (id: string) => has(h.needs, id);
  const lines: (KitLine & { when?: boolean })[] = [
    { id: 'water', group: 'Lo esencial', title: 'Agua potable', detail: 'Botellas cerradas. Se recomiendan 3 litros por persona y día; como mínimo, 1,5 litros solo para beber.', quantity: `${people * KIT_DAYS * WATER_LITRES_PER_DAY} litros`, sourceId: SRC.family,
      why: `${people} ${people === 1 ? 'persona' : 'personas'} × ${KIT_DAYS} días × ${WATER_LITRES_PER_DAY} litros.` },
    { id: 'food', group: 'Lo esencial', title: 'Comida no perecedera', detail: 'Latas con abrefácil, frutos secos, galletas… que no necesiten cocinarse.', quantity: `${people * KIT_DAYS * 3} raciones`, sourceId: SRC.kit, why: `72 horas de autonomía: 3 comidas al día durante ${KIT_DAYS} días.` },
    { id: 'light', group: 'Lo esencial', title: 'Linterna y pilas de repuesto', detail: 'Mejor frontal o de dinamo. Evita las velas.', quantity: people > 3 ? '2 linternas' : '1 linterna' },
    { id: 'radio', group: 'Lo esencial', title: 'Radio a pilas o de dinamo', detail: 'Para recibir información si fallan el móvil y la luz.' },
    { id: 'first-aid', group: 'Lo esencial', title: 'Botiquín básico', detail: 'Tiritas, gasas, antiséptico, analgésicos y tijeras.' },
    { id: 'warm', group: 'Lo esencial', title: 'Ropa de abrigo y manta', detail: 'Una muda y una manta por persona, mejor en bolsa impermeable.', quantity: `${people} ${people === 1 ? 'juego' : 'juegos'}` },
    { id: 'documents', group: 'Comunicación y documentos', title: 'Copia de documentos', detail: 'DNI, tarjeta sanitaria, seguros y escrituras, en bolsa estanca o en la nube.' },
    { id: 'phones-paper', group: 'Comunicación y documentos', title: 'Teléfonos importantes en papel', detail: h.outsideContact ? `Incluye a ${h.outsideContact}, vuestro contacto fuera de la zona.` : 'Incluye un contacto que viva fuera de tu zona.' },
    { id: 'power-bank', group: 'Comunicación y documentos', title: 'Batería externa y cargadores', detail: 'Cargada. Revísala cada pocos meses.' },
    { id: 'cash', group: 'Comunicación y documentos', title: 'Dinero en efectivo', detail: 'Billetes pequeños por si no funcionan los datáfonos ni los cajeros.' },
    { id: 'medicines', group: 'Cuidados', when: n('medication') || n('elderly'), title: 'Medicación y recetas', detail: 'Reserva para varios días, copia de recetas e informes médicos.', quantity: `${KIT_DAYS} días como mínimo`, why: 'Has indicado medicación habitual o personas mayores.' },
    { id: 'medical-power', group: 'Cuidados', when: n('power'), title: 'Baterías para equipos médicos', detail: 'Cargadas, con las instrucciones del equipo y el teléfono del proveedor.', why: 'Hay equipos médicos eléctricos en casa.' },
    { id: 'mobility-aids', group: 'Cuidados', when: n('mobility'), title: 'Ayudas técnicas y sus cargadores', detail: 'Bastón, cargador de la silla eléctrica o lo que sea imprescindible.', sourceId: SRC.family, why: 'Hay una persona con movilidad reducida.' },
    { id: 'sensory-aids', group: 'Cuidados', when: n('sensory') || n('elderly'), title: 'Gafas, audífonos y pilas', detail: 'Unas gafas de repuesto y pilas para los audífonos.', sourceId: SRC.family, why: 'Has indicado discapacidad sensorial o personas mayores.' },
    { id: 'children-kit', group: 'Cuidados', when: n('children'), title: 'Lo necesario para los menores', detail: 'Pañales, leche infantil, ropa y un juego o cuento para mantener la calma.', why: 'Hay niños o niñas en el hogar.' },
    { id: 'pets-kit', group: 'Cuidados', when: n('pets'), title: 'Kit para tus animales', detail: 'Identificación, cartilla veterinaria, transportín o correa, comida y agua para tres días.', sourceId: SRC.family, why: 'Tenéis animales de compañía.' },
    { id: 'whistle', group: 'Tu hogar', when: h.risks.includes('earthquake') || h.level !== 'upper', title: 'Silbato', detail: 'Para pedir ayuda sin gastar la voz si quedas atrapado.' },
    { id: 'keys', group: 'Tu hogar', title: 'Copia de llaves', detail: 'De casa y del coche, junto al kit.' },
    { id: 'waterproof-bags', group: 'Tu hogar', when: h.risks.includes('flood'), title: 'Bolsas impermeables', detail: 'Para proteger documentos, móviles y medicación del agua.', why: 'Has incluido el escenario de inundaciones.' },
    { id: 'masks', group: 'Tu hogar', when: h.risks.includes('wildfire'), title: 'Mascarillas y paños', detail: 'Para el humo y para taponar rendijas con paños mojados si hay que confinarse.', why: 'Has incluido el escenario de incendios forestales.' },
    { id: 'shutoff-tool', group: 'Tu hogar', when: h.risks.includes('earthquake'), title: 'Herramienta para cortar gas y agua', detail: 'Una llave inglesa junto a las llaves de paso.', why: 'Has incluido el escenario de terremotos.' },
  ];
  return strip(lines);
}

export function buildProfile(h: Household, point?: PointCheck): string[] {
  const { flood100, flood500, fwiHigh, intensity } = pointFlags(point);
  const labels = [
    `${h.people} ${h.people === 1 ? 'persona' : 'personas'}`,
    h.dwelling === 'house' ? 'Casa' : 'Piso',
    levels.find(level => level.id === h.level)?.title ?? '',
    ...h.features.map(id => homeFeatures.find(f => f.id === id)?.title ?? id),
    ...h.needs.map(id => needs.find(item => item.id === id)?.title ?? id),
  ];
  if (point) labels.push(flood100 ? 'Punto en zona inundable T100' : flood500 ? 'Punto en zona inundable T500' : 'Punto fuera de zonas T100/T500');
  if (fwiHigh) labels.push(`FWI ${point?.fwi?.className.toLowerCase()}`);
  if (intensity !== undefined) labels.push(`Sismicidad ${EMS_DEGREES[intensity]?.roman ?? intensity} EMS-98`);
  return labels.filter(Boolean);
}

export function buildPersonalPlan(h: Household, point?: PointCheck): PersonalPlan {
  const actions = buildActions(h, point);
  const priorities = [...actions].sort((a, b) => b.priority - a.priority).slice(0, 5);
  return { profile: buildProfile(h, point), actions, priorities, kit: buildKit(h) };
}

/** Non-regional source ids cited by this household's plan, besides the national guide of each chosen risk. */
export function planSourceIds(h: Household, point?: PointCheck): string[] {
  const { actions, kit } = buildPersonalPlan(h, point);
  const national = new Set<string>(h.risks.map(risk => SRC[risk]));
  const ids = [...actions, ...kit].map(item => item.sourceId).filter((id): id is string => !!id && !national.has(id));
  return [...new Set(ids)];
}
