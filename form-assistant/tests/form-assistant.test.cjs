const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const script = fs.readFileSync(path.join(__dirname, '..', 'form-assistant.user.js'), 'utf8');
const INLINE = 'tfa.inline-enabled.v1', DATABASE = 'tfa.database.v1';
const ctl = (page, id) => page.locator(`#tfa-host-v1 #${id}`);
const input = (page, name) => page.locator(`[name="${name}"]`);
let browser;
before(async () => { browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true }); });
after(async () => { await browser?.close(); });

function fixture(content = '') {
  return `<!doctype html><meta charset="utf-8"><title>资料编辑</title><style>body{font:14px sans-serif;background:#f6f8fc;padding:35px}main{max-width:680px}form{background:white;padding:18px;border-radius:12px}label{display:block;margin:12px 0}input:not([type=checkbox]):not([type=radio]),select,textarea{width:300px;padding:7px}textarea{height:60px}dialog{position:fixed;left:50px;top:50px;width:560px;background:white;z-index:100}</style>
    <main>${content || `<form id="editor"><h1>项目资料</h1><label>项目名称<input name="project" value="原项目"></label><label>说明<textarea name="notes">原说明</textarea></label><label>数量<input name="quantity" type="number" min="1" max="100000" value="5"></label><label>城市<select name="city"><option value="a">甲城</option><option value="b">乙城</option><option value="c">丙城</option></select></label><button type="submit">保存</button></form>`}</main>`;
}

async function setup(t, options = {}) {
  const store = new Map(Object.entries(options.store || {})), pages = new Set(), errors = [], writes = [];
  let failInline = false, writeDelay = 0;
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, hasTouch: !!options.touch });
  await context.exposeBinding('__gmRead', (_, key, fallback) => store.has(key) ? store.get(key) : fallback);
  await context.exposeBinding('__gmWrite', async ({ page: sender }, key, value) => {
    if (key === INLINE && failInline) throw new Error('模拟存储失败');
    if (writeDelay && key === DATABASE) await new Promise(resolve => setTimeout(resolve, writeDelay));
    const previous = store.get(key); store.set(key, value); writes.push({ key, value });
    await Promise.all([...pages].filter(page => !page.isClosed()).map(page => page.evaluate(({ key, previous, value, remote }) => {
      for (const listener of window.__valueListeners || []) if (listener.key === key) listener.fn(key, previous, value, remote);
    }, { key, previous, value, remote: page !== sender }).catch(() => {})));
  });
  await context.addInitScript(({ listen }) => {
    window.__valueListeners = []; window.menuCommands = {};
    window.GM_getValue = (key, fallback) => window.__gmRead(key, fallback);
    window.GM_setValue = (key, value) => window.__gmWrite(key, value);
    if (listen) window.GM_addValueChangeListener = (key, fn) => window.__valueListeners.push({ key, fn });
    window.GM_registerMenuCommand = (label, fn) => { window.menuCommands[label] = fn; };
    window.submitted = false;
    document.addEventListener('submit', event => { event.preventDefault(); window.submitted = true; });
  }, { listen: options.listen !== false });
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html;charset=utf-8', body: fixture(options.content) }));
  async function openPage(url = 'http://localhost/editor') {
    const page = await context.newPage(); pages.add(page); page.on('pageerror', error => errors.push(error.message));
    await page.goto(url); await page.addScriptTag({ content: script }); await page.locator('#tfa-host-v1').waitFor();
    return page;
  }
  t.after(async () => { await context.close(); assert.deepEqual(errors, [], 'no uncaught page errors'); });
  return { context, openPage, store, writes, failWrites: value => { failInline = value; }, delayWrites: value => { writeDelay = value; } };
}

async function reveal(page) {
  if (await ctl(page, 'quickBar').isHidden()) await ctl(page, 'launcher').dispatchEvent('click');
  await ctl(page, 'quickBar').waitFor();
}
async function settings(page) {
  await reveal(page);
  if (await ctl(page, 'panel').isHidden()) await ctl(page, 'openSettings').click();
}
async function idle(page) {
  await page.waitForFunction(() => document.getElementById('tfa-host-v1').shadowRoot.getElementById('quickFill').dataset.busy === 'false');
}
async function run(page, id = 'quickFill') { await ctl(page, id).click(); await idle(page); }
async function expand(page, id) { if (!await ctl(page, id).evaluate(node => node.open)) await ctl(page, id).locator('summary').first().click(); }
async function values(page) { return page.evaluate(() => [...document.querySelectorAll('#editor input,#editor textarea,#editor select')].map(node => node.type === 'checkbox' ? node.checked : node.value)); }
function row(page, label) { return page.locator('#tfa-host-v1 .field').filter({ has: page.getByText(label, { exact: true }) }); }

