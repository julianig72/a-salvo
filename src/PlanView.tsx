import { useState, type ReactNode, type RefObject } from 'react';
import { AlertTriangle, ArrowRight, ArrowUpRight, BellRing, Check, Download, ExternalLink, Info, LoaderCircle, LockKeyhole, MapPin, Pencil, Phone, Plus, Users } from 'lucide-react';
import { CONTENT_VERSION, LOCATION_NOTICE, riskAdvice } from '../shared/advice';
import { mapSuggestedRisks, phaseLabels, type PersonalPlan } from '../shared/personalize';
import { EMS_DAMAGE, emsLabel } from '../shared/seismic';
import type { OfficialSource, PhaseId, PlanAction, PreparedPlan, RiskId } from '../shared/types';
import { Disclaimer, RecommendationCitation, RegionalAdviceSection, riskIcons } from './components';
import { PhaseBar, ProgressRing } from './charts';

function ActionSource({ action, sources }: { action: PlanAction; sources: OfficialSource[] }) {
  const index = action.sourceId ? sources.findIndex(source => source.id === action.sourceId) : -1;
  if (index < 0) return <span className="household-tag">Sugerencia de organización del hogar · no procede de un organismo</span>;
  return <RecommendationCitation source={sources[index]} number={index + 1} reviewedAt={CONTENT_VERSION} />;
}

function ActionItem({ action, sources, done, toggle, numbered }: { action: PlanAction; sources: OfficialSource[]; done: boolean; toggle: (id: string) => void; numbered?: number }) {
  const checkable = action.phase === 'prepare';
  return <li className={`action ${done ? 'done' : ''}`}>
    {numbered !== undefined ? <span className="action-num">{numbered}</span> : <span className={`dot ${action.risk === 'wildfire' ? 'fire' : action.risk === 'earthquake' ? 'quake' : action.risk}`} aria-hidden="true" />}
    <div className="action-body">
      <h3>{action.title}</h3>
      <p>{action.text}</p>
      {action.why && <p className="why"><strong>Por qué para ti:</strong> {action.why}</p>}
      <ActionSource action={action} sources={sources} />
    </div>
    {checkable && <label className="done-toggle"><input type="checkbox" checked={done} onChange={() => toggle(action.id)} /><span className="check-box" aria-hidden="true"><Check size={14} /></span><span>{done ? 'Hecho' : 'Marcar hecho'}<span className="visually-hidden">: {action.title}</span></span></label>}
  </li>;
}

