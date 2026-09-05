const axios = require('axios');
const FormData = require('form-data');

/**
 * Azure AI Speech - Fast Transcription API
 * Identificado no HAR: POST .../speechtotext/transcriptions:transcribe?api-version=2025-10-15
 * Aceita multipart/form-data com o arquivo de áudio (.mp3, .wav, .ogg, .m4a...).
 *
 * @param {Buffer} audioBuffer
 * @param {string} originalFilename
 * @param {string} locale - ex: 'pt-BR'
 */
async function transcribeAudio(audioBuffer, originalFilename = 'audio.wav', locale = 'pt-BR') {
  const region = process.env.AZURE_SPEECH_REGION;
  const key = process.env.AZURE_SPEECH_KEY;
  if (!region || !key) {
    throw new Error('AZURE_SPEECH_REGION / AZURE_SPEECH_KEY não configurados no .env');
  }

  const url = `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe`;

  const form = new FormData();
  form.append('audio', audioBuffer, { filename: originalFilename });
  form.append(
    'definition',
    JSON.stringify({
      locales: [locale],
      profanityFilterMode: 'Masked'
    })
  );

  const response = await axios.post(url, form, {
    params: { 'api-version': '2025-10-15' },
    headers: {
      ...form.getHeaders(),
      'Ocp-Apim-Subscription-Key': key
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  });

  return response.data;
}

/**
 * Azure AI Speech - Text To Speech (SSML)
 * Identificado no HAR: POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1
 *
 * @param {string} text
 * @param {string} voice - ex: 'pt-BR-ThalitaNeural'
 * @param {string} locale - ex: 'pt-BR'
 * @returns {Buffer} áudio mp3
 */
async function textToSpeech(text, voice = 'pt-BR-ThalitaNeural', locale = 'pt-BR') {
  const region = process.env.AZURE_SPEECH_REGION;
  const key = process.env.AZURE_SPEECH_KEY;
  if (!region || !key) {
    throw new Error('AZURE_SPEECH_REGION / AZURE_SPEECH_KEY não configurados no .env');
  }

  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const ssml = `<speak version='1.0' xml:lang='${locale}'>
  <voice xml:lang='${locale}' xml:gender='Female' name='${voice}'>
    ${escaped}
  </voice>
</speak>`;

  const response = await axios.post(url, ssml, {
    headers: {
      'Content-Type': 'application/ssml+xml',
      'Ocp-Apim-Subscription-Key': key,
      'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
    },
    responseType: 'arraybuffer'
  });

  return Buffer.from(response.data);
}

module.exports = { transcribeAudio, textToSpeech };
