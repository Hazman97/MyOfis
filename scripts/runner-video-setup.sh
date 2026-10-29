#!/usr/bin/env bash
# MyOfis AWS Runner Video & Motion Graphics Setup (Amazon Linux 2023, x86_64)
# Idempotent setup for Node 24.22.1, headless Chrome system libraries, Noto + Emoji fonts,
# and the HyperFrames CLI at a pinned version.
# Safety: never touches vLLM, Caddy, or anything under /etc/vllm.
set -euo pipefail

NODE_VERSION="24.22.1"
NODE_DIST="node-v${NODE_VERSION}-linux-x64"
NODE_TARBALL="${NODE_DIST}.tar.xz"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}"
NODE_SHASUMS_URL="https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
# Pinned SHA-256 for node-v24.22.1-linux-x64.tar.xz (override via NODE_SHA256 env only if building for another arch)
NODE_SHA256="${NODE_SHA256:-7c26856e9c7f9eb129c1fb837694da52a5c30cb97cf5cd78be84e9014d9f50b5}"
HYPERFRAMES_VERSION="${HYPERFRAMES_VERSION:-0.1.4}"
NPM_PREFIX="${HOME}/.local"

echo "==> [1/6] Checking system prerequisites (Amazon Linux 2023)..."
if ! command -v dnf >/dev/null 2>&1; then
  echo "ERROR: dnf not found. This script targets Amazon Linux 2023." >&2
  exit 1
fi

echo "==> [2/6] Installing headless Chrome system libraries and Noto fonts (incl. emoji) via dnf..."
sudo dnf install -y \
  atk \
  at-spi2-atk \
  cups-libs \
  gtk3 \
  libXcomposite \
  libXcursor \
  libXdamage \
  libXext \
  libXi \
  libXrandr \
  libXScrnSaver \
  libXtst \
  pango \
  alsa-lib \
  nss \
  nspr \
  libdrm \
  mesa-libgbm \
  libxkbcommon \
  xorg-x11-fonts-100dpi \
  xorg-x11-fonts-75dpi \
  xorg-x11-utils \
  xorg-x11-fonts-Type1 \
  xorg-x11-fonts-misc \
  fontconfig \
  google-noto-sans-fonts \
  google-noto-sans-mono-fonts \
  google-noto-emoji-color-fonts \
  google-noto-emoji-fonts \
  tar \
  xz \
  curl \
  ca-certificates

sudo fc-cache -fv >/dev/null

echo "==> [3/6] Installing Node.js v${NODE_VERSION} into /opt/${NODE_DIST} with SHA-256 verification..."
if [ -x "/opt/${NODE_DIST}/bin/node" ] && [ "$("/opt/${NODE_DIST}/bin/node" -v)" = "v${NODE_VERSION}" ]; then
  echo "    Node.js v${NODE_VERSION} is already installed in /opt/${NODE_DIST}."
else
  TMP_DIR="$(mktemp -d /tmp/node-setup.XXXXXX)"
  trap 'rm -rf "${TMP_DIR}"' EXIT
  echo "    Downloading ${NODE_URL}..."
  curl -fsSL "${NODE_URL}" -o "${TMP_DIR}/${NODE_TARBALL}"
  echo "    Downloading ${NODE_SHASUMS_URL}..."
  curl -fsSL "${NODE_SHASUMS_URL}" -o "${TMP_DIR}/SHASUMS256.txt"

  OFFICIAL_HASH="$(awk -v f="${NODE_TARBALL}" '$2 == f { print $1 }' "${TMP_DIR}/SHASUMS256.txt")"
  if [ -n "${OFFICIAL_HASH}" ]; then
    EXPECTED_HASH="${OFFICIAL_HASH}"
  else
    EXPECTED_HASH="${NODE_SHA256}"
  fi

  echo "${EXPECTED_HASH}  ${TMP_DIR}/${NODE_TARBALL}" | sha256sum -c -
  sudo mkdir -p /opt
  sudo rm -rf "/opt/${NODE_DIST}"
  sudo tar -xJf "${TMP_DIR}/${NODE_TARBALL}" -C /opt
  rm -rf "${TMP_DIR}"
  trap - EXIT
