const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const FF = require('ffmpeg-static');

const ROOT = path.resolve(__dirname, '../..');
const TTS_DIR = path.join(ROOT, 'tts');
const CACHE_DIR = path.join(TTS_DIR, 'cache');
const PIPER_BIN =
  process.platform === 'win32'
    ? path.join(TTS_DIR, 'piper', 'piper.exe')
    : path.join(TTS_DIR, 'piper', 'piper');

const VOICES = {
  lessac: {
    id: 'lessac',
    engine: 'piper',
    label: 'Piper · Lessac (Nữ Mỹ · Rõ)',
    modelName: 'en_US-lessac-medium.onnx',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx',
    configUrl:
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json',
  },
  ryan: {
    id: 'ryan',
    engine: 'piper',
    label: 'Piper · Ryan (Nam Mỹ · Trầm)',
    modelName: 'en_US-ryan-medium.onnx',
    url: 'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx',
    configUrl:
      'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/en_US-ryan-medium.onnx.json',
  },
  elevenlabs_rachel: {
    id: 'elevenlabs_rachel',
    engine: 'elevenlabs',
    voiceId: '21m00Tcm4TlvDq8ikWAM',
    modelId: 'eleven_multilingual_v2',
    label: 'ElevenLabs · Rachel (Tự nhiên)',
  },
  elevenlabs_adam: {
    id: 'elevenlabs_adam',
    engine: 'elevenlabs',
    voiceId: 'pNInz6obpgDQGcFmaJgB',
    modelId: 'eleven_multilingual_v2',
    label: 'ElevenLabs · Adam (Tự nhiên)',
  },
};

const PIPER_TAR_LINUX_URL =
  'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz';
const PIPER_ZIP_WIN_URL =
  'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip';

let piperReady = false;
let initPromise = null;

async function downloadFile(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} khi tải ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

async function ensure() {
  if (piperReady && fs.existsSync(PIPER_BIN)) return true;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      fs.mkdirSync(CACHE_DIR, { recursive: true });

      const canDownloadPiper =
        (process.platform === 'linux' && process.arch === 'x64') ||
        (process.platform === 'win32' && process.arch === 'x64');

      if (canDownloadPiper) {
        if (!fs.existsSync(PIPER_BIN)) {
          if (process.platform === 'win32') {
            console.log('[tts] Đang tải Piper binary cho Windows...');
            const zipPath = path.join(TTS_DIR, 'piper_windows_amd64.zip');
            await downloadFile(PIPER_ZIP_WIN_URL, zipPath);
            execFileSync(
              'powershell',
              [
                '-NoProfile',
                '-Command',
                `Expand-Archive -Path "${zipPath}" -DestinationPath "${TTS_DIR}" -Force`,
              ],
              { stdio: ['ignore', 'ignore', 'ignore'] },
            );
            try {
              fs.unlinkSync(zipPath);
            } catch (_) {}
          } else {
            console.log('[tts] Đang tải Piper binary cho Linux...');
            const tgz = path.join(TTS_DIR, 'piper.tar.gz');
            await downloadFile(PIPER_TAR_LINUX_URL, tgz);
            execFileSync('tar', ['-xzf', tgz, '-C', TTS_DIR]);
            try {
              fs.unlinkSync(tgz);
            } catch (_) {}
          }
        }

        for (const v of Object.values(VOICES)) {
          if (v.engine !== 'piper') continue;
          const mPath = path.join(TTS_DIR, v.modelName);
          const cPath = mPath + '.json';
          if (!fs.existsSync(mPath)) {
            console.log(`[tts] Đang tải model giọng ${v.id}...`);
            await downloadFile(v.url, mPath);
          }
          if (!fs.existsSync(cPath)) {
            await downloadFile(v.configUrl, cPath).catch(() => {});
          }
        }

        piperReady = fs.existsSync(PIPER_BIN);
      } else {
        piperReady = false;
      }
    } catch (err) {
      console.warn('[tts] Không thể tải Piper tự động:', err.message);
      piperReady = fs.existsSync(PIPER_BIN);
    } finally {
      initPromise = null;
    }
    return piperReady;
  })();

  return initPromise;
}

function writeSilentWav(outPath, durationSec = 2.0, sampleRate = 22050) {
  const numSamples = Math.max(1, Math.round(durationSec * sampleRate));
  const dataSize = numSamples * 2;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  const pcm = Buffer.alloc(dataSize);
  fs.writeFileSync(outPath, Buffer.concat([header, pcm]));
}

