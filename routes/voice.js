// routes/voice.js
// Full implementation with optional ElevenLabs TTS + optional OpenAI Whisper recognition.
// - If ELEVENLABS_API_KEY is present, /synthesize will call ElevenLabs TTS for the given voiceId
// - If ELEVENLABS_VOICE_CLONE_ENABLED=true and ELEVENLABS_API_KEY set, /clone will attempt to call ElevenLabs voice creation endpoint
// - If OPENAI_API_KEY is present, /recognize will call OpenAI's audio transcription (whisper) endpoint
//
// Env variables used (optional):
// - ELEVENLABS_API_KEY
// - ELEVENLABS_VOICE_CLONE_ENABLED = "true" (if you want server to attempt remote voice clone automatically)
// - ELEVENLABS_VOICE_CREATE_URL (optional override if provider endpoint differs)
// - OPENAI_API_KEY
// - BASE_URL (optional) - used to build returned audio paths if needed
//
// SAFETY: Ensure you have consent from anyone whose voice you clone. Do not clone voices without explicit permission.

const express = require('express');
const { body, validationResult } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const auth = require('../middleware/auth');

const router = express.Router();

// Ensure upload dir exists
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'voice');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer setup (shared with previous file)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.wav';
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `voice-${uniqueSuffix}${ext}`);
  }
});

const allowedExt = new Set(['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.webm', '.flac']);
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mimetype = file.mimetype || '';
    if (!mimetype.startsWith('audio/') || !allowedExt.has(ext)) {
      return cb(new Error('Only audio files are allowed (wav, mp3, m4a, aac, ogg, flac)'), false);
    }
    cb(null, true);
  }
});

// Simple in-memory store for voice clones (replace with DB)
const voiceClonesStore = new Map();

/**
 * Helper: build a public URL for a saved file (if you serve /uploads statically)
 */
function publicUrlForFile(req, filePath) {
  // If you expose /uploads via express.static('/uploads'), then path after uploads should be returned
  // e.g. /uploads/voice/<filename>
  const fileName = path.basename(filePath);
  return `${req.protocol}://${req.get('host')}/uploads/voice/${fileName}`;
}

/**
 * Helper: log axios errors with JSON body decoding (similar to ai.js)
 */
function logAxiosError(prefix, err) {
  try {
    const respData = err?.response?.data;
    if (Buffer.isBuffer(respData)) {
      const txt = respData.toString('utf8');
      try {
        const json = JSON.parse(txt);
        console.error(`${prefix} (parsed):`, json);
      } catch (e) {
        console.error(`${prefix} (text):`, txt);
      }
    } else if (respData && typeof respData === 'object') {
      console.error(`${prefix}:`, respData);
    } else {
      console.error(`${prefix}:`, err?.response?.status, err?.response?.statusText, err?.message || err);
    }
  } catch (finalErr) {
    console.error(`${prefix} - logging failed:`, finalErr, err);
  }
}

/**
 * Attempt to call ElevenLabs voice creation endpoint (if available).
 * NOTE: ElevenLabs voice creation API shape can change; you may need to adapt fields.
 * This function attempts to send a multipart/form-data request with the sample audio.
 *
 * Returns: object { ok: boolean, providerResponse } on success or error details.
 */
async function createVoiceWithElevenLabs({ sampleFilePath, name, description }) {
  if (!process.env.ELEVENLABS_API_KEY) {
    return { ok: false, error: 'ELEVENLABS_API_KEY not set' };
  }

  // Some providers require a specific endpoint/shape. Allow override via env var.
  const createUrl = process.env.ELEVENLABS_VOICE_CREATE_URL || 'https://api.elevenlabs.io/v1/voices';
  const form = new FormData();

  // Common payloads: name, description, samples (file) — adjust to provider docs if needed
  form.append('name', name);
  form.append('description', description || '');
  // Many provider APIs accept multiple samples; send one file
  form.append('samples', fs.createReadStream(sampleFilePath));

  const headers = {
    ...form.getHeaders(),
    'xi-api-key': process.env.ELEVENLABS_API_KEY
  };

  try {
    const res = await axios.post(createUrl, form, { headers, timeout: 120000 });
    return { ok: true, providerResponse: res.data };
  } catch (err) {
    logAxiosError('ElevenLabs create voice error', err);
    // return structured error for caller
    const resp = err?.response?.data;
    return { ok: false, error: resp || err.message || err };
  }
}

