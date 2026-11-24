const cheerio = require('cheerio');

const SAMPLE_TEXT = `Reading Exercise: Hello!
My name is Mark and I am 24 years old. I live in London with my younger sister, Anna. Every morning, I wake up at 7:00 AM, drink a cup of coffee, and take the train to work. I work as a graphic designer in a small studio near the river.
On weekends, I love cooking Italian food and playing football with my friends in the park. Sometimes Anna and I visit our parents in Oxford.

Are the sentences True or False?
1. Mark is twenty-four years old.
2. He lives in Oxford with his parents.
3. Mark goes to work by train every morning.
4. He works as a doctor in a big hospital.
5. On weekends, he enjoys cooking Italian food.

Answers:
1. True
2. False
3. True
4. False
5. True`;

function cleanText(str) {
  return (str || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchPageHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`Trang web trả về mã lỗi HTTP ${res.status}`);
  }
  return await res.text();
}

function extractFromHtml(html, sourceUrl = '') {
  const $ = cheerio.load(html);

  $('script, style, nav, header, footer, aside, iframe, noscript, form, .sidebar, .menu, .navigation, .ads, .advertisement, .share, .social, .comments, #comments, .related-posts, .breadcrumb').remove();

  const pageTitle =
    cleanText($('h1').first().text()) ||
    cleanText($('title').text().split('|')[0].split('-')[0]) ||
    'English Practice Lesson';

  const root =
    $('article .entry-content').first().length
      ? $('article .entry-content').first()
      : $('.entry-content').first().length
      ? $('.entry-content').first()
      : $('article').first().length
      ? $('article').first()
      : $('main').first().length
      ? $('main').first()
      : $('body');

  const links = [];
  root.find('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = cleanText($(el).text());
    if (
      href &&
      text.length > 8 &&
      /^https?:\/\//i.test(href) &&
      !href.includes('#') &&
      !href.includes('facebook.com') &&
      !href.includes('twitter.com') &&
      !href.includes('pinterest.com')
    ) {
      links.push({ title: text, url: href });
    }
  });

  const blocks = [];
  root.find('h1, h2, h3, h4, h5, p, li, blockquote, pre, td, th, dt, dd, div').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'p' && $(el).parents('li').length > 0) return;
    if (tag === 'div') {
      // Nhiều web bài tập bọc nội dung trong div + span thay vì p.
      // Chỉ lấy div lá hoặc div chỉ chứa inline tags để tránh lấy trùng wrapper.
      if ($(el).find('div, p, li, h1, h2, h3, h4, h5, blockquote, pre, table').length > 0) return;
      const childTags = $(el).children().toArray().map((child) => child.tagName.toLowerCase());
      if (childTags.some((name) => !['span', 'strong', 'em', 'b', 'i', 'a', 'br', 'code', 'small'].includes(name))) return;
    }
    let txt = cleanText($(el).text());
    if (!txt) return;
    if (/^(share this|related posts|leave a reply|tags:|category:|previous|next)/i.test(txt)) return;
    if (tag === 'li') {
      const parentTag = $(el).parent()[0]?.tagName?.toLowerCase();
      if (parentTag === 'ol') {
        const idx = $(el).index() + 1;
        if (!/^\d+[\.\)]/.test(txt)) {
          txt = `${idx}. ${txt}`;
        }
      }
    }
    blocks.push(txt);
  });

  const uniqueBlocks = [];
  const seenBlocks = new Set();
  for (const block of blocks) {
    const key = block.toLowerCase().replace(/\s+/g, ' ').trim();
    if (!key || seenBlocks.has(key)) continue;
    seenBlocks.add(key);
    uniqueBlocks.push(block);
  }
  const rawText = cleanText(uniqueBlocks.join('\n'));
  // Lọc các link bài tập cùng domain hoặc liên quan tới reading/exercise/practice
  const exerciseLinks = links.filter((lk) => {
    try {
      const u = new URL(lk.url);
      const baseU = sourceUrl ? new URL(sourceUrl) : null;
      const sameHost = baseU ? u.hostname === baseU.hostname : true;
      return sameHost && lk.url !== sourceUrl && !/category|tag|author|page\//i.test(u.pathname);
    } catch (_) {
      return false;
    }
  });

  const isDirectoryPage =
    (links.length >= 6 && blocks.filter((b) => b.length > 90).length <= 2) ||
    (exerciseLinks.length >= 5 && blocks.filter((b) => b.length > 140).length <= 3);

  return {
    title: pageTitle,
    rawText,
    isDirectoryPage,
    links: (exerciseLinks.length >= 3 ? exerciseLinks : links).slice(0, 40),
  };
}

