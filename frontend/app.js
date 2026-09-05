(() => {
  const chatEl = document.getElementById('chat');
  const formEl = document.getElementById('chat-form');
  const inputEl = document.getElementById('chat-input');
  const sendBtn = document.getElementById('send-btn');
  const dynamicZone = document.getElementById('dynamic-input-zone');

  // Anexo manual (clipe): permite ao usuário anexar um arquivo à mensagem a
  // qualquer momento, independentemente do que o OpenRouter tenha decidido
  // no plano anterior. Isso cobre o caso em que o planejador identifica que
  // a tarefa precisa de um arquivo mas a zona dinâmica de upload (baseada em
  // "nextInput") não é exibida — o clipe é sempre uma via alternativa.
  const attachBtn = document.getElementById('attach-btn');
  const attachInput = document.getElementById('chat-attach-input');
  const attachmentChip = document.getElementById('attachment-chip');
  const attachmentChipName = attachmentChip.querySelector('.attachment-chip-name');
  const attachmentRemoveBtn = document.getElementById('attachment-remove');

  const history = []; // { role: 'user'|'assistant', content: string }
  let pendingSteps = null; // plano atual vindo do OpenRouter
  let userGoal = '';
  let attachedFile = null; // arquivo selecionado via clipe, aguardando envio

  // ---------- Anexo manual (clipe) ----------

  attachBtn.addEventListener('click', () => attachInput.click());

  attachInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) setAttachedFile(file);
    attachInput.value = ''; // permite selecionar o mesmo arquivo de novo depois
  });

  attachmentRemoveBtn.addEventListener('click', () => clearAttachedFile());

  function setAttachedFile(file) {
    attachedFile = file;
    attachmentChipName.textContent = file.name;
    attachmentChip.hidden = false;
    attachBtn.classList.add('has-file');
  }

  function clearAttachedFile() {
    attachedFile = null;
    attachmentChip.hidden = true;
    attachBtn.classList.remove('has-file');
  }

  // ---------- Helpers de UI ----------

  /**
   * @param {string} role 'user' | 'assistant' | 'system'
   * @param {string} html conteúdo (HTML) da bolha
   * @param {string|null} speakText se informado (e role === 'assistant'), adiciona um
   *   botão "🔊 Ouvir" que usa o Azure AI Speech (Text-to-Speech) para narrar o texto.
   */
  function addMessage(role, html, speakText = null) {
    const wrap = document.createElement('div');
    wrap.className = `message ${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.innerHTML = html;
    wrap.appendChild(bubble);

    if (role === 'assistant' && speakText && speakText.trim()) {
      bubble.appendChild(createSpeakButton(speakText.trim()));
    }

    chatEl.appendChild(wrap);
    chatEl.scrollTop = chatEl.scrollHeight;
    return bubble;
  }

  /**
   * Cria o botão "🔊 Ouvir" que chama o Azure AI Speech (Text-to-Speech) sob demanda.
   * O áudio gerado é armazenado no próprio botão para tocar novamente sem nova chamada.
   */
  function createSpeakButton(text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-speak';
    btn.innerHTML = '🔊 Ouvir';
    btn.setAttribute('aria-label', 'Ouvir esta resposta em voz alta (Azure AI Speech)');

    btn.addEventListener('click', () => handleSpeakClick(btn, text));
    return btn;
  }

  async function handleSpeakClick(btn, text) {
    // Áudio já gerado antes: apenas toca de novo (sem nova chamada à Azure).
    if (btn._audioEl) {
      btn._audioEl.currentTime = 0;
      btn._audioEl.play();
      return;
    }

    const originalLabel = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Gerando áudio...';

    try {
      const res = await fetch('/api/speech/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'pt-BR-ThalitaNeural', locale: 'pt-BR' })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Falha ao gerar áudio.');
      }

      const blob = await res.blob();
      const audio = new Audio(URL.createObjectURL(blob));
      btn._audioEl = audio;
      btn.innerHTML = '🔁 Ouvir novamente';
      btn.disabled = false;
      audio.play();
    } catch (err) {
      btn.innerHTML = '⚠️ Erro ao gerar áudio';
      setTimeout(() => {
        btn.innerHTML = originalLabel;
        btn.disabled = false;
      }, 2500);
    }
  }

  function addTypingIndicator() {
    return addMessage('assistant', '<span class="typing-indicator"><span></span><span></span><span></span></span>');
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function setBusy(busy) {
    sendBtn.disabled = busy;
    inputEl.disabled = busy;
    attachBtn.disabled = busy;
  }

  // ---------- Fluxo principal do chat ----------

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = inputEl.value.trim();
    const file = attachedFile;
    if (!text && !file) return; // precisa de mensagem e/ou arquivo anexado

    const userLabelParts = [];
    if (text) userLabelParts.push(escapeHtml(text));
    if (file) userLabelParts.push(`📎 <em>${escapeHtml(file.name)}</em>`);
    addMessage('user', userLabelParts.join('<br />'));

    // O histórico enviado ao OpenRouter continua sendo só texto.
    history.push({ role: 'user', content: text || `[arquivo anexado: ${file.name}]` });
    userGoal = text || `Analisar o arquivo anexado (${file.name})`;
    inputEl.value = '';
    clearAttachedFile();
    dynamicZone.hidden = true;
    dynamicZone.innerHTML = '';

    setBusy(true);
    const typing = addTypingIndicator();

    try {
      // Sempre enviamos como multipart/form-data: o arquivo (quando presente)
      // vai junto com a mensagem e o histórico já na primeira chamada, sem
      // depender de o OpenRouter "liberar" a zona de anexo dinâmica.
      const form = new FormData();
      form.append('message', text);
      form.append('history', JSON.stringify(history.slice(0, -1)));
      if (file) form.append('file', file);

      const res = await fetch('/api/chat/plan', { method: 'POST', body: form });
      const plan = await res.json();
      typing.parentElement.remove();

      if (!res.ok) {
        addMessage('assistant', `<span class="bubble error">${escapeHtml(plan.error || 'Erro ao consultar o planejador.')}</span>`);
        setBusy(false);
        return;
      }

      history.push({ role: 'assistant', content: plan.reply });
      addMessage('assistant', escapeHtml(plan.reply), plan.reply);

      // O usuário já forneceu o texto (ou o arquivo anexado pelo clipe já
      // bateu com o tipo exigido pelo primeiro passo): o backend já executou
      // o pipeline sozinho. Só falta mostrar o resultado.
      if (plan.autoExecuted && plan.pipelineResult) {
        renderPipelineResults(plan.pipelineResult);
        if (plan.summary) {
          history.push({ role: 'assistant', content: plan.summary });
          addMessage('assistant', escapeHtml(plan.summary), plan.summary);
        }
        setBusy(false);
        return;
      }

      if (plan.clarification) {
        addMessage('assistant', escapeHtml(plan.clarification), plan.clarification);
        setBusy(false);
        return;
      }

      pendingSteps = plan.steps || [];
      if (pendingSteps.length === 0 || plan.nextInput === 'none') {
        setBusy(false);
        return;
      }

      // Ainda falta uma etapa (upload de arquivo ou texto complementar):
      // mantém a caixa de mensagem principal travada até o usuário
      // completar essa etapa e o pipeline ser executado. O clipe continua
      // disponível aqui também, caso o usuário prefira anexar por ele.
      renderInputZone(plan.nextInput, pendingSteps);
    } catch (err) {
      typing.parentElement.remove();
      addMessage('assistant', `<span class="bubble error">Não consegui falar com o servidor. Verifique se o backend está rodando.</span>`);
      setBusy(false);
    }
  });

  // ---------- Renderização dos campos dinâmicos ----------

  function renderInputZone(kind, steps) {
    dynamicZone.innerHTML = '';
    dynamicZone.hidden = false;

    const templateId = {
      audio: 'tpl-audio-zone',
      image: 'tpl-image-zone',
      document: 'tpl-document-zone',
      text: 'tpl-text-zone'
    }[kind];

    if (!templateId) return;

    const tpl = document.getElementById(templateId);
    const node = tpl.content.cloneNode(true);
    dynamicZone.appendChild(node);

    if (kind === 'text') {
      setupTextZone(steps);
    } else {
      setupFileZone(kind, steps);
    }
  }

  function setupFileZone(kind, steps) {
    const card = dynamicZone.querySelector('.upload-card');
    const dropzone = card.querySelector('.dropzone');
    const input = card.querySelector('input[type="file"]');
    const confirmBtn = card.querySelector('.btn-confirm');
    const filePreview = card.querySelector('.file-preview');
    const imagePreview = card.querySelector('.image-preview');

    let selectedFile = null;

    function handleFile(file) {
      if (!file) return;
      selectedFile = file;
      confirmBtn.disabled = false;

      if (kind === 'image' && imagePreview) {
        imagePreview.src = URL.createObjectURL(file);
        imagePreview.hidden = false;
      } else if (filePreview) {
        filePreview.hidden = false;
        filePreview.textContent = `✅ ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
      }
    }

    dropzone.addEventListener('click', () => input.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      handleFile(file);
    });
    input.addEventListener('change', (e) => handleFile(e.target.files[0]));

    confirmBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      addMessage('user', `📎 Arquivo enviado: <em>${escapeHtml(selectedFile.name)}</em>`);
      dynamicZone.hidden = true;
      dynamicZone.innerHTML = '';
      await runPipeline({ steps, file: selectedFile });
    });
  }

  function setupTextZone(steps) {
    const card = dynamicZone.querySelector('.upload-card');
    const textarea = card.querySelector('textarea');
    const confirmBtn = card.querySelector('.btn-confirm');

    textarea.addEventListener('input', () => {
      confirmBtn.disabled = !textarea.value.trim();
    });

    confirmBtn.addEventListener('click', async () => {
      const text = textarea.value.trim();
      if (!text) return;
      addMessage('user', escapeHtml(text));
      dynamicZone.hidden = true;
      dynamicZone.innerHTML = '';
      await runPipeline({ steps, text });
    });
  }

  // ---------- Execução do pipeline no backend ----------

  async function runPipeline({ steps, file, text }) {
    setBusy(true);
    const typing = addTypingIndicator();

    try {
      const form = new FormData();
      form.append('steps', JSON.stringify(steps));
      if (file) form.append('file', file);
      if (text) form.append('text', text);

      const res = await fetch('/api/pipeline/execute', { method: 'POST', body: form });
      const data = await res.json();
      typing.parentElement.remove();

      if (!res.ok) {
        addMessage('assistant', `<span class="bubble error">${escapeHtml(data.error || 'Falha ao executar o pipeline.')}</span>`);
        return;
      }

      renderPipelineResults(data);

      // pede um resumo em linguagem natural ao OpenRouter (opcional, mas melhora a experiência)
      const summaryTyping = addTypingIndicator();
      try {
        const sumRes = await fetch('/api/chat/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userGoal, results: data.steps })
        });
        const sumData = await sumRes.json();
        summaryTyping.parentElement.remove();
        if (sumData.summary) addMessage('assistant', escapeHtml(sumData.summary), sumData.summary);
      } catch {
        summaryTyping.parentElement.remove();
      }
    } catch (err) {
      typing.parentElement.remove();
      addMessage('assistant', `<span class="bubble error">Erro de comunicação com o servidor.</span>`);
    } finally {
      setBusy(false);
    }
  }

  function renderPipelineResults(data) {
    data.steps.forEach((stepResult) => {
      const { html, speakText } = renderStepCard(stepResult);
      // O botão "Ouvir" usa o Azure AI Speech (Text-to-Speech) para narrar o
      // resultado de cada etapa (transcrição, sentimento, tradução, etc.),
      // dando ao usuário a opção de ouvir a resposta em vez de apenas lê-la.
      addMessage('assistant', html, speakText);
    });
  }

  function renderStepCard(stepResult) {
    const { service } = stepResult;
    if (stepResult.error) {
      return {
        html: `<div class="result-card"><h4>${escapeHtml(service)}</h4><span class="bubble error">${escapeHtml(stepResult.error)}</span></div>`,
        speakText: null
      };
    }

    switch (service) {
      case 'vision': {
        const r = stepResult.result;
        const caption = r.description?.captions?.[0]?.text || 'Sem descrição';
        const tags = (r.description?.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
        const brandNames = (r.brands || []).map((b) => b.name);
        const brands = brandNames.map((n) => `<span class="tag">🏷️ ${escapeHtml(n)}</span>`).join('');
        const faces = (r.faces || []).length;
        const html = `<div class="result-card">
          <h4>Análise de Imagem</h4>
          <p><strong>Descrição:</strong> ${escapeHtml(caption)}</p>
          ${tags ? `<p>${tags}</p>` : ''}
          ${brands ? `<p><strong>Marcas encontradas:</strong> ${brands}</p>` : ''}
          ${faces ? `<p><strong>Faces detectadas:</strong> ${faces}</p>` : ''}
        </div>`;
        let speakText = `Descrição da imagem: ${caption}.`;
        if (brandNames.length) speakText += ` Marcas encontradas: ${brandNames.join(', ')}.`;
        if (faces) speakText += ` Foram detectadas ${faces} face${faces > 1 ? 's' : ''}.`;
        return { html, speakText };
      }
      case 'speech-to-text': {
        const text = stepResult.extractedText || '(vazio)';
        return {
          html: `<div class="result-card">
            <h4>Transcrição de Áudio</h4>
            <p>${escapeHtml(text)}</p>
          </div>`,
          speakText: text
        };
      }
      case 'sentiment': {
        const doc = stepResult.result?.results?.documents?.[0];
        const sentiment = doc?.sentiment || 'desconhecido';
        const scores = doc?.confidenceScores;
        const html = `<div class="result-card">
          <h4>Análise de Sentimento</h4>
          <p><strong>Sentimento geral:</strong> ${escapeHtml(sentiment)}</p>
          ${scores ? `<p>Positivo: ${(scores.positive * 100).toFixed(0)}% · Neutro: ${(scores.neutral * 100).toFixed(0)}% · Negativo: ${(scores.negative * 100).toFixed(0)}%</p>` : ''}
        </div>`;
        const speakText = `O sentimento geral identificado foi ${sentiment}.`;
        return { html, speakText };
      }
      case 'ner': {
        const doc = stepResult.result?.results?.documents?.[0];
        const entityList = doc?.entities || [];
        const entities = entityList.map((e) => `<span class="tag">${escapeHtml(e.text)} (${escapeHtml(e.category)})</span>`).join('');
        const html = `<div class="result-card"><h4>Entidades Reconhecidas</h4><p>${entities || 'Nenhuma entidade encontrada.'}</p></div>`;
        const speakText = entityList.length
          ? `Entidades encontradas: ${entityList.map((e) => `${e.text}, ${e.category}`).join('; ')}.`
          : 'Nenhuma entidade foi encontrada no texto.';
        return { html, speakText };
      }
      case 'translate': {
        const translated = stepResult.result?.[0]?.translations?.[0]?.text;
        return {
          html: `<div class="result-card"><h4>Tradução</h4><p>${escapeHtml(translated || '(sem resultado)')}</p></div>`,
          speakText: translated || null
        };
      }
      case 'document-intelligence': {
        const content = stepResult.result?.analyzeResult?.content || '';
        const preview = content.length > 600 ? content.slice(0, 600) + '…' : content;
        return {
          html: `<div class="result-card"><h4>Documento Analisado</h4><p>${escapeHtml(preview)}</p></div>`,
          speakText: content ? content.slice(0, 500) : null
        };
      }
      case 'document-translate': {
        // Azure AI Translator (Document Translation): retorna o arquivo já
        // traduzido, com o layout original preservado, pronto para download.
        const src = `data:${stepResult.contentType};base64,${stepResult.fileBase64}`;
        const html = `<div class="result-card">
          <h4>Documento Traduzido (Azure Document Translation)</h4>
          <a class="btn-download" href="${src}" download="${escapeHtml(stepResult.filename)}">⬇️ Baixar ${escapeHtml(stepResult.filename)}</a>
        </div>`;
        return { html, speakText: null };
      }
      case 'text-to-speech': {
        // Aqui o próprio serviço já gera o áudio (Azure Text-to-Speech), então
        // exibimos o player em vez do botão "Ouvir" (seria redundante).
        const src = `data:${stepResult.mimeType};base64,${stepResult.audioBase64}`;
        return {
          html: `<div class="result-card"><h4>Áudio Gerado (Azure Text-to-Speech)</h4><audio controls autoplay src="${src}"></audio></div>`,
          speakText: null
        };
      }
      default:
        return {
          html: `<div class="result-card"><h4>${escapeHtml(service)}</h4><pre>${escapeHtml(JSON.stringify(stepResult.result, null, 2))}</pre></div>`,
          speakText: null
        };
    }
  }

  // ---------- Habilita "Ouvir" na mensagem de boas-vindas (já presente no HTML) ----------

  function enableSpeakOnWelcomeMessage() {
    const firstBubble = chatEl.querySelector('.message.assistant .bubble');
    if (!firstBubble) return;
    const plainText = firstBubble.textContent.replace(/\s+/g, ' ').trim();
    firstBubble.appendChild(createSpeakButton(plainText));
  }

  enableSpeakOnWelcomeMessage();
})();