test('collapsed entry only reveals three controls; settings leaves the toolbar available', async t => {
  const env = await setup(t), page = await env.openPage(); const before = await values(page);
  assert(await ctl(page, 'quickBar').isHidden()); assert(await ctl(page, 'panel').isHidden());
  await ctl(page, 'launcher').click(); await ctl(page, 'quickBar').waitFor();
  assert.deepEqual(await values(page), before); assert(await ctl(page, 'panel').isHidden());
  assert.equal(await ctl(page, 'quickFillLabel').textContent(), '整表重填');
  assert.equal(await ctl(page, 'openSettings').textContent(), '⚙填表设置');
  assert.equal(await ctl(page, 'globalInline').isChecked(), false);
  await ctl(page, 'openSettings').click(); assert(await ctl(page, 'panel').isVisible()); assert(await ctl(page, 'quickBar').isVisible());
  assert.equal(await ctl(page, 'openSettings').getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('#tfa-host-v1 #panelInline').count(), 0);
  await ctl(page, 'openSettings').click(); assert(await ctl(page, 'panel').isHidden());
});

test('quick refill changes populated values each time, leaves panel options and seed intact, and restores', async t => {
  const env = await setup(t), page = await env.openPage(); const before = await values(page);
  await reveal(page); assert.equal(await ctl(page, 'overwrite').isChecked(), false);
  await run(page); const first = await values(page);
  assert(first.slice(0, 3).every((value, index) => value !== before[index]));
  assert(await ctl(page, 'panel').isHidden()); assert.equal(await ctl(page, 'seed').inputValue(), '1');
  assert.equal(await ctl(page, 'overwrite').isChecked(), false);
  await run(page); const second = await values(page);
  assert(second.slice(0, 3).every((value, index) => value !== first[index]));
  assert(await ctl(page, 'toastUndo').isVisible());
  await run(page, 'toastUndo'); assert.deepEqual(await values(page), first);
  assert.equal(await page.evaluate(() => window.submitted), false);
});

test('panel fill preserves nonempty fields and can reproduce a fixed seed', async t => {
  const env = await setup(t), page = await env.openPage(); const before = await values(page);
  await settings(page); await run(page, 'fill'); assert.deepEqual(await values(page), before);
  await ctl(page, 'overwrite').check(); await run(page, 'fill'); const first = await values(page);
  await run(page, 'fill'); assert.deepEqual(await values(page), first);
  await run(page); assert.notDeepEqual(await values(page), first);
  await run(page, 'fill'); assert.deepEqual(await values(page), first);
});

test('fresh refill honors numeric, fixed and skipped rules', async t => {
  const env = await setup(t), page = await env.openPage(); await settings(page);
  await expand(page, 'fieldDetails');
  await row(page, '项目名称').locator('.mode').selectOption('fixed'); await row(page, '项目名称').locator('.fixed').fill('固定项目');
  await row(page, '说明').locator('.mode').selectOption('skip');
  await row(page, '数量').locator('.mode').selectOption('number');
  await row(page, '数量').locator('.num-min').fill('42'); await row(page, '数量').locator('.num-max').fill('42');
  await run(page);
  assert.equal(await input(page, 'project').inputValue(), '固定项目');
  assert.equal(await input(page, 'notes').inputValue(), '原说明'); assert.equal(await input(page, 'quantity').inputValue(), '42');
  await run(page); assert.equal(await input(page, 'quantity').inputValue(), '42');
});

test('refill targets the top form and excludes searches, sensitive, disabled and readonly fields', async t => {
  const content = '<form role="search"><input name="query" value="查询词"><button>查询</button></form><form id="background"><input name="background" value="后台"></form><dialog open><form id="editor"><label>标题<input name="title" value="旧标题"></label><label>密码<input type="password" name="password" value="保密"></label><label>锁定<input name="locked" value="不变" readonly></label><label>禁用<input name="disabled" value="不变" disabled></label><label>网页搜索<input name="search" type="search" value="搜索"></label></form></dialog>';
  const env = await setup(t, { content }), page = await env.openPage(); await reveal(page); await run(page);
  assert.notEqual(await input(page, 'title').inputValue(), '旧标题');
  for (const [name, value] of [['query', '查询词'], ['background', '后台'], ['password', '保密'], ['locked', '不变'], ['disabled', '不变'], ['search', '搜索']]) assert.equal(await input(page, name).inputValue(), value);
});

test('stored inline preference is shared across sites, tabs, reloads and new pages', async t => {
  const env = await setup(t), a = await env.openPage(), b = await env.openPage('http://test.local/editor');
  const before = await values(a); await reveal(a); await ctl(a, 'globalInline').check();
  await b.waitForFunction(() => document.getElementById('tfa-host-v1').shadowRoot.getElementById('globalInline').checked);
  assert.equal(env.store.get(INLINE), true); assert.deepEqual(await values(a), before);
  await a.locator('#tfa-host-v1 .field-dice').first().waitFor(); await b.locator('#tfa-host-v1 .field-dice').first().waitFor();
  await a.reload(); await a.addScriptTag({ content: script }); await a.locator('#tfa-host-v1 .field-dice').first().waitFor();
  assert.equal(await ctl(a, 'globalInline').isChecked(), true);
  const c = await env.openPage('http://localhost:5174/another'); await c.locator('#tfa-host-v1 .field-dice').first().waitFor();
  await reveal(b); await ctl(b, 'globalInline').uncheck();
  await a.waitForFunction(() => !document.getElementById('tfa-host-v1').shadowRoot.getElementById('globalInline').checked);
  assert.equal(await a.locator('#tfa-host-v1 .field-dice').count(), 0);
  assert.equal(await ctl(c, 'globalInline').isChecked(), false);
});