/**
 * ElevenLabs TTS synth helper
 * voiceId: which voice id to use (string)
 * text: text to synth
 * outPath: local full path to write mp3
 *
 * Returns: { ok: boolean, savedPath } or { ok: false, error }
 */
async function synthesizeWithElevenLabs({ voiceId, text, outPath }) {
  if (!process.env.ELEVENLABS_API_KEY) return { ok: false, error: 'ELEVENLABS_API_KEY not set' };
  try {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
    const body = {
      text: String(text || ''),
      voice_settings: {
        stability: parseFloat(process.env.ELEVEN_VOICE_STABILITY || '0.4'),
        similarity_boost: parseFloat(process.env.ELEVEN_SIMILARITY_BOOST || '0.75')
      }
    };
    const headers = { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' };
    const res = await axios.post(url, body, { headers, responseType: 'arraybuffer', timeout: 120000 });
    const buffer = Buffer.from(res.data);
    await fs.promises.writeFile(outPath, buffer);
    return { ok: true, savedPath: outPath };
  } catch (err) {
    logAxiosError('ElevenLabs synth error', err);
    return { ok: false, error: err?.response?.data || err.message || err };
  }
}

/**
 * Recognize speech using OpenAI Whisper (if OPENAI_API_KEY is set)
 * Returns transcription text and other metadata.
 */
async function transcribeWithOpenAI({ audioFilePath, language = 'en' }) {
  if (!process.env.OPENAI_API_KEY) return { ok: false, error: 'OPENAI_API_KEY not set' };

  const form = new FormData();
  form.append('file', fs.createReadStream(audioFilePath));
  // model 'whisper-1' is the typical OpenAI model for transcription
  form.append('model', 'whisper-1');
  // optional: language param may or may not be accepted; keep as prompt param if needed
  try {
    const res = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
      headers: {
        ...form.getHeaders(),
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      timeout: 120000
    });
    // OpenAI returns { text: "..." } for transcription
    return { ok: true, transcription: res.data?.text || '', providerResponse: res.data };
  } catch (err) {
    logAxiosError('OpenAI transcription error', err);
    return { ok: false, error: err?.response?.data || err.message || err };
  }
}

/**
 * POST /api/voice/clone
 * multipart/form-data: audioFile (file), name, description
 *
 * Behavior:
 * - saves uploaded file locally
 * - creates a voice clone record (mock/in-memory) with status 'queued'
 * - if ELEVENLABS_VOICE_CLONE_ENABLED=true and ELEVENLABS_API_KEY set, attempts to call provider immediately
 */
