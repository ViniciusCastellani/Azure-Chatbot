const express = require('express');
const multer = require('multer');
const router = express.Router();
const { transcribeAudio, textToSpeech } = require('../services/azureSpeech');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

/**
 * POST /api/speech/transcribe
 * multipart/form-data: file=<audio .mp3/.wav/...>, locale="pt-BR" (opcional)
 */
router.post('/transcribe', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um áudio no campo "file".' });

    const locale = req.body.locale || 'pt-BR';
    const result = await transcribeAudio(req.file.buffer, req.file.originalname, locale);
    res.json(result);
  } catch (err) {
    console.error('[speech/transcribe]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao transcrever áudio no Azure AI Speech.', details: err.response?.data || err.message });
  }
});

/**
 * POST /api/speech/synthesize
 * body JSON: { text, voice?, locale? }
 * Retorna o áudio mp3 diretamente (audio/mpeg).
 */
router.post('/synthesize', express.json(), async (req, res) => {
  try {
    const { text, voice, locale } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Campo "text" é obrigatório.' });

    const audioBuffer = await textToSpeech(text, voice, locale);
    res.set('Content-Type', 'audio/mpeg');
    res.send(audioBuffer);
  } catch (err) {
    console.error('[speech/synthesize]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao sintetizar voz no Azure AI Speech.', details: err.message });
  }
});

module.exports = router;
