const express = require('express');
const router = express.Router();
const { translateText } = require('../services/azureTranslator');

/**
 * POST /api/translate
 * body JSON: { text, from, to }
 */
router.post('/', express.json(), async (req, res) => {
  try {
    const { text, from, to } = req.body;
    if (!text || !to) return res.status(400).json({ error: 'Campos "text" e "to" são obrigatórios.' });

    const result = await translateText(text, from, to);
    res.json(result);
  } catch (err) {
    console.error('[translate]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao traduzir texto no Azure AI Translator.', details: err.response?.data || err.message });
  }
});

module.exports = router;