router.post('/clone', [
  auth,
  upload.single('audioFile'),
  body('name').trim().isLength({ min: 1, max: 80 }).withMessage('Voice name is required'),
  body('description').optional().trim().isLength({ max: 250 }).withMessage('Description too long')
], async (req, res) => {
  try {
    // validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      if (req.file && req.file.path) try { fs.unlinkSync(req.file.path); } catch (e) {}
      return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });
    }
    if (!req.file) return res.status(400).json({ status: 'error', message: 'Audio file is required' });

    const { name, description } = req.body;
    const audioFile = req.file;
    const id = `vc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // create in-memory record (replace with DB save)
    const record = {
      id,
      name,
      description: description || '',
      localPath: audioFile.path,
      audioFileUrl: publicUrlForFile(req, audioFile.path),
      status: 'queued',
      provider: null,
      providerMeta: null,
      createdAt: new Date()
    };
    voiceClonesStore.set(id, record);

    // if configured, attempt remote clone now (async attempt)
    const remoteEnabled = String(process.env.ELEVENLABS_VOICE_CLONE_ENABLED || '').toLowerCase() === 'true';
    if (remoteEnabled && process.env.ELEVENLABS_API_KEY) {
      // kick off but don't block the response for long
      (async () => {
        try {
          const providerRes = await createVoiceWithElevenLabs({
            sampleFilePath: audioFile.path,
            name,
            description
          });

          if (providerRes.ok) {
            record.status = 'ready';
            record.provider = 'elevenlabs';
            record.providerMeta = providerRes.providerResponse;
          } else {
            record.status = 'failed';
            record.provider = 'elevenlabs';
            record.providerMeta = providerRes.error;
          }
          voiceClonesStore.set(id, record);
        } catch (e) {
          console.error('Voice clone background error:', e);
          record.status = 'failed';
          record.providerMeta = e;
          voiceClonesStore.set(id, record);
        }
      })();
    }

    return res.json({
      status: 'success',
      message: 'Voice clone queued',
      data: { voiceClone: record }
    });
  } catch (error) {
    console.error('Voice cloning error (route):', error);
    if (req.file && req.file.path) try { fs.unlinkSync(req.file.path); } catch (e) {}
    return res.status(500).json({ status: 'error', message: 'Server error during voice cloning' });
  }
});

/**
 * GET /api/voice/clones
 * Return clones (mock). In a real app, return clones filtered by req.parentId or user.
 */
router.get('/clones', auth, async (req, res) => {
  try {
    const clones = Array.from(voiceClonesStore.values()).sort((a, b) => b.createdAt - a.createdAt);
    res.json({ status: 'success', data: { voiceClones: clones } });
  } catch (error) {
    console.error('Get voice clones error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

/**
 * POST /api/voice/synthesize
 * body: { text, voiceId, speed?, pitch? }
 *
 * Behavior:
 * - If ELEVENLABS_API_KEY is present and voiceId looks like an ElevenLabs id, call ElevenLabs TTS
 * - Otherwise returns a mock audio URL (you can swap to other providers)
 */
router.post('/synthesize', [
  auth,
  body('text').trim().isLength({ min: 1, max: 1200 }).withMessage('Text is required and must be less than 1200 characters'),
  body('voiceId').optional().trim(),
  body('speed').optional().isFloat({ min: 0.5, max: 2.0 }),
  body('pitch').optional().isFloat({ min: 0.5, max: 2.0 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ status: 'error', message: 'Validation failed', errors: errors.array() });

    const { text, voiceId = '', speed = 1.0, pitch = 1.0 } = req.body;

    // If user specified voiceId and it's from provider, try provider TTS (we support ElevenLabs)
    const elevenKey = process.env.ELEVENLABS_API_KEY;
    if (elevenKey && voiceId) {
      // synth to local file in uploads
      const outFileName = `synth-${Date.now()}-${Math.round(Math.random() * 1e6)}.mp3`;
      const outPath = path.join(UPLOAD_DIR, outFileName);

      const synthRes = await synthesizeWithElevenLabs({ voiceId, text, outPath });
      if (synthRes.ok) {
        return res.json({
          status: 'success',
          message: 'Speech synthesized successfully (ElevenLabs)',
          data: {
            audioUrl: `${req.protocol}://${req.get('host')}/uploads/voice/${outFileName}`,
            duration: Math.max(1, Math.ceil(text.length / 10)),
            voiceId,
            settings: { speed, pitch }
          }
        });
      } else {
        // provider failed, log and fallthrough to mock
        console.warn('ElevenLabs synth failed, falling back to mock:', synthRes.error);
      }
    }

    // If no provider or provider failed, produce mock (placeholder) and return simulated audio path
    // You can replace this with call to another TTS provider (Google/AWS) if desired.
    const mockOutFile = `synth-mock-${Date.now()}.mp3`;
    const mockOutPath = path.join(UPLOAD_DIR, mockOutFile);
    // Create a tiny silent file or copy a placeholder if you want; here we create an empty file as placeholder
    try { fs.writeFileSync(mockOutPath, ''); } catch (e) { /* ignore */ }

    res.json({
      status: 'success',
      message: 'Speech synthesized (mock)',
      data: {
        audioUrl: `${req.protocol}://${req.get('host')}/uploads/voice/${mockOutFile}`,
        duration: Math.max(1, Math.ceil(text.length / 10)),
        voiceId: voiceId || 'mock',
        settings: { speed, pitch }
      }
    });
  } catch (error) {
    console.error('Speech synthesis error:', error);
    res.status(500).json({ status: 'error', message: 'Server error during speech synthesis' });
  }
});

