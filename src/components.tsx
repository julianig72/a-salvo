import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, Check, ChevronLeft, ExternalLink, Flame, Info, LoaderCircle, LocateFixed, MapPin, Mountain, ShieldCheck, Waves, X } from 'lucide-react';
import { DISCLAIMER, LOCATION_NOTICE, MUNICIPALITY_NOT_VERIFIED, dwellings, homeFeatures, levels, needs, riskAdvice, validateHousehold } from '../shared/advice';
import { getRegion, provinces } from '../shared/regions';
import { getRegionalRecommendations } from '../shared/regional-advice';
import type { AddressSuggestion, HomeAddress, Household, MunicipalitySuggestion, OfficialSource, RiskId, SourceCheck } from '../shared/types';
import { Autocomplete, type FieldStatus } from './Autocomplete';
import { apiFetch } from './api';

export const riskIcons = { flood: Waves, wildfire: Flame, earthquake: Mountain };

export function Disclaimer({ compact = false }: { compact?: boolean }) {
  return <aside className={`disclaimer ${compact ? 'compact' : ''}`}><ShieldCheck size={18} /><div><strong>Una guía para prepararte, no un plan oficial.</strong> <span>{compact ? 'Contrasta siempre estas recomendaciones con Protección Civil. En una emergencia, sigue las instrucciones de las autoridades.' : DISCLAIMER}</span></div></aside>;
}

