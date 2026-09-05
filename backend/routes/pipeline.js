const express = require('express');
const multer = require('multer');
const router = express.Router();

const { analyzeImage } = require('../services/azureVision');
const { transcribeAudio, textToSpeech } = require('../services/azureSpeech');
const { analyzeSentiment, recognizeEntities } = require('../services/azureLanguage');
const { translateText } = require('../services/azureTranslator');
const { analyzeDocument } = require('../services/azureDocumentIntelligence');
const { translateDocument } = require('../services/azureDocumentTranslator');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

/**
 * POST /api/pipeline/execute
 * multipart/form-data:
 *   - steps: JSON.stringify([{ service, inputType, params }, ...])  (vindo do plano do OpenRouter)
 *   - text:  texto inicial (quando o primeiro passo usa inputType "text")
 *   - file:  arquivo inicial (quando o primeiro passo usa inputType "audio"|"image"|"document")
 *
 * Executa os passos NA ORDEM definida pelo plano. A saída textual de um
 * passo (ex: transcrição) alimenta automaticamente o próximo passo que
 * espera texto (ex: análise de sentimento), implementando o encadeamento
 * de serviços pedido no projeto.
 */
router.post('/execute', upload.single('file'), async (req, res) => {
  try {
    const steps = JSON.parse(req.body.steps || '[]');
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: 'Campo "steps" (array) é obrigatório.' });
    }

    let currentText = req.body.text || null;
    const fileBuffer = req.file ? req.file.buffer : null;
    const fileMimeType = req.file ? req.file.mimetype : null;
    const fileName = req.file ? req.file.originalname : null;

    const trace = [];

    for (const step of steps) {
      const { service, params = {} } = step;

      switch (service) {
        case 'vision': {
          if (!fileBuffer) throw new Error('Etapa "vision" exige upload de imagem.');
          const features = params.features || ['Description', 'Objects', 'Brands', 'Faces'];
          const result = await analyzeImage(fileBuffer, features);
          trace.push({ service, result });
          break;
        }

        case 'speech-to-text': {
          if (!fileBuffer) throw new Error('Etapa "speech-to-text" exige upload de áudio.');
          const result = await transcribeAudio(fileBuffer, fileName || 'audio.wav', params.locale || 'pt-BR');
          currentText = result.combinedPhrases?.map((p) => p.text).join(' ') || '';
          trace.push({ service, result, extractedText: currentText });
          break;
        }

        case 'sentiment': {
          if (!currentText) throw new Error('Etapa "sentiment" exige um texto (direto ou de uma etapa anterior).');
          const result = await analyzeSentiment(currentText, params.language || 'pt');
          trace.push({ service, result });
          break;
        }

        case 'ner': {
          if (!currentText) throw new Error('Etapa "ner" exige um texto (direto ou de uma etapa anterior).');
          const result = await recognizeEntities(currentText, params.language || 'pt');
          trace.push({ service, result });
          break;
        }

        case 'translate': {
          if (!currentText) throw new Error('Etapa "translate" exige um texto (direto ou de uma etapa anterior).');
          const result = await translateText(currentText, params.from, params.to);
          currentText = result?.[0]?.translations?.[0]?.text || currentText;
          trace.push({ service, result });
          break;
        }

        case 'document-intelligence': {
          if (!fileBuffer) throw new Error('Etapa "document-intelligence" exige upload de documento.');
          const result = await analyzeDocument(fileBuffer, fileMimeType || 'application/pdf');
          currentText = result.analyzeResult?.content || currentText;
          trace.push({ service, result });
          break;
        }

        case 'document-translate': {
          if (!fileBuffer) throw new Error('Etapa "document-translate" exige upload de um documento (.docx, .pdf, .pptx, .xlsx).');
          if (!params.to) throw new Error('Etapa "document-translate" exige o idioma de destino em params.to.');
          const { buffer, contentType } = await translateDocument(
            fileBuffer,
            fileName || 'documento',
            fileMimeType,
            params.to,
            params.from
          );
          trace.push({
            service,
            fileBase64: buffer.toString('base64'),
            contentType,
            filename: `traduzido-${params.to}-${fileName || 'documento'}`
          });
          break;
        }

        case 'text-to-speech': {
          const textToSpeak = params.text || currentText;
          if (!textToSpeak) throw new Error('Etapa "text-to-speech" exige um texto (direto ou de uma etapa anterior).');
          const audioBuffer = await textToSpeech(textToSpeak, params.voice, params.locale);
          trace.push({ service, audioBase64: audioBuffer.toString('base64'), mimeType: 'audio/mpeg' });
          break;
        }

        default:
          trace.push({ service, error: `Serviço "${service}" desconhecido.` });
      }
    }

    res.json({ steps: trace, finalText: currentText });
  } catch (err) {
    console.error('[pipeline/execute]', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao executar o pipeline de serviços Azure.', details: err.response?.data || err.message });
  }
});

module.exports = router;
