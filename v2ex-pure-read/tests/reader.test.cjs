const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const script = fs.readFileSync(path.join(__dirname, '..', 'v2ex-pure-read.user.js'), 'utf8');
const base = 'https://www.v2ex.com/t/123';
const control = (page, id) => page.locator(`#vpr-host #${id}`);
let browser;

before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

function fixture(page = 1, total = 1, options = {}) {
  const replies = options.replies ?? [page * 2 - 1, page * 2];
  return `<!doctype html><html><head><meta charset="utf-8"><title>示例讨论</title><style>body{font:14px sans-serif;padding:30px;overflow:auto}hr{border:7px solid red}</style></head><body>
    <button id="outside">网页按钮</button><aside id="alreadyInert" inert>原有禁用区</aside><hr id="outsideHr">
    <main id="Main"><div class="box"><div class="header"><h1>${options.title || '一起把阅读体验做得更好'}</h1><div id="topic_123_votes"></div><small><a href="/member/alice">alice</a> · <span title="2026-10-27 10:00:00 +08:00">刚刚</span></small></div>
    <div class="topic_content">${options.body ?? '<p>一篇关于阅读体验的讨论。</p><pre><code>const reader = true;\n  console.log(reader);</code></pre><blockquote>保留内容本来的结构。</blockquote><a class="page_normal" href="?p=9999">正文里的页码链接</a>'}</div>
    <div class="subtle"><span>第 1 条附言 · <span title="2026-10-27 11:00:00 +08:00">稍后</span></span><div class="topic_content">附言中的补充说明。</div></div></div>
    ${total > 1 ? `<div class="pagination"><a class="page_current" href="?p=${page}">${page}</a><a class="page_normal" href="?p=${total}">${total}</a><input class="page_input" value="${page}" max="${total}"></div>` : ''}
    <div class="box">${replies.map(n => `<div class="cell" id="r_${1000 + n}"><span class="no">${n}</span><strong><a href="/member/user${n}">user${n}</a></strong><span class="ago" title="2026-10-27 12:00:00 +08:00">刚刚</span><div class="reply_content">回复内容 ${n}<br>第二行 ${n}</div></div>`).join('')}</div></main></body></html>`;
}

async function setup(t, { initial = 1, total = 1, pages = {}, viewport = { width: 1280, height: 900 } } = {}) {
  const context = await browser.newContext({ viewport });
  const errors = [], requests = [];
  await context.addInitScript(() => {
    window.copied = []; window.clipboardMode = 'ok';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      write: async items => {
        if (window.clipboardMode !== 'ok') throw new DOMException('Denied', 'NotAllowedError');
        const result = {};
        for (const type of items[0].types) result[type] = await (await items[0].getType(type)).text();
        window.copied.push(result);
      },
      writeText: async value => {
        if (window.clipboardMode === 'denied') throw new DOMException('Denied', 'NotAllowedError');
        window.copied.push({ 'text/plain': value });
      }
    } });
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'https://www.v2ex.com' || url.pathname !== '/t/123') { await route.abort(); return; }
    const number = Number(url.searchParams.get('p') || 1);
    const isFetch = request.resourceType() === 'fetch';
    if (isFetch) requests.push(number);
    let response = pages[number] ?? fixture(number, total);
    if (typeof response === 'function') response = await response({ isFetch, requests });
    const result = typeof response === 'string' ? { body: response } : response;
    await route.fulfill({ contentType: 'text/html; charset=utf-8', ...result }).catch(() => {});
  });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, [], 'no uncaught page errors'); });
  await page.goto(`${base}?p=${initial}`); await page.addScriptTag({ content: script });
  return { page, requests, context };
}

async function phase(page, expected) {
  await page.waitForFunction(value => document.getElementById('vpr-host').shadowRoot.getElementById('status').dataset.phase === value, expected);
}
async function open(page) { await control(page, 'launcher').click(); }
async function copied(page) {
  await page.waitForFunction(() => window.copied.length > 0);
  return page.evaluate(() => window.copied.at(-1));
}

