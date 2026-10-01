/** Decorative, abstract map: river flood band, vegetation patch, home pin and a plan card. */
export function HeroGraphic() {
  return <div className="hero-graphic" aria-hidden="true">
    <svg viewBox="0 0 520 480" role="presentation">
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" stroke="#F08A4B" strokeWidth="2" opacity=".55" /></pattern>
        <clipPath id="frame"><rect width="520" height="480" rx="28" /></clipPath>
      </defs>
      <g clipPath="url(#frame)">
        <rect width="520" height="480" fill="#F4F4F1" />
        {[0, 1, 2, 3, 4, 5, 6].map(i => <path key={i} d={`M-20 ${70 + i * 58} C 120 ${30 + i * 58}, 260 ${120 + i * 58}, 540 ${60 + i * 58}`} fill="none" stroke="#E4E4DE" strokeWidth="1.2" />)}
        <path d="M-10 330 C 90 300, 150 350, 240 320 S 400 250, 540 280 L 540 350 C 420 330, 330 390, 240 390 S 80 380, -10 400 Z" fill="#CFE0FF" opacity=".9" />
        <path d="M-10 360 C 90 335, 160 370, 245 352 S 410 290, 540 312" fill="none" stroke="#3B6FE0" strokeWidth="5" strokeLinecap="round" />
        <path d="M330 40 C 400 30, 480 60, 500 120 S 470 210, 400 200 S 300 150, 330 40 Z" fill="url(#hatch)" stroke="#F08A4B" strokeWidth="1.5" opacity=".9" />
        <g stroke="#D6D6CF" strokeWidth="10" strokeLinecap="round" fill="none"><path d="M60 -10 L 150 490" /><path d="M-10 190 L 530 150" /></g>
        <g transform="translate(206 176)">
          <circle r="44" fill="#151515" opacity=".06" />
          <path d="M0 -40 C 18 -40 30 -27 30 -10 C 30 12 0 38 0 38 C 0 38 -30 12 -30 -10 C -30 -27 -18 -40 0 -40 Z" fill="#151515" />
          <circle cy="-10" r="10" fill="#fff" />
        </g>
      </g>
    </svg>
    <div className="hero-card hero-card-plan"><span className="eyebrow">Tu plan</span><strong>València · 4 personas</strong><ul><li><i className="dot flood" />Planta baja: prepara cómo subir</li><li><i className="dot flood" />Garaje: no bajes si se inunda</li><li><i className="dot general" />Contacto fuera de la zona</li></ul></div>
    <div className="hero-card hero-card-map"><span><i className="legend-chip flood" />Zona inundable · SNCZI</span><span><i className="legend-chip fire" />Vegetación · peligro FWI</span></div>
  </div>;
}
