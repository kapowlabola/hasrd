import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";

/**
 * The HASRD-ous advantage
 * An interactive explainer for a wind/ballistics thesis.
 *
 * A layperson discovers — by playing — that accounting for terrain and height
 * changes how accurate a tank shot is: over open grass wind runs wild and the
 * old "one number everywhere" model is over-confident; over forest the ground
 * calms the wind and you actually hit more. The gap is widest at long range.
 *
 * Self-contained. No backend, no browser storage. All numbers hardcoded and
 * calibrated to reproduce the published thesis results (verified by Monte Carlo).
 */

// ---------------------------------------------------------------------------
// Palette (assigned roles per the brief)
// ---------------------------------------------------------------------------
const PAL = {
  canvas: "#F2EBD8",     // warm cream
  text: "#2E2C22",       // dark olive-brown
  text2: "#6E6A57",      // muted labels
  hasrd: "#41696A",      // slate-teal — the new, correct thing
  legacy: "#9E9A85",     // washed taupe — the old way, deliberately lifeless
  terra: "#A8512F",      // terracotta — what's at stake (crosswind, impacts)
  terraBright: "#C25A33",// brighter terracotta for pop on the busy screen
  grass: "#8A8E74",
  bushes: "#6B7350",
  forest: "#3A3D22",
  viewport: "#272A18",   // dark olive instrument frame
  viewportField: "#2F331E",
  reticle: "rgba(155,170,120,0.22)",
  mono: "#C9CBB0",       // monospace readout color on dark olive
};

// ---------------------------------------------------------------------------
// Calibration constants (do not drift — these reproduce the thesis table)
// ---------------------------------------------------------------------------
const A = 1.956;          // crosswind -> lateral drift gain
const SB = 1.9;           // base dispersion (m) at 3000 m
const LEGACY_SIGMA = 1.798; // fixed legacy crosswind sigma (m/s), all terrain
const REF_RANGE = 3000;   // m
const HALF = 1.15;        // half the 2.3 m target box (m)

// terrain anchors: 0 = grass, 0.5 = bushes, 1 = forest
function sigmaForTerrain(t) {
  return t <= 0.5
    ? 3.675 + (2.433 - 3.675) * (t / 0.5)
    : 2.433 + (0.654 - 2.433) * ((t - 0.5) / 0.5);
}
function terrainName(t) {
  if (t < 0.25) return "grassy field";
  if (t < 0.75) return "bushes";
  return "forest";
}

// range scaling — crosswind drift "blooms" with range
const rangeDrift = (R) => Math.pow(R / REF_RANGE, 1.8);
const rangeBase = (R) => R / REF_RANGE;

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
      0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}
// P(|N(0,s)| <= a)
const insideProb = (a, s) => (s > 0 ? erf(a / (s * Math.SQRT2)) : 1);

// analytic hit probability for a given crosswind sigma and range
function phit(sigma, R) {
  const sy = Math.sqrt(
    Math.pow(sigma * A * rangeDrift(R), 2) + Math.pow(SB * rangeBase(R), 2)
  );
  const sx = SB * rangeBase(R);
  return insideProb(HALF, sx) * insideProb(HALF, sy);
}