test('single page retains plain body, supplements and code; unsafe markup stays inert', async t => {
  const { page, requests } = await setup(t, { pages: { 1: fixture(1, 1, {
    title: '&lt;img src=x onerror=alert(1)&gt; 字面标题',
    body: '<p>直接正文<a href="/go/programmer">节点</a></p><img src="/image.png" onerror="window.unsafe = true"><a href="javascript:alert(1)">危险链接</a><pre><code>  a &lt; b\n  c()</code></pre>'
  }) } });
  await open(page); await phase(page, 'complete');
  assert.match(await control(page, 'topic').textContent(), /直接正文/);
  assert.equal(await page.locator('#vpr-host .supplement').count(), 1);
  assert.equal(await page.locator('#vpr-host h1 img').count(), 0);
  assert.equal(await page.locator('#vpr-host .prose [onerror],#vpr-host .prose [onclick]').count(), 0);
  assert.equal(await page.locator('#vpr-host .prose a').last().getAttribute('href'), null);
  assert.equal(await page.locator('#vpr-host .prose a').first().getAttribute('href'), 'https://www.v2ex.com/go/programmer');
  assert.equal(await page.locator('#vpr-host .prose img').getAttribute('src'), 'https://www.v2ex.com/image.png');
  assert.equal(await page.locator('#vpr-host pre code').textContent(), '  a < b\n  c()');
  assert.equal(await page.locator('#outsideHr').evaluate(node => getComputedStyle(node).borderTopWidth), '7px');
  assert.deepEqual(requests, []);
});

test('pagination merges in order, deduplicates reply IDs and ignores content links', async t => {
  const { page, requests } = await setup(t, { total: 2, pages: { 2: fixture(2, 2, { replies: [2, 3] }) } });
  await open(page); await phase(page, 'complete');
  assert.deepEqual(requests, [2]);
  assert.deepEqual(await page.locator('#vpr-host .reply-card .floor').allTextContents(), ['1 楼', '2 楼', '3 楼']);
  assert.match(await control(page, 'count').textContent(), /保留 3 条/);
});

test('opening from a later page starts with page one', async t => {
  const { page, requests } = await setup(t, { initial: 2, total: 2 });
  await open(page); await phase(page, 'complete');
  assert.deepEqual(requests, [1, 2]);
  assert.deepEqual(await page.locator('#vpr-host .reply-card .floor').allTextContents(), ['1 楼', '2 楼', '3 楼', '4 楼']);
});

test('HTTP failure preserves partial results and retries only the unfinished page', async t => {
  let attempts = 0;
  const { page, requests } = await setup(t, { total: 2, pages: { 2: () => ++attempts === 1 ? { status: 503, body: 'Unavailable' } : fixture(2, 2) } });
  await open(page); await phase(page, 'error');
  assert.match(await control(page, 'status').textContent(), /503/);
  await control(page, 'copyPlain').click(); assert.match((await copied(page))['text/plain'], /仅包含已加载的 1 页/);
  await page.locator('#vpr-host .remove').first().click();
  await control(page, 'resume').click(); await phase(page, 'complete');
  assert.deepEqual(requests, [2, 2]);
  assert.match(await control(page, 'count').textContent(), /保留 3 条 · 已移除 1 条/);
});

test('stop cancels a pending fetch and resume preserves loaded replies', async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = new Promise(resolve => { started = resolve; });
  let attempt = 0;
  const { page, requests } = await setup(t, { total: 2, pages: { 2: async () => {
    if (++attempt === 1) { started(); await gate; } return fixture(2, 2);
  } } });
  t.after(() => release());
  await open(page); await pending; await control(page, 'stop').click(); await phase(page, 'paused');
  assert.equal(await page.locator('#vpr-host .reply-card').count(), 2);
  release(); await control(page, 'resume').click(); await phase(page, 'complete');
  assert.deepEqual(requests, [2, 2]);
  assert.equal(await page.locator('#vpr-host .reply-card').count(), 4);
});

