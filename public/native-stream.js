'use strict';

// Runs in the browser. The Worker forwards the original stream without parsing it.
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HaikuNativeStream = api;
})(globalThis, () => {
  const protocol = 'anthropic-messages-v1';
  const interrupted = () => new Error('최종 답변을 받기 전에 연결이 끊겼습니다.');
  function create() {
    let started = false, ended = false, finalUsage = false, id = '', model = '', stopReason = '';
    const nativeUsage = {};
    const mergeUsage = value => {
      if (!value || typeof value !== 'object') return;
      for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
        if (Number.isSafeInteger(value[key]) && value[key] >= 0) nativeUsage[key] = value[key];
      }
      const thinking = value.output_tokens_details?.thinking_tokens;
      if (Number.isSafeInteger(thinking) && thinking >= 0) nativeUsage.output_tokens_details = {thinking_tokens: thinking};
      const fetches = value.server_tool_use?.web_fetch_requests;
      if (Number.isSafeInteger(fetches) && fetches >= 0) nativeUsage.server_tool_use = {web_fetch_requests: fetches};
      const executed = value.server_tool_use_details?.tool_calls_executed ?? value.server_tool_use?.tool_calls_executed;
      if (Number.isSafeInteger(executed) && executed >= 0) nativeUsage.server_tool_use_details = {tool_calls_executed: executed};
    };
    const usage = () => {
      if (!Object.keys(nativeUsage).length) return undefined;
      const result = {native_usage: {...nativeUsage}};
      if (Number.isSafeInteger(nativeUsage.input_tokens)) result.prompt_tokens = nativeUsage.input_tokens + (nativeUsage.cache_creation_input_tokens || 0) + (nativeUsage.cache_read_input_tokens || 0);
      if (Number.isSafeInteger(nativeUsage.output_tokens)) result.completion_tokens = nativeUsage.output_tokens;
      if (Number.isSafeInteger(result.prompt_tokens) && Number.isSafeInteger(result.completion_tokens)) result.total_tokens = result.prompt_tokens + result.completion_tokens;
      if (nativeUsage.output_tokens_details) result.completion_tokens_details = {reasoning_tokens: nativeUsage.output_tokens_details.thinking_tokens};
      if (nativeUsage.server_tool_use) result.server_tool_use = {...nativeUsage.server_tool_use};
      if (nativeUsage.server_tool_use_details) result.server_tool_use_details = {...nativeUsage.server_tool_use_details};
      return result;
    };
    const chunk = (delta = {}, extra = {}) => ({id, model, choices: [{index: 0, delta, ...extra}], usage: usage()});
    function parse(frame) {
      if (ended) return null;
      if (frame.length > 1024 * 1024) throw interrupted();
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data) return null;
      // A synthetic [DONE] does not prove native message completion.
      if (data === '[DONE]') throw interrupted();
      let event;
      try { event = JSON.parse(data); } catch { throw interrupted(); }
      if (!event || typeof event !== 'object') throw interrupted();
      if (event.type === 'ping') return null;
      if (event.type === 'error' || event.error) throw new Error('모델 응답 중 오류가 발생했습니다. 다시 보내 주세요.');
      if (event.type === 'message_start') {
        if (started) throw interrupted();
        started = true;
        id = typeof event.message?.id === 'string' ? event.message.id : '';
        model = typeof event.message?.model === 'string' ? event.message.model : '';
        mergeUsage(event.message?.usage);
        return {chunk: chunk({role: 'assistant'})};
      }
      if (!started) throw interrupted();
      if (event.type === 'content_block_start' || event.type === 'content_block_delta') {
        const block = event.content_block || event.delta;
        if (['text', 'text_delta'].includes(block?.type) && typeof block.text === 'string' && block.text) return {chunk: chunk({content: block.text})};
        if (['thinking', 'thinking_delta'].includes(block?.type) && typeof block.thinking === 'string' && block.thinking) return {chunk: chunk({reasoning_details: [{type: 'reasoning.summary', summary: block.thinking}]})};
        // Encrypted/redacted blocks and signatures are never decoded or displayed.
        return null;
      }
      if (event.type === 'message_delta') {
        mergeUsage(event.usage);
        const extra = {};
        if (typeof event.delta?.stop_reason === 'string' && event.delta.stop_reason) {
          stopReason = event.delta.stop_reason;
          finalUsage = Number.isSafeInteger(event.usage?.output_tokens) && event.usage.output_tokens >= 0;
          extra.native_finish_reason = stopReason;
          extra.finish_reason = ['max_tokens', 'model_context_window_exceeded'].includes(stopReason) ? 'length' : stopReason === 'tool_use' ? 'tool_calls' : stopReason === 'refusal' ? 'content_filter' : 'stop';
        }
        return {chunk: chunk({}, extra)};
      }
      if (event.type === 'message_stop') {
        if (!stopReason || !finalUsage) throw interrupted();
        ended = true;
        return {ended: true, chunk: chunk()};
      }
      return null;
    }
    return {parse, finish() { if (!ended) throw interrupted(); }, get ended() { return ended; }, get complete() { return ended && stopReason === 'end_turn' && finalUsage; }};
  }
  return {protocol, create};
});
