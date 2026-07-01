import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";

/**
 * The HASRD-ous advantage
 * Interactive companion to a master's thesis on wind modeling for direct-fire
 * ballistics (Paola Kefallinos, Northeastern University).
 *
 * Pages: 0 intro (unnumbered) -> 1 Ballistic simulations background
 * -> 2 Wind background -> 3 HASRD wind stratification -> 4 Shooting gallery
 *
 * Self-contained. No backend, no browser storage. All numbers hardcoded and
 * calibrated to reproduce the published thesis results (verified by Monte Carlo).
 */

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------
const PAL = {
  canvas: "#F2EBD8",
  text: "#2E2C22",
  text2: "#6E6A57",
  hasrd: "#41696A",
  legacy: "#9E9A85",
  terra: "#A8512F",
  terraBright: "#C25A33",
  grass: "#8A8E74",
  bushes: "#6B7350",
  forest: "#3A3D22",
  viewport: "#272A18",
  viewportField: "#2F331E",
  reticle: "rgba(155,170,120,0.22)",
  mono: "#C9CBB0",
  paper: "#FFFFFF",
};

// ---------------------------------------------------------------------------
// Calibration constants (do not drift — these reproduce the thesis table)
// ---------------------------------------------------------------------------
const A = 1.956;
const SB = 1.9;
const LEGACY_SIGMA = 1.798;
const REF_RANGE = 3000;
const HALF = 1.15;

function sigmaForTerrain(t) {
  return t <= 0.5
    ? 3.675 + (2.433 - 3.675) * (t / 0.5)
    : 2.433 + (0.654 - 2.433) * ((t - 0.5) / 0.5);
}
function terrainName(t) {
  if (t < 0.25) return "Grassy field";
  if (t < 0.75) return "Bushes";
  return "Forest";
}
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
const insideProb = (a, s) => (s > 0 ? erf(a / (s * Math.SQRT2)) : 1);

function phit(sigma, R) {
  const sy = Math.sqrt(
    Math.pow(sigma * A * rangeDrift(R), 2) + Math.pow(SB * rangeBase(R), 2)
  );
  const sx = SB * rangeBase(R);
  return insideProb(HALF, sx) * insideProb(HALF, sy);
}

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
function gauss() {
  let u1 = Math.random() || 1e-9;
  let u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function impact(sigma, R, g) {
  const Wy = g() * sigma;
  const y = Wy * A * rangeDrift(R) + g() * SB * rangeBase(R);
  const x = g() * SB * rangeBase(R);
  return [x, y];
}

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
  const A2 = hexRgb(a),
    B2 = hexRgb(b);
  return rgbHex(A2.map((v, i) => v + (B2[i] - v) * t));
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
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />
      <polygon points={`${x2},${y2} ${ax},${ay} ${bx},${by}`} fill={color} />
    </g>
  );
}
function Swirl({ cx, cy, r = 9, color, width = 1.5 }) {
  const d = `M ${cx + r} ${cy} A ${r} ${r} 0 1 1 ${cx} ${cy - r} A ${r * 0.55} ${r * 0.55} 0 1 0 ${cx - r * 0.35} ${cy}`;
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" opacity={0.85} />;
}
function FlowBox({ x, y, w, h, fill, stroke, children, fontSize = 11.5, bold, color }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={3} fill={fill} stroke={stroke} strokeWidth={1} />
      <text x={x + w / 2} y={y + h / 2 + fontSize * 0.35} textAnchor="middle" fontSize={fontSize} fontWeight={bold ? 700 : 400} fill={color || PAL.text}>
        {children}
      </text>
    </g>
  );
}
function FlowArrow({ x1, y1, x2, y2, color = PAL.text2 }) {
  return <Arrow x1={x1} y1={y1} x2={x2} y2={y2} color={color} width={2} />;
}

