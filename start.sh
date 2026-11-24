#!/bin/bash
set -e
cd "$(dirname "$0")"

if [ ! -d node_modules/express ] || [ ! -d node_modules/@napi-rs/canvas ] || [ ! -d node_modules/ffmpeg-static ] || [ ! -d node_modules/cheerio ]; then
  echo "[setup] Đang cài dependencies (express, cheerio, ffmpeg-static, @napi-rs/canvas)..."
  npm install --no-audit --no-fund
fi

if [ ! -f fonts/Poppins-ExtraBold.ttf ]; then
  echo "[setup] Đang tải font Poppins..."
  mkdir -p fonts
  node -e "
const fs = require('fs');
const base = 'https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/';
(async () => {
  for (const f of ['Poppins-ExtraBold.ttf','Poppins-Bold.ttf','Poppins-SemiBold.ttf','Poppins-Medium.ttf','Poppins-Regular.ttf']) {
    try {
      const r = await fetch(base + f);
      if (r.ok) {
        fs.writeFileSync('fonts/' + f, Buffer.from(await r.arrayBuffer()));
        console.log('  + Đã tải', f);
      }
    } catch (e) {
      console.warn('  ! Không tải được font', f, e.message);
    }
  }
})();
"
fi


if [ ! -f fonts/NotoSansJP-Regular.ttf ]; then
  echo "[setup] Đang tải font hỗ trợ Tiếng Nhật & Tiếng Việt..."
  mkdir -p fonts
  node -e "
const fs = require('fs');
const candidates = [
  ['NotoSansJP-Regular.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf'],
  ['NotoSans-Regular.ttf', 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth%2Cwght%5D.ttf'],
];
(async () => {
  for (const [name, url] of candidates) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        fs.writeFileSync('fonts/' + name, Buffer.from(await r.arrayBuffer()));
        console.log('  + Đã tải', name);
      }
    } catch (_) {}
  }
})();
"
fi

echo "[start] Mở trình duyệt tại: http://localhost:${PORT:-3000}"
exec node app/server.js
