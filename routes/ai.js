// routes/ai.js
const express = require('express');
const { body, validationResult } = require('express-validator');
const axios = require('axios');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const mongoose = require('mongoose');
const Story = require('../models/Story');
const Child = require('../models/Child');
const auth = require('../middleware/auth');

const router = express.Router();

const AUDIO_DIR = path.join(__dirname, '..', 'public', 'ai-audio');
const DEFAULT_TARGET_PER_CATEGORY = parseInt(process.env.TARGET_PER_CATEGORY || '1', 10);

async function ensureAudioDir() {
  try {
    await fsp.mkdir(AUDIO_DIR, { recursive: true });
  } catch (e) {}
}

function logAxiosError(prefix, err) {
  try {
    if (err && err.response) {
      const status = err.response.status;
      const statusText = err.response.statusText;
      let bodyPreview = null;
      try {
        const d = err.response.data;
        if (Buffer.isBuffer(d)) bodyPreview = d.toString('utf8').slice(0, 1000);
        else if (typeof d === 'object') bodyPreview = JSON.stringify(d).slice(0, 1000);
        else bodyPreview = String(d).slice(0, 1000);
      } catch (e) {
        bodyPreview = '<unreadable response body>';
      }
      console.error(`${prefix}: status=${status} ${statusText} bodyPreview=${bodyPreview}`);
    } else {
      console.error(prefix, err && err.message ? err.message : err);
    }
  } catch (e) {
    console.error('logAxiosError failure', e);
  }
}

async function textToElevenlabsAudio(text, filenamePrefix = 'ai', req) {
  const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
  if (!ELEVEN_API_KEY) return null;

  async function callTTSForVoice(voiceId) {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const body = {
      text: String(text || ''),
      voice_settings: {
        stability: parseFloat(process.env.ELEVEN_VOICE_STABILITY || '0.4'),
        similarity_boost: parseFloat(process.env.ELEVEN_SIMILARITY_BOOST || '0.75'),
      },
    };
    const headers = { 'xi-api-key': ELEVEN_API_KEY, 'Content-Type': 'application/json' };
    return axios.post(url, body, { headers, responseType: 'arraybuffer', timeout: 120000 });
  }

  async function saveBufferAndGetUrl(arraybuffer, prefix) {
    const buffer = Buffer.from(arraybuffer);
    await ensureAudioDir();
    const filename = `${prefix}-${Date.now()}.mp3`;
    const filepath = path.join(AUDIO_DIR, filename);
    await fsp.writeFile(filepath, buffer);
    const proto = req && req.protocol ? req.protocol : 'http';
    const host = req && req.get ? req.get('host') : (process.env.HOSTNAME || 'localhost:3000');
    return `${proto}://${host}/ai-audio/${filename}`;
  }

  const configuredVoice = (process.env.ELEVENLABS_VOICE || '').trim() || null;

  if (configuredVoice) {
    try {
      const res = await callTTSForVoice(configuredVoice);
      return await saveBufferAndGetUrl(res.data, filenamePrefix);
    } catch (err) {
      logAxiosError('ElevenLabs TTS error (configured voice)', err);
    }
  }

  try {
    const voicesRes = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': ELEVEN_API_KEY },
      timeout: 20000,
    });
    const candidates = voicesRes.data?.voices || voicesRes.data || [];
    const candidate = Array.isArray(candidates) && candidates.length ? candidates[0] : null;
    const fallbackVoiceId = candidate && (candidate.voice_id || candidate.id || candidate.voiceId || candidate.uuid);
    if (!fallbackVoiceId) return null;
    try {
      const res = await callTTSForVoice(fallbackVoiceId);
      process.env.ELEVENLABS_VOICE = fallbackVoiceId;
      return await saveBufferAndGetUrl(res.data, filenamePrefix);
    } catch (err) {
      logAxiosError('ElevenLabs TTS error (fallback voice)', err);
      return null;
    }
  } catch (err) {
    logAxiosError('ElevenLabs list voices error', err);
    return null;
  }
}

