import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';

export type FieldStatus = { tone: 'ok' | 'error' | 'info' | 'busy'; text: ReactNode } | null;

/** Accessible combobox (WAI-ARIA 1.2 list autocomplete) that fetches suggestions while the user types. */
export function Autocomplete<T>({ label, value, onText, onPick, search, minChars = 2, render, keyOf, placeholder, disabled, verified, status, hint, inputProps }: {
  label: string; value: string; onText: (text: string) => void; onPick: (item: T) => void;
  search: (query: string, signal: AbortSignal) => Promise<T[]>; minChars?: number;
  render: (item: T) => ReactNode; keyOf: (item: T) => string; placeholder?: string; disabled?: boolean;
  verified: boolean; status?: FieldStatus; hint?: ReactNode; inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const id = useId();
  const [items, setItems] = useState<T[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState('');
  const typed = useRef(false);
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    if (!typed.current || verified) return;
    const query = value.trim();
    if (query.length < minChars) { setItems([]); setOpen(false); setSearched(''); setError(''); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = window.setTimeout(async () => {
      try {
        const found = await searchRef.current(query, controller.signal);
        if (controller.signal.aborted) return;
        setItems(found); setActive(found.length ? 0 : -1); setOpen(true); setSearched(query);
      } catch (cause) {
        if (controller.signal.aborted) return;
        setItems([]); setOpen(false); setError(cause instanceof Error ? cause.message : 'No se ha podido buscar.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 220);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [value, verified, minChars]);

  const pick = (item: T) => { typed.current = false; setOpen(false); setItems([]); setActive(-1); onPick(item); };
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const noResults = open && !loading && searched && !items.length;
  const shown: FieldStatus = loading ? { tone: 'busy', text: 'Buscando…' }
    : error ? { tone: 'error', text: `${error} Inténtalo de nuevo.` }
    : noResults ? { tone: 'error', text: <>No encontramos «{searched}». Revisa la ortografía.</> }
    : status ?? null;

  return <div className={`field autocomplete ${verified ? 'verified' : ''}`}>
    <label htmlFor={`${id}-input`}><span>{label}</span></label>
    <div className="autocomplete-box">
      <input id={`${id}-input`} value={value} disabled={disabled} placeholder={placeholder} autoComplete="off" spellCheck={false}
        role="combobox" aria-expanded={open && items.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined} aria-invalid={shown?.tone === 'error' || undefined}
        aria-describedby={`${id}-status`}
        onChange={event => { typed.current = true; onText(event.target.value); }}
        onFocus={() => { if (items.length && !verified) setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' && items.length) { event.preventDefault(); setOpen(true); setActive(i => (i + 1) % items.length); }
          else if (event.key === 'ArrowUp' && items.length) { event.preventDefault(); setOpen(true); setActive(i => (i - 1 + items.length) % items.length); }
          else if (event.key === 'Enter' && open && active >= 0 && items[active]) { event.preventDefault(); pick(items[active]); }
          else if (event.key === 'Escape' && open) { event.preventDefault(); setOpen(false); }
        }} {...inputProps} />
      <span className="autocomplete-icon" aria-hidden="true">{loading ? <LoaderCircle size={16} className="spin" /> : verified ? <CheckCircle2 size={17} /> : null}</span>
      {open && items.length > 0 && <ul id={listId} role="listbox" aria-label={`Sugerencias: ${label.toLowerCase()}`} className="autocomplete-list">
        {items.map((item, i) => <li key={keyOf(item)} id={optionId(i)} role="option" aria-selected={i === active}
          className={i === active ? 'active' : ''} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(item)}>{render(item)}</li>)}
      </ul>}
    </div>
    <p id={`${id}-status`} className={`field-status ${shown?.tone ?? ''}`} aria-live="polite">
      {shown ? <>{shown.tone === 'ok' ? <CheckCircle2 size={14} /> : shown.tone === 'error' ? <AlertCircle size={14} /> : shown.tone === 'busy' ? <LoaderCircle size={14} className="spin" /> : null}<span>{shown.text}</span></> : hint}
    </p>
  </div>;
}
