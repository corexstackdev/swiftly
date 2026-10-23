/**
 * Palette thumbnails.
 *
 * Each one is a schematic of the widget's real structure rather than an icon of a
 * metaphor — a table shows a header row over body rows, a form shows fields over
 * buttons — so the shape is recognisable before the label is read.
 *
 * Two rules carry meaning rather than decoration:
 *   - a dashed outline means the widget accepts children, so drop targets are
 *     identifiable at a glance;
 *   - the accent colour marks the one active element (a primary button, a selected
 *     tab, a table's header), while grey blocks are inert content.
 */

const ACCENT = 'var(--wt-accent, #e15615)';
const MUTED = 'var(--wt-muted, #cbd5e1)';

function Frame({ children, dashed = false }: { children?: React.ReactNode; dashed?: boolean }) {
  return (
    <svg width="44" height="30" viewBox="0 0 44 30" fill="none" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="42"
        height="28"
        rx="2.5"
        stroke={ACCENT}
        strokeWidth="1.4"
        strokeDasharray={dashed ? '3 2.5' : undefined}
      />
      {children}
    </svg>
  );
}

/** Bare marks with no surrounding frame, for widgets that are not box-shaped. */
function Bare({ children }: { children: React.ReactNode }) {
  return (
    <svg width="44" height="30" viewBox="0 0 44 30" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

const bar = (x: number, y: number, w: number, h = 3, fill = MUTED) => (
  <rect x={x} y={y} width={w} height={h} rx={1.5} fill={fill} />
);

export const THUMBNAILS: Record<string, React.ReactNode> = {
  /* ---- layout ---- */
  container: <Frame dashed>{null}</Frame>,

  grid: (
    <svg width="44" height="30" viewBox="0 0 44 30" fill="none" aria-hidden="true">
      <rect
        x="1"
        y="1"
        width="42"
        height="28"
        rx="2.5"
        stroke={ACCENT}
        strokeWidth="1.4"
        strokeDasharray="3 2.5"
      />
      <path d="M15.3 2v26M28.7 2v26M1 15h42" stroke={ACCENT} strokeWidth="1" opacity="0.65" />
    </svg>
  ),

  modal: (
    <Bare>
      <rect x="4" y="3" width="36" height="24" rx="2.5" fill="#ffffff" stroke={MUTED} strokeWidth="1" />
      <rect x="4" y="3" width="36" height="24" rx="2.5" stroke={ACCENT} strokeWidth="1.4" />
      <path d="M33 8l4 4m0-4l-4 4" stroke={ACCENT} strokeWidth="1.3" strokeLinecap="round" />
      {bar(9, 16, 18)}
      {bar(9, 21, 12)}
    </Bare>
  ),

  tabs: (
    <Bare>
      <path d="M2 10h12V4a1 1 0 011-1h0a1 1 0 011 1v6" stroke={ACCENT} strokeWidth="1.4" />
      <rect x="3" y="4" width="12" height="6" rx="1.5" fill={ACCENT} />
      <rect x="17" y="5" width="11" height="5" rx="1.5" fill={MUTED} />
      <path d="M2 11h40" stroke={ACCENT} strokeWidth="1.4" />
      {bar(3, 16, 22)}
      {bar(3, 22, 14)}
    </Bare>
  ),

  divider: (
    <Bare>
      {bar(6, 8, 32, 2.5)}
      <path d="M2 15h40" stroke={ACCENT} strokeWidth="1.6" />
      {bar(6, 20, 24, 2.5)}
    </Bare>
  ),

  navbar: (
    <Bare>
      <rect x="1" y="4" width="42" height="10" rx="2" stroke={ACCENT} strokeWidth="1.4" strokeDasharray="3 2.5" />
      <rect x="4" y="6.5" width="8" height="5" rx="1" fill={ACCENT} />
      {bar(16, 8, 6, 2.5)}
      {bar(24, 8, 6, 2.5)}
      {bar(32, 8, 7, 2.5, ACCENT)}
      {bar(4, 20, 18)}
      {bar(4, 25, 12)}
    </Bare>
  ),

  nav_link: (
    <Bare>
      {bar(8, 13, 18, 4, ACCENT)}
      <path d="M30 11v8M28 11h4M28 19h4" stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round" />
    </Bare>
  ),

  nav_menu: (
    <Bare>
      {bar(8, 6, 16, 4, ACCENT)}
      <path d="M27 7.5l3 3 3-3" stroke={ACCENT} strokeWidth="1.3" strokeLinecap="round" />
      <rect x="10" y="13" width="24" height="14" rx="2" stroke={ACCENT} strokeWidth="1.3" />
      {bar(14, 16, 16, 2.5)}
      {bar(14, 21, 12, 2.5)}
    </Bare>
  ),

  /* ---- inputs ---- */
  input: (
    <Frame>
      <path d="M8 11v8M6 11h4M6 19h4" stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round" />
      {bar(14, 14, 20)}
    </Frame>
  ),

  select: (
    <Frame>
      {bar(7, 14, 22)}
      <path d="M33 13l3 3 3-3" stroke={ACCENT} strokeWidth="1.4" strokeLinecap="round" />
    </Frame>
  ),

  number_input: (
    <Frame>
      <text x="7" y="19" fill={ACCENT} fontSize="10" fontFamily="monospace">
        123
      </text>
      <path d="M32 18v-6m-3 3l3-3 3 3" stroke={ACCENT} strokeWidth="1.2" strokeLinecap="round" />
    </Frame>
  ),

  currency_input: (
    <Frame>
      <text x="8" y="20" fill={ACCENT} fontSize="13" fontFamily="Georgia, serif">
        $
      </text>
      {bar(18, 14, 16)}
    </Frame>
  ),

  date_picker: (
    <Frame>
      <path d="M1 10h42M11 1v5M33 1v5" stroke={ACCENT} strokeWidth="1.2" />
      {bar(7, 15, 5, 3)}
      {bar(16, 15, 5, 3)}
      {bar(25, 15, 5, 3)}
      <rect x="7" y="21" width="5" height="3" rx="1.5" fill={ACCENT} />
      {bar(16, 21, 5, 3)}
    </Frame>
  ),

  checkbox: (
    <Bare>
      <rect x="6" y="11" width="9" height="9" rx="2" stroke={ACCENT} strokeWidth="1.4" />
      <path d="M8.5 15.5l2 2 3.5-4" stroke={ACCENT} strokeWidth="1.5" strokeLinecap="round" />
      {bar(19, 14, 18)}
    </Bare>
  ),

  checkbox_group: (
    <Bare>
      <rect x="6" y="5" width="8" height="8" rx="2" stroke={ACCENT} strokeWidth="1.3" />
      <path d="M8 9l1.8 1.8L12.2 7.5" stroke={ACCENT} strokeWidth="1.4" strokeLinecap="round" />
      {bar(18, 7.5, 18)}
      <rect x="6" y="17" width="8" height="8" rx="2" stroke={MUTED} strokeWidth="1.3" />
      {bar(18, 19.5, 14)}
    </Bare>
  ),

  radio_group: (
    <Bare>
      <circle cx="10" cy="9" r="4.5" stroke={ACCENT} strokeWidth="1.3" />
      <circle cx="10" cy="9" r="2" fill={ACCENT} />
      {bar(18, 7.5, 18)}
      <circle cx="10" cy="21" r="4.5" stroke={MUTED} strokeWidth="1.3" />
      {bar(18, 19.5, 14)}
    </Bare>
  ),

  switch: (
    <Bare>
      {bar(4, 13, 14)}
      <rect x="22" y="10" width="17" height="10" rx="5" stroke={ACCENT} strokeWidth="1.4" />
      <circle cx="34" cy="15" r="3.2" fill={ACCENT} />
    </Bare>
  ),

  slider: (
    <Bare>
      <rect x="4" y="13.5" width="36" height="3" rx="1.5" fill={MUTED} />
      <rect x="4" y="13.5" width="18" height="3" rx="1.5" fill={ACCENT} />
      <circle cx="22" cy="15" r="4.5" fill="#ffffff" stroke={ACCENT} strokeWidth="1.5" />
    </Bare>
  ),

  form: (
    <Frame dashed>
      {bar(6, 6, 14, 2)}
      {bar(6, 10, 28, 3)}
      {bar(6, 16, 20, 3)}
      <rect x="22" y="22" width="16" height="4.5" rx="1.2" fill={ACCENT} />
    </Frame>
  ),

  /* ---- buttons ---- */
  button: (
    <Bare>
      <rect x="6" y="9" width="32" height="12" rx="3" stroke={ACCENT} strokeWidth="1.5" />
      {bar(15, 14, 14, 3, ACCENT)}
    </Bare>
  ),

  icon_button: (
    <Bare>
      <rect x="15" y="8" width="14" height="14" rx="3" stroke={ACCENT} strokeWidth="1.5" />
      <path d="M22 12v6M19 15h6" stroke={ACCENT} strokeWidth="1.5" strokeLinecap="round" />
    </Bare>
  ),

  /* ---- display ---- */
  text: (
    <Bare>
      <path d="M13 8h18M22 8v15" stroke={ACCENT} strokeWidth="1.8" strokeLinecap="round" />
    </Bare>
  ),

  table: (
    <Bare>
      <rect x="2" y="4" width="40" height="22" rx="2" stroke={ACCENT} strokeWidth="1.4" />
      <rect x="2.7" y="4.7" width="38.6" height="6" fill={ACCENT} fillOpacity="0.18" />
      <path d="M2 10.7h40M16 4.7V26M29 4.7V26M2 18h40" stroke={ACCENT} strokeWidth="1" />
    </Bare>
  ),

  list: (
    <Bare>
      <rect x="2" y="4" width="40" height="22" rx="2" stroke={ACCENT} strokeWidth="1.4" />
      {/* A checkbox, a thumbnail, and two lines of text — the shape of one item. */}
      <rect x="5" y="8" width="3.4" height="3.4" rx="0.6" stroke={ACCENT} strokeWidth="1" />
      <rect x="11" y="7" width="6" height="6" rx="1.2" fill={ACCENT} fillOpacity="0.25" />
      {bar(19.5, 7.6, 18, 2)}
      {bar(19.5, 11, 12, 1.4)}
      <rect x="5" y="18" width="3.4" height="3.4" rx="0.6" stroke={ACCENT} strokeWidth="1" />
      <rect x="11" y="17" width="6" height="6" rx="1.2" fill={ACCENT} fillOpacity="0.25" />
      {bar(19.5, 17.6, 18, 2)}
      {bar(19.5, 21, 9, 1.4)}
    </Bare>
  ),

  stats_box: (
    <Bare>
      {bar(6, 5, 14, 2.5)}
      <text x="6" y="20" fill={ACCENT} fontSize="11" fontFamily="monospace">
        123
      </text>
      <path d="M31 17l5-5m0 0h-4m4 0v4" stroke={ACCENT} strokeWidth="1.4" strokeLinecap="round" />
    </Bare>
  ),

  chart: (
    <Bare>
      <rect x="7" y="13" width="7" height="13" rx="1.5" fill={ACCENT} />
      <rect x="18" y="6" width="7" height="20" rx="1.5" fill={MUTED} />
      <rect x="29" y="17" width="7" height="9" rx="1.5" fill={MUTED} />
    </Bare>
  ),

  progress: (
    <Bare>
      <rect x="4" y="10" width="36" height="9" rx="4.5" stroke={MUTED} strokeWidth="1.2" />
      <rect x="5" y="11" width="24" height="7" rx="3.5" fill={ACCENT} />
      <text x="16" y="27" fill={ACCENT} fontSize="6" fontFamily="monospace">
        61%
      </text>
    </Bare>
  ),

  rating: (
    <Bare>
      <Star x={8} fill={ACCENT} />
      <Star x={20} fill={ACCENT} />
      <Star x={32} fill={MUTED} />
    </Bare>
  ),

  image: (
    <Frame>
      <circle cx="13" cy="11" r="2.5" stroke={ACCENT} strokeWidth="1.2" />
      <path d="M4 24l9-8 7 6 5-4 15 6" stroke={ACCENT} strokeWidth="1.3" strokeLinejoin="round" />
    </Frame>
  ),

  iframe: (
    <Frame>
      <path
        d="M14 11l-4 4 4 4M30 11l4 4-4 4M25 10l-6 10"
        stroke={ACCENT}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Frame>
  ),
};

function Star({ x, fill }: { x: number; fill: string }) {
  return (
    <path
      d={`M${x} 9l1.6 3.3 3.6.5-2.6 2.5.6 3.6-3.2-1.7-3.2 1.7.6-3.6-2.6-2.5 3.6-.5z`}
      fill={fill}
    />
  );
}

/** Fallback for a type with no thumbnail yet, including tenant components. */
export function fallbackThumbnail(): React.ReactNode {
  return <Frame />;
}
