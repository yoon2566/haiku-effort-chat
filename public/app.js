'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const ui = {
    composer: $('composer'), prompt: $('prompt'), messages: $('messages'), send: $('send'),
    attach: $('attach'), imageInput: $('imageInput'), attachments: $('attachments'),
    status: $('status'), previewDialog: $('previewDialog'), previewFrame: $('previewFrame'),
    thinkingToggle: $('thinkingToggle'), thinkingLabel: $('thinkingLabel'),
    effortSelect: $('effortSelect'), imageModeToggle: $('imageModeToggle'), imageModeLabel: $('imageModeLabel')
  };
  const conversation = [];
  const attached = [];
  const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const MAX_HTML_BYTES = 2 * 1024 * 1024;
  const MAX_HTML_CHARS = 300000;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
  let controller = null;
  let addingImages = false;
  const recoveryButtons = new Set();
  const answerViews = new WeakMap();
  let previewToken = null;
  const THINKING_PREFERENCE = 'haiku-thinking-enabled';
  const EFFORT_PREFERENCE = 'haiku-effort';
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
  let effort = 'medium';
  let imageMode = false;
  let thinkingEnabled = false;
  try { thinkingEnabled = localStorage.getItem(THINKING_PREFERENCE) === 'true'; }
  catch { /* The toggle also works when browser storage is unavailable. */ }

  try { const saved = localStorage.getItem(EFFORT_PREFERENCE); if (EFFORTS.includes(saved)) effort = saved; } catch {}
  if (['xhigh', 'max'].includes(effort)) thinkingEnabled = true;
  function updateThinking() {
    const required = ['xhigh', 'max'].includes(effort);
    if (required) thinkingEnabled = true;
    ui.effortSelect.value = effort;
    $('effortDisplay').textContent = effort[0].toUpperCase() + effort.slice(1);
    ui.imageModeToggle.setAttribute('aria-checked', String(imageMode));
    ui.imageModeLabel.textContent = imageMode ? '이미지 켜짐' : '이미지 꺼짐';
    ui.imageModeToggle.title = imageMode ? '이미지 생성 끄기 · 하이쿠와 대화해요' : '이미지 생성 켜기 · 입력한 문장으로 리크래프트 이미지를 만들어요';
    ui.thinkingToggle.setAttribute('aria-checked', String(thinkingEnabled));
    ui.thinkingLabel.textContent = thinkingEnabled ? '추론 켜짐' : '추론 꺼짐';
    ui.thinkingToggle.title = required ? 'Xhigh와 Max에서는 추론이 필수입니다.' : thinkingEnabled
      ? '추론 끄기 · 추가 추론 없이 답변을 시작해요.'
      : '추론 켜기 · 복잡한 문제를 더 검토하며, 응답 시작까지 시간이 더 걸릴 수 있어요.';
  }

  // Runs inside the opaque-origin sandbox; never exposes the parent's storage.
  function previewBootstrap(token) {
    function report(message) {
      parent.postMessage({ type: 'haiku-preview-error', token, message: String(message).slice(0, 500) }, '*');
    }
    function memoryStorage() {
      const values = new Map();
      const methods = {
        getItem(key) { return values.get(String(key)) ?? null; },
        setItem(key, value) { values.set(String(key), String(value)); },
        removeItem(key) { values.delete(String(key)); },
        clear() { values.clear(); },
        key(index) { return [...values.keys()][Number(index)] ?? null; }
      };
      return new Proxy(methods, {
        get(target, key) {
          if (key === 'length') return values.size;
          if (key in target) return target[key];
          return values.get(String(key));
        },
        set(_target, key, value) { values.set(String(key), String(value)); return true; },
        deleteProperty(_target, key) { values.delete(String(key)); return true; },
        ownKeys() { return [...values.keys()]; },
        getOwnPropertyDescriptor(_target, key) {
          return values.has(String(key)) ? { enumerable: true, configurable: true, value: values.get(String(key)) } : undefined;
        }
      });
    }
    for (const name of ['localStorage', 'sessionStorage']) {
      try { window[name].getItem('__haiku_preview_probe__'); }
      catch {
        try { Object.defineProperty(window, name, { configurable: true, value: memoryStorage() }); }
        catch { report('게임의 임시 저장소를 준비하지 못했습니다. 저장소 없이 실행하도록 게임 코드를 수정해 주세요.'); }
      }
    }
    addEventListener('error', event => {
      const asset = event.target?.src || event.target?.href;
      report(event.message || (asset ? '외부 파일을 불러오지 못했습니다: ' + asset : '게임 실행 중 오류가 발생했습니다.'));
    }, true);
    addEventListener('unhandledrejection', event => report(event.reason?.message || event.reason || '게임 실행 중 비동기 오류가 발생했습니다.'));
    addEventListener('keydown', event => {
      if (event.key === 'Escape') parent.postMessage({ type: 'haiku-preview-close', token }, '*');
    });
  }

  function previewDocument(html, token) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const bootstrap = doc.createElement('script');
    bootstrap.textContent = '(' + previewBootstrap.toString() + ')(' + JSON.stringify(token) + ');';
    doc.head.prepend(bootstrap);
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
  }

  function updateSend() {
    ui.send.disabled = !controller && (addingImages || (!ui.prompt.value.trim() && !attached.length));
    ui.attach.disabled = Boolean(controller) || addingImages || imageMode;
    ui.thinkingToggle.disabled = Boolean(controller) || imageMode || ['xhigh', 'max'].includes(effort);
    ui.effortSelect.disabled = Boolean(controller) || imageMode;
    ui.imageModeToggle.disabled = Boolean(controller);
    ui.send.setAttribute('aria-label', controller ? '응답 중지' : '보내기');
    ui.send.title = controller ? '응답 중지' : '보내기';
    $('sendIcon').toggleAttribute('hidden', Boolean(controller));
    $('stopIcon').toggleAttribute('hidden', !controller);
    recoveryButtons.forEach(button => { button.disabled = Boolean(controller); });
  }

  function resizePrompt() {
    ui.prompt.style.height = 'auto';
    ui.prompt.style.height = Math.min(180, Math.max(48, ui.prompt.scrollHeight)) + 'px';
  }

  function nearBottom() {
    return document.documentElement.scrollHeight - (scrollY + innerHeight) < 230;
  }

  function scrollBottom() {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
  }

  function status(text) { ui.status.textContent = text; }

  function renderAttachments() {
    ui.attachments.replaceChildren();
    ui.attachments.hidden = !attached.length;
    attached.forEach((item, index) => {
      const box = document.createElement('div');
      box.className = 'attachment';
      let preview;
      if (item.kind === 'html') {
        box.classList.add('html-attachment');
        preview = document.createElement('span');
        preview.className = 'file-name';
        preview.textContent = item.name;
        const icon = document.createElement('span');
        icon.className = 'file-icon'; icon.textContent = '</>';
        box.append(icon);
      } else {
        preview = document.createElement('img');
        preview.src = item.data; preview.alt = item.name;
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove-image';
      remove.textContent = '×';
      remove.setAttribute('aria-label', item.name + ' 첨부 취소');
      remove.addEventListener('click', () => {
        attached.splice(index, 1);
        renderAttachments();
        status('');
      });
      box.append(preview, remove);
      ui.attachments.append(box);
    });
    updateSend();
  }

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('이미지를 읽지 못했습니다. 다시 첨부해 주세요.'));
      reader.readAsDataURL(file);
    });
  }

  function conversationImageBytes() {
    let total = 0;
    for (const message of conversation) {
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        const data = part.type === 'image_url' ? part.image_url?.url || '' : '';
        if (!data.startsWith('data:image/')) continue;
        const base64 = data.slice(data.indexOf(',') + 1);
        total += base64.length * 3 / 4 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
      }
    }
    return total;
  }

  async function addImages(files) {
    if (controller || addingImages) return;
    addingImages = true;
    updateSend();
    const issues = [];
    try {
      for (const file of files) {
        const isHtml = /\.html?$/i.test(file.name || '');
        if (isHtml) {
          if (attached.filter(item => item.kind === 'html').length >= 4) { issues.push('HTML 파일은 한 번에 4개까지 첨부할 수 있습니다.'); continue; }
          if (!file.size || file.size > MAX_HTML_BYTES) { issues.push('HTML 파일은 비어 있지 않은 2MB 이하 파일을 선택해 주세요.'); continue; }
          const text = await file.text();
          if (text.length > MAX_HTML_CHARS || attached.filter(item => item.kind === 'html').reduce((sum, item) => sum + item.text.length, 0) + text.length > MAX_HTML_CHARS) { issues.push('첨부 HTML 코드는 합계 300,000자까지 가능합니다.'); continue; }
          attached.push({ kind: 'html', name: file.name, size: file.size, text });
          continue;
        }
        if (!imageTypes.has(file.type)) { issues.push('PNG, JPG, WebP, GIF 이미지 또는 HTML 파일을 첨부해 주세요.'); continue; }
        if (attached.filter(item => item.kind !== 'html').length >= 4) { issues.push('이미지는 한 번에 4장까지 첨부할 수 있습니다.'); break; }
        if (!file.size || file.size > MAX_IMAGE_BYTES) { issues.push('이미지 한 장은 10MB 이하여야 합니다.'); continue; }
        if (conversationImageBytes() + attached.filter(item => item.kind !== 'html').reduce((sum, item) => sum + item.size, 0) + file.size > MAX_TOTAL_BYTES) {
          issues.push('이 대화에 첨부할 수 있는 이미지의 합계는 20MB입니다.'); continue;
        }
        attached.push({ name: file.name || '붙여넣은 이미지', size: file.size, data: await readImage(file) });
      }
    } catch (error) { issues.push(error.message); }
    finally {
      addingImages = false;
      renderAttachments();
      status([...new Set(issues)].join(' '));
      ui.imageInput.value = '';
    }
  }

  function appendUser(text, images, files) {
    const article = document.createElement('article');
    article.className = 'message user';
    article.setAttribute('aria-label', '내 메시지');
    if (images.length) {
      const list = document.createElement('div');
      list.className = 'user-images';
      for (const image of images) {
        const img = document.createElement('img');
        img.src = image.data;
        img.alt = image.name;
        list.append(img);
      }
      article.append(list);
    }
    if (files.length) {
      const list = document.createElement('div'); list.className = 'user-files';
      for (const file of files) {
        const chip = document.createElement('span'); chip.className = 'user-file';
        chip.textContent = 'HTML · ' + file.name; list.append(chip);
      }
      article.append(list);
    }
    if (text) {
      const bubble = document.createElement('div');
      bubble.className = 'user-bubble';
      bubble.textContent = text;
      article.append(bubble);
    }
    ui.messages.append(article);
  }

  function appendAssistant() {
    const article = document.createElement('article');
    article.className = 'message assistant';
    article.setAttribute('aria-label', '하이쿠 응답');
    const content = document.createElement('div');
    content.className = 'assistant-content';
    const thinking = document.createElement('div');
    thinking.className = 'thinking';
    for (let i = 0; i < 3; i++) thinking.append(document.createElement('span'));
    const label = document.createElement('b');
    label.className = 'thinking-label';
    label.textContent = '응답을 준비하고 있어요';
    thinking.append(label);
    content.append(thinking);
    article.append(content);
    ui.messages.append(article);
    return { article, content };
  }

  function addReasoningPanel(article) {
    const panel = document.createElement('details'); panel.className = 'reasoning-panel'; panel.open = true;
    const summary = document.createElement('summary'); summary.textContent = '추론 중 · 0초';
    const hint = document.createElement('p'); hint.className = 'reasoning-hint'; hint.textContent = '모델이 제공하는 공개 추론 요약입니다.';
    const text = document.createElement('div'); text.className = 'reasoning-text'; text.textContent = '공개 추론 요약을 기다리고 있어요.';
    panel.append(summary, hint, text); article.prepend(panel);
    return {panel, summary, text};
  }

  function visibleReasoning(delta) {
    const details = Array.isArray(delta?.reasoning_details) ? delta.reasoning_details : [];
    const summaries = details.filter(part => part?.type === 'reasoning.summary' && typeof part.summary === 'string').map(part => part.summary).join('');
    if (summaries) return summaries;
    const text = details.filter(part => part?.type === 'reasoning.text' && typeof part.text === 'string').map(part => part.text).join('');
    if (text) return text;
    return typeof delta?.reasoning === 'string' ? delta.reasoning : typeof delta?.reasoning_content === 'string' ? delta.reasoning_content : '';
  }

  function parseParts(text) {
    const parts = [];
    const fences = /```([^\n`]*)\n([\s\S]*?)(?:```|$)/g;
    let match, offset = 0;
    while ((match = fences.exec(text))) {
      if (match.index > offset) parts.push({ type: 'text', text: text.slice(offset, match.index) });
      parts.push({ type: 'code', language: match[1].trim(), text: match[2], complete: match[0].endsWith('```') });
      offset = fences.lastIndex;
    }
    if (offset < text.length) parts.push({ type: 'text', text: text.slice(offset) });
    return parts;
  }

  function gameHtml(text) {
    const parts = parseParts(text);
    const candidates = parts.filter(part => part.type === 'code' && part.complete && /^(?:html|htm)?$/i.test(part.language));
    for (let i = candidates.length - 1; i >= 0; i--) {
      const code = candidates[i].text.trim();
      if (/<html(?:\s|>)/i.test(code) && /<\/html\s*>/i.test(code)) return code;
    }
    const plain = text.trim();
    if (/^(?:<!doctype\s+html\s*>\s*)?<html(?:\s|>)/i.test(plain) && /<\/html\s*>\s*$/i.test(plain)) return plain;
    return null;
  }

  function openPreview(html) {
    if (!ui.previewDialog.open) ui.previewDialog.showModal();
    previewToken = crypto.randomUUID();
    $('previewError').hidden = true;
    $('previewError').textContent = '';
    // Each run gets a fresh frame so old game timers and navigation cannot affect it.
    const frame = ui.previewFrame.cloneNode(false);
    frame.removeAttribute('srcdoc');
    ui.previewFrame.replaceWith(frame);
    ui.previewFrame = frame;
    const token = previewToken;
    frame.addEventListener('load', () => {
      if (!frame.hasAttribute('srcdoc') || !ui.previewDialog.open ||
          previewToken !== token || ui.previewFrame !== frame) return;
      // Games often prevent pointer defaults; focus must not remain on Close,
      // where Space would close the preview instead of making the player jump.
      frame.focus({ preventScroll: true });
    });
    // Let the dialog and fresh browsing context acquire their real viewport first.
    // Canvas games often size themselves once from innerWidth during initial execution.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!ui.previewDialog.open || previewToken !== token || ui.previewFrame !== frame) return;
      frame.srcdoc = previewDocument(html, token);
    }));
    $('previewClose').focus();
  }

  window.addEventListener('message', event => {
    if (!ui.previewDialog.open || event.source !== ui.previewFrame.contentWindow ||
        event.data?.token !== previewToken) return;
    if (event.data?.type === 'haiku-preview-close') {
      ui.previewDialog.close();
      return;
    }
    if (event.data?.type !== 'haiku-preview-error') return;
    $('previewError').textContent = '게임 코드 오류: ' + String(event.data.message).slice(0, 500) +
      '\n이 내용을 대화창에 보내 게임 수정을 요청해 주세요.';
    $('previewError').hidden = false;
  });

  function downloadHtml(html) {
    // The BOM preserves Korean text even if the game omitted a charset declaration.
    const url = URL.createObjectURL(new Blob(['\ufeff', html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'game.html';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyCode(button, text) {
    if (button.disabled) return;
    button.disabled = true;
    try {
      try { await navigator.clipboard.writeText(text); }
      catch {
        const focused = document.activeElement;
        const input = document.createElement('textarea');
        input.value = text;
        input.readOnly = true;
        input.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
        document.body.append(input);
        try {
          input.select();
          if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
        } finally {
          input.remove();
          focused?.focus({ preventScroll: true });
        }
      }
      button.textContent = '복사됨 ✓';
    } catch {
      button.textContent = '복사 실패';
      status('복사 권한을 확인하거나 코드를 펼쳐 직접 선택해 복사해 주세요.');
    } finally {
      setTimeout(() => {
        button.textContent = '코드 복사';
        button.disabled = false;
      }, 1800);
    }
  }

  function renderAnswer(target, text, complete) {
    const keepBottom = nearBottom();
    let view = answerViews.get(target);
    if (!view) {
      target.replaceChildren();
      view = { parts: [] };
      answerViews.set(target, view);
    }
    const parts = parseParts(text).filter(part => part.type === 'code' || part.text.trim());
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      let entry = view.parts[i];
      if (!entry || entry.type !== part.type) {
        const node = document.createElement(part.type === 'code' ? 'details' : 'div');
        node.className = part.type === 'code' ? 'code-block' : 'prose';
        const content = document.createTextNode('');
        let summary, labelNode;
        if (part.type === 'code') {
          summary = document.createElement('summary');
          labelNode = document.createElement('span');
          labelNode.className = 'code-label';
          const copy = document.createElement('button');
          copy.type = 'button';
          copy.className = 'copy-code-button';
          copy.textContent = '코드 복사';
          copy.setAttribute('aria-live', 'polite');
          copy.title = '설명 없이 이 코드만 복사';
          copy.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            copyCode(copy, entry.text);
          });
          summary.append(labelNode, copy);
          const pre = document.createElement('pre');
          const code = document.createElement('code');
          code.append(content);
          pre.append(code);
          node.append(summary, pre);
        } else node.append(content);
        if (entry) entry.node.replaceWith(node);
        else target.append(node);
        entry = { type: part.type, node, content, host: content.parentNode, summary, labelNode, text: '' };
        view.parts[i] = entry;
      }
      const value = part.type === 'code' ? part.text : part.text.trim();
      // Append streamed text without rebuilding large code blocks or losing scroll/focus.
      if (value !== entry.text) {
        if (value.startsWith(entry.text)) {
          const suffix = value.slice(entry.text.length);
          // Bound individual text-node edits so long games don't reshape one huge node.
          if (entry.content.length + suffix.length <= 8192) entry.content.appendData(suffix);
          else {
            entry.content = document.createTextNode(suffix);
            entry.host.append(entry.content);
          }
        } else {
          entry.content = document.createTextNode(value);
          entry.host.replaceChildren(entry.content);
        }
        entry.text = value;
      }
      if (entry.summary) {
        const label = (part.language ? part.language.toUpperCase() + ' 코드' : '코드') + (!complete && !part.complete ? ' 작성 중…' : '');
        if (entry.labelNode.textContent !== label) entry.labelNode.textContent = label;
      }
    }
    while (view.parts.length > parts.length) view.parts.pop().node.remove();
    if (complete) {
      const html = gameHtml(text);
      if (html) {
        const actions = document.createElement('div');
        actions.className = 'game-actions';
        const preview = document.createElement('button');
        preview.className = 'preview-button';
        preview.type = 'button';
        preview.textContent = '▶ 게임 미리보기';
        preview.addEventListener('click', () => openPreview(html));
        const download = document.createElement('button');
        download.className = 'download-button';
        download.type = 'button';
        download.textContent = '↓ HTML 다운로드';
        download.addEventListener('click', () => downloadHtml(html));
        actions.append(preview, download);
        target.append(actions);
      }
    }
    if (keepBottom) scrollBottom();
  }

  function appendNote(article, message) {
    const note = document.createElement('p');
    note.className = 'answer-note';
    note.textContent = message;
    article.append(note);
  }

  function emptyReplyMessage(finishReason, nativeFinishReason, receivedEnd, hadReasoning) {
    if (finishReason === 'length' || nativeFinishReason === 'max_tokens') return '추론과 답변의 출력 한도에 도달해 최종 답변을 받지 못했습니다.';
    if (finishReason === 'content_filter' || nativeFinishReason === 'refusal') return '모델이 이 요청에 대한 답변을 제한했습니다. 요청 내용을 바꿔 주세요.';
    if (finishReason === 'error') return '모델이 답변 생성 중 오류로 종료됐습니다.';
    if (!receivedEnd && !finishReason) return '최종 답변을 받기 전에 연결이 끊겼습니다.';
    return hadReasoning ? '추론은 진행됐지만 모델이 최종 답변을 보내지 않았습니다.' : '모델이 최종 답변 없이 응답을 종료했습니다.';
  }

  function appendFailureDetails(article, details) {
    const lines = ['에포트: ' + details.effort, '추론: ' + (details.thinkingEnabled ? '켜짐' : '꺼짐')];
    if (details.finishReason) lines.push('종료 사유: ' + details.finishReason);
    if (details.nativeFinishReason) lines.push('모델 종료 사유: ' + details.nativeFinishReason);
    const completion = details.usage?.completion_tokens;
    const reasoning = details.usage?.completion_tokens_details?.reasoning_tokens;
    if (Number.isSafeInteger(completion) && completion >= 0) lines.push('출력 토큰(추론 포함): ' + completion.toLocaleString('ko-KR'));
    if (Number.isSafeInteger(reasoning) && reasoning >= 0) lines.push('추론 토큰: ' + reasoning.toLocaleString('ko-KR'));
    if (details.generationId) lines.push('요청 ID: ' + String(details.generationId).slice(0, 160));
    if (details.messageId) lines.push('모델 메시지 ID: ' + String(details.messageId).slice(0, 160));
    const panel = document.createElement('details'); panel.className = 'response-details';
    const summary = document.createElement('summary'); summary.textContent = '오류 확인 정보';
    const text = document.createElement('p'); text.textContent = lines.join('\n');
    panel.append(summary, text); article.append(panel);
  }

  function offerRetry(article, request) {
    const actions = document.createElement('div'); actions.className = 'game-actions recovery-actions';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'preview-button';
    button.textContent = 'Medium · 추론 끄기로 다시 시도';
    button.addEventListener('click', event => { if (!controller) void send(event, request); });
    recoveryButtons.add(button); actions.append(button); article.append(actions);
  }

  async function responseError(response) {
    let message = '';
    try {
      const body = await response.json();
      message = typeof body.error === 'string' ? body.error : body.error?.message || body.message || '';
    } catch { /* The fallback remains safe if a proxy returns a non-JSON error. */ }
    return message || (response.status === 429 ? '요청이 많습니다. 잠시 후 다시 보내 주세요.' : '응답을 받지 못했습니다. 잠시 후 다시 보내 주세요.');
  }

  function renderGeneratedImage(target, result) {
    target.replaceChildren();
    const followResult = nearBottom();
    const figure = document.createElement('figure'); figure.className = 'generated-image';
    const image = document.createElement('img');
    image.addEventListener('load', () => { if (followResult) scrollBottom(); }, {once:true});
    image.src = result.image;
    image.alt = '요청한 설명으로 생성한 이미지'; image.decoding = 'async';
    const caption = document.createElement('figcaption'); caption.textContent = 'Recraft V4.1 Flash';
    const actions = document.createElement('div'); actions.className = 'game-actions';
    const filename = 'generated-image.' + ({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[result.mediaType] || 'png');
    const imageFile = () => {
      const binary = atob(result.image.split(',')[1]);
      return new File([Uint8Array.from(binary, ch => ch.charCodeAt(0))], filename, {type: result.mediaType});
    };
    const download = document.createElement('button'); download.type = 'button'; download.className = 'download-button';
    download.addEventListener('click', () => {
      const url = URL.createObjectURL(imageFile());
      const link = document.createElement('a'); link.href = url; link.download = filename;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    download.textContent = '↓ 이미지 다운로드';
    const attach = document.createElement('button'); attach.type = 'button'; attach.className = 'preview-button';
    attach.textContent = '다음 대화에 첨부';
    attach.addEventListener('click', async () => {
      if (controller || addingImages) return;
      imageMode = false; updateThinking(); updateSend();
      await addImages([imageFile()]);
      if (!ui.status.textContent) status('이미지를 첨부했습니다. 이 이미지로 만들 게임이나 수정할 내용을 입력해 주세요.');
      ui.prompt.focus();
    });
    actions.append(download, attach); figure.append(image, caption); target.append(figure, actions);
  }

  async function send(event, retry = null) {
    event.preventDefault();
    if (controller) { controller.abort(); return; }
    const prompt = retry ? retry.prompt : ui.prompt.value.trim();
    const sourceAttachments = retry ? retry.pending : attached;
    const requestImageMode = retry ? false : imageMode;
    const requestEffort = retry ? 'medium' : effort;
    const requestThinkingEnabled = retry ? false : thinkingEnabled;
    if ((!prompt && !sourceAttachments.length) || addingImages) return;
    if (requestImageMode && sourceAttachments.length) { status('이미지 모드에서는 첨부 파일을 제거하고 만들 이미지의 설명을 입력해 주세요.'); return; }
    if (requestImageMode && prompt.length > 12000) { status('이미지 설명은 12,000자 이내로 입력해 주세요.'); return; }
    const files = sourceAttachments.filter(item => item.kind === 'html');
    const images = sourceAttachments.filter(item => item.kind !== 'html');
    const text = [prompt || (files.length ? '첨부한 HTML 파일의 코드를 살펴보고 설명해 주세요.' : '첨부한 이미지를 살펴보고 설명해 주세요.'),
      ...files.map(file => '\n[첨부 HTML 파일: ' + file.name + ']\n' + file.text + '\n[첨부 HTML 파일 끝]'),
      ...(files.length ? ['HTML 파일 수정 요청이라면 수정한 파일의 전체 내용을 생략 없이 html 코드 블록으로 반환해 주세요. 다운로드하고 바로 실행할 수 있도록 <!doctype html>, <html>, </html>을 포함한 완전한 문서로 작성하고, 변경하지 않은 코드도 유지해 주세요. 설명만 요청했다면 설명에 답해 주세요.'] : [])].join('\n');
    const historyChars = conversation.reduce((sum, message) => sum + (typeof message.content === 'string' ? message.content.length : message.content.reduce((n, part) => n + (part.type === 'text' ? part.text.length : 0), 0)), 0);
    if (historyChars + text.length > 400000) { status('대화와 첨부 코드의 합계가 400,000자를 넘었습니다. 파일을 줄이거나 새로고침해 새 대화를 시작해 주세요.'); return; }
    // Recovery uses the failed request, without overwriting a newly edited draft.
    const clearDraft = !retry || (ui.prompt.value.trim() === prompt && attached.length === sourceAttachments.length && attached.every((item, index) => item === sourceAttachments[index]));
    const pending = retry ? [...retry.pending] : attached.splice(0);
    if (retry) {
      effort = 'medium'; thinkingEnabled = false; imageMode = false;
      try { localStorage.setItem(EFFORT_PREFERENCE, effort); localStorage.setItem(THINKING_PREFERENCE, 'false'); } catch {}
      updateThinking();
    }
    recoveryButtons.forEach(button => button.closest('.recovery-actions').remove());
    recoveryButtons.clear();
    const userContent = images.length ? [
      { type: 'text', text },
      ...images.map(image => ({ type: 'image_url', image_url: { url: image.data } }))
    ] : text;
    const userMessage = { role: 'user', content: userContent };
    conversation.push(userMessage);
    if (!retry) appendUser(prompt, images, files);
    const target = appendAssistant();
    document.body.classList.add('has-messages');
    if (clearDraft) { ui.prompt.value = ''; attached.splice(0); }
    resizePrompt();
    renderAttachments();
    status('');
    controller = new AbortController();
    updateSend();
    scrollBottom();
    let answer = '', finishReason = '', nativeFinishReason = '', generationId = '', messageId = '', usage = null, renderTimer = null, generatedImage = null, responseReader = null;
    let receivedEnd = false, responseStarted = false, reasoningText = '', reasoningEndedAt = null, reasoningStopped = false, nativeStream = null, responseComplete = false, webFetchView = null, webFetchRequests = null;
    const reasoningStartedAt = performance.now();
    const reasoningView = requestThinkingEnabled && !requestImageMode ? addReasoningPanel(target.article) : null;
    const updateReasoning = (finished = false) => {
      if (!reasoningView) return;
      const seconds = Math.floor(((reasoningEndedAt ?? performance.now()) - reasoningStartedAt) / 1000);
      const label = reasoningStopped ? '추론 중지' : finished || reasoningEndedAt ? '추론 요약' : '추론 중';
      reasoningView.summary.textContent = label + ' · ' + seconds + '초';
      if (reasoningText) {
        const area = reasoningView.text;
        const following = area.scrollTop + area.clientHeight >= area.scrollHeight - 24;
        area.textContent = reasoningText;
        if (following) area.scrollTop = area.scrollHeight;
      } else if (finished || reasoningEndedAt) reasoningView.text.textContent = '이 응답에서는 모델이 공개 추론 요약을 제공하지 않았습니다.';
    };
    const reasoningTimer = reasoningView ? setInterval(() => updateReasoning(), 1000) : null;
    const scheduleRender = () => {
      if (renderTimer) return;
      renderTimer = setTimeout(() => {
        renderTimer = null;
        updateReasoning();
        if (answer) renderAnswer(target.content, answer, false);
      }, 80);
    };
    const processEvent = raw => {
      let chunk;
      if (nativeStream) {
        const parsed = nativeStream.parse(raw);
        if (!parsed) return;
        if (parsed.ended) receivedEnd = true;
        chunk = parsed.chunk;
      } else {
        const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
        if (!data) return;
        if (data === '[DONE]') { receivedEnd = true; return; }
        try { chunk = JSON.parse(data); } catch { return; }
      }
      if (typeof chunk.id === 'string' && chunk.id) {
        if (nativeStream) messageId = chunk.id;
        else generationId = chunk.id;
      }
      if (chunk.usage) usage = chunk.usage;
      const fetches = chunk.usage?.server_tool_use_details?.tool_calls_executed ?? chunk.usage?.server_tool_use?.tool_calls_executed ?? chunk.usage?.server_tool_use?.web_fetch_requests;
      if (Number.isSafeInteger(fetches) && fetches >= 0) webFetchRequests = fetches;
      const choice = chunk.choices?.[0];
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (choice?.native_finish_reason) nativeFinishReason = choice.native_finish_reason;
      if (chunk.error) throw new Error(typeof chunk.error === 'string' ? chunk.error : chunk.error.message || '응답 생성 중 오류가 발생했습니다.');
      if (reasoningView) {
        const fragment = visibleReasoning(choice?.delta);
        if (fragment) { reasoningText += fragment; scheduleRender(); }
      }
      if (choice?.delta?.content) {
        if (reasoningEndedAt === null) reasoningEndedAt = performance.now();
        answer += typeof choice.delta.content === 'string' ? choice.delta.content : '';
        scheduleRender();
      }
    };
    try {
      const response = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation, thinkingEnabled: requestThinkingEnabled, effort: requestEffort, imageMode: requestImageMode, ...(window.HaikuNativeStream ? {streamProtocol: window.HaikuNativeStream.protocol} : {}) }), signal: controller.signal
      });
      generationId = response.headers.get('X-Generation-Id') || '';
      if (!response.ok) throw new Error(await responseError(response));
      if (response.headers.get('X-Haiku-Web-Fetch') === 'exa') {
        const panel = document.createElement('details'); panel.className = 'response-details';
        const summary = document.createElement('summary'); summary.textContent = 'GitHub 자료 읽기 · Exa';
        webFetchView = document.createElement('p'); webFetchView.textContent = '공개 저장소의 자료를 확인하고 있습니다. 확인한 파일과 읽기 실패 여부는 답변에 표시됩니다.';
        panel.append(summary, webFetchView); target.article.insertBefore(panel, target.content);
      }
      if (response.headers.get('content-type')?.includes('application/json')) {
        const result = await response.json();
        if (result.type !== 'image' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(result.image || '')) throw new Error('이미지 생성 결과를 확인하지 못했습니다.');
        generatedImage = result;
        answer = '요청한 이미지를 생성했습니다. (Recraft V4.1 Flash)';
        return;
      }
      if (!response.body) throw new Error('브라우저에서 응답을 읽지 못했습니다. 다시 시도해 주세요.');
      if (response.headers.get('X-Haiku-Transport') === 'messages') {
        if (!window.HaikuNativeStream) throw new Error('페이지를 새로고침한 뒤 다시 보내 주세요.');
        nativeStream = window.HaikuNativeStream.create();
      }
      responseStarted = true;
      const reader = responseReader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        if (buffer.length > 2 * 1024 * 1024) throw new Error('모델 응답 형식을 확인하지 못했습니다. 다시 보내 주세요.');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const eventText = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          processEvent(eventText);
        }
        if (done) { if (buffer.trim()) processEvent(buffer); break; }
      }
      if (nativeStream) nativeStream.finish();
      if (!answer.trim()) throw new Error(emptyReplyMessage(finishReason, nativeFinishReason, receivedEnd, Boolean(reasoningText)));
      responseComplete = !nativeStream || nativeStream.complete;
      if (!receivedEnd && !finishReason) appendNote(target.article, '연결이 끊어져 응답이 일부만 표시되었을 수 있습니다.');
      if (finishReason === 'length') appendNote(target.article, '응답 길이 한도에 도달했습니다. 이어서 작성해 달라고 요청해 주세요.');
      else if (nativeStream && !responseComplete) appendNote(target.article, '모델이 답변 작성을 완료하지 못했습니다.');
    } catch (error) {
      if (error.name === 'AbortError') { reasoningStopped = true; appendNote(target.article, '응답을 중지했습니다.'); }
      else appendNote(target.article, error.message || '연결에 문제가 생겼습니다. 다시 시도해 주세요.');
      if (!answer.trim()) {
        answer = '';
        conversation.pop();
        if (!ui.prompt.value && !attached.length) {
          ui.prompt.value = prompt;
          attached.push(...pending);
          resizePrompt();
          renderAttachments();
        }
        if (responseStarted && !requestImageMode && error.name !== 'AbortError') {
          appendFailureDetails(target.article, {effort: requestEffort, thinkingEnabled: requestThinkingEnabled, finishReason, nativeFinishReason, generationId, messageId, usage});
          if (finishReason !== 'content_filter' && nativeFinishReason !== 'refusal') offerRetry(target.article, {prompt, pending});
        }
      }
    } finally {
      if (renderTimer) clearTimeout(renderTimer);
      if (reasoningTimer) clearInterval(reasoningTimer);
      updateReasoning(true);
      if (webFetchView) webFetchView.textContent = (webFetchRequests === null ? 'URL 읽기 횟수는 제공되지 않았습니다.' : 'URL 읽기 요청: ' + webFetchRequests + '회.') + ' 확인한 파일과 읽기 실패 여부는 답변을 확인해 주세요. 페이지를 읽은 것만으로 코드를 실행·검증한 것은 아닙니다.';
      if (answer) {
        conversation.push({ role: 'assistant', content: answer });
        if (generatedImage) renderGeneratedImage(target.content, generatedImage);
        else renderAnswer(target.content, answer, nativeStream ? responseComplete : true);
      } else target.content.replaceChildren();
      if (responseReader) await responseReader.cancel().catch(() => {});
      controller = null;
      updateSend();
      if (nearBottom()) scrollBottom();
      ui.prompt.focus({ preventScroll: true });
    }
  }

  ui.composer.addEventListener('submit', send);
  ui.thinkingToggle.addEventListener('click', () => {
    if (controller || imageMode || ['xhigh', 'max'].includes(effort)) return;
    thinkingEnabled = !thinkingEnabled;
    try { localStorage.setItem(THINKING_PREFERENCE, String(thinkingEnabled)); }
    catch { /* Keep this page's preference even if it cannot be persisted. */ }
    updateThinking(); updateSend();
  });
  ui.effortSelect.addEventListener('change', () => {
    if (controller || imageMode) return;
    effort = ui.effortSelect.value;
    if (['xhigh', 'max'].includes(effort)) thinkingEnabled = true;
    try { localStorage.setItem(EFFORT_PREFERENCE, effort); localStorage.setItem(THINKING_PREFERENCE, String(thinkingEnabled)); } catch {}
    updateThinking(); updateSend();
  });
  ui.imageModeToggle.addEventListener('click', () => {
    if (controller) return;
    imageMode = !imageMode;
    updateThinking(); updateSend();
    status(imageMode ? '입력한 문장으로 이미지를 만들어요. 리크래프트 V4.1 Flash를 사용합니다.' : '');
  });
  ui.prompt.addEventListener('input', () => { resizePrompt(); updateSend(); });
  ui.prompt.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!controller && !ui.send.disabled) ui.composer.requestSubmit();
    }
  });
  ui.attach.addEventListener('click', () => ui.imageInput.click());
  ui.imageInput.addEventListener('change', () => addImages([...ui.imageInput.files]));
  document.addEventListener('paste', event => {
    if ($('canvasDialog').open || ui.previewDialog.open) return;
    const files = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); addImages(files); }
  });
  $('previewClose').addEventListener('click', () => ui.previewDialog.close());
  ui.previewDialog.addEventListener('close', () => {
    // A queued close event may arrive after the user already opened another preview.
    if (ui.previewDialog.open) return;
    previewToken = null;
    ui.previewFrame.srcdoc = '';
    $('previewError').hidden = true;
  });
  updateThinking();
  updateSend();
})();
