import { escapeHtml, MOTION_PALETTES, type MotionPalette, type MotionPaletteId } from "./motion.ts";
import {
  type BarChartVisual,
  type BigStatVisual,
  type CompareTableVisual,
  type DiagramVisual,
  type ExplainerVisual,
  type SpectrumVisual,
  type TimelineVisual,
} from "./explainer.ts";
import { renderSvgIcon } from "./explainerIcons.ts";

/**
 * Task 029: Standalone HTML/CSS/JS compositions for the 6 technical infographic templates.
 * 1080×1920 (9:16), safe areas respected, offline only (no external CDN or fonts),
 * with timeline scrubbing hooks for HyperFrames CLI. Pure.
 */

export interface RenderTemplateOptions {
  durationSeconds: number;
  paletteId?: MotionPaletteId;
}

export function renderInfographicHtml(visual: ExplainerVisual, opts: RenderTemplateOptions): string {
  const pal: MotionPalette = MOTION_PALETTES[opts.paletteId ?? "cyber_yellow"] ?? MOTION_PALETTES.cyber_yellow;
  const duration = Math.max(1, Math.min(30, opts.durationSeconds || 5));

  let bodyContent = "";
  let scriptContent = "";

  switch (visual.template) {
    case "spectrum":
      ({ bodyContent, scriptContent } = buildSpectrumHtml(visual, pal, duration));
      break;
    case "compare_table":
      ({ bodyContent, scriptContent } = buildCompareTableHtml(visual, pal, duration));
      break;
    case "bar_chart":
      ({ bodyContent, scriptContent } = buildBarChartHtml(visual, pal, duration));
      break;
    case "big_stat":
      ({ bodyContent, scriptContent } = buildBigStatHtml(visual, pal, duration));
      break;
    case "timeline":
      ({ bodyContent, scriptContent } = buildTimelineHtml(visual, pal, duration));
      break;
    case "diagram":
      ({ bodyContent, scriptContent } = buildDiagramHtml(visual, pal, duration));
      break;
  }

  return `<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=1080, height=1920, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 1080px;
      height: 1920px;
      overflow: hidden;
      background: ${pal.bg};
      color: ${pal.fg};
      font-family: "Noto Sans", "Segoe UI", Roboto, system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    #main-container {
      position: relative;
      width: 1080px;
      height: 1920px;
      padding: 160px 72px 280px 72px; /* TikTok safe area */
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
    }
    .main-title {
      font-size: 56px;
      font-weight: 900;
      line-height: 1.15;
      text-align: center;
      margin-bottom: 48px;
      color: ${pal.accent};
      text-shadow: 0 4px 16px rgba(0,0,0,0.4);
      letter-spacing: -0.5px;
      max-width: 936px;
    }
    .badge {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 9999px;
      font-size: 24px;
      font-weight: 700;
      background: ${pal.cardBg};
      border: 1px solid ${pal.secondary};
      color: ${pal.secondary};
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <div id="main-container" data-composition-id="main" data-duration="${duration}">
    ${bodyContent}
  </div>
  <script>
    (function() {
      var duration = ${duration};
      var t = 0;
      ${scriptContent}
      window.__timelines = {
        main: {
          duration: function() { return duration; },
          totalDuration: function() { return duration; },
          seek: function(sec) { renderFrame(Math.max(0, Math.min(duration, Number(sec) || 0))); return this; },
          time: function(sec) { if (typeof sec === "number") { return this.seek(sec); } return t; },
          progress: function(p) { if (typeof p === "number") { return this.seek(p * duration); } return t / duration; },
          pause: function() { return this; },
          play: function() { return this; }
        }
      };
      renderFrame(0);
    })();
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------- Template 1: Spectrum

function buildSpectrumHtml(v: SpectrumVisual, pal: MotionPalette, duration: number) {
  const bandsHtml = v.bands
    .map((band, idx) => {
      const isHigh = band.highlight;
      const channelsHtml = band.channels
        .map(
          (c) => `
        <div class="channel-pill ${c.highlight ? "chan-high" : ""}">
          <span class="chan-label">${escapeHtml(c.label)}</span>
          <span class="chan-width">${escapeHtml(c.width)}</span>
        </div>`,
        )
        .join("");

      return `
      <div id="band-${idx}" class="band-card ${isHigh ? "band-high" : ""}">
        <div class="band-header">
          <span class="band-name">${escapeHtml(band.name)}</span>
          <span class="band-freq">${escapeHtml(band.freq)}</span>
        </div>
        <div class="channels-row">${channelsHtml}</div>
      </div>`;
    })
    .join("");

  const bodyContent = `
    <span class="badge">SPEKTRUM FREKUENSI</span>
    <h1 class="main-title">${escapeHtml(v.title)}</h1>
    <div class="spectrum-container">${bandsHtml}</div>
    <style>
      .spectrum-container { width: 936px; display: flex; flex-direction: column; gap: 32px; margin-top: 20px; }
      .band-card {
        background: ${pal.cardBg};
        border: 2px solid rgba(255,255,255,0.08);
        border-radius: 24px;
        padding: 32px;
        display: flex;
        flex-direction: column;
        gap: 20px;
        transition: transform 0.3s ease, border-color 0.3s ease;
      }
      .band-high {
        border-color: ${pal.accent};
        background: rgba(255, 230, 0, 0.08);
        box-shadow: 0 0 32px rgba(255, 230, 0, 0.2);
      }
      .band-header { display: flex; justify-content: space-between; align-items: baseline; }
      .band-name { font-size: 38px; font-weight: 800; color: ${pal.fg}; }
      .band-freq { font-size: 32px; font-weight: 700; color: ${pal.accent}; }
      .channels-row { display: flex; flex-wrap: wrap; gap: 16px; }
      .channel-pill {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 14px;
        padding: 12px 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .chan-high {
        background: ${pal.secondary};
        color: #000;
        font-weight: 800;
        border-color: ${pal.secondary};
      }
      .chan-label { font-size: 22px; font-weight: 600; }
      .chan-width { font-size: 26px; font-weight: 800; }
    </style>`;

  const scriptContent = `
    function renderFrame(sec) {
      t = sec;
      var count = ${v.bands.length};
      for (var i = 0; i < count; i++) {
        var el = document.getElementById("band-" + i);
        if (!el) continue;
        var startT = i * 0.4;
        var p = Math.max(0, Math.min(1, (sec - startT) / 0.5));
        el.style.opacity = p;
        el.style.transform = "translateY(" + ((1 - p) * 40) + "px) scale(" + (0.95 + 0.05 * p) + ")";
      }
    }`;

  return { bodyContent, scriptContent };
}

// ---------------------------------------------------------------- Template 2: Compare Table

function buildCompareTableHtml(v: CompareTableVisual, pal: MotionPalette, duration: number) {
  const headerHtml = v.headers.map((h, i) => `<th class="${i === v.headers.length - 1 ? "head-winner" : ""}">${escapeHtml(h)}</th>`).join("");

  const rowsHtml = v.rows
    .map((r, rIdx) => {
      const cellsHtml = r.values
        .map((val, cIdx) => {
          const isWinner = r.winner_index !== undefined && cIdx === r.winner_index;
          return `<td class="${isWinner ? "cell-winner" : ""}">${escapeHtml(val)}</td>`;
        })
        .join("");

      return `
      <tr id="row-${rIdx}" class="compare-row">
        <td class="cell-feature">${escapeHtml(r.feature)}</td>
        ${cellsHtml}
      </tr>`;
    })
    .join("");

  const bodyContent = `
    <span class="badge">PERBANDINGAN TERPERINCI</span>
    <h1 class="main-title">${escapeHtml(v.title)}</h1>
    <div class="table-wrap">
      <table class="compare-table">
        <thead>
          <tr>
            <th class="head-feature">Spesifikasi</th>
            ${headerHtml}
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    </div>
    <style>
      .table-wrap { width: 936px; margin-top: 10px; }
      .compare-table {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0 16px;
      }
      th {
        padding: 16px 20px;
        font-size: 28px;
        font-weight: 800;
        text-align: left;
        color: ${pal.muted};
      }
      .head-winner { color: ${pal.accent}; }
      .compare-row {
        background: ${pal.cardBg};
        border-radius: 18px;
        transition: transform 0.3s ease, opacity 0.3s ease;
      }
      td {
        padding: 24px 20px;
        font-size: 28px;
        font-weight: 600;
        border-top: 1px solid rgba(255,255,255,0.06);
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      td:first-child {
        border-left: 1px solid rgba(255,255,255,0.06);
        border-top-left-radius: 18px;
        border-bottom-left-radius: 18px;
      }
      td:last-child {
        border-right: 1px solid rgba(255,255,255,0.06);
        border-top-right-radius: 18px;
        border-bottom-right-radius: 18px;
      }
      .cell-feature { font-weight: 700; color: ${pal.fg}; }
      .cell-winner {
        color: ${pal.accent};
        font-weight: 800;
        background: rgba(255, 230, 0, 0.12);
      }
    </style>`;

  const scriptContent = `
    function renderFrame(sec) {
      t = sec;
      var count = ${v.rows.length};
      for (var i = 0; i < count; i++) {
        var el = document.getElementById("row-" + i);
        if (!el) continue;
        var startT = 0.3 + i * 0.5;
        var p = Math.max(0, Math.min(1, (sec - startT) / 0.4));
        el.style.opacity = p;
        el.style.transform = "translateX(" + ((1 - p) * 50) + "px)";
      }
    }`;

  return { bodyContent, scriptContent };
}

// ---------------------------------------------------------------- Template 3: Bar Chart

function buildBarChartHtml(v: BarChartVisual, pal: MotionPalette, duration: number) {
  const maxVal = Math.max(...v.bars.map((b) => b.value)) || 1;

  const barsHtml = v.bars
    .map((b, idx) => {
      const pct = Math.round((b.value / maxVal) * 100);
      return `
      <div id="bar-col-${idx}" class="bar-col">
        <div id="val-text-${idx}" class="val-text">${escapeHtml(b.value_text ?? `${b.value} ${v.unit}`)}</div>
        <div class="bar-track">
          <div id="bar-fill-${idx}" class="bar-fill ${b.highlight ? "fill-high" : ""}" data-pct="${pct}"></div>
        </div>
        <div class="bar-label">${escapeHtml(b.label)}</div>
      </div>`;
    })
    .join("");

  const bodyContent = `
    <span class="badge">CARTA PRESTASI (${escapeHtml(v.unit)})</span>
    <h1 class="main-title">${escapeHtml(v.title)}</h1>
    <div class="chart-container">${barsHtml}</div>
    <style>
      .chart-container {
        width: 936px;
        height: 800px;
        margin-top: 60px;
        display: flex;
        justify-content: space-around;
        align-items: flex-end;
        padding-bottom: 60px;
        border-bottom: 2px solid rgba(255,255,255,0.12);
      }
      .bar-col {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: ${Math.floor(800 / v.bars.length)}px;
        gap: 16px;
      }
      .bar-track {
        width: 110px;
        height: 600px;
        background: rgba(255,255,255,0.04);
        border-radius: 20px;
        display: flex;
        align-items: flex-end;
        overflow: hidden;
      }
      .bar-fill {
        width: 100%;
        height: 0%;
        background: ${pal.secondary};
        border-radius: 20px 20px 0 0;
        transition: height 0.1s linear;
      }
      .fill-high {
        background: ${pal.accent};
        box-shadow: 0 0 30px rgba(255, 230, 0, 0.4);
      }
      .val-text { font-size: 32px; font-weight: 800; color: ${pal.fg}; }
      .bar-label { font-size: 26px; font-weight: 700; color: ${pal.muted}; text-align: center; margin-top: 12px; }
    </style>`;

  const scriptContent = `
    function renderFrame(sec) {
      t = sec;
      var count = ${v.bars.length};
      for (var i = 0; i < count; i++) {
        var fill = document.getElementById("bar-fill-" + i);
        var txt = document.getElementById("val-text-" + i);
        if (!fill) continue;
        var maxPct = Number(fill.getAttribute("data-pct")) || 10;
        var startT = i * 0.3;
        var p = Math.max(0, Math.min(1, (sec - startT) / 0.6));
        // easeOutCubic
        var ease = 1 - Math.pow(1 - p, 3);
        fill.style.height = (maxPct * ease) + "%";
        if (txt) {
          txt.style.opacity = p;
          txt.style.transform = "translateY(" + ((1 - ease) * 20) + "px)";
        }
      }
    }`;

  return { bodyContent, scriptContent };
}

// ---------------------------------------------------------------- Template 4: Big Stat

function buildBigStatHtml(v: BigStatVisual, pal: MotionPalette, duration: number) {
  const bodyContent = `
    <span class="badge">ANGKA UTAMA</span>
    <div class="bigstat-box">
      <div id="stat-num" class="stat-number">${escapeHtml(v.number)}</div>
      ${v.unit ? `<div class="stat-unit">${escapeHtml(v.unit)}</div>` : ""}
      <div id="stat-label" class="stat-label">${escapeHtml(v.label)}</div>
      ${v.subtitle ? `<div id="stat-sub" class="stat-sub">${escapeHtml(v.subtitle)}</div>` : ""}
    </div>
    <style>
      .bigstat-box {
        width: 936px;
        margin-top: 140px;
        background: ${pal.cardBg};
        border: 2px solid ${pal.accent};
        border-radius: 36px;
        padding: 80px 48px;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        box-shadow: 0 0 60px rgba(255, 230, 0, 0.15);
      }
      .stat-number {
        font-size: 140px;
        font-weight: 900;
        line-height: 1;
        color: ${pal.accent};
        letter-spacing: -2px;
      }
      .stat-unit { font-size: 48px; font-weight: 800; color: ${pal.secondary}; margin-top: 12px; }
      .stat-label { font-size: 46px; font-weight: 800; color: ${pal.fg}; margin-top: 36px; max-width: 800px; }
      .stat-sub { font-size: 30px; font-weight: 500; color: ${pal.muted}; margin-top: 20px; max-width: 760px; line-height: 1.4; }
    </style>`;

  const scriptContent = `
    function renderFrame(sec) {
      t = sec;
      var el = document.getElementById("stat-num");
      var lbl = document.getElementById("stat-label");
      var sub = document.getElementById("stat-sub");
      var p = Math.max(0, Math.min(1, sec / 0.6));
      var scale = 0.6 + 0.4 * (1 - Math.pow(1 - p, 3));
      if (el) {
        el.style.transform = "scale(" + scale + ")";
        el.style.opacity = p;
      }
      if (lbl) lbl.style.opacity = Math.max(0, Math.min(1, (sec - 0.3) / 0.4));
      if (sub) sub.style.opacity = Math.max(0, Math.min(1, (sec - 0.5) / 0.4));
    }`;

  return { bodyContent, scriptContent };
}

// ---------------------------------------------------------------- Template 5: Timeline

function buildTimelineHtml(v: TimelineVisual, pal: MotionPalette, duration: number) {
  const pointsHtml = v.points
    .map((p, idx) => {
      const isLeft = idx % 2 === 0;
      return `
      <div id="point-${idx}" class="timeline-item ${isLeft ? "item-left" : "item-right"}">
        <div class="point-dot ${p.highlight ? "dot-high" : ""}"></div>
        <div class="point-card ${p.highlight ? "card-high" : ""}">
          <span class="point-year">${escapeHtml(p.year)}</span>
          <span class="point-title">${escapeHtml(p.title)}</span>
          ${p.desc ? `<p class="point-desc">${escapeHtml(p.desc)}</p>` : ""}
        </div>
      </div>`;
    })
    .join("");

  const bodyContent = `
    <span class="badge">GARIS MASA PERKEMBANGAN</span>
    <h1 class="main-title">${escapeHtml(v.title)}</h1>
    <div class="timeline-container">
      <div class="center-line"></div>
      ${pointsHtml}
    </div>
    <style>
      .timeline-container {
        position: relative;
        width: 936px;
        margin-top: 40px;
        display: flex;
        flex-direction: column;
        gap: 40px;
      }
      .center-line {
        position: absolute;
        top: 20px;
        bottom: 20px;
        left: 50%;
        width: 4px;
        background: rgba(255,255,255,0.12);
        transform: translateX(-50%);
      }
      .timeline-item {
        position: relative;
        display: flex;
        width: 100%;
        align-items: center;
      }
      .item-left { justify-content: flex-start; padding-right: 52%; }
      .item-right { justify-content: flex-end; padding-left: 52%; }
      .point-dot {
        position: absolute;
        left: 50%;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: ${pal.secondary};
        transform: translate(-50%, 0);
        z-index: 2;
      }
      .dot-high { background: ${pal.accent}; box-shadow: 0 0 20px ${pal.accent}; }
      .point-card {
        background: ${pal.cardBg};
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 20px;
        padding: 24px 28px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
      }
      .card-high { border-color: ${pal.accent}; background: rgba(255, 230, 0, 0.08); }
      .point-year { font-size: 24px; font-weight: 800; color: ${pal.accent}; }
      .point-title { font-size: 32px; font-weight: 800; color: ${pal.fg}; }
      .point-desc { font-size: 22px; font-weight: 500; color: ${pal.muted}; margin: 0; line-height: 1.3; }
    </style>`;

  const scriptContent = `
    function renderFrame(sec) {
      t = sec;
      var count = ${v.points.length};
      for (var i = 0; i < count; i++) {
        var el = document.getElementById("point-" + i);
        if (!el) continue;
        var startT = i * 0.5;
        var p = Math.max(0, Math.min(1, (sec - startT) / 0.4));
        el.style.opacity = p;
        el.style.transform = "translateY(" + ((1 - p) * 30) + "px)";
      }
    }`;

  return { bodyContent, scriptContent };
}

// ---------------------------------------------------------------- Template 6: Diagram

function buildDiagramHtml(v: DiagramVisual, pal: MotionPalette, duration: number) {
  const nodesHtml = v.nodes
    .map((n, idx) => {
      const svg = renderSvgIcon(n.icon, 52, pal.accent);
      return `
      <div id="node-${idx}" class="diagram-node">
        <div class="node-icon">${svg}</div>
        <div class="node-label">${escapeHtml(n.label)}</div>
      </div>`;
    })
    .join("");

  const arrowsHtml = v.arrows
    .map((a, idx) => `
      <div id="arrow-${idx}" class="arrow-item">
        <div class="arrow-line">
          ${renderSvgIcon("router", 28, pal.secondary)}
        </div>
        ${a.label ? `<span class="arrow-label">${escapeHtml(a.label)}</span>` : ""}
      </div>`)
    .join("");

  const bodyContent = `
    <span class="badge">ALIRAN SISTEM</span>
    <h1 class="main-title">${escapeHtml(v.title)}</h1>
    <div class="diagram-container">
      <div class="nodes-grid">${nodesHtml}</div>
      <div class="arrows-row">${arrowsHtml}</div>
    </div>
    <style>
      .diagram-container {
        width: 936px;
        margin-top: 60px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 40px;
      }
      .nodes-grid {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 36px;
        width: 100%;
      }
      .diagram-node {
        background: ${pal.cardBg};
        border: 2px solid rgba(255,255,255,0.1);
        border-radius: 28px;
        padding: 36px 32px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        width: 260px;
        text-align: center;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      }
      .node-icon {
        width: 90px;
        height: 90px;
        border-radius: 50%;
        background: rgba(255, 230, 0, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .node-label { font-size: 28px; font-weight: 800; color: ${pal.fg}; }
      .arrows-row { display: flex; gap: 24px; align-items: center; margin-top: 20px; }
      .arrow-item { display: flex; align-items: center; gap: 8px; color: ${pal.secondary}; }
      .arrow-label { font-size: 24px; font-weight: 700; color: ${pal.muted}; }
    </style>`;

  const scriptContent = `
    function renderFrame(sec) {
      t = sec;
      var count = ${v.nodes.length};
      for (var i = 0; i < count; i++) {
        var el = document.getElementById("node-" + i);
        if (!el) continue;
        var startT = i * 0.4;
        var p = Math.max(0, Math.min(1, (sec - startT) / 0.4));
        el.style.opacity = p;
        el.style.transform = "scale(" + (0.7 + 0.3 * p) + ")";
      }
    }`;

  return { bodyContent, scriptContent };
}