test('hiding a site never changes the shared inline preference', async t => {
  const env = await setup(t, { store: { [INLINE]: true } }), a = await env.openPage(), b = await env.openPage('http://test.local/editor');
  await a.locator('#tfa-host-v1 .field-dice').first().waitFor();
  await a.evaluate(() => window.menuCommands['本站隐藏助手（记住选择）']());
  assert.equal(env.store.get(INLINE), true); assert(await ctl(a, 'dock').isHidden());
  assert.equal(await a.locator('#tfa-host-v1 .field-dice').count(), 0); assert.equal(await ctl(b, 'globalInline').isChecked(), true);
  await a.evaluate(() => window.menuCommands['本站恢复默认（仅本地 / 局域网显示）']());
  await a.locator('#tfa-host-v1 .field-dice').first().waitFor();
  const hidden = await env.openPage('https://public.example/editor');
  assert(await ctl(hidden, 'dock').isHidden()); assert.equal(await hidden.locator('#tfa-host-v1 .field-dice').count(), 0);
  assert.equal(await ctl(hidden, 'globalInline').isChecked(), true);
});

test('global toggles do not validate or overwrite unsaved page settings', async t => {
  const env = await setup(t), a = await env.openPage(), b = await env.openPage('http://test.local/editor');
  await settings(a); await ctl(a, 'textSettings').locator('.text-min').fill('bad');
  await ctl(a, 'globalInline').check(); assert.equal(env.store.get(INLINE), true);
  assert.equal(await ctl(a, 'textSettings').locator('.text-min').inputValue(), 'bad');
  await reveal(b); await ctl(b, 'globalInline').uncheck();
  await a.waitForFunction(() => !document.getElementById('tfa-host-v1').shadowRoot.getElementById('globalInline').checked);
  assert.equal(await ctl(a, 'textSettings').locator('.text-min').inputValue(), 'bad');
});

test('storage write failure restores the checkbox and successful focus sync works without listeners', async t => {
  const env = await setup(t, { listen: false }), page = await env.openPage(); await reveal(page); env.failWrites(true);
  await ctl(page, 'globalInline').click();
  await page.waitForFunction(() => document.getElementById('tfa-host-v1').shadowRoot.getElementById('toastMessage').textContent.includes('模拟存储失败'));
  assert.equal(await ctl(page, 'globalInline').isChecked(), false);
  env.failWrites(false); env.store.set(INLINE, true); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('#tfa-host-v1 .field-dice').first().waitFor(); assert.equal(await ctl(page, 'globalInline').isChecked(), true);
});

test('a second click stops preparation rather than starting a concurrent refill', async t => {
  const env = await setup(t), page = await env.openPage(); await reveal(page); env.delayWrites(1000);
  const before = await values(page);
  await ctl(page, 'quickFill').click(); assert.equal(await ctl(page, 'quickFillLabel').textContent(), '停止填写');
  await ctl(page, 'quickFill').click(); await idle(page);
  assert.deepEqual(await values(page), before);
  assert.equal(env.writes.filter(write => write.key === DATABASE).length, 1);
  assert.match(await ctl(page, 'toastMessage').textContent(), /已停止/);
});

test('stopping midway keeps the original snapshot and undo restores completed changes', async t => {
  const content = '<form id="editor">' + Array.from({ length: 14 }, (_, i) => `<label>字段 ${i}<input name="item${i}" value="原值${i}"></label>`).join('') + '</form>';
  const env = await setup(t, { content }), page = await env.openPage(); await reveal(page); const before = await values(page);
  await ctl(page, 'quickFill').click();
  await page.waitForFunction(() => document.querySelector('[name=item0]').value !== '原值0');
  await ctl(page, 'quickFill').click(); await idle(page);
  const stopped = await values(page); assert.notDeepEqual(stopped, before); assert(stopped.some((value, i) => value === before[i]));
  await run(page, 'toastUndo'); assert.deepEqual(await values(page), before);
});

test('pending online generation preserves manual changes and respects a new top dialog', { timeout: 15000 }, async t => {
  const env = await setup(t), page = await env.openPage(); await settings(page);
  await ctl(page, 'textSettings').locator('.text-mode').selectOption('online');
  let respond, started;
  const gate = new Promise(resolve => { respond = resolve; });
  const request = new Promise(resolve => { started = resolve; });
  await page.route('https://v1.hitokoto.cn/**', async route => {
    started(); await gate;
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ hitokoto: '在线文案' }) }).catch(() => {});
  });
  t.after(() => respond());
  await ctl(page, 'quickFill').click(); await request;
  await input(page, 'project').fill('手动保留');
  await page.evaluate(() => { const dialog = document.createElement('dialog'); dialog.open = true; dialog.innerHTML = '<form><label>新表单<input name="newDialog" value="新表单原文"></label></form>'; document.body.append(dialog); });
  respond(); await idle(page);
  assert.equal(await input(page, 'project').inputValue(), '手动保留');
  assert.equal(await input(page, 'notes').inputValue(), '原说明');
  assert.equal(await input(page, 'newDialog').inputValue(), '新表单原文');
});