test('reply removal, undo and restore affect only the reader and both clipboard formats', async t => {
  const { page } = await setup(t);
  await open(page); await phase(page, 'complete');
  await page.locator('#vpr-host .remove').first().click(); await control(page, 'copyRich').click();
  const result = await copied(page);
  assert(result['text/html'] && result['text/plain']);
  assert(!result['text/html'].includes('回复内容 1')); assert(result['text/html'].includes('回复内容 2'));
  assert(!result['text/html'].includes('data-remove')); assert(!result['text/plain'].includes('移除'));
  const richText = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').body.textContent, result['text/html']);
  assert.match(richText, /2 楼 · user2 · 2026/);
  assert.equal(await page.locator('#Main #r_1001').count(), 1);
  await control(page, 'undo').click(); assert.equal(await page.locator('#vpr-host .reply-card:visible').count(), 2);
  await page.locator('#vpr-host .remove').first().click(); await page.locator('#vpr-host .remove:visible').click();
  assert.match(await control(page, 'empty').textContent(), /移除所有回复/);
  await control(page, 'restore').click(); assert.equal(await page.locator('#vpr-host .reply-card:visible').count(), 2);
  await control(page, 'close').click(); await open(page); assert.equal(await page.locator('#vpr-host .reply-card').count(), 2);
});

test('clipboard failures fall back to plain text and then selected manual copy', async t => {
  const { page } = await setup(t); await open(page); await phase(page, 'complete');
  await page.evaluate(() => { window.clipboardMode = 'plain-only'; });
  await control(page, 'copyRich').click(); assert((await copied(page))['text/plain']);
  assert.match(await control(page, 'toast').textContent(), /纯文本/);
  await page.evaluate(() => { window.clipboardMode = 'denied'; });
  await control(page, 'copyPlain').click(); await control(page, 'copyText').waitFor();
  assert.match(await control(page, 'copyText').inputValue(), /回复内容 1/);
  assert(await control(page, 'copyText').evaluate(node => node.selectionStart === 0 && node.selectionEnd === node.value.length));
});

test('empty discussions and unrecognized login pages give distinct results', async t => {
  const first = await setup(t, { pages: { 1: fixture(1, 1, { body: '', replies: [] }) } });
  await open(first.page); await phase(first.page, 'complete');
  assert.match(await control(first.page, 'empty').textContent(), /暂时没有回复/);
  assert.equal(await control(first.page, 'copyPlain').isEnabled(), true);
  const second = await setup(t, { total: 2, pages: { 2: '<!doctype html><h1>Sign in</h1><input type="password">' } });
  await open(second.page); await phase(second.page, 'error');
  assert.match(await control(second.page, 'status').textContent(), /登录状态/);
  assert.equal(await second.page.locator('#vpr-host .reply-card').count(), 2);
});

test('wrong-page responses are rejected instead of duplicated', async t => {
  const { page, requests } = await setup(t, { total: 2, pages: { 2: fixture(1, 2) } });
  await open(page); await phase(page, 'error');
  assert.match(await control(page, 'status').textContent(), /返回了第 1 页/);
  assert.deepEqual(requests, [2]); assert.equal(await page.locator('#vpr-host .reply-card').count(), 2);
});

test('single mount, focus trap, Esc and scroll restoration work across repeated opens', async t => {
  const { page } = await setup(t); await page.addScriptTag({ content: script });
  await page.evaluate(() => document.documentElement.style.setProperty('overflow-x', 'clip', 'important'));
  assert.equal(await page.locator('#vpr-host').count(), 1);
  await open(page); await phase(page, 'complete');
  assert.equal(await page.locator('body').evaluate(node => node.style.overflow), 'hidden');
  assert.equal(await page.locator('#Main').evaluate(node => node.inert), true);
  await control(page, 'original').focus(); await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.getElementById('vpr-host').shadowRoot.activeElement.id), 'close');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.getElementById('vpr-host').shadowRoot.activeElement.id), 'original');
  await page.keyboard.press('Escape');
  assert.equal(await control(page, 'overlay').isVisible(), false);
  assert.equal(await page.locator('body').evaluate(node => node.style.overflow), '');
  assert.equal(await page.locator('html').evaluate(node => node.style.getPropertyValue('overflow-x')), 'clip');
  assert.equal(await page.locator('html').evaluate(node => node.style.getPropertyPriority('overflow-x')), 'important');
  assert.equal(await page.locator('html').evaluate(node => node.style.getPropertyValue('overflow-y')), '');
  assert.equal(await page.locator('#Main').evaluate(node => node.inert), false);
  assert.equal(await page.locator('#alreadyInert').evaluate(node => node.inert), true);
  assert.equal(await page.evaluate(() => document.getElementById('vpr-host').shadowRoot.activeElement.id), 'launcher');
  await open(page); assert.equal(await page.locator('#vpr-host .panel').count(), 1);
});

