'use strict';
(() => {
  const notice = document.getElementById('notice');
  const restart = document.getElementById('restart');
  const download = document.getElementById('download');
  let frame = document.getElementById('game');
  let html = null;
  let runToken = null;
  function run() {
    notice.hidden = true;
    const fresh = frame.cloneNode(false);
    fresh.removeAttribute('srcdoc');
    frame.replaceWith(fresh);
    frame = fresh;
    const token = runToken = crypto.randomUUID();
    fresh.addEventListener('load', () => {
      if (runToken === token && fresh.hasAttribute('srcdoc')) fresh.focus();
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (runToken === token) fresh.srcdoc = window.HaikuGamePreview.document(html, token);
    }));
  }
  const token = location.hash.slice(1);
  history.replaceState(null, '', location.pathname);
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(token) || !window.BroadcastChannel) {
    notice.textContent = '하이쿠 대화에서 「새 탭에서 실행」을 눌러 게임을 열어 주세요. 새로고침한 경우에도 다시 열어 주세요.';
    return;
  }
  const channel = new BroadcastChannel('haiku-game-' + token);
  const timeout = setTimeout(() => {
    channel.close();
    notice.textContent = '게임을 가져오지 못했습니다. 하이쿠 대화에서 「새 탭에서 실행」을 다시 눌러 주세요.';
  }, 30000);
  channel.onmessage = ({ data }) => {
    if (html !== null || data?.type !== 'game' || typeof data.html !== 'string') return;
    html = data.html;
    clearTimeout(timeout);
    channel.postMessage({ type: 'loaded' });
    channel.close();
    restart.disabled = download.disabled = false;
    run();
  };
  channel.postMessage({ type: 'ready' });
  restart.addEventListener('click', run);
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'game.html'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });
  addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.data?.token !== runToken) return;
    if (event.data.type === 'haiku-preview-error') {
      notice.textContent = '게임 코드 오류: ' + String(event.data.message).slice(0, 500);
      notice.hidden = false;
    }
  });
})();
