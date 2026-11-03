'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const dialog = $('canvasDialog');
  const editor = $('canvasText');
  let savedText = '';
  let version = 0;
  let loaded = false;
  let authenticated = false;
  let busy = false;
  let etag = null;
  let pollTimer = null;
  let pollController = null;
  let pollEpoch = 0;
  let pollFailed = false;
  let copying = false;
  const fontSizeKey = 'haiku.canvas.fontSize';
  const minFontSize = 12;
  const maxFontSize = 32;
  let fontSize = parseFloat(getComputedStyle(editor).fontSize) || 16;
  try {
    const stored = Number(localStorage.getItem(fontSizeKey));
    if (Number.isFinite(stored) && stored >= minFontSize && stored <= maxFontSize) fontSize = stored;
  } catch {}

  function resizeText(delta = 0) {
    fontSize = Math.min(maxFontSize, Math.max(minFontSize, fontSize + delta));
    editor.style.fontSize = fontSize + 'px';
    $('canvasFontSize').textContent = fontSize + 'px';
    $('canvasFontDecrease').disabled = fontSize <= minFontSize;
    $('canvasFontIncrease').disabled = fontSize >= maxFontSize;
    if (delta) { try { localStorage.setItem(fontSizeKey, String(fontSize)); } catch {} }
  }
  resizeText();
  $('canvasFontDecrease').addEventListener('click', () => resizeText(-2));
  $('canvasFontIncrease').addEventListener('click', () => resizeText(2));

  function note(message) { if ($('canvasStatus').textContent !== message) $('canvasStatus').textContent = message; }
  function controls() {
    editor.readOnly = !authenticated || busy || !loaded;
    $('canvasLogin').hidden = authenticated;
    $('canvasSave').hidden = !authenticated;
    $('canvasLogout').hidden = !authenticated;
    for (const id of ['canvasLogin', 'canvasLoginSubmit', 'canvasLogout', 'canvasReload']) $(id).disabled = busy;
    $('canvasPassword').disabled = busy;
    $('canvasCopy').disabled = busy || !loaded || !editor.value.trim();
    $('canvasClipboardCopy').disabled = copying || busy || !loaded || !editor.value.trim();
    $('canvasSave').disabled = busy || !loaded || editor.value === savedText;
  }

  async function request(path = '', options = {}) {
    const response = await fetch('/api/canvas' + path, { cache: 'no-store', ...options });
    if (response.status === 304) return { unchanged: true };
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(typeof data.error === 'string' ? data.error : '캔버스에 연결하지 못했습니다. 다시 시도해 주세요.');
      error.status = response.status;
      throw error;
    }
    data.etag = response.headers.get('ETag');
    return data;
  }

  function apply(data, discardDraft = false) {
    const dirty = loaded && editor.value !== savedText;
    authenticated = Boolean(data.authenticated);
    etag = data.etag || null;
    if (!dirty || discardDraft) {
      const nextText = typeof data.text === 'string' ? data.text : '';
      if (editor.value !== nextText) editor.value = nextText;
      savedText = editor.value;
      version = data.version;
      $('canvasReload').hidden = true;
    } else if (version !== data.version) {
      $('canvasReload').hidden = false;
    }
    loaded = true;
    if (authenticated) $('canvasLoginForm').hidden = true;
    return dirty && !discardDraft;
  }

  function cancelPoll() {
    pollEpoch++;
    pollController?.abort();
    pollFailed = false;
  }

  async function poll() {
    if (!dialog.open || document.hidden || busy || pollController) return;
    const epoch = pollEpoch;
    const controller = new AbortController();
    pollController = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    try {
      const data = await request('', { signal: controller.signal, headers: etag ? { 'If-None-Match': etag } : {} });
      if (epoch !== pollEpoch || busy || !dialog.open || document.hidden) return;
      if (!data.unchanged) {
        const previousVersion = version;
        const wasLoaded = loaded;
        const wasAuthenticated = authenticated;
        const dirty = apply(data);
        controls();
        if (wasAuthenticated && !authenticated) {
          note('관리자 로그인이 만료되었습니다. 작성한 내용을 저장하려면 다시 로그인해 주세요.');
        } else if (dirty && data.version !== version) {
          note('다른 곳에서 새 내용을 저장했습니다. 작성 중인 글은 유지됩니다. 필요한 내용을 복사한 후 최신 내용을 불러와 주세요.');
        } else if (!dirty && (!wasLoaded || previousVersion !== version)) {
          note('최신 내용으로 자동 업데이트했습니다.');
        } else if (pollFailed) note('자동 업데이트 연결이 복구되었습니다.');
      } else if (pollFailed) note('자동 업데이트 연결이 복구되었습니다.');
      pollFailed = false;
    } catch (error) {
      if ((timedOut || error.name !== 'AbortError') && epoch === pollEpoch && dialog.open && !busy) {
        pollFailed = true;
        note('자동 업데이트 연결이 지연되고 있습니다. 기존 내용은 유지하며 다시 확인합니다.');
      }
    } finally {
      clearTimeout(timeout);
      if (pollController === controller) pollController = null;
    }
  }

  function startPolling() {
    if (pollTimer === null && dialog.open && !document.hidden) pollTimer = setInterval(poll, 2000);
  }

  function stopPolling() {
    if (pollTimer !== null) clearInterval(pollTimer);
    pollTimer = null;
    cancelPoll();
  }

  async function load(discardDraft = false) {
    if (busy) return;
    cancelPoll();
    busy = true;
    controls();
    note('내용을 불러오고 있어요…');
    try {
      const dirty = apply(await request(), discardDraft);
      note(dirty ? '저장하지 않은 내용이 남아 있습니다.' : authenticated ? '관리자로 로그인했습니다. 내용을 수정한 뒤 저장해 주세요.' : '');
    } catch (error) { note(error.message); }
    finally { busy = false; controls(); }
  }

  $('canvasOpen').addEventListener('click', () => {
    if (!dialog.open) dialog.showModal();
    $('canvasLoginForm').hidden = true;
    load();
    startPolling();
  });
  $('canvasClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (dialog.open) return;
    $('canvasPassword').value = '';
    stopPolling();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else if (dialog.open) { startPolling(); poll(); }
  });
  $('canvasReload').addEventListener('click', () => load(true));
  editor.addEventListener('input', () => {
    if (editor.value === savedText && !$('canvasReload').hidden) etag = null;
    controls();
    note(editor.value === savedText ? '' : '수정한 내용은 저장을 눌러야 반영됩니다.');
  });
  $('canvasLogin').addEventListener('click', () => {
    $('canvasLoginForm').hidden = false;
    $('canvasPassword').focus();
  });
  $('canvasLoginForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const password = $('canvasPassword').value;
    if (!password) { note('관리자 비밀번호를 입력해 주세요.'); return; }
    $('canvasPassword').value = '';
    cancelPoll();
    busy = true;
    controls();
    note('로그인하고 있어요…');
    try {
      await request('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      authenticated = true;
      $('canvasLoginForm').hidden = true;
      apply(await request());
      note('관리자로 로그인했습니다. 내용을 수정한 뒤 저장해 주세요.');
    } catch (error) { note(error.message); }
    finally { busy = false; controls(); }
    if (authenticated && dialog.open) editor.focus({ preventScroll: true });
  });
  $('canvasSave').addEventListener('click', async () => {
    if (busy || !authenticated || !loaded) return;
    cancelPoll();
    busy = true;
    controls();
    note('저장하고 있어요…');
    try {
      const data = await request('', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: editor.value, version }) });
      apply({ ...data, authenticated: true }, true);
      note('저장했습니다. 다른 사람도 변경된 내용을 볼 수 있어요.');
    } catch (error) {
      if (error.status === 401) authenticated = false;
      if (error.status === 409) $('canvasReload').hidden = false;
      note(error.message + (error.status === 409 ? ' 작성한 내용은 남겨 두었습니다. 필요한 내용을 복사한 후 최신 내용을 불러와 주세요.' : ' 작성한 내용은 남겨 두었습니다.'));
    } finally { busy = false; controls(); }
  });
  $('canvasLogout').addEventListener('click', async () => {
    if (busy) return;
    cancelPoll();
    busy = true;
    controls();
    try {
      await request('/logout', { method: 'POST' });
      authenticated = false;
      editor.value = savedText;
      $('canvasLoginForm').hidden = true;
      apply(await request(), true);
      note('로그아웃했습니다.');
    } catch (error) { note(error.message); }
    finally { busy = false; controls(); }
  });
  $('canvasClipboardCopy').addEventListener('click', async () => {
    if (copying || busy || !loaded || !editor.value.trim()) return;
    const text = editor.value;
    copying = true;
    controls();
    try {
      try {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(text);
      } catch {
        const active = document.activeElement;
        const start = editor.selectionStart, end = editor.selectionEnd;
        const direction = editor.selectionDirection;
        const scrollTop = editor.scrollTop, scrollLeft = editor.scrollLeft;
        let copied = false;
        try {
          editor.focus({ preventScroll: true });
          editor.select();
          copied = document.execCommand('copy');
        } finally {
          editor.setSelectionRange(start, end, direction);
          active?.focus({ preventScroll: true });
          editor.scrollTop = scrollTop;
          editor.scrollLeft = scrollLeft;
        }
        if (!copied) throw new Error('Copy failed');
      }
      note('프롬프트를 복사했습니다. 원하는 곳에 붙여넣어 주세요.');
    } catch {
      note('복사하지 못했습니다. 캔버스 내용을 선택한 후 Ctrl+C 또는 기기의 복사 메뉴를 사용해 주세요.');
    } finally { copying = false; controls(); }
  });
  $('canvasCopy').addEventListener('click', () => {
    if (busy || !loaded || !editor.value.trim()) return;
    const prompt = $('prompt');
    const value = prompt.value + (prompt.value ? '\n\n' : '') + editor.value;
    if (value.length > prompt.maxLength) {
      note('프롬프트 입력 한도를 넘습니다. 입력창의 내용을 줄인 후 다시 복사해 주세요.');
      return;
    }
    prompt.value = value;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.close();
    prompt.focus();
    prompt.setSelectionRange(value.length, value.length);
    $('status').textContent = '캔버스 내용을 입력창에 복사했습니다. 확인한 뒤 보내 주세요.';
  });
  controls();
})();
