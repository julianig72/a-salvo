import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, Check, ExternalLink, Info, LoaderCircle, Menu, Phone, RotateCcw, ShieldCheck, Trash2, X } from 'lucide-react';
import { CONTENT_VERSION, EMERGENCY_NOTICE, LOCATION_NOTICE, initialHousehold, validateHousehold } from '../shared/advice';
import { buildKit, buildPersonalPlan, mapSuggestedRisks, planSourceIds } from '../shared/personalize';
import { getRegion, normalizeMunicipalityName, regions } from '../shared/regions';
import { generalSources, getSources } from '../shared/sources';
import { regionalRecommendations } from '../shared/regional-advice';
import type { Household, MapLocation, MapSnapshot, Page, PointCheck, PreparedPlan, SourceCheck } from '../shared/types';
import { Disclaimer, LocationFields, RegionalAdviceSection, SourceCard, Wizard } from './components';
import { HeroGraphic } from './Illustrations';
import { ProgressRing } from './charts';
import PlanView from './PlanView';
import ZoneMap from './ZoneMap';
import { fetchPoint, renderHazardSnapshot, toPointCheck } from './hazard-snapshot';

const navigation: { page: Page; label: string }[] = [
  { page: 'plan', label: 'Mi plan familiar' },
  { page: 'map', label: 'Mapa de mi zona' },
  { page: 'kit', label: 'Mi kit de emergencia' },
  { page: 'sources', label: 'Fuentes oficiales' },
];
const STORAGE_KEY = 'a-salvo-plan-v2';
const pageSlugs: Record<Page, string> = { home: '', plan: 'plan', map: 'mapa', kit: 'kit', sources: 'fuentes', help: 'ayuda' };
export const pageHash = (page: Page) => pageSlugs[page] ? `#${pageSlugs[page]}` : window.location.pathname + window.location.search;
export function pageFromHash(hash: string): Page | undefined {
  const slug = hash.replace(/^#\/?/, '');
  return (Object.keys(pageSlugs) as Page[]).find(page => pageSlugs[page] === slug);
}
const LEGACY_KEY = 'a-salvo-plan-v1';
const KIT_KEY = 'a-salvo-kit-v1';
const TASKS_KEY = 'a-salvo-tasks-v1';

/** Accepts current and v1 plans; missing v2 fields fall back to neutral defaults. */
export function restoreHousehold(value: unknown): Household | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const h = { ...initialHousehold, ...(value as Partial<Household>) };
  const text = (v: unknown) => typeof v === 'string';
  if (![h.municipality, h.municipalityCode, h.provinceCode, h.contact, h.meetingPoint, h.outsideContact, h.outsideMeetingPoint, h.dwelling, h.level].every(text)
    || typeof h.people !== 'number' || !Array.isArray(h.needs) || !Array.isArray(h.risks) || !Array.isArray(h.features)) return undefined;
  return validateHousehold(h, { requireVerified: false }) ? undefined : h;
}

const nearAddress = (p: { lat: number; lon: number }, a: { lat: number; lon: number }) => Math.abs(p.lat - a.lat) < 0.0003 && Math.abs(p.lon - a.lon) < 0.0003;

function isPointCheck(value: unknown): value is PointCheck {
  if (!value || typeof value !== 'object') return false;
  const p = value as PointCheck;
  return typeof p.lat === 'number' && typeof p.lon === 'number' && typeof p.municipality === 'string' && typeof p.provinceCode === 'string'
    && typeof p.checkedAt === 'string' && ['inside', 'outside', 'unknown'].includes(p.flood100?.status) && ['inside', 'outside', 'unknown'].includes(p.flood500?.status);
}

const sameMunicipality = (a: { municipality: string; provinceCode: string }, b: { municipality: string; provinceCode: string }) =>
  a.provinceCode === b.provinceCode && a.municipality.split('/').some(x => b.municipality.split('/').some(y => normalizeMunicipalityName(x) === normalizeMunicipalityName(y)));

function readList(key: string) {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  const items: unknown = JSON.parse(raw);
  return Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string').slice(0, 200) : [];
}

