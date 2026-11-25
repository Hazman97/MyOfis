/**
 * Self-contained HTML page for GET /video-hd/public.
 * Inline CSS + JS only (zero Vite bundle, zero /assets, zero owner API calls).
 */
export function renderPublicHdHtml(): string {
  return `<!doctype html>
<html lang="ms">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>Video HD — Semua Platform</title>
  <style>
    :root {
      --bg: #f6f7f9;
      --surface: #ffffff;
      --surface-2: #eef1f5;
      --fg: #111827;
      --muted: #525d73;
      --line: #d8dee8;
      --accent: #059669;
      --accent-hover: #047857;
      --accent-ink: #ffffff;
      --accent-soft: rgba(5, 150, 105, 0.12);
      --warn: #b45309;
      --warn-soft: rgba(245, 158, 11, 0.14);
      --danger: #b91c1c;
      --danger-soft: rgba(220, 38, 38, 0.12);
      --radius: 14px;
    }
    :root.dark {
      --bg: #0c0f14;
      --surface: #151a22;
      --surface-2: #1d2430;
      --fg: #f3f5f8;
      --muted: #9aa5b8;
      --line: #273040;
      --accent: #10b981;
      --accent-hover: #059669;
      --accent-ink: #041b13;
      --accent-soft: rgba(16, 185, 129, 0.16);
      --warn: #fbbf24;
      --warn-soft: rgba(251, 191, 36, 0.14);
      --danger: #f87171;
      --danger-soft: rgba(248, 113, 113, 0.15);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.5;
      min-height: 100vh;
    }
    .wrap {
      max-width: 720px;
      margin: 0 auto;
      padding: 20px 16px 40px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 18px;
    }
    h1 {
      font-size: 1.35rem;
      margin: 0;
      letter-spacing: -0.02em;
    }
    .sub {
      color: var(--muted);
      font-size: 0.9rem;
      margin: 4px 0 0;
    }
    .theme-btn {
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--fg);
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 0.85rem;
      cursor: pointer;
      white-space: nowrap;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: var(--radius);
      padding: 18px;
      margin-bottom: 14px;
    }
    .banner {
      border-radius: 12px;
      padding: 12px 14px;
      font-size: 0.9rem;
      margin-bottom: 14px;
      border: 1px solid transparent;
    }
    .banner-warn {
      background: var(--warn-soft);
      color: var(--warn);
      border-color: rgba(245, 158, 11, 0.3);
    }
    .banner-danger {
      background: var(--danger-soft);
      color: var(--danger);
      border-color: rgba(220, 38, 38, 0.3);
    }
    .label-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 8px;
    }
    .label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }
    .label-row .label { margin-bottom: 0; }
    .drop {
      display: block;
      border: 2px dashed var(--line);
      border-radius: 12px;
      padding: 20px 14px;
      text-align: center;
      background: var(--surface-2);
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .drop:hover, .drop.drag { border-color: var(--accent); }
    .drop input { display: none; }
    .file-info {
      margin-top: 8px;
      font-size: 0.85rem;
      color: var(--accent);
      font-weight: 600;
      word-break: break-word;
    }
    .platform-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }
    .platform-box {
      border: 1px solid var(--line);
      background: var(--surface-2);
      border-radius: 12px;
      padding: 10px 12px;
    }
    .platform-title {
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 6px;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .chip {
      border: 1px solid var(--line);
      background: var(--surface);
      color: var(--fg);
      border-radius: 999px;
      padding: 6px 12px;
      font-size: 0.84rem;
      cursor: pointer;
      user-select: none;
    }
    .chip.on {
      background: var(--accent-soft);
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
    }
    .cover-pill {
      display: inline-block;
      font-size: 0.72rem;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--surface-2);
      color: var(--muted);
      margin-right: 4px;
      margin-top: 4px;
    }
    .plan-line {
      border: 1px solid rgba(5, 150, 105, 0.3);
      background: var(--accent-soft);
      color: var(--fg);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 0.84rem;
      margin-bottom: 12px;
    }
    .plan-line.over {
      border-color: rgba(220, 38, 38, 0.35);
      background: var(--danger-soft);
      color: var(--danger);
    }
    .modes {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .btn {
      width: 100%;
      border: 0;
      border-radius: 12px;
      padding: 12px 16px;
      font-size: 0.95rem;
      font-weight: 600;
      cursor: pointer;
      background: var(--accent);
      color: var(--accent-ink);
    }
    .btn:hover:not(:disabled) { background: var(--accent-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .progress-wrap {
      height: 10px;
      background: var(--surface-2);
      border-radius: 999px;
      overflow: hidden;
      margin: 10px 0 6px;
    }
    .progress-bar {
      height: 100%;
      width: 0%;
      background: var(--accent);
      transition: width 0.2s;
    }
    .status-line {
      font-size: 0.9rem;
      color: var(--muted);
    }
    .result-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 0;
      border-top: 1px solid var(--line);
    }
    .result-row:first-child { border-top: 0; padding-top: 0; }
    .result-meta {
      font-size: 0.82rem;
      color: var(--muted);
      margin-top: 2px;
    }
    .dl-btn {
      display: inline-block;
      text-decoration: none;
      background: var(--accent);
      color: var(--accent-ink);
      padding: 8px 14px;
      border-radius: 10px;
      font-size: 0.86rem;
      font-weight: 600;
      white-space: nowrap;
    }
    .result-actions {
      display: flex;
      gap: 8px;
    }
    .play-btn {
      background: var(--surface-2);
      color: inherit;
      border: 1px solid var(--line);
      padding: 8px 14px;
      border-radius: 10px;
      font: inherit;
      font-size: 0.86rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .preview {
      display: block;
      width: 100%;
      max-height: 70vh;
      background: #000;
      border-radius: 10px;
      margin: 4px 0 12px;
    }
    .tip {
      font-size: 0.84rem;
      color: var(--muted);
      background: var(--surface-2);
      border-radius: 10px;
      padding: 10px 12px;
      margin-top: 10px;
    }
    footer {
      text-align: center;
      font-size: 0.8rem;
      color: var(--muted);
      margin-top: 18px;
    }
    @media (max-width: 520px) {
      .platform-grid { grid-template-columns: 1fr; }
      .modes { grid-template-columns: 1fr; }
      .result-row { flex-direction: column; align-items: stretch; }
      .dl-btn, .play-btn { flex: 1; text-align: center; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div>
        <h1>Video HD</h1>
        <p class="sub">Satu muat naik untuk TikTok, Instagram, Facebook, YouTube Shorts, Threads &amp; WhatsApp.</p>
      </div>
      <button id="themeBtn" class="theme-btn" type="button">Tema</button>
    </header>

    <div id="closedBanner" class="banner banner-warn" hidden>Ditutup sementara.</div>
    <div id="errBanner" class="banner banner-danger" hidden></div>

    <div id="formCard" class="card">
      <div style="margin-bottom: 16px;">
        <span class="label">1. Pilih Video</span>
        <label id="dropZone" class="drop">
          <input id="fileInput" type="file" accept="video/*" />
          <div>Ketik untuk pilih video atau seret ke sini</div>
          <div id="limitHint" class="sub" style="font-size: 0.8rem;"></div>
          <div id="fileInfo" class="file-info" hidden></div>
        </label>
      </div>

      <div style="margin-bottom: 16px;">
        <div class="label-row">
          <span class="label">2. Platform</span>
          <button id="allPlatformsBtn" type="button" class="chip">Semua platform</button>
        </div>
        <div id="platformGroups" class="platform-grid"></div>
      </div>

      <div style="margin-bottom: 16px;">
        <span class="label">3. Mod</span>
        <div id="modeChips" class="modes">
          <button type="button" class="chip on" data-mode="auto">Auto</button>
          <button type="button" class="chip" data-mode="remux">Kekal asal (Remux)</button>
          <button type="button" class="chip" data-mode="reencode">Re-encode</button>
        </div>
      </div>

      <div id="planLine" class="plan-line" hidden></div>

      <div id="turnstileWrap" style="margin-bottom: 14px;" hidden></div>

      <button id="submitBtn" class="btn" type="button" disabled>Proses Video HD</button>

      <div id="progressArea" hidden>
        <div class="progress-wrap"><div id="progressBar" class="progress-bar"></div></div>
        <div id="statusLine" class="status-line">Menunggu...</div>
      </div>
    </div>

    <div id="resultsCard" class="card" hidden>
      <span class="label">Hasil Siap Dimuat Turun</span>
      <div id="resultsList"></div>
      <div class="tip">
        <strong>Tip WhatsApp:</strong> Untuk kualiti asal 100% tanpa mampatan, hantar fail video ini sebagai <strong>Dokumen (Document)</strong> dalam chat WhatsApp.
      </div>
    </div>

    <footer>
      Video dipadam selepas 24 jam. Jangan muat naik kandungan haram atau milik orang lain.
    </footer>
  </div>

  <script>
    (function () {
      const root = document.documentElement;
      try {
        const savedTheme = localStorage.getItem("pubhd.theme");
        if (savedTheme === "dark" || (!savedTheme && matchMedia("(prefers-color-scheme: dark)").matches)) {
          root.classList.add("dark");
        }
      } catch {}
      document.getElementById("themeBtn").onclick = () => {
        root.classList.toggle("dark");
        try { localStorage.setItem("pubhd.theme", root.classList.contains("dark") ? "dark" : "light"); } catch {}
      };

      const PART_BYTES = 16 * 1024 * 1024;
      const PLATFORM_ORDER = ["TikTok", "Instagram", "Facebook", "YouTube", "Threads", "WhatsApp"];
      const closedBanner = document.getElementById("closedBanner");
      const errBanner = document.getElementById("errBanner");
      const fileInput = document.getElementById("fileInput");
      const dropZone = document.getElementById("dropZone");
      const fileInfo = document.getElementById("fileInfo");
      const limitHint = document.getElementById("limitHint");
      const platformGroups = document.getElementById("platformGroups");
      const allPlatformsBtn = document.getElementById("allPlatformsBtn");
      const planLine = document.getElementById("planLine");
      const submitBtn = document.getElementById("submitBtn");
      const progressArea = document.getElementById("progressArea");
      const progressBar = document.getElementById("progressBar");
      const statusLine = document.getElementById("statusLine");
      const resultsCard = document.getElementById("resultsCard");
      const resultsList = document.getElementById("resultsList");
      const turnstileWrap = document.getElementById("turnstileWrap");

      let cfg = null;
      let chosenFile = null;
      let mode = "auto";
      let turnstileToken = "";
      const selected = new Set(["tiktok", "ig_reels", "yt_shorts"]);

      function loadSavedPlacements(validIds) {
        try {
          const raw = localStorage.getItem("pubhd.placements");
          if (!raw) return;
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            const ok = arr.filter((x) => validIds.includes(x));
            if (ok.length) {
              selected.clear();
              for (const x of ok) selected.add(x);
            }
          }
        } catch {}
      }
      function savePlacements() {
        try { localStorage.setItem("pubhd.placements", JSON.stringify(Array.from(selected))); } catch {}
      }

      function showErr(msg) {
        errBanner.textContent = msg;
        errBanner.hidden = !msg;
      }
      function fmtMb(b) { return (b / 1048576).toFixed(1) + " MB"; }

      function computeGroups() {
        if (!cfg || !cfg.placements) return [];
        const byTarget = new Map();
        for (const p of cfg.placements) {
          if (!selected.has(p.id)) continue;
          const t = cfg.placement_target[p.id];
          if (!byTarget.has(t)) byTarget.set(t, []);
          byTarget.get(t).push(p);
        }
        return Array.from(byTarget.entries()).map(([target, covers]) => ({ target, covers }));
      }

      function renderPlan() {
        const groups = computeGroups();
        const maxFiles = (cfg && cfg.limits && cfg.limits.max_files) || 4;
        if (!groups.length) {
          planLine.hidden = true;
          return groups;
        }
        const parts = groups.map((g) => {
          const label = (cfg.targets[g.target] && cfg.targets[g.target].label) || g.target;
          const names = g.covers.map((c) => c.short).join(", ");
          if (g.target === "story") return label + " (" + names + "; pecah ≤60s jika panjang)";
          if (g.covers.length > 1) return label + " (" + names + ")";
          return label;
        });
        const over = groups.length > maxFiles;
        planLine.className = "plan-line" + (over ? " over" : "");
        planLine.textContent = over
          ? groups.length + " fail dipilih (had maksimum " + maxFiles + " fail setiap muat naik). Kurangkan pilihan."
          : groups.length + " fail akan dibuat: " + parts.join(" · ");
        planLine.hidden = false;
        return groups;
      }

      function updateBtn() {
        const groups = renderPlan();
        const maxFiles = (cfg && cfg.limits && cfg.limits.max_files) || 4;
        const allCount = cfg && cfg.placements ? cfg.placements.length : 0;
        allPlatformsBtn.classList.toggle("on", allCount > 0 && selected.size === allCount);
        allPlatformsBtn.textContent = allCount > 0 && selected.size === allCount ? "✓ Semua platform" : "Semua platform";
        submitBtn.disabled = !cfg || !cfg.enabled || !chosenFile || groups.length === 0 || groups.length > maxFiles;
      }

      function renderPlatformChips() {
        platformGroups.innerHTML = "";
        if (!cfg || !cfg.placements) return;
        for (const group of PLATFORM_ORDER) {
          const list = cfg.placements.filter((p) => p.platform === group);
          if (!list.length) continue;
          const box = document.createElement("div");
          box.className = "platform-box";
          const title = document.createElement("div");
          title.className = "platform-title";
          title.textContent = group;
          const chips = document.createElement("div");
          chips.className = "chips";
          for (const p of list) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "chip" + (selected.has(p.id) ? " on" : "");
            btn.dataset.placement = p.id;
            btn.textContent = p.label;
            btn.onclick = () => {
              if (selected.has(p.id)) {
                if (selected.size <= 1) return;
                selected.delete(p.id);
                btn.classList.remove("on");
              } else {
                selected.add(p.id);
                btn.classList.add("on");
              }
              savePlacements();
              updateBtn();
            };
            chips.appendChild(btn);
          }
          box.appendChild(title);
          box.appendChild(chips);
          platformGroups.appendChild(box);
        }
      }

      allPlatformsBtn.onclick = () => {
        if (!cfg || !cfg.placements) return;
        const maxFiles = (cfg.limits && cfg.limits.max_files) || 4;
        if (selected.size === cfg.placements.length) {
          selected.clear();
          selected.add("tiktok");
        } else {
          selected.clear();
          // Select up to max_files distinct targets (or all if max_files >= 5)
          const usedTargets = new Set();
          for (const p of cfg.placements) {
            const t = cfg.placement_target[p.id];
            if (usedTargets.has(t) || usedTargets.size < maxFiles) {
              usedTargets.add(t);
              selected.add(p.id);
            }
          }
        }
        savePlacements();
        renderPlatformChips();
        updateBtn();
      };

      document.getElementById("modeChips").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-mode]");
        if (!btn) return;
        mode = btn.dataset.mode;
        for (const el of document.querySelectorAll("#modeChips .chip")) el.classList.remove("on");
        btn.classList.add("on");
      });

      function setFile(f) {
        chosenFile = f || null;
        if (chosenFile) {
          fileInfo.textContent = chosenFile.name + " (" + fmtMb(chosenFile.size) + ")";
          fileInfo.hidden = false;
        } else {
          fileInfo.hidden = true;
        }
        updateBtn();
      }

      fileInput.onchange = () => setFile(fileInput.files[0]);
      dropZone.ondragover = (e) => { e.preventDefault(); dropZone.classList.add("drag"); };
      dropZone.ondragleave = () => dropZone.classList.remove("drag");
      dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove("drag");
        if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
      };

      async function loadConfig() {
        try {
          const r = await fetch("/api/public/hd/config");
          cfg = await r.json();
          const maxFiles = (cfg.limits && cfg.limits.max_files) || 4;
          limitHint.textContent = "Maksimum " + cfg.limits.max_mb + " MB · " + cfg.limits.max_minutes + " minit · hingga " + maxFiles + " fail";
          if (cfg.placements) loadSavedPlacements(cfg.placements.map((p) => p.id));
          renderPlatformChips();
          if (!cfg.enabled) {
            closedBanner.hidden = false;
            submitBtn.disabled = true;
          }
          if (cfg.turnstile_site_key) {
            turnstileWrap.hidden = false;
            window.onTurnstileDone = (tok) => { turnstileToken = tok; };
            const div = document.createElement("div");
            div.className = "cf-turnstile";
            div.dataset.sitekey = cfg.turnstile_site_key;
            div.dataset.callback = "onTurnstileDone";
            turnstileWrap.appendChild(div);
            const s = document.createElement("script");
            s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
            s.async = true;
            document.head.appendChild(s);
          }
          updateBtn();
        } catch {
          showErr("Gagal memuatkan konfigurasi pelayan.");
        }
      }

      async function pollJob(id) {
        for (;;) {
          const r = await fetch("/api/public/hd/jobs/" + encodeURIComponent(id));
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "Ralat menyemak status");
          if (j.status === "queued") {
            statusLine.textContent = "Dalam giliran (kedudukan #" + j.queue_position + ")...";
          } else if (j.status === "processing") {
            progressBar.style.width = "100%";
            statusLine.textContent = "Sedang memproses video dengan ffmpeg...";
          } else if (j.status === "done") {
            statusLine.textContent = "Siap!";
            renderResults(id, j.results);
            return;
          } else if (j.status === "failed") {
            throw new Error(j.error || "Pemprosesan gagal");
          }
          await new Promise((res) => setTimeout(res, 1500));
        }
      }

      function renderResults(id, results) {
        resultsList.innerHTML = "";
        const placementMap = {};
        if (cfg && cfg.placements) {
          for (const p of cfg.placements) placementMap[p.id] = p.short;
        }
        for (const r of results) {
          const row = document.createElement("div");
          row.className = "result-row";
          const left = document.createElement("div");
          const title = document.createElement("div");
          title.style.fontWeight = "600";
          const baseLabel = (cfg && cfg.targets && cfg.targets[r.target] && cfg.targets[r.target].label) || r.target;
          const partLabel = r.part && r.parts > 1 ? " — Bahagian " + r.part + "/" + r.parts : "";
          title.textContent = baseLabel + partLabel + " (" + (r.mode === "remux" ? "Remux asal" : "Re-encode") + ")";
          const meta = document.createElement("div");
          meta.className = "result-meta";
          meta.textContent = r.width + "x" + r.height + " · " + Math.round(r.fps) + " fps · " + Math.round(r.duration) + "s · " + fmtMb(r.size_bytes) + (r.warnings && r.warnings.length ? " · ⚠️ " + r.warnings.join("; ") : "");
          left.appendChild(title);
          left.appendChild(meta);
          if (r.covers && r.covers.length) {
            const coversWrap = document.createElement("div");
            for (const c of r.covers) {
              const pill = document.createElement("span");
              pill.className = "cover-pill";
              pill.textContent = placementMap[c] || c;
              coversWrap.appendChild(pill);
            }
            left.appendChild(coversWrap);
          }

          const fileKey = r.key || r.target;
          const fileUrl = "/api/public/hd/jobs/" + encodeURIComponent(id) + "/file/" + encodeURIComponent(fileKey);
          const actions = document.createElement("div");
          actions.className = "result-actions";
          const play = document.createElement("button");
          play.type = "button";
          play.className = "play-btn";
          play.textContent = "▶ Tengok";
          const a = document.createElement("a");
          a.className = "dl-btn";
          a.href = fileUrl + "?download=1";
          a.textContent = "Muat Turun";
          a.download = "";
          actions.appendChild(play);
          actions.appendChild(a);
          row.appendChild(left);
          row.appendChild(actions);
          resultsList.appendChild(row);

          // The player is made only when asked, so nothing streams until the visitor wants it.
          let video = null;
          play.onclick = () => {
            if (!video) {
              video = document.createElement("video");
              video.className = "preview";
              video.controls = true;
              video.playsInline = true;
              video.preload = "metadata";
              video.src = fileUrl;
              resultsList.insertBefore(video, row.nextSibling);
              video.play().catch(() => {});
              play.textContent = "✕ Tutup";
            } else {
              video.pause();
              video.remove();
              video = null;
              play.textContent = "▶ Tengok";
            }
          };
        }
        resultsCard.hidden = false;
      }

      submitBtn.onclick = async () => {
        if (!chosenFile) return;
        showErr("");
        resultsCard.hidden = true;
        progressArea.hidden = false;
        progressBar.style.width = "0%";
        statusLine.textContent = "Memulakan muat naik...";
        submitBtn.disabled = true;

        try {
          const key = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : String(Date.now()) + Math.random().toString(36).slice(2)).slice(0, 32);
          const total = chosenFile.size;
          const placementStr = Array.from(selected).join(",");
          let offset = 0;
          let jobId = "";

          while (offset < total) {
            const slice = chosenFile.slice(offset, Math.min(total, offset + PART_BYTES));
            const buf = await slice.arrayBuffer();
            const qs = new URLSearchParams({
              name: chosenFile.name,
              total: String(total),
              offset: String(offset),
              placements: placementStr,
              mode,
            });
            const headers = { "content-type": "application/octet-stream" };
            if (offset === 0 && turnstileToken) headers["x-turnstile-token"] = turnstileToken;
            const res = await fetch("/api/public/hd/parts/" + encodeURIComponent(key) + "?" + qs.toString(), {
              method: "PUT",
              headers,
              body: buf,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Muat naik gagal (" + res.status + ")");
            offset += buf.byteLength;
            progressBar.style.width = Math.round((offset / total) * 100) + "%";
            statusLine.textContent = "Memuat naik: " + Math.round((offset / total) * 100) + "%";
            if (data.id) jobId = data.id;
          }

          if (!jobId) throw new Error("ID tugasan tidak diterima");
          await pollJob(jobId);
        } catch (err) {
          showErr(err.message || "Ralat berlaku");
        } finally {
          updateBtn();
        }
      };

      loadConfig();
    })();
  </script>
</body>
</html>
`;
}