export function LocationFields({ household, update, locate, locating, error }: {
  household: Household; update: (changes: Partial<Household>) => void;
  locate: () => void; locating: boolean; error: string;
}) {
  const id = useId();
  const region = getRegion(household.provinceCode);
  const [street, setStreet] = useState(household.address?.label ?? '');
  const [resolving, setResolving] = useState(false);
  const [streetError, setStreetError] = useState('');
  const resolveRequest = useRef(0);
  useEffect(() => { if (household.address) setStreet(current => current.trim() === household.address!.label ? current : household.address!.label); }, [household.address]);
  useEffect(() => { if (!household.municipalityCode) { setStreet(''); setStreetError(''); resolveRequest.current += 1; setResolving(false); } }, [household.municipalityCode]);

  const municipalityStatus: FieldStatus = household.municipalityCode
    ? { tone: 'ok', text: <>Municipio verificado · INE {household.municipalityCode}{region ? ` · ${region.name}` : ''}</> }
    : household.municipality.trim().length >= 2 ? { tone: 'info', text: 'Elige tu municipio de la lista para validarlo.' } : null;
  const address = household.address;
  const streetStatus: FieldStatus = resolving ? { tone: 'busy', text: 'Validando la dirección…' }
    : streetError ? { tone: 'error', text: streetError }
    : address ? { tone: 'ok', text: address.kind === 'portal' ? <>Dirección verificada en CartoCiudad{address.postalCode ? ` · ${address.postalCode}` : ''}</> : 'Calle verificada. Añade el número para situar tu portal con precisión.' }
    : street.trim() ? { tone: 'info', text: 'Elige la calle de la lista; si no, no se usará en tu guía.' } : null;

  const pickStreet = async (item: AddressSuggestion) => {
    const requestId = ++resolveRequest.current;
    setStreet(item.label); setResolving(true); setStreetError('');
    try {
      const response = await apiFetch('/api/geo/addresses/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: item.id, type: item.type, municipality: household.municipalityCode }), signal: AbortSignal.timeout(10000) });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'No se ha podido validar la dirección.');
      if (requestId !== resolveRequest.current) return;
      update({ address: body as HomeAddress });
      setStreet(item.type === 'callejero' ? `${body.label} ` : body.label);
    } catch (cause) {
      if (requestId === resolveRequest.current) setStreetError(cause instanceof Error ? cause.message : 'No se ha podido validar la dirección.');
    } finally { if (requestId === resolveRequest.current) setResolving(false); }
  };

  return <div className="location-fields">
    <div className="field-grid">
      <Autocomplete<MunicipalitySuggestion> label="Tu municipio" value={household.municipality} placeholder="Escribe el nombre de tu municipio" verified={Boolean(household.municipalityCode)}
        onText={text => update({ municipality: text.slice(0, 100), municipalityCode: '', address: null })}
        onPick={item => update({ municipality: item.name, municipalityCode: item.code, provinceCode: item.provinceCode, address: null })}
        search={(q, signal) => getJson<{ suggestions: MunicipalitySuggestion[] }>(`/api/geo/municipalities?${new URLSearchParams({ q, ...(region ? { province: household.provinceCode } : {}) })}`, signal).then(r => r.suggestions)}
        keyOf={item => item.code} render={item => <><strong>{item.name}</strong><small>{item.province}</small></>}
        status={municipalityStatus} hint="Empieza a escribir y elige tu municipio de la lista oficial del INE." inputProps={{ required: true, maxLength: 100 }} />
      <label className="field" htmlFor={`${id}-province`}><span>Provincia o ciudad autónoma</span><select id={`${id}-province`} value={household.provinceCode} onChange={e => update({ provinceCode: e.target.value, ...(household.municipalityCode && household.municipalityCode.slice(0, 2) !== e.target.value ? { municipalityCode: '', address: null } : {}) })} required autoComplete="address-level1"><option value="">Selecciona tu provincia</option>{provinces.map(p => <option value={p.code} key={p.code}>{p.name}</option>)}</select></label>
    </div>
    <Autocomplete<AddressSuggestion> label="Tu calle y número (opcional)" value={street} minChars={3} disabled={!household.municipalityCode}
      placeholder={household.municipalityCode ? 'Ej. Calle San Antonio 5' : 'Elige antes el municipio'} verified={Boolean(address)}
      onText={text => { resolveRequest.current += 1; setResolving(false); setStreetError(''); setStreet(text.slice(0, 120)); if (address) update({ address: null }); }}
      onPick={item => void pickStreet(item)}
      search={(q, signal) => getJson<{ suggestions: AddressSuggestion[] }>(`/api/geo/addresses?${new URLSearchParams({ q, municipality: household.municipalityCode })}`, signal).then(r => r.suggestions)}
      keyOf={item => item.id} render={item => <><strong>{item.label}</strong><small>{[item.type === 'portal' ? 'Portal' : 'Calle', item.postalCode, item.place].filter(Boolean).join(' · ')}</small></>}
      status={streetStatus} hint="Con tu calle y número se genera al instante el mapa de inundación, incendio y terremoto de tu portal. Se valida con CartoCiudad (IGN) y no se guarda en ningún servidor." />
    <div className="location-tools"><button type="button" className="text-link" onClick={locate} disabled={locating}>{locating ? <LoaderCircle className="spin" size={15} /> : <LocateFixed size={15} />}{locating ? 'Buscando tu municipio…' : 'Usar mi ubicación'}</button>{region && <span className="pill">{region.name}</span>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </div>;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await apiFetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'El servicio de búsqueda no está disponible.');
  return body as T;
}

export function RiskSelector({ selected, toggle, suggested = [], mapSuggested = [] }: { selected: RiskId[]; toggle: (id: RiskId) => void; suggested?: RiskId[]; mapSuggested?: RiskId[] }) {
  return <div className="risk-grid">{riskAdvice.map(risk => {
    const Icon = riskIcons[risk.id];
    const active = selected.includes(risk.id);
    return <button type="button" key={risk.id} className={`risk-option ${risk.color} ${active ? 'selected' : ''}`} onClick={() => toggle(risk.id)} aria-pressed={active}>
      <span className="risk-icon"><Icon size={20} strokeWidth={1.8} /></span>
      <span className="risk-text"><strong>{risk.title}</strong><small>{risk.short}</small>{mapSuggested.includes(risk.id) ? <em className="suggested">Sugerido por el mapa oficial de tu dirección</em> : suggested.includes(risk.id) && <em className="suggested">Sugerido por tus respuestas</em>}</span>
      <span className="check-box" aria-hidden="true">{active && <Check size={14} />}</span>
    </button>;
  })}</div>;
}

export function SourceCard({ source, check }: { source: OfficialSource; check?: SourceCheck }) {
  return <article className="source-card">
    <span className={`tag ${source.scope}`}>{source.scope === 'national' ? 'Nacional' : source.scope === 'european' ? 'Europea' : 'Autonómica'}</span>
    <h3>{source.name}</h3><p className="muted small">{source.organization}</p>
    <a className="text-link" href={source.url} target="_blank" rel="noreferrer">Consultar fuente oficial <ExternalLink size={13} /></a>
    <p className={`status ${check?.status ?? 'pending'}`}>{check ? `${check.status === 'available' ? 'Acceso comprobado' : 'No se pudo consultar'} · ${new Date(check.checkedAt).toLocaleString('es-ES')}` : 'Acceso pendiente de consulta'}</p>
    {check?.status === 'unavailable' && <p className="muted small">{check.detail}</p>}
    {source.kind === 'portal' && <p className="muted small">Portal territorial de referencia; no se extraen instrucciones locales automáticamente.</p>}
  </article>;
}

export function RecommendationCitation({ source, number, reviewedAt }: { source?: OfficialSource; number?: number; reviewedAt?: string }) {
  if (!source) return null;
  return <p className="citation"><a href={source.url} target="_blank" rel="noreferrer"><BookOpen size={12} /><span>{number ? `[${number}] ` : ''}{source.organization}</span><ExternalLink size={11} /></a>{reviewedAt && <small>Revisado {reviewedAt} · síntesis, no cita literal</small>}</p>;
}

export function RegionalAdviceSection({ location, risks, sources }: { location: string; risks: RiskId[]; sources: OfficialSource[] }) {
  const recommendations = getRegionalRecommendations(location, risks);
  return <section className="section regional-recommendations" aria-labelledby="regional-heading">
    <div className="section-head"><h2 id="regional-heading">Consejos oficiales de tu comunidad</h2><p>Contenido territorial con atribución directa a su organismo.</p></div>
    {recommendations.length ? <div className="regional-grid">{recommendations.map(item => {
      const sourceIndex = sources.findIndex(source => source.id === item.sourceId);
      return <article className="card regional-item" key={`${item.sourceId}-${item.title}`}><span className="tag regional">Autonómica</span><h3>{item.title}</h3><p>{item.text}</p><RecommendationCitation source={sources[sourceIndex]} number={sourceIndex + 1} reviewedAt={item.reviewedAt} />{item.reviewNote && <p className="muted small">{item.reviewNote}</p>}</article>;
    })}</div> : <p className="muted">No hay una recomendación autonómica verificada en el catálogo para los escenarios seleccionados. Consulta el portal oficial; no sustituimos esta ausencia por contenido inventado.</p>}
  </section>;
}

const steps = [
  { label: 'Ubicación', title: '¿Dónde vives?', text: 'Seleccionamos los organismos y la cartografía de tu comunidad.' },
  { label: 'Hogar', title: '¿Quiénes sois en casa?', text: 'Las necesidades cambian las prioridades y el kit.' },
  { label: 'Vivienda', title: '¿Cómo es tu vivienda?', text: 'La planta, el garaje o el entorno cambian qué hacer primero.' },
  { label: 'Contactos', title: '¿Cómo os vais a encontrar?', text: 'Opcional. Solo se guarda en tu navegador y en el PDF.' },
  { label: 'Escenarios', title: '¿Para qué quieres prepararte?', text: 'Son escenarios elegidos por ti, no riesgos detectados en tu ubicación.' },
];

export function Wizard({ household, update, close, generate, generating, locate, locating, locationError, mapSlot, mapSuggested = [] }: {
  household: Household; update: (changes: Partial<Household>) => void;
  close: () => void; generate: () => Promise<void>; generating: boolean;
  locate: () => void; locating: boolean; locationError: string;
  mapSlot?: ReactNode; mapSuggested?: RiskId[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const stepTitle = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { stepTitle.current?.focus(); }, [step]);
  const toggle = <T extends string>(list: T[], value: T) => list.includes(value) ? list.filter(v => v !== value) : [...list, value];
  const suggested = [...new Set(homeFeatures.filter(f => f.suggests && household.features.includes(f.id)).map(f => f.suggests!))];
  const next = async () => {
    setError('');
    if (step === 0 && (!household.municipality.trim() || !getRegion(household.provinceCode))) { setError('Introduce el municipio y selecciona la provincia.'); return; }
    if (step === 0 && !household.municipalityCode) { setError(MUNICIPALITY_NOT_VERIFIED); return; }
    if (step === 1 && (!Number.isInteger(household.people) || household.people < 1 || household.people > 30)) { setError('Indica entre 1 y 30 personas.'); return; }
    if (step < steps.length - 1) { setStep(step + 1); return; }
    const issue = validateHousehold(household);
    if (issue) { setError(issue); return; }
    if (!accepted) { setError('Confirma que comprendes el carácter orientativo de la guía.'); return; }
    await generate();
  };
  return <dialog className="wizard" ref={dialog} onCancel={e => { e.preventDefault(); if (!generating) close(); }} aria-labelledby="wizard-title">
    <div className="wizard-top"><div className="wizard-progress" aria-label={`Paso ${step + 1} de ${steps.length}`}>{steps.map((s, i) => <span key={s.label} className={i < step ? 'done' : i === step ? 'current' : ''} title={s.label} />)}</div><span className="muted small">Paso {step + 1} de {steps.length} · {steps[step].label}</span><button type="button" className="icon-button" aria-label="Cerrar personalización" onClick={close} disabled={generating}><X size={20} /></button></div>
    <form onSubmit={e => { e.preventDefault(); void next(); }}>
      <div className="wizard-body">
        <h2 id="wizard-title" ref={stepTitle} tabIndex={-1}>{steps[step].title}</h2>
        <p className="muted">{steps[step].text}</p>
        {step === 0 && <><LocationFields household={household} update={update} locate={locate} locating={locating} error={locationError} />{mapSlot}<div className="note"><Info size={16} /><p>{LOCATION_NOTICE}</p></div></>}
        {step === 1 && <>
          <label className="field inline" htmlFor={`${id}-people`}><span>Personas en tu hogar<small>Incluyéndote a ti</small></span><div className="stepper"><button type="button" aria-label="Una persona menos" onClick={() => update({ people: Math.max(1, household.people - 1) })}>−</button><input id={`${id}-people`} type="number" min="1" max="30" step="1" required value={household.people || ''} onChange={e => update({ people: e.target.valueAsNumber || 0 })} /><button type="button" aria-label="Una persona más" onClick={() => update({ people: Math.min(30, household.people + 1) })}>+</button></div></label>
          <fieldset><legend>¿Hay alguna necesidad a tener en cuenta?</legend><div className="option-grid">{needs.map(need => <label className={`option ${household.needs.includes(need.id) ? 'checked' : ''}`} key={need.id}><input type="checkbox" checked={household.needs.includes(need.id)} onChange={() => update({ needs: toggle(household.needs, need.id) })} /><span><strong>{need.title}</strong><small>{need.description}</small></span></label>)}</div></fieldset>
        </>}
        {step === 2 && <>
          <fieldset><legend>Tipo de vivienda</legend><div className="segmented">{dwellings.map(d => <label key={d.id} className={household.dwelling === d.id ? 'checked' : ''}><input type="radio" name={`${id}-dwelling`} checked={household.dwelling === d.id} onChange={() => update({ dwelling: d.id })} />{d.title}</label>)}</div></fieldset>
          <fieldset><legend>¿En qué planta hacéis vida?</legend><div className="option-grid three">{levels.map(l => <label key={l.id} className={`option ${household.level === l.id ? 'checked' : ''}`}><input type="radio" name={`${id}-level`} checked={household.level === l.id} onChange={() => update({ level: l.id })} /><span><strong>{l.title}</strong><small>{l.description}</small></span></label>)}</div></fieldset>
          <fieldset><legend>Tu vivienda y tu entorno</legend><div className="option-grid">{homeFeatures.map(f => <label key={f.id} className={`option ${household.features.includes(f.id) ? 'checked' : ''}`}><input type="checkbox" checked={household.features.includes(f.id)} onChange={() => update({ features: toggle(household.features, f.id) })} /><span><strong>{f.title}</strong><small>{f.description}</small></span></label>)}</div></fieldset>
          <p className="muted small">{household.address ? 'Son datos que tú declaras. Se contrastan con los mapas oficiales de inundación, incendio y terremoto de tu dirección.' : 'Son datos que tú declaras. Para contrastarlos con la cartografía oficial, indica tu calle y número en el primer paso.'}</p>
        </>}
        {step === 3 && <div className="field-grid">
          <label className="field"><span>Contacto principal</span><input value={household.contact} maxLength={180} onChange={e => update({ contact: e.target.value })} placeholder="Nombre y teléfono" /></label>
          <label className="field"><span>Contacto fuera de tu zona</span><input value={household.outsideContact} maxLength={180} onChange={e => update({ outsideContact: e.target.value })} placeholder="Familiar en otra localidad" /></label>
          <label className="field"><span>Punto de encuentro cercano</span><input value={household.meetingPoint} maxLength={180} onChange={e => update({ meetingPoint: e.target.value })} placeholder="Sin validar: contrástalo" /></label>
          <label className="field"><span>Punto de encuentro fuera del barrio</span><input value={household.outsideMeetingPoint} maxLength={180} onChange={e => update({ outsideMeetingPoint: e.target.value })} placeholder="Sin validar: contrástalo" /></label>
        </div>}
        {step === 4 && <>
          <RiskSelector selected={household.risks} suggested={suggested} mapSuggested={mapSuggested} toggle={risk => update({ risks: toggle(household.risks, risk) })} />
          <div className="summary-line"><MapPin size={16} /><span><strong>{household.address ? `${household.address.label}, ` : ''}{household.municipality}, {getRegion(household.provinceCode)?.name}</strong> · {household.people} {household.people === 1 ? 'persona' : 'personas'} · {levels.find(l => l.id === household.level)?.title.toLowerCase()} · {household.risks.length} escenarios</span></div>
          <Disclaimer compact />
          <label className="consent"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required /><span className="check-box" aria-hidden="true"><Check size={14} /></span><span>Entiendo que es una recomendación y que un plan real debe contrastarse con los equipos de Protección Civil.</span></label>
          <p className="muted small">Al generar, se comprueba el acceso a las fuentes oficiales. No enviamos los datos de tu hogar ni tus contactos al servidor.</p>
        </>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
      <div className="wizard-footer">{step > 0 ? <button type="button" className="button ghost" onClick={() => { setStep(step - 1); setError(''); }} disabled={generating}><ChevronLeft size={16} /> Atrás</button> : <span className="muted small">Sin registro. A tu ritmo.</span>}<button className="button primary" type="submit" disabled={generating || locating}>{generating ? <><LoaderCircle size={17} className="spin" /> Consultando fuentes…</> : <>{step === steps.length - 1 ? 'Generar mi guía' : 'Continuar'}<ArrowRight size={17} /></>}</button></div>
    </form>
  </dialog>;
}