// seeded RNG (mulberry32) + Box-Muller normal — deterministic so the volley
// cloud morphs smoothly while dragging instead of reshuffling.
function makeRng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spare = null;
  const g = () => {
    if (spare !== null) {
      const v = spare;
      spare = null;
      return v;
    }
    const u1 = u() || 1e-9;
    const u2 = u();
    const r = Math.sqrt(-2 * Math.log(u1));
    spare = r * Math.sin(2 * Math.PI * u2);
    return r * Math.cos(2 * Math.PI * u2);
  };
  return { u, g };
}
// one unseeded normal for single shots
function gauss() {
  let u1 = Math.random() || 1e-9;
  let u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// synthesize one impact: [elevation x, lateral y] in meters
function impact(sigma, R, g) {
  const Wy = g() * sigma;
  const y = Wy * A * rangeDrift(R) + g() * SB * rangeBase(R);
  const x = g() * SB * rangeBase(R);
  return [x, y];
}

// color ramp helpers
function hexRgb(h) {
  h = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function rgbHex(a) {
  return (
    "#" +
    a
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")
      )
      .join("")
  );
}
function lerpHex(a, b, t) {
  const A = hexRgb(a),
    B = hexRgb(b);
  return rgbHex(A.map((v, i) => v + (B[i] - v) * t));
}
function terrainColor(t) {
  return t <= 0.5
    ? lerpHex(PAL.grass, PAL.bushes, t / 0.5)
    : lerpHex(PAL.bushes, PAL.forest, (t - 0.5) / 0.5);
}

const fmtPct = (p) => (p * 100).toFixed(1);
const reduceMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Small SVG primitives
// ---------------------------------------------------------------------------
function Arrow({ x1, y1, x2, y2, color, width = 2, dash, opacity = 1 }) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const h = 5 + width * 1.6;
  const ax = x2 - h * Math.cos(ang - 0.42);
  const ay = y2 - h * Math.sin(ang - 0.42);
  const bx = x2 - h * Math.cos(ang + 0.42);
  const by = y2 - h * Math.sin(ang + 0.42);
  return (
    <g opacity={opacity}>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={width}
        strokeDasharray={dash}
        strokeLinecap="round"
      />
      <polygon points={`${x2},${y2} ${ax},${ay} ${bx},${by}`} fill={color} />
    </g>
  );
}

