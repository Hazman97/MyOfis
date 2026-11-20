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
  <title>Video HD — TikTok &amp; WhatsApp</title>
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
      max-width: 680px;
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
    .label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 8px;
    }
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
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .chip {
      border: 1px solid var(--line);
      background: var(--surface-2);
      color: var(--fg);
      border-radius: 999px;
      padding: 8px 14px;
      font-size: 0.88rem;
      cursor: pointer;
      user-select: none;
    }
    .chip.on {
      background: var(--accent-soft);
      border-color: var(--accent);
      color: var(--accent);
      font-weight: 600;
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
    @media (max-width: 440px) {
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
        <p class="sub">Sediakan video tajam untuk TikTok HD, WhatsApp HD &amp; WhatsApp Status.</p>
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
        <span class="label">2. Sasaran</span>
        <div id="targetChips" class="chips">
          <button type="button" class="chip on" data-target="tiktok">TikTok HD</button>
          <button type="button" class="chip" data-target="whatsapp">WhatsApp HD</button>
          <button type="button" class="chip" data-target="whatsapp_status">WhatsApp Status</button>
        </div>
      </div>

      <div style="margin-bottom: 16px;">
        <span class="label">3. Mod</span>
        <div id="modeChips" class="modes">
          <button type="button" class="chip on" data-mode="auto">Auto</button>
          <button type="button" class="chip" data-mode="remux">Kekal asal (Remux)</button>
          <button type="button" class="chip" data-mode="reencode">Re-encode</button>
        </div>
      </div>

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
      const savedTheme = localStorage.getItem("pubhd.theme");
      if (savedTheme === "dark" || (!savedTheme && matchMedia("(prefers-color-scheme: dark)").matches)) {
        root.classList.add("dark");
      }
      document.getElementById("themeBtn").onclick = () => {
        root.classList.toggle("dark");
        localStorage.setItem("pubhd.theme", root.classList.contains("dark") ? "dark" : "light");
      };

      const PART_BYTES = 16 * 1024 * 1024;
      const closedBanner = document.getElementById("closedBanner");
      const errBanner = document.getElementById("errBanner");
      const fileInput = document.getElementById("fileInput");
      const dropZone = document.getElementById("dropZone");
      const fileInfo = document.getElementById("fileInfo");
      const limitHint = document.getElementById("limitHint");
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
      const targets = new Set(["tiktok"]);

      function showErr(msg) {
        errBanner.textContent = msg;
        errBanner.hidden = !msg;
      }
      function fmtMb(b) { return (b / 1048576).toFixed(1) + " MB"; }

      function updateBtn() {
        submitBtn.disabled = !cfg || !cfg.enabled || !chosenFile || targets.size === 0;
      }

      document.getElementById("targetChips").addEventListener("click", (e) => {
        const btn = e.target.closest("[data-target]");
        if (!btn) return;
        const t = btn.dataset.target;
        if (targets.has(t) && targets.size > 1) {
          targets.delete(t);
          btn.classList.remove("on");
        } else {
          targets.add(t);
          btn.classList.add("on");
        }
        updateBtn();
      });

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
          limitHint.textContent = "Maksimum " + cfg.limits.max_mb + " MB · " + cfg.limits.max_minutes + " minit";
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
        const labels = { tiktok: "TikTok HD", whatsapp: "WhatsApp HD", whatsapp_status: "WhatsApp Status" };
        for (const r of results) {
          const row = document.createElement("div");
          row.className = "result-row";
          const left = document.createElement("div");
          const title = document.createElement("div");
          title.style.fontWeight = "600";
          title.textContent = (labels[r.target] || r.target) + " (" + (r.mode === "remux" ? "Remux asal" : "Re-encode") + ")";
          const meta = document.createElement("div");
          meta.className = "result-meta";
          meta.textContent = r.width + "x" + r.height + " · " + Math.round(r.fps) + " fps · " + fmtMb(r.size_bytes) + (r.warnings && r.warnings.length ? " · ⚠️ " + r.warnings.join("; ") : "");
          left.appendChild(title);
          left.appendChild(meta);

          const fileUrl = "/api/public/hd/jobs/" + encodeURIComponent(id) + "/file/" + encodeURIComponent(r.target);
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
          const targetStr = Array.from(targets).join(",");
          let offset = 0;
          let jobId = "";

          while (offset < total) {
            const slice = chosenFile.slice(offset, Math.min(total, offset + PART_BYTES));
            const buf = await slice.arrayBuffer();
            const qs = new URLSearchParams({
              name: chosenFile.name,
              total: String(total),
              offset: String(offset),
              targets: targetStr,
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