test('new conditional fields are filled within the same batch', async t => {
  const env = await setup(t, { content: '<form id="editor"><label>标题<input name="title" value="原题"></label></form>' }), page = await env.openPage();
  await page.evaluate(() => document.querySelector('[name=title]').addEventListener('input', () => {
    if (document.querySelector('[name=conditional]')) return;
    const label = document.createElement('label'); label.textContent = '联动字段';
    const input = document.createElement('input'); input.name = 'conditional'; label.append(input); document.getElementById('editor').append(label);
  }));
  await reveal(page); await run(page); assert((await input(page, 'conditional').inputValue()).length > 0);
});

test('invalid settings keep values and last undo snapshot intact; saved preferences survive reload', async t => {
  const env = await setup(t), page = await env.openPage(); const original = await values(page);
  await settings(page); const config = ctl(page, 'textSettings');
  await config.locator('.text-min').fill('7'); await config.locator('.text-max').fill('7');
  await run(page); assert.equal((await input(page, 'project').inputValue()).length, 7); const filled = await values(page);
  await config.locator('.text-min').fill('99'); await run(page);
  assert.deepEqual(await values(page), filled); assert.match(await ctl(page, 'toastMessage').textContent(), /操作失败/);
  await config.locator('.text-min').fill('7'); await run(page, 'undo'); assert.deepEqual(await values(page), original);
  await page.reload(); await page.addScriptTag({ content: script }); await page.locator('#tfa-host-v1').waitFor();
  await reveal(page); await run(page); assert.equal((await input(page, 'project').inputValue()).length, 7);
});

test('single-field dice updates one field and supports recovery', async t => {
  const env = await setup(t, { store: { [INLINE]: true } }), page = await env.openPage(); const before = await values(page);
  const dice = page.getByRole('button', { name: '随机填写：项目名称', exact: true }); await dice.waitFor(); await dice.click(); await idle(page);
  const after = await values(page); assert.notEqual(after[0], before[0]); assert.deepEqual(after.slice(1), before.slice(1));
  await run(page, 'toastUndo'); assert.deepEqual(await values(page), before);
});

test('checkbox refill changes boolean values and undo preserves later manual edits', async t => {
  const content = '<form id="editor"><label>说明<input name="description" value="原文"></label><label>启用<input name="enabled" type="checkbox" checked></label></form>';
  const env = await setup(t, { content }), page = await env.openPage(); await reveal(page); await run(page);
  assert.equal(await input(page, 'enabled').isChecked(), false);
  await input(page, 'description').fill('之后的手工修改');
  await run(page, 'toastUndo'); assert.equal(await input(page, 'enabled').isChecked(), true);
  assert.equal(await input(page, 'description').inputValue(), '之后的手工修改');
});

test('touch and keyboard expansion work at 320px and the settings panel leaves room for the bar', async t => {
  const env = await setup(t, { viewport: { width: 320, height: 740 }, touch: true }), page = await env.openPage(); const before = await values(page);
  await ctl(page, 'launcher').tap(); await ctl(page, 'quickBar').waitFor(); assert.deepEqual(await values(page), before);
  const bar = await ctl(page, 'quickBar').boundingBox(); assert(bar.x >= 0 && bar.x + bar.width <= 320);
  await ctl(page, 'openSettings').tap();
  const panel = await ctl(page, 'panel').boundingBox(); assert(panel.y + panel.height <= bar.y);
  await ctl(page, 'close').tap(); await page.locator('h1').tap();
  assert(await ctl(page, 'quickBar').isHidden());
  for (let i = 0; i < 8 && await ctl(page, 'quickBar').isHidden(); i++) await page.keyboard.press('Tab');
  await ctl(page, 'quickBar').waitFor();
  assert.equal(await page.evaluate(() => document.getElementById('tfa-host-v1').shadowRoot.activeElement.id), 'openSettings');
});