function Swirl({ cx, cy, r = 9, color, width = 1.5 }) {
  const d = `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx} ${cy - r} A ${
    r * 0.55
  } ${r * 0.55} 0 1 0 ${cx - r * 0.35} ${cy}`;
  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      opacity={0.85}
    />
  );
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------
const STEPS = [
  "1 · The two models",
  "2 · Wind & height",
  "3 · Shooting gallery",
];
function Stepper({ screen, setScreen }) {
  return (
    <nav aria-label="Steps" style={{ display: "flex", gap: 0, marginBottom: 26 }}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const active = screen === n;
        return (
          <button
            key={n}
            onClick={() => setScreen(n)}
            aria-current={active ? "step" : undefined}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: "8px 10px 12px",
              textAlign: "left",
              color: active ? PAL.text : PAL.text2,
              fontWeight: active ? 600 : 400,
              fontSize: 13.5,
              letterSpacing: 0.2,
              borderTop: `2px solid ${active ? PAL.terra : "rgba(110,106,87,0.3)"}`,
            }}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Screen 1 — The two models, over real terrain
// ---------------------------------------------------------------------------
function GroundBand({ y, h }) {
  // same ground in both panels: grass | bushes | forest, left to right
  const regions = [
    { x: 0, w: 120, c: PAL.grass },
    { x: 120, w: 120, c: PAL.bushes },
    { x: 240, w: 120, c: PAL.forest },
  ];
  return (
    <g>
      {regions.map((r) => (
        <rect key={r.x} x={r.x} y={y} width={r.w} height={h} fill={r.c} />
      ))}
    </g>
  );
}

function Panel1({ kind }) {
  const W = 360,
    H = 290,
    groundY = 232,
    groundH = 58;
  const isLegacy = kind === "legacy";
  const color = isLegacy ? PAL.legacy : PAL.hasrd;
  const heights = [205, 160, 112, 62]; // surface -> high
  const regionFactor = [1, 0.66, 0.18]; // grass, bushes, forest (sigma-like)
  const regionCx = [60, 180, 300];

  const arrows = [];
  if (isLegacy) {
    // identical arrows everywhere, blind to ground and height
    const cols = [44, 104, 164, 224, 284, 332];
    cols.forEach((cx, ci) =>
      heights.forEach((hy, hi) => {
        const L = 30;
        arrows.push(
          <Arrow
            key={`l${ci}-${hi}`}
            x1={cx - L / 2}
            y1={hy}
            x2={cx + L / 2}
            y2={hy - 3}
            color={color}
            width={2}
          />
        );
      })
    );
  } else {
    // grows with height, shrinks over rougher ground, + turbulence near surface
    regionCx.forEach((cx, ri) => {
      heights.forEach((hy, hi) => {
        const heightF = (groundY - hy) / (groundY - heights[3]); // 0..1 upward
        const L = (10 + 46 * heightF) * regionFactor[ri];
        if (L < 3) return;
        arrows.push(
          <Arrow
            key={`h${ri}-${hi}`}
            x1={cx - L / 2}
            y1={hy}
            x2={cx + L / 2}
            y2={hy - 5 * heightF}
            color={color}
            width={2}
          />
        );
      });
      // turbulence swirl near the surface (scaled by terrain)
      const sr = 5 + 7 * regionFactor[ri];
      arrows.push(
        <Swirl key={`sw${ri}`} cx={cx} cy={groundY - 14} r={sr} color={color} />
      );
    });
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={
        isLegacy
          ? "Legacy model: identical wind arrows at every height and over every terrain."
          : "HASRD model: wind that grows with height and shrinks over rougher ground, plus surface turbulence."
      }
      style={{ display: "block" }}
    >
      <rect x={0} y={0} width={W} height={groundY} fill="rgba(255,255,255,0.35)" />
      <GroundBand y={groundY} h={groundH} />
      {arrows}
      {/* region labels along the shared ground */}
      {["grass", "bushes", "forest"].map((t, i) => (
        <text
          key={t}
          x={60 + i * 120}
          y={groundY + groundH - 8}
          textAnchor="middle"
          fontSize={11}
          fill="rgba(242,235,216,0.9)"
        >
          {t}
        </text>
      ))}
    </svg>
  );
}

function Screen1({ onNext }) {
  return (
    <section>
      <h2 style={hStyle}>The two models, over real terrain</h2>
      <p style={leadStyle}>
        A tank fires across the same stretch of ground — grass on the left,
        forest on the right. The only thing that differs between these panels is
        how each model imagines the wind.
      </p>
      <div className="panels" style={{ display: "flex", gap: 20, marginTop: 10 }}>
        <figure style={panelCard}>
          <Panel1 kind="legacy" />
          <figcaption style={capStyle}>
            <strong style={{ color: PAL.text }}>Legacy.</strong> The same wind
            everywhere — one fixed number, identical at every height and over
            every terrain. It never looks at the ground below.
          </figcaption>
        </figure>
        <figure style={panelCard}>
          <Panel1 kind="hasrd" />
          <figcaption style={capStyle}>
            <strong style={{ color: PAL.hasrd }}>HASRD.</strong> Wind grows as
            it climbs and shrinks over rougher ground — strongest over open
            grass, calmest over forest — plus small-scale turbulence near the
            surface.
          </figcaption>
        </figure>
      </div>
      <NextBar onNext={onNext} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Screen 2 — Wind grows with height; the round feels all of it
// ---------------------------------------------------------------------------
function Screen2({ terrain, setTerrain, onNext, onBack }) {
  const W = 720,
    H = 380,
    groundY = 322;
  const tScale = sigmaForTerrain(terrain) / sigmaForTerrain(0); // grass = 1

  // ambient wind profile: columns of arrows lengthening with height
  const cols = [180, 380, 560];
  const rows = [300, 246, 192, 138, 84];
  const profile = [];
  cols.forEach((cx, ci) =>
    rows.forEach((ry, ri) => {
      const heightF = (groundY - ry) / (groundY - rows[rows.length - 1]);
      const L = (14 + 70 * heightF) * tScale;
      if (L < 4) return;
      profile.push(
        <Arrow
          key={`p${ci}-${ri}`}
          x1={cx - L / 2}
          y1={ry}
          x2={cx + L / 2}
          y2={ry - 4 * heightF}
          color={PAL.hasrd}
          width={2}
          opacity={0.5}
        />
      );
    })
  );

  // trajectory arc (quadratic bezier) muzzle -> apex -> descent
  const P0 = [92, groundY];
  const Pc = [368, -90];
  const P2 = [648, 300];
  const bez = (t) => [
    (1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * Pc[0] + t ** 2 * P2[0],
    (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * Pc[1] + t ** 2 * P2[1],
  ];
  const muzzle = bez(0);
  const apex = bez(0.5);
  const descent = bez(0.8);

  return (
    <section>
      <h2 style={hStyle}>Wind grows with height — the round feels all of it</h2>
      <p style={leadStyle}>
        Crosswind is gentle near the ground and strongest up high. A round flies
        an arc, so it samples a <em>different</em> wind at every point — most of
        all at the top.
      </p>

      <div style={panelCard}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="Side view: wind arrows lengthen with height while a shell arc samples 5 metres per second at the muzzle, 10 at the apex, and 5 on descent."
          style={{ display: "block" }}
        >
          <rect x={0} y={0} width={W} height={groundY} fill="rgba(255,255,255,0.35)" />
          <rect x={0} y={groundY} width={W} height={H - groundY} fill={terrainColor(terrain)} />
          {profile}

          {/* trajectory */}
          <path
            d={`M ${P0[0]} ${P0[1]} Q ${Pc[0]} ${Pc[1]} ${P2[0]} ${P2[1]}`}
            fill="none"
            stroke={PAL.terra}
            strokeWidth={2.5}
            strokeDasharray="2 5"
            strokeLinecap="round"
          />

          {/* sample points 5 -> 10 -> 5 */}
          {[
            { p: muzzle, v: "5 m/s", note: "muzzle", dy: 22 },
            { p: apex, v: "10 m/s", note: "apex — highest, most wind", dy: -14 },
            { p: descent, v: "5 m/s", note: "descent", dy: 26 },
          ].map((s, i) => (
            <g key={i}>
              <circle cx={s.p[0]} cy={s.p[1]} r={5} fill={PAL.terraBright} />
              <text
                x={s.p[0]}
                y={s.p[1] + s.dy}
                textAnchor="middle"
                fontSize={13}
                fontWeight={700}
                fill={PAL.text}
              >
                {s.v}
              </text>
              <text
                x={s.p[0]}
                y={s.p[1] + s.dy + 15}
                textAnchor="middle"
                fontSize={11}
                fill={PAL.text2}
              >
                {s.note}
              </text>
            </g>
          ))}
        </svg>

        <div style={{ padding: "4px 16px 16px" }}>
          <TerrainSlider terrain={terrain} setTerrain={setTerrain} />
          <p style={{ ...capStyle, marginTop: 8 }}>
            Drag the terrain to reshape the ambient wind: rougher ground (forest)
            drags the whole profile down. The arc still climbs into faster air at
            its apex — the gentle-low, strong-high shape is the key physics.
          </p>
        </div>
      </div>
      <NextBar onNext={onNext} onBack={onBack} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Screen 3 — Shooting gallery
// ---------------------------------------------------------------------------
const VW = 760,
  VH = 430;
const TARGET = { x: 596, y: 215 };
const SCALE = 9; // px per metre in the impact plane

function Scatter({ pts, color, r = 1.15, opacity = 0.55 }) {
  return (
    <g>
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={TARGET.x + p[0] * SCALE}
          cy={TARGET.y - p[1] * SCALE}
          r={r}
          fill={color}
          opacity={opacity}
        />
      ))}
    </g>
  );
}

function Ellipse2sig({ sigma, R, color }) {
  const sy = Math.sqrt(
    Math.pow(sigma * A * rangeDrift(R), 2) + Math.pow(SB * rangeBase(R), 2)
  );
  const sx = SB * rangeBase(R);
  return (
    <ellipse
      cx={TARGET.x}
      cy={TARGET.y}
      rx={Math.max(2, 2 * sx * SCALE)}
      ry={Math.max(2, 2 * sy * SCALE)}
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeDasharray="4 4"
      opacity={0.9}
    />
  );
}

function Screen3({ terrain, setTerrain, onBack }) {
  const [range, setRange] = useState(3000);
  const [compare, setCompare] = useState(false);
  const [volleySeed, setVolleySeed] = useState(null);
  const [singles, setSingles] = useState([]);
  const [proj, setProj] = useState(null); // {cx, cy} in flight
  const rafRef = useRef(null);

  const sigma = sigmaForTerrain(terrain);
  const hasrdHit = phit(sigma, range);
  const legacyHit = phit(LEGACY_SIGMA, range);

  // deterministic volley cloud — stable while dragging, fresh on each fire
  const volley = useMemo(() => {
    if (volleySeed == null) return null;
    const out = { hasrd: [], legacy: [] };
    const gH = makeRng(volleySeed).g;
    for (let i = 0; i < 1000; i++) out.hasrd.push(impact(sigma, range, gH));
    if (compare) {
      const gL = makeRng(volleySeed ^ 0x9e3779b9).g;
      for (let i = 0; i < 1000; i++)
        out.legacy.push(impact(LEGACY_SIGMA, range, gL));
    }
    return out;
  }, [volleySeed, sigma, range, compare]);

  const clearShots = () => {
    setSingles([]);
    setVolleySeed(null);
  };
  const onTerrain = (v) => {
    setTerrain(v);
    setSingles([]);
  };
  const onRange = (v) => {
    setRange(v);
    setSingles([]);
  };

  const fireOne = useCallback(() => {
    const [x, y] = impact(sigma, range, gauss);
    const tx = TARGET.x + x * SCALE;
    const ty = TARGET.y - y * SCALE;
    const land = () => setSingles((s) => [...s.slice(-40), [x, y]]);
    if (reduceMotion()) {
      land();
      return;
    }
    const start = performance.now();
    const x0 = 86,
      y0 = TARGET.y;
    const dur = 520;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 2); // ease-out
      setProj({ cx: x0 + (tx - x0) * e, cy: y0 + (ty - y0) * e });
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
      else {
        setProj(null);
        land();
      }
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [sigma, range]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // wind vector triangle geometry (upper-left of viewport)
  const O = { x: 96, y: 150 };
  const rangeLeg = 78; // visual length of the (ignored) along-fire component
  const crossLeg = sigma * 14; // crosswind leg scales with terrain sigma
  const tip = { x: O.x + rangeLeg, y: O.y - crossLeg };

  // reticle grid lines
  const grid = [];
  for (let gx = 40; gx < VW; gx += 60)
    grid.push(<line key={`gx${gx}`} x1={gx} y1={20} x2={gx} y2={VH - 20} stroke={PAL.reticle} strokeWidth={1} />);
  for (let gy = 40; gy < VH; gy += 60)
    grid.push(<line key={`gy${gy}`} x1={20} y1={gy} x2={VW - 20} y2={gy} stroke={PAL.reticle} strokeWidth={1} />);

  return (
    <section>
      <button onClick={onBack} style={backLink}>
        ← back to how it works
      </button>
      <h2 style={hStyle}>Shooting gallery</h2>
      <p style={leadStyle}>
        Fire downrange and watch where the rounds land. Then flip on{" "}
        <em>Compare legacy</em>, drag the terrain, and push the range out to
        3000 m.
      </p>

      {/* instrument viewport */}
      <div
        style={{
          background: PAL.viewport,
          border: `3px solid ${PAL.forest}`,
          borderRadius: 4,
          padding: 8,
        }}
      >
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          width="100%"
          role="img"
          aria-label={`Top-down range at ${range} metres over ${terrainName(
            terrain
          )}. HASRD hit probability ${fmtPct(
            hasrdHit
          )} percent; the legacy model predicts ${fmtPct(legacyHit)} percent.`}
          style={{ display: "block", background: PAL.viewportField, borderRadius: 2 }}
        >
          <clipPath id="vp">
            <rect x={10} y={10} width={VW - 20} height={VH - 20} />
          </clipPath>
          <g clipPath="url(#vp)">
            {grid}

            {/* line of fire */}
            <line
              x1={86}
              y1={TARGET.y}
              x2={TARGET.x}
              y2={TARGET.y}
              stroke={PAL.mono}
              strokeWidth={1.2}
              strokeDasharray="6 6"
              opacity={0.6}
            />
            {/* shooter */}
            <g opacity={0.9}>
              <rect x={70} y={TARGET.y - 9} width={18} height={18} rx={2} fill={PAL.mono} />
              <text x={79} y={TARGET.y + 30} textAnchor="middle" fontSize={10} fontFamily="monospace" fill={PAL.mono}>
                shooter
              </text>
            </g>

            {/* 2σ ellipses behind the dots */}
            {volley && compare && <Ellipse2sig sigma={LEGACY_SIGMA} R={range} color={PAL.legacy} />}
            {volley && <Ellipse2sig sigma={sigma} R={range} color={PAL.terra} />}

            {/* scatter clouds */}
            {volley && compare && <Scatter pts={volley.legacy} color={PAL.legacy} opacity={0.5} />}
            {volley && <Scatter pts={volley.hasrd} color={PAL.terra} opacity={0.6} />}

            {/* single-fire bullet holes */}
            {singles.map((p, i) => (
              <circle
                key={i}
                cx={TARGET.x + p[0] * SCALE}
                cy={TARGET.y - p[1] * SCALE}
                r={2.6}
                fill={PAL.terraBright}
              />
            ))}

            {/* round in flight */}
            {proj && <circle cx={proj.cx} cy={proj.cy} r={3.2} fill={PAL.terraBright} />}

            {/* target box with crosshairs */}
            <g>
              <line x1={TARGET.x - 26} y1={TARGET.y} x2={TARGET.x + 26} y2={TARGET.y} stroke={PAL.mono} strokeWidth={1} opacity={0.7} />
              <line x1={TARGET.x} y1={TARGET.y - 26} x2={TARGET.x} y2={TARGET.y + 26} stroke={PAL.mono} strokeWidth={1} opacity={0.7} />
              <rect
                x={TARGET.x - HALF * SCALE}
                y={TARGET.y - HALF * SCALE}
                width={2 * HALF * SCALE}
                height={2 * HALF * SCALE}
                fill="none"
                stroke={PAL.mono}
                strokeWidth={1.6}
              />
              <text x={TARGET.x} y={TARGET.y - HALF * SCALE - 7} textAnchor="middle" fontSize={10} fontFamily="monospace" fill={PAL.mono}>
                2.3 m target
              </text>
            </g>

            {/* wind vector triangle */}
            <g>
              {/* range component (ignored) */}
              <line x1={O.x} y1={O.y} x2={O.x + rangeLeg} y2={O.y} stroke={PAL.legacy} strokeWidth={2} strokeDasharray="4 4" />
              <text x={O.x + rangeLeg / 2} y={O.y + 15} textAnchor="middle" fontSize={10} fontFamily="monospace" fill={PAL.legacy}>
                range — ignored
              </text>
              {/* crosswind (what we change) */}
              <Arrow x1={tip.x} y1={O.y} x2={tip.x} y2={tip.y} color={PAL.terraBright} width={3} />
              <text x={tip.x + 8} y={(O.y + tip.y) / 2} fontSize={10} fontFamily="monospace" fill={PAL.terraBright}>
                crosswind
              </text>
              <text x={tip.x + 8} y={(O.y + tip.y) / 2 + 12} fontSize={9} fontFamily="monospace" fill={PAL.terraBright}>
                the part we change
              </text>
              {/* total wind */}
              <Arrow x1={O.x} y1={O.y} x2={tip.x} y2={tip.y} color={PAL.hasrd} width={2.5} />
              <text x={O.x - 4} y={O.y + 16} fontSize={10} fontFamily="monospace" fill={PAL.hasrd} textAnchor="end">
                total wind
              </text>
              <Swirl cx={tip.x + 4} cy={tip.y - 4} r={7} color={PAL.hasrd} />
            </g>

            {/* monospace readouts */}
            <g fontFamily="monospace" fill={PAL.mono} fontSize={12}>
              <text x={VW - 24} y={36} textAnchor="end">RANGE  {range} m</text>
              <text x={VW - 24} y={54} textAnchor="end">TERRAIN  {terrainName(terrain)}</text>
              <text x={VW - 24} y={72} textAnchor="end">σ_xw  {sigma.toFixed(2)} m/s</text>
              <text x={VW - 24} y={90} textAnchor="end" fill={PAL.terra}>P_hit  {fmtPct(hasrdHit)} %</text>
            </g>
          </g>
        </svg>
      </div>

      {/* controls */}
      <div className="gallery" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
        <div>
          <TerrainSlider terrain={terrain} setTerrain={onTerrain} />
          <div style={{ marginTop: 14 }}>
            <label htmlFor="range" style={sliderLabel}>
              range <span style={{ color: PAL.text2 }}>{range} m</span>
            </label>
            <input
              id="range"
              type="range"
              min={300}
              max={3000}
              step={100}
              value={range}
              onChange={(e) => onRange(Number(e.target.value))}
              style={{ width: "100%" }}
              aria-label="Range in metres"
            />
            <div style={tickRow}>
              <span>short — 300 m</span>
              <span>3000 m</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={fireOne} style={btnPrimary}>
              Fire one
            </button>
            <button
              onClick={() => setVolleySeed((Math.random() * 1e9) | 0)}
              style={btnSecondary}
            >
              Fire volley (1000)
            </button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: PAL.text }}>
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
              aria-label="Compare legacy model"
            />
            Compare legacy
          </label>
          <button onClick={clearShots} style={btnGhost}>
            Clear shots
          </button>
        </div>
      </div>

      {/* stat cards */}
      <div className="gallery" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
        <StatCard
          title="Hit probability"
          big={`${fmtPct(hasrdHit)}%`}
          sub={`legacy claims ${fmtPct(legacyHit)}%`}
        />
        <StatCard
          title="Crosswind σ"
          big={`${sigma.toFixed(2)} m/s`}
          sub={`legacy assumes ${LEGACY_SIGMA.toFixed(2)}`}
        />
      </div>

      <p style={{ ...capStyle, marginTop: 14 }}>
        Push the range short and both groups collapse onto the target — the
        legacy model looks fine. Drag it back to 3000 m and they peel apart: over
        grass the real group is far wider than legacy assumes, over forest far
        tighter.
      </p>
    </section>
  );
}

function StatCard({ title, big, sub }) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid rgba(110,106,87,0.25)`,
        borderRadius: 4,
        padding: "16px 18px",
      }}
    >
      <div style={{ fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: PAL.text2 }}>
        {title}
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: PAL.terra, marginTop: 4, lineHeight: 1.1 }}>
        {big}
      </div>
      <div style={{ fontSize: 13, color: PAL.legacy, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared controls + layout bits
// ---------------------------------------------------------------------------
function TerrainSlider({ terrain, setTerrain }) {
  return (
    <div>
      <label htmlFor="terrain" style={sliderLabel}>
        terrain{" "}
        <span style={{ color: PAL.text2 }}>
          {terrainName(terrain)} · σ {sigmaForTerrain(terrain).toFixed(2)} m/s
        </span>
      </label>
      <input
        id="terrain"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={terrain}
        onChange={(e) => setTerrain(Number(e.target.value))}
        style={{ width: "100%" }}
        aria-label="Terrain from grassy field to forest"
      />
      <div style={tickRow}>
        <span>grassy field</span>
        <span>bushes</span>
        <span>forest</span>
      </div>
    </div>
  );
}

function NextBar({ onNext, onBack }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
      {onBack ? (
        <button onClick={onBack} style={btnGhost}>
          ← back
        </button>
      ) : (
        <span />
      )}
      <button onClick={onNext} style={btnPrimary}>
        Next →
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function HasrdAdvantage() {
  const [screen, setScreen] = useState(1);
  const [terrain, setTerrain] = useState(0); // open on grass

  return (
    <div
      className="hz"
      style={{
        background: PAL.canvas,
        color: PAL.text,
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        minHeight: "100%",
        padding: "28px 22px 60px",
      }}
    >
      <style>{CSS}</style>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <header style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: PAL.terra }}>
            Height And Surface Roughness Dependent wind
          </div>
          <h1 style={{ fontSize: 30, margin: "4px 0 0", fontWeight: 700, letterSpacing: -0.5 }}>
            The HASRD-ous advantage
          </h1>
          <p style={{ color: PAL.text2, margin: "6px 0 0", maxWidth: 640, fontSize: 15 }}>
            The counterintuitive part first: a forest makes you more accurate.
            Here's why — by playing, not reading.
          </p>
        </header>

        <Stepper screen={screen} setScreen={setScreen} />

        {screen === 1 && <Screen1 onNext={() => setScreen(2)} />}
        {screen === 2 && (
          <Screen2
            terrain={terrain}
            setTerrain={setTerrain}
            onNext={() => setScreen(3)}
            onBack={() => setScreen(1)}
          />
        )}
        {screen === 3 && (
          <Screen3 terrain={terrain} setTerrain={setTerrain} onBack={() => setScreen(2)} />
        )}

        <footer style={{ marginTop: 40, fontSize: 11.5, color: PAL.text2, borderTop: "1px solid rgba(110,106,87,0.25)", paddingTop: 12 }}>
          Illustrative — impact scatter is generated, calibrated to reproduce
          published thesis results (range 3000 m, 2.3 m target).
        </footer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------
const hStyle = { fontSize: 21, fontWeight: 700, margin: "4px 0 6px", letterSpacing: -0.3 };
const leadStyle = { color: PAL.text2, fontSize: 15, lineHeight: 1.55, maxWidth: 660, margin: "0 0 14px" };
const capStyle = { color: PAL.text2, fontSize: 13, lineHeight: 1.5, margin: 0 };
const panelCard = {
  flex: 1,
  background: "#fff",
  border: "1px solid rgba(110,106,87,0.25)",
  borderRadius: 4,
  padding: 12,
  margin: 0,
};
const sliderLabel = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, letterSpacing: 0.2 };
const tickRow = { display: "flex", justifyContent: "space-between", fontSize: 11, color: PAL.text2, marginTop: 2 };
const btnBase = {
  border: "none",
  borderRadius: 3,
  padding: "9px 16px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  letterSpacing: 0.2,
};
const btnPrimary = { ...btnBase, background: PAL.terra, color: "#fff" };
const btnSecondary = { ...btnBase, background: PAL.hasrd, color: "#fff" };
const btnGhost = { ...btnBase, background: "transparent", color: PAL.text2, border: "1px solid rgba(110,106,87,0.4)" };
const backLink = {
  ...btnBase,
  background: "transparent",
  color: PAL.text2,
  padding: "4px 0",
  fontWeight: 500,
  marginBottom: 6,
};

const CSS = `
.hz *{box-sizing:border-box}
.hz button:focus-visible,.hz input:focus-visible{outline:2px solid ${PAL.terra};outline-offset:2px}
.hz input[type=range]{accent-color:${PAL.terra};height:24px}
.hz button{transition:opacity .12s ease}
.hz button:hover{opacity:.88}
@media (max-width:780px){
  .hz .panels{flex-direction:column}
  .hz .gallery{grid-template-columns:1fr !important}
}
@media (prefers-reduced-motion:reduce){
  .hz *{animation:none !important;transition:none !important}
}
`;
