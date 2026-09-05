# Assistente de IA Azure — Chatbot Orquestrador (Node.js + Axios + OpenRouter)

Projeto full-stack que lê um pedido em linguagem natural, usa o **OpenRouter** como "cérebro" de
planejamento (decide quais serviços Azure usar e em que ordem) e executa o pipeline resultante
contra os **serviços de IA da Azure** identificados no arquivo `.har` exportado do Insomnia.

---

## 1. Serviços Azure identificados nas requisições do Insomnia (HAR)

| # | Endpoint observado no HAR | Serviço Azure | Uso no projeto |
|---|---|---|---|
| 1 | `POST /vision/v3.2/analyze` (`visualFeatures=Description,Objects,Brands,Faces`) | **Azure AI Vision** (Computer Vision v3.2) | Reconhecimento de marcas/logotipos, objetos, faces e descrição de imagens |
| 2 | `POST /speechtotext/transcriptions:transcribe` (`api-version=2025-10-15`) | **Azure AI Speech** — Fast Transcription | Transcrição de áudio (reuniões, ligações) |
| 3 | `POST https://<region>.tts.speech.microsoft.com/cognitiveservices/v1` (SSML) | **Azure AI Speech** — Text-to-Speech | Converter texto em áudio falado |
| 4 | `POST /language/:analyze-text` (`kind: SentimentAnalysis`, com `opinionMining`) | **Azure AI Language** — Sentiment Analysis | Saber se um texto/fala é positivo, negativo ou neutro |
| 5 | `POST /language/:analyze-text` (`kind: EntityRecognition`) | **Azure AI Language** — NER | Extrair nomes, lugares, organizações, datas, valores |
| 6 | `POST https://api.cognitive.microsofttranslator.com/translate` | **Azure AI Translator** — Text Translation | Traduzir textos (strings) entre idiomas |
| 7 | `POST .../documentModels/prebuilt-layout:analyze` + `GET operation-location` | **Azure AI Document Intelligence** (Form Recognizer) | OCR/leitura de documentos, notas fiscais, contratos |
| 8 | `POST https://openrouter.ai/api/v1/chat/completions` | **OpenRouter** (externo, não é Azure) | LLM usado como "cérebro" do orquestrador — interpreta o pedido do usuário e monta o plano de execução |
| 9 | `POST {endpoint}/translator/document:translate` | **Azure AI Translator** — Document Translation | Traduzir um **arquivo inteiro** (.docx, .pdf, .pptx, .xlsx) preservando o layout — adicionado a partir dos recursos criados no portal |

> As rotas `http://localhost:3000/api/...` presentes no HAR eram esboços do backend Node —
> este projeto as implementa de fato (`/api/vision`, `/api/speech`, `/api/language`, `/api/translate`,
> `/api/document`, `/api/pipeline`, `/api/chat`).

---

## 2. Recursos criados no Grupo de Recursos da Azure

Os recursos abaixo já foram criados no portal (grupo de recursos, região `centralus`) e o projeto
já vem pré-configurado com esses endpoints em `backend/.env.example` — basta colar as respectivas
**keys** (aba "Keys and Endpoint" no portal):

| Recurso no portal | Serviço | Endpoint |
|---|---|---|
| `visao-computacional-05-09-2026` | Azure AI Vision (kind `ComputerVision`) | `https://visao-computacional-05-09-2026.cognitiveservices.azure.com` |
| Speech (regional) | Azure AI Speech (kind `SpeechServices`) | `https://centralus.api.cognitive.microsoft.com` (Fast Transcription) e `https://centralus.tts.speech.microsoft.com` (Text-to-Speech) |
| `servico-idioma-05-09-2026` | Azure AI Language (kind `TextAnalytics`) | `https://servico-idioma-05-09-2026.cognitiveservices.azure.com` |
| Translator (global) | Azure AI Translator — Text Translation | `https://api.cognitive.microsofttranslator.com` (usa a região `centralus` no header `Ocp-Apim-Subscription-Region`) |
| `tradutor-05-09-2026` | Azure AI Translator — **Document Translation** | `https://tradutor-05-09-2026.cognitiveservices.azure.com` |
| `inteligencia-documentos-05-09-2026` | Azure AI Document Intelligence (kind `FormRecognizer`) | `https://inteligencia-documentos-05-09-2026.cognitiveservices.azure.com` |

