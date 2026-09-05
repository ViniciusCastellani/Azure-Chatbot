const { analyzeImage } = require('./azureVision');
const { transcribeAudio, textToSpeech } = require('./azureSpeech');
const { analyzeSentiment, recognizeEntities } = require('./azureLanguage');
const { translateText } = require('./azureTranslator');
const { analyzeDocument } = require('./azureDocumentIntelligence');
const { translateDocument } = require('./azureDocumentTranslator');

/**
 * Executa uma sequência de passos (steps) de serviços Azure, encadeando a
 * saída textual de um passo como entrada do próximo quando aplicável.
 *
 * Extraído de routes/pipeline.js para ser reaproveitado tanto pela rota
 * /api/pipeline/execute (upload manual) quanto pela rota /api/chat/plan
 * (execução automática quando o próprio usuário já forneceu o texto/idiomas
 * na mensagem inicial).
 */
async function runSteps({ steps, initialText = null, fileBuffer = null, fileMimeType = null, fileName = null }) {
  let currentText = initialText;
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

  return { steps: trace, finalText: currentText };
}

module.exports = { runSteps };