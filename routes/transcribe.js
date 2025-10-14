// routes/transcribe.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch'); // node-fetch v2 or compatible
const { v4: uuidv4 } = require('uuid');

let FileTypeModule;
try {
  FileTypeModule = require('file-type');
} catch (err) {
  console.warn('file-type module not installed or failed to load. Install with `npm install file-type`');
  FileTypeModule = null;
}

// ffmpeg for conversion
let ffmpeg, ffmpegPath;
try {
  ffmpeg = require('fluent-ffmpeg');
  ffmpegPath = require('ffmpeg-static');
  ffmpeg.setFfmpegPath(ffmpegPath);
} catch (err) {
  console.warn('fluent-ffmpeg or ffmpeg-static not installed. Install with `npm install fluent-ffmpeg ffmpeg-static`');
  ffmpeg = null;
  ffmpegPath = null;
}

const router = express.Router();

// uploads/voice must already exist (your server.js creates it)
const voiceDir = path.join(__dirname, '..', 'uploads', 'voice');
if (!fs.existsSync(voiceDir)) {
  fs.mkdirSync(voiceDir, { recursive: true });
}

const SUPPORTED = ['flac','m4a','mp3','mp4','mpeg','mpga','oga','ogg','wav','webm']; // keep 3gp out; we will convert it

async function detectFileType(buffer) {
  if (!FileTypeModule) return null;
  const fn = FileTypeModule.fileTypeFromBuffer || FileTypeModule.fromBuffer || FileTypeModule.fromBufferSync;
  if (typeof fn !== 'function') return null;
  try {
    const result = await fn(buffer);
    return result; // {ext, mime} or undefined
  } catch (e) {
    try {
      const maybe = FileTypeModule.fromBuffer ? FileTypeModule.fromBuffer(buffer) : null;
      return maybe;
    } catch (err) {
      return null;
    }
  }
}

function convertToWav(inputPath, outputPath) {
  if (!ffmpeg) return Promise.reject(new Error('ffmpeg not available'));
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .outputOptions([
        '-ar 16000',      // sample rate 16k
        '-ac 1',          // mono
        '-sample_fmt s16' // 16-bit
      ])
      .toFormat('wav')
      .save(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err));
  });
}

router.post('/', async (req, res) => {
  try {
    const { audio_base64, filename: clientFilename } = req.body;
    if (!audio_base64) {
      return res.status(400).json({ message: 'audio_base64 is required in request body' });
    }

    // decode base64
    const audioBuffer = Buffer.from(audio_base64, 'base64');

    // Detect file type from buffer
    const ft = await detectFileType(audioBuffer);
    let detectedExt = ft?.ext || null;
    let detectedMime = ft?.mime || null;

    const clientExt = clientFilename && path.extname(clientFilename).replace('.', '') || null;
    const extToUse = detectedExt || clientExt || 'm4a'; // fallback
    const mimeToUse = detectedMime || (extToUse === 'mp3' ? 'audio/mpeg' : `audio/${extToUse}`);

    const uniqueName = `${Date.now()}-${uuidv4()}.${extToUse}`;
    const filePath = path.join(voiceDir, uniqueName);

    // write file
    fs.writeFileSync(filePath, audioBuffer);

    // If it's 3gp / 3gpp we will convert to wav first
    let fileToSendPath = filePath;
    let contentTypeToSend = mimeToUse;
    let convertedTempPath = null;

    const is3gp = (detectedExt && detectedExt.toLowerCase() === '3gp')
                 || (detectedMime && detectedMime.includes('3gpp'))
                 || (clientExt && clientExt.toLowerCase() === '3gp');

    if (is3gp) {
      if (!ffmpeg) {
        // cleanup original file
        try { fs.unlinkSync(filePath); } catch (e) {}
        return res.status(500).json({ message: 'Server cannot convert 3gp: ffmpeg not installed on server' });
      }

      // convert to wav
      convertedTempPath = filePath.replace(/\.[^/.]+$/, '.wav');
      try {
        await convertToWav(filePath, convertedTempPath);
        // use converted file
        fileToSendPath = convertedTempPath;
        contentTypeToSend = 'audio/wav';
        // remove original 3gp (we'll try to remove again later if needed)
        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
      } catch (err) {
        console.error('ffmpeg convert failed', err);
        // cleanup and return error
        try { fs.unlinkSync(filePath); } catch (e) {}
        return res.status(500).json({ message: 'Failed to convert 3gp to wav', error: err.message || err });
      }
    } else {
      // Not 3gp — only allow supported formats
      if (!SUPPORTED.includes(extToUse)) {
        // cleanup
        try { fs.unlinkSync(filePath); } catch (e) {}
        return res.status(400).json({
          message: 'Unsupported audio format. Supported formats: ' + SUPPORTED.join(', '),
          detected: detectedExt ? `${detectedExt} (${detectedMime})` : `unknown (client said ${clientFilename || 'none'})`
        });
      }
    }

    // prepare multipart form, include proper filename and content type
    const form = new FormData();
    form.append('file', fs.createReadStream(fileToSendPath), {
      filename: path.basename(fileToSendPath),
      contentType: contentTypeToSend,
    });
    form.append('model', 'whisper-1');

    // call OpenAI Whisper transcription endpoint
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      // cleanup
      try { fs.unlinkSync(fileToSendPath); } catch (e) {}
      return res.status(500).json({ message: 'OPENAI_API_KEY is not configured on the server' });
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (!response.ok) {
      const text = await response.text();
      // cleanup
      try { fs.unlinkSync(fileToSendPath); } catch (e) {}
      console.error('OpenAI transcription error:', response.status, text);
      return res.status(502).json({ message: 'Transcription provider error', details: text });
    }

    const data = await response.json();

    // cleanup file after success (non-blocking)
    try { fs.unlinkSync(fileToSendPath); } catch (e) { /* ignore */ }
    // in case conversion created a separate file (we already removed original), ensure original removed
    try {
      if (convertedTempPath && fs.existsSync(convertedTempPath) === false && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (e) { /* ignore */ }

    return res.json({ transcript: data.text || '', raw: data });

  } catch (err) {
    console.error('Transcription error:', err);
    return res.status(500).json({ message: 'Transcription failed', error: err.message || err });
  }
});

module.exports = router;
