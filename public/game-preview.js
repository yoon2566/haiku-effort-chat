'use strict';
(() => {
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


  window.HaikuGamePreview = Object.freeze({ document: previewDocument });
})();