fi

sudo ln -sf "/opt/${NODE_DIST}/bin/node" /usr/local/bin/node
sudo ln -sf "/opt/${NODE_DIST}/bin/npm" /usr/local/bin/npm
sudo ln -sf "/opt/${NODE_DIST}/bin/npx" /usr/local/bin/npx
sudo ln -sf "/opt/${NODE_DIST}/bin/corepack" /usr/local/bin/corepack
echo "    Node version: $(/usr/local/bin/node -v), npm version: $(/usr/local/bin/npm -v)"

echo "==> [4/6] Configuring user npm prefix (${NPM_PREFIX}) and installing HyperFrames CLI v${HYPERFRAMES_VERSION}..."
mkdir -p "${NPM_PREFIX}/bin" "${NPM_PREFIX}/lib"
/usr/local/bin/npm config set prefix "${NPM_PREFIX}"

if [ -x "${NPM_PREFIX}/bin/hyperframes" ] && "${NPM_PREFIX}/bin/hyperframes" --version 2>/dev/null | grep -q "${HYPERFRAMES_VERSION}"; then
  echo "    HyperFrames CLI v${HYPERFRAMES_VERSION} is already installed."
else
  /usr/local/bin/npm install -g --prefix "${NPM_PREFIX}" "hyperframes@${HYPERFRAMES_VERSION}"
fi

sudo ln -sf "${NPM_PREFIX}/bin/hyperframes" /usr/local/bin/hyperframes
echo "    HyperFrames binary: $(command -v hyperframes)"

echo "==> [5/6] Running smoke-test render of the 'hook' template..."
SMOKE_DIR="$(mktemp -d /tmp/hyperframes-smoke.XXXXXX)"
cat > "${SMOKE_DIR}/index.html" <<'EOF'
<!DOCTYPE html>
<html lang="ms">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
  <style>
    html, body { margin: 0; width: 1080px; height: 1920px; background: #0B0D13; color: #FFE600; font-family: "Noto Sans", sans-serif; overflow: hidden; }
    #main-composition { width: 1080px; height: 1920px; display: flex; align-items: center; justify-content: center; text-align: center; }
    #hook-line-0 { font-size: 88px; font-weight: 900; }
  </style>
</head>
<body>
  <div id="main-composition" data-composition-id="main" data-start="0" data-duration="1" data-width="1080" data-height="1920" data-fps="30" data-track-index="0">
    <div id="hook-line-0">3 RAHSIA BISNES 🔥</div>
  </div>
  <script>
    (function() {
      var t = 0;
      var el = document.getElementById("hook-line-0");
      function renderAt(sec) {
        t = Math.max(0, Math.min(1, Number(sec) || 0));
        var s = 0.7 + 0.3 * Math.min(1, t / 0.3);
        el.style.transform = "scale(" + s + ")";
      }
      window.__timelines = {
        main: {
          duration: function() { return 1; },
          totalDuration: function() { return 1; },
          seek: function(sec) { renderAt(sec); return this; },
          time: function(sec) { if (typeof sec === "number") { renderAt(sec); return this; } return t; },
          progress: function(p) { if (typeof p === "number") { renderAt(p); return this; } return t; },
          pause: function() { return this; },
          play: function() { return this; }
        }
      };
      renderAt(0);
    })();
  </script>
</body>
</html>
EOF

/usr/local/bin/hyperframes render \
  --composition "${SMOKE_DIR}/index.html" \
  --output "${SMOKE_DIR}/hook-smoke.mp4" \
  --fps 30 \
  --width 1080 \
  --height 1920 \
  --quality standard

echo "==> [6/6] Verifying output with ffprobe..."
ffprobe -v error -show_entries format=duration,size -show_entries stream=codec_name,width,height,r_frame_rate -of default=noprint_wrappers=1 "${SMOKE_DIR}/hook-smoke.mp4"
rm -rf "${SMOKE_DIR}"
echo "==> Setup complete! Restart the MyOfis runner so it reports 'hyperframes' in capabilities.programs."

