import { useEffect, useRef, useState } from 'react';
import { Check, Download, ExternalLink, Flame, Home, Info, LoaderCircle, LocateFixed, MapPin, Minus, Mountain, Plus, RotateCcw, Waves } from 'lucide-react';
import type { FloodPointResult, HomeAddress, MapCatalog, MapLayerId, MapLocation, PointCheck } from '../shared/types';
import { MAP_HEIGHT, MAP_WIDTH, mapBounds, metersPerPixel, project, unproject } from '../shared/map-math';
import { EMS_DEGREES, EMS_SCALE_URL, emsLabel } from '../shared/seismic';
import { FIRE_LEGEND, FLOOD_COLORS, fetchPoint, getCatalog, layerImageUrl, renderHazardSnapshot, toPointCheck, type PointResponse } from './hazard-snapshot';
import { apiFetch } from './api';

type Hazard = 'flood' | 'fire' | 'seismic';
type LayerState = 'loading' | 'ready' | 'error';
const hazards: { id: Hazard; label: string; Icon: typeof Waves; layers: MapLayerId[]; zoom: number; townZoom: number; source: string }[] = [
  { id: 'flood', label: 'Inundación', Icon: Waves, layers: ['flood500', 'flood100'], zoom: 15, townZoom: 13, source: 'SNCZI · MITECO' },
  { id: 'fire', label: 'Incendio', Icon: Flame, layers: ['fire'], zoom: 10, townZoom: 10, source: 'EFFIS · Copernicus' },
  { id: 'seismic', label: 'Terremoto', Icon: Mountain, layers: ['seismic'], zoom: 8, townZoom: 8, source: 'IGN' },
];
const floodLabel = (r: FloodPointResult) => r.status === 'inside' ? 'Dentro de la zona cartografiada' : r.status === 'outside' ? 'Fuera de la zona cartografiada' : 'Sin respuesta del SNCZI';
const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 0.0003 && Math.abs(a.lon - b.lon) < 0.0003;
const fwiClass = (className: string) => `fwi-${className.toLowerCase().replace(/\s/g, '-')}`;

function tabSummary(id: Hazard, result: PointResponse | null) {
  if (!result) return '';
  if (id === 'flood') return result.flood100.status === 'inside' ? 'T100' : result.flood500.status === 'inside' ? 'T500' : result.flood100.status === 'unknown' || result.flood500.status === 'unknown' ? 'Sin datos' : 'Fuera';
  if (id === 'fire') return result.fwi ? result.fwi.className : 'Sin datos';
  return result.seismic?.status === 'ok' && result.seismic.intensity !== undefined ? EMS_DEGREES[result.seismic.intensity]?.roman ?? String(result.seismic.intensity) : 'Sin datos';
}

/**
 * Official hazard map generated as soon as the municipality (and, if given, the address) is validated.
 * The address point is queried automatically in SNCZI, EFFIS and IGN and handed to the plan with `onPoint(point, true)`.
 */
