const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const FF = require('ffmpeg-static');
const tts = require('./tts');

const ROOT = path.resolve(__dirname, '../..');
const FONTS_DIR = path.join(ROOT, 'fonts');
const OUT_DIR = path.join(ROOT, 'out');
const JOBS_DIR = path.join(ROOT, 'jobs');

let fontsRegistered = false;
function registerFonts() {
  if (fontsRegistered) return;
  const list = [
    ['Poppins-ExtraBold.ttf', 'PXB'],
    ['Poppins-Bold.ttf', 'PB'],
    ['Poppins-SemiBold.ttf', 'PSB'],
    ['Poppins-Medium.ttf', 'PM'],
    ['Poppins-Regular.ttf', 'PR'],
    ['NotoSansJP-Regular.ttf', 'NJP'],
    ['NotoSansJP[wght].ttf', 'NJP'],
    ['NotoSans-Regular.ttf', 'NS'],
    ['NotoSans[wdth,wght].ttf', 'NS'],
  ];
  for (const [file, alias] of list) {
    const p = path.join(FONTS_DIR, file);
    if (fs.existsSync(p)) {
      try {
        GlobalFonts.registerFromPath(p, alias);
      } catch (_) {}
    }
  }

  const sysCandidates =
    process.platform === 'win32'
      ? [
          ['C:\\Windows\\Fonts\\segoeui.ttf', 'SysUI'],
          ['C:\\Windows\\Fonts\\segoeuib.ttf', 'SysUIBold'],
          ['C:\\Windows\\Fonts\\arial.ttf', 'SysArial'],
          ['C:\\Windows\\Fonts\\arialbd.ttf', 'SysArialBold'],
          ['C:\\Windows\\Fonts\\YuGothR.ttc', 'SysJP'],
          ['C:\\Windows\\Fonts\\YuGothB.ttc', 'SysJPBold'],
          ['C:\\Windows\\Fonts\\msgothic.ttc', 'SysMSGothic'],
          ['C:\\Windows\\Fonts\\meiryo.ttc', 'SysMeiryo'],
        ]
      : [
          ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', 'SysJP'],
          ['/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc', 'SysJPBold'],
          ['/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf', 'SysUI'],
          ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 'SysUI'],
        ];

  for (const [sysPath, alias] of sysCandidates) {
    if (fs.existsSync(sysPath)) {
      try {
        GlobalFonts.registerFromPath(sysPath, alias);
      } catch (_) {}
    }
  }

  fontsRegistered = true;
}

const FONT_STACK_BOLD = 'PB, PXB, NJP, NS, SysJPBold, SysJP, SysUIBold, SysUI, SysArialBold, Arial, sans-serif';
const FONT_STACK_REGULAR = 'PR, PM, PSB, NJP, NS, SysJP, SysUI, SysArial, Arial, sans-serif';


const PALETTES = {
  midnight: {
    bgTop: '#0A0E18',
    bgMid: '#101728',
    bgBot: '#151C2E',
    accents: ['#FFD166', '#4CC9F0', '#F72585', '#7BF1A8', '#B892FF', '#FF9F1C'],
    text: '#FFFFFF',
    muted: '#94A3B8',
    cardBg: 'rgba(255,255,255,0.06)',
  },
  emerald: {
    bgTop: '#061A17',
    bgMid: '#0B2924',
    bgBot: '#0F362F',
    accents: ['#34D399', '#FBBF24', '#38BDF8', '#A7F3D0', '#F472B6'],
    text: '#FFFFFF',
    muted: '#A7F3D0',
    cardBg: 'rgba(255,255,255,0.07)',
  },
  royal: {
    bgTop: '#120D26',
    bgMid: '#1B1338',
    bgBot: '#24194A',
    accents: ['#F59E0B', '#EC4899', '#38BDF8', '#A78BFA', '#10B981'],
    text: '#FFFFFF',
    muted: '#C4B5FD',
    cardBg: 'rgba(255,255,255,0.07)',
  },
};