test('closing during loading aborts work; reopening can continue', async t => {
  const { page, requests } = await setup(t, { total: 2 });
  await open(page); await control(page, 'close').click(); await phase(page, 'paused');
  await new Promise(resolve => setTimeout(resolve, 450)); assert.deepEqual(requests, []);
  await open(page); await control(page, 'resume').click(); await phase(page, 'complete');
  assert.deepEqual(requests, [2]);
});

test('docked label and narrow screens remain usable without horizontal overflow', async t => {
  const { page } = await setup(t, { viewport: { width: 390, height: 844 }, pages: { 1: fixture(1, 1, { body: `<pre><code>${'veryLongCode'.repeat(100)}</code></pre><p>${'内容'.repeat(80)}</p>` }) } });
  assert.equal(await page.locator('#vpr-host .launch-label').evaluate(node => getComputedStyle(node).opacity), '0');
  await control(page, 'launcher').focus();
  await page.waitForFunction(() => getComputedStyle(document.getElementById('vpr-host').shadowRoot.querySelector('.launch-label')).opacity === '1');
  await page.keyboard.press('Enter'); await phase(page, 'complete');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const rect = await control(page, 'panel').boundingBox(); assert(rect.x >= 0 && rect.x + rect.width <= width);
    assert(await control(page, 'scroll').evaluate(node => node.scrollWidth <= node.clientWidth));
    assert(await control(page, 'close').isVisible()); assert(await control(page, 'copyRich').isVisible());
  }
});

test('pagination bounds excessive page counts', async t => {
  const { page } = await setup(t, { total: 100000 });
  await open(page); assert.equal(await control(page, 'progress').getAttribute('max'), '200');
  await control(page, 'stop').click(); await phase(page, 'paused');
});

test('request timeout releases controls and preserves the loaded page', async t => {
  let started, release;
  const pending = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { page } = await setup(t, { total: 2, pages: { 2: async () => { started(); await gate; return fixture(2, 2); } } });
  t.after(() => release());
  await page.clock.install(); await open(page); await page.clock.runFor(400); await pending;
  await page.clock.runFor(15100); await phase(page, 'error');
  assert.match(await control(page, 'status').textContent(), /超过 15 秒/);
  assert.equal(await control(page, 'resume').isEnabled(), true);
  assert.equal(await page.locator('#vpr-host .reply-card').count(), 2);
  release();
});

test('fetched markup cannot add handlers or active embeds to the reader', async t => {
  const bad = fixture(2, 2).replace('回复内容 3', '<script>window.injected = true</script><iframe src="https://evil.example"></iframe><svg onload="window.injected = true"></svg><img src="/image.png" onerror="window.injected = true"><a href="javascript:window.injected=true" onclick="window.injected=true">只保留文字</a>');
  const { page } = await setup(t, { total: 2, pages: { 2: bad } });
  await open(page); await phase(page, 'complete');
  assert.equal(await page.evaluate(() => window.injected), undefined);
  assert.equal(await page.locator('#vpr-host .reply-card script,#vpr-host .reply-card iframe,#vpr-host .reply-card svg,#vpr-host .reply-card [onclick],#vpr-host .reply-card [onerror]').count(), 0);
  assert.match(await control(page, 'replies').textContent(), /只保留文字/);
});