test('template save and cross-site import still replay the recorded values', async t => {
  const env = await setup(t), source = await env.openPage(), original = await values(source);
  await settings(source); await expand(source, 'templateDetails'); await ctl(source, 'save').click();
  await source.waitForFunction(() => document.getElementById('tfa-host-v1').shadowRoot.getElementById('templateCount').textContent === '1 份');
  const templates = JSON.parse(env.store.get(DATABASE)).templates;
  const target = await env.openPage('http://test.local/editor'); await settings(target); await expand(target, 'moreDetails'); await ctl(target, 'importCurrentSite').check();
  await ctl(target, 'importFile').setInputFiles({ name: 'templates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'test-form-assistant', schema: 1, templates })) });
  await target.waitForFunction(() => document.getElementById('tfa-host-v1').shadowRoot.getElementById('templateCount').textContent === '1 份');
  await run(target); await expand(target, 'templateDetails'); await ctl(target, 'overwrite').check(); await run(target, 'replay');
  assert.deepEqual(await values(target), original);
});

// The live page uses plain div captions and anonymous Ant Design number inputs.
// Deliberately different class names ensure recognition does not depend on that app.
const decimalHint = '请输入普通十进制数';
function decimalField(label, value = '1.5') {
  return `<div class="custom-cell-a94"><div class="caption-b37">${label}</div><div class="ant-input-number"><input role="spinbutton" aria-valuemin="0.0001" aria-valuemax="9999999999.9999" step="0.0001" placeholder="${decimalHint}" value="${value}"></div></div>`;
}
function economicForm(labels = ['工业总产值（亿元）', '工业增加值（亿元）']) {
  return `<div id="editor"><div><h2>经济数据</h2></div><div class="body-c42"><div class="layout-d56">${labels.map((label, i) => decimalField(label, `${i + 1}.5`)).join('')}</div></div></div>`;
}
function oldDescriptor(overrides = {}) {
  return { kind: 'number', type: 'text', name: '', id: '', testid: '', label: decimalHint, context: '', placeholder: decimalHint, ...overrides };
}
function oldKey(descriptor) {
  let hash = 2166136261;
  for (const char of JSON.stringify(descriptor)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(36);
}
function oldDatabase(rules = {}, templates = [], scope = 'body') {
  return { [DATABASE]: JSON.stringify({ schema: 1, rules: { [`http://localhost/editor::${scope}`]: rules }, settings: {}, templates }) };
}
function oldTemplate(descriptors, values) {
  return { id: 'legacy-template', name: '已有模板', page: { origin: 'http://localhost', path: '/editor', title: '资料编辑' }, scope: 'body', fields: descriptors.map((descriptor, index) => ({ descriptor, value: values[index] })) };
}
async function fieldNames(page) { return page.locator('#tfa-host-v1 .field-name').allTextContents(); }

test('custom div captions distinguish equal placeholders for fill, rules, dice, locate and undo', async t => {
  const env = await setup(t, { content: economicForm(), store: { [INLINE]: true } }), page = await env.openPage();
  const original = await values(page), controls = page.locator('#editor input');
  await page.locator('#tfa-host-v1 .field-dice').first().waitFor();
  assert.equal(await page.locator('#tfa-host-v1 .field-dice').count(), 2);
  assert.deepEqual(await fieldNames(page), ['工业总产值（亿元）', '工业增加值（亿元）']);
  await settings(page); await expand(page, 'fieldDetails');
  assert.deepEqual(await page.locator('#tfa-host-v1 .field .meta').allTextContents(), ['经济数据', '经济数据']);
  const rows = page.locator('#tfa-host-v1 .field');
  assert.notEqual(await rows.nth(0).getAttribute('data-key'), await rows.nth(1).getAttribute('data-key'));
  await rows.nth(1).locator('.locate').click();
  assert.match(await controls.nth(1).getAttribute('style'), /outline/); assert.equal(await controls.nth(0).getAttribute('style'), null);
  for (let i = 0; i < 2; i++) {
    await rows.nth(i).locator('.mode').selectOption('fixed'); await rows.nth(i).locator('.fixed').fill(String((i + 1) * 101));
  }
  await run(page); assert.deepEqual(await values(page), ['101', '202']);
  await run(page, 'undo'); assert.deepEqual(await values(page), original);
  await rows.nth(1).locator('.random-one').click(); await idle(page);
  assert.deepEqual(await values(page), [original[0], '202']);
  await run(page, 'undo'); assert.deepEqual(await values(page), original);
  await page.reload(); await page.addScriptTag({ content: script }); await page.locator('#tfa-host-v1').waitFor();
  await reveal(page); await run(page); assert.deepEqual(await values(page), ['101', '202']);
});

test('unlabelled duplicates use independent live controls and session rules without exporting ambiguous identities', async t => {
  const content = '<form id="editor"><div><input placeholder="请输入" value="甲"></div><div><input placeholder="请输入" value="乙"></div></form>';
  const env = await setup(t, { content, store: { [INLINE]: true } }), page = await env.openPage();
  await page.locator('#tfa-host-v1 .field-dice').first().waitFor();
  assert.equal(await page.locator('#tfa-host-v1 .field-dice').count(), 2);
  await page.locator('#tfa-host-v1 .field-dice').nth(1).click({ button: 'right' });
  assert.equal(await page.evaluate(() => document.getElementById('tfa-host-v1').shadowRoot.activeElement.closest('.field').dataset.key), await page.locator('#tfa-host-v1 .field').nth(1).getAttribute('data-key'));
  await settings(page); await expand(page, 'fieldDetails'); const rows = page.locator('#tfa-host-v1 .field');
  assert.equal(await rows.count(), 2); assert.match(await rows.nth(1).locator('.rule-warning').textContent(), /仅当前控件/);
  await rows.nth(1).locator('.locate').click(); assert.equal(await page.locator('#editor input').nth(0).getAttribute('style'), null);
  for (let i = 0; i < 2; i++) { await rows.nth(i).locator('.mode').selectOption('fixed'); await rows.nth(i).locator('.fixed').fill(['单独甲', '单独乙'][i]); }
  await run(page); assert.deepEqual(await values(page), ['单独甲', '单独乙']);
  await run(page, 'undo'); assert.deepEqual(await values(page), ['甲', '乙']);
  await ctl(page, 'close').click();
  await page.locator('#tfa-host-v1 .field-dice').nth(1).click(); await idle(page); assert.deepEqual(await values(page), ['甲', '单独乙']);
  await settings(page);
  await expand(page, 'templateDetails'); await ctl(page, 'save').click();
  assert.match(await ctl(page, 'toastMessage').textContent(), /没有可可靠保存/);
  const db = JSON.parse(env.store.get(DATABASE)); assert.deepEqual(db.templates, []); assert.deepEqual(db.rules['http://localhost/editor::editor'], {});
  await page.reload(); await page.addScriptTag({ content: script }); await page.locator('#tfa-host-v1').waitFor();
  assert.deepEqual(await page.locator('#tfa-host-v1 .field .mode').evaluateAll(nodes => nodes.map(node => node.value)), ['auto', 'auto']);
});

test('unlabelled duplicates can be refreshed normally without saved rules', async t => {
  const env = await setup(t, { content: '<form id="editor"><div><input placeholder="备注" value="甲"></div><div><input placeholder="备注" value="乙"></div></form>' }), page = await env.openPage();
  await reveal(page); await run(page); const filled = await values(page);
  assert.notEqual(filled[0], '甲'); assert.notEqual(filled[1], '乙'); assert.notEqual(filled[0], filled[1]);
  await run(page, 'toastUndo'); assert.deepEqual(await values(page), ['甲', '乙']);
});

test('nearby labels respect ARIA, exclude help text, and do not merge multiple controls', async t => {
  const content = '<form id="editor"><div><div>本地标签</div><input name="explicit" aria-label="明确标签"></div><div><div>实际名称</div><span class="help-text">填写说明</span><div><input name="help"></div></div><div><div hidden>隐藏名称</div><input name="hidden" placeholder="备用名称"></div><div><div>共用行标题</div><input placeholder="同一提示"><input placeholder="同一提示"></div><div class="form-group"><div><div>甲字段</div><input></div><div><div>乙字段</div><input></div></div></form>';
  const env = await setup(t, { content }), page = await env.openPage();
  assert.deepEqual(await fieldNames(page), ['明确标签', '实际名称', '备用名称', '同一提示', '同一提示', '甲字段', '乙字段']);
});

test('custom section headings separate otherwise equal fields across template replay and DOM reorder', async t => {
  const content = `<div id="editor"><div class="block-a"><div><h2>甲组</h2></div><div>${decimalField('金额', '10')}</div></div><div class="block-b"><div><h2>乙组</h2></div><div>${decimalField('金额', '20')}</div></div></div>`;
  const env = await setup(t, { content }), page = await env.openPage(); await settings(page); await expand(page, 'templateDetails'); await ctl(page, 'save').click();
  await page.waitForFunction(() => document.getElementById('tfa-host-v1').shadowRoot.getElementById('templateCount').textContent === '1 份');
  await page.evaluate(() => { const root = document.getElementById('editor'); root.prepend(root.lastElementChild); });
  await run(page); await ctl(page, 'overwrite').check(); await run(page, 'replay');
  assert.equal(await page.locator('.block-a input').inputValue(), '10'); assert.equal(await page.locator('.block-b input').inputValue(), '20');
});

test('a unique legacy rule migrates while the original opaque entry remains intact', async t => {
  const desc = oldDescriptor(), key = oldKey(desc), rule = { mode: 'fixed', value: '37.25' };
  assert.equal(key, 'xom12e');
  const env = await setup(t, { content: economicForm(['工业总产值（亿元）']), store: oldDatabase({ [key]: rule }) }), page = await env.openPage();
  await reveal(page); await run(page); assert.deepEqual(await values(page), ['37.25']);
  const rules = JSON.parse(env.store.get(DATABASE)).rules['http://localhost/editor::body'];
  assert.deepEqual(rules[key], rule);
  assert(Object.values(rules).some(rule => rule.descriptor?.label === '工业总产值（亿元）' && rule.value === '37.25'));
  await settings(page); await expand(page, 'fieldDetails'); await row(page, '工业总产值（亿元）').locator('.mode').selectOption('auto');
  await run(page); assert.notEqual((await values(page))[0], '37.25');
  await page.reload(); await page.addScriptTag({ content: script }); await page.locator('#tfa-host-v1').waitFor();
  assert.equal(await page.locator('#tfa-host-v1 .field .mode').inputValue(), 'auto');
});

test('a colliding legacy rule is preserved and reported without applying it to either new field', async t => {
  const key = oldKey(oldDescriptor()), legacy = { mode: 'fixed', value: '999' };
  const env = await setup(t, { content: economicForm(), store: oldDatabase({ [key]: legacy }) }), page = await env.openPage();
  await settings(page); await expand(page, 'fieldDetails');
  assert.match(await ctl(page, 'ruleHint').textContent(), /1 条已有规则/);
  assert.deepEqual(await page.locator('#tfa-host-v1 .field .mode').evaluateAll(nodes => nodes.map(node => node.value)), ['auto', 'auto']);
  const before = await values(page); await run(page); assert.deepEqual(await values(page), before);
  assert.deepEqual(JSON.parse(env.store.get(DATABASE)).rules['http://localhost/editor::body'][key], legacy);
  await row(page, '工业增加值（亿元）').locator('.mode').selectOption('fixed'); await row(page, '工业增加值（亿元）').locator('.fixed').fill('202');
  await run(page); assert.equal((await values(page))[1], '202'); assert.notEqual((await values(page))[0], '202');
});

test('unmatched opaque legacy rules are retained with a visible compatibility notice', async t => {
  const old = { mode: 'skip', value: '' };
  const env = await setup(t, { content: economicForm(), store: oldDatabase({ obsoleteHash: old }) }), page = await env.openPage();
  await settings(page); await expand(page, 'fieldDetails'); assert(await ctl(page, 'ruleHint').isVisible());
  await run(page); assert.deepEqual(JSON.parse(env.store.get(DATABASE)).rules['http://localhost/editor::body'].obsoleteHash, old);
});

test('legacy templates still match a unique placeholder through the original descriptor', async t => {
  const template = oldTemplate([oldDescriptor()], ['72.5']);
  const env = await setup(t, { content: economicForm(['工业总产值（亿元）']), store: oldDatabase({}, [template]) }), page = await env.openPage();
  await settings(page); await expand(page, 'templateDetails'); await ctl(page, 'overwrite').check(); await run(page, 'replay');
  assert.deepEqual(await values(page), ['72.5']);
  assert.equal(await page.evaluate(() => window.submitted), false);
});

test('ambiguous legacy templates never assign values by DOM order', async t => {
  const template = oldTemplate([oldDescriptor(), oldDescriptor()], ['123', '456']);
  const env = await setup(t, { content: economicForm(), store: oldDatabase({}, [template]) }), page = await env.openPage(); const before = await values(page);
  await settings(page); await expand(page, 'templateDetails'); await ctl(page, 'overwrite').check(); await run(page, 'replay');
  assert.deepEqual(await values(page), before); assert.match(await ctl(page, 'results').textContent(), /存在多个同名字段/);
  assert.deepEqual(JSON.parse(env.store.get(DATABASE)).templates, [template]);
});

test('generated React IDs are excluded from new identities while legacy rules migrate before IDs change', async t => {
  const desc = oldDescriptor({ kind: 'text', type: 'text', id: '«r1r»', label: '原提示', placeholder: '原提示' });
  const content = '<form id="editor"><div><div>业务名称</div><input id="«r1r»" placeholder="原提示" value="原值"></div></form>';
  const env = await setup(t, { content, store: oldDatabase({ [oldKey(desc)]: { mode: 'fixed', value: '兼容固定值' } }, [], 'editor') }), page = await env.openPage();
  await reveal(page); await run(page); assert.deepEqual(await values(page), ['兼容固定值']);
  const rules = JSON.parse(env.store.get(DATABASE)).rules['http://localhost/editor::editor'];
  const modern = Object.values(rules).find(rule => rule.descriptor); assert.equal(modern.descriptor.id, ''); assert.equal(modern.descriptor.label, '业务名称');
  await settings(page); await expand(page, 'templateDetails'); await ctl(page, 'save').click();
  await page.waitForFunction(() => document.getElementById('tfa-host-v1').shadowRoot.getElementById('templateCount').textContent === '1 份');
  await page.evaluate(() => { const field = document.querySelector('#editor input'); field.id = '«r9z»'; field.value = '重绘原值'; });
  await run(page); assert.deepEqual(await values(page), ['兼容固定值']);
  await page.locator('#editor input').fill('其他值'); await ctl(page, 'overwrite').check(); await run(page, 'replay'); assert.deepEqual(await values(page), ['兼容固定值']);
});

test('unique replacement nodes keep pending fills and undo mapped to the correct business label', async t => {
  const env = await setup(t, { content: economicForm() }), page = await env.openPage(); const original = await values(page);
  await page.evaluate(() => {
    const [first, second] = document.querySelectorAll('#editor input');
    first.addEventListener('input', () => second.replaceWith(second.cloneNode(true)), { once: true });
  });
  await reveal(page); await run(page); const filled = await values(page);
  assert(filled.every((value, i) => value !== original[i]));
  await page.evaluate(() => document.querySelectorAll('#editor input').forEach(node => { const copy = node.cloneNode(true); copy.value = node.value; node.replaceWith(copy); }));
  await run(page, 'toastUndo'); assert.deepEqual(await values(page), original);
});

test('ambiguous replacement nodes are skipped and never treated as newly added fields', async t => {
  const content = '<form id="editor"><div><input placeholder="同名" value="甲"></div><div><input placeholder="同名" value="乙"></div></form>';
  const env = await setup(t, { content }), page = await env.openPage();
  await page.evaluate(() => {
    const [first, second] = document.querySelectorAll('#editor input');
    first.addEventListener('input', () => second.replaceWith(second.cloneNode(true)), { once: true });
  });
  await reveal(page); await run(page); const filled = await values(page);
  assert.notEqual(filled[0], '甲'); assert.equal(filled[1], '乙');
  assert.match(await ctl(page, 'results').textContent(), /原同名控件已被替换/);
  await run(page, 'toastUndo'); assert.deepEqual(await values(page), ['甲', '乙']);
});

test('undo does not transfer a removed duplicate snapshot to the surviving field', async t => {
  const content = '<form id="editor"><div><input placeholder="同名" value="甲"></div><div><input placeholder="同名" value="乙"></div></form>';
  const env = await setup(t, { content }), page = await env.openPage(); await reveal(page); await run(page);
  await page.evaluate(() => document.querySelectorAll('#editor input')[1].remove());
  await run(page, 'toastUndo'); assert.deepEqual(await values(page), ['甲']);
});

test('a reused DOM node with a changed business label is not written after asynchronous generation', { timeout: 20000 }, async t => {
  const content = '<form id="editor"><div><div class="caption">原业务字段</div><input value="原文"></div></form>';
  const env = await setup(t, { content }), page = await env.openPage(); await settings(page);
  await ctl(page, 'textSettings').locator('.text-mode').selectOption('online');
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), request = new Promise(resolve => { started = resolve; });
  t.after(() => release());
  await page.route('https://v1.hitokoto.cn/**', async route => { started(); await gate; await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ hitokoto: '在线文案' }) }).catch(() => {}); });
  await ctl(page, 'quickFill').click(); await request;
  await page.evaluate(() => { document.querySelector('.caption').textContent = '另一个业务字段'; }); release(); await idle(page);
  assert.deepEqual(await values(page), ['原文']); assert.match(await ctl(page, 'results').textContent(), /标签或用途已变化/);
});