export default function PlanView({ plan, personal, headingRef, checkedTasks, toggleTask, kitDone, kitTotal, onCreate, onDownload, pdfLoading, onSave, saved, goMap, goKit, goSources, mapSlot }: {
  plan: PreparedPlan | null; personal: PersonalPlan | null; headingRef: RefObject<HTMLHeadingElement | null>;
  checkedTasks: string[]; toggleTask: (id: string) => void; kitDone: number; kitTotal: number;
  onCreate: () => void; onDownload: () => void; pdfLoading: boolean; onSave: () => void; saved: boolean;
  goMap: () => void; goKit: () => void; goSources: () => void; mapSlot?: ReactNode;
}) {
  const [tab, setTab] = useState<RiskId | 'general'>('general');
  if (!plan || !personal) return <>
    <header className="page-head"><span className="eyebrow">Tu plan</span><h1 ref={headingRef} tabIndex={-1}>Mi plan familiar</h1><p className="lead">Todavía no has creado tu guía.</p></header>
    <section className="card empty"><h2>Tu plan empieza aquí.</h2><p className="muted">Unas preguntas sobre tu municipio, tu vivienda y tu hogar. Unos minutos, sin registro.</p><button className="button primary" onClick={onCreate}>Crear mi plan familiar <Plus size={17} /></button></section>
    <Disclaimer compact />
  </>;
  const h = plan.household;
  const tasks = personal.actions.filter(a => a.phase === 'prepare');
  const tasksDone = tasks.filter(a => checkedTasks.includes(a.id)).length;
  const readiness = (tasksDone + kitDone) / Math.max(1, tasks.length + kitTotal);
  const tabs: (RiskId | 'general')[] = ['general', ...h.risks];
  const activeTab = tabs.includes(tab) ? tab : 'general';
  const tabActions = personal.actions.filter(a => a.risk === activeTab);
  const point = plan.pointCheck;
  const floodInside = point && (point.flood100.status === 'inside' || point.flood500.status === 'inside');
  const floodStudy = point ? [point.flood100, point.flood500].find(r => r.status === 'inside' && r.river) : undefined;
  const quakeDamage = point?.seismic?.status === 'ok' && (point.seismic.intensity ?? 0) >= EMS_DAMAGE;
  const suggestedMissing = mapSuggestedRisks(point).filter(id => !h.risks.includes(id));
  const portal = plan.sources.find(s => s.scope === 'regional' && s.kind === 'portal');
  const esAlert = plan.sources.find(s => s.id === 'es-alert');
  const phaseCounts = (['prepare', 'warning', 'during', 'after'] as PhaseId[]).map((phase, i) => ({ label: phaseLabels[phase].short, value: personal.actions.filter(a => a.phase === phase).length, tone: ['ink', 'amber', 'red', 'green'][i] }));

  return <>
    <header className="page-head with-aside">
      <div><span className="eyebrow">{plan.region}</span><h1 ref={headingRef} tabIndex={-1}>Mi plan familiar</h1><p className="lead">{h.address ? `${h.address.label}, ` : ''}{h.municipality} · {h.people} {h.people === 1 ? 'persona' : 'personas'} · creado el {new Date(plan.createdAt).toLocaleDateString('es-ES')}</p></div>
      <div className="actions"><button className="button primary" onClick={onDownload} disabled={pdfLoading}>{pdfLoading ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}Descargar PDF</button><button className="button secondary" onClick={onCreate}><Pencil size={15} />Editar guía</button></div>
    </header>
    <Disclaimer />
    {plan.sourceError && <div className="note warn" role="status"><Info size={18} /><p>{plan.sourceError}</p></div>}

    <section className="overview" aria-label="Resumen de tu plan">
      <article className="card stat"><ProgressRing value={readiness} size={92} /><div><h2>Preparación</h2><p>{tasksDone} de {tasks.length} tareas · {kitDone} de {kitTotal} artículos del kit</p><button className="text-link" onClick={goKit}>Completar el kit <ArrowRight size={14} /></button></div></article>
      <article className="card stat column"><h2>{personal.actions.length} pasos en tu plan</h2><PhaseBar counts={phaseCounts} /></article>
      <article className="card stat column"><h2>Cartografía oficial</h2>{point ? <><p className={floodInside || quakeDamage ? 'status-strong' : ''}>{floodInside ? 'Tu dirección está dentro de una zona inundable cartografiada.' : 'Fuera de las zonas inundables T100/T500 cartografiadas.'}{point.seismic?.status === 'ok' && point.seismic.intensity !== undefined ? ` Sismicidad ${emsLabel(point.seismic.intensity)}.` : ''}</p><button className="text-link" onClick={goMap}>Ver el mapa completo <ArrowRight size={14} /></button></> : <><p className="muted">Añade tu calle y número para consultar inundación, incendio y terremoto en tu portal.</p><button className="text-link" onClick={goMap}><MapPin size={14} />Ver el mapa de mi zona</button></>}</article>
    </section>

    <section className="section tight" aria-labelledby="profile-heading"><h2 id="profile-heading" className="label">Hemos tenido en cuenta</h2><ul className="chips">{personal.profile.map(item => <li key={item}>{item}</li>)}</ul></section>

    <section className="section" aria-labelledby="priorities-heading">
      <div className="section-head"><h2 id="priorities-heading">Tus prioridades</h2><p>Ordenadas según tu vivienda, tu hogar y los escenarios elegidos. Empieza por aquí.</p></div>
      <ol className="action-list priorities">{personal.priorities.map((action, i) => <ActionItem key={action.id} action={action} sources={plan.sources} done={checkedTasks.includes(action.id)} toggle={toggleTask} numbered={i + 1} />)}</ol>
    </section>

    <section className="section card point-card" aria-labelledby="point-heading">
      <div className="section-head"><h2 id="point-heading">Peligros oficiales en {h.address ? 'tu dirección' : 'tu municipio'}</h2><p>{point ? `Consulta del ${new Date(point.checkedAt).toLocaleString('es-ES')} · ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}` : h.address ? 'Consultando la cartografía oficial en tu dirección…' : 'Añade tu calle y número al editar la guía para consultar tu portal.'}</p></div>
      {mapSlot}
      {suggestedMissing.length > 0 && <div className="note warn"><AlertTriangle size={18} /><p>La cartografía oficial de tu ubicación sugiere prepararte también para {suggestedMissing.map(id => riskAdvice.find(r => r.id === id)?.title.toLowerCase()).join(' y ')}, y no lo has incluido. <button className="text-link" onClick={onCreate}>Añádelo a tu guía</button></p></div>}
      {floodStudy && !mapSlot && <p className="small point-study">Tramo estudiado: <strong>{floodStudy.river}</strong></p>}
    </section>

    <section className="section" aria-labelledby="comms-heading">
      <div className="section-head"><h2 id="comms-heading">Comunicación y punto de encuentro</h2><p>Compártelo con tu hogar y con tu red de apoyo.</p></div>
      <div className="comms-grid">
        <article className="card"><Users size={18} /><h3>Contacto principal</h3><p>{h.contact || <span className="pending">Pendiente de acordar</span>}</p></article>
        <article className="card"><Phone size={18} /><h3>Contacto fuera de tu zona</h3><p>{h.outsideContact || <span className="pending">Pendiente: alguien que no viva en tu zona</span>}</p></article>
        <article className="card"><MapPin size={18} /><h3>Punto de encuentro cercano</h3><p>{h.meetingPoint || <span className="pending">Pendiente de contrastar</span>}</p></article>
        <article className="card"><MapPin size={18} /><h3>Punto fuera del barrio</h3><p>{h.outsideMeetingPoint || <span className="pending">Pendiente de contrastar</span>}</p></article>
      </div>
      <p className="muted small">Los puntos de encuentro son propuestas tuyas, no refugios validados. Su seguridad depende de la emergencia y de las instrucciones oficiales.</p>
      <div className="card alerts-card"><BellRing size={18} /><div><h3>Cómo te llegarán los avisos</h3><ul>
        {esAlert && <li><strong>ES-Alert</strong>: avisos por difusión celular en móviles Android 11+ e iOS 15.6+. <a href={esAlert.url} target="_blank" rel="noreferrer">Saber más <ExternalLink size={12} /></a></li>}
        <li><strong>Avisos de AEMET</strong> para tu zona. <a href="https://www.aemet.es/es/eltiempo/prediccion/avisos" target="_blank" rel="noreferrer">Consultar <ExternalLink size={12} /></a></li>
        {portal && <li><strong>{portal.organization}</strong>. <a href={portal.url} target="_blank" rel="noreferrer">Canal oficial <ExternalLink size={12} /></a></li>}
      </ul></div></div>
    </section>

    <section className="section" aria-labelledby="steps-heading">
      <div className="section-head"><h2 id="steps-heading">Qué hacer, paso a paso</h2><p>Antes, cuando haya aviso, durante y después.</p></div>
      <div className="tabs" role="tablist" aria-label="Escenario">{tabs.map(id => { const risk = riskAdvice.find(r => r.id === id); const Icon = id === 'general' ? Users : riskIcons[id]; return <button key={id} role="tab" id={`tab-${id}`} aria-selected={activeTab === id} aria-controls="tab-panel" className={activeTab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={16} />{risk?.title ?? 'Para todo el hogar'}</button>; })}</div>
      <div className="timeline" role="tabpanel" id="tab-panel" aria-labelledby={`tab-${activeTab}`}>
        {(['prepare', 'warning', 'during', 'after'] as PhaseId[]).map(phase => {
          const items = tabActions.filter(a => a.phase === phase);
          if (!items.length) return null;
          return <div className={`phase phase-${phase}`} key={phase}><div className="phase-head"><span className="phase-marker" /><h3>{phaseLabels[phase].title}</h3><span className="muted small">{phaseLabels[phase].hint}</span></div><ul className="action-list">{items.map(action => <ActionItem key={action.id} action={action} sources={plan.sources} done={checkedTasks.includes(action.id)} toggle={toggleTask} />)}</ul></div>;
        })}
      </div>
    </section>

    <RegionalAdviceSection location={h.provinceCode} risks={h.risks} sources={plan.sources} />

    <section className="cta-band"><div><h2>El siguiente paso: contrástalo.</h2><p>Pregunta a Protección Civil o a tu ayuntamiento por el plan de tu municipio. El 112 es solo para emergencias, no para revisar planes.</p></div><button className="button inverse" onClick={goSources}>Ver organismos <ArrowUpRight size={16} /></button></section>

    <section className="section" aria-labelledby="sources-heading">
      <div className="section-head"><h2 id="sources-heading">Fuentes de esta guía</h2><p>Contenido editorial {CONTENT_VERSION}. Comprobar el acceso no certifica la vigencia.</p></div>
      <ol className="source-list">{plan.sources.map((source, i) => { const check = plan.checks.find(c => c.id === source.id); return <li key={source.id}><span className="source-num">{i + 1}</span><div><a href={source.url} target="_blank" rel="noreferrer">{source.name} <ExternalLink size={12} /></a><small>{source.organization} · {source.scope === 'national' ? 'Nacional' : source.scope === 'european' ? 'Europea' : 'Autonómica'}{source.kind === 'portal' ? ' · Portal de referencia' : source.kind === 'data' ? ' · Datos cartográficos' : ''}</small></div><span className={`status ${check?.status ?? 'pending'}`}>{check ? (check.status === 'available' ? 'Acceso comprobado' : 'No se pudo consultar') : 'Acceso pendiente de consulta'}</span></li>; })}</ol>
    </section>

    <div className="note"><Info size={18} /><p>{LOCATION_NOTICE}</p></div>
    <section className="card save-card"><LockKeyhole size={20} /><div><h3>Tu guía, solo en tu dispositivo</h3><p className="muted">Guardarla es opcional. Si contiene contactos, evita los dispositivos compartidos.</p></div><button className="button secondary" onClick={onSave} disabled={saved}>{saved ? <Check size={16} /> : <Download size={16} />}{saved ? 'Guardada aquí' : 'Guardar en este navegador'}</button></section>
  </>;
}