function synthWithWindowsSapi(text, voiceId, outWav) {
  const b64Text = Buffer.from(text, 'utf8').toString('base64');
  const preferMale = voiceId === 'ryan' ? 'true' : 'false';
  const psScript = `
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$txt = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64Text}'))
$voices = $synth.GetInstalledVoices()
$chosen = $null
foreach ($v in $voices) {
  if ($v.Enabled) {
    $desc = $v.VoiceInfo
    if (${preferMale} -and $desc.Gender -eq 'Male') { $chosen = $desc.Name; break }
    if (-not ${preferMale} -and $desc.Gender -eq 'Female') { $chosen = $desc.Name; break }
  }
}
if (-not $chosen -and $voices.Count -gt 0) { $chosen = $voices[0].VoiceInfo.Name }
if ($chosen) { $synth.SelectVoice($chosen) }
$synth.Rate = Math.max(-10, Math.min(10, Math.round((rate - 1) * 10)))
$synth.Volume = 100
$synth.SetOutputToWaveFile('${outWav.replace(/'/g, "''")}')
$synth.Speak($txt)
$synth.Dispose()
`;
  execFileSync('powershell', ['-NoProfile', '-Command', psScript], {
    stdio: ['ignore', 'ignore', 'ignore'],
    timeout: 30000,
  });
}

function elevenLabsError(status, bodyText) {
  let detail = bodyText || '';
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed?.detail?.message || parsed?.detail?.status || parsed?.detail || parsed?.message || bodyText;
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch (_) {}
  const hints = {
    401: 'API Key không hợp lệ hoặc đã bị thu hồi. Hãy kiểm tra lại key bắt đầu bằng xi-.',
    402: 'Tài khoản ElevenLabs đã hết quota/credit hoặc cần bổ sung credit.',
    403: 'API Key hiện tại không có quyền dùng tính năng/model/voice được chọn.',
    404: 'Không tìm thấy Voice ID. Hãy tải danh sách giọng từ tài khoản ElevenLabs rồi chọn lại.',
    429: 'ElevenLabs đang giới hạn tốc độ hoặc số yêu cầu đồng thời. Hãy thử lại sau.',
  };
  return `ElevenLabs API lỗi HTTP ${status}: ${hints[status] || ''} ${String(detail).slice(0, 500)}`.trim();
}

function wordTimingsFromAlignment(text, alignment) {
  if (!alignment || !Array.isArray(alignment.characters) || alignment.characters.length !== text.length ||
      !Array.isArray(alignment.character_start_times_seconds) ||
      !Array.isArray(alignment.character_end_times_seconds)) return null;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;
  const words = [];
  const re = /\S+/g;
  let match;
  while ((match = re.exec(text))) {
    const from = match.index;
    const to = from + match[0].length;
    const validStarts = starts.slice(from, to).filter((n) => Number.isFinite(n));
    const validEnds = ends.slice(from, to).filter((n) => Number.isFinite(n));
    if (!validStarts.length || !validEnds.length) {
      words.push(null);
      continue;
    }
    words.push({
      start: Math.max(0, Math.min(...validStarts)),
      end: Math.max(Math.max(...validStarts), Math.max(...validEnds)),
    });
  }
  return words.length && words.every(Boolean) ? words : null;
}