async function generateWithOpenAI(messages, max_tokens = 1200, model = 'gpt-3.5-turbo') {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OpenAI API key not set');
    return '';
  }
  try {
    const payload = { model, messages, max_tokens, temperature: 0.8, n: 1 };
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
    const res = await axios.post('https://api.openai.com/v1/chat/completions', payload, {
      headers,
      timeout: 120000,
    });
    const choice = res.data?.choices?.[0];
    return choice?.message?.content || '';
  } catch (err) {
    logAxiosError('OpenAI error', err);
    return '';
  }
}

const STORY_CATEGORIES = {
  'mom-stories': {
    label: 'Stories from Mom',
    icon: '👩',
    prompt: "Generate warm, nurturing stories told from a mother's perspective. Focus on bedtime comfort, gentle life lessons, and family love.",
    theme: 'family',
    category: 'audio',
  },
  'grandma-stories': {
    label: 'Stories from Grandma',
    icon: '👵',
    prompt: "Generate wise, nostalgic stories told from a grandmother's perspective. Include timeless wisdom, traditions, and gentle humor.",
    theme: 'family',
    category: 'audio',
  },
  'now-stories': {
    label: 'Perfect Right Now',
    icon: '⭐',
    prompt: 'Generate engaging, age-appropriate stories perfect for the current moment. Include adventure, excitement, and positive energy.',
    theme: 'adventure',
    category: 'interactive',
  },
  'learn-stories': {
    label: 'Learning Adventures',
    icon: '🎓',
    prompt: 'Generate educational stories that teach concepts through adventure. Focus on science, nature, problem-solving, and curiosity.',
    theme: 'learning',
    category: 'educational',
  },
};

function parseGeneratedText(text, childName, childAge, count) {
  const lines = (text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const parsed = [];

  for (let i = 0; i < lines.length && parsed.length < count; i++) {
    const line = lines[i];
    let parts = line.split(' - ');
    if (parts.length < 3) parts = line.split(' — ');
    if (parts.length < 3) parts = line.split(' – ');
    if (parts.length < 3) parts = line.split(':');
    if (parts.length < 3) parts = line.split(' | ');

    if (parts.length < 3) continue;

    let title = (parts[0] || `Story ${parsed.length + 1}`).replace(/^[\d\.\)\s]+/, '').trim();
    title = title.substring(0, 100);

    let description = parts[1] || `A wonderful story for ${childName}.`;
    description = description.substring(0, 500);

    const storyText = parts.slice(2).join(' - ').trim();

    let duration = 8;
    const durMatch = line.match(/(\d{1,2})\s*min/i);
    if (durMatch) duration = Math.min(20, Math.max(5, parseInt(durMatch[1], 10)));

    parsed.push({
      title: title.replace(/[-—–:]\s*\d+\s*min\.?$/i, '').trim(),
      description: description.replace(/[-—–:]\s*\d+\s*min\.?$/i, '').trim(),
      content: storyText || `Once upon a time, ${childName} discovered something magical...`,
      duration,
      ageRange: { min: Math.max(2, childAge - 2), max: Math.min(12, childAge + 2) },
    });
  }

  return parsed.slice(0, count);
}

/**
 * generateCategoryStories (no DB locks)
 *
 * - Ensures not to save if DB already has enough stories by re-checking right before saving.
 * - targetTotal: desired active stories for the collection.
 */
