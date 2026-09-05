const express = require('express');
const multer = require('multer');
const router = express.Router();
const { analyzeImage } = require('../services/azureVision');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/**
 * POST /api/vision/analyze
 * multipart/form-data: file=<imagem>, features="Description,Objects,Brands,Faces" (opcional)
 */
router.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem no campo "file".' });

    const features = req.body.features
      ? req.body.features.split(',').map((f) => f.trim())
      : ['Description', 'Objects', 'Brands', 'Faces'];

    const result = await analyzeImage(req.file.buffer, features);
    res.json(result);
  } catch (err) {
    console.error('[vision/analyze]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao analisar imagem no Azure AI Vision.', details: err.response?.data || err.message });
  }
});

module.exports = router;
