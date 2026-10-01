import { jsPDF } from 'jspdf';
import { CONTENT_VERSION, DISCLAIMER, EMERGENCY_NOTICE, LOCATION_NOTICE, riskAdvice } from '../shared/advice';
import { buildPersonalPlan, phaseLabels } from '../shared/personalize';
import type { KitLine, MapSnapshot, PhaseId, PlanAction, PreparedPlan } from '../shared/types';
import { provinces } from '../shared/regions';
import { getRegionalRecommendations } from '../shared/regional-advice';
import { EMS_DAMAGE, seismicSummary } from '../shared/seismic';

export interface PdfProgress { checkedKit: string[]; checkedTasks: string[] }

const INK = '#141414';
const MUTED = '#6b6b6b';
const LINE = '#e6e6e6';
const ACCENT = '#e5542b';
const LINK = '#1f5fbf';
const LEFT = 20;
const WIDTH = 170;
const TOP = 22;
const BOTTOM = 270;
const kitGroups: KitLine['group'][] = ['Lo esencial', 'Comunicación y documentos', 'Cuidados', 'Tu hogar'];
const phases: PhaseId[] = ['prepare', 'warning', 'during', 'after'];

export function buildPlanPdf(plan: PreparedPlan, progress: PdfProgress = { checkedKit: [], checkedTasks: [] }, map?: MapSnapshot) {
  const h = plan.household;
  const personal = buildPersonalPlan(h, plan.pointCheck);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  let y = TOP;

  const ensure = (space: number) => { if (y + space > BOTTOM) { doc.addPage(); y = TOP; } };
  const text = (value: string, size = 10, bold = false, color = INK, indent = 0, after = 2.4) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines: string[] = doc.splitTextToSize(value, WIDTH - indent);
    const lineHeight = size * 0.45;
    for (const line of lines) {
      ensure(lineHeight);
      doc.text(line, LEFT + indent, y + lineHeight * 0.75);
      y += lineHeight;
    }
    y += after;
  };
  const eyebrow = (value: string) => text(value.toUpperCase(), 8, true, ACCENT, 0, 1.5);
  const pageTitle = (kicker: string, title: string, lead?: string) => {
    doc.addPage(); y = TOP;
    eyebrow(kicker);
    text(title, 22, true, INK, 0, 2);
    if (lead) text(lead, 10, false, MUTED, 0, 4);
    rule();
  };
  const heading = (value: string) => { ensure(18); y += 3; text(value, 13, true); };
  const rule = () => { doc.setDrawColor(LINE); doc.setLineWidth(0.3); doc.line(LEFT, y, LEFT + WIDTH, y); y += 5; };
  const cite = (sourceId?: string) => {
    const index = sourceId ? plan.sources.findIndex(s => s.id === sourceId) : -1;
    if (index < 0) return 'Sugerencia de organización del hogar · no procede de un organismo';
    const source = plan.sources[index];
    return `Fuente [${index + 1}] ${source.organization} · ${source.name}`;
  };
  const action = (item: PlanAction, number?: number) => {
    ensure(22);
    const done = item.phase === 'prepare' && progress.checkedTasks.includes(item.id);
    const marker = number !== undefined ? String(number) : done ? 'OK' : '';
    const startY = y;
    if (number !== undefined) {
      doc.setFillColor(INK); doc.circle(LEFT + 3.2, y + 3, 3.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor('#ffffff');
      doc.text(marker, LEFT + 3.2, y + 4.1, { align: 'center' });
    } else {
      doc.setFillColor(item.risk === 'flood' ? '#2f6fd6' : item.risk === 'wildfire' ? ACCENT : item.risk === 'earthquake' ? '#7a4fd0' : INK);
      doc.circle(LEFT + 1.6, y + 2.4, 1.2, 'F');
    }
    y = startY;
    const indent = number !== undefined ? 10 : 6;
    text(`${item.title}${item.phase === 'prepare' ? (done ? '  [Hecho]' : '  [Pendiente]') : ''}`, 10.5, true, INK, indent, 1);
    text(item.text, 9.5, false, '#2b2b2b', indent, 1);
    if (item.why) text(`Por qué para ti: ${item.why}`, 9, true, ACCENT, indent, 1);
    text(cite(item.sourceId), 7.8, false, MUTED, indent, 4);
  };

  doc.setProperties({ title: `Guía de preparación · ${h.municipality}`, author: 'A salvo · Iniciativa independiente', subject: 'Recomendaciones orientativas de preparación ante emergencias' });

  // Cover
  doc.setFillColor(INK); doc.rect(0, 0, 210, 78, 'F');
  doc.setFillColor(ACCENT); doc.circle(186, 20, 6, 'F');
  doc.setTextColor('#ffffff'); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text('A SALVO · GUÍA FAMILIAR DE PREPARACIÓN', LEFT, 24);
  doc.setFontSize(30); doc.text('Sabe qué hacer.', LEFT, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12);
  const province = provinces.find(p => p.code === h.provinceCode);
  doc.text(doc.splitTextToSize(`${h.address ? `${h.address.label}, ` : ''}${h.municipality} · ${province?.name ?? ''} · ${plan.region}`, WIDTH)[0], LEFT, 56);
  doc.setFontSize(9); doc.setTextColor('#bdbdbd');
  doc.text(`${h.people} ${h.people === 1 ? 'persona' : 'personas'} · Creada el ${new Date(plan.createdAt).toLocaleDateString('es-ES')} · Contenido ${CONTENT_VERSION}`, LEFT, 66);
  y = 90;

  doc.setFillColor('#fff4ef'); doc.setDrawColor(ACCENT);
  const disclaimerLines: string[] = (doc.setFontSize(9.5), doc.splitTextToSize(DISCLAIMER, WIDTH - 12));
  const boxHeight = disclaimerLines.length * 4.3 + 14;
  doc.roundedRect(LEFT, y, WIDTH, boxHeight, 3, 3, 'FD');
  y += 6;
  text('Importante: es una recomendación, no un plan oficial', 10.5, true, ACCENT, 6, 1);
  text(DISCLAIMER, 9.5, false, INK, 6, 0);
  y = 90 + boxHeight + 6;
  text(EMERGENCY_NOTICE, 10, true, INK, 0, 5);

  eyebrow('Hemos tenido en cuenta');
  text(personal.profile.join('  ·  '), 9.5, false, INK, 0, 5);

  const prepare = personal.actions.filter(a => a.phase === 'prepare');
  const tasksDone = prepare.filter(a => progress.checkedTasks.includes(a.id)).length;
  const kitDone = personal.kit.filter(k => progress.checkedKit.includes(k.id)).length;
  eyebrow('Tu preparación hoy');
  text(`${tasksDone} de ${prepare.length} tareas hechas · ${kitDone} de ${personal.kit.length} artículos del kit preparados · ${personal.actions.length} pasos en total`, 9.5, false, INK, 0, 6);

  heading('Tus 5 prioridades');
  text('Ordenadas según tu vivienda, tu hogar y los escenarios que elegiste.', 9, false, MUTED, 0, 4);
  personal.priorities.forEach((item, i) => action(item, i + 1));

  // Communication
  pageTitle('Comunicación', 'Vuestro plan de contacto', 'Compártelo con todas las personas del hogar y con vuestra red de apoyo. Llevadlo también en papel.');
  const rows: [string, string, string][] = [
    ['Contacto principal', h.contact, 'Pendiente de acordar'],
    ['Contacto fuera de tu zona', h.outsideContact, 'Pendiente: alguien que no viva en tu zona'],
    ['Punto de encuentro cercano', h.meetingPoint, 'Pendiente de contrastar'],
    ['Punto de encuentro fuera del barrio', h.outsideMeetingPoint, 'Pendiente de contrastar'],
  ];
  for (const [label, value, pending] of rows) {
    ensure(16);
    text(label.toUpperCase(), 7.5, true, MUTED, 0, 0.8);
    text(value.trim() || pending, 11, !!value.trim(), value.trim() ? INK : ACCENT, 0, 2);
    rule();
  }
  text('Los puntos de encuentro son propuestas vuestras, no refugios validados. Su seguridad depende de la emergencia y de las instrucciones oficiales.', 8.5, false, MUTED, 0, 5);
  heading('Cómo te llegarán los avisos');
  const esAlert = plan.sources.findIndex(s => s.id === 'es-alert');
  const portal = plan.sources.findIndex(s => s.scope === 'regional' && s.kind === 'portal');
  text(`ES-Alert: avisos por difusión celular (Cell Broadcast) en móviles Android 11+ e iOS 15.6+${esAlert >= 0 ? ` [${esAlert + 1}]` : ''}.`, 10);
  text('Avisos meteorológicos de AEMET: www.aemet.es/es/eltiempo/prediccion/avisos', 10);
  if (portal >= 0) text(`${plan.sources[portal].organization} [${portal + 1}].`, 10);
  text('Emergencias: 112. Solo si hay peligro inmediato.', 10, true, ACCENT);

  // Official cartography
  if (plan.pointCheck || map) {
    pageTitle('Cartografía oficial', 'Tu zona en el mapa', 'Consulta puntual a servicios oficiales. No es una evaluación del riesgo de tu vivienda ni sustituye la información de las autoridades.');
    const point = plan.pointCheck;
    if (point) {
      const status = { inside: 'DENTRO de la zona cartografiada', outside: 'Fuera de la zona cartografiada', unknown: 'Sin respuesta del servicio' };
      text(`Punto consultado: ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)} · ${new Date(point.checkedAt).toLocaleString('es-ES')}`, 9, false, MUTED, 0, 3);
      text(`Inundación fluvial T100 (1 % anual): ${status[point.flood100.status]}`, 10.5, point.flood100.status === 'inside', point.flood100.status === 'inside' ? ACCENT : INK, 0, 1);
      text(`Inundación fluvial T500 (0,2 % anual): ${status[point.flood500.status]}`, 10.5, point.flood500.status === 'inside', point.flood500.status === 'inside' ? ACCENT : INK, 0, 1);
      text(`Peligro meteorológico de incendio FWI: ${point.fwi ? `${point.fwi.value.toFixed(1)} · ${point.fwi.className} (${point.fwi.date})` : 'sin datos'}`, 10.5, false, INK, 0, 1);
      const quakeDamage = point.seismic?.status === 'ok' && (point.seismic.intensity ?? 0) >= EMS_DAMAGE;
      text(`Peligrosidad sísmica IGN (periodo de retorno de 475 años): ${point.seismic ? seismicSummary(point.seismic) : 'no consultada'}`, 10.5, quakeDamage, quakeDamage ? ACCENT : INK, 0, 3);
      const hit = [point.flood100, point.flood500].find(r => r.status === 'inside' && r.river);
      if (hit) text(`Tramo estudiado: ${hit.river}${hit.study ? ` · ${hit.study}` : ''}${hit.approved ? ` · aprobado en ${hit.approved}` : ''}${hit.zone ? ` · ${hit.zone}` : ''}`, 8.5, false, MUTED, 0, 3);
    }
    if (map) {
      const ratio = map.height / map.width;
      if (BOTTOM - y - 10 < Math.min(120, WIDTH * ratio)) { doc.addPage(); y = TOP; }
      const imageHeight = Math.min(WIDTH * ratio, BOTTOM - y - 10);
      const imageWidth = imageHeight / ratio;
      doc.addImage(map.dataUrl, 'PNG', LEFT + (WIDTH - imageWidth) / 2, y, imageWidth, imageHeight);
      y += imageHeight + 4;
      text(`Instantánea del ${new Date(map.createdAt).toLocaleString('es-ES')} · ${map.layers.map(l => `${l.title}${l.date ? ` (${l.date})` : ''}`).join(' · ')}`, 8, false, MUTED);
    }
    text('Sin color NO significa sin riesgo. El SNCZI solo cubre la inundación fluvial de los tramos estudiados: lluvia intensa local, barrancos no cartografiados o inundación costera pueden afectar a zonas sin color. El FWI (EFFIS, Copernicus) mide el peligro meteorológico con una resolución de unos 8 km; no es una probabilidad de incendio. La peligrosidad sísmica del IGN es regional, para suelo firme y con un 10 % de probabilidad de superarse en 50 años: no predice terremotos ni evalúa tu edificio.', 8.5, true, INK);
  }

  // Step by step per scenario
  const scenarios = ['general', ...h.risks] as const;
  for (const scenario of scenarios) {
    const risk = riskAdvice.find(r => r.id === scenario);
    const items = personal.actions.filter(a => a.risk === scenario);
    if (!items.length) continue;
    pageTitle('Qué hacer, paso a paso', risk?.title ?? 'Para todo el hogar', risk ? 'Escenario elegido por ti. No implica un nivel de riesgo calculado para tu ubicación.' : 'Medidas comunes a cualquier emergencia, adaptadas a tu hogar.');
    for (const phase of phases) {
      const list = items.filter(a => a.phase === phase);
      if (!list.length) continue;
      ensure(30);
      eyebrow(phaseLabels[phase].short);
      text(phaseLabels[phase].title, 13, true, INK, 0, 3);
      list.forEach(item => action(item));
    }
  }

  // Regional advice
  const regional = getRegionalRecommendations(h.provinceCode, h.risks);
  pageTitle(plan.region, 'Consejos oficiales de tu comunidad', 'Síntesis editorial de contenido autonómico, no citas literales. Cada consejo enlaza con su fuente.');
  if (!regional.length) text('No hay contenido autonómico verificado en el catálogo para los escenarios seleccionados. Consulta el portal oficial indicado en las fuentes.', 10);
  for (const item of regional) {
    ensure(24);
    text(item.title, 10.5, true, INK, 0, 1);
    text(item.text, 9.5, false, '#2b2b2b', 0, 1);
    const index = plan.sources.findIndex(s => s.id === item.sourceId) + 1;
    text(`Fuente [${index}] ${item.organization} · revisado ${item.reviewedAt}`, 7.8, false, MUTED, 0, 1);
    if (item.reviewNote) text(item.reviewNote, 7.8, false, MUTED, 0, 1);
    text(item.url, 7.5, false, LINK, 0, 4);
    doc.link(LEFT, y - 8, WIDTH, 5, { url: item.url });
  }

  // Kit
  pageTitle('Kit de emergencia', `Tu kit para ${h.people} ${h.people === 1 ? 'persona' : 'personas'}`, `Para al menos 72 horas. ${kitDone} de ${personal.kit.length} artículos preparados.`);
  for (const group of kitGroups) {
    const lines = personal.kit.filter(k => k.group === group);
    if (!lines.length) continue;
    ensure(20);
    eyebrow(group);
    for (const line of lines) {
      ensure(12);
      const ready = progress.checkedKit.includes(line.id);
      doc.setDrawColor(ready ? INK : '#9a9a9a'); doc.setFillColor(ready ? INK : '#ffffff');
      doc.roundedRect(LEFT, y + 0.6, 3.6, 3.6, 0.8, 0.8, ready ? 'FD' : 'D');
      text(`${line.title}${line.quantity ? ` · ${line.quantity}` : ''}  ${ready ? '[Listo]' : '[Pendiente]'}`, 10, true, INK, 7, 0.6);
      text(line.detail + (line.why ? ` ${line.why}` : ''), 8.8, false, '#2b2b2b', 7, 0.6);
      text(cite(line.sourceId), 7.4, false, MUTED, 7, 2.6);
    }
    y += 2;
  }

  heading('Antes de dar tu plan por preparado');
  text('Contacta con Protección Civil o con tu ayuntamiento por sus canales de información, no por el 112. Pregunta por el plan de emergencia municipal, los riesgos de tu zona, los avisos a la población y los puntos de encuentro. Revisa esta guía cada año o cuando cambie tu hogar.', 10);

  // Sources
  pageTitle('Trazabilidad', 'Fuentes de esta guía', 'Los números entre corchetes remiten a esta lista. Comprobar el acceso no certifica la vigencia de un contenido.');
  text(LOCATION_NOTICE, 8.5, false, MUTED, 0, 3);
  if (plan.sourceError) text(plan.sourceError, 9, true, ACCENT, 0, 3);
  for (const [index, source] of plan.sources.entries()) {
    ensure(20);
    text(`[${index + 1}] ${source.name}`, 10, true, INK, 0, 0.6);
    const check = plan.checks.find(c => c.id === source.id);
    const scope = source.scope === 'national' ? 'Nacional' : source.scope === 'european' ? 'Europea' : 'Autonómica';
    const kind = source.kind === 'portal' ? 'Portal de referencia' : source.kind === 'data' ? 'Datos cartográficos' : 'Recomendaciones';
    text(`${source.organization} · ${scope} · ${kind} · ${check ? `${check.status === 'available' ? 'Acceso comprobado' : 'No se pudo consultar'} el ${new Date(check.checkedAt).toLocaleString('es-ES')}` : 'Acceso no comprobado en esta generación'}`, 8, false, MUTED, 0, 0.6);
    // Wrapped URL text keeps long official addresses inside the printable area.
    text(source.url, 7.5, false, LINK, 0, 3);
    doc.link(LEFT, y - 7, WIDTH, 5, { url: source.url });
  }

  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setDrawColor(LINE); doc.setLineWidth(0.3); doc.line(LEFT, 280, LEFT + WIDTH, 280);
    doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(MUTED);
    doc.text('A salvo · Recomendaciones orientativas · Contrasta tu plan con Protección Civil · Emergencias 112', LEFT, 285);
    doc.text(`${page} / ${total}`, LEFT + WIDTH, 285, { align: 'right' });
  }
  return doc;
}

export function downloadPlanPdf(plan: PreparedPlan, progress: PdfProgress, map?: MapSnapshot) {
  const name = plan.household.municipality.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9-]/g, '-').replace(/-+/g, '-');
  buildPlanPdf(plan, progress, map).save(`a-salvo-${name || 'mi-hogar'}.pdf`);
}