> ℹ️ Text Translation e Document Translation são **duas capacidades do mesmo produto (Azure AI
> Translator)**, mas aqui foram provisionadas como dois recursos separados no portal — o projeto
> trata cada um com sua própria variável de endpoint/chave (`AZURE_TRANSLATOR_*` e
> `AZURE_DOC_TRANSLATOR_*`), pois normalmente têm chaves distintas.

O **OpenRouter não é um recurso Azure** — é um serviço externo (openrouter.ai). Basta gerar uma
API key na conta OpenRouter e configurá-la no `.env` do backend.

Depois de copiar as **keys** de cada recurso no portal, preencha `backend/.env` (copiado de
`backend/.env.example`, que já traz os endpoints acima pré-preenchidos).

---

## 3. Arquitetura do projeto

```
azure-chatbot/
├── backend/                     # Node.js + Express + Axios
│   ├── server.js                # entrypoint
│   ├── routes/                  # 1 rota por serviço Azure + orquestrador
│   │   ├── chat.js              # /api/chat/plan (OpenRouter) e /summarize
│   │   ├── vision.js            # /api/vision/analyze
│   │   ├── speech.js            # /api/speech/transcribe e /synthesize
│   │   ├── language.js          # /api/language/sentiment e /entities
│   │   ├── translate.js         # /api/translate
│   │   ├── document.js          # /api/document/analyze e /api/document/translate
│   │   └── pipeline.js          # /api/pipeline/execute (encadeia serviços)
│   └── services/                # 1 cliente axios por serviço Azure
│       ├── openRouter.js
│       ├── azureVision.js
│       ├── azureSpeech.js
│       ├── azureLanguage.js
│       ├── azureTranslator.js
│       ├── azureDocumentIntelligence.js
│       └── azureDocumentTranslator.js
└── frontend/                     # HTML + CSS + JS puro (sem framework)
    ├── index.html                # chat + templates dos campos dinâmicos
    ├── style.css
    └── app.js                    # lógica do chat, drag&drop, chamadas fetch
```

### Como o pipeline funciona

1. Usuário digita o pedido (ex.: *"quero saber se as pessoas gostaram da reunião gravada"*).
2. O front-end envia isso para `POST /api/chat/plan`.
3. O backend repassa ao **OpenRouter**, com um *system prompt* que obriga o modelo a responder em
   JSON estrito com a lista de `steps` (serviços, na ordem certa) e qual `nextInput` pedir ao usuário
   agora (`audio`, `image`, `text` ou `document`).
   - Exemplo para o pedido acima: `steps = [speech-to-text, sentiment]`, `nextInput = "audio"`.
4. O front-end renderiza dinamicamente o campo certo:
   - **Áudio** → dropzone de arrastar/soltar ou selecionar `.mp3`/`.wav`/etc.
   - **Imagem** → dropzone com preview, para reconhecimento de marcas/objetos/faces.
   - **Documento** → dropzone para `.pdf`/`.docx`/`.pptx`/`.xlsx`/imagem, usada tanto para
     Document Intelligence (ler/OCR o conteúdo) quanto para Document Translation (traduzir o
     arquivo inteiro preservando o layout) — o OpenRouter decide qual dos dois pelo pedido do
     usuário (ex.: "leia esta nota fiscal" vs. "traduza este contrato para o inglês").
   - **Texto** → `textarea` simples para sentimento, NER, tradução ou texto-para-voz.
