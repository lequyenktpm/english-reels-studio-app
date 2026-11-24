# Test report — English Reels Studio 1.1.0

## Passed

- `node --check` passed for `app/server.js`, `app/lib/extract.js`, `app/lib/tts.js`, `app/lib/render.js` and the inline JavaScript in `app/public/index.html`.
- Rule-parser regression: first actual reading sentence is retained; explicit `Reading Exercise:` header is recognized; quiz passage/questions/answers are split; `Exercise 1` at the first line is recognized.
- Gemini-without-key behavior: returns an explicit warning and identifies the active engine as `rules`.
- Built-in sample content coverage check: approximately 98% of source keywords and 95% of ordered word pairs retained by the rule-based parser.
- Mock ElevenLabs API test: accessible-voice list parsing, timestamped audio response parsing, MP3-to-WAV conversion and per-word alignment all passed.
- FFmpeg MP3-to-WAV smoke test: PCM WAV 24 kHz mono produced successfully.
- Karaoke ASS subtitle smoke test: FFmpeg rendered the ASS karaoke filter successfully.
- Full render pipeline smoke test with synthetic audio and a dummy frame: 5 cards were rendered into an MP4 with video and audio streams; video/audio durations were about 9.08 / 9.12 seconds.

## Not tested with real account credentials

- No real Gemini or ElevenLabs API Key was provided, so the user's actual account, voice permissions, credits/quota and current service availability cannot be verified here.
- The render smoke test substitutes synthetic audio and a dummy frame; it validates the FFmpeg/ASS pipeline, not the quality of a real voice or the visual design of a complete lesson.
- `npm install --no-audit --no-fund` was attempted in the build environment but timed out before dependencies finished installing; therefore a full local browser session was not run. Run `bash start.sh` on the user's machine to install dependencies and start the app.
