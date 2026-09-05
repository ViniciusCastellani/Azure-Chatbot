const express = require('express');
const router = express.Router();
const { analyzeSentiment, recognizeEntities } = require('../services/azureLanguage');

/**
 * POST /api/language/sentiment
 * body JSON: { text, language? }
 */
router.post('/sentiment', express.json(), async (req, res) => {
  try {
    const { text, language } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Campo "text" é obrigatório.' });

    const result = await analyzeSentiment(text, language || 'pt');
    res.json(result);
  } catch (err) {
    console.error('[language/sentiment]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao analisar sentimento no Azure AI Language.', details: err.response?.data || err.message });
  }
});

/**
 * POST /api/language/entities
 * body JSON: { text, language? }
 */
router.post('/entities', express.json(), async (req, res) => {
  try {
    const { text, language } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Campo "text" é obrigatório.' });

    const result = await recognizeEntities(text, language || 'pt');
    res.json(result);
  } catch (err) {
    console.error('[language/entities]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao extrair entidades no Azure AI Language.', details: err.response?.data || err.message });
  }
});

module.exports = router;