function convertMp3ToWav(mp3Path, outWav) {
  execFileSync(FF, [
    '-hide_banner', '-loglevel', 'error', '-i', mp3Path,
    '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', outWav,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
}

async function synthWithElevenLabs(text, voiceCfg, apiKey, outWav) {
  const key = (apiKey || process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) throw new Error('Chưa nhập ElevenLabs API Key.');

  const voiceId = (voiceCfg.voiceId || '').trim();
  const modelId = (voiceCfg.modelId || 'eleven_multilingual_v2').trim();
  const mp3Path = `${outWav}.mp3`;
  const body = {
    text,
    model_id: modelId,
    voice_settings: { stability: 0.45, similarity_boost: 0.75 },
  };

  // Lấy cả audio và character alignment để karaoke khớp lời đọc.
  const timedEndpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`;
  let response = await fetch(timedEndpoint, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });

  let audioBuffer;
  let wordTimings = null;
  if (response.ok) {
    const data = await response.json();
    if (!data.audio_base64) throw new Error('ElevenLabs trả về dữ liệu nhưng không có audio_base64.');
    audioBuffer = Buffer.from(data.audio_base64, 'base64');
    wordTimings = wordTimingsFromAlignment(text, data.alignment || data.normalized_alignment);
  } else {
    const errText = await response.text().catch(() => '');
    // Một số workspace/model không bật endpoint timestamps. Khi đó vẫn thử TTS chuẩn.
    if (![404, 405, 422].includes(response.status)) {
      throw new Error(elevenLabsError(response.status, errText));
    }
    const standardEndpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`;
    response = await fetch(standardEndpoint, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const standardError = await response.text().catch(() => '');
      throw new Error(elevenLabsError(response.status, standardError));
    }
    audioBuffer = Buffer.from(await response.arrayBuffer());
  }

  if (!audioBuffer || audioBuffer.length < 100) {
    throw new Error('ElevenLabs trả về file audio rỗng hoặc không hợp lệ.');
  }

  fs.writeFileSync(mp3Path, audioBuffer);
  try {
    convertMp3ToWav(mp3Path, outWav);
  } finally {
    try { fs.unlinkSync(mp3Path); } catch (_) {}
  }
  return wordTimings;
}

async function listElevenLabsVoices(apiKey) {
  const key = (apiKey || process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) throw new Error('Chưa nhập ElevenLabs API Key.');
  const res = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: { 'xi-api-key': key, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(elevenLabsError(res.status, body));
  }
  const data = await res.json();
  return (Array.isArray(data.voices) ? data.voices : []).map((v) => ({
    id: String(v.voice_id || ''),
    name: String(v.name || v.voice_id || 'Voice'),
    category: String(v.category || ''),
    labels: v.labels || {},
  })).filter((v) => v.id);
}

function applyTempoToWav(wavPath, rate) {
  if (Math.abs(rate - 1.0) < 0.01) return;
  const tmp = wavPath + '.tmp.wav';
  execFileSync(FF, [
    '-hide_banner', '-loglevel', 'error', '-i', wavPath,
    '-filter:a', `atempo=${rate.toFixed(3)}`, '-y', tmp
  ]);
  fs.renameSync(tmp, wavPath);
}

function getWavDurationSec(wavPath) {
  const buf = fs.readFileSync(wavPath);
  if (buf.length < 44) return 1.5;
  const byteRate = buf.readUInt32LE(28) || 44100;
  const dataBytes = Math.max(0, buf.length - 44);
  return Math.max(0.6, dataBytes / byteRate);
}

async function synth(text, voiceId = 'lessac', opts = {}) {
  const clean = (text || '').trim() || ' ';
  const isCustomEleven = String(voiceId).startsWith('elevenlabs:');
  const voice = isCustomEleven
    ? { id: String(voiceId), engine: 'elevenlabs', voiceId: String(voiceId).slice('elevenlabs:'.length), modelId: 'eleven_multilingual_v2' }
    : (VOICES[voiceId] || VOICES.lessac);
  const elevenKey = (opts.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY || '').trim();
  const rate = Math.min(1.5, Math.max(0.5, Number(opts.speechRate ?? 0.8) || 0.8));
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const keyFingerprint = voice.engine === 'elevenlabs'
    ? crypto.createHash('sha256').update(elevenKey).digest('hex').slice(0, 16)
    : '';
  const hash = crypto
    .createHash('sha1')
    .update(`v3timestamps::${process.platform}::${voice.id}::r=${rate.toFixed(2)}::${keyFingerprint}::${clean}`)
    .digest('hex')
    .slice(0, 16);
  const outWav = path.join(CACHE_DIR, `${voice.id.replace(/[^a-z0-9_-]/gi, '_')}-${hash}.wav`);
  const timingPath = `${outWav}.timing.json`;
  let wordTimings = null;

  if (!fs.existsSync(outWav)) {
    if (voice.engine === 'elevenlabs') {
      wordTimings = await synthWithElevenLabs(clean, voice, elevenKey, outWav);
      applyTempoToWav(outWav, rate);
      if (wordTimings) {
        // Điều chỉnh timestamps theo tốc độ phát sau khi đã thay đổi tempo.
        wordTimings = wordTimings.map((w) => ({ start: w.start / rate, end: w.end / rate }));
        fs.writeFileSync(timingPath, JSON.stringify(wordTimings));
      }
    } else {
      const ok = await ensure();
      const modelPath = path.join(TTS_DIR, voice.modelName);

      if (ok && fs.existsSync(PIPER_BIN) && fs.existsSync(modelPath)) {
        const lengthScale = (1 / rate).toFixed(3);
        execFileSync(PIPER_BIN, ['--model', modelPath, '--length_scale', lengthScale, '--output_file', outWav], {
          input: clean,
          stdio: ['pipe', 'ignore', 'ignore'],
        });
      } else if (process.platform === 'win32') {
        try {
          synthWithWindowsSapi(clean, voice.id, outWav);
        } catch (err) {
          console.warn('[tts] Windows SAPI lỗi, tạo file WAV dự phòng:', err.message);
          const words = clean.split(/\s+/).filter(Boolean).length;
          writeSilentWav(outWav, Math.min(18, Math.max(1.5, words / 2.4)));
        }
      } else {
        const words = clean.split(/\s+/).filter(Boolean).length;
        writeSilentWav(outWav, Math.min(18, Math.max(1.5, words / 2.4)));
      }
    }
  }

  if (!wordTimings && fs.existsSync(timingPath)) {
    try { wordTimings = JSON.parse(fs.readFileSync(timingPath, 'utf8')); } catch (_) {}
  }

  return {
    wavPath: outWav,
    duration: getWavDurationSec(outWav),
    wordTimings,
  };
}

module.exports = {
  VOICES,
  ensure,
  synth,
  getWavDurationSec,
  listElevenLabsVoices,
};
