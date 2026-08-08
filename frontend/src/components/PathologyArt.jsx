

const SEGMENTS_SEP = [
  { cx: 18, cy: 78, atteint: false },
  { cx: 46, cy: 46, atteint: false },
  { cx: 74, cy: 84, atteint: true },
  { cx: 130, cy: 84, atteint: true },
  { cx: 158, cy: 46, atteint: false },
  { cx: 186, cy: 78, atteint: false },
  { cx: 214, cy: 50, atteint: false },
];


export function ArtSEP({ className }) {
  return (
    <svg className={className} viewBox="0 0 240 130" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M10 65 C 60 30, 90 100, 140 65 S 210 30, 230 65"
        stroke="var(--teal)" strokeWidth="2.5" strokeLinecap="round" opacity="0.45"
      />
      {SEGMENTS_SEP.map(({ cx, cy, atteint }) => (
        <ellipse
          key={cx}
          cx={cx} cy={cy} rx="13" ry="8"
          fill={atteint ? 'var(--card)' : 'var(--teal-tint)'}
          stroke={atteint ? 'var(--error)' : 'var(--teal)'}
          strokeWidth={atteint ? 1.4 : 1.6}
          strokeDasharray={atteint ? '3 3' : undefined}
        />
      ))}
      <path
        d="M20 112 L60 108 L100 100 L140 92 L180 78 L220 60"
        stroke="var(--slate-soft)" strokeWidth="1.4" strokeDasharray="2 4" opacity="0.6"
      />
    </svg>
  );
}


export function ArtEPR({ className }) {
  return (
    <svg className={className} viewBox="0 0 240 130" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M70 40 C55 30 40 40 38 55 C25 58 22 78 32 88 C30 100 42 112 58 108
           C64 116 78 118 88 110 C100 118 116 112 118 100
           C132 102 142 90 138 76 C148 68 146 50 132 44
           C132 30 116 22 102 28 C92 20 76 24 70 40 Z"
        stroke="var(--violet)" strokeWidth="2" opacity="0.5" strokeLinejoin="round"
      />
      <path
        d="M18 70 L55 70 L64 50 L74 90 L84 62 L92 70 L108 70 L116 40 L124 96 L132 70 L222 70"
        stroke="var(--violet)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