export default function App() {
  const [page, setPage] = useState<Page>(() => pageFromHash(window.location.hash) ?? 'home');
  const [mapReturn, setMapReturn] = useState<Page>('home');
  const mapReturnLabel = ({ home: 'Volver al inicio', plan: 'Volver a mi guía', kit: 'Volver al kit', sources: 'Volver a las fuentes', help: 'Volver a la ayuda' } as Partial<Record<Page, string>>)[mapReturn] ?? 'Volver';
  const [household, setHousehold] = useState<Household>({ ...initialHousehold });
  const [plan, setPlan] = useState<PreparedPlan | null>(null);
  const mapCache = useRef<{ key: string; snapshot: MapSnapshot } | null>(null);
  const [pointCheck, setPointCheck] = useState<PointCheck | null>(null);
  const [wizard, setWizard] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [checkedKit, setCheckedKit] = useState<string[]>([]);
  const [checkedTasks, setCheckedTasks] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [sourceRegion, setSourceRegion] = useState('valenciana');
  const [sourceChecks, setSourceChecks] = useState<SourceCheck[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const mainHeading = useRef<HTMLHeadingElement>(null);
  const locationRequest = useRef(0);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 900px)');
    const changed = () => { if (media.matches) setMenuOpen(false); };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_KEY);
      if (raw) {
        const stored: unknown = JSON.parse(raw);
        const h = stored && typeof stored === 'object' && 'household' in stored ? restoreHousehold(stored.household) : undefined;
        const createdAt = stored && typeof stored === 'object' && 'createdAt' in stored && typeof stored.createdAt === 'string' && !Number.isNaN(Date.parse(stored.createdAt)) ? stored.createdAt : undefined;
        if (!h || !createdAt) setNotice('La guía guardada no se puede recuperar. Puedes crear una nueva.');
        else {
          const storedPoint = 'pointCheck' in (stored as object) && isPointCheck((stored as { pointCheck: unknown }).pointCheck) ? (stored as { pointCheck: PointCheck }).pointCheck : undefined;
          const region = getRegion(h.provinceCode)!;
          setHousehold(h); setSourceRegion(region.id); setSaved(true);
          if (storedPoint) setPointCheck(storedPoint);
          setPlan({ household: h, createdAt, region: region.name, sources: getSources(h.provinceCode, h.risks, planSourceIds(h, storedPoint)), checks: [], pointCheck: storedPoint, sourceError: 'Guía recuperada del dispositivo. Vuelve a generarla para comprobar el acceso actual a las fuentes.' });
        }
      }
      setCheckedKit(readList(KIT_KEY));
      setCheckedTasks(readList(TASKS_KEY));
    } catch {
      setNotice('No se han podido leer los datos guardados en este navegador. Puedes usar la aplicación sin guardarlos.');
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 9000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const personal = useMemo(() => plan ? buildPersonalPlan(plan.household, plan.pointCheck) : null, [plan]);
  const kitLines = useMemo(() => personal?.kit ?? buildKit(household), [personal, household]);

  const navigate = (target: Page) => {
    if (target === 'map' && page !== 'map') setMapReturn(page);
    if (target !== page) window.history.pushState(null, '', pageHash(target));
    show(target);
  };
  const show = (target: Page) => {
    setPage(target); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'instant' });
    window.setTimeout(() => mainHeading.current?.focus(), 0);
  };
  const pageRef = useRef(page);
  pageRef.current = page;
  const generatingRef = useRef(generating);
  generatingRef.current = generating;
  useEffect(() => {
    const onPop = () => {
      const target = pageFromHash(window.location.hash);
      if (!target) return;
      if (target === 'map' && pageRef.current !== 'map') setMapReturn(pageRef.current);
      if (!generatingRef.current) setWizard(false);
      show(target);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const update = (changes: Partial<Household>) => {
    if ('municipality' in changes || 'provinceCode' in changes) { locationRequest.current += 1; setLocating(false); }
    setHousehold(h => ({ ...h, ...changes }));
    if (changes.provinceCode) {
      const region = getRegion(changes.provinceCode);
      if (region) setSourceRegion(region.id);
    }
  };

  const locate = () => {
    setLocationError('');
    if (!navigator.geolocation) { setLocationError('Este navegador no dispone de geolocalización. Introduce tu municipio y provincia.'); return; }
    const requestId = ++locationRequest.current;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const response = await fetch('/api/location', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: Number(position.coords.latitude.toFixed(3)), lon: Number(position.coords.longitude.toFixed(3)) }),
          signal: AbortSignal.timeout(12000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'No se pudo consultar CartoCiudad.');
        if (typeof result.municipality !== 'string' || !getRegion(result.provinceCode)) throw new Error('No se reconoce el municipio. Introduce la ubicación manualmente.');
        if (locationRequest.current !== requestId) return;
        update({ municipality: result.municipality, municipalityCode: typeof result.municipalityCode === 'string' ? result.municipalityCode : '', provinceCode: result.provinceCode, address: null });
        setNotice(result.municipalityCode ? 'Municipio encontrado y verificado. Si quieres, añade tu calle.' : 'Ubicación aproximada encontrada. Elige tu municipio de la lista para validarlo.');
      } catch (error) {
        if (locationRequest.current === requestId) setLocationError(`${error instanceof Error ? error.message : 'No se pudo obtener tu ubicación.'} Puedes introducirla manualmente.`);
      } finally { if (locationRequest.current === requestId) setLocating(false); }
    }, error => {
      if (locationRequest.current !== requestId) return;
      setLocating(false);
      setLocationError(error.code === 1 ? 'No has autorizado la ubicación. Puedes escribirla manualmente.' : 'No se ha podido obtener tu ubicación. Escribe el municipio y la provincia.');
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  };

  const generate = async () => {
    const issue = validateHousehold(household);
    if (issue) { setNotice(issue); return; }
    const snapshot: Household = { ...household, municipality: household.municipality.trim(), needs: [...household.needs], risks: [...household.risks], features: [...household.features] };
    const region = getRegion(snapshot.provinceCode)!;
    setGenerating(true);
    let point = pointCheck && sameMunicipality(pointCheck, snapshot) && (!snapshot.address || (nearAddress(pointCheck, snapshot.address) && pointCheck.seismic)) ? pointCheck : undefined;
    let pointNotice = '';
    if (snapshot.address && !point) {
      try {
        point = toPointCheck(await fetchPoint(snapshot.address.lat, snapshot.address.lon), snapshot.municipality, snapshot.provinceCode);
        setPointCheck(point);
      } catch { pointNotice = ' No se ha podido consultar la cartografía en tu dirección; puedes reintentarlo desde «Mapa de mi zona».'; }
    }
    const sources = getSources(snapshot.provinceCode, snapshot.risks, planSourceIds(snapshot, point));
    let checks: SourceCheck[] = [];
    let sourceError: string | undefined;
    try {
      const response = await fetch('/api/sources/check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provinceCode: snapshot.provinceCode, risks: snapshot.risks, extra: planSourceIds(snapshot, point) }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error('El servicio de consulta no está disponible.');
      const result = await response.json();
      checks = result.checks;
      if (checks.some(c => c.status === 'unavailable')) sourceError = 'No se ha podido acceder a alguna fuente oficial. La guía usa la selección editorial; revisa los enlaces originales antes de utilizarla.';
    } catch {
      sourceError = 'No se han podido consultar las fuentes en esta generación. Esta guía usa recomendaciones editoriales previamente seleccionadas, no información actualizada en directo. Revisa las fuentes oficiales.';
    }
    setPlan({ household: snapshot, createdAt: new Date().toISOString(), region: region.name, sources, checks, sourceError, pointCheck: point });
    if (pointNotice) setNotice(pointNotice.trim());
    setSaved(false); setGenerating(false); setWizard(false);
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_KEY); }
    catch { setNotice('La guía anterior sigue guardada porque no se ha podido acceder al almacenamiento del navegador.'); }
    navigate('plan');
  };

  /** `auto`: the map queried the validated address by itself; only a plan for that same address is refreshed, silently. */
  const attachPoint = (point: PointCheck, auto: boolean) => {
    setPointCheck(point);
    const matches = plan && sameMunicipality(point, plan.household);
    if (auto) {
      if (matches && plan.household.address && nearAddress(point, plan.household.address) && plan.pointCheck?.checkedAt !== point.checkedAt) {
        setPlan({ ...plan, pointCheck: point, sources: getSources(plan.household.provinceCode, plan.household.risks, planSourceIds(plan.household, point)) });
        setSaved(false);
      }
      return;
    }
    if (matches) {
      setPlan({ ...plan, pointCheck: point, sources: getSources(plan.household.provinceCode, plan.household.risks, planSourceIds(plan.household, point)) });
      setSaved(false);
      setNotice('Punto incorporado a tu plan. Las prioridades se han recalculado con la cartografía oficial.');
    } else setNotice('Punto guardado para esta sesión. Se usará al crear un plan de este municipio.');
  };

  const planMap = async (current: PreparedPlan): Promise<MapSnapshot | undefined> => {
    const h = current.household;
    const point = current.pointCheck && sameMunicipality(current.pointCheck, h) ? current.pointCheck : undefined;
    const key = point ? `point|${point.checkedAt}|${point.lat}|${point.lon}` : `town|${h.provinceCode}|${h.municipalityCode}`;
    if (mapCache.current?.key === key) return mapCache.current.snapshot;
    let lat = point?.lat, lon = point?.lon;
    if (!point) {
      if (!h.municipalityCode) return undefined;
      const response = await fetch('/api/maps/location', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ municipality: h.municipality, municipalityCode: h.municipalityCode, provinceCode: h.provinceCode }), signal: AbortSignal.timeout(16000) });
      if (!response.ok) return undefined;
      const found: MapLocation = await response.json();
      lat = found.lat; lon = found.lon;
    }
    const snapshot = await renderHazardSnapshot({ lat: lat!, lon: lon!, marker: Boolean(point), municipality: h.municipality, provinceCode: h.provinceCode, point });
    mapCache.current = { key, snapshot };
    return snapshot;
  };

  const download = async () => {
    if (!plan || !personal) return;
    setPdfLoading(true);
    try {
      const { downloadPlanPdf } = await import('./pdf');
      let map: MapSnapshot | undefined;
      try { map = await planMap(plan); } catch { map = undefined; }
      downloadPlanPdf(plan, { checkedKit, checkedTasks }, map);
      setNotice(map ? 'PDF preparado con tus prioridades, el mapa de peligros de tu zona, el plan de comunicación, el kit y las referencias oficiales.' : 'PDF preparado. No se ha podido generar el mapa de peligros; consulta los visores oficiales.');
    } catch { setNotice('No se ha podido generar el PDF. Inténtalo de nuevo; tu guía sigue disponible en pantalla.'); }
    finally { setPdfLoading(false); }
  };
  const save = () => {
    if (!plan) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ household: plan.household, createdAt: plan.createdAt, pointCheck: plan.pointCheck }));
      localStorage.removeItem(LEGACY_KEY);
      setSaved(true); setNotice('Guía guardada solo en este navegador. Evita guardarla en dispositivos compartidos.');
    } catch { setNotice('El navegador no permite guardar la guía. Puedes descargar el PDF.'); }
  };
  const toggleIn = (list: string[], id: string, key: string, set: (next: string[]) => void) => {
    const next = list.includes(id) ? list.filter(k => k !== id) : [...list, id];
    set(next);
    try { localStorage.setItem(key, JSON.stringify(next)); }
    catch { setNotice('El cambio se mantiene en esta sesión, pero no se ha podido guardar en el dispositivo.'); }
  };
  const toggleKit = (id: string) => toggleIn(checkedKit, id, KIT_KEY, setCheckedKit);
  const toggleTask = (id: string) => toggleIn(checkedTasks, id, TASKS_KEY, setCheckedTasks);
  const consultSources = async () => {
    setChecking(true); setCheckError(''); setSourceChecks([]);
    try {
      const response = await fetch('/api/sources/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regionId: sourceRegion, risks: ['flood', 'wildfire', 'earthquake'] }), signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('El servicio de consulta no está disponible.');
      const result = await response.json();
      setSourceChecks(result.checks);
      if (result.checks.some((c: SourceCheck) => c.status === 'unavailable')) setCheckError('No se ha podido acceder a alguna fuente. Puedes consultar su enlace directamente.');
    } catch { setCheckError('No se han podido consultar las fuentes. No se ha comprobado su disponibilidad. Prueba los enlaces originales.'); }
    finally { setChecking(false); }
  };
  const clearData = () => {
    try {
      for (const key of [STORAGE_KEY, LEGACY_KEY, KIT_KEY, TASKS_KEY]) localStorage.removeItem(key);
      locationRequest.current += 1; setLocating(false);
      setPlan(null); mapCache.current = null; setPointCheck(null); setSaved(false); setCheckedKit([]); setCheckedTasks([]); setHousehold({ ...initialHousehold }); setShowDelete(false);
      setNotice('Se han borrado la guía, las tareas y la lista del kit de este navegador. Los PDF descargados no se eliminan.');
    } catch { setNotice('No se han podido borrar los datos. Revisa el almacenamiento de este sitio en tu navegador.'); }
  };
  const openWizard = () => { if (plan) setHousehold({ ...plan.household }); setWizard(true); };
  const locationProps = { household, update, locate, locating, error: locationError };
  const mapSuggested = pointCheck && household.address && nearAddress(pointCheck, household.address) && sameMunicipality(pointCheck, household) ? mapSuggestedRisks(pointCheck) : [];
  const planPoint = plan?.pointCheck ?? (plan && pointCheck && sameMunicipality(pointCheck, plan.household) && plan.household.address && nearAddress(pointCheck, plan.household.address) ? pointCheck : null);
  const kitDone = kitLines.filter(item => checkedKit.includes(item.id)).length;
  const allSources = getSources(sourceRegion, ['flood', 'wildfire', 'earthquake']);

  return <div className="app">
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); const main = document.getElementById('main'); main?.focus(); main?.scrollIntoView(); }}>Saltar al contenido</a>
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" onClick={() => navigate('home')} aria-label="A salvo, ir al inicio"><span className="brand-mark"><ShieldCheck size={18} strokeWidth={2} /></span>a salvo</button>
        <nav className="main-nav" aria-label="Navegación principal">{navigation.map(item => <button key={item.page} className={page === item.page ? 'active' : ''} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined}>{item.label}{item.page === 'plan' && plan && <span className="nav-dot" aria-label="guía creada" />}</button>)}</nav>
        <div className="header-actions">
          <a className="call-112" href="tel:112" aria-label="Llamar al 112, solo emergencias"><Phone size={14} />112</a>
          <button className="icon-button menu-button" onClick={() => setMenuOpen(open => !open)} aria-expanded={menuOpen} aria-controls="mobile-nav" aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      {menuOpen && <nav id="mobile-nav" className="mobile-nav" aria-label="Menú">{navigation.map(item => <button key={item.page} className={page === item.page ? 'active' : ''} onClick={() => navigate(item.page)} aria-current={page === item.page ? 'page' : undefined}>{item.label}<ArrowRight size={16} /></button>)}<button className={page === 'help' ? 'active' : ''} onClick={() => navigate('help')}>Ayuda y privacidad<ArrowRight size={16} /></button></nav>}
    </header>

    <main id="main" tabIndex={-1} className={`main page-${page}`}>
      {page === 'home' && <>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Plan de emergencia del hogar</span>
            <h1 ref={mainHeading} tabIndex={-1}>Sabe qué hacer<br />antes de que ocurra.</h1>
            <p className="lead">Responde unas preguntas sobre tu municipio, tu vivienda y las personas con las que vives. Obtén una guía con prioridades, pasos antes, durante y después, y las fuentes oficiales de tu comunidad.</p>
            <div className="actions"><button className="button primary" onClick={openWizard}>Crear mi plan familiar <ArrowRight size={18} /></button><button className="button ghost" onClick={() => navigate('map')}>Ver el mapa de mi zona</button></div>
            <ul className="hero-meta"><li>Sin registro</li><li>Datos en tu dispositivo</li><li>PDF descargable</li></ul>
          </div>
          <HeroGraphic />
        </section>

        <section className="section" aria-labelledby="how-heading">
          <div className="section-head"><h2 id="how-heading">Qué tiene en cuenta tu plan</h2><p>Cada respuesta cambia las prioridades y los pasos de la guía.</p></div>
          <ol className="feature-grid">
            {[
              ['01', 'Tu comunidad', 'Consejos oficiales de las 17 comunidades, Ceuta y Melilla, además de Protección Civil.'],
              ['02', 'Tu vivienda', 'Planta baja, garaje, coche, cercanía a cauces o a vegetación.'],
              ['03', 'Tu hogar', 'Menores, personas mayores, movilidad, medicación, equipos eléctricos o mascotas.'],
              ['04', 'Tu dirección en el mapa', 'Al escribir tu calle se consultan las zonas inundables del SNCZI, el índice de incendio FWI y la peligrosidad sísmica del IGN.'],
            ].map(([n, title, text]) => <li key={n} className="feature"><span className="feature-num">{n}</span><h3>{title}</h3><p>{text}</p></li>)}
          </ol>
        </section>

        <section className="section split" aria-labelledby="output-heading">
          <div><span className="eyebrow">El resultado</span><h2 id="output-heading">Una guía que puedes usar, no un folleto genérico.</h2><p className="muted">Tus cinco prioridades explicadas, una lista de tareas con progreso, el kit calculado para tu hogar, el plan de comunicación y un PDF con cada fuente numerada.</p><button className="button secondary" onClick={openWizard}>Empezar ahora <ArrowRight size={16} /></button></div>
          <div className="output-card" aria-hidden="true">
            <div className="output-row"><ProgressRing value={0.42} size={84} label="42%" /><div><strong>Preparación del hogar</strong><span>5 de 12 tareas completadas</span></div></div>
            {['Identifica cómo subir a una planta alta', 'No bajes al garaje si se inunda', 'Acordad un contacto fuera de la zona'].map((t, i) => <div className="output-item" key={t}><span className={`dot ${['flood', 'flood', 'general'][i]}`} />{t}</div>)}
          </div>
        </section>

        <section className="section links-row">
          <button className="link-card" onClick={() => navigate('kit')}><span>Kit de emergencia</span><small>Cantidades para tu hogar</small><ArrowUpRight size={18} /></button>
          <button className="link-card" onClick={() => navigate('map')}><span>Mapa de mi zona</span><small>SNCZI · EFFIS · IGN</small><ArrowUpRight size={18} /></button>
          <button className="link-card" onClick={() => navigate('sources')}><span>Fuentes oficiales</span><small>{new Set(regionalRecommendations.map(item => item.regionId)).size} territorios verificados</small><ArrowUpRight size={18} /></button>
        </section>
        <Disclaimer compact />
      </>}

      {page === 'plan' && <PlanView plan={plan} personal={personal} headingRef={mainHeading} checkedTasks={checkedTasks} toggleTask={toggleTask} kitDone={kitDone} kitTotal={kitLines.length}
        onCreate={openWizard} onDownload={() => void download()} pdfLoading={pdfLoading} onSave={save} saved={saved}
        goMap={() => { if (plan) setHousehold({ ...plan.household }); navigate('map'); }} goKit={() => navigate('kit')}
        goSources={() => { if (plan) setSourceRegion(getRegion(plan.household.provinceCode)!.id); navigate('sources'); }}
        mapSlot={plan && <ZoneMap compact municipality={plan.household.municipality} municipalityCode={plan.household.municipalityCode} provinceCode={plan.household.provinceCode} home={plan.household.address} onPoint={attachPoint} point={planPoint} />} />}

      {page === 'map' && <>
        <button className="back-link" onClick={() => navigate(mapReturn)}><ArrowLeft size={16} />{mapReturnLabel}</button>
        <header className="page-head"><span className="eyebrow">Cartografía oficial</span><h1 ref={mainHeading} tabIndex={-1}>Mapa de mi zona</h1>        <p className="lead">Escribe tu dirección y el mapa se genera solo: zonas inundables del SNCZI, peligro meteorológico de incendio (FWI) y peligrosidad sísmica del IGN, con tu vivienda marcada.</p></header>
        <section className="card map-location"><LocationFields {...locationProps} /></section>
                <ZoneMap municipality={household.municipality} municipalityCode={household.municipalityCode} provinceCode={household.provinceCode} home={household.address} onPoint={attachPoint} point={pointCheck} />
        <div className="row-between">
          <button className="button ghost" onClick={() => navigate(mapReturn)}><ArrowLeft size={16} />{mapReturnLabel}</button>
          <button className="button primary" onClick={() => setWizard(true)}>{plan ? 'Actualizar mi plan' : 'Crear mi plan con esta ubicación'} <ArrowRight size={16} /></button>
        </div>
        <Disclaimer />
      </>}

      {page === 'kit' && <>
        <header className="page-head with-aside"><div><span className="eyebrow">{plan ? `Calculado para ${plan.household.people} ${plan.household.people === 1 ? 'persona' : 'personas'}` : 'Lista orientativa'}</span><h1 ref={mainHeading} tabIndex={-1}>Mi kit de emergencia</h1><p className="lead">{plan ? 'Adaptado a las necesidades que has indicado. Marca lo que ya tienes preparado.' : 'Crea tu plan para ajustar el kit a tu hogar. Mientras, puedes marcar lo que ya tienes.'}</p></div><div className="kit-progress-ring"><ProgressRing value={kitLines.length ? kitDone / kitLines.length : 0} size={112} label={`${kitDone}/${kitLines.length}`} /><span>{kitDone} de {kitLines.length} artículos preparados</span></div></header>
        <div className="kit-groups">{(['Lo esencial', 'Comunicación y documentos', 'Cuidados', 'Tu hogar'] as const).map(group => {
          const items = kitLines.filter(item => item.group === group);
          if (!items.length) return null;
          return <section className="kit-group" key={group}><h2>{group}</h2>{items.map(item => <label className={`check-row ${checkedKit.includes(item.id) ? 'done' : ''}`} key={item.id}><input type="checkbox" checked={checkedKit.includes(item.id)} onChange={() => toggleKit(item.id)} /><span className="check-box" aria-hidden="true"><Check size={14} /></span><span className="check-text"><strong>{item.title}{item.quantity && <em className="qty">{item.quantity}</em>}</strong><small>{item.detail}</small>{item.why && <small className="why">{item.why}</small>}{(() => { const source = item.sourceId ? plan?.sources.find(s => s.id === item.sourceId) ?? generalSources[item.sourceId] : undefined; return source ? <a className="kit-source" href={source.url} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>Fuente: {source.organization} <ExternalLink size={11} /></a> : <small className="kit-source muted">Sugerencia orientativa</small>; })()}</span></label>)}</section>;
        })}</div>
        <div className="note"><Info size={18} /><p>Las cantidades son orientativas y se basan en las fuentes citadas en tu guía. Consulta necesidades específicas con tu profesional sanitario y Protección Civil. La lista se guarda solo en este navegador.</p></div>
        <div className="row-end"><button className="button primary" onClick={plan ? () => void download() : openWizard} disabled={pdfLoading}>{plan ? 'Descargar guía con mi kit' : 'Incluir en mi guía'}{pdfLoading ? <LoaderCircle className="spin" size={16} /> : <ArrowRight size={16} />}</button></div>
        <Disclaimer compact />
      </>}

      {page === 'sources' && <>
        <header className="page-head"><span className="eyebrow">Información con referencias</span><h1 ref={mainHeading} tabIndex={-1}>Fuentes oficiales</h1><p className="lead">A salvo es una iniciativa independiente. Cada recomendación indica su organismo y enlaza al contenido original.</p></header>
        <section className="stats-row" aria-label="Cobertura">
          <div><strong>{new Set(regionalRecommendations.map(item => item.regionId)).size}/19</strong><span>territorios con contenido verificado</span></div>
          <div><strong>{regionalRecommendations.length}</strong><span>recomendaciones autonómicas</span></div>
          <div><strong>{CONTENT_VERSION}</strong><span>versión editorial</span></div>
        </section>
        <div className="source-controls"><label>Comunidad o ciudad autónoma<select value={sourceRegion} disabled={checking} onChange={e => { setSourceRegion(e.target.value); setSourceChecks([]); setCheckError(''); }}>{regions.map(region => <option key={region.id} value={region.id}>{region.name}</option>)}</select></label><button className="button secondary" onClick={() => void consultSources()} disabled={checking}>{checking ? <LoaderCircle className="spin" size={16} /> : <RotateCcw size={16} />}{checking ? 'Consultando…' : 'Consultar fuentes ahora'}</button></div>
        <p className="muted small">La consulta comprueba el acceso a cada página, no su vigencia. Esta web no es un servicio de alertas.</p>
        {checkError && <div className="note warn" role="status"><Info size={18} /><p>{checkError}</p></div>}
        <RegionalAdviceSection location={sourceRegion} risks={['flood', 'wildfire', 'earthquake']} sources={allSources} />
        <div className="source-grid">{allSources.map(source => <SourceCard key={source.id} source={source} check={sourceChecks.find(c => c.id === source.id)} />)}</div>
        <section className="card link-list"><h2>Antes y durante una emergencia</h2><a href="https://www.aemet.es/es/eltiempo/prediccion/avisos" target="_blank" rel="noreferrer"><span><strong>Avisos meteorológicos de AEMET</strong><small>Avisos oficiales con su fecha y zona.</small></span><ExternalLink size={16} /></a><a href="https://www.proteccioncivil.es/" target="_blank" rel="noreferrer"><span><strong>Protección Civil y Emergencias</strong><small>Información nacional y recomendaciones de autoprotección.</small></span><ExternalLink size={16} /></a></section>
        <Disclaimer />
      </>}

      {page === 'help' && <>
        <header className="page-head"><span className="eyebrow">Con transparencia</span><h1 ref={mainHeading} tabIndex={-1}>Ayuda y privacidad</h1><p className="lead">Lo que esta herramienta hace. Y lo que no hace.</p></header>
        <div className="prose-grid">
          <section><h2>Una guía de preparación, no de intervención</h2><p>{LOCATION_NOTICE}</p><p>{EMERGENCY_NOTICE}</p><p>El mapa representa la inundación fluvial cartografiada por el SNCZI, el índice científico FWI publicado por Copernicus/EFFIS y la peligrosidad sísmica probabilista del IGN (periodo de retorno de 475 años). No calcula probabilidades de incendio, no predice terremotos ni evalúa la vulnerabilidad de una vivienda. Sin color o sin datos no significa sin peligro.</p></section>
          <section><h2>Cómo se personaliza</h2><p>La guía aplica reglas editoriales transparentes a tus respuestas: por ejemplo, si vives en planta baja se priorizan los consejos oficiales sobre subir a plantas altas ante una inundación. Cada paso muestra por qué aparece y su fuente. Las sugerencias de organización que no proceden de un organismo se identifican como tales. No hay generación libre con inteligencia artificial.</p></section>
          <section><h2>Tus datos se quedan contigo</h2><p>No hay cuentas, publicidad ni analítica. Los datos del hogar y los contactos permanecen en el navegador, salvo que decidas guardarlos localmente o descargar el PDF. Al crear una guía solo se envían la provincia y los escenarios para comprobar las fuentes.</p><p>Cuando indicas tu calle y número, o marcas un punto en el mapa, sus coordenadas (redondeadas a unos 10 m) se envían a este servidor para consultar el SNCZI (MITECO), EFFIS (Copernicus) y el IGN. No se guardan.</p></section>
          <section><h2>Cómo funciona la ubicación</h2><p>Puedes escribir municipio y provincia sin usar GPS. Si pulsas «Usar mi ubicación», se envían a CartoCiudad (IGN) coordenadas redondeadas a tres decimales para obtener el municipio, sin guardarlas.</p><a className="text-link" href="https://www.cartociudad.es/" target="_blank" rel="noreferrer">Conocer CartoCiudad <ExternalLink size={14} /></a></section>
        </div>
        <section className="card delete-card"><div><h2>Gestiona los datos de este dispositivo</h2><p className="muted">Borra la guía, las tareas marcadas y el kit. Los PDF descargados debes eliminarlos por separado.</p></div>{showDelete ? <div className="delete-confirm" role="group" aria-label="Confirmar borrado"><strong>¿Borrar los datos locales?</strong><button className="button danger" onClick={clearData}>Sí, borrar datos</button><button className="button ghost" onClick={() => setShowDelete(false)}>Cancelar</button></div> : <button className="button secondary" onClick={() => setShowDelete(true)}><Trash2 size={16} />Borrar mis datos locales</button>}</section>
        <Disclaimer />
      </>}
    </main>
    <footer className="site-footer"><div><span className="brand small"><span className="brand-mark"><ShieldCheck size={14} /></span>a salvo</span><span className="muted">Iniciativa independiente · Contenido {CONTENT_VERSION}</span></div><nav aria-label="Pie de página"><button onClick={() => navigate('help')}>Ayuda y privacidad</button><button onClick={() => navigate('sources')}><BookOpen size={14} />Fuentes</button></nav></footer>
    {wizard && <Wizard household={household} update={update} close={() => setWizard(false)} generate={generate} generating={generating} locate={locate} locating={locating} locationError={locationError} mapSuggested={mapSuggested}
      mapSlot={<ZoneMap compact municipality={household.municipality} municipalityCode={household.municipalityCode} provinceCode={household.provinceCode} home={household.address} onPoint={attachPoint} point={pointCheck} />} />}
    {notice && <div className="toast" role="status"><Info size={18} /><span>{notice}</span><button aria-label="Cerrar mensaje" className="icon-button" onClick={() => setNotice('')}><X size={16} /></button></div>}
  </div>;
}
