// ==UserScript==
// @name         V2EX 纯净阅读助手
// @namespace    https://github.com/bitlumen
// @version      1.0.0
// @description  合并帖子分页，保留正文与附言，支持回复移除恢复、富文本和纯文本复制。
// @author       enthem
// @match        https://v2ex.com/t/*
// @match        https://*.v2ex.com/t/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const VERSION = '1.0.0';
  const HOST_ID = 'vpr-host';
  const MAX_PAGES = 200;
  const REQUEST_TIMEOUT = 15000;
  const PAGE_INTERVAL = 350;
  const topicId = location.pathname.match(/^\/t\/(\d+)\/?$/)?.[1];
  if (!topicId || window.top !== window.self || document.getElementById(HOST_ID)) return;

  const topicURL = new URL(`/t/${topicId}`, location.origin).href;
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const text = node => node?.textContent?.trim() || '';
  const state = {
    opened: false, busy: false, copying: false, phase: 'idle', error: '',
    topic: null, totalPages: 1, limited: false, requesting: 1,
    pages: new Set(), replies: new Map(), removed: new Set(), undo: [], controller: null
  };
  const replyNodes = new Map();
  let host, shadow, ui, returnFocus, restoreBackground = [], savedOverflow = [], toastTimer;

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content != null) node.textContent = content;
    return node;
  }

  function safeURL(value, base, image = false) {
    if (!value?.trim()) return '';
    try {
      const url = new URL(value, base);
      return (image ? ['http:', 'https:'] : ['http:', 'https:', 'mailto:']).includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  // Rebuild readable markup with an allowlist; source attributes and handlers stay out.
  function contentHTML(source, base) {
    const allowed = new Set('p div span br wbr hr h1 h2 h3 h4 h5 h6 blockquote pre code ul ol li a img strong b em i u s del ins small sub sup table thead tbody tfoot tr th td dl dt dd details summary kbd mark'.split(' '));
    const blocked = new Set('script style iframe object embed form input button textarea select svg math template link meta base noscript canvas'.split(' '));
    const output = element('div');
    function append(node, parent, depth = 0) {
      if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
      if (node.nodeType !== Node.ELEMENT_NODE || depth > 80) return;
      const tag = node.localName.toLowerCase();
      if (blocked.has(tag)) return;
      if (!allowed.has(tag)) { for (const child of node.childNodes) append(child, parent, depth + 1); return; }
      const clean = element(tag);
      if (tag === 'a') {
        const href = safeURL(node.getAttribute('href'), base);
        if (href) { clean.href = href; clean.target = '_blank'; clean.rel = 'noopener noreferrer'; }
      }
      if (tag === 'img') {
        const src = safeURL(node.getAttribute('src') || node.getAttribute('data-src'), base, true);
        if (!src) { parent.append(document.createTextNode(node.getAttribute('alt') || '')); return; }
        clean.src = src; clean.alt = node.getAttribute('alt') || '图片';
        clean.loading = 'lazy'; clean.decoding = 'async'; clean.referrerPolicy = 'no-referrer';
      }
      for (const name of ['colspan', 'rowspan', 'start', 'value']) {
        if ((['td', 'th'].includes(tag) && ['colspan', 'rowspan'].includes(name)) || (tag === 'ol' && name === 'start') || (tag === 'li' && name === 'value')) {
          const value = node.getAttribute(name);
          if (/^\d{1,4}$/.test(value || '')) clean.setAttribute(name, value);
        }
      }
      if (tag === 'details') clean.open = true;
      for (const child of node.childNodes) append(child, clean, depth + 1);
      parent.append(clean);
    }
    if (source) for (const child of source.childNodes) append(child, output);
    return output.innerHTML;
  }

  function pagination(doc, base, requested) {
    let total = requested;
    for (const link of qa('a.page_normal[href],a.page_current[href],.pagination a[href],a[rel="next"][href]', doc)) {
      if (link.closest('.topic_content,.reply_content')) continue;
      const href = safeURL(link.getAttribute('href'), base);
      if (!href) continue;
      const url = new URL(href);
      if (url.origin !== location.origin || url.pathname.replace(/\/$/, '') !== `/t/${topicId}`) continue;
      const page = Number(url.searchParams.get('p') || 1);
      if (Number.isSafeInteger(page) && page > 0) total = Math.max(total, page);
    }
    for (const input of qa('.page_input[max]', doc)) {
      if (input.closest('.topic_content,.reply_content')) continue;
      const max = Number(input.max);
      if (Number.isSafeInteger(max) && max > 0) total = Math.max(total, max);
    }
    const marker = qa('.page_current,.page_input', doc).find(node => !node.closest('.topic_content,.reply_content'));
    const current = Number(marker?.value || text(marker));
    if (current > 0 && Number.isInteger(current) && current !== requested) throw new Error(`网站返回了第 ${current} 页，请刷新原帖后重试`);
    return total;
  }

  function parsePage(doc, base, page) {
    const main = q('#Main', doc) || doc;
    const heading = q('.header h1', main);
    const box = heading?.closest('.box') || heading?.parentElement?.parentElement;
    if (!heading || !box) throw new Error('未识别到帖子内容，请在原帖检查登录状态或网站验证');
    const votes = q('[id^="topic_"][id$="_votes"]', box);
    if (votes && votes.id !== `topic_${topicId}_votes`) throw new Error('网站返回了其他帖子，已停止加载');
    const header = heading.closest('.header');
    const author = q('small a[href*="/member/"]', header) || q('a[href*="/member/"]', header);
    const time = q('small [title],.ago[title],time', header);
    const body = qa('.topic_content', box).find(node => !node.closest('.subtle,.reply_content'));
    const supplements = qa('.subtle', box).filter(node => q('.topic_content', node)).map((node, index) => ({
      label: `附言 ${index + 1}`, time: q('[title]', node)?.getAttribute('title') || '', html: contentHTML(q('.topic_content', node), base)
    }));
    const replies = qa('.reply_content', main).map((content, index) => {
      const cell = content.closest('.cell') || content.parentElement;
      const user = q('strong a[href*="/member/"]', cell), ago = q('.ago,time', cell);
      const floorText = text(q('.no', cell));
      const floor = /^\d+$/.test(floorText) ? Number(floorText) : null;
      const id = /^r_\d+$/.test(cell.id) ? cell.id : '';
      return {
        key: id || (floor != null ? `floor-${floor}` : `page-${page}-item-${index + 1}`),
        floor: floor != null ? `${floor} 楼` : `第 ${page} 页 · 第 ${index + 1} 条`,
        author: text(user) || '未知作者', href: safeURL(user?.getAttribute('href'), base),
        time: ago?.getAttribute('title') || ago?.getAttribute('datetime') || text(ago), html: contentHTML(content, base)
      };
    });
    return {
      topic: { title: text(heading) || '无标题', author: text(author) || '未知作者', href: safeURL(author?.getAttribute('href'), base), time: time?.getAttribute('title') || time?.getAttribute('datetime') || text(time), html: contentHTML(body, base), supplements },
      replies, total: pagination(doc, base, page)
    };
  }

  function abortError() { return new DOMException('加载已停止', 'AbortError'); }

  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(abortError()); return; }
      const stop = () => { clearTimeout(timer); reject(abortError()); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
      signal.addEventListener('abort', stop, { once: true });
    });
  }

  async function fetchPage(page, signal) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    let timedOut = false;
    if (signal.aborted) throw abortError();
    signal.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT);
    try {
      const url = new URL(topicURL); url.searchParams.set('p', page);
      const response = await fetch(url.href, { credentials: 'same-origin', mode: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`网站返回 HTTP ${response.status}，请稍后重试`);
      const finalURL = new URL(response.url);
      if (finalURL.origin !== location.origin || finalURL.pathname.replace(/\/$/, '') !== `/t/${topicId}`) throw new Error('页面发生跳转，请在原帖检查登录状态或网站验证');
      if (!/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) throw new Error('网站返回的内容不是网页');
      const html = await response.text();
      if (html.length > 5 * 1024 * 1024) throw new Error('单页内容过大，已停止加载');
      return parsePage(new DOMParser().parseFromString(html, 'text/html'), finalURL.href, page);
    } catch (error) {
      if (signal.aborted) throw abortError();
      if (timedOut) throw new Error('请求超过 15 秒，请重试');
      throw error;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
  }

  async function loadPages() {
    if (state.busy || ['complete', 'limited'].includes(state.phase)) return;
    state.busy = true; state.phase = 'loading'; state.error = '';
    const controller = new AbortController(); state.controller = controller;
    updateControls();
    try {
      for (let page = 1; page <= state.totalPages; page++) {
        if (state.pages.has(page)) continue;
        if (controller.signal.aborted) throw abortError();
        state.requesting = page; updateControls();
        const currentPage = Number(new URL(location.href).searchParams.get('p') || 1);
        const parsed = page === 1 && currentPage === 1
          ? parsePage(document, location.href, 1) : await fetchPage(page, controller.signal);
        if (controller.signal.aborted) throw abortError();
        if (page > 1 && parsed.replies.length && parsed.replies.every(reply => state.replies.has(reply.key))) throw new Error('网站重复返回已加载的回复，请刷新原帖后重试');
        state.totalPages = Math.max(state.totalPages, Math.min(parsed.total, MAX_PAGES));
        state.limited ||= parsed.total > MAX_PAGES;
        if (!state.topic) { state.topic = parsed.topic; renderTopic(); }
        const fragment = document.createDocumentFragment();
        for (const reply of parsed.replies) {
          if (state.replies.has(reply.key)) continue;
          state.replies.set(reply.key, reply);
          const node = renderReply(reply); replyNodes.set(reply.key, node); fragment.append(node);
        }
        ui.replies.append(fragment); state.pages.add(page); updateControls();
        if (page < state.totalPages) await pause(PAGE_INTERVAL, controller.signal);
      }
      state.phase = state.limited ? 'limited' : 'complete';
    } catch (error) {
      state.phase = controller.signal.aborted ? 'paused' : 'error';
      if (state.phase === 'error') state.error = `第 ${state.requesting} 页：${error.message || '网络请求失败，请重试'}`;
    } finally { state.busy = false; state.controller = null; updateControls(); }
  }

  function authorLine(author, href, time, prefix = '') {
    const meta = element('div', 'meta');
    if (prefix) meta.append(element('span', 'floor', prefix));
    const user = element(href ? 'a' : 'span', 'author', author);
    if (href) { user.href = href; user.target = '_blank'; user.rel = 'noopener noreferrer'; }
    meta.append(user);
    if (time) meta.append(element('span', 'time', time));
    return meta;
  }

  function richContent(html) { const node = element('div', 'prose'); node.innerHTML = html; return node; }

  function topicArticle() {
    const topic = state.topic, article = element('article', 'topic-card');
    article.append(element('div', 'eyebrow', '主题'), element('h1', '', topic.title), authorLine(topic.author, topic.href, topic.time), richContent(topic.html));
    for (const supplement of topic.supplements) {
      const section = element('section', 'supplement');
      section.append(element('h2', '', supplement.label), element('div', 'meta', supplement.time), richContent(supplement.html)); article.append(section);
    }
    return article;
  }

  function renderTopic() { ui.topic.replaceChildren(topicArticle()); }

  function renderReply(reply, actions = true) {
    const article = element('article', 'reply-card'); article.dataset.key = reply.key;
    const header = element('div', 'reply-head');
    header.append(authorLine(reply.author, reply.href, reply.time, reply.floor));
    if (actions) {
      const button = element('button', 'remove', '移除'); button.type = 'button';
      button.dataset.remove = reply.key; button.setAttribute('aria-label', `移除 ${reply.floor} ${reply.author} 的回复`); header.append(button);
    }
    article.append(header, richContent(reply.html)); return article;
  }

  function removeReply(key) {
    if (!state.replies.has(key) || state.removed.has(key)) return;
    state.removed.add(key); state.undo.push(key); replyNodes.get(key).hidden = true; updateControls();
    const visible = [...replyNodes.values()].filter(node => !node.hidden);
    const next = visible.find(node => node.compareDocumentPosition(replyNodes.get(key)) & Node.DOCUMENT_POSITION_PRECEDING) || visible[0];
    (next ? q('button', next) : ui.undo).focus({ preventScroll: true });
    toast('已从本次阅读中移除，可撤销；复制时将排除此回复');
  }

  function undoRemoval() {
    const key = state.undo.pop();
    if (!key) return;
    state.removed.delete(key); replyNodes.get(key).hidden = false; updateControls();
    const button = q('button', replyNodes.get(key)); button.focus({ preventScroll: true }); button.scrollIntoView({ block: 'nearest' });
    toast('已恢复上一次移除的回复');
  }

  function restoreAll() {
    for (const key of state.removed) replyNodes.get(key).hidden = false;
    state.removed.clear(); state.undo = []; updateControls(); ui.close.focus(); toast('已恢复全部回复');
  }

  function plainText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.localName;
    if (tag === 'br' || tag === 'hr') return '\n';
    if (tag === 'img') return `[图片：${node.alt}] ${node.src}`;
    let result = [...node.childNodes].map(plainText).join('');
    if (tag === 'a' && node.href && result.trim() !== node.href) result += ` (${node.href})`;
    if (tag === 'li') result = '• ' + result;
    if (['th', 'td'].includes(tag)) result += '\t';
    if (['p', 'div', 'article', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'li', 'tr', 'dl', 'dt', 'dd'].includes(tag)) result += '\n';
    if (node.classList.contains('floor') || node.classList.contains('author')) result += ' · ';
    return result;
  }

  function exportContent() {
    const container = element('div'); container.append(topicArticle());
    const source = element('p', '', '原帖：'), link = element('a', '', topicURL);
    link.href = topicURL; source.append(link); container.append(source);
    const kept = [...state.replies.values()].filter(reply => !state.removed.has(reply.key));
    container.append(element('h2', '', `回复（保留 ${kept.length} 条）`));
    if (state.phase !== 'complete') container.append(element('p', '', `仅包含已加载的 ${state.pages.size} 页内容。`));
    for (const reply of kept) container.append(renderReply(reply, false));
    const plain = plainText(container).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    for (const meta of qa('.meta', container)) {
      for (const child of [...meta.children].slice(1)) child.before(document.createTextNode(' · '));
    }
    for (const node of qa('[class],[data-key]', container)) { node.removeAttribute('class'); node.removeAttribute('data-key'); }
    return { html: container.innerHTML, plain };
  }

  function showCopyFallback(value) {
    ui.copyFallback.hidden = false; ui.copyText.value = value; ui.copyText.focus(); ui.copyText.select();
    toast('无法直接写入剪贴板，已选中纯文本，请按 Ctrl+C / ⌘C 复制');
  }

  async function copyContent(rich) {
    if (!state.topic || state.copying) return;
    const data = exportContent(); state.copying = true; updateControls();
    try {
      if (rich && navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([data.html], { type: 'text/html' }), 'text/plain': new Blob([data.plain], { type: 'text/plain' }) })]);
          toast('已复制富文本及纯文本'); return;
        } catch { /* Try plain text before showing manual copy. */ }
      }
      if (!navigator.clipboard?.writeText) throw new Error('剪贴板不可用');
      await navigator.clipboard.writeText(data.plain); toast(rich ? '已改用纯文本复制' : '已复制纯文本');
    } catch { if (state.opened) showCopyFallback(data.plain); }
    finally { state.copying = false; updateControls(); }
  }

  function updateControls() {
    const loaded = state.pages.size, total = state.totalPages, kept = state.replies.size - state.removed.size;
    ui.count.textContent = `保留 ${kept} 条 · 已移除 ${state.removed.size} 条`;
    const messages = {
      idle: '准备读取帖子', loading: `正在读取第 ${state.requesting} 页 · 已加载 ${loaded} / ${total} 页`,
      complete: `全部加载完成 · ${loaded} 页`, paused: `已停止 · 已加载 ${loaded} / ${total} 页，可继续加载`,
      error: `${state.error}。已保留 ${loaded} 页内容。`, limited: `已加载前 ${MAX_PAGES} 页，其余内容请查看原帖`
    };
    ui.status.textContent = messages[state.phase]; ui.status.dataset.phase = state.phase;
    ui.stop.hidden = !state.busy; ui.resume.hidden = !['paused', 'error'].includes(state.phase);
    ui.resume.textContent = state.phase === 'error' ? '重试未完成页面' : '继续加载'; ui.resume.disabled = state.busy;
    ui.copyRich.disabled = ui.copyPlain.disabled = !state.topic || state.copying;
    ui.undo.disabled = !state.undo.length; ui.restore.disabled = !state.removed.size;
    ui.empty.hidden = kept > 0;
    ui.empty.textContent = state.removed.size ? '本次已移除所有回复，可撤销或恢复全部。' : state.busy ? '正在读取回复…' : state.phase === 'complete' ? '这个帖子暂时没有回复。' : '尚未加载到回复。';
    ui.progress.value = loaded; ui.progress.max = total; ui.progress.hidden = state.phase === 'complete';
  }

  function toast(message) {
    clearTimeout(toastTimer); ui.toast.textContent = message; ui.toast.hidden = !state.opened;
    toastTimer = setTimeout(() => { ui.toast.hidden = true; }, 5000);
  }

  function openReader() {
    if (state.opened) return;
    state.opened = true; returnFocus = document.activeElement === host ? shadow.activeElement : document.activeElement;
    ui.overlay.hidden = false; ui.launcher.hidden = true; ui.launcher.setAttribute('aria-expanded', 'true');
    savedOverflow = [document.documentElement, document.body].map(node => [node, ['overflow', 'overflow-x', 'overflow-y'].map(property => [property, node.style.getPropertyValue(property), node.style.getPropertyPriority(property)])]);
    for (const [node] of savedOverflow) node.style.setProperty('overflow', 'hidden', 'important');
    restoreBackground = [...document.body.children].filter(node => node !== host).map(node => [node, node.inert]);
    for (const [node] of restoreBackground) node.inert = true;
    ui.close.focus({ preventScroll: true });
    if (state.phase === 'idle') loadPages();
  }

  function closeReader() {
    if (!state.opened) return;
    state.controller?.abort(); state.opened = false;
    ui.overlay.hidden = true; ui.launcher.hidden = false; ui.launcher.setAttribute('aria-expanded', 'false');
    ui.copyFallback.hidden = true; ui.toast.hidden = true; clearTimeout(toastTimer);
    for (const [node, properties] of savedOverflow) {
      node.style.removeProperty('overflow');
      for (const [property, value, priority] of properties) if (value) node.style.setProperty(property, value, priority);
    }
    for (const [node, inert] of restoreBackground) node.inert = inert;
    savedOverflow = []; restoreBackground = [];
    (returnFocus?.isConnected && !returnFocus.closest('[inert]') ? returnFocus : ui.launcher).focus({ preventScroll: true });
  }

  const styles = `
    :host{all:initial;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;font-size:14px;color:#29344c;color-scheme:light;line-height:1.5}
    *,*::before,*::after{box-sizing:border-box}[hidden]{display:none!important}button,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.42}a{color:#4c5cc4;text-decoration:none}a:hover{text-decoration:underline}button:focus-visible,a:focus-visible,textarea:focus-visible,.scroll:focus-visible{outline:3px solid #98a5f5;outline-offset:3px}
    .dock{pointer-events:none;position:fixed;right:0;bottom:14px;padding:10px 0 10px 10px;overflow:hidden}.launcher{pointer-events:auto;display:flex;align-items:center;gap:9px;border:1px solid #5264df;background:#4455ce;color:#fff;border-radius:16px 0 0 16px;padding:13px 18px 13px 12px;box-shadow:0 5px 20px #394db536;font-weight:650;white-space:nowrap;transform:translateX(calc(100% - 40px));transition:transform .2s ease,background .15s}.launcher:hover,.launcher:focus-visible{transform:translateX(0);background:#3949bb}.mark{font-size:19px;line-height:1}.launch-label{opacity:0;transition:opacity .15s}.launcher:hover .launch-label,.launcher:focus-visible .launch-label{opacity:1}
    .overlay{pointer-events:auto;position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:26px;background:#18223d70;backdrop-filter:blur(4px)}.panel{width:100%;max-width:1020px;max-height:calc(100dvh - 52px);display:flex;flex-direction:column;background:#f5f7fc;border:1px solid #fff9;border-radius:22px;box-shadow:0 24px 80px #17234340;overflow:hidden}.head{display:flex;gap:12px;align-items:center;padding:18px 24px;background:#fff;border-bottom:1px solid #e8ecf4}.brand{display:grid;place-items:center;flex:none;width:42px;height:42px;background:#eef0ff;color:#5364d9;border-radius:13px;font-size:22px}.brand-title{font-size:16px;font-weight:700}.subtitle{font-size:12px;color:#8993a7;margin-top:3px}.grow{flex:1;min-width:0}.version{font-size:11px;color:#9ba4b5;margin-left:8px;font-weight:400}.close{flex:none;border:0;background:#f3f5fa;color:#65728a;width:34px;height:34px;border-radius:10px;font-size:23px}.close:hover{background:#e9edf7}
    .toolbar{display:flex;align-items:center;gap:8px;padding:13px 24px 8px;flex-wrap:wrap;background:#fff}.action{border:1px solid #dce2ef;color:#536078;background:#fff;border-radius:9px;min-height:36px;padding:8px 12px;font-size:12px;font-weight:600}.action:hover:not(:disabled){background:#f0f3fb;border-color:#bdc7e4}.primary{background:#5364d9;color:#fff;border-color:#5364d9}.primary:hover:not(:disabled){background:#4454c6;border-color:#4454c6}.count{margin-left:auto;font-size:12px;color:#75819a}.load-row{display:flex;gap:10px;align-items:center;padding:6px 24px 14px;background:#fff;flex-wrap:wrap}.status{font-size:12px;color:#7b879d;flex:1;min-width:180px}.status[data-phase=error]{color:#b74f3e}.status[data-phase=paused],.status[data-phase=limited]{color:#a16b27}.load-row .action{min-height:29px;padding:5px 9px}progress{display:block;width:100%;height:3px;appearance:none;border:0;background:#e9edf7}progress::-webkit-progress-bar{background:#e9edf7}progress::-webkit-progress-value{background:#8897e8;transition:width .2s}
    .scroll{overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;min-height:100px;padding:24px;outline-offset:-4px!important}.topic-card{background:#fff;padding:30px 34px;border:1px solid #e4e9f3;border-radius:16px;box-shadow:0 3px 12px #24335c04}.eyebrow{color:#7c88b4;letter-spacing:.14em;font-size:11px;font-weight:700;margin-bottom:10px}h1{font-size:25px;line-height:1.5;margin:0 0 14px;font-weight:700;overflow-wrap:anywhere}.meta{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:12px;line-height:1.6;color:#929bad}.author{font-weight:650;color:#5667bf}.time{font-variant-numeric:tabular-nums;font-size:11px}.floor{color:#8a94ad;font-size:11px}.prose{font-size:15px;line-height:1.9;overflow-wrap:anywhere;word-break:normal;color:#38445c;margin-top:17px}.prose>:first-child{margin-top:0}.prose>:last-child{margin-bottom:0}.prose p{margin:12px 0}.prose img{max-width:100%;height:auto;vertical-align:middle;border-radius:5px}.prose pre{overflow-x:auto;white-space:pre;padding:16px;background:#f3f5fa;border:1px solid #e7ebf2;border-radius:10px;font-size:13px;line-height:1.7}.prose code,.prose kbd{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88em;background:#f0f3fa;padding:2px 5px;border-radius:4px}.prose pre code{padding:0;background:none}.prose blockquote{margin:16px 0;border-left:3px solid #c6cef3;padding:5px 16px;color:#748099;background:#f8f9fe}.prose ul,.prose ol{padding-left:25px}.prose table{display:block;overflow-x:auto;border-collapse:collapse;max-width:100%;font-size:13px}.prose td,.prose th{border:1px solid #dde3ee;padding:7px 12px}.prose h1,.prose h2,.prose h3{font-size:1.2em;margin:22px 0 12px}.prose hr{border:0;border-top:1px solid #e6eaf2;margin:22px 0}.supplement{border-top:1px solid #e9edf5;margin-top:24px;padding-top:20px}.supplement h2{font-size:12px;color:#ad813b;margin:0 0 6px}
    .section-label{font-size:12px;font-weight:650;color:#8893aa;letter-spacing:.12em;margin:26px 5px 12px}.reply-card{padding:20px 26px;background:#fff;border:1px solid #e5eaf3;border-radius:13px;margin:10px 0}.reply-head{display:flex;gap:12px;align-items:flex-start;justify-content:space-between}.reply-head .meta{flex:1}.remove{border:0;background:#f5f6fa;color:#9aa3b4;border-radius:7px;padding:4px 9px;font-size:11px;flex:none}.remove:hover{background:#fff0ec;color:#b76853}.reply-card .prose{font-size:14px;margin-top:12px}.empty{color:#929bb0;text-align:center;font-size:13px;padding:32px 12px}.footer{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;border-top:1px solid #e6ebf4;background:#fff;font-size:11px;color:#98a2b6;gap:12px}.footer a{white-space:nowrap}.footer-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#8cbaa8;margin-right:6px}.toast{position:absolute;bottom:62px;left:50%;transform:translateX(-50%);max-width:calc(100% - 48px);background:#28344e;color:#fff;border-radius:10px;padding:11px 16px;box-shadow:0 8px 26px #101f3a26;font-size:12px;pointer-events:none;text-align:center;z-index:2}
    .fallback{background:#f1f3fe;border-top:1px solid #dce2fa;padding:14px 24px;flex:none}.fallback-label{display:flex;align-items:center;gap:12px;margin-bottom:9px;font-size:12px;color:#637096}.fallback textarea{display:block;width:100%;height:100px;resize:none;border:1px solid #ccd4ee;border-radius:8px;padding:10px;color:#36405b;background:#fff;font-size:12px}
    @media(max-width:600px){.overlay{padding:8px}.panel{max-height:calc(100dvh - 16px);border-radius:16px}.head{padding:14px}.brand{width:36px;height:36px}.brand-title{font-size:14px}.subtitle{font-size:10px}.toolbar{padding:12px 14px 6px;gap:6px}.count{width:100%;margin:3px 0 0}.load-row{padding:6px 14px 12px}.scroll{padding:12px}.topic-card{padding:20px 18px}h1{font-size:21px}.reply-card{padding:17px}.meta{gap:6px}.time{width:100%}.prose{font-size:14px}.footer{padding:11px 14px;font-size:10px}.fallback{padding:12px 14px}.dock{bottom:4px}.toast{max-width:calc(100% - 24px);bottom:54px;width:max-content}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important}}
  `;

  function mount() {
    host = element('div'); host.id = HOST_ID;
    host.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${styles}</style>
      <div class="dock"><button id="launcher" class="launcher" type="button" aria-expanded="false" aria-controls="panel" title="打开纯净阅读"><span class="mark" aria-hidden="true">▤</span><span class="launch-label">纯净阅读</span></button></div>
      <div id="overlay" class="overlay" hidden>
        <section id="panel" class="panel" role="dialog" aria-modal="true" aria-labelledby="readerTitle">
          <header class="head"><div class="brand" aria-hidden="true">▤</div><div class="grow"><div id="readerTitle" class="brand-title">V2EX 纯净阅读<span class="version">v${VERSION}</span></div><div class="subtitle">读完一段讨论，留下想保留的内容</div></div><button id="close" class="close" type="button" aria-label="关闭纯净阅读" title="关闭（Esc）">×</button></header>
          <div class="toolbar" role="group" aria-label="阅读操作"><button id="copyRich" class="action primary" type="button" disabled>复制富文本</button><button id="copyPlain" class="action" type="button" disabled>复制纯文本</button><button id="undo" class="action" type="button" disabled>撤销移除</button><button id="restore" class="action" type="button" disabled>恢复全部</button><span id="count" class="count"></span></div>
          <div class="load-row"><span id="status" class="status" role="status" aria-live="polite"></span><button id="stop" class="action" type="button" hidden>停止加载</button><button id="resume" class="action" type="button" hidden>继续加载</button></div>
          <progress id="progress" aria-label="分页加载进度" value="0" max="1"></progress>
          <div id="scroll" class="scroll" tabindex="0" role="region" aria-label="帖子正文与回复"><div id="topic"></div><div class="section-label">讨论回复</div><div id="replies"></div><div id="empty" class="empty"></div></div>
          <section id="copyFallback" class="fallback" hidden><div class="fallback-label"><label for="copyText" class="grow">纯文本已选中，可按 Ctrl+C / ⌘C 复制</label><button id="closeFallback" class="action" type="button">收起</button></div><textarea id="copyText" readonly spellcheck="false"></textarea></section>
          <footer class="footer"><span><i class="footer-dot"></i>移除仅影响本次阅读与复制</span><a id="original" target="_blank" rel="noopener noreferrer">查看原帖 ↗</a></footer>
        </section><div id="toast" class="toast" role="status" hidden></div>
      </div>`;
    document.body.append(host);
    ui = Object.fromEntries(qa('[id]', shadow).map(node => [node.id, node])); ui.original.href = topicURL;
    ui.launcher.addEventListener('click', openReader); ui.close.addEventListener('click', closeReader);
    ui.stop.addEventListener('click', () => state.controller?.abort()); ui.resume.addEventListener('click', loadPages);
    ui.copyRich.addEventListener('click', () => copyContent(true)); ui.copyPlain.addEventListener('click', () => copyContent(false));
    ui.undo.addEventListener('click', undoRemoval); ui.restore.addEventListener('click', restoreAll);
    ui.replies.addEventListener('click', event => { const button = event.target.closest('[data-remove]'); if (button) removeReply(button.dataset.remove); });
    ui.closeFallback.addEventListener('click', () => { ui.copyFallback.hidden = true; ui.copyPlain.focus(); });
    ui.overlay.addEventListener('click', event => { if (event.target === ui.overlay) closeReader(); });
    shadow.addEventListener('keydown', event => {
      if (!state.opened) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeReader(); return; }
      if (event.key !== 'Tab') return;
      const focusable = qa('button:not(:disabled),a[href],textarea,[tabindex="0"],summary', ui.panel).filter(node => node.getClientRects().length && !node.closest('[hidden]'));
      const index = focusable.indexOf(shadow.activeElement);
      if (event.shiftKey && index <= 0) { event.preventDefault(); focusable.at(-1)?.focus(); }
      else if (!event.shiftKey && (index < 0 || index === focusable.length - 1)) { event.preventDefault(); focusable[0]?.focus(); }
    });
    updateControls();
  }

  mount();
})();
