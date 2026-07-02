import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";

/**
 * The HASRD-ous Advantage
 * Interactive companion to a master's thesis on wind modeling for direct-fire
 * ballistics (Paola Kefallinos, Northeastern University, 2024).
 *
 * Pages: 0 Intro (unnumbered) -> 1 Ballistic Simulations Background
 * -> 2 Wind Background -> 3 HASRD Wind Stratification -> 4 Shooting Gallery
 *
 * Self-contained. No backend, no browser storage. All numbers hardcoded and
 * calibrated to reproduce the published thesis results (verified by Monte Carlo).
 */

// ---------------------------------------------------------------------------
// Palette — "clean military": olive canvas, cream panels, dark brown text
// ---------------------------------------------------------------------------
const PAL = {
  canvas: "#5f6a4f",
  canvasText: "#F4F0E2",
  canvasMuted: "#C7C4A4",
  panel: "#FBF8EE",
  text: "#482e16",
  text2: "#8A7A5F",
  wind: "#AFD4E8",
  windLineA: "#8FC2E0",
  windLineB: "#5E97BE",
  windLineC: "#375E7A",
  windPop: "#7FC7EE",
  turbulence: "#D98BA6",
  turbulenceDeep: "#B85C7C",
  legacy: "#A7A488",
  legacyBlues: ["#CFE0EC", "#8FB7D6", "#4E7FA3"], // calm / proving / combat
  legacyPop: "#C9CDC2",
  terra: "#A8512F",
  terraBright: "#EA7A2E",
  grass: "#78985b",
  bushes: "#5c7350",
  forest: "#3c5535",
  viewport: "#1E2216",
  viewportField: "#252A1B",
  reticle: "rgba(200,210,180,0.18)",
  mono: "#EFEBDA",
};
const DOTTED = "1 8";
const TRAJ_WIDTH = 3;

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
  if (t < 0.25) return "Grassy Field";
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
  const sy = Math.sqrt(Math.pow(sigma * A * rangeDrift(R), 2) + Math.pow(SB * rangeBase(R), 2));
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
const fmtPct = (p) => (p * 100).toFixed(1);
const reduceMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function hexRgb(h) {
  h = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}