test('legacy generated form IDs retain rules and generation preferences when moving to a stable scope', async t => {
  const desc = oldDescriptor({ kind: 'text', type: 'text', name: 'title', label: '标题', placeholder: '' });
  const store = oldDatabase({ [oldKey(desc)]: { mode: 'fixed', value: '旧规则' } }, [], '«r2a»');
  const db = JSON.parse(store[DATABASE]); db.settings['http://localhost/editor::«r2a»'] = { text: { mode: 'auto', minLength: '7', maxLength: '7' } }; store[DATABASE] = JSON.stringify(db);
  const content = '<div id="editor"><form id="«r2a»"><label>标题<input name="title" value="原文"></label><label>说明<input name="notes" value="原说明"></label></form></div>';
  const env = await setup(t, { content, store }), page = await env.openPage(); await reveal(page); await run(page);
  assert.equal(await input(page, 'title').inputValue(), '旧规则'); assert.equal((await input(page, 'notes').inputValue()).length, 7);
  const saved = JSON.parse(env.store.get(DATABASE));
  assert.deepEqual(saved.rules['http://localhost/editor::«r2a»'], db.rules['http://localhost/editor::«r2a»']);
  assert(saved.rules['http://localhost/editor::FORM']); assert.equal(saved.settings['http://localhost/editor::FORM'].text.minLength, '7');
});