/**
 * POST /api/voice/recognize
 * multipart: audioFile
 *
 * Behavior:
 * - If OPENAI_API_KEY present -> use OpenAI Whisper transcription
 * - else -> return mocked transcription
 */
router.post('/recognize', [
  auth,
  upload.single('audioFile'),
  body('language').optional().isString()
], async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ status: 'error', message: 'Audio file is required' });

    const { language = 'en' } = req.body;
    const audioFile = req.file;

    if (process.env.OPENAI_API_KEY) {
      const tRes = await transcribeWithOpenAI({ audioFilePath: audioFile.path, language });
      if (tRes.ok) {
        return res.json({
          status: 'success',
          message: 'Speech recognized successfully',
          data: {
            transcription: tRes.transcription,
            confidence: null, // OpenAI does not always return a per-word confidence in this endpoint
            language,
            provider: 'openai',
            providerResponse: tRes.providerResponse
          }
        });
      } else {
        console.warn('OpenAI transcription failed, falling back to mock:', tRes.error);
      }
    }

    // Fallback mock transcription
    const mockTranscriptions = [
      "I want to help the bird",
      "Let's go on an adventure",
      "Can we play again?",
      "I love this story",
      "What happens next?"
    ];
    const transcription = mockTranscriptions[Math.floor(Math.random() * mockTranscriptions.length)];

    // Remove uploaded file after processing if you want (optional)
    // fs.unlinkSync(audioFile.path);

    res.json({
      status: 'success',
      message: 'Speech recognized (mock)',
      data: {
        transcription,
        confidence: 0.9,
        language,
        duration: Math.ceil(audioFile.size / 1000),
        provider: 'mock'
      }
    });
  } catch (error) {
    console.error('Speech recognition error:', error);
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ status: 'error', message: 'Server error during speech recognition' });
  }
});

/**
 * Delete clone
 */
router.delete('/clones/:voiceId', auth, async (req, res) => {
  try {
    const { voiceId } = req.params;
    if (voiceClonesStore.has(voiceId)) {
      const rec = voiceClonesStore.get(voiceId);
      // option: delete local sample file
      if (rec && rec.localPath && fs.existsSync(rec.localPath)) {
        try { fs.unlinkSync(rec.localPath); } catch (e) { /* ignore */ }
      }
      voiceClonesStore.delete(voiceId);
      return res.json({ status: 'success', message: 'Voice clone record removed' });
    }
    return res.status(404).json({ status: 'error', message: 'Voice clone not found' });
  } catch (error) {
    console.error('Delete voice clone error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

/**
 * Status check
 */
router.get('/status/:voiceId', auth, async (req, res) => {
  try {
    const { voiceId } = req.params;
    const record = voiceClonesStore.get(voiceId);
    if (!record) return res.status(404).json({ status: 'error', message: 'Voice clone not found' });
    res.json({ status: 'success', data: { voiceId: record.id, status: record.status, provider: record.provider || null, providerMeta: record.providerMeta || null } });
  } catch (error) {
    console.error('Get voice status error:', error);
    res.status(500).json({ status: 'error', message: 'Server error' });
  }
});

module.exports = router;