const RESOLUTION_PRESETS = {
  '540p': { width: 540, height: 960 },
  '720p': { width: 720, height: 1280 },
  '1080p': { width: 1080, height: 1920 },
};

const QUALITY_PRESETS = {
  low: { crf: 28, preset: 'veryfast', audioBitrate: '128k' },
  medium: { crf: 23, preset: 'fast', audioBitrate: '160k' },
  high: { crf: 19, preset: 'medium', audioBitrate: '192k' },
};

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function breakLongToken(ctx, token, maxW) {
  if (ctx.measureText(token).width <= maxW) return [token];
  const parts = [];
  let buf = '';
  for (const ch of Array.from(token)) {
    const next = buf + ch;
    if (ctx.measureText(next).width > maxW && buf) {
      parts.push(buf);
      buf = ch;
    } else {
      buf = next;
    }
  }
  if (buf) parts.push(buf);
  return parts.length ? parts : [token];
}

function wrapText(ctx, text, maxW) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const paragraphs = raw.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const lines = [];
  const hasCjk = /[\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(raw);

  for (const para of paragraphs) {
    // Nếu có ký tự CJK/Nhật và thiếu khoảng trắng, tách theo từng ký tự/cụm nhỏ để ngắt dòng mượt
    const tokens = hasCjk && !/\s/.test(para)
      ? Array.from(para)
      : para.split(/\s+/).filter(Boolean);

    let cur = '';
    const sep = hasCjk && !/\s/.test(para) ? '' : ' ';

    for (const tok of tokens) {
      const pieces = breakLongToken(ctx, tok, maxW);
      for (const piece of pieces) {
        const candidate = cur ? `${cur}${sep}${piece}` : piece;
        if (ctx.measureText(candidate).width > maxW && cur) {
          lines.push(cur);
          cur = piece;
        } else {
          cur = candidate;
        }
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

function drawFittedBlock(ctx, text, opts) {
  const {
    x,
    y,
    maxW,
    maxH,
    startSize,
    minSize = 22,
    lineHeightRatio = 1.32,
    align = 'center',
    color = '#FFFFFF',
    weight = 'bold',
    family = 'PB, PXB, NJP, NS, SysJPBold, SysJP, SysUIBold, SysUI, SysArialBold, Arial, sans-serif',
  } = opts;

  const clean = String(text || '').trim();
  if (!clean) return;

  let fontSize = Math.max(minSize, Math.round(startSize));
  let lines = [];
  let lineH = Math.round(fontSize * lineHeightRatio);

  while (fontSize >= minSize) {
    ctx.font = `${weight} ${fontSize}px ${family}`;
    lines = wrapText(ctx, clean, maxW);
    lineH = Math.round(fontSize * lineHeightRatio);
    const totalH = lines.length * lineH;
    if (totalH <= maxH) break;
    fontSize -= 2;
  }

  fontSize = Math.max(minSize, fontSize);
  ctx.font = `${weight} ${fontSize}px ${family}`;
  lines = wrapText(ctx, clean, maxW);
  lineH = Math.round(fontSize * lineHeightRatio);

  const maxLines = Math.max(1, Math.floor(maxH / lineH));
  let visibleLines = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let last = visibleLines[visibleLines.length - 1] || '';
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) {
      last = last.slice(0, -1);
    }
    visibleLines[visibleLines.length - 1] = last.replace(/[.,;:\s]+$/, '') + '…';
  }

  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  visibleLines.forEach((line, idx) => {
    ctx.fillText(line, x, y + idx * lineH);
  });
  ctx.restore();
}

function fitFont(ctx, text, maxW, startSize, family, minSize = 26) {
  let s = startSize;
  while (s > minSize) {
    ctx.font = `bold ${s}px ${family}, PB, PXB, NJP, NS, SysJPBold, SysJP, SysUIBold, SysUI, SysArialBold, Arial, sans-serif`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 2;
  }
  ctx.font = `bold ${s}px ${family}, PB, PXB, NJP, NS, SysJPBold, SysJP, SysUIBold, SysUI, SysArialBold, Arial, sans-serif`;
  return s;
}

class Painter {
  constructor(width = 1080, height = 1920, paletteName = 'midnight') {
    registerFonts();
    this.W = width;
    this.H = height;
    this.scale = width / 1080;
    this.palette = PALETTES[paletteName] || PALETTES.midnight;
    this.canvas = createCanvas(width, height);
    this.ctx = this.canvas.getContext('2d');
  }

  draw(card, index, total, opts = {}) {
    const ctx = this.ctx;
    const S = this.scale;
    const W = this.W;
    const H = this.H;
    const p = this.palette;
    const accent = p.accents[index % p.accents.length];

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, p.bgTop);
    bg.addColorStop(0.55, p.bgMid);
    bg.addColorStop(1, p.bgBot);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Glow
    const glow = ctx.createRadialGradient(W / 2, 620 * S, 0, W / 2, 620 * S, 820 * S);
    glow.addColorStop(0, rgba(accent, 0.16));
    glow.addColorStop(1, rgba(accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    // Top badge + counter
    const badge = (opts.badge || 'ENGLISH REELS').toUpperCase();
    ctx.font = `bold ${Math.round(28 * S)}px PR, PM, PSB, NJP, NS, SysJP, SysUI, SysArial, Arial, sans-serif`;
    const bw = ctx.measureText(badge).width + 48 * S;
    ctx.fillStyle = accent;
    roundRect(ctx, 80 * S, 180 * S, bw, 56 * S, 28 * S);
    ctx.fill();
    ctx.fillStyle = '#0A0E18';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(badge, 104 * S, 208 * S);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,0.48)';
    ctx.font = `bold ${Math.round(34 * S)}px PR, PM, PSB, NJP, NS, SysJP, SysUI, SysArial, Arial, sans-serif`;
    ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`, W - 80 * S, 208 * S);

    // Body theo từng loại thẻ
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    if (card.type === 'title') {
      drawFittedBlock(ctx, (card.kicker || 'ENGLISH PRACTICE').toUpperCase(), {
        x: W / 2,
        y: 620 * S,
        maxW: W - 180 * S,
        maxH: 60 * S,
        startSize: 34 * S,
        minSize: 22 * S,
        align: 'center',
        color: accent,
      });

      drawFittedBlock(ctx, card.title || 'English Lesson', {
        x: W / 2,
        y: 710 * S,
        maxW: W - 160 * S,
        maxH: 430 * S,
        startSize: 88 * S,
        minSize: 36 * S,
        lineHeightRatio: 1.18,
        align: 'center',
        color: p.text,
      });

      if (card.subtitle) {
        drawFittedBlock(ctx, card.subtitle, {
          x: W / 2,
          y: 1180 * S,
          maxW: W - 180 * S,
          maxH: 180 * S,
          startSize: 42 * S,
          minSize: 24 * S,
          lineHeightRatio: 1.3,
          align: 'center',
          color: p.muted,
          weight: 'normal',
        });
      }
    } else if (card.type === 'vocab') {
      drawFittedBlock(ctx, card.word || '', {
        x: W / 2,
        y: 560 * S,
        maxW: W - 180 * S,
        maxH: 165 * S,
        startSize: 112 * S,
        minSize: 38 * S,
        lineHeightRatio: 1.15,
        align: 'center',
        color: p.text,
      });

      ctx.fillStyle = accent;
      roundRect(ctx, W / 2 - 70 * S, 742 * S, 140 * S, 8 * S, 4 * S);
      ctx.fill();

      drawFittedBlock(ctx, 'MEANING', {
        x: W / 2,
        y: 785 * S,
        maxW: W - 180 * S,
        maxH: 50 * S,
        startSize: 32 * S,
        minSize: 22 * S,
        align: 'center',
        color: p.muted,
      });

      drawFittedBlock(ctx, card.meaning || '', {
        x: W / 2,
        y: 850 * S,
        maxW: W - 180 * S,
        maxH: 270 * S,
        startSize: 62 * S,
        minSize: 28 * S,
        lineHeightRatio: 1.25,
        align: 'center',
        color: p.text,
      });

      if (card.example) {
        ctx.fillStyle = p.cardBg;
        roundRect(ctx, 85 * S, 1160 * S, W - 170 * S, 260 * S, 26 * S);
        ctx.fill();
        ctx.fillStyle = accent;
        roundRect(ctx, 85 * S, 1160 * S, 8 * S, 260 * S, 4 * S);
        ctx.fill();

        drawFittedBlock(ctx, 'EXAMPLE', {
          x: 125 * S,
          y: 1185 * S,
          maxW: W - 240 * S,
          maxH: 42 * S,
          startSize: 28 * S,
          minSize: 20 * S,
          align: 'left',
          color: accent,
        });

        drawFittedBlock(ctx, card.example, {
          x: 125 * S,
          y: 1235 * S,
          maxW: W - 240 * S,
          maxH: 165 * S,
          startSize: 38 * S,
          minSize: 22 * S,
          lineHeightRatio: 1.28,
          align: 'left',
          color: '#E2E8F0',
          weight: 'normal',
        });
      }
    } else if (card.type === 'question' || card.type === 'answer') {
      const isAnswer = card.type === 'answer';
      drawFittedBlock(ctx, card.indexLabel || (isAnswer ? 'ANSWER' : 'QUESTION'), {
        x: W / 2,
        y: 420 * S,
        maxW: W - 180 * S,
        maxH: 55 * S,
        startSize: 36 * S,
        minSize: 22 * S,
        align: 'center',
        color: isAnswer ? '#34D399' : accent,
      });

      ctx.fillStyle = p.cardBg;
      roundRect(ctx, 80 * S, 500 * S, W - 160 * S, 640 * S, 32 * S);
      ctx.fill();

      drawFittedBlock(ctx, card.question || '', {
        x: W / 2,
        y: 545 * S,
        maxW: W - 240 * S,
        maxH: 550 * S,
        startSize: 54 * S,
        minSize: 26 * S,
        lineHeightRatio: 1.32,
        align: 'center',
        color: p.text,
      });

      if (isAnswer) {
        ctx.fillStyle = '#10B981';
        roundRect(ctx, 140 * S, 1205 * S, W - 280 * S, 155 * S, 28 * S);
        ctx.fill();
        drawFittedBlock(ctx, (card.answer || 'TRUE').toUpperCase(), {
          x: W / 2,
          y: 1245 * S,
          maxW: W - 320 * S,
          maxH: 95 * S,
          startSize: 60 * S,
          minSize: 28 * S,
          lineHeightRatio: 1.15,
          align: 'center',
          color: '#062016',
        });
      } else {
        const badgeText =
          opts.countdownRemaining != null
            ? `THINK... ${opts.countdownRemaining}s`
            : `TRUE OR FALSE? (${card.countdown ?? 5}s)`;
        ctx.fillStyle = rgba(accent, 0.2);
        roundRect(ctx, 180 * S, 1220 * S, W - 360 * S, 110 * S, 24 * S);
        ctx.fill();
        drawFittedBlock(ctx, badgeText, {
          x: W / 2,
          y: 1252 * S,
          maxW: W - 400 * S,
          maxH: 60 * S,
          startSize: 40 * S,
          minSize: 24 * S,
          align: 'center',
          color: accent,
        });
      }
    } else if (card.type === 'outro') {
      drawFittedBlock(ctx, card.title || 'WELL DONE!', {
        x: W / 2,
        y: 700 * S,
        maxW: W - 160 * S,
        maxH: 180 * S,
        startSize: 82 * S,
        minSize: 36 * S,
        lineHeightRatio: 1.15,
        align: 'center',
        color: accent,
      });

      drawFittedBlock(ctx, card.subtitle || 'Follow for more lessons!', {
        x: W / 2,
        y: 910 * S,
        maxW: W - 180 * S,
        maxH: 260 * S,
        startSize: 42 * S,
        minSize: 24 * S,
        lineHeightRatio: 1.3,
        align: 'center',
        color: p.text,
        weight: 'normal',
      });
    } else {
      // reading card
      drawFittedBlock(ctx, card.indexLabel || 'READING', {
        x: W / 2,
        y: 395 * S,
        maxW: W - 180 * S,
        maxH: 50 * S,
        startSize: 32 * S,
        minSize: 22 * S,
        align: 'center',
        color: accent,
      });

      ctx.fillStyle = p.cardBg;
      roundRect(ctx, 75 * S, 465 * S, W - 150 * S, 895 * S, 32 * S);
      ctx.fill();

      const bodyText = card.body || '';
      const startFont = bodyText.length > 190 ? 44 * S : 52 * S;
      drawFittedBlock(ctx, bodyText, {
        x: W / 2,
        y: 515 * S,
        maxW: W - 230 * S,
        maxH: 800 * S,
        startSize: startFont,
        minSize: 24 * S,
        lineHeightRatio: 1.34,
        align: 'center',
        color: p.text,
      });
    }

    // Optional translation caption
    if (opts.showTranslation && card.translation) {
      ctx.fillStyle = 'rgba(0,0,0,0.58)';
      roundRect(ctx, 80 * S, 1395 * S, W - 160 * S, 165 * S, 20 * S);
      ctx.fill();
      drawFittedBlock(ctx, card.translation, {
        x: W / 2,
        y: 1420 * S,
        maxW: W - 220 * S,
        maxH: 125 * S,
        startSize: 34 * S,
        minSize: 20 * S,
        lineHeightRatio: 1.25,
        align: 'center',
        color: '#FDE68A',
        weight: 'normal',
      });
    }

    // Progress bar + footer
    const prog = total > 0 ? (index + 1) / total : 1;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, 85 * S, 1620 * S, W - 170 * S, 10 * S, 5 * S);
    ctx.fill();
    ctx.fillStyle = accent;
    roundRect(ctx, 85 * S, 1620 * S, Math.max(12 * S, (W - 170 * S) * prog), 10 * S, 5 * S);
    ctx.fill();

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.font = `${Math.round(32 * S)}px PR, PM, PSB, NJP, NS, SysJP, SysUI, SysArial, Arial, sans-serif`;
    ctx.fillText(opts.footer || 'English Practice Studio', W / 2, 1710 * S);

    ctx.restore();
    return this.canvas.toBuffer('image/png');
  }
}

function formatSrtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const rem = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${rem}`;
}

function buildSrtContent(timeline, useTranslation = false) {
  const rows = [];
  let idx = 1;
  for (const item of timeline) {
    const txt = useTranslation ? (item.translation || '').trim() : (item.subtitle || '').trim();
    if (!txt) continue;
    rows.push(`${idx++}\n${formatSrtTime(item.start)} --> ${formatSrtTime(item.end)}\n${txt}\n`);
  }
  return rows.join('\n');
}

function normalizeAudioToWav48k(srcWav, dstWav) {
  execFileSync(FF, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    srcWav,
    '-ar',
    '48000',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    dstWav,
    '-y',
  ]);
  return (fs.statSync(dstWav).size - 44) / (48000 * 4);
}

function generateSilenceWav48k(durationSec, dstWav) {
  execFileSync(FF, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-t',
    Math.max(0.05, durationSec).toFixed(3),
    '-c:a',
    'pcm_s16le',
    dstWav,
    '-y',
  ]);
}

function composeTransitionSpeech(cards, index) {
  const card = cards[index];
  let speech = (card.speech || card.body || card.question || card.title || '').trim();
  const previous = index > 0 ? cards[index - 1] : null;
  if (!speech || !previous) return speech;

  if (card.type === 'reading') {
    if (previous.type === 'title') return `Let's begin reading. ${speech}`;
    if (previous.type === 'reading') return `Let's continue with the next part. ${speech}`;
    return `Now, let's move on to the next reading passage. ${speech}`;
  }
  if (card.type === 'question') {
    const number = (card.indexLabel || '').match(/\d+/)?.[0] || String(index);
    speech = speech.replace(/^question\s+\d+[.:]?\s*/i, '');
    return `Now, let's move on to question ${number}. ${speech}`.trim();
  }
  if (card.type === 'answer') return `Let's check the answer. ${speech}`;
  if (card.type === 'vocab' && previous.type === 'vocab') return `Next, let's learn another word. ${speech}`;
  return speech;
}

function estimateWordTimings(text, duration) {
  const words = String(text || '').match(/\S+/g) || [];
  if (!words.length || duration <= 0) return [];
  const weights = words.map((word) => {
    const letters = Math.max(1, word.replace(/[^a-z0-9]/gi, '').length);
    const punctuation = /[.!?]$/.test(word) ? 1.65 : /[,;:]$/.test(word) ? 1.3 : 1;
    return letters * punctuation;
  });
  const total = weights.reduce((sum, item) => sum + item, 0) || 1;
  let cursor = 0;
  return weights.map((weight) => {
    const start = cursor;
    cursor += duration * weight / total;
    return { start, end: cursor };
  });
}

function assTimestamp(seconds) {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(centiseconds / 360000);
  const m = Math.floor((centiseconds % 360000) / 6000);
  const s = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function assText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

function buildKaraokeAss(width, height, items) {
  const fontSize = Math.max(26, Math.round(height * 0.033));
  const marginV = Math.max(90, Math.round(height * 0.135));
  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,Arial,${fontSize},&H0000D7FF,&H00FFFFFF,&HCC000000,&H88000000,-1,0,0,0,100,100,0,0,1,3,1,2,70,70,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const dialogues = [];

  for (const item of items) {
    const words = String(item.text || '').match(/\S+/g) || [];
    if (!words.length || item.duration <= 0) continue;
    const timings = Array.isArray(item.wordTimings) && item.wordTimings.length === words.length
      ? item.wordTimings
      : estimateWordTimings(item.text, item.duration);
    const parts = ['{\\an2\\q2}'];
    let previousEnd = 0;

    for (let i = 0; i < words.length; i++) {
      const timing = timings[i] || { start: previousEnd, end: previousEnd + 0.1 };
      const start = Math.max(previousEnd, Math.min(item.duration, Number(timing.start) || 0));
      const end = Math.max(start + 0.01, Math.min(item.duration, Number(timing.end) || start + 0.08));
      const leadingGap = Math.max(0, start - previousEnd);
      if (leadingGap > 0.015) parts.push(`{\\k${Math.max(1, Math.round(leadingGap * 100))}} `);
      const wordDuration = Math.max(0.01, end - start);
      parts.push(`{\\kf${Math.max(1, Math.round(wordDuration * 100))}}${assText(words[i])}`);
      const next = timings[i + 1];
      const nextStart = next ? Math.max(end, Number(next.start) || end) : item.duration;
      const gap = Math.max(0, nextStart - end);
      if (gap > 0.015) parts.push(`{\\k${Math.max(1, Math.round(gap * 100))}} `);
      else parts.push(' ');
      previousEnd = end;
    }

    const startTime = item.timelineStart;
    const endTime = startTime + item.duration;
    dialogues.push(`Dialogue: 0,${assTimestamp(startTime)},${assTimestamp(endTime)},Default,,0,0,0,,${parts.join('')}`);
  }
  return [...header, ...dialogues].join('\n') + '\n';
}

function escapeFfmpegFilterPath(filePath) {
  return path.resolve(filePath)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'");
}

async function renderProject(payload, onProgress = () => {}) {
  const cards = Array.isArray(payload.cards) ? payload.cards : [];
  if (cards.length > 120) throw new Error('Một video chỉ hỗ trợ tối đa 120 thẻ. Hãy chia bài thành các phần nhỏ hơn để không bị mất nội dung.');
  if (cards.length === 0) {
    throw new Error('Không có thẻ nào để render.');
  }

  const voice = payload.voice || 'lessac';
  const palette = payload.palette || 'midnight';
  const badge = payload.badge || 'ENGLISH PRACTICE';
  const footer = payload.footer || 'English Practice Studio';
  const showTranslation = Boolean(payload.showTranslation);

  // Mặc định nhẹ: 540p + low + 24fps (có option chỉnh trên UI)
  const resCfg = RESOLUTION_PRESETS[payload.resolution] || RESOLUTION_PRESETS['540p'];
  const qualCfg = QUALITY_PRESETS[payload.quality] || QUALITY_PRESETS['low'];
  const fps = [24, 30, 60].includes(Number(payload.fps)) ? Number(payload.fps) : 24;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(JOBS_DIR, { recursive: true });

  const jobId = `video-${Date.now().toString(36)}`;
  const workDir = path.join(JOBS_DIR, jobId);
  fs.mkdirSync(workDir, { recursive: true });

  onProgress(5, 'Đang tạo giọng đọc từng thẻ...');

  const painter = new Painter(resCfg.width, resCfg.height, palette);
  const frameConcat = [];
  const audioConcat = [];
  const timeline = [];
  const karaokeItems = [];
  const karaokeEnabled = payload.karaoke !== false;
  let clock = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const pct = 5 + Math.round(((i + 1) / cards.length) * 60);
    onProgress(pct, `Đang xử lý thẻ ${i + 1}/${cards.length}...`);

    const speechText = composeTransitionSpeech(cards, i);
    const speechRate = Number(payload.speechRate ?? 0.8) || 0.8;
    const { wavPath, wordTimings } = await tts.synth(speechText, voice, { elevenlabsApiKey: payload.elevenlabsApiKey, speechRate });
    const normWav = path.join(workDir, `a_${i}.wav`);
    const audioDur = normalizeAudioToWav48k(wavPath, normWav);
    audioConcat.push(`file '${normWav.replace(/\\/g, '/')}'`);

    const extraPause = card.type === 'question' ? Number(card.countdown ?? 5) : 0.45;
    const pauseWav = path.join(workDir, `p_${i}.wav`);
    generateSilenceWav48k(extraPause, pauseWav);
    audioConcat.push(`file '${pauseWav.replace(/\\/g, '/')}'`);

    const totalCardDur = audioDur + extraPause;
    const validWordTimings = Array.isArray(wordTimings) && wordTimings.length === (speechText.match(/\S+/g) || []).length
      ? wordTimings.map((item) => ({ start: Math.max(0, Math.min(audioDur, Number(item.start) || 0)), end: Math.max(0, Math.min(audioDur, Number(item.end) || 0)) }))
      : estimateWordTimings(speechText, audioDur);
    if (karaokeEnabled) karaokeItems.push({ timelineStart: clock, duration: audioDur, text: speechText, wordTimings: validWordTimings });

    if (card.type === 'question' && extraPause >= 1) {
      const mainImg = path.join(workDir, `f_${i}_0.png`);
      fs.writeFileSync(
        mainImg,
        painter.draw(card, i, cards.length, { badge, footer, showTranslation }),
      );
      frameConcat.push(`file '${mainImg.replace(/\\/g, '/')}'`, `duration ${audioDur.toFixed(6)}`);

      const cdSteps = Math.max(1, Math.round(extraPause));
      const stepDur = extraPause / cdSteps;
      for (let s = cdSteps; s >= 1; s--) {
        const cdImg = path.join(workDir, `f_${i}_cd_${s}.png`);
        fs.writeFileSync(
          cdImg,
          painter.draw(card, i, cards.length, {
            badge,
            footer,
            showTranslation,
            countdownRemaining: s,
          }),
        );
        frameConcat.push(`file '${cdImg.replace(/\\/g, '/')}'`, `duration ${stepDur.toFixed(6)}`);
      }
    } else {
      const imgPath = path.join(workDir, `f_${i}.png`);
      fs.writeFileSync(
        imgPath,
        painter.draw(card, i, cards.length, { badge, footer, showTranslation }),
      );
      frameConcat.push(`file '${imgPath.replace(/\\/g, '/')}'`, `duration ${totalCardDur.toFixed(6)}`);
    }

    timeline.push({
      start: clock,
      end: clock + totalCardDur,
      subtitle: speechText,
      translation: card.translation || '',
    });
    clock += totalCardDur;
  }

  // Concat demuxer yêu cầu lặp lại dòng file cuối cùng không kèm duration
  if (frameConcat.length >= 2) {
    frameConcat.push(frameConcat[frameConcat.length - 2]);
  }

  const framesTxt = path.join(workDir, 'frames.txt');
  const audioTxt = path.join(workDir, 'audio.txt');
  fs.writeFileSync(framesTxt, frameConcat.join('\n') + '\n');
  fs.writeFileSync(audioTxt, audioConcat.join('\n') + '\n');

  let karaokeAssPath = null;
  if (karaokeEnabled && karaokeItems.length) {
    karaokeAssPath = path.join(workDir, 'karaoke.ass');
    fs.writeFileSync(karaokeAssPath, buildKaraokeAss(resCfg.width, resCfg.height, karaokeItems), 'utf8');
  }

  onProgress(72, `Đang ghép hình (${resCfg.width}×${resCfg.height} @ ${fps}fps)...`);
  const rawVideo = path.join(workDir, 'video.mp4');
  const videoArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    framesTxt,
    '-fps_mode',
    'cfr',
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-preset',
    qualCfg.preset,
    '-crf',
    String(qualCfg.crf),
    '-pix_fmt',
    'yuv420p',
    rawVideo,
    '-y',
  ];
  if (karaokeAssPath) {
    videoArgs.splice(videoArgs.length - 2, 0, '-vf', `subtitles='${escapeFfmpegFilterPath(karaokeAssPath)}'`);
  }
  execFileSync(FF, videoArgs);

  onProgress(86, 'Đang ghép âm thanh...');
  const rawAudio = path.join(workDir, 'audio.wav');
  execFileSync(FF, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    audioTxt,
    '-c:a',
    'pcm_s16le',
    rawAudio,
    '-y',
  ]);

  onProgress(94, 'Đang đóng gói MP4 & xuất phụ đề SRT...');
  const outMp4 = path.join(OUT_DIR, `${jobId}.mp4`);
  execFileSync(FF, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    rawVideo,
    '-i',
    rawAudio,
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    qualCfg.audioBitrate,
    '-shortest',
    '-movflags',
    '+faststart',
    outMp4,
    '-y',
  ]);

  const outSrt = path.join(OUT_DIR, `${jobId}.srt`);
  fs.writeFileSync(outSrt, buildSrtContent(timeline, false), 'utf8');

  let translatedSrtUrl = null;
  const hasAnyTranslation = timeline.some((t) => (t.translation || '').trim().length > 0);
  if (hasAnyTranslation) {
    const outTransSrt = path.join(OUT_DIR, `${jobId}.translated.srt`);
    fs.writeFileSync(outTransSrt, buildSrtContent(timeline, true), 'utf8');
    translatedSrtUrl = `/out/${jobId}.translated.srt`;
  }

  fs.writeFileSync(
    path.join(workDir, 'timeline.json'),
    JSON.stringify({ jobId, duration: clock, resolution: resCfg, fps, timeline }, null, 2),
  );

  // Dọn file ảnh & wav tạm cho nhẹ máy
  for (const f of fs.readdirSync(workDir)) {
    if (f.endsWith('.png') || f.endsWith('.wav') || f === 'video.mp4' || f === 'karaoke.ass') {
      try {
        fs.unlinkSync(path.join(workDir, f));
      } catch (_) {}
    }
  }

  onProgress(100, 'Hoàn tất!');

  return {
    jobId,
    mp4Url: `/out/${jobId}.mp4`,
    srtUrl: `/out/${jobId}.srt`,
    translatedSrtUrl,
    durationSec: Number(clock.toFixed(2)),
    cardCount: cards.length,
  };
}

module.exports = {
  Painter,
  PALETTES,
  RESOLUTION_PRESETS,
  QUALITY_PRESETS,
  renderProject,
  composeTransitionSpeech,
  estimateWordTimings,
  buildKaraokeAss,
};