test('custom radio group captions improve without changing legacy template option text', async t => {
  const desc = oldDescriptor({ kind: 'radio', type: 'radio', name: 'choice', label: 'choice', placeholder: '' });
  const template = oldTemplate([desc], [{ value: 'b', text: 'choice' }]);
  const content = '<form id="editor"><div><div>选择类型</div><div role="radiogroup"><input type="radio" name="choice" value="a" checked><input type="radio" name="choice" value="b"></div></div></form>';
  const env = await setup(t, { content, store: oldDatabase({}, [template], 'editor') }), page = await env.openPage();
  assert.deepEqual(await fieldNames(page), ['选择类型']);
  await settings(page); await expand(page, 'templateDetails'); await ctl(page, 'overwrite').check(); await run(page, 'replay');
  assert.equal(await page.locator('[name=choice][value=b]').isChecked(), true);
  assert.match(await ctl(page, 'stats').textContent(), /成功 1/);
  await run(page, 'undo'); assert.equal(await page.locator('[name=choice][value=a]').isChecked(), true);
});

test('Ant Design and Element Plus wrapper inputs count as one control for custom labels', async t => {
  const content = '<div id="editor"><div><h2>核算范围</h2></div><div><div><div>核算类型</div><div class="ant-select"><div class="ant-select-content"><span>归档</span><input role="combobox" type="search" id="«r1r»" readonly></div></div></div><div><div>周期类型</div><div class="el-select"><input role="combobox" readonly id="el-id-234"></div></div><div><div>年份</div><div class="ant-picker"><div class="ant-picker-input"><input readonly placeholder="请选择年份"></div></div></div></div></div>';
  const env = await setup(t, { content, store: { [INLINE]: true } }), page = await env.openPage();
  assert.deepEqual(await fieldNames(page), ['核算类型', '周期类型', '年份']);
  await page.locator('#tfa-host-v1 .field-dice').first().waitFor(); assert.equal(await page.locator('#tfa-host-v1 .field-dice').count(), 3);
  assert.equal(await row(page, '年份').locator('.reason:not(.rule-warning)').count(), 0);
});

test('a completely anonymous single control fills and keeps its rule local instead of saving an unusable template', async t => {
  const env = await setup(t, { content: '<form id="editor"><div><input value="原文"></div></form>' }), page = await env.openPage();
  await settings(page); await expand(page, 'fieldDetails');
  const field = page.locator('#tfa-host-v1 .field');
  assert.match(await field.locator('.rule-warning').textContent(), /仅当前控件/);
  await field.locator('.mode').selectOption('fixed'); await field.locator('.fixed').fill('临时固定值');
  await run(page); assert.deepEqual(await values(page), ['临时固定值']);
  await run(page, 'undo'); assert.deepEqual(await values(page), ['原文']);
  await expand(page, 'templateDetails'); await ctl(page, 'save').click();
  assert.match(await ctl(page, 'toastMessage').textContent(), /没有可可靠保存/);
  const db = JSON.parse(env.store.get(DATABASE)); assert.deepEqual(db.rules['http://localhost/editor::editor'], {}); assert.deepEqual(db.templates, []);
});
