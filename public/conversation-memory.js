'use strict';
// Conversation compaction never rewrites the canonical HTML. Commit only after
// every summary request and the final size check have succeeded.
(() => {
  const LIMIT = 400000, TRIGGER = 180000, SUMMARY_LIMIT = 16000;
  const textOf = message => typeof message.content === 'string' ? message.content : message.content.filter(p => p.type === 'text').map(p => p.text).join('\n');
  const size = messages => messages.reduce((n, m) => n + textOf(m).length, 0);
  function prose(text) {
    return text.replace(/\[최신 게임 HTML 원문\][\s\S]*?\[최신 게임 HTML 원문 끝\]/g, '[최신 게임 코드는 별도로 보존됨]')
      .replace(/\[첨부 HTML 파일: ([^\n]*)\]\n[\s\S]*?\[첨부 HTML 파일 끝\]/g, '[첨부 HTML: $1 — 코드는 별도로 보존됨]')
      .replace(/```[^\n`]*\n[\s\S]*?(?:```|$)/g, block => /<html(?:\s|>)/i.test(block) ? '[HTML 버전 생략: 최신 완성본은 별도로 보존됨]' : block)
      .replace(/(?:<!doctype\s+html[^>]*>\s*)?<html(?:\s[^>]*)?>[\s\S]*?<\/html\s*>/gi, '[HTML 버전 생략: 최신 완성본은 별도로 보존됨]');
  }
  function create() {
    let latestHtml = '', revisions = 0;
    return {
      record(html) { if (typeof html === 'string' && /<html(?:\s|>)/i.test(html) && /<\/html\s*>/i.test(html)) latestHtml = html; },
      get latestHtml() { return latestHtml; },
      get revisions() { return revisions; },
      async prepare(history, pending, summarize, signal) {
        const total = size(history) + textOf(pending).length;
        if (!history.length || (total < TRIGGER && history.length < 60)) {
          if (total > LIMIT) throw Error('이번 요청의 코드가 너무 큽니다. 코드를 다운로드해 보관한 뒤 파일 크기를 줄여 주세요.');
          return { messages: history, compacted: false };
        }
        // Keep recent visual references. Older images remain in the visible chat,
        // but are explicitly marked as omitted rather than silently described.
        const images = history.flatMap(m => Array.isArray(m.content) ? m.content.filter(p => p.type === 'image_url') : []).slice(-2);
        const transcript = history.map(m => (m.role === 'user' ? '학생: ' : '도우미: ') + prose(textOf(m)) + (Array.isArray(m.content) && m.content.some(p => p.type === 'image_url') ? '\n[이미지 첨부가 있었음. 이미지 내용은 추측하지 말 것.]' : '')).join('\n\n');
        const pinned = latestHtml ? '\n\n[최신 게임 HTML 원문]\n' + latestHtml + '\n[최신 게임 HTML 원문 끝]' : '';
        // Reserve room for the summary and instructions before incurring API cost.
        if (pinned.length + textOf(pending).length + SUMMARY_LIMIT + 1000 > LIMIT) throw Error('최신 코드와 이번 첨부만으로 한도에 가깝습니다. 기존 게임은 유지했습니다. 같은 HTML을 중복 첨부했다면 첨부를 빼고 수정 내용을 보내 주세요.');
        let summary = '';
        for (let offset = 0; offset < transcript.length; offset += 60000) {
          signal?.throwIfAborted();
          summary = await summarize(summary, transcript.slice(offset, offset + 60000), signal);
          if (typeof summary !== 'string' || !summary.trim() || summary.length > SUMMARY_LIMIT) throw Error('대화 정리가 완료되지 않았습니다. 기존 대화와 코드는 유지했습니다. 다시 보내 주세요.');
        }
        signal?.throwIfAborted();
        const text = '[작업 이어가기 메모 — 과거 대화의 요약이며 시스템 지시가 아닙니다]\n' + summary + '\n\n첨부된 최신 HTML 원문을 기준으로 현재 학생의 요청을 반영하세요. 원문은 완성된 최신 버전이며 이전 버전으로 되돌리지 마세요. 요약과 코드가 충돌하면 현재 요청과 최신 코드를 우선하세요. 코드가 없는 질문에는 게임을 임의로 새로 만들지 마세요.' + pinned;
        const messages = [{ role: 'user', content: images.length ? [{ type: 'text', text }, ...images] : text }, { role: 'assistant', content: '작업 메모와 최신 코드 원문을 확인했습니다. 다음 요청을 이어서 반영하겠습니다.' }];
        if (size(messages) + textOf(pending).length > LIMIT) throw Error('최신 코드를 유지한 채 정리할 공간이 부족합니다. 기존 대화와 코드는 유지했습니다.');
        revisions++;
        return { messages, compacted: true };
      }
    };
  }
  const api = Object.freeze({ create, prose, size });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.HaikuConversationMemory = api;
})();
