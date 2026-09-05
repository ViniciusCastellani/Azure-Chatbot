const express = require('express');
const multer = require('multer');
const router = express.Router();
const { analyzeDocument } = require('../services/azureDocumentIntelligence');
const { translateDocument } = require('../services/azureDocumentTranslator');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/**
 * POST /api/document/analyze
 * multipart/form-data: file=<pdf|png|jpg>
 */
router.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um documento no campo "file".' });

    const result = await analyzeDocument(req.file.buffer, req.file.mimetype || 'application/pdf');
    res.json(result);
  } catch (err) {
    console.error('[document/analyze]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao analisar documento no Azure AI Document Intelligence.', details: err.response?.data || err.message });
  }
});

/**
 * POST /api/document/translate
 * multipart/form-data: file=<docx|pdf|pptx|xlsx|html|txt>, to=<idioma destino>, from=<idioma origem opcional>
 * Retorna { fileBase64, contentType, filename } — o arquivo já traduzido, com o layout preservado.
 */
router.post('/translate', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um documento no campo "file".' });
    const { to, from } = req.body;
    if (!to) return res.status(400).json({ error: 'Campo "to" (idioma de destino) é obrigatório.' });

    const { buffer, contentType } = await translateDocument(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      to,
      from
    );

    res.json({
      fileBase64: buffer.toString('base64'),
      contentType,
      filename: `traduzido-${to}-${req.file.originalname}`
    });
  } catch (err) {
    console.error('[document/translate]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao traduzir documento no Azure AI Translator (Document Translation).', details: err.response?.data || err.message });
  }
});

module.exports = router;