async function generateCategoryStories(categoryKey, childName = 'friend', childAge = 5, targetTotal = DEFAULT_TARGET_PER_CATEGORY, req = null) {
  const category = STORY_CATEGORIES[categoryKey];
  if (!category) throw new Error('Invalid categoryKey');

  // check existing active AI-generated stories first
  const existingCount = await Story.countDocuments({
    generatedForCollection: categoryKey,
    isActive: true,
    isAIGenerated: true,
  });

  const need = Math.max(0, targetTotal - existingCount);
  if (need <= 0) {
    return [];
  }

  // call OpenAI once to get needed stories
  const systemPrompt = `You are a children's story writer. ${category.prompt}
Return EXACTLY a JSON array (no extra text) with ${need} objects. Each object must have keys:
"title" (string, max 50 chars), "description" (string, max 120 chars),
"content" (string, one paragraph, 200-300 words), "duration" (integer minutes between 5 and 12).
If JSON is not possible, provide lines formatted as "Title - Description - StoryText - X min".`;

  let aiText = '';
  if (process.env.OPENAI_API_KEY) {
    aiText = await generateWithOpenAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Create ${need} ${category.label} for ${childName}, age ${childAge}.` },
    ], 1600, process.env.OPENAI_MODEL || 'gpt-3.5-turbo');
  } else {
    console.warn('OPENAI_API_KEY not configured');
  }

  const aggregatedParsed = [];

  if (aiText) {
    // try to parse JSON
    try {
      const maybeJson = aiText.trim();
      const firstBracket = maybeJson.indexOf('[');
      const lastBracket = maybeJson.lastIndexOf(']');
      if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
        const jsonStr = maybeJson.substring(firstBracket, lastBracket + 1);
        const arr = JSON.parse(jsonStr);
        if (Array.isArray(arr)) {
          for (const obj of arr) {
            if (!obj || !obj.title || !obj.content) continue;
            const candidate = {
              title: String(obj.title).trim().substring(0, 100),
              description: (obj.description || '').toString().trim().substring(0, 500),
              content: String(obj.content).trim(),
              duration: Math.min(20, Math.max(5, parseInt(obj.duration || 8, 10) || 8)),
              ageRange: { min: Math.max(2, childAge - 2), max: Math.min(12, childAge + 2) },
            };
            aggregatedParsed.push(candidate);
            if (aggregatedParsed.length >= need) break;
          }
        }
      }
    } catch (e) {
      // fall back to legacy parsing
    }
  }

  if (!aggregatedParsed.length && aiText) {
    const legacy = parseGeneratedText(aiText, childName, childAge, need);
    aggregatedParsed.push(...legacy.slice(0, need));
  }

  if (!aggregatedParsed.length) {
    // nothing parsed
    return [];
  }

  // IMPORTANT: Re-check DB immediately before saving to avoid overruns from concurrent processes
  const latestCount = await Story.countDocuments({
    generatedForCollection: categoryKey,
    isActive: true,
    isAIGenerated: true,
  });
  const remainingNeed = Math.max(0, targetTotal - latestCount);
  if (remainingNeed <= 0) {
    return [];
  }

  const toSave = aggregatedParsed.slice(0, remainingNeed);
  const saved = [];

  for (let i = 0; i < toSave.length; i++) {
    const s = toSave[i];
    
    // ✅ CRITICAL FIX: Always set generatedForCollection
    const storyData = {
      title: s.title,
      description: s.description,
      content: s.content,
      duration: s.duration,
      ageRange: s.ageRange,
      theme: category.theme,
      category: category.category,
      isAIGenerated: true,
      isActive: true,
      generatedForCollection: categoryKey, // ✅ MUST BE SET HERE
      thumbnail: category.icon,
      stats: { totalPlays: 0, completions: 0 },
    };

    try {
      // avoid exact duplicates
      const duplicate = await Story.findOne({
        title: storyData.title,
        generatedForCollection: categoryKey,
        isActive: true,
      }).lean();

      if (duplicate) {
        console.log(`Skipping duplicate story: ${storyData.title}`);
        continue;
      }

      // attempt to reuse existing audio if any
      const existingWithAudio = await Story.findOne({
        $or: [{ title: storyData.title }, { content: storyData.content }],
        audioUrl: { $exists: true, $ne: null },
      }).lean();

      if (existingWithAudio && existingWithAudio.audioUrl) {
        storyData.audioUrl = existingWithAudio.audioUrl;
        storyData.audioPending = false;
      } else if (process.env.ELEVENLABS_API_KEY && req) {
        try {
          const audioUrl = await textToElevenlabsAudio(storyData.content, `${categoryKey}-${Date.now()}-${i}`, req);
          if (audioUrl) {
            storyData.audioUrl = audioUrl;
            storyData.audioPending = false;
          } else {
            storyData.audioPending = true;
          }
        } catch (e) {
          logAxiosError('TTS error', e);
          storyData.audioPending = true;
        }
      } else {
        storyData.audioPending = !!process.env.ELEVENLABS_API_KEY;
      }

      const doc = await Story.create(storyData);
      
      // ✅ Verify the field was saved
      if (!doc.generatedForCollection) {
        console.error(`WARNING: generatedForCollection not saved for story ${doc._id}`);
      } else {
        console.log(`✅ Story saved with generatedForCollection: ${doc.generatedForCollection}`);
      }
      
      saved.push(doc);
    } catch (err) {
      console.error('Failed to save AI story:', err && err.message ? err.message : err);
    }
  }

  return saved;
}

/**
 * GET /api/ai/category-stories/:categoryKey
 * - Will NOT generate automatically if content exists.
 * - Returns initializationPending:true only when there are zero stories and generation was requested and is in progress by another endpoint.
 */
router.get('/category-stories/:categoryKey', auth, async (req, res) => {
  try {
    const { categoryKey } = req.params;
    const { childId } = req.query;
    const TARGET = DEFAULT_TARGET_PER_CATEGORY;

    if (!STORY_CATEGORIES[categoryKey]) {
      return res.status(400).json({ status: 'error', message: 'Invalid category' });
    }

    // Default child info
    let childName = 'friend';
    let childAge = 5;
    if (childId) {
      try {
        const child = await Child.findById(childId);
        if (child) {
          childName = child.name || childName;
          childAge = child.age || childAge;
        }
      } catch (e) {
        console.warn('Failed to fetch child', e);
      }
    }

    // Fetch existing AI stories
    let stories = await Story.find({
      generatedForCollection: categoryKey,
      isActive: true,
      isAIGenerated: true,
    }).sort({ createdAt: -1 }).limit(TARGET).lean();

    // If no stories exist, generate them
    if (stories.length === 0) {
      try {
        await generateCategoryStories(categoryKey, childName, childAge, TARGET, req);
        stories = await Story.find({
          generatedForCollection: categoryKey,
          isActive: true,
          isAIGenerated: true,
        }).sort({ createdAt: -1 }).limit(TARGET).lean();
      } catch (err) {
        console.error('Generation failed', err && err.message ? err.message : err);
      }
    }

    return res.json({
      status: 'success',
      data: {
        category: STORY_CATEGORIES[categoryKey],
        stories,
        childName,
        childAge,
      },
    });
  } catch (error) {
    console.error('Get category stories error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});


/**
 * POST /api/ai/regenerate-story
 * - Deactivates the provided storyId (if valid) and generates a single replacement.
 */
router.post('/regenerate-story', auth, async (req, res) => {
  try {
    const { storyId, categoryKey, childId } = req.body;
    if (!storyId || !categoryKey) return res.status(400).json({ status: 'error', message: 'storyId and categoryKey required' });
    if (!STORY_CATEGORIES[categoryKey]) return res.status(400).json({ status: 'error', message: 'Invalid category' });

    try {
      if (storyId && String(storyId).match(/^[0-9a-fA-F]{24}$/)) {
        const existingStory = await Story.findById(storyId);
        if (existingStory && existingStory.isActive) {
          existingStory.isActive = false;
          await existingStory.save();
        }
      }
    } catch (e) {
      console.warn('Warning: unable to deactivate old story:', e && e.message ? e.message : e);
    }

    let childName = 'friend';
    let childAge = 5;
    if (childId) {
      try {
        const child = await Child.findById(childId);
        if (child) {
          childName = child.name || childName;
          childAge = child.age || childAge;
        }
      } catch (e) {}
    }

    try {
      const newStories = await generateCategoryStories(categoryKey, childName, childAge, 1, req);
      const newStory = newStories && newStories.length ? newStories[0] : null;
      return res.json({ status: 'success', message: 'New story generated', data: { newStory } });
    } catch (err) {
      console.error('Regenerate error:', err && err.message ? err.message : err);
      return res.status(500).json({ status: 'error', message: 'Failed to generate replacement' });
    }
  } catch (error) {
    console.error('Regenerate story unexpected error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

/**
 * POST /api/ai/initialize-categories
 * - Will generate missing stories up to DEFAULT_TARGET_PER_CATEGORY only when explicitly called.
 */
router.post('/initialize-categories', auth, async (req, res) => {
  try {
    const { childId } = req.body;

    let childName = 'friend';
    let childAge = 5;
    if (childId) {
      try {
        const child = await Child.findById(childId);
        if (child) {
          childName = child.name || childName;
          childAge = child.age || childAge;
        }
      } catch (e) {}
    }

    const results = {};

    for (const [key, category] of Object.entries(STORY_CATEGORIES)) {
      try {
        const existing = await Story.countDocuments({
          generatedForCollection: key,
          isActive: true,
          isAIGenerated: true,
        });

        if (existing >= DEFAULT_TARGET_PER_CATEGORY) {
          results[key] = { generated: 0, total: existing, message: 'Already initialized' };
          continue;
        }

        const generated = await generateCategoryStories(key, childName, childAge, DEFAULT_TARGET_PER_CATEGORY, req);
        results[key] = { generated: generated.length, total: existing + generated.length };
      } catch (err) {
        console.error(`Initialize failed for ${key}:`, err && err.message ? err.message : err);
        results[key] = { error: err && err.message ? err.message : String(err) };
      }
    }

    res.json({ status: 'success', message: 'Categories initialized', data: results });
  } catch (error) {
    console.error('Initialize categories error:', error && error.message ? error.message : error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

// simple coach + tts endpoints preserved
router.post(
  '/coach',
  [
    auth,
    body('question').trim().isLength({ min: 1, max: 2000 }),
    body('context').optional().isObject(),
    body('childId').optional().isString(),
    body('requestAudio').optional().isBoolean(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });

      const { question } = req.body;
      let aiText = '';
      if (process.env.OPENAI_API_KEY) {
        aiText = await generateWithOpenAI(
          [{ role: 'system', content: 'You are an empathetic, evidence-based parenting coach.' }, { role: 'user', content: question }],
          700,
          process.env.OPENAI_MODEL || 'gpt-3.5-turbo'
        );
      }
      if (!aiText) aiText = "Sorry—I couldn't reach the AI service. Try again later.";

      res.json({ status: 'success', data: { question, response: aiText, timestamp: new Date(), provider: process.env.OPENAI_API_KEY ? 'openai' : 'mock' } });
    } catch (error) {
      console.error('AI coach error:', error && error.message ? error.message : error);
      res.status(500).json({ status: 'error', message: 'Server error' });
    }
  }
);

router.post(
  '/tts',
  [auth, body('text').trim().isLength({ min: 1 }), body('filenamePrefix').optional().isString()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });

      const { text, filenamePrefix = 'ai-tts' } = req.body;
      const audioUrl = await textToElevenlabsAudio(text, filenamePrefix, req);

      if (!audioUrl) return res.status(500).json({ status: 'error', message: 'TTS failed or ElevenLabs API key missing' });

      res.json({ status: 'success', data: { audioUrl, timestamp: new Date() } });
    } catch (err) {
      console.error('TTS error:', err && err.message ? err.message : err);
      res.status(500).json({ status: 'error', message: 'Server error' });
    }
  }
);

module.exports = router;
module.exports.generateCategoryStories = generateCategoryStories;
module.exports.STORY_CATEGORIES = STORY_CATEGORIES;
module.exports.DEFAULT_TARGET_PER_CATEGORY = DEFAULT_TARGET_PER_CATEGORY;