5. Ao confirmar, o front-end envia o arquivo/texto + os `steps` para `POST /api/pipeline/execute`.
6. O backend executa os passos **na ordem definida**, encadeando a saída de um serviço como entrada
   do próximo (ex.: texto transcrito pelo Speech-to-Text alimenta automaticamente o Sentiment
   Analysis).
7. Os resultados de cada etapa são exibidos como cartões na conversa, e opcionalmente o OpenRouter
   é chamado novamente (`/api/chat/summarize`) para resumir tudo em linguagem natural.
8. **Toda resposta do chatbot** (mensagem de boas-vindas, plano, esclarecimento, resumo final e cada
   cartão de resultado com texto) ganha um botão **"🔊 Ouvir"**, que chama sob demanda o
   `POST /api/speech/synthesize` (Azure AI Speech — Text-to-Speech) e reproduz o áudio no navegador.
   O áudio é gerado uma única vez por mensagem e fica em cache no próprio botão (troca para
   "🔁 Ouvir novamente"), evitando chamadas repetidas à Azure.

---

## 4. Como rodar

```bash
cd backend
npm install
cp .env.example .env   # preencha com suas chaves da Azure e do OpenRouter
npm start               # inicia em http://localhost:3000
```

Abra `http://localhost:3000` no navegador — o próprio backend Express serve o front-end estático.

---

## 5. Princípios de Design Thinking aplicados

- **Empatizar / Definir**: o ponto de partida do produto é a dor real do usuário — não saber quais
  APIs de IA existem nem como combiná-las. O chatbot elimina essa barreira técnica: o usuário fala o
  que precisa em linguagem natural, sem conhecer nomes de serviços.
- **Idear**: em vez de um formulário fixo por serviço, optou-se por uma interface conversacional que
  se adapta (campos dinâmicos) — reduzindo a carga cognitiva e o número de decisões que o usuário
  precisa tomar antecipadamente.
- **Prototipar**: a interface usa componentes reaproveitáveis (`<template>` HTML) para cada tipo de
  entrada (áudio, imagem, documento, texto), facilitando testes A/B e evolução incremental.
- **Testar**: o feedback textual imediato (`reply` do OpenRouter) permite validar rapidamente se o
  sistema entendeu a intenção antes de o usuário investir tempo enviando um arquivo grande.

## 6. Heurísticas de IHC (Nielsen) aplicadas na interface

- **Visibilidade do status do sistema**: indicador de "digitando" (typing indicator) e mensagens de
  loading em cada etapa do pipeline.
- **Correspondência com o mundo real**: linguagem simples em pt-BR, sem jargões técnicos (ex.: "Envie
  o áudio" em vez de "faça upload para o endpoint de Speech-to-Text").
- **Controle e liberdade do usuário**: o botão de confirmação só habilita após um arquivo/texto
  válido ser selecionado, evitando envios acidentais.
- **Prevenção de erros**: tipos de arquivo aceitos são explicitados (`.mp3`, `.wav`, `.png`, `.pdf`)
  e o `input[accept]` restringe a seleção.
- **Reconhecimento em vez de memorização**: drag-and-drop com área visualmente destacada e texto de
  apoio ("Arraste o arquivo aqui ou clique para selecionar").
- **Feedback claro de erro**: mensagens de erro do backend (`error`/`details`) são exibidas como
  bolhas de chat destacadas em vermelho, mantendo o usuário informado sobre o que falhou.
- **Acessibilidade**: uso de `aria-live`, `role="button"`, `tabindex` nas dropzones e rótulos (`<label
  class="sr-only">`) para leitores de tela.

---

## 7. Segurança

- Todas as chaves (Azure e OpenRouter) ficam **apenas no backend** (`.env`), nunca expostas ao
  front-end — o navegador só conversa com o próprio servidor Node, que atua como *proxy* seguro.
- Uploads são processados em memória (`multer.memoryStorage()`) e nunca persistidos em disco.