// ---------------------------------------------------------------------------
// Stepper (screens 1-4; intro is unnumbered)
// ---------------------------------------------------------------------------
const STEPS = [
  "1 · Ballistic simulations background",
  "2 · Wind background",
  "3 · HASRD wind stratification",
  "4 · Shooting gallery",
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
              fontSize: 13,
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
// Shared header (eyebrow with bolded acronym letters + centered subtitle)
// ---------------------------------------------------------------------------
const EYEBROW_WORDS = ["Height", "And", "Surface", "Roughness", "Dependent"];
function Header() {
  return (
    <header style={{ marginBottom: 18, textAlign: "center" }}>
      <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: PAL.terra }}>
        {EYEBROW_WORDS.map((w) => (
          <span key={w}>
            <strong>{w[0]}</strong>
            {w.slice(1)}{" "}
          </span>
        ))}
        <span>wind</span>
      </div>
      <h1 style={{ fontSize: 30, margin: "4px 0 0", fontWeight: 700, letterSpacing: -0.5 }}>
        The HASRD-ous advantage
      </h1>
      <p style={{ color: PAL.text2, margin: "10px auto 0", maxWidth: 700, fontSize: 14.5, lineHeight: 1.6, textAlign: "center" }}>
        This study presents a Height and Surface Roughness Dependent (HASRD)
        wind model that dynamically integrates mean wind stratification,
        turbulence, and global land cover data to predict ballistic trajectory
        with greater accuracy than legacy models. The new model produces
        statistically significant improvements in downrange deflection and
        first-round hit probability predictions, with the most dramatic
        effects on terrain featuring extreme surface roughness profiles. By
        capturing how terrain influences wind speed and variability, the
        HASRD approach enhances weapon system accuracy for direct fire
        engagement across diverse geographic and climatic conditions.
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// INTRO PAGE (unnumbered)
// ---------------------------------------------------------------------------
function IntroDiagram() {
  // simplified, original schematic in the app's own palette — inputs feed a
  // simulation model, which produces a trajectory toward a target.
  const W = 640, H = 230;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Diagram: atmospheric conditions, ballistics, and range feed a ballistic simulation model, which produces a trajectory toward a target." style={{ display: "block" }}>
      <FlowBox x={16} y={30} w={140} h={26} fill="#EAF1EE" stroke={PAL.hasrd}>Atmospheric conditions</FlowBox>
      <FlowBox x={16} y={62} w={140} h={26} fill="#EAF1EE" stroke={PAL.hasrd}>Ballistics</FlowBox>
      <FlowBox x={16} y={94} w={140} h={26} fill="#EAF1EE" stroke={PAL.hasrd}>Range</FlowBox>
      <FlowArrow x1={158} y1={72} x2={196} y2={72} />
      <FlowBox x={198} y={40} w={150} h={64} fill="#fff" stroke={PAL.text} bold fontSize={12}>Ballistic simulation model</FlowBox>
      <FlowArrow x1={350} y1={72} x2={388} y2={72} />
      <FlowBox x={390} y={58} w={150} h={28} fill="#F4ECE0" stroke={PAL.terra} color={PAL.terra} bold>Trajectory</FlowBox>

      {/* arc + tank + target */}
      <line x1={40} y1={200} x2={600} y2={200} stroke={PAL.text2} strokeWidth={1.5} />
      <path d="M 60 200 Q 300 110 560 190" fill="none" stroke={PAL.hasrd} strokeWidth={2.5} strokeDasharray="1 6" strokeLinecap="round" />
      <rect x={38} y={186} width={26} height={12} rx={2} fill={PAL.text} />
      <rect x={556} y={176} width={2.3 * 8} height={2.3 * 8} fill="none" stroke={PAL.terra} strokeWidth={2} />
      <text x={51} y={216} textAnchor="middle" fontSize={10} fill={PAL.text2}>Shooter</text>
      <text x={568} y={220} textAnchor="middle" fontSize={10} fill={PAL.text2}>Target</text>
    </svg>
  );
}
function Intro({ onStart }) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center", padding: "40px 6px" }}>
      <h1 style={{ fontSize: 26, lineHeight: 1.35, fontWeight: 700, margin: "0 0 22px", letterSpacing: -0.3 }}>
        The effect of surface roughness on crosswind drift and probability of
        hit for large caliber direct fire ballistics
      </h1>
      <p style={{ margin: "0 0 4px", fontSize: 15, color: PAL.text }}>
        Results from a Master's thesis by <strong>Paola Kefallinos</strong>
      </p>
      <p style={{ margin: "0 0 30px", fontSize: 13.5, color: PAL.text2 }}>
        Department of Mechanical and Industrial Engineering · Northeastern University
      </p>

      <div style={{ ...panelCard, textAlign: "left", maxWidth: 660, margin: "0 auto 30px" }}>
        <IntroDiagram />
      </div>

      <button onClick={onStart} style={{ ...btnPrimary, fontSize: 15, padding: "12px 28px" }}>
        Get started →
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PAGE 1 — Ballistic simulations background
// ---------------------------------------------------------------------------
function TrajectoryGif() {
  const rm = reduceMotion();
  return (
    <svg viewBox="0 0 360 160" width="100%" role="img" aria-label="Animated trajectory arc governed by Newton's second law." style={{ display: "block" }}>
      <line x1={20} y1={140} x2={340} y2={140} stroke={PAL.text2} strokeWidth={1.5} />
      <path id="traj-path" d="M 30 140 Q 180 20 330 130" fill="none" stroke={PAL.hasrd} strokeWidth={2.5} strokeDasharray="1 6" />
      <rect x={330} y={118} width={16} height={16} fill="none" stroke={PAL.terra} strokeWidth={2} />
      {!rm ? (
        <circle r={5} fill={PAL.terraBright}>
          <animateMotion dur="2.4s" repeatCount="indefinite" path="M 30 140 Q 180 20 330 130" />
        </circle>
      ) : (
        <circle cx={180} cy={35} r={5} fill={PAL.terraBright} />
      )}
    </svg>
  );
}
function FlowDiagram({ mode }) {
  const real = mode === "real";
  const W = 640, H = real ? 250 : 230;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={real ? "Real world: inputs plus error budgets feed the model, producing a probability of hit and a possible miss." : "Ideal world: inputs feed the model, producing super elevation and time of flight."} style={{ display: "block" }}>
      <text x={W / 2} y={20} textAnchor="middle" fontSize={13} fontWeight={700} fill={real ? PAL.terra : PAL.hasrd}>
        {real ? "Real world" : "Ideal world"}
      </text>

      <FlowBox x={16} y={40} w={150} h={22} fill="#EAF1EE" stroke={PAL.hasrd} fontSize={11}>Atmospheric conditions</FlowBox>
      <FlowBox x={16} y={66} w={150} h={22} fill="#EAF1EE" stroke={PAL.hasrd} fontSize={11}>Ballistics</FlowBox>
      <FlowBox x={16} y={92} w={150} h={22} fill="#EAF1EE" stroke={PAL.hasrd} fontSize={11}>Range</FlowBox>
      {real && <FlowBox x={16} y={118} w={150} h={22} fill="#F4E3DA" stroke={PAL.terra} color={PAL.terra} bold fontSize={11}>Error budgets</FlowBox>}

      <FlowArrow x1={168} y1={real ? 80 : 68} x2={206} y2={real ? 80 : 68} />
      <FlowBox x={208} y={44} w={150} h={62} fill="#fff" stroke={PAL.text} bold fontSize={11.5}>
        <>Ballistic simulation model</>
      </FlowBox>
      <FlowArrow x1={360} y1={real ? 80 : 68} x2={398} y2={real ? 80 : 68} />

      {real ? (
        <FlowBox x={400} y={56} w={160} h={40} fill="#F4E3DA" stroke={PAL.terra} color={PAL.terra} bold fontSize={13}>
          Probability of hit
        </FlowBox>
      ) : (
        <>
          <FlowBox x={400} y={40} w={160} h={22} fill="#EDE7F2" stroke={PAL.hasrd} fontSize={11}>Super elevation</FlowBox>
          <FlowBox x={400} y={66} w={160} h={22} fill="#EDE7F2" stroke={PAL.hasrd} fontSize={11}>Time of flight</FlowBox>
        </>
      )}

      {/* trajectory */}
      <line x1={40} y1={H - 30} x2={600} y2={H - 30} stroke={PAL.text2} strokeWidth={1.5} />
      <path
        d={real ? "M 60 " + (H - 30) + " Q 300 " + (H - 130) + " 480 " + (H - 55) : "M 60 " + (H - 30) + " Q 300 " + (H - 140) + " 560 " + (H - 40)}
        fill="none"
        stroke={real ? PAL.terraBright : PAL.hasrd}
        strokeWidth={2.5}
      />
      <rect x={38} y={H - 44} width={26} height={12} rx={2} fill={PAL.text} />
      <rect x={real ? 556 : 556} y={H - 54} width={2.3 * 8} height={2.3 * 8} fill="none" stroke={PAL.text} strokeWidth={2} />
      {real && (
        <>
          <line x1={476} y1={H - 60} x2={498} y2={H - 78} stroke={PAL.terraBright} strokeWidth={2} />
          <text x={498} y={H - 82} fontSize={11} fontWeight={700} fill={PAL.terraBright}>Miss</text>
        </>
      )}
    </svg>
  );
}
function CrosswindDiagram() {
  const W = 640, H = 190;
  const lineY = 100;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Crosswind pushes the round perpendicular to the line of fire, causing it to land outside the target." style={{ display: "block" }}>
      <line x1={40} y1={lineY} x2={560} y2={lineY} stroke={PAL.mono === PAL.mono ? PAL.text2 : PAL.text2} strokeWidth={1.5} strokeDasharray="6 6" opacity={0.7} />
      <text x={300} y={lineY - 10} textAnchor="middle" fontSize={11} fill={PAL.text2}>Line of fire</text>
      <path d={`M 60 ${lineY} Q 320 ${lineY} 520 ${lineY - 55}`} fill="none" stroke={PAL.terra} strokeWidth={2.5} />
      <rect x={40} y={lineY - 8} width={24} height={16} rx={2} fill={PAL.text} />
      <rect x={505} y={lineY - 26} width={2.3 * 9} height={2.3 * 9} fill="none" stroke={PAL.text} strokeWidth={2} />
      <text x={520} y={lineY - 34} textAnchor="middle" fontSize={10} fill={PAL.text2}>Target</text>
      <Arrow x1={300} y1={lineY - 55} x2={300} y2={lineY - 5} color={PAL.terraBright} width={3} />
      <text x={315} y={lineY - 30} fontSize={12} fontWeight={700} fill={PAL.terraBright}>Crosswind</text>
      <line x1={490} y1={lineY - 50} x2={505} y2={lineY - 40} stroke={PAL.terraBright} strokeWidth={2} />
      <text x={470} y={lineY - 62} fontSize={11} fontWeight={700} fill={PAL.terraBright}>Miss</text>
    </svg>
  );
}
function Screen1({ onNext }) {
  return (
    <section>
      <h2 style={hStyle}>Ballistic simulations background</h2>
      <p style={leadStyle}>
        Before HASRD, a quick tour of how ballistic simulation works — and
        where wind sneaks in as a source of error.
      </p>

      <div style={panelCard}>
        <h3 style={h3Style}>Trajectories follow Newton's second law</h3>
        <p style={pStyle}>
          At its core, a ballistic model is a basic physics problem: apply
          Newton's second law to a projectile under gravity, drag, and
          initial velocity to trace its arc from muzzle to target.
        </p>
        <TrajectoryGif />
      </div>

      <div style={panelCard}>
        <h3 style={h3Style}>The model runs on a set of initial conditions</h3>
        <p style={pStyle}>
          Real simulations take in atmospheric conditions, ballistic
          properties of the round, and the range to target, then produce
          outputs like super elevation and time of flight.
        </p>
        <FlowDiagram mode="ideal" />
      </div>

      <div style={panelCard}>
        <h3 style={h3Style}>The real world isn't ideal</h3>
        <p style={pStyle}>
          Every one of those inputs carries measurement error and
          assumptions. Add an error budget to the ideal picture and a round
          fired with "perfect" inputs can still miss. Ballistic models
          typically report this as a <strong>probability of hit</strong> —
          the metric used throughout this study.
        </p>
        <FlowDiagram mode="real" />
      </div>

      <div style={panelCard}>
        <h3 style={h3Style}>One of those errors: crosswind drift</h3>
        <p style={pStyle}>
          The component of wind perpendicular to the line of fire pushes the
          round sideways and can turn a hit into a miss. At certain ranges,
          eliminating crosswind error alone is enough to flip the outcome
          from more-likely-miss to more-likely-hit. Minimizing this error
          comes down to one thing: how well we can estimate the wind
          profile the round actually flies through.
        </p>
        <CrosswindDiagram />
      </div>

      <NextBar onNext={onNext} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// PAGE 2 — Wind background
// ---------------------------------------------------------------------------
const LEGACY_CONDITIONS = [
  { key: "calm", label: "Calm day", sigma: 1.0 },
  { key: "proving", label: "Proving grounds", sigma: 1.9 },
  { key: "combat", label: "Quasi combat", sigma: 3.35 },
];
function GaussianBars({ sigma, color = PAL.terra }) {
  const W = 340, H = 170, midX = W / 2, base = H - 22, maxH = 120;
  const bars = [];
  const nb = 17, span = 9; // -9..9 sd-scaled range
  for (let i = 0; i < nb; i++) {
    const v = -span + (2 * span * i) / (nb - 1);
    const dens = Math.exp(-(v * v) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
    const h = Math.min(maxH, dens * sigma * 2.6 * maxH);
    const x = midX + (v / span) * (W / 2 - 20) - (W / (nb * 2.6));
    bars.push(<rect key={i} x={x} y={base - h} width={W / (nb * 1.3)} height={h} fill={color} opacity={0.75} />);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Bell-shaped histogram of crosswind speed, mean 0, standard deviation ${sigma} metres per second.`} style={{ display: "block" }}>
      <line x1={20} y1={base} x2={W - 20} y2={base} stroke={PAL.text2} strokeWidth={1} />
      {bars}
      <text x={midX} y={base + 16} textAnchor="middle" fontSize={10} fill={PAL.text2}>Wind speed (m/s)</text>
    </svg>
  );
}
function LegacyPanel() {
  const [cond, setCond] = useState(LEGACY_CONDITIONS[0]);
  return (
    <div style={panelHalf}>
      <h3 style={h3Style}>Legacy description of wind</h3>
      <p style={pStyle}>
        Legacy ballistic models typically treat crosswind as an average or
        constant speed, normally distributed with mean 0 and a standard
        deviation set by the firing condition:
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        {LEGACY_CONDITIONS.map((c) => (
          <button
            key={c.key}
            onClick={() => setCond(c)}
            style={{
              ...btnGhost,
              padding: "6px 12px",
              fontSize: 12.5,
              background: cond.key === c.key ? PAL.legacy : "transparent",
              color: cond.key === c.key ? "#fff" : PAL.text2,
              borderColor: "rgba(110,106,87,0.4)",
            }}
          >
            {c.label} · σ {c.sigma}
          </button>
        ))}
      </div>
      <GaussianBars sigma={cond.sigma} color={PAL.legacy} />
      <p style={capStyle}>
        μ = 0, σ = {cond.sigma.toFixed(2)} m/s — the same distribution is
        assumed regardless of what the round flies over.
      </p>
    </div>
  );
}

function MeanWindChart({ terrain }) {
  const W = 320, H = 220, baseX = 46, baseY = 190, topY = 20;
  const curves = [
    { z0: 3.0, color: PAL.forest, label: "Rough (z0=3.0)" },
    { z0: 0.15, color: PAL.bushes, label: "Mid (z0=0.15)" },
    { z0: 0.001, color: PAL.grass, label: "Smooth (z0≈0)" },
  ];
  const pathFor = (z0) => {
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const f = i / 24;
      const h = f * 100;
      const shape = Math.pow(f, 0.5 + z0 * 0.9);
      const x = baseX + shape * (W - baseX - 20);
      const y = baseY - f * (baseY - topY);
      pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(" ");
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Mean wind speed grows with height, faster over smooth terrain and slower over rough terrain." style={{ display: "block" }}>
      <line x1={baseX} y1={topY} x2={baseX} y2={baseY} stroke={PAL.text2} strokeWidth={1} />
      <line x1={baseX} y1={baseY} x2={W - 16} y2={baseY} stroke={PAL.text2} strokeWidth={1} />
      <text x={8} y={(topY + baseY) / 2} fontSize={9.5} fill={PAL.text2} transform={`rotate(-90 8 ${(topY + baseY) / 2})`} textAnchor="middle">Height</text>
      <text x={(baseX + W - 16) / 2} y={H - 4} fontSize={9.5} fill={PAL.text2} textAnchor="middle">Wind speed</text>
      {curves.map((c) => (
        <path key={c.z0} d={pathFor(c.z0)} fill="none" stroke={c.color} strokeWidth={2.2} />
      ))}
      <Arrow x1={W - 40} y1={baseY - 14} x2={baseX + 30} y2={baseY - 14} color={PAL.text2} width={1.5} />
      <text x={(W - 40 + baseX + 30) / 2} y={baseY - 20} fontSize={9} fill={PAL.text2} textAnchor="middle">Increasing surface roughness</text>
    </svg>
  );
}
function TurbulenceSquiggle() {
  const W = 320, H = 150;
  const rows = [
    { color: PAL.terra, seed: 1 },
    { color: PAL.hasrd, seed: 2 },
    { color: PAL.legacy, seed: 3 },
  ];
  const pathFor = (seed) => {
    let pts = [];
    let y = H / 2;
    let s = seed * 97;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let x = 0; x <= W; x += 6) {
      y += (rnd() - 0.5) * 22;
      y = Math.max(14, Math.min(H - 14, y));
      pts.push(`${x === 0 ? "M" : "L"} ${x} ${y.toFixed(1)}`);
    }
    return pts.join(" ");
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Noisy turbulence signal fluctuating around the mean wind." style={{ display: "block" }}>
      {rows.map((r) => (
        <path key={r.seed} d={pathFor(r.seed)} fill="none" stroke={r.color} strokeWidth={1.4} opacity={0.75} />
      ))}
      <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke={PAL.text2} strokeDasharray="3 4" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}
function LandCoverMosaic() {
  // stylized, original mosaic (not a reproduction of any satellite image)
  const cells = [];
  let s = 42;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const cols = ["#C9A24A", "#E3D06A", "#4B7A3C", "#2F5A2A", "#4472A8"];
  const gw = 18, gh = 10, cw = 300 / gw, ch = 150 / gh;
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const bias = r < 2 ? 4 : c < 5 ? 0 : rnd() < 0.5 ? 1 : 2;
      const idx = rnd() < 0.7 ? bias : Math.floor(rnd() * cols.length);
      cells.push(<rect key={`${r}-${c}`} x={c * cw} y={r * ch} width={cw + 0.5} height={ch + 0.5} fill={cols[idx]} />);
    }
  }
  return (
    <svg viewBox="0 0 300 150" width="100%" role="img" aria-label="Stylized global land-cover mosaic representing satellite-derived ground cover classes." style={{ display: "block", borderRadius: 3 }}>
      {cells}
    </svg>
  );
}
function LiteraturePanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={panelHalf}>
      <h3 style={h3Style}>Literature-informed wind profiles</h3>
      <ul style={ulStyle}>
        <li>Wind can be thought of as having two components: a DC signal and noise.</li>
        <li>
          The literature shows the "average wind" — the DC signal — is a
          function of height and{" "}
          <button
            onClick={() => setOpen((o) => !o)}
            style={{ ...inlineInfoBtn }}
            aria-expanded={open}
          >
            surface roughness
          </button>{" "}
          (the terrain and vegetation below).
        </li>
        {open && (
          <li style={{ listStyle: "none", marginLeft: -20 }}>
            <div style={{ background: "#fff", border: "1px solid rgba(110,106,87,0.3)", borderRadius: 4, padding: 10, marginTop: 4 }}>
              <LandCoverMosaic />
              <p style={{ ...capStyle, marginTop: 6 }}>
                Surface roughness is estimable nearly everywhere via satellite
                imagery of ground cover.
              </p>
            </div>
          </li>
        )}
        <li>The literature also has well-developed methods to estimate wind turbulence.</li>
      </ul>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <MeanWindChart />
        </div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <TurbulenceSquiggle />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-around", fontSize: 11, fontWeight: 700, color: PAL.text2 }}>
        <span>DC signal</span>
        <span>Noise</span>
      </div>
    </div>
  );
}

function Screen2({ terrain, setTerrain, onNext, onBack }) {
  const W = 720, H = 380, groundY = 322;
  const tScale = sigmaForTerrain(terrain) / sigmaForTerrain(0);

  const cols = [180, 380, 560];
  const rows = [300, 246, 192, 138, 84];
  const profile = [];
  cols.forEach((cx, ci) =>
    rows.forEach((ry, ri) => {
      const heightF = (groundY - ry) / (groundY - rows[rows.length - 1]);
      const L = (14 + 70 * heightF) * tScale;
      if (L < 4) return;
      profile.push(
        <Arrow key={`p${ci}-${ri}`} x1={cx - L / 2} y1={ry} x2={cx + L / 2} y2={ry - 4 * heightF} color={PAL.hasrd} width={2} opacity={0.5} />
      );
    })
  );

  const P0 = [92, groundY];
  const Pc = [368, -90];
  const P2 = [648, 300];
  const bez = (t) => [
    (1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * Pc[0] + t ** 2 * P2[0],
    (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * Pc[1] + t ** 2 * P2[1],
  ];
  const invertT = (xTarget) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (bez(mid)[0] < xTarget) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const maxHeight = groundY - Pc[1];
  const speedAt = (t) => {
    const y = bez(t)[1];
    const heightF = Math.max(0, Math.min(1, (groundY - y) / maxHeight));
    return (5 + 5 * heightF) * tScale;
  };

  const [pts, setPts] = useState([
    { id: "muzzle", t: 0, label: "Muzzle" },
    { id: "apex", t: 0.5, label: "Apex" },
    { id: "descent", t: 0.8, label: "Descent" },
  ]);
  const svgRef = useRef(null);
  const dragId = useRef(null);

  const onPointerMove = useCallback(
    (e) => {
      if (dragId.current == null || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / rect.width;
      const xInView = fx * W;
      const t = Math.max(0, Math.min(1, invertT(xInView)));
      setPts((prev) => prev.map((p) => (p.id === dragId.current ? { ...p, t } : p)));
    },
    [W]
  );
  const endDrag = useCallback(() => {
    dragId.current = null;
  }, []);
  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
    };
  }, [onPointerMove, endDrag]);

  return (
    <section>
      <h2 style={hStyle}>Wind background</h2>
      <p style={leadStyle}>
        Two ways to describe the same crosswind: the fixed number legacy
        models use, and the height- and terrain-aware profile the literature
        actually supports.
      </p>

      <div className="wind-panels" style={{ display: "flex", gap: 20 }}>
        <LegacyPanel />
        <LiteraturePanel />
      </div>

      <div style={{ ...panelCard, marginTop: 20 }}>
        <h3 style={h3Style}>Wind speed increases with height and with smoothness</h3>
        <p style={pStyle}>
          Drag the points along the trajectory, and use the slider below, to
          see how surface roughness and height change wind speed.
        </p>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="Side view: wind arrows lengthen with height while draggable points along the shell's arc show wind speed at muzzle, apex, and descent."
          style={{ display: "block", touchAction: "none" }}
        >
          <rect x={0} y={0} width={W} height={groundY} fill="rgba(255,255,255,0.35)" />
          <rect x={0} y={groundY} width={W} height={H - groundY} fill={terrainColor(terrain)} />
          {profile}
          <path d={`M ${P0[0]} ${P0[1]} Q ${Pc[0]} ${Pc[1]} ${P2[0]} ${P2[1]}`} fill="none" stroke={PAL.terra} strokeWidth={2.5} strokeDasharray="2 5" strokeLinecap="round" />

          {pts.map((p) => {
            const [px, py] = bez(p.t);
            const speed = speedAt(p.t);
            return (
              <g
                key={p.id}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture?.(e.pointerId);
                  dragId.current = p.id;
                }}
                style={{ cursor: "ew-resize" }}
                tabIndex={0}
                role="slider"
                aria-label={`${p.label} point, drag along the trajectory`}
                aria-valuenow={Math.round(p.t * 100)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") setPts((prev) => prev.map((q) => (q.id === p.id ? { ...q, t: Math.max(0, q.t - 0.02) } : q)));
                  if (e.key === "ArrowRight") setPts((prev) => prev.map((q) => (q.id === p.id ? { ...q, t: Math.min(1, q.t + 0.02) } : q)));
                }}
              >
                <circle cx={px} cy={py} r={9} fill={PAL.terraBright} opacity={0.16} />
                <circle cx={px} cy={py} r={5} fill={PAL.terraBright} />
                <text x={px} y={py - 16} textAnchor="middle" fontSize={13} fontWeight={700} fill={PAL.text}>
                  {speed.toFixed(1)} m/s
                </text>
                <text x={px} y={py - 2} textAnchor="middle" fontSize={10.5} fill={PAL.text2} transform={`translate(0, ${py < 60 ? 34 : -30})`}>
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
        <div style={{ padding: "4px 4px 0" }}>
          <TerrainSlider terrain={terrain} setTerrain={setTerrain} />
          <p style={{ ...capStyle, marginTop: 8 }}>
            Numbers are representative and do not represent situational accuracy.
          </p>
        </div>
      </div>
      <NextBar onNext={onNext} onBack={onBack} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// PAGE 3 — HASRD wind stratification (new)
// ---------------------------------------------------------------------------
function GroundBand({ y, h }) {
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
function TerrainWindCompare({ kind }) {
  const W = 360, H = 290, groundY = 232, groundH = 58;
  const isLegacy = kind === "legacy";
  const color = isLegacy ? PAL.legacy : PAL.hasrd;
  const heights = [205, 160, 112, 62];
  const regionFactor = [1, 0.66, 0.18];
  const regionCx = [60, 180, 300];
  const arrows = [];
  if (isLegacy) {
    const colsX = [44, 104, 164, 224, 284, 332];
    colsX.forEach((cx, ci) =>
      heights.forEach((hy, hi) => {
        const L = 30;
        arrows.push(<Arrow key={`l${ci}-${hi}`} x1={cx - L / 2} y1={hy} x2={cx + L / 2} y2={hy - 3} color={color} width={2} />);
      })
    );
  } else {
    regionCx.forEach((cx, ri) => {
      heights.forEach((hy, hi) => {
        const heightF = (groundY - hy) / (groundY - heights[3]);
        const L = (10 + 46 * heightF) * regionFactor[ri];
        if (L < 3) return;
        arrows.push(<Arrow key={`h${ri}-${hi}`} x1={cx - L / 2} y1={hy} x2={cx + L / 2} y2={hy - 5 * heightF} color={color} width={2} />);
      });
      const sr = 5 + 7 * regionFactor[ri];
      arrows.push(<Swirl key={`sw${ri}`} cx={cx} cy={groundY - 14} r={sr} color={color} />);
    });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={isLegacy ? "Legacy model: identical wind arrows at every height and over every terrain." : "HASRD model: wind that grows with height and shrinks over rougher ground, plus surface turbulence."} style={{ display: "block" }}>
      <rect x={0} y={0} width={W} height={groundY} fill="rgba(255,255,255,0.35)" />
      <GroundBand y={groundY} h={groundH} />
      {arrows}
      {["Grassy field", "Bushes", "Forest"].map((t, i) => (
        <text key={t} x={60 + i * 120} y={groundY + groundH - 8} textAnchor="middle" fontSize={11} fill="rgba(242,235,216,0.9)">
          {t}
        </text>
      ))}
    </svg>
  );
}
function Screen3({ onNext, onBack }) {
  return (
    <section>
      <h2 style={hStyle}>HASRD wind stratification</h2>
      <p style={leadStyle}>
        The thesis contribution: combine the two pieces above into one model
        that actually knows what it's flying over.
      </p>

      <div style={{ ...panelCard, borderColor: PAL.terra, borderWidth: 2, borderStyle: "solid" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: PAL.terra, marginBottom: 8 }}>
          What makes this special
        </div>
        <ol style={{ ...ulStyle, paddingLeft: 20 }}>
          <li>
            Combine the mathematical representations of height-dependent and
            surface-roughness-dependent wind speed into a single{" "}
            <strong>Height And Surface Roughness Dependent</strong> windspeed
            model.
          </li>
          <li>Layer turbulence on top of that mean profile.</li>
          <li style={{ color: PAL.text2, fontStyle: "italic" }}>
            That's the whole trick.
          </li>
          <li>
            In simulation, this means using{" "}
            <strong>
              global land cover data sets to obtain surface roughness and
              update the mean wind and turbulence signal along the
              trajectory
            </strong>
            .
          </li>
        </ol>
      </div>

      <div className="panels" style={{ display: "flex", gap: 20, marginTop: 20 }}>
        <figure style={panelCard}>
          <TerrainWindCompare kind="legacy" />
          <figcaption style={capStyle}>
            <strong style={{ color: PAL.text }}>Legacy.</strong> The same wind
            everywhere — blind to the ground below.
          </figcaption>
        </figure>
        <figure style={panelCard}>
          <TerrainWindCompare kind="hasrd" />
          <figcaption style={capStyle}>
            <strong style={{ color: PAL.hasrd }}>HASRD.</strong> Wind grows
            with height, shrinks over rougher ground, plus turbulence.
          </figcaption>
        </figure>
      </div>
      <NextBar onNext={onNext} onBack={onBack} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// PAGE 4 — Shooting gallery
// ---------------------------------------------------------------------------
const VW = 760, VH = 430;
const TARGET = { x: 596, y: 215 };
const SCALE = 9;

function Scatter({ pts, color, r = 1.15, opacity = 0.55 }) {
  return (
    <g>
      {pts.map((p, i) => (
        <circle key={i} cx={TARGET.x + p[0] * SCALE} cy={TARGET.y - p[1] * SCALE} r={r} fill={color} opacity={opacity} />
      ))}
    </g>
  );
}
function Ellipse2sig({ sigma, R, color }) {
  const sy = Math.sqrt(Math.pow(sigma * A * rangeDrift(R), 2) + Math.pow(SB * rangeBase(R), 2));
  const sx = SB * rangeBase(R);
  return (
    <ellipse cx={TARGET.x} cy={TARGET.y} rx={Math.max(2, 2 * sx * SCALE)} ry={Math.max(2, 2 * sy * SCALE)} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray="4 4" opacity={0.9} />
  );
}
function Screen4({ terrain, setTerrain, onBack }) {
  const [range, setRange] = useState(3000);
  const [compare, setCompare] = useState(false);
  const [volleySeed, setVolleySeed] = useState(null);
  const [singles, setSingles] = useState([]);
  const [proj, setProj] = useState(null);
  const rafRef = useRef(null);

  const sigma = sigmaForTerrain(terrain);
  const hasrdHit = phit(sigma, range);
  const legacyHit = phit(LEGACY_SIGMA, range);

  const volley = useMemo(() => {
    if (volleySeed == null) return null;
    const out = { hasrd: [], legacy: [] };
    const gH = makeRng(volleySeed).g;
    for (let i = 0; i < 1000; i++) out.hasrd.push(impact(sigma, range, gH));
    if (compare) {
      const gL = makeRng(volleySeed ^ 0x9e3779b9).g;
      for (let i = 0; i < 1000; i++) out.legacy.push(impact(LEGACY_SIGMA, range, gL));
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
    const x0 = 86, y0 = TARGET.y;
    const dur = 520;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 2);
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

  // wind vector triangle — origin, with a minimum visual separation so the
  // total-wind and range legs stay legible even at low crosswind sigma
  const O = { x: 96, y: 158 };
  const rangeLeg = 90;
  const crossLeg = 18 + sigma * 12;
  const tip = { x: O.x + rangeLeg, y: O.y - crossLeg };

  const grid = [];
  for (let gx = 40; gx < VW; gx += 60) grid.push(<line key={`gx${gx}`} x1={gx} y1={20} x2={gx} y2={VH - 20} stroke={PAL.reticle} strokeWidth={1} />);
  for (let gy = 40; gy < VH; gy += 60) grid.push(<line key={`gy${gy}`} x1={20} y1={gy} x2={VW - 20} y2={gy} stroke={PAL.reticle} strokeWidth={1} />);

  return (
    <section>
      <button onClick={onBack} style={backLink}>← back to how it works</button>
      <h2 style={hStyle}>Shooting gallery</h2>
      <p style={{ ...leadStyle, textAlign: "center", margin: "0 auto 14px" }}>
        Fire downrange and watch where the rounds land. Then flip on{" "}
        <em>Compare legacy</em>, drag the terrain, and push the range out to
        3000 m.
      </p>

      <div style={{ background: PAL.viewport, border: `3px solid ${PAL.forest}`, borderRadius: 4, padding: 8 }}>
        <svg
          viewBox={`0 0 ${VW} ${VH}`}
          width="100%"
          role="img"
          aria-label={`Top-down range at ${range} metres over ${terrainName(terrain).toLowerCase()}. HASRD hit probability ${fmtPct(hasrdHit)} percent; the legacy model predicts ${fmtPct(legacyHit)} percent.`}
          style={{ display: "block", background: PAL.viewportField, borderRadius: 2 }}
        >
          <clipPath id="vp"><rect x={10} y={10} width={VW - 20} height={VH - 20} /></clipPath>
          <g clipPath="url(#vp)">
            {grid}
            <line x1={86} y1={TARGET.y} x2={TARGET.x} y2={TARGET.y} stroke={PAL.mono} strokeWidth={1.2} strokeDasharray="6 6" opacity={0.6} />
            <g opacity={0.9}>
              <rect x={70} y={TARGET.y - 9} width={18} height={18} rx={2} fill={PAL.mono} />
              <text x={79} y={TARGET.y + 30} textAnchor="middle" fontSize={10} fontFamily="monospace" fill={PAL.mono}>Shooter</text>
            </g>

            {volley && compare && <Ellipse2sig sigma={LEGACY_SIGMA} R={range} color={PAL.legacy} />}
            {volley && <Ellipse2sig sigma={sigma} R={range} color={PAL.terra} />}
            {volley && compare && <Scatter pts={volley.legacy} color={PAL.legacy} opacity={0.5} />}
            {volley && <Scatter pts={volley.hasrd} color={PAL.terra} opacity={0.6} />}

            {singles.map((p, i) => (
              <circle key={i} cx={TARGET.x + p[0] * SCALE} cy={TARGET.y - p[1] * SCALE} r={2.6} fill={PAL.terraBright} />
            ))}
            {proj && <circle cx={proj.cx} cy={proj.cy} r={3.2} fill={PAL.terraBright} />}

            <g>
              <line x1={TARGET.x - 26} y1={TARGET.y} x2={TARGET.x + 26} y2={TARGET.y} stroke={PAL.mono} strokeWidth={1} opacity={0.7} />
              <line x1={TARGET.x} y1={TARGET.y - 26} x2={TARGET.x} y2={TARGET.y + 26} stroke={PAL.mono} strokeWidth={1} opacity={0.7} />
              <rect x={TARGET.x - HALF * SCALE} y={TARGET.y - HALF * SCALE} width={2 * HALF * SCALE} height={2 * HALF * SCALE} fill="none" stroke={PAL.mono} strokeWidth={1.6} />
              <text x={TARGET.x} y={TARGET.y - HALF * SCALE - 7} textAnchor="middle" fontSize={10} fontFamily="monospace" fill={PAL.mono}>2.3 m target</text>
            </g>

            <g>
              <line x1={O.x} y1={O.y} x2={O.x + rangeLeg} y2={O.y} stroke={PAL.legacy} strokeWidth={2} strokeDasharray="4 4" />
              <text x={O.x + rangeLeg / 2} y={O.y + 16} textAnchor="middle" fontSize={10} fontFamily="monospace" fill={PAL.legacy}>Range</text>
              <Arrow x1={tip.x} y1={O.y} x2={tip.x} y2={tip.y} color={PAL.terraBright} width={3} />
              <text x={tip.x + 8} y={(O.y + tip.y) / 2} fontSize={10} fontFamily="monospace" fill={PAL.terraBright}>Crosswind</text>
              <Arrow x1={O.x} y1={O.y} x2={tip.x} y2={tip.y} color={PAL.hasrd} width={2.5} />
              <text x={O.x - 4} y={O.y + 16} fontSize={10} fontFamily="monospace" fill={PAL.hasrd} textAnchor="end">Total wind</text>
              <Swirl cx={tip.x + 4} cy={tip.y - 4} r={7} color={PAL.hasrd} />
            </g>

            <g fontFamily="monospace" fill={PAL.mono} fontSize={12}>
              <text x={VW - 24} y={36} textAnchor="end">RANGE  {range} m</text>
              <text x={VW - 24} y={54} textAnchor="end">TERRAIN  {terrainName(terrain)}</text>
              <text x={VW - 24} y={72} textAnchor="end">CROSSWIND  {sigma.toFixed(2)} m/s</text>
              <text x={VW - 24} y={90} textAnchor="end" fill={PAL.terra}>P_HIT  {fmtPct(hasrdHit)} %</text>
            </g>
          </g>
        </svg>
      </div>

      <div className="gallery" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
        <div>
          <TerrainSlider terrain={terrain} setTerrain={onTerrain} />
          <div style={{ marginTop: 14 }}>
            <label htmlFor="range" style={sliderLabel}>
              Range <span style={{ color: PAL.text2 }}>{range} m</span>
            </label>
            <input id="range" type="range" min={300} max={3000} step={100} value={range} onChange={(e) => onRange(Number(e.target.value))} style={{ width: "100%" }} aria-label="Range in metres" />
            <div style={tickRow}><span>Short — 300 m</span><span>3000 m</span></div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={fireOne} style={btnPrimary}>Fire one</button>
            <button onClick={() => setVolleySeed((Math.random() * 1e9) | 0)} style={btnSecondary}>Fire volley (1000)</button>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, color: PAL.text }}>
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} aria-label="Compare legacy model" />
            Compare legacy
          </label>
          <button onClick={clearShots} style={btnGhost}>Clear shots</button>
        </div>
      </div>

      <div className="gallery" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
        <StatCard title="Hit probability" big={`${fmtPct(hasrdHit)}%`} sub={`legacy claims ${fmtPct(legacyHit)}%`} />
        <StatCard title="Crosswind speed" big={`${sigma.toFixed(2)} m/s`} sub={`legacy assumes ${LEGACY_SIGMA.toFixed(2)}`} />
      </div>

      <p style={{ ...capStyle, marginTop: 14 }}>
        Push the range short and both groups collapse onto the target — the
        legacy model looks fine. Drag it back to 3000 m and they peel apart:
        over grass the real group is far wider than legacy assumes, over
        forest far tighter.
      </p>
    </section>
  );
}
function StatCard({ title, big, sub }) {
  return (
    <div style={{ background: "#fff", border: `1px solid rgba(110,106,87,0.25)`, borderRadius: 4, padding: "16px 18px" }}>
      <div style={{ fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: PAL.text2 }}>{title}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: PAL.terra, marginTop: 4, lineHeight: 1.1 }}>{big}</div>
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
        Terrain <span style={{ color: PAL.text2 }}>{terrainName(terrain)} · σ {sigmaForTerrain(terrain).toFixed(2)} m/s</span>
      </label>
      <input id="terrain" type="range" min={0} max={1} step={0.01} value={terrain} onChange={(e) => setTerrain(Number(e.target.value))} style={{ width: "100%" }} aria-label="Terrain from grassy field to forest" />
      <div style={tickRow}><span>Grassy field</span><span>Bushes</span><span>Forest</span></div>
    </div>
  );
}
function NextBar({ onNext, onBack }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
      {onBack ? <button onClick={onBack} style={btnGhost}>← back</button> : <span />}
      <button onClick={onNext} style={btnPrimary}>Next →</button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export default function HasrdAdvantage() {
  const [screen, setScreen] = useState(0);
  const [terrain, setTerrain] = useState(0);

  return (
    <div className="hz" style={{ background: PAL.canvas, color: PAL.text, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", minHeight: "100%", padding: "28px 22px 60px" }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        {screen === 0 ? (
          <Intro onStart={() => setScreen(1)} />
        ) : (
          <>
            <Header />
            <Stepper screen={screen} setScreen={setScreen} />
            {screen === 1 && <Screen1 onNext={() => setScreen(2)} />}
            {screen === 2 && <Screen2 terrain={terrain} setTerrain={setTerrain} onNext={() => setScreen(3)} onBack={() => setScreen(1)} />}
            {screen === 3 && <Screen3 onNext={() => setScreen(4)} onBack={() => setScreen(2)} />}
            {screen === 4 && <Screen4 terrain={terrain} setTerrain={setTerrain} onBack={() => setScreen(3)} />}
          </>
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
const h3Style = { fontSize: 15, fontWeight: 700, margin: "0 0 6px" };
const leadStyle = { color: PAL.text2, fontSize: 15, lineHeight: 1.55, maxWidth: 660, margin: "0 0 14px" };
const pStyle = { color: PAL.text, fontSize: 14, lineHeight: 1.6, margin: "0 0 12px" };
const ulStyle = { color: PAL.text, fontSize: 14, lineHeight: 1.7, margin: "0 0 12px", paddingLeft: 20 };
const capStyle = { color: PAL.text2, fontSize: 13, lineHeight: 1.5, margin: 0 };
const panelCard = { background: "#fff", border: "1px solid rgba(110,106,87,0.25)", borderRadius: 4, padding: 16, margin: "0 0 20px" };
const panelHalf = { ...panelCard, flex: 1, margin: 0 };
const sliderLabel = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, letterSpacing: 0.2 };
const tickRow = { display: "flex", justifyContent: "space-between", fontSize: 11, color: PAL.text2, marginTop: 2 };
const btnBase = { border: "none", borderRadius: 3, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", letterSpacing: 0.2 };
const btnPrimary = { ...btnBase, background: PAL.terra, color: "#fff" };
const btnSecondary = { ...btnBase, background: PAL.hasrd, color: "#fff" };
const btnGhost = { ...btnBase, background: "transparent", color: PAL.text2, border: "1px solid rgba(110,106,87,0.4)" };
const backLink = { ...btnBase, background: "transparent", color: PAL.text2, padding: "4px 0", fontWeight: 500, marginBottom: 6 };
const inlineInfoBtn = { background: "none", border: "none", padding: 0, color: PAL.hasrd, fontWeight: 700, textDecoration: "underline", cursor: "pointer", font: "inherit" };

const CSS = `
.hz *{box-sizing:border-box}
.hz button:focus-visible,.hz input:focus-visible{outline:2px solid ${PAL.terra};outline-offset:2px}
.hz input[type=range]{accent-color:${PAL.terra};height:24px}
.hz button{transition:opacity .12s ease}
.hz button:hover{opacity:.88}
@media (max-width:780px){
  .hz .panels{flex-direction:column}
  .hz .wind-panels{flex-direction:column}
  .hz .gallery{grid-template-columns:1fr !important}
}
@media (prefers-reduced-motion:reduce){
  .hz *{animation:none !important;transition:none !important}
}
`;