function detectMode(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const hasTrueFalseHeader = /true\s*(or|\/)\s*false|answer\s+the\s+questions|answer\s+the\s+following|comprehension|multiple\s+choice|choose\s+the\s+correct|^questions?\s*:?$/im.test(text);
  const numberedLines = lines.filter((l) => /^\d+[\.\)]\s+/.test(l));
  if (hasTrueFalseHeader && numberedLines.length >= 2) {
    return 'quiz';
  }

  const vocabLines = lines.filter((l) => /^[^—–\-:]{1,35}\s*[—–\-:]\s*.{2,}$/.test(l));
  if (vocabLines.length >= 3) {
    return 'vocab';
  }

  return 'reading';
}

function splitIntoSentencesOrChunks(paragraph, maxChars = 190) {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g) || [paragraph];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    const t = s.trim();
    if (!t) continue;
    if ((cur + ' ' + t).trim().length > maxChars && cur) {
      chunks.push(cur.trim());
      cur = t;
    } else {
      cur = (cur + ' ' + t).trim();
    }
  }
  if (cur) chunks.push(cur.trim());
  return chunks;
}

function normalizeCardItem(item, idx) {
  const validTypes = new Set(['title', 'reading', 'vocab', 'question', 'answer', 'outro']);
  const type = validTypes.has(item?.type) ? item.type : 'reading';
  const base = {
    id: item?.id || `c-${idx + 1}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    translation: cleanText(item?.translation || ''),
  };

  if (type === 'title' || type === 'outro') {
    const title = cleanText(item?.title || item?.body || 'English Lesson');
    const subtitle = cleanText(item?.subtitle || '');
    return {
      ...base,
      kicker: cleanText(item?.kicker || (type === 'title' ? 'ENGLISH PRACTICE' : '')),
      title,
      subtitle,
      speech: cleanText(item?.speech || `${title}${subtitle ? '. ' + subtitle : ''}`),
    };
  }

  if (type === 'vocab') {
    const word = cleanText(item?.word || '');
    const meaning = cleanText(item?.meaning || '');
    const example = cleanText(item?.example || '');
    return {
      ...base,
      indexLabel: cleanText(item?.indexLabel || `VOCAB ${idx + 1}`),
      word,
      meaning,
      example,
      speech: cleanText(
        item?.speech ||
          (example ? `${word}. ${meaning}. Example: ${example}` : `${word}. ${meaning}.`),
      ),
    };
  }

  if (type === 'question') {
    const question = cleanText(item?.question || item?.body || '');
    const countdown = Math.min(15, Math.max(1, Number(item?.countdown || 5)));
    return {
      ...base,
      indexLabel: cleanText(item?.indexLabel || `QUESTION ${idx + 1}`),
      question,
      countdown,
      speech: cleanText(item?.speech || question),
    };
  }

  if (type === 'answer') {
    const question = cleanText(item?.question || '');
    const answer = cleanText(item?.answer || item?.body || 'True');
    return {
      ...base,
      indexLabel: cleanText(item?.indexLabel || `ANSWER ${idx + 1}`),
      question,
      answer,
      speech: cleanText(item?.speech || `The answer is ${answer}.`),
    };
  }

  const body = cleanText(item?.body || item?.text || item?.title || '');
  return {
    ...base,
    indexLabel: cleanText(item?.indexLabel || `PART ${idx + 1}`),
    body,
    speech: cleanText(item?.speech || body),
  };
}

function buildCardsRuleBased(rawText, options = {}) {
  const text = cleanText(rawText);
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const mode = options.mode && options.mode !== 'auto' ? options.mode : detectMode(text);
  let title = cleanText(options.title || '');
  let consumedTitleLine = false;
  const firstLine = lines[0] || '';
  const titleHeader = firstLine.match(/^(?:reading\s+exercise|exercise|lesson|unit|vocabulary|vocab|quiz|topic)\s*(?:#?\d+)?\s*[:：–—-]\s*(.*)$/i);
  const titleMarkerOnly = /^(?:reading\s+exercise|exercise|lesson|unit|vocabulary|vocab|quiz|topic)\s*(?:#?\d+)?$/i.test(firstLine);
  if (titleHeader || titleMarkerOnly) {
    // Chỉ lấy dòng đầu làm tiêu đề khi có nhãn rõ ràng; không đoán theo độ dài.
    if (!title) title = cleanText(titleHeader?.[1]) || firstLine.replace(/[:：–—-]$/, '').trim();
    consumedTitleLine = true;
  } else if (title && firstLine && firstLine.toLowerCase().replace(/[\s:：.!?]+$/g, '') === title.toLowerCase().replace(/[\s:：.!?]+$/g, '')) {
    // Trang HTML có thể đưa tiêu đề H1 lặp lại vào phần nội dung; chỉ bỏ khi trùng chính xác.
    consumedTitleLine = true;
  }
  if (!title) title = 'English Practice';

  const cards = [];

  if (mode === 'vocab') {
    cards.push(
      normalizeCardItem(
        {
          id: 'c-intro',
          type: 'title',
          kicker: 'ENGLISH VOCABULARY',
          title,
          subtitle: 'Listen, repeat & remember',
          speech: title,
        },
        0,
      ),
    );

    const items = [];
    for (const line of lines) {
      const m = line.match(/^([^—–\-:]{1,40})\s*[—–\-:]\s*(.+)$/);
      if (m) {
        const word = m[1].replace(/^\d+[\.\)]\s*/, '').trim();
        const rest = m[2].trim();
        const parts = rest.split(/\.\s+(?=Ex:|Example:)/i);
        const meaning = parts[0].trim();
        const example = parts[1] ? parts[1].replace(/^(Ex|Example):\s*/i, '').trim() : '';
        items.push({ word, meaning, example });
      }
    }

    items.forEach((it, idx) => {
      cards.push(
        normalizeCardItem(
          {
            id: `c-vocab-${idx + 1}`,
            type: 'vocab',
            indexLabel: `${String(idx + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`,
            word: it.word,
            meaning: it.meaning,
            example: it.example,
          },
          cards.length,
        ),
      );
    });

    cards.push(
      normalizeCardItem(
        {
          id: 'c-outro',
          type: 'outro',
          title: 'GREAT JOB!',
          subtitle: 'Save this video and practice every day.',
          speech: 'Great job! Save this video and practice every day.',
        },
        cards.length,
      ),
    );

    return { mode, title, cards, engine: 'rules' };
  }

  if (mode === 'quiz') {
    const passageLines = [];
    const questionItems = [];
    const answerMap = new Map();
    const quizLines = [];
    const quizHeading = /\b(?:are the sentences\s+true\s+or\s+false|true\s+or\s+false|answer\s+(?:the|these)\s+questions|answer\s+the\s+following\s+questions|read\s+(?:the\s+)?(?:text|passage)\s+and\s+answer|decide\s+whether|comprehension\s+questions?|multiple\s+choice|choose\s+the\s+correct\s+answer)\b/i;
    for (const line of lines) {
      const headingMatch = quizHeading.exec(line);
      if (headingMatch && headingMatch.index > 0) {
        const before = line.slice(0, headingMatch.index).trim();
        const after = line.slice(headingMatch.index).trim();
        if (before) quizLines.push(before);
        if (after) quizLines.push(after);
      } else {
        quizLines.push(line);
      }
    }

    let section = 'passage';
    for (let i = 0; i < quizLines.length; i++) {
      const line = quizLines[i];
      if (i === 0 && consumedTitleLine && title && line.toLowerCase() === firstLine.toLowerCase()) continue;

      if (/^(are the sentences|true or false|questions?\s*:?$|comprehension|answer (?:the|these) questions|answer the following|read (?:the )?(?:text|passage) and answer|decide whether|multiple choice|choose the correct)/i.test(line)) {
        section = 'questions';
        continue;
      }
      if (/^(answers|answer key|key)\s*:?$/i.test(line)) {
        section = 'answers';
        continue;
      }

      if (section === 'passage') {
        passageLines.push(line);
      } else if (section === 'questions') {
        const qm = line.match(/^(\d+)[\.\)]\s*(.+)$/);
        if (qm) {
          questionItems.push({ num: Number(qm[1]), question: qm[2].trim() });
        }
      } else if (section === 'answers') {
        const am = line.match(/^(\d+)[\.\)]\s*(.+)$/);
        if (am) {
          answerMap.set(Number(am[1]), am[2].trim());
        } else {
          const tfMatches = [...line.matchAll(/(true|false)\s*:\s*([0-9,\s]+)/gi)];
          for (const m of tfMatches) {
            const label = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
            const nums = m[2]
              .split(',')
              .map((n) => Number(n.trim()))
              .filter(Boolean);
            for (const n of nums) answerMap.set(n, label);
          }
        }
      }
    }

    cards.push(
      normalizeCardItem(
        {
          id: 'c-intro',
          type: 'title',
          kicker: 'ENGLISH READING & QUIZ',
          title,
          subtitle: 'Read carefully & answer True or False',
          speech: `${title}. Read carefully and answer the questions.`,
        },
        0,
      ),
    );

    const passageChunks = [];
    for (const p of passageLines) {
      passageChunks.push(...splitIntoSentencesOrChunks(p, 200));
    }

    passageChunks.forEach((chunk, idx) => {
      cards.push(
        normalizeCardItem(
          {
            id: `c-read-${idx + 1}`,
            type: 'reading',
            indexLabel: `PART ${idx + 1}/${passageChunks.length}`,
            body: chunk,
            speech: chunk,
          },
          cards.length,
        ),
      );
    });

    questionItems.forEach((q, idx) => {
      const ans = answerMap.get(q.num) || 'Check the text';
      cards.push(
        normalizeCardItem(
          {
            id: `c-q-${q.num}`,
            type: 'question',
            indexLabel: `QUESTION ${idx + 1}/${questionItems.length}`,
            question: q.question,
            countdown: 5,
            speech: `Question ${q.num}. ${q.question}`,
          },
          cards.length,
        ),
      );

      cards.push(
        normalizeCardItem(
          {
            id: `c-a-${q.num}`,
            type: 'answer',
            indexLabel: `ANSWER ${idx + 1}/${questionItems.length}`,
            question: q.question,
            answer: ans,
            speech: `The answer is ${ans}.`,
          },
          cards.length,
        ),
      );
    });

    cards.push(
      normalizeCardItem(
        {
          id: 'c-outro',
          type: 'outro',
          title: 'WELL DONE!',
          subtitle: 'How many answers did you get right?',
          speech: 'Well done! Comment your score below.',
        },
        cards.length,
      ),
    );

    return { mode, title, cards, engine: 'rules' };
  }

  cards.push(
    normalizeCardItem(
      {
        id: 'c-intro',
        type: 'title',
        kicker: 'ENGLISH READING PRACTICE',
        title,
        subtitle: 'Listen & read along',
        speech: title,
      },
      0,
    ),
  );

  const bodyLines = lines.filter((l, idx) => !(idx === 0 && consumedTitleLine));
  const chunks = [];
  for (const p of bodyLines) {
    chunks.push(...splitIntoSentencesOrChunks(p, 200));
  }

  chunks.forEach((chunk, idx) => {
    cards.push(
      normalizeCardItem(
        {
          id: `c-read-${idx + 1}`,
          type: 'reading',
          indexLabel: `${String(idx + 1).padStart(2, '0')} / ${String(chunks.length).padStart(2, '0')}`,
          body: chunk,
          speech: chunk,
        },
        cards.length,
      ),
    );
  });

  cards.push(
    normalizeCardItem(
      {
        id: 'c-outro',
        type: 'outro',
        title: 'KEEP PRACTICING!',
        subtitle: 'Follow for daily English reading lessons.',
        speech: 'Keep practicing! Follow for daily English lessons.',
      },
      cards.length,
    ),
  );

  return { mode, title, cards, engine: 'rules' };
}

const COVERAGE_STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'that', 'this',
  'was', 'were', 'has', 'have', 'had', 'his', 'her', 'she', 'him', 'they', 'them',
  'their', 'there', 'here', 'what', 'when', 'where', 'which', 'who', 'why', 'how',
  'from', 'into', 'onto', 'then', 'than', 'also', 'can', 'could', 'would', 'should',
  'will', 'shall', 'may', 'might', 'must', 'does', 'did', 'doing', 'done', 'been',
  'being', 'its', 'it', 'our', 'out', 'about', 'over', 'under', 'after', 'before',
  'between', 'because', 'while', 'during', 'each', 'every', 'some', 'any', 'all',
  'both', 'more', 'most', 'much', 'many', 'such', 'very', 'too', 'only', 'own',
  'same', 'other', 'another', 'than', 'then', 'once', 'here', 'there', 'yes', 'no',
  'true', 'false', 'answer', 'answers', 'question', 'questions', 'exercise', 'reading',
  'practice', 'lesson', 'part', 'section', 'text', 'example', 'examples', 'read',
]);

function coverageTokens(value) {
  return (String(value || '').toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [])
    .filter((token) => token.length >= 3 && !COVERAGE_STOP_WORDS.has(token));
}

function getCardsOriginalText(cards) {
  const fields = [];
  for (const card of cards) {
    for (const key of ['body', 'question', 'answer', 'word', 'meaning', 'example', 'title', 'subtitle']) {
      if (typeof card[key] === 'string' && card[key].trim()) fields.push(card[key]);
    }
  }
  return fields.join(' ');
}

function measureSourceCoverage(rawText, cards) {
  const sourceTokens = coverageTokens(rawText);
  const outputTokens = new Set(coverageTokens(getCardsOriginalText(cards)));
  const uniqueSource = [...new Set(sourceTokens)];
  const matched = uniqueSource.filter((token) => outputTokens.has(token));
  const ratio = uniqueSource.length ? matched.length / uniqueSource.length : 1;
  const outputSequence = coverageTokens(getCardsOriginalText(cards));
  const makeBigrams = (tokens) => {
    const values = new Set();
    for (let i = 0; i < tokens.length - 1; i++) values.add(`${tokens[i]} ${tokens[i + 1]}`);
    return values;
  };
  const sourceBigrams = makeBigrams(sourceTokens);
  const outputBigrams = makeBigrams(outputSequence);
  const matchedBigrams = [...sourceBigrams].filter((pair) => outputBigrams.has(pair)).length;
  const sequenceRatio = sourceBigrams.size ? matchedBigrams / sourceBigrams.size : ratio;
  const sourceSentences = (rawText.match(/[^.!?\n]+(?:[.!?]+|$)/g) || [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => coverageTokens(sentence).length >= 4);
  const missingSentences = sourceSentences.filter((sentence) => {
    const tokens = [...new Set(coverageTokens(sentence))];
    if (!tokens.length) return false;
    const sentenceRecall = tokens.filter((token) => outputTokens.has(token)).length / tokens.length;
    return sentenceRecall < 0.68;
  });
  return { ratio, sequenceRatio, totalTerms: uniqueSource.length, matchedTerms: matched.length, totalBigrams: sourceBigrams.size, matchedBigrams, missingSentences };
}

async function buildCardsWithGemini(rawText, options = {}) {
  const apiKey = (options.apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Chưa nhập Gemini API Key.');
  }

  const model = (options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const modeHint = options.mode && options.mode !== 'auto' ? options.mode : 'auto detect (reading, quiz, or vocab)';
  const translationLang = (options.translationLang || 'Vietnamese').trim();

  if (rawText.length > 30000) {
    throw new Error(`Nội dung dài ${rawText.length.toLocaleString('en-US')} ký tự, vượt ngưỡng an toàn 30.000 ký tự của một lượt AI. Bộ tách dự phòng sẽ giữ nguyên nội dung để tránh cắt mất phần cuối.`);
  }

  const prompt = [
    'You are an expert educational video script & card builder.',
    'Given raw English learning content, remove only obvious navigation/ads/noise and convert the remaining lesson into vertical video cards (maximum 60 cards).',
    `Preferred mode: ${modeHint}.`,
    `If helpful, include a concise natural ${translationLang} translation in "translation" for each card.`,
    'Return ONLY valid JSON with this exact shape:',
    '{"mode":"reading|quiz|vocab","title":"...","cards":[...]}',
    'Allowed card types and fields:',
    '- {"type":"title","kicker":"...","title":"...","subtitle":"...","speech":"...","translation":"..."}',
    '- {"type":"reading","indexLabel":"PART 1/3","body":"...","speech":"...","translation":"..."}',
    '- {"type":"vocab","indexLabel":"01 / 05","word":"...","meaning":"...","example":"...","speech":"...","translation":"..."}',
    '- {"type":"question","indexLabel":"Q 1/5","question":"...","countdown":5,"speech":"...","translation":"..."}',
    '- {"type":"answer","indexLabel":"A 1/5","question":"...","answer":"True|False|...","speech":"...","translation":"..."}',
    '- {"type":"outro","title":"...","subtitle":"...","speech":"...","translation":"..."}',
    'CRITICAL CONTENT PRESERVATION RULES: Do NOT summarize, paraphrase, invent, correct, or omit any learning content. Keep every original English sentence, question, answer, vocabulary item, definition, and example. Copy the original English text verbatim into the appropriate card fields. Split long paragraphs across multiple reading cards rather than shortening them. Keep the original order. Do not discard content merely to fit a card.',
    'For reading cards, use about 1-3 complete sentences per card; there is no character limit that permits dropping content. For questions and answers, create one question card and its matching answer card for every source item. Keep the source English text exactly as provided.',
    '',
    'RAW CONTENT:',
    rawText.slice(0, 30000),
  ].join('\n');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API lỗi HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const finishReason = data?.candidates?.[0]?.finishReason || '';
  if (finishReason === 'MAX_TOKENS') throw new Error('Gemini đã chạm giới hạn token và có thể cắt mất phần cuối. Đã chuyển sang bộ tách dự phòng.');
  const rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleanedJson = rawJsonText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(cleanedJson);

  if (!Array.isArray(parsed.cards) || parsed.cards.length === 0) {
    throw new Error('Gemini không trả về danh sách thẻ hợp lệ.');
  }

  if (parsed.cards.length > 60) {
    throw new Error(`Gemini tạo ${parsed.cards.length} thẻ, vượt giới hạn 60 thẻ. Hãy chia nội dung thành các bài nhỏ hơn để không bị cắt mất phần cuối.`);
  }
  const cards = parsed.cards.map((c, idx) => normalizeCardItem(c, idx));
  const coverage = measureSourceCoverage(rawText, cards);
  if (coverage.ratio < 0.88 || (coverage.totalBigrams >= 12 && coverage.sequenceRatio < 0.72) || coverage.missingSentences.length > Math.max(1, Math.ceil((rawText.length / 1800) * 0.5))) {
    const missed = coverage.missingSentences.length;
    throw new Error(`Gemini có dấu hiệu thiếu hoặc đảo sai nội dung (giữ ${Math.round(coverage.ratio * 100)}% từ khóa, ${Math.round(coverage.sequenceRatio * 100)}% cặp từ theo đúng thứ tự; khoảng ${missed} câu cần kiểm tra). Đã chuyển sang bộ tách dự phòng để ưu tiên giữ đủ văn bản.`);
  }
  return {
    mode: parsed.mode || (options.mode && options.mode !== 'auto' ? options.mode : 'reading'),
    title: cleanText(parsed.title || options.title || 'English Practice'),
    cards,
    coverage: Math.round(coverage.ratio * 100), sequenceCoverage: Math.round(coverage.sequenceRatio * 100),
    engine: `gemini:${model}`,
  };
}

async function buildCardsFromText(rawText, options = {}) {
  const apiKey = (options.apiKey || process.env.GEMINI_API_KEY || '').trim();
  const wantsAi = options.useAi !== false;
  const useAi = wantsAi && Boolean(apiKey);
  if (useAi) {
    try {
      return await buildCardsWithGemini(rawText, options);
    } catch (err) {
      const fallback = buildCardsRuleBased(rawText, options);
      return {
        ...fallback,
        aiWarning: err instanceof Error ? err.message : 'Lỗi gọi Gemini AI, đã dùng bộ tách luật dự phòng.',
      };
    }
  }
  const fallback = buildCardsRuleBased(rawText, options);
  if (wantsAi && !apiKey) {
    return { ...fallback, aiWarning: 'Gemini AI chưa được chạy vì chưa nhập Gemini API Key. Ứng dụng đang dùng bộ tách theo quy tắc (rules), không phải AI. Có thể nhập key ở cột bên trái rồi phân tích lại để dùng Gemini.' };
  }
  return fallback;
}


async function selectExerciseLinksWithGemini(links, sourceUrl, options = {}) {
  const apiKey = (options.apiKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || !Array.isArray(links) || links.length === 0) return links.slice(0, 20);
  const model = (options.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const prompt = [
    'Given a list of links found on an English learning webpage, select ONLY the individual English reading/grammar/vocabulary/quiz exercise links (exclude categories, menus, ads, social links, or unrelated pages).',
    `Source URL: ${sourceUrl}`,
    'Return ONLY a JSON array of objects: [{"title":"...","url":"..."}]',
    'Links:',
    JSON.stringify(links.slice(0, 50)),
  ].join('\n');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) return links.slice(0, 20);
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  const arr = JSON.parse(cleaned);
  if (!Array.isArray(arr) || !arr.length) return links.slice(0, 20);
  const known = new Map(links.map((item) => [String(item.url || '').trim(), item]));
  const selected = [];
  const seen = new Set();
  for (const item of arr) {
    const url = String(item?.url || '').trim();
    const original = known.get(url);
    if (original && !seen.has(url)) {
      seen.add(url);
      selected.push(original);
    }
  }
  return selected.length ? selected.slice(0, 25) : links.slice(0, 20);
}


function splitMultipleExercisesFromText(rawText, pageTitle = 'English Exercise') {
  const text = cleanText(rawText);
  if (!text) return [];
  // Tách theo các tiêu đề bài tập kiểu "Exercise 1", "Reading 1", "Part 1", "1. ...", hoặc các khối có "True or False" lặp lại
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const markers = [];
  lines.forEach((line, idx) => {
    if (/^(exercise|reading|passage|text|part|lesson|quiz)\s*\d+\b/i.test(line)) {
      markers.push({ idx, title: line });
    }
  });

  if (markers.length >= 2) {
    const groups = [];
    for (let m = 0; m < markers.length; m++) {
      const start = markers[m].idx;
      const end = m + 1 < markers.length ? markers[m + 1].idx : lines.length;
      const chunkText = lines.slice(start, end).join('\n');
      if (chunkText.length > 40) {
        groups.push({
          title: markers[m].title,
          rawText: chunkText,
        });
      }
    }
    if (groups.length >= 2) return groups;
  }

  return [{ title: pageTitle, rawText: text }];
}

module.exports = {
  splitMultipleExercisesFromText,
  selectExerciseLinksWithGemini,
  SAMPLE_TEXT,
  fetchPageHtml,
  extractFromHtml,
  detectMode,
  buildCardsFromText,
  buildCardsWithGemini,
  buildCardsRuleBased,
  measureSourceCoverage,
};