function rgbHex(a) {
  return "#" + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function lerpHex(a, b, t) {
  const A2 = hexRgb(a), B2 = hexRgb(b);
  return rgbHex(A2.map((v, i) => v + (B2[i] - v) * t));
}
function terrainColor(t) {
  return t <= 0.5 ? lerpHex(PAL.grass, PAL.bushes, t / 0.5) : lerpHex(PAL.bushes, PAL.forest, (t - 0.5) / 0.5);
}

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
function DottedPath({ d, color = PAL.terraBright, width = TRAJ_WIDTH }) {
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeDasharray={DOTTED} strokeLinecap="round" />;
}
function TargetSquare({ x, y, size = 18, crosshair, crosshairColor = PAL.text2, labelBelow, labelColor }) {
  // filled terracotta square, sharp corners; optional crosshair drawn on top
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} fill={PAL.terraBright} stroke={PAL.terra} strokeWidth={1.5} />
      {crosshair && (
        <g opacity={0.9}>
          <line x1={x - 8} y1={y + size / 2} x2={x + size + 8} y2={y + size / 2} stroke={crosshairColor} strokeWidth={1} />
          <line x1={x + size / 2} y1={y - 8} x2={x + size / 2} y2={y + size + 8} stroke={crosshairColor} strokeWidth={1} />
        </g>
      )}
      {labelBelow && (
        <text x={x + size / 2} y={y + size + 16} textAnchor="middle" fontSize={12} fontWeight={700} fill={labelColor || PAL.text2}>
          {labelBelow}
        </text>
      )}
    </g>
  );
}
function Swirl({ cx, cy, r = 10, color, width = 1.6, turns = 2.4 }) {
  const N = 48;
  let d = "";
  for (let i = 0; i <= N; i++) {
    const f = i / N;
    const theta = f * turns * 2 * Math.PI;
    const rad = r * (1 - f) + 0.6;
    const x = cx + rad * Math.cos(theta);
    const y = cy + rad * Math.sin(theta);
    d += `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return <path d={d} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" opacity={0.9} />;
}
function FlowBox({ x, y, w, h, fill, stroke, children, fontSize = 12, bold, color, lines, tooltip }) {
  const cy = y + h / 2;
  return (
    <g style={{ cursor: tooltip ? "help" : "default" }}>
      {tooltip && <title>{tooltip}</title>}
      <rect x={x} y={y} width={w} height={h} rx={3} fill={fill} stroke={stroke} strokeWidth={1.2} />
      {lines ? (
        <text x={x + w / 2} y={cy - (lines.length - 1) * fontSize * 0.6} textAnchor="middle" fontSize={fontSize} fontWeight={bold ? 700 : 400} fill={color || PAL.text}>
          {lines.map((ln, i) => (
            <tspan key={i} x={x + w / 2} dy={i === 0 ? 0 : fontSize * 1.2}>{ln}</tspan>
          ))}
        </text>
      ) : (
        <text x={x + w / 2} y={cy + fontSize * 0.35} textAnchor="middle" fontSize={fontSize} fontWeight={bold ? 700 : 400} fill={color || PAL.text}>
          {children}
        </text>
      )}
    </g>
  );
}
function FlowArrow({ x1, y1, x2, y2, color = PAL.text2 }) {
  return <Arrow x1={x1} y1={y1} x2={x2} y2={y2} color={color} width={2} />;
}
function ToggleSwitch({ checked, onChange, label }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", cursor: "pointer", padding: 0 }}
    >
      <span style={{ width: 40, height: 22, borderRadius: 11, background: checked ? PAL.terraBright : "rgba(149, 117, 104, 0.25)", position: "relative", transition: "background .15s", flexShrink: 0 }}>
        <span style={{ position: "absolute", top: 2, left: checked ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .15s" }} />
      </span>
      <span style={{ fontSize: 14, color: PAL.text, fontWeight: 600 }}>{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------
const STEPS = [
  "1 · Ballistic Simulations Background",
  "2 · Wind Background",
  "3 · HASRD Wind Stratification",
  "4 · Shooting Gallery",
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
              color: active ? PAL.canvasText : PAL.canvasMuted,
              fontWeight: active ? 600 : 400,
              fontSize: 12.5,
              letterSpacing: 0.2,
              borderTop: `2px solid ${active ? PAL.terraBright : "rgba(244,240,226,0.25)"}`,
            }}
          >
            {label}
          </button>
        );
      })}
    </nav>
  );
}
function HomeLink({ onHome }) {
  return (
    <button onClick={onHome} style={{ ...btnBase, background: "none", color: PAL.canvasMuted, padding: "0 0 10px", fontSize: 12.5, fontWeight: 600 }}>
      ⌂ Home
    </button>
  );
}

// ---------------------------------------------------------------------------
// Header — eyebrow + H1 (used on pages 1-4 only; intro has its own title)
// ---------------------------------------------------------------------------
const EYEBROW_WORDS = ["Height", "And", "Surface", "Roughness", "Dependent"];
function Header() {
  return (
    <header style={{ marginBottom: 18, textAlign: "center" }}>
      <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", color: PAL.terraBright }}>
        {EYEBROW_WORDS.map((w) => (
          <span key={w}>
            <strong>{w[0]}</strong>
            {w.slice(1)}{" "}
          </span>
        ))}
        <span>Wind</span>
      </div>
      <h1 style={{ fontSize: 30, margin: "4px 0 0", fontWeight: 700, letterSpacing: -0.5, color: PAL.canvasText }}>
        The HASRD-ous Advantage
      </h1>
    </header>
  );
}

// ---------------------------------------------------------------------------
// INTRO PAGE (unnumbered)
// ---------------------------------------------------------------------------
function IntroSim() {
  const rm = reduceMotion();
  const W = 640, H = 220, groundY = 190;
  const tankX = 60, targetX = 560;
  const targetSize = 28;
  const path = `M ${tankX + 5} ${groundY - 10} Q ${W / 2} 40 ${targetX} ${groundY - targetSize / 2}`;
  const dur = "3s";
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Animated simulation: a tank fires a round that lands on the target and registers a hit." style={{ display: "block" }}>
      <line x1={20} y1={groundY} x2={W - 20} y2={groundY} stroke={PAL.text2} strokeWidth={1.5} />
      <DottedPath d={path} color={PAL.windLineB} />
      <rect x={tankX - 18} y={groundY - 20} width={36} height={20} rx={2} fill={PAL.text} />
      <text x={tankX} y={groundY + 20} textAnchor="middle" fontSize={12} fontWeight={700} fill={PAL.text2}>Tank</text>
      <TargetSquare x={targetX - targetSize / 2} y={groundY - targetSize} size={targetSize} labelBelow="Target" />

      {rm ? (
        <>
          <circle cx={targetX} cy={groundY - targetSize / 2} r={6} fill={PAL.text} />
          <g>
            <rect x={targetX - 34} y={40} width={70} height={30} rx={4} fill={PAL.terra} />
            <text x={targetX + 1} y={60} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff">Hit!</text>
          </g>
        </>
      ) : (
        <>
          <circle r={6} fill={PAL.text}>
            <animateMotion dur={dur} repeatCount="indefinite" keyPoints="0;1;1" keyTimes="0;0.85;1" calcMode="linear" path={path} />
          </circle>
          <g opacity={0}>
            <rect x={targetX - 34} y={30} width={70} height={30} rx={4} fill={PAL.terra}>
              <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.84;0.87;0.98;1" dur={dur} repeatCount="indefinite" />
            </rect>
            <text x={targetX + 1} y={50} textAnchor="middle" fontSize={15} fontWeight={700} fill="#fff">
              Hit!
              <animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;0.84;0.87;0.98;1" dur={dur} repeatCount="indefinite" />
            </text>
          </g>
        </>
      )}
    </svg>
  );
}
function Intro({ onStart }) {
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center", padding: "40px 6px" }}>
      <h1 style={{ fontSize: 26, lineHeight: 1.35, fontWeight: 700, margin: "0 0 22px", letterSpacing: -0.3, color: PAL.panel }}>
        The Effect of Surface Roughness on Crosswind Drift and Probability of
        Hit for Large Caliber Direct-Fire Ballistics
      </h1>
      <p style={{ margin: "0 0 4px", fontSize: 15, color: PAL.canvasMuted }}>
        Results from a Master's thesis by <strong>Paola Kefallinos</strong>
      </p>
      <p style={{ margin: "0 0 26px", fontSize: 13.5, color: PAL.canvasMuted }}>
        Department of Mechanical and Industrial Engineering · Northeastern University
      </p>

      <p style={{ color: PAL.canvasText, margin: "0 auto 22px", maxWidth: 700, fontSize: 14.5, lineHeight: 1.6, textAlign: "center" }}>
        This study presents a Height and Surface Roughness Dependent (HASRD)
        wind model that dynamically integrates mean wind stratification,
        turbulence, and global land cover data to predict ballistic
        trajectory with greater accuracy than legacy models. The new model
        produces statistically significant improvements in downrange
        deflection and first-round hit probability predictions, with the
        most dramatic effects on terrain featuring extreme surface
        roughness profiles. By capturing how terrain influences wind speed
        and variability, the HASRD approach enhances weapon system
        accuracy for direct fire engagement across diverse geographic and
        climatic conditions.
      </p>

      <div style={{ ...panelCard, textAlign: "left", maxWidth: 660, margin: "0 auto 26px" }}>
        <IntroSim />
      </div>

      <button onClick={onStart} style={{ ...btnPrimary, fontSize: 15, padding: "12px 28px" }}>
        Get Started →
      </button>

      <p style={{ marginTop: 30, fontSize: 11.5, color: PAL.canvasMuted }}>
        © 2024 Paola Kefallinos · Northeastern University
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PAGE 1 — Ballistic Simulations Background
// ---------------------------------------------------------------------------
function NumberBadge({ n }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: "50%", background: PAL.terra, color: "#fff", fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}>
      {n}
    </span>
  );
}
function PanelTitle({ n, children }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
        <NumberBadge n={n} />
      </div>
      <h3 style={{ ...h3Style, margin: 0 }}>{children}</h3>
    </div>
  );
}
function TrajectoryGif() {
  const rm = reduceMotion();
  const groundY = 140;
  const path = `M 45 ${groundY-5} Q 180 20 335 ${groundY}`;
  return (
    <svg viewBox="0 25 360 160" width="100%" role="img" aria-label="Animated trajectory arc governed by Newton's second law: a tank fires a round toward a target." style={{ display: "block" }}>
      <line x1={20} y1={groundY} x2={340} y2={groundY} stroke={PAL.text2} strokeWidth={1.5} />
      <DottedPath d={path} color={PAL.windLineB} width={2} />
      <rect x={30} y={groundY - 14} width={26} height={14} rx={2} fill={PAL.text} />
      <TargetSquare x={320} y={groundY - 17} size={16} />
      {!rm ? (
        <circle r={5} fill={PAL.text}>
          <animateMotion dur="2.4s" repeatCount="indefinite" path={path} />
        </circle>
      ) : (
        <circle cx={180} cy={35} r={5} fill={PAL.text} />
      )}
    </svg>
  );
}
function stackYs(centerY, n, h, gap) {
  const total = n * h + (n - 1) * gap;
  const top = centerY - total / 2;
  return Array.from({ length: n }, (_, i) => top + i * (h + gap));
}
const TOOLTIPS = {
  "Atmospheric Conditions": "Inputs include air density, temperature, wind speed, altitude.",
  Ballistics: "Inputs include muzzle velocity, ballistic coefficient, drag coefficient, Mach number.",
  Range: "Distance to target.",
  "Super Elevation": "Angle of initial trajectory (at muzzle).",
  "Time of Flight": "The time the round is in the air.",
};
const TOOLTIP_LINES = {
  "Atmospheric Conditions": ["Inputs include air density,", "temperature, wind speed, altitude."],
  Ballistics: ["Inputs include muzzle velocity,", "ballistic coefficient, drag", "coefficient, Mach number."],
  Range: ["Distance to target."],
  "Super Elevation": ["Angle of initial trajectory", "(at muzzle)."],
  "Time of Flight": ["The time the round is in the air."],
};
function TooltipBubble({ x, y, w, lines }) {
  const lh = 14, pad = 8;
  const boxH = lines.length * lh + pad * 2;
  const boxW = Math.max(150, w + 24);
  const bx = x + w / 2 - boxW / 2;
  const by = y - boxH - 12;
  return (
    <g pointerEvents="none">
      <rect x={bx} y={by} width={boxW} height={boxH} rx={4} fill="#2E2C22" opacity={0.96} />
      <polygon points={`${x + w / 2 - 6},${by + boxH} ${x + w / 2 + 6},${by + boxH} ${x + w / 2},${by + boxH + 8}`} fill="#2E2C22" opacity={0.96} />
      {lines.map((ln, i) => (
        <text key={i} x={bx + boxW / 2} y={by + pad + (i + 0.8) * lh} textAnchor="middle" fontSize={10.5} fill="#F4F0E2">{ln}</text>
      ))}
    </g>
  );
}
function FlowDiagram({ mode }) {
  const real = mode === "real";
  const [hover, setHover] = useState(null);
  const margin = 16, inputW = 168, modelW = 190, outputW = 168, arrowGap = 36;
  const W = margin + inputW + arrowGap + modelW + arrowGap + outputW + margin;
  const H = 260;
  const centerY = 96;
  const inputH = 22, inputGap = 8;
  const inputLabels = real
    ? ["Atmospheric Conditions", "Ballistics", "Range", "Error Budgets"]
    : ["Atmospheric Conditions", "Ballistics", "Range"];
  const inputYs = stackYs(centerY, inputLabels.length, inputH, inputGap);
  const inputX = margin;

  const modelX = margin + inputW + arrowGap;
  const modelH = 78;
  const modelY = centerY - modelH / 2;

  const outputX = modelX + modelW + arrowGap;
  const outputYs = real ? [centerY - 22] : stackYs(centerY, 2, inputH, inputGap);
  const groundY = H - 28;

  const hoverLines = hover ? TOOLTIP_LINES[hover] : null;
  const hoverRect =
    hover && !real
      ? hover === "Super Elevation"
        ? { x: outputX, y: outputYs[0], w: outputW }
        : hover === "Time of Flight"
        ? { x: outputX, y: outputYs[1], w: outputW }
        : { x: inputX, y: inputYs[inputLabels.indexOf(hover)], w: inputW }
      : null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={real ? "Real world: inputs plus error budgets feed the model, producing a probability of hit and a possible miss." : "Ideal world: inputs feed the model, producing super elevation and time of flight. Hover the boxes for definitions."} style={{ display: "block" }}>
      <text x={W / 2} y={20} textAnchor="middle" fontSize={13} fontWeight={700} fill={real ? PAL.terra : PAL.windLineC}>
        {real ? "Real World" : "Ideal World"}
      </text>

      {inputLabels.map((lab, i) => {
        const isErr = real && i === inputLabels.length - 1;
        const hasTip = !real;
        return (
          <g key={lab} onMouseEnter={() => hasTip && setHover(lab)} onMouseLeave={() => hasTip && setHover(null)} style={{ cursor: hasTip ? "help" : "default" }}>
            <FlowBox x={inputX} y={inputYs[i]} w={inputW} h={inputH} fill={isErr ? "#F4E3D2" : "#EFEAD9"} stroke={isErr ? PAL.terra : PAL.windLineB} color={isErr ? PAL.terra : PAL.text} bold={isErr} fontSize={11.5}>
              {lab}
            </FlowBox>
          </g>
        );
      })}

      <FlowArrow x1={inputX + inputW} y1={centerY} x2={modelX} y2={centerY} />
      <FlowBox x={modelX} y={modelY} w={modelW} h={modelH} fill="#fff" stroke={PAL.text} bold fontSize={13} lines={["Ballistic Simulation", "Model"]} />
      <FlowArrow x1={modelX + modelW} y1={centerY} x2={outputX} y2={centerY} />

      {real ? (
        <FlowBox x={outputX} y={outputYs[0]} w={outputW} h={44} fill="#F4E3D2" stroke={PAL.terra} color={PAL.terra} bold fontSize={13}>
          Probability of Hit
        </FlowBox>
      ) : (
        <>
          <g onMouseEnter={() => setHover("Super Elevation")} onMouseLeave={() => setHover(null)} style={{ cursor: "help" }}>
            <FlowBox x={outputX} y={outputYs[0]} w={outputW} h={inputH} fill="#E9F0F4" stroke={PAL.windLineB} fontSize={11.5}>Super Elevation</FlowBox>
          </g>
          <g onMouseEnter={() => setHover("Time of Flight")} onMouseLeave={() => setHover(null)} style={{ cursor: "help" }}>
            <FlowBox x={outputX} y={outputYs[1]} w={outputW} h={inputH} fill="#E9F0F4" stroke={PAL.windLineB} fontSize={11.5}>Time of Flight</FlowBox>
          </g>
        </>
      )}

      {hoverRect && hoverLines && <TooltipBubble x={hoverRect.x} y={hoverRect.y} w={hoverRect.w} lines={hoverLines} />}

      <line x1={40} y1={groundY} x2={W - 40} y2={groundY} stroke={PAL.text2} strokeWidth={1.5} />
      <rect x={44} y={groundY - 14} width={28} height={14} rx={2} fill={PAL.text} />
      <text x={58} y={groundY + 16} textAnchor="middle" fontSize={12} fontWeight={700} fill={PAL.text2}>Tank</text>

      {real ? (
        <>
          <DottedPath d={`M 74 ${groundY-15} Q ${W / 2} ${groundY - 130} ${W - 220} ${groundY}`} color={PAL.terraBright} />
          <line x1={W - 226} y1={groundY - 10} x2={W - 214} y2={groundY + 10} stroke={PAL.text} strokeWidth={2.5} />
          <line x1={W - 214} y1={groundY - 10} x2={W - 226} y2={groundY + 10} stroke={PAL.text} strokeWidth={2.5} />
          <text x={W - 220} y={groundY - 20} textAnchor="middle" fontSize={11} fontWeight={700} fill={PAL.text}>Miss</text>
          <TargetSquare x={W - 122} y={groundY - 18} size={18} labelBelow="Target" />
        </>
      ) : (
        <>
          <DottedPath d={`M 73 ${groundY-15} Q ${W / 2} ${groundY - 130} ${W - 104} ${groundY}`} color={PAL.windLineC} />
          <TargetSquare x={W - 122} y={groundY - 18} size={18} labelBelow="Target" />
        </>
      )}
    </svg>
  );
}

function CrosswindDiagram() {
  const W = 660, H = 240;
  const lineY = 150, tankX = 66, targetX = 566;
  // deflected trajectory pushed UP above the line of fire (real-world behavior)
  const missX = 500, missY = 92;
  const bez = (t) => {
    const p0 = [tankX, lineY], pc = [330, lineY - 90], p1 = [missX, missY];
    return [
      (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * pc[0] + t ** 2 * p1[0],
      (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * pc[1] + t ** 2 * p1[1],
    ];
  };
  const path = Array.from({ length: 25 }, (_, i) => bez(i / 24));
  const d = path.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const windArrows = [0.15, 0.32, 0.5, 0.68, 0.85].map((t) => bez(t));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Top-down view: crosswind pushes the round upward, away from the straight line of fire, causing it to land short of and above the target." style={{ display: "block" }}>
      <text x={W / 2} y={18} textAnchor="middle" fontSize={11.5} fontWeight={700} fill={PAL.text2} style={{ textTransform: "uppercase", letterSpacing: 1 }}>
        Top-Down View
      </text>

      <line x1={tankX + 6} y1={lineY} x2={targetX - 20} y2={lineY} stroke={PAL.text2} strokeWidth={1.5} strokeDasharray="10 6" opacity={0.8} />
      <text x={(tankX + targetX) / 2} y={lineY + 20} textAnchor="middle" fontSize={11} fill={PAL.text2}>Line of Fire</text>

      <DottedPath d={d} color={PAL.terraBright} />

      {windArrows.map((p, i) => (
        <Arrow key={i} x1={p[0]} y1={p[1] + 22} x2={p[0]} y2={p[1] } color={PAL.windLineB} width={2.6} />
      ))}
      <text x={windArrows[2][0] + 10} y={windArrows[2][1] + 40} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={PAL.windLineB}>Crosswind</text>

      <rect x={tankX - 14} y={lineY - 7} width={26} height={14} rx={2} fill={PAL.text} />
      <text x={tankX} y={lineY + 25} textAnchor="middle" fontSize={12} fontWeight={700} fill={PAL.text2}>Tank</text>

      <TargetSquare x={targetX - 18} y={lineY - 18} size={36} crosshair labelBelow="Target" />

      <line x1={missX - 8} y1={missY - 8} x2={missX + 8} y2={missY + 8} stroke={PAL.text} strokeWidth={2.5} />
      <line x1={missX + 8} y1={missY - 8} x2={missX - 8} y2={missY + 8} stroke={PAL.text} strokeWidth={2.5} />
      <text x={missX} y={missY - 14} textAnchor="middle" fontSize={11} fontWeight={700} fill={PAL.text}>Miss</text>
    </svg>
  );
}

function Screen1({ onNext }) {
  return (
    <section>
      <h2 style={hStyle}>Ballistic Simulations Background</h2>
      <p style={sectionLead}>A quick four-step description of ballistic simulations and sources of error.</p>

      <div style={panelCard}>
        <PanelTitle n={1}>Trajectories Follow Newton's Second Law</PanelTitle>
        <p style={pStyle}>
          At its core, a ballistic model is a basic physics problem: apply
          Newton's second law to a projectile under gravity, drag, and
          initial velocity to trace its arc from muzzle to target.
        </p>
        <TrajectoryGif />
      </div>

      <div style={panelCard}>
        <PanelTitle n={2}>Models Simulate Engagements With Different Inputs</PanelTitle>
        <p style={pStyle}>
          Simulations are initialized with atmospheric conditions, ballistic
          properties of the round, and the range to target, to produce
          outputs like super elevation
          and time of flight. Hover over the boxes below to learn more!
        </p>
        <FlowDiagram mode="ideal" />
      </div>

      <div style={panelCard}>
        <PanelTitle n={3}>Unfortunately, the Real World Isn't Ideal!</PanelTitle>
        <p style={pStyle}>
          Every one of those inputs carries measurement error and
          assumptions. This phenomenon is represented by the addition of
          error budgets — and a round fired with "perfect" inputs can still
          miss. Ballistic models typically report this as a{" "}
          <strong>probability of hit</strong>.
        </p>
        <FlowDiagram mode="real" />
      </div>

      <div style={panelCard}>
        <PanelTitle n={4}>One of Those Errors: Crosswind Drift</PanelTitle>
        <p style={pStyle}>
          The component of wind perpendicular to the line of fire forces the
          round off its path and can turn a hit into a miss. At certain
          ranges, eliminating crosswind error alone is enough to flip the
          outcome. Minimizing this error comes down to how well we can
          estimate the wind throughout the trajectory of the round.
        </p>
        <CrosswindDiagram />
      </div>

      <NextBar onNext={onNext} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// PAGE 2 — Wind Background
// ---------------------------------------------------------------------------
const LEGACY_CONDITIONS = [
  { key: "calm", label: "Calm Day", sigma: 1.0, color: PAL.legacyBlues[0] },
  { key: "proving", label: "Proving Grounds", sigma: 1.9, color: PAL.legacyBlues[1] },
  { key: "combat", label: "Quasi Combat", sigma: 3.35, color: PAL.legacyBlues[2] },
];
function GaussianBars({ sigma, color = PAL.terra }) {
  const W = 340, H = 190, midX = W / 2, base = H - 26, maxH = 118;
  const bars = [];
  const nb = 17, span = 9;
  for (let i = 0; i < nb; i++) {
    const v = -span + (2 * span * i) / (nb - 1);
    const dens = Math.exp(-(v * v) / (2 * sigma * sigma)) / (sigma * Math.sqrt(2 * Math.PI));
    const h = Math.min(maxH, dens * sigma * 2.6 * maxH);
    const x = midX + (v / span) * (W / 2 - 20) - (W / (nb * 2.6));
    bars.push(<rect key={i} x={x} y={base - h} width={W / (nb * 1.3)} height={h} fill={color} opacity={0.9} />);
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Bell-shaped histogram of crosswind speed, mean 0, standard deviation ${sigma} metres per second.`} style={{ display: "block" }}>
      <text x={midX} y={15} textAnchor="middle" fontSize={12.5} fontWeight={700} fill={PAL.text}>Legacy Wind Model</text>
      <text x={midX} y={28} textAnchor="middle" fontSize={11.5} fill={PAL.text2}>μ = 0, σ = {sigma.toFixed(2)} m/s</text>
      <line x1={20} y1={base} x2={W - 20} y2={base} stroke={PAL.text2} strokeWidth={1} />
      {bars}
      <text x={midX} y={base + 18} textAnchor="middle" fontSize={10.5} fill={PAL.text2}>Wind Speed (m/s)</text>
    </svg>
  );
}
function LegacyPanel() {
  const [cond, setCond] = useState(LEGACY_CONDITIONS[0]);
  return (
    <div style={panelHalf}>
      <h3 style={h3Style}>Legacy Description of Wind</h3>
      <p style={pStyle}>
        Legacy ballistic models typically treat crosswind as an average or
        constant speed, normally distributed with mean 0 and a standard
        deviation set by the firing condition.
      </p>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "nowrap" }}>
        {LEGACY_CONDITIONS.map((c) => (
          <button
            key={c.key}
            onClick={() => setCond(c)}
            style={{
              ...btnBase,
              flex: 1,
              padding: "7px 6px",
              fontSize: 11.5,
              background: c.color,
              color: PAL.text,
              border: cond.key === c.key ? `2px solid ${PAL.text}` : "2px solid transparent",
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <GaussianBars sigma={cond.sigma} color={cond.color} />
    </div>
  );
}

function MeanWindChart() {
  const W = 320, H = 230, baseX = 52, baseY = 168, topY = 20;
  const curves = [
    { a: 3.2, color: PAL.windLineC, dash: "2 4", label: "Forest" },
    { a: 1.7, color: PAL.windLineB, dash: "6 4", label: "Bushes" },
    { a: 0.75, color: PAL.windLineA, dash: undefined, label: "Grassy Field" },

  ];
  const pathFor = (a) => {
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const f = i / 30;
      const height = 2*a * Math.pow(f, 3);
      const x = baseX + f * (W - baseX - 20);
      const y = baseY - height*(baseY - topY);
      pts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return pts.join(" ");
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Mean wind speed grows with height as a cubic function, fastest over smooth terrain and slowest over rough terrain." style={{ display: "block" }}>
      <line x1={baseX} y1={topY} x2={baseX} y2={baseY} stroke={PAL.text2} strokeWidth={1} />
      <line x1={baseX} y1={baseY} x2={W - 16} y2={baseY} stroke={PAL.text2} strokeWidth={1} />
      <text x={12} y={(topY + baseY) / 2} fontSize={13} fontWeight={600} fill={PAL.text2} transform={`rotate(-90 12 ${(topY + baseY) / 2})`} textAnchor="middle">Height (m)</text>
      <text x={(baseX + W - 16) / 2} y={H-30} fontSize={13} fontWeight={600} fill={PAL.text2} textAnchor="middle">Wind Speed (m/s)</text>
      {curves.map((c) => (
        <path key={c.label} d={pathFor(c.a)} fill="none" stroke={c.color} strokeWidth={2.6} strokeDasharray={c.dash} />
      ))}
      <g transform={`translate(${baseX + 10}, ${topY + 6})`}>
        {curves.map((c, i) => (
          <g key={c.label} transform={`translate(0, ${i * 17})`}>
            <line x1={0} y1={0} x2={18} y2={0} stroke={c.color} strokeWidth={2.6} strokeDasharray={c.dash} />
            <text x={22} y={4} fontSize={12} fontWeight={600} fill={PAL.text2}>{c.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
function TurbulenceSquiggle() {
  const W = 320, H = 230, baseX = 52, baseY = 168, topY = 20;
  const rows = [
    { color: PAL.turbulence, seed: 1, opacity: 0.9 },
    { color: PAL.turbulenceDeep, seed: 2, opacity: 0.6 },
    { color: PAL.turbulence, seed: 3, opacity: 0.5 },
  ];
  const pathFor = (seed) => {
    let pts = [];
    let y = (topY + baseY) / 2;
    let s = seed * 97;
    const rnd = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    for (let x = baseX; x <= W - 16; x += 6) {
      y += (rnd() - 0.5) * 22;
      y = Math.max(topY + 6, Math.min(baseY - 6, y));
      pts.push(`${x === baseX ? "M" : "L"} ${x} ${y.toFixed(1)}`);
    }
    return pts.join(" ");
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Noisy turbulence signal fluctuating around the mean wind." style={{ display: "block" }}>
      <line x1={baseX} y1={topY} x2={baseX} y2={baseY} stroke={PAL.text2} strokeWidth={1} />
      <line x1={baseX} y1={baseY} x2={W - 16} y2={baseY} stroke={PAL.text2} strokeWidth={1} />
      <text x={12} y={(topY + baseY) / 2} fontSize={13} fontWeight={600} fill={PAL.text2} transform={`rotate(-90 12 ${(topY + baseY) / 2})`} textAnchor="middle">Mean Wind Speed (m/s)</text>
      <text x={(baseX + W - 16) / 2} y={H - 30} fontSize={13} fontWeight={600} fill={PAL.text2} textAnchor="middle">Range (m)</text>
      {rows.map((r) => (
        <path key={r.seed} d={pathFor(r.seed)} fill="none" stroke={r.color} strokeWidth={1.6} opacity={r.opacity} />
      ))}
      <line x1={baseX} y1={(topY + baseY) / 2} x2={W - 16} y2={(topY + baseY) / 2} stroke={PAL.text2} strokeDasharray="3 4" strokeWidth={1} opacity={0.5} />
    </svg>
  );
}
function LiteraturePanel() {
  const [open, setOpen] = useState(false);
  return (
    <div style={panelHalf}>
      <h3 style={h3Style}>Literature-Informed Wind Profiles</h3>
      <p style={pStyle}>
        Wind can be thought of as having two components: a DC signal and
        noise. Together, they capture both the average push on a round and
        the small, rapid fluctuations around it.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 4 }}>
            <svg width="18" height="10" aria-hidden="true"><line x1="0" y1="5" x2="18" y2="5" stroke={PAL.windLineB} strokeWidth="3" /></svg>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: PAL.text2 }}>DC Signal</span>
          </div>
          <MeanWindChart />
          <p style={{ ...capStyle, minHeight: 56, marginBottom: open ? 8 : 0 }}>
            Mean wind speed is a function of height and{" "}
            <button onClick={() => setOpen((o) => !o)} style={inlineInfoBtn} aria-expanded={open}>
              surface roughness
            </button>
            .
          </p>
          {open && (
            <div style={{ background: "#fff", border: "1px solid rgba(59,46,34,0.18)", borderRadius: 4, padding: 10, marginTop: 8, marginBottom: 6 }}>
              <p style={{ ...capStyle, margin: 0 }}>
                Surface roughness is a measure of terrain &amp; vegetation. It
                is estimable nearly everywhere via satellite imagery of
                ground cover.
              </p>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 4 }}>
            <svg width="18" height="14" aria-hidden="true"><Swirl cx={9} cy={7} r={6} color={PAL.turbulence} width={1.6} /></svg>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: PAL.text2 }}>Noise</span>
          </div>
          <TurbulenceSquiggle />
          <p style={{ ...capStyle, minHeight: 56, marginBottom: 0 }}>
            The literature also has{" "}
            <button onClick={() => setOpen((o) => !o)} style={inlineInfoBtn} aria-expanded={open}>
              well-developed methods 
            </button>
              . to estimate wind turbulence.
          </p>
          {open && (
            <div style={{ background: "#fff", border: "1px solid rgba(59,46,34,0.18)", borderRadius: 4, padding: 10, marginTop: 8, marginBottom: 6 }}>
              <p style={{ ...capStyle, margin: 0 }}>
                Typically a Von Karman spectral model with 
                stochastic elements is used (can be thought 
                of as a Fast Fourier Transform for wind!) 
              </p>
            </div>
             )}
        </div>
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
        <Arrow key={`p${ci}-${ri}`} x1={cx - L / 2} y1={ry} x2={cx + L / 2} y2={ry - 4 * heightF} color={PAL.windLineB} width={2.4} opacity={1} />
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
  const endDrag = useCallback(() => { dragId.current = null; }, []);
  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endDrag);
    };
  }, [onPointerMove, endDrag]);

  const groundBottom = groundY + 12; // target sits exactly on the ground line

  return (
    <section>
      <h2 style={hStyle}>Wind Background</h2>
      <p style={sectionLead}>
        Two ways to describe the same crosswind: the fixed number legacy
        models use, and the height- and terrain-aware profile the literature
        actually supports.
      </p>

      <div className="wind-panels" style={{ display: "flex", gap: 20 }}>
        <LegacyPanel />
        <LiteraturePanel />
      </div>

      <div style={{ ...panelCard, marginTop: 20 }}>
        <h3 style={h3Style}>Wind Speed Increases With Height but Decreases With Roughness</h3>
        <p style={pStyle}>
          Drag the points along the trajectory and use the slider below, to
          see how wind speed changes with height above the ground and
          surface roughness.
        </p>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="Side view: a tank fires toward a target while wind arrows lengthen with height; draggable points along the shell's arc show wind speed at muzzle, apex, and descent."
          style={{ display: "block", touchAction: "none" }}
        >
          <rect x={0} y={0} width={W} height={groundY} fill="rgba(255,255,255,0.35)" />
          <rect x={0} y={groundY} width={W} height={H - groundY} fill={terrainColor(terrain)} />
          {profile}
          <DottedPath d={`M ${P0[0]} ${P0[1]} Q ${Pc[0]} ${Pc[1]} ${P2[0]} ${P2[1]}`} color={PAL.terraBright} />

          <rect x={P0[0] - 26} y={P0[1] - 14} width={28} height={14} rx={2} fill={PAL.text} />
          <text x={P0[0] - 12} y={P0[1] + 30} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">Tank</text>
          <TargetSquare x={P2[0] - 9} y={groundY - 18} size={18} />
          <text x={P2[0]} y={groundY + 30} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">Target</text>

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
                <circle cx={px} cy={py} r={9} fill={PAL.text} opacity={0.16} />
                <circle cx={px} cy={py} r={5} fill={PAL.text} />
                <text x={px} y={py - 16} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={PAL.text}>
                  {speed.toFixed(1)} m/s
                </text>
                <text x={px} y={py - 2} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={PAL.text} transform={`translate(0, ${py < 60 ? 34 : -30})`}>
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
// PAGE 3 — HASRD Wind Stratification
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
  const W = 360, H = 260, groundY = 202, groundH = 58;
  const isLegacy = kind === "legacy";
  const color = isLegacy ? PAL.legacy : PAL.wind;
  const heights = [175, 132, 88, 44];
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
      heights.forEach((hy) => {
        const heightF = (groundY - hy) / (groundY - heights[3]);
        const L = (10 + 46 * heightF) * regionFactor[ri];
        if (L < 3) return;
        arrows.push(<Arrow key={`h${ri}-${hy}`} x1={cx - L / 2} y1={hy} x2={cx + L / 2} y2={hy - 5 * heightF} color={color} width={2} />);
      });
      const sr = 5 + 7 * regionFactor[ri];
      arrows.push(<Swirl key={`sw${ri}`} cx={cx} cy={groundY - 16} r={sr} color={PAL.turbulence} />);
    });
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={isLegacy ? "Legacy model: identical wind arrows at every height and over every terrain." : "HASRD model: wind that grows with height and shrinks over rougher ground, plus surface turbulence."} style={{ display: "block" }}>
      <rect x={0} y={0} width={W} height={groundY} fill="rgba(255,255,255,0.35)" />
      <GroundBand y={groundY} h={groundH} />
      {arrows}
      {["Grassy Field", "Bushes", "Forest"].map((t, i) => (
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
      <h2 style={hStyle}>HASRD Wind Stratification</h2>
      <p style={sectionLead}>
        Incorporates height and surface dependency into one equation to improve situational accuracy.
      </p>

      <div style={{ ...panelCard, borderColor: PAL.terra, borderWidth: 2, borderStyle: "solid" }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: PAL.terra, marginBottom: 10 }}>
          Thesis Contribution
        </div>
        <p style={pStyle}>
          <strong>1</strong> — Develops a single mathematical model to create
          a <strong>Height And Surface Roughness Dependent (HASRD) average
          windspeed</strong>.
        </p>
        <p style={pStyle}>
          <strong>2</strong> — Enables the use of{" "}
          <strong>global land cover data sets</strong> to obtain surface
          roughness and update the mean wind and turbulence signal along the
          trajectory <strong>to enhance situational accuracy</strong>.
        </p>
      </div>

      <div className="panels" style={{ display: "flex", gap: 20, marginTop: 20, alignItems: "stretch" }}>
        <figure style={{ ...panelCard, margin: 0, flex: 1, display: "flex", flexDirection: "column" }}>
          <figcaption style={{ ...h3Style, textAlign: "center", marginBottom: 8 }}>Legacy</figcaption>
          <TerrainWindCompare kind="legacy" />
          <p style={{ ...capStyle, minHeight: 44, marginTop: 8, textAlign: "center" }}>
            The same wind everywhere — blind to the ground below.
          </p>
        </figure>
        <figure style={{ ...panelCard, margin: 0, flex: 1, display: "flex", flexDirection: "column" }}>
          <figcaption style={{ ...h3Style, textAlign: "center", marginBottom: 8, color: PAL.windLineB }}>HASRD</figcaption>
          <TerrainWindCompare kind="hasrd" />
          <p style={{ ...capStyle, minHeight: 44, marginTop: 8, textAlign: "center" }}>
            Wind increases with height, decreases over rougher ground, and has turbulence.
          </p>
        </figure>
      </div>
      <NextBar onNext={onNext} onBack={onBack} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// PAGE 4 — Shooting Gallery
// ---------------------------------------------------------------------------
const VW = 760, VH = 330;
const TARGET = { x: 596, y: 165 };
const SCALE = 8;

function Scatter({ pts, color, r = 1.1, opacity = 0.6 }) {
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
    <ellipse cx={TARGET.x} cy={TARGET.y} rx={Math.max(2, 2 * sx * SCALE)} ry={Math.max(2, 2 * sy * SCALE)} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="4 4" opacity={0.95} />
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

  const clearShots = () => { setSingles([]); setVolleySeed(null); };
  const onTerrain = (v) => { setTerrain(v); setSingles([]); };
  const onRange = (v) => { setRange(v); setSingles([]); };

  const fireOne = useCallback(() => {
    const [x, y] = impact(sigma, range, gauss);
    const tx = TARGET.x + x * SCALE;
    const ty = TARGET.y - y * SCALE;
    const land = () => setSingles((s) => [...s.slice(-40), [x, y]]);
    if (reduceMotion()) { land(); return; }
    const start = performance.now();
    const x0 = 86, y0 = TARGET.y;
    const dur = 520;
    const tick = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 2);
      setProj({ cx: x0 + (tx - x0) * e, cy: y0 + (ty - y0) * e });
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
      else { setProj(null); land(); }
    };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
  }, [sigma, range]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const O = { x: 96, y: 118 };
  const rangeLeg = 90;
  const crossLeg = 16 + sigma * 10;
  const tip = { x: O.x + rangeLeg, y: O.y - crossLeg };

  const grid = [];
  for (let gx = 40; gx < VW; gx += 60) grid.push(<line key={`gx${gx}`} x1={gx} y1={20} x2={gx} y2={VH - 20} stroke={PAL.reticle} strokeWidth={1} />);
  for (let gy = 40; gy < VH; gy += 60) grid.push(<line key={`gy${gy}`} x1={20} y1={gy} x2={VW - 20} y2={gy} stroke={PAL.reticle} strokeWidth={1} />);

  return (
    <section>
      <h2 style={hStyle}>Shooting Gallery</h2>
      <p style={sectionLead}>
        Change the inputs below and observe how it changes where the rounds
        land. Toggle "Compare Legacy" to see how the legacy description of
        wind differs from the HASRD.
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
            <text x={VW / 2} y={26} textAnchor="middle" fontSize={11} fontFamily="monospace" fill={PAL.mono} style={{ letterSpacing: 1.5, textTransform: "uppercase" }}>Top-Down View</text>
            <line x1={86} y1={TARGET.y} x2={TARGET.x} y2={TARGET.y} stroke={PAL.mono} strokeWidth={1.2} strokeDasharray="6 6" opacity={0.6} />
            <g opacity={0.9}>
              <rect x={70} y={TARGET.y - 9} width={18} height={18} rx={2} fill={PAL.mono} />
              <text x={79} y={TARGET.y + 30} textAnchor="middle" fontSize={12} fontWeight={700} fontFamily="monospace" fill={PAL.mono}>Tank</text>
            </g>

            {volley && compare && <Ellipse2sig sigma={LEGACY_SIGMA} R={range} color={PAL.legacyPop} />}
            {volley && <Ellipse2sig sigma={sigma} R={range} color={PAL.terraBright} />}
            {volley && compare && <Scatter pts={volley.legacy} color={PAL.legacyPop} opacity={0.55} />}
            {volley && <Scatter pts={volley.hasrd} color={PAL.mono} opacity={0.75} />}

            {singles.map((p, i) => (
              <circle key={i} cx={TARGET.x + p[0] * SCALE} cy={TARGET.y - p[1] * SCALE} r={2.6} fill={PAL.mono} />
            ))}
            {proj && <circle cx={proj.cx} cy={proj.cy} r={3} fill={PAL.mono} />}

            <TargetSquare x={TARGET.x - HALF * SCALE} y={TARGET.y - HALF * SCALE} size={2 * HALF * SCALE} crosshair crosshairColor={PAL.mono} />
            <text x={TARGET.x} y={TARGET.y + HALF * SCALE + 20} textAnchor="middle" fontSize={12} fontWeight={700} fontFamily="monospace" fill={PAL.mono}>2.3 x 2.3 m Target</text>

            <g>
              <line x1={O.x} y1={O.y} x2={O.x + rangeLeg} y2={O.y} stroke={PAL.legacyPop} strokeWidth={2.2} strokeDasharray="4 4" />
              <text x={O.x + rangeLeg / 2} y={O.y + 16} textAnchor="middle" fontSize={10} fontFamily="monospace" fill={PAL.legacyPop}>Range Wind</text>
              {/* crosswind leg */}
              <Arrow x1={tip.x} y1={O.y} x2={tip.x} y2={tip.y} color={PAL.terraBright} width={3} />
              <text x={tip.x + 8} y={(O.y + tip.y) / 2} fontSize={10} fontFamily="monospace" fill={PAL.terraBright}>Crosswind</text>
              {/* total wind — drawn last so the hypotenuse reads clearly on top */}
              <Arrow x1={O.x} y1={O.y} x2={tip.x} y2={tip.y} color={PAL.windPop} width={2.8} />
              <text x={O.x - 4} y={O.y + 16} fontSize={10} fontFamily="monospace" fill={PAL.windPop} textAnchor="end">Total Wind</text>
              <Swirl cx={tip.x + 4} cy={tip.y - 4} r={7} color={PAL.turbulence} />
            </g>

            <g fontFamily="monospace" fill={PAL.mono} fontSize={12}>
              <text x={VW - 24} y={44} textAnchor="end">RANGE  {range} m</text>
              <text x={VW - 24} y={62} textAnchor="end">TERRAIN  {terrainName(terrain)}</text>
              <text x={VW - 24} y={80} textAnchor="end">CROSSWIND  σ = {sigma.toFixed(2)} m/s</text>
              <text x={VW - 24} y={98} textAnchor="end" fill={PAL.terraBright}>P_HIT  {fmtPct(hasrdHit)} %</text>
            </g>
          </g>
        </svg>
      </div>

      <div style={{ ...panelCard, marginTop: 18, marginBottom: 0 }}>
        <div className="gallery" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <div>
            <TerrainSlider terrain={terrain} setTerrain={onTerrain} />
            <div style={{ marginTop: 14 }}>
              <label htmlFor="range" style={sliderLabel}>
                Range <span style={{ color: PAL.text2 }}>{range} m</span>
              </label>
              <input id="range" type="range" min={300} max={3000} step={100} value={range} onChange={(e) => onRange(Number(e.target.value))} style={{ width: "100%", accentColor: PAL.terraBright }} aria-label="Range in metres" />
              <div style={tickRow}><span>Short — 300 m</span><span>3000 m</span></div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={fireOne} style={{ ...btnPrimary, background: PAL.terraBright }}>Fire One</button>
              <button onClick={() => setVolleySeed((Math.random() * 1e9) | 0)} style={{ ...btnSecondary, background: PAL.windPop, color: PAL.text }}>Fire Volley (1000)</button>
            </div>
            <ToggleSwitch checked={compare} onChange={setCompare} label="Compare Legacy" />
            <button onClick={clearShots} style={btnGhostCard}>Clear Shots</button>
          </div>
        </div>
      </div>

      <div className="gallery" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, marginTop: 18 }}>
        <StatCard title="Hit Probability" big={`${fmtPct(hasrdHit)}%`} sub={`legacy claims ${fmtPct(legacyHit)}%`} color={PAL.terraBright} />
        <StatCard title="Crosswind Speed" big={`σ = ${sigma.toFixed(2)} m/s`} sub={`legacy assumes σ = ${LEGACY_SIGMA.toFixed(2)}`} color={PAL.terraBright} />
      </div>

      <p style={{ ...capStyle, marginTop: 14, color: PAL.canvasMuted }}>
        Illustrative — impact scatter is generated, calibrated to reproduce
        published thesis results (range 3000 m, 2.3 m target).
      </p>

      <NextBar onNext={undefined} onBack={onBack} />
    </section>
  );
}
function StatCard({ title, big, sub, color = PAL.terra }) {
  return (
    <div style={{ background: PAL.panel, border: `1px solid rgba(59,46,34,0.18)`, borderRadius: 4, padding: "16px 18px" }}>
      <div style={{ fontSize: 12, letterSpacing: 0.4, textTransform: "uppercase", color: PAL.text2 }}>{title}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color, marginTop: 4, lineHeight: 1.1 }}>{big}</div>
      <div style={{ fontSize: 13, color: PAL.legacy, marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared controls
// ---------------------------------------------------------------------------
function TerrainSlider({ terrain, setTerrain }) {
  return (
    <div>
      <label htmlFor="terrain" style={sliderLabel}>
        Terrain <span style={{ color: PAL.text2 }}>{terrainName(terrain)} · σ = {sigmaForTerrain(terrain).toFixed(2)} m/s</span>
      </label>
      <input id="terrain" type="range" min={0} max={1} step={0.01} value={terrain} onChange={(e) => setTerrain(Number(e.target.value))} style={{ width: "100%" }} aria-label="Terrain from grassy field to forest" />
      <div style={tickRow}><span>Grassy Field</span><span>Bushes</span><span>Forest</span></div>
    </div>
  );
}
function NextBar({ onNext, onBack }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 24 }}>
      {onBack ? <button onClick={onBack} style={btnGhostOnCanvas}>← Back</button> : <span />}
      {onNext ? <button onClick={onNext} style={btnPrimary}>Next →</button> : <span />}
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
    <div className="hz" style={{ background: PAL.canvas, color: PAL.canvasText, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", minHeight: "100%", padding: "28px 22px 60px" }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        {screen === 0 ? (
          <Intro onStart={() => setScreen(1)} />
        ) : (
          <>
            <HomeLink onHome={() => setScreen(0)} />
            <Header />
            <Stepper screen={screen} setScreen={setScreen} />
            {screen === 1 && <Screen1 onNext={() => setScreen(2)} />}
            {screen === 2 && <Screen2 terrain={terrain} setTerrain={setTerrain} onNext={() => setScreen(3)} onBack={() => setScreen(1)} />}
            {screen === 3 && <Screen3 onNext={() => setScreen(4)} onBack={() => setScreen(2)} />}
            {screen === 4 && <Screen4 terrain={terrain} setTerrain={setTerrain} onBack={() => setScreen(3)} />}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------
const hStyle = { fontSize: 21, fontWeight: 700, margin: "4px 0 6px", letterSpacing: -0.3, color: PAL.canvasText };
const h3Style = { fontSize: 16.5, fontWeight: 700, margin: "0 0 6px", color: PAL.text, textAlign: "center" };
const sectionLead = { color: PAL.canvasMuted, fontSize: 15, lineHeight: 1.55, maxWidth: 720, margin: "0 auto 16px", textAlign: "center" };
const pStyle = { color: PAL.text, fontSize: 15, lineHeight: 1.62, margin: "0 0 12px" };
const capStyle = { color: PAL.text2, fontSize: 14, lineHeight: 1.55, margin: 0 };
const panelCard = { background: PAL.panel, border: "1px solid rgba(59,46,34,0.18)", borderRadius: 4, padding: 16, margin: "0 0 20px", color: PAL.text };
const panelHalf = { ...panelCard, flex: 1, margin: 0 };
const sliderLabel = { display: "block", fontSize: 13.5, fontWeight: 600, marginBottom: 6, letterSpacing: 0.2, color: PAL.text };
const tickRow = { display: "flex", justifyContent: "space-between", fontSize: 11.5, color: PAL.text2, marginTop: 2 };
const btnBase = { border: "none", borderRadius: 3, padding: "9px 16px", fontSize: 14, fontWeight: 600, cursor: "pointer", letterSpacing: 0.2 };
const btnPrimary = { ...btnBase, background: PAL.terra, color: "#fff" };
const btnSecondary = { ...btnBase, background: PAL.windLineC, color: "#fff" };
const btnGhostOnCanvas = { ...btnBase, background: "transparent", color: PAL.canvasText, border: "1px solid rgba(244,240,226,0.5)" };
const btnGhostCard = { ...btnBase, background: "transparent", color: PAL.text2, border: "1px solid rgba(59,46,34,0.35)" };
const backLink = { ...btnBase, background: "transparent", color: PAL.canvasText, padding: "4px 0", fontWeight: 500, marginBottom: 6 };
const inlineInfoBtn = { background: "none", border: "none", padding: 0, color: PAL.windLineC, fontWeight: 700, textDecoration: "underline", cursor: "pointer", font: "inherit" };

const CSS = `
.hz *{box-sizing:border-box}
.hz button:focus-visible,.hz input:focus-visible{outline:2px solid ${PAL.terraBright};outline-offset:2px}
.hz input[type=range]{accent-color:${PAL.terraBright};height:24px}
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