export default function ZoneMap({ municipality, municipalityCode, provinceCode, home, onPoint, point, compact = false }: {
  municipality: string; municipalityCode: string; provinceCode: string; home: HomeAddress | null;
  onPoint: (point: PointCheck, auto: boolean) => void; point: PointCheck | null; compact?: boolean;
}) {
  const [location, setLocation] = useState<MapLocation | null>(null);
  const [catalog, setCatalog] = useState<MapCatalog | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [hazard, setHazard] = useState<Hazard>('flood');
  const [center, setCenter] = useState<[number, number]>([40, -3]);
  const [zoom, setZoom] = useState(13);
  const [states, setStates] = useState<Record<string, LayerState>>({});
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState<PointResponse | null>(null);
  const [homeResult, setHomeResult] = useState<PointResponse | null>(null);
  const [pointError, setPointError] = useState('');
  const [querying, setQuerying] = useState(false);
  const [drag, setDrag] = useState<[number, number]>([0, 0]);
  const dragStart = useRef<[number, number] | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  const pointRequest = useRef(0);
  const latest = useRef({ onPoint, point, municipality, provinceCode, hazard });
  latest.current = { onPoint, point, municipality, provinceCode, hazard };
  const config = hazards.find(item => item.id === hazard)!;
  const bounds = mapBounds(center[0], center[1], zoom).map(n => n.toFixed(2)).join(',');
  const layers: MapLayerId[] = catalog ? ['base', ...config.layers.filter(id => catalog.layers.find(layer => layer.id === id)?.available)] : [];

  const queryPoint = async (lat: number, lon: number, auto: boolean) => {
    const id = ++pointRequest.current;
    setQuerying(true); setPointError(''); setResult(null);
    try {
      const body = await fetchPoint(lat, lon);
      if (id !== pointRequest.current) return;
      setResult(body);
      if (auto) {
        setHomeResult(body);
        latest.current.onPoint(toPointCheck(body, latest.current.municipality, latest.current.provinceCode), true);
      }
    } catch (cause) {
      if (id === pointRequest.current) setPointError(cause instanceof Error ? cause.message : 'No se ha podido consultar el punto. No se ha evaluado ningún peligro.');
    } finally { if (id === pointRequest.current) setQuerying(false); }
  };

  useEffect(() => {
    const requestId = ++request.current;
    pointRequest.current += 1;
    setLocation(null); setError(''); setNotice(''); setResult(null); setHomeResult(null); setPointError(''); setQuerying(false);
    if (!municipalityCode || !provinceCode) { setBusy(false); return; }
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const [locationResponse, nextCatalog] = await Promise.all([
          apiFetch('/api/maps/location', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ municipality, municipalityCode, provinceCode }), signal: AbortSignal.timeout(16000) }),
          getCatalog(),
        ]);
        const found = await locationResponse.json();
        if (!locationResponse.ok) throw new Error(typeof found.error === 'string' ? found.error : 'No se ha podido localizar el municipio.');
        if (request.current !== requestId) return;
        const current = hazards.find(item => item.id === latest.current.hazard)!;
        setCatalog(nextCatalog); setLocation(found); setStates({});
        setCenter(home ? [home.lat, home.lon] : [found.lat, found.lon]); setZoom(home ? current.zoom : current.townZoom);
        if (home) {
          const stored = latest.current.point;
          if (stored?.seismic && stored.provinceCode === provinceCode && near(stored, home)) { setResult(stored); setHomeResult(stored); }
          else void queryPoint(home.lat, home.lon, true);
        }
      } catch (cause) {
        if (request.current === requestId) setError(cause instanceof Error ? cause.message : 'No se ha podido cargar el mapa.');
      } finally { if (request.current === requestId) setBusy(false); }
    }, 120);
    return () => window.clearTimeout(timer);
    // `municipality` follows `municipalityCode`; the effect only restarts when the validated place changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [municipalityCode, provinceCode, home?.lat, home?.lon]);

  const imageUrl = (id: MapLayerId) => layerImageUrl(id, bounds, MAP_WIDTH, MAP_HEIGHT, catalog!);
  const imageState = (id: MapLayerId) => states[imageUrl(id)] ?? 'loading';
  const focus = result ?? home ?? location;
  const selectHazard = (next: Hazard) => {
    const item = hazards.find(entry => entry.id === next)!;
    setHazard(next);
    if (focus) setCenter([focus.lat, focus.lon]);
    setZoom(result || home ? item.zoom : item.townZoom);
  };
  const pointFromScreen = (clientX: number, clientY: number) => {
    const box = container.current!.getBoundingClientRect();
    const [x, y] = project(center[0], center[1]);
    return unproject(x + ((clientX - box.left) / box.width - .5) * MAP_WIDTH * metersPerPixel(zoom), y - ((clientY - box.top) / box.height - .5) * MAP_HEIGHT * metersPerPixel(zoom));
  };
  const useGps = () => {
    if (!navigator.geolocation) { setPointError('Este navegador no dispone de geolocalización. Pulsa sobre el mapa para marcar tu vivienda.'); return; }
    setQuerying(true); setPointError('');
    navigator.geolocation.getCurrentPosition(position => {
      const { latitude, longitude } = position.coords;
      setCenter([latitude, longitude]);
      void queryPoint(latitude, longitude, false);
    }, () => { setQuerying(false); setPointError('No se ha podido obtener tu posición. Pulsa sobre el mapa para marcar tu vivienda.'); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };
  const backHome = () => {
    if (!home) return;
    setCenter([home.lat, home.lon]); setZoom(config.zoom);
    if (homeResult) { pointRequest.current += 1; setQuerying(false); setPointError(''); setResult(homeResult); }
    else void queryPoint(home.lat, home.lon, true);
  };
  const move = (dx: number, dy: number) => {
    const [x, y] = project(center[0], center[1]);
    const [lat, lon] = unproject(x - dx * metersPerPixel(zoom), y + dy * metersPerPixel(zoom));
    if (lat < 26 || lat > 45 || lon < -20 || lon > 6) { setNotice('El mapa está limitado al entorno de España.'); return; }
    setCenter([lat, lon]);
  };
  const downloadImage = async () => {
    if (!focus || !location) return;
    setRendering(true); setNotice('');
    try {
      const snapshot = await renderHazardSnapshot({ lat: focus.lat, lon: focus.lon, marker: Boolean(result), municipality: location.municipality, provinceCode: location.provinceCode, point: result ? toPointCheck(result, municipality, provinceCode) : null });
      const link = document.createElement('a');
      link.href = snapshot.dataUrl; link.download = 'a-salvo-peligros-de-mi-zona.png'; link.hidden = true;
      document.body.append(link); link.click(); link.remove();
      setNotice('Mapa descargado. El PDF de tu guía incluye también estos tres mapas.');
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'No se ha podido exportar el mapa.'); }
    finally { setRendering(false); }
  };

  if (!municipalityCode || !provinceCode) {
    return compact ? null : <div className="zone-map"><div className="map-placeholder"><MapPin size={32} strokeWidth={1.4} /><h3>Escribe tu municipio y tu dirección.</h3><p className="muted">El mapa de inundaciones, incendios y terremotos se genera automáticamente y sitúa tu vivienda. Una zona sin datos nunca se presenta como segura.</p></div></div>;
  }
  const loading = layers.some(id => imageState(id) === 'loading');
  const failed = layers.filter(id => imageState(id) === 'error');
  const unavailable = catalog ? config.layers.filter(id => !catalog.layers.find(layer => layer.id === id)?.available) : [];
  const toScreen = (lat: number, lon: number) => {
    const [x, y] = project(lat, lon);
    const [cx, cy] = project(center[0], center[1]);
    return { left: `${50 + (x - cx) / metersPerPixel(zoom) / MAP_WIDTH * 100}%`, top: `${50 - (y - cy) / metersPerPixel(zoom) / MAP_HEIGHT * 100}%` };
  };
  const atHome = Boolean(result && home && near(result, home));
  const attached = Boolean(result && point && point.lat === result.lat && point.lon === result.lon && point.checkedAt === result.checkedAt);
  const floodHit = result ? [result.flood100, result.flood500].find(r => r.status === 'inside' && r.river) : undefined;
  const seismic = result?.seismic;
  const layerInfo = catalog?.layers.find(layer => layer.id === config.layers[config.layers.length - 1]);

  const legend = catalog && <section className="card map-legend" aria-label={`Leyenda: ${config.label}`}>
    <h3><config.Icon size={16} />{hazard === 'flood' ? 'Zonas inundables' : hazard === 'fire' ? 'Peligro meteorológico de incendio' : 'Peligrosidad sísmica'}</h3>
    {hazard === 'flood' && <ul className="fwi-legend"><li><i style={{ background: FLOOD_COLORS.flood100 }} />T100 · 1 % de probabilidad anual</li><li><i style={{ background: FLOOD_COLORS.flood500 }} />T500 · 0,2 % de probabilidad anual</li></ul>}
    {hazard === 'fire' && <><ul className="fwi-legend">{FIRE_LEGEND.map(([label, color]) => <li key={label}><i style={{ background: color }} />{label}</li>)}</ul><p className="muted small">FWI del {layerInfo?.date ?? 'día'} (UTC). Resolución ≈ 8 km.</p></>}
    {hazard === 'seismic' && <><ul className="fwi-legend">{Object.values(EMS_DEGREES).map(degree => <li key={degree.roman}><i style={{ background: degree.color }} />{degree.roman} · {degree.name}</li>)}</ul><p className="muted small">Intensidad EMS-98 con un 10 % de probabilidad de superarse en 50 años (periodo de retorno de 475 años).</p></>}
    {layerInfo && <a className="text-link small" href={layerInfo.sourceUrl} target="_blank" rel="noreferrer">{layerInfo.attribution} <ExternalLink size={11} /></a>}
  </section>;

  const pointCard = <section className="card point-result" aria-live="polite" aria-label="Peligros en tu punto">
    <h3><Home size={16} />{result ? atHome ? 'Tu dirección' : 'Punto marcado' : home ? 'Tu dirección' : 'Tu vivienda'}</h3>
    {home && (atHome || !result) && <p className="small"><strong>{home.label}</strong>{home.postalCode ? ` · ${home.postalCode}` : ''} · {municipality}</p>}
    {querying && <p className="muted small"><LoaderCircle size={14} className="spin" /> Consultando SNCZI, EFFIS e IGN en tu punto…</p>}
    {pointError && <p className="form-error">{pointError}</p>}
    {!result && !querying && !pointError && !home && <p className="muted small">Añade tu calle y número, o pulsa sobre el mapa donde está tu vivienda. Consultaremos las capas oficiales en ese punto exacto.</p>}
    {result && <>
      <dl className={`point-grid ${compact ? 'four' : 'compact'}`}>
        <div className={result.flood100.status}><dt><Waves size={14} />Inundación T100</dt><dd>{floodLabel(result.flood100)}</dd></div>
        <div className={result.flood500.status}><dt><Waves size={14} />Inundación T500</dt><dd>{floodLabel(result.flood500)}</dd></div>
        <div className={result.fwi ? fwiClass(result.fwi.className) : 'unknown'}><dt><Flame size={14} />Incendio · FWI {result.fwi?.date ?? 'hoy'}</dt><dd>{result.fwi ? `${result.fwi.value.toFixed(1)} · ${result.fwi.className}` : 'Sin datos de EFFIS'}</dd></div>
        <div className={seismic?.status === 'ok' && (seismic.intensity ?? 0) >= 6 ? 'quake-damage' : seismic?.status === 'ok' ? '' : 'unknown'}><dt><Mountain size={14} />Terremoto · IGN</dt><dd>{seismic?.status === 'ok' && seismic.intensity !== undefined ? `Intensidad ${emsLabel(seismic.intensity)}` : 'Sin datos del IGN'}{seismic?.pga !== undefined && <small> · {seismic.pga.toFixed(2).replace('.', ',')} g</small>}</dd></div>
      </dl>
      {floodHit && <p className="small point-study"><strong>{floodHit.river}</strong>{floodHit.study ? ` · ${floodHit.study}` : ''}{floodHit.approved ? ` · aprobado ${floodHit.approved}` : ''}</p>}
      {!compact && result.fwi?.components && <p className="muted small">FWI adimensional, no un porcentaje. FFMC {result.fwi.components.FFMC?.toFixed(1)} · DMC {result.fwi.components.DMC?.toFixed(1)} · DC {result.fwi.components.DC?.toFixed(1)} · ISI {result.fwi.components.ISI?.toFixed(1)} · BUI {result.fwi.components.BUI?.toFixed(1)}.</p>}
      <p className="muted small">{atHome ? (attached ? 'Incorporado automáticamente a tu plan. ' : '') : 'Comprueba que el punto corresponde a tu vivienda. '}«Fuera» o «sin datos» no significa sin riesgo.</p>
      <div className="point-actions">
        {!atHome && <button type="button" className="button primary" disabled={attached} onClick={() => latest.current.onPoint(toPointCheck(result, municipality, provinceCode), false)}>{attached ? <><Check size={16} />Incorporado a mi plan</> : 'Usar este punto en mi plan'}</button>}
        {home && !atHome && <button type="button" className="button ghost" onClick={backHome}><RotateCcw size={15} />Volver a mi dirección</button>}
      </div>
    </>}
  </section>;

  return <div className={`zone-map${compact ? ' compact' : ''}`}>
    {!compact && <div className="map-load-row"><div><h2>Peligros oficiales en tu zona</h2><p className="muted small">{home ? `Centrado en ${home.label} (CartoCiudad, IGN).` : 'Centrado en tu municipio. Añade tu calle y número para situar tu vivienda.'}</p></div>{location && <button className="button secondary" onClick={() => void downloadImage()} disabled={rendering || busy}>{rendering ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}Descargar mapa</button>}</div>}
    {error && <div className="note warn" role="alert"><Info size={18} /><p>{error} No se ha evaluado el riesgo. Consulta los visores oficiales.</p></div>}
    {busy && !location && <div className="map-placeholder loading" role="status"><LoaderCircle size={26} className="spin" /><h3>Generando el mapa de tu zona…</h3><p className="muted small">Consultando CartoCiudad, SNCZI, EFFIS e IGN.</p></div>}
    {location && catalog && <>
      <div className="map-toolbar">
        <div className="hazard-tabs" role="tablist" aria-label="Peligro que se muestra en el mapa">{hazards.map(item => <button type="button" role="tab" key={item.id} aria-selected={hazard === item.id} className={hazard === item.id ? 'active' : ''} onClick={() => selectHazard(item.id)}><item.Icon size={15} />{item.label}{result && <em>{tabSummary(item.id, result)}</em>}</button>)}</div>
        {!compact && <div className="map-toolbar-actions"><button className="text-link" onClick={useGps} disabled={querying}><LocateFixed size={14} />Usar mi posición</button>{!home && <button className="text-link" onClick={() => { setCenter([location.lat, location.lon]); setZoom(config.townZoom); }}><RotateCcw size={14} />Centro de {location.municipality}</button>}</div>}
      </div>
      <div className="map-layout">
        <div className="map-main">
          <div className="map-canvas" ref={container} role="region" aria-label={`Mapa de ${config.label.toLowerCase()} centrado en ${home ? 'tu dirección' : location.municipality}. Pulsa para consultar otro punto, arrastra para desplazar o usa las flechas del teclado.`} tabIndex={0}
            onPointerDown={event => { if (event.button !== 0 || (event.target instanceof Element && event.target.closest('button,a'))) return; dragStart.current = [event.clientX, event.clientY]; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerMove={event => { if (dragStart.current) setDrag([event.clientX - dragStart.current[0], event.clientY - dragStart.current[1]]); }}
            onPointerUp={event => { if (!dragStart.current) return; const dx = event.clientX - dragStart.current[0]; const dy = event.clientY - dragStart.current[1]; if (Math.hypot(dx, dy) < 4) { const [lat, lon] = pointFromScreen(event.clientX, event.clientY); void queryPoint(lat, lon, false); } else { const scale = MAP_WIDTH / event.currentTarget.getBoundingClientRect().width; move(dx * scale, dy * scale); } dragStart.current = null; setDrag([0, 0]); }}
            onPointerCancel={() => { dragStart.current = null; setDrag([0, 0]); }}
            onKeyDown={event => { const deltas: Record<string, [number, number]> = { ArrowLeft: [150, 0], ArrowRight: [-150, 0], ArrowUp: [0, 150], ArrowDown: [0, -150] }; if (deltas[event.key]) { event.preventDefault(); move(...deltas[event.key]); } if (event.key === 'Enter') { event.preventDefault(); void queryPoint(center[0], center[1], false); } }}>
            <div className="map-image-stack" style={{ transform: `translate(${drag[0]}px, ${drag[1]}px)` }}>
              {layers.map(id => <img key={imageUrl(id)} src={imageUrl(id)} draggable={false} alt="" aria-hidden="true" className={`map-image map-image-${id}`} onLoad={() => setStates(current => ({ ...current, [imageUrl(id)]: 'ready' }))} onError={() => setStates(current => ({ ...current, [imageUrl(id)]: 'error' }))} />)}
              {!home && <div className="map-marker town" style={toScreen(location.lat, location.lon)}><span>Centro municipal</span></div>}
              {home && !atHome && <div className="map-marker home ghost" style={toScreen(home.lat, home.lon)}><Home size={12} /></div>}
              {(result || home) && <div className="map-marker home" style={toScreen((result ?? home)!.lat, (result ?? home)!.lon)}><Home size={14} /><span>{result && !atHome ? 'Punto marcado' : 'Tu dirección'}</span></div>}
            </div>
            <div className="map-zoom"><button type="button" aria-label="Acercar mapa" onClick={() => setZoom(z => Math.min(16, z + 1))} disabled={zoom >= 16}><Plus size={18} /></button><button type="button" aria-label="Alejar mapa" onClick={() => setZoom(z => Math.max(6, z - 1))} disabled={zoom <= 6}><Minus size={18} /></button></div>
            {loading && <div className="map-loading" role="status"><LoaderCircle size={14} className="spin" />Cargando {config.label.toLowerCase()}…</div>}
            {!result && !querying && !home && <div className="map-hint">Pulsa sobre tu vivienda</div>}
            <div className="map-attribution">IGN · {config.source}</div>
            <div className="map-scale"><span style={{ width: '70px' }} />{(metersPerPixel(zoom) * 70 * Math.cos(center[0] * Math.PI / 180) * MAP_WIDTH / (container.current?.clientWidth || MAP_WIDTH) / 1000).toFixed(2)} km</div>
          </div>
          {(failed.length > 0 || unavailable.length > 0) && <div className="note warn" role="alert"><Info size={18} /><p>No se ha podido representar {[...failed, ...unavailable].map(id => catalog.layers.find(layer => layer.id === id)?.title).filter(Boolean).join(', ') || 'una capa'}. Su ausencia NO significa ausencia de peligro.</p></div>}
          {compact && pointCard}
          {compact && legend}
          <p className="muted small">Tu dirección se consulta (redondeada a unos 10 m) en el SNCZI, EFFIS y el IGN. No se guarda en ningún servidor.</p>
        </div>
        {!compact && <aside className="map-side" aria-label="Resultado y leyenda">{pointCard}{legend}</aside>}
      </div>
      {!compact && <div className="note warn"><Info size={18} /><p><strong>Sin color no significa sin riesgo.</strong> El SNCZI solo representa las áreas estudiadas; las inundaciones pluviales, costeras o de barrancos no cartografiados pueden no estar incluidas. El FWI y la peligrosidad sísmica tienen escala regional, no de parcela.</p></div>}
    </>}
    {notice && <div className="note" role="status"><Info size={17} /><p>{notice}</p></div>}
    {!compact && <section className="section map-methodology"><div className="section-head"><h2>Qué calculan estos mapas</h2></div><div className="method-grid three">
      <article><span className="risk-icon blue"><Waves size={18} /></span><h3>Inundación: cartografía SNCZI</h3><p>Zonas inundables delimitadas por estudios hidrológicos e hidráulicos oficiales y publicadas por el MITECO. No deducimos inundabilidad a partir de la altura del terreno. <strong>T100 y T500 no son un calendario</strong>: son probabilidades anuales de excedencia del 1 % y del 0,2 %.</p><a className="text-link" href="https://www.miteco.gob.es/es/agua/temas/gestion-de-los-riesgos-de-inundacion/snczi.html" target="_blank" rel="noreferrer">Metodología SNCZI <ExternalLink size={13} /></a></article>
      <article><span className="risk-icon orange"><Flame size={18} /></span><h3>Incendio: método científico FWI</h3><p>El Fire Weather Index canadiense combina temperatura, humedad, viento y precipitación con la humedad del combustible (FFMC, DMC, DC → ISI, BUI → FWI). Mostramos el cálculo oficial de Copernicus/EFFIS. <strong>No es una probabilidad de ignición</strong> ni modela la vegetación o la vulnerabilidad de una vivienda.</p><a className="text-link" href="https://forest-fire.emergency.copernicus.eu/about-effis/technical-background/fire-danger-forecast" target="_blank" rel="noreferrer">Método EFFIS <ExternalLink size={13} /></a></article>
      <article><span className="risk-icon purple"><Mountain size={18} /></span><h3>Terremoto: peligrosidad sísmica IGN</h3><p>Mapa probabilista del Instituto Geográfico Nacional (2015): intensidad EMS-98 y aceleración en roca que tienen un <strong>10 % de probabilidad de superarse en 50 años</strong> (periodo de retorno de 475 años). A partir del grado VI la escala describe daños en edificios. No predice terremotos ni evalúa tu edificio.</p><a className="text-link" href="https://www.ign.es/web/mapas-sismicidad" target="_blank" rel="noreferrer">Mapas de peligrosidad del IGN <ExternalLink size={13} /></a><a className="text-link" href={EMS_SCALE_URL} target="_blank" rel="noreferrer">Escala EMS-98 <ExternalLink size={13} /></a></article>
    </div></section>}
  </div>;
}
