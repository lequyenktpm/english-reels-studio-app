const express = require('express');
const fs = require('fs');
const path = require('path');
const extract = require('./lib/extract');
const tts = require('./lib/tts');
const render = require('./lib/render');

const app = express();
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const OUT_DIR = path.join(ROOT, 'out');

fs.mkdirSync(OUT_DIR, { recursive: true });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/out', express.static(OUT_DIR));

const jobs = new Map();

app.get('/api/sample', (_req, res) => {
  const parsed = extract.buildCardsRuleBased(extract.SAMPLE_TEXT, { mode: 'auto' });
  res.json({
    rawText: extract.SAMPLE_TEXT,
    ...parsed,
  });
});

app.post('/api/extract-url', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    const mode = String(req.body?.mode || 'auto');
    const apiKey = String(req.body?.apiKey || '').trim();
    const useAi = req.body?.useAi !== false;
    const translationLang = String(req.body?.translationLang || 'Vietnamese');

    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Vui lòng nhập URL hợp lệ (bắt đầu bằng http:// hoặc https://).' });
    }

    const html = await extract.fetchPageHtml(url);
    const extracted = extract.extractFromHtml(html, url);

    if (extracted.isDirectoryPage) {
      let filteredLinks = extracted.links;
      let aiWarning = '';
      if (useAi && apiKey) {
        try {
          filteredLinks = await extract.selectExerciseLinksWithGemini(extracted.links, url, { apiKey });
        } catch (err) {
          aiWarning = `Gemini không lọc được danh sách link (${err.message}); đang hiển thị danh sách link gốc.`;
        }
      } else if (useAi && !apiKey) {
        aiWarning = 'Chưa nhập Gemini API Key nên AI không lọc danh sách bài tập; đang hiển thị link do bộ lọc cơ bản tìm được.';
      }
      return res.json({
        isDirectoryPage: true,
        title: extracted.title,
        links: filteredLinks,
        rawText: extracted.rawText,
        aiWarning,
        message:
          'Trang có nhiều bài tập/mục lục. Bạn có thể tích chọn nhiều bài để tạo video theo batch hoặc bấm "Bóc bài này"!',
      });
    }

    const multiExercises = extract.splitMultipleExercisesFromText(extracted.rawText, extracted.title);
    const built = await extract.buildCardsFromText(extracted.rawText, {
      title: extracted.title,
      mode,
      apiKey,
      useAi,
      translationLang,
    });

    res.json({
      isDirectoryPage: false,
      rawText: extracted.rawText,
      links: extracted.links,
      exercises: multiExercises,
      ...built,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Không thể tải trang web này.',
    });
  }
});

app.post('/api/parse-text', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const mode = String(req.body?.mode || 'auto');
    const title = String(req.body?.title || '').trim();
    const apiKey = String(req.body?.apiKey || '').trim();
    const useAi = req.body?.useAi !== false;
    const translationLang = String(req.body?.translationLang || 'Vietnamese');

    if (!text) {
      return res.status(400).json({ error: 'Vui lòng nhập hoặc dán nội dung văn bản.' });
    }
    const built = await extract.buildCardsFromText(text, {
      title,
      mode,
      apiKey,
      useAi,
      translationLang,
    });
    res.json({ rawText: text, ...built });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Lỗi phân tích văn bản.' });
  }
});

app.post('/api/preview-card', (req, res) => {
  try {
    const { card, index = 0, total = 1, palette = 'midnight', badge, footer, showTranslation } = req.body || {};
    if (!card) return res.status(400).json({ error: 'Thiếu dữ liệu thẻ.' });
    const painter = new render.Painter(540, 960, palette);
    const png = painter.draw(card, Number(index), Number(total), {
      badge,
      footer,
      showTranslation: Boolean(showTranslation),
    });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Lỗi vẽ preview.' });
  }
});

app.post('/api/elevenlabs-voices', async (req, res) => {
  try {
    const apiKey = String(req.body?.elevenlabsApiKey || '').trim();
    const voices = await tts.listElevenLabsVoices(apiKey);
    res.json({ voices });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Không thể tải danh sách giọng ElevenLabs.' });
  }
});

app.post('/api/preview-audio', async (req, res) => {
  try {
    const text = String(req.body?.text || '').trim();
    const voice = String(req.body?.voice || 'lessac');
    if (!text) return res.status(400).json({ error: 'Thẻ chưa có nội dung đọc.' });
    const elevenlabsApiKey = String(req.body?.elevenlabsApiKey || '').trim();
    const speechRate = Number(req.body?.speechRate ?? 0.8) || 0.8;
    const { wavPath, wordTimings, duration } = await tts.synth(text, voice, { elevenlabsApiKey, speechRate });
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-Karaoke-Duration', String(duration || 0));
    if (Array.isArray(wordTimings)) {
      // Chỉ truyền mốc start/end theo thứ tự token để header luôn gọn.
      const compact = wordTimings.map((item) => [Number(item.start.toFixed(3)), Number(item.end.toFixed(3))]);
      res.setHeader('X-Karaoke-Timings', Buffer.from(JSON.stringify(compact)).toString('base64'));
    }
    fs.createReadStream(wavPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Lỗi tạo giọng đọc.' });
  }
});

app.post('/api/render', (req, res) => {
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  jobs.set(id, { status: 'running', progress: 1, stage: 'Đang khởi tạo...', result: null, error: null });

  render
    .renderProject(req.body || {}, (progress, stage) => {
      const cur = jobs.get(id);
      if (cur) {
        cur.progress = progress;
        cur.stage = stage;
      }
    })
    .then((result) => {
      const cur = jobs.get(id);
      if (cur) {
        cur.status = 'done';
        cur.progress = 100;
        cur.stage = 'Hoàn tất!';
        cur.result = result;
      }
    })
    .catch((err) => {
      const cur = jobs.get(id);
      if (cur) {
        cur.status = 'error';
        cur.error = err instanceof Error ? err.message : 'Lỗi render video.';
      }
    });

  res.json({ jobId: id });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Không tìm thấy tiến trình.' });
  res.json(job);
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`English Reels Studio đang chạy tại http://localhost:${PORT}`);
  tts.ensure().catch(() => {});
});
