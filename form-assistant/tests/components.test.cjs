const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const esbuild = require('esbuild');
const script = fs.readFileSync(path.join(__dirname, '..', 'form-assistant.user.js'), 'utf8');
const ctl = (p, id) => p.locator(`#tfa-host-v1 #${id}`);
let browser, bundle;
before(async () => {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  bundle = (await esbuild.build({ entryPoints: [path.join(__dirname, 'fixtures/components.jsx')], bundle: true, write: false, outdir: 'out', define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles;
});
after(async () => { await browser?.close(); });
async function setup(t, config) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(6000);
  page.on('pageerror', e => errors.push(e.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  await context.addInitScript(config => {
    window.fixtureConfig = config; window.gm = {};
    window.GM_getValue = (key, fallback) => window.gm[key] ?? fallback;
    window.GM_setValue = (key, value) => { window.gm[key] = value; };
    window.GM_registerMenuCommand = () => {};
  }, config);
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.endsWith('.js') || url.endsWith('.css')) { const file = bundle.find(f => f.path.endsWith(url.endsWith('.js') ? '.js' : '.css')); return route.fulfill({ body: Buffer.from(file.contents), contentType: url.endsWith('.js') ? 'text/javascript' : 'text/css' }); }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>组件回归</title><link rel="stylesheet" href="/fixture.css"><style>body{padding:35px}form{width:700px}label,output{display:block;margin:20px 0}input[type=file]{display:block;margin:20px 0}</style><main><div id="fixture"></div></main><script src="/fixture.js"></script>' });
  });
  await page.goto('http://localhost/components'); await page.locator('#editor input:not([type=file])').first().waitFor();
  await page.addScriptTag({ content: script });
  await ctl(page, 'launcher').click(); await ctl(page, 'openSettings').click();
  return page;
}
async function run(page, id = 'quickFill') {
  await ctl(page, id).click();
  await page.waitForFunction(() => document.getElementById('tfa-host-v1').shadowRoot.getElementById('quickFill').dataset.busy === 'false', null, { timeout: 45000 });
}
const model = async page => JSON.parse(await page.locator('#model').textContent());
const results = page => ctl(page, 'results').textContent();
async function success(page, skipped = 1) { assert.equal(await ctl(page, 'stats').textContent(), `成功 1 · 跳过 ${skipped} · 检查 0 · 失败 0`, `${await results(page)}; model=${JSON.stringify(await model(page))}`); assert.equal(await page.evaluate(() => window.submitted), false); }
async function fixed(page, value) {
  await ctl(page, 'fieldDetails').evaluate(n => { n.open = true; });
  const field = page.locator('#tfa-host-v1 .field').filter({ has: page.getByText('测试字段', { exact: true }) });
  await field.locator('.mode').selectOption('fixed'); await field.locator('.fixed').fill(value);
}
async function energyRule(page, label, mode, value) {
  await ctl(page, 'fieldDetails').evaluate(n => { n.open = true; });
  const field = page.locator('#tfa-host-v1 .field').filter({ has: page.getByText(label, { exact: true }) });
  await field.locator('.mode').selectOption(mode);
  if (value != null) await field.locator('.fixed').fill(value);
}

for (const action of ['quickFill', 'fill']) {
  test(`Ant energy table: ${action} replans reused pending inputs after calculation mode changes`, async t => {
    const page = await setup(t, { library: 'ant', kind: 'energy' });
    await page.evaluate(() => { window.originalEnergy = document.getElementById('energy-0-0'); });
    await energyRule(page, '计算方式', 'fixed', '实物量核算法');
    if (action === 'fill') await ctl(page, 'overwrite').check();
    await run(page, action);
    const value = await model(page);
    assert.equal(value.mode, 'physical');
    assert.equal(await page.evaluate(() => window.originalEnergy === document.getElementById('energy-0-0')), true);
    assert.equal(Object.keys(value.amounts).length, 10, await results(page));
    assert(Object.values(value.amounts).every(n => typeof n === 'number' && Number.isFinite(n)));
    assert.equal(await ctl(page, 'stats').textContent(), '成功 11 · 跳过 0 · 检查 0 · 失败 0', await results(page));
    assert.match(await results(page), /甲区 净购入火电（万千瓦时）/);
    assert.equal(await page.evaluate(() => window.submitted), false);
    await run(page, 'undo');
    assert.equal((await model(page)).mode, 'standard');
    assert(Object.values((await model(page)).amounts).every(n => n == null), await results(page));
  });
}

test('Ant energy table does not transfer fixed rules across units or refill a repurposed template entry', async t => {
  const page = await setup(t, { library: 'ant', kind: 'energy' });
  await energyRule(page, '计算方式', 'skip');
  await energyRule(page, '甲区 净购入火电（吨标准煤）', 'fixed', '12.3400');
  await run(page); // Keep the initial calculation mode for the template.
  await energyRule(page, '计算方式', 'fixed', '实物量核算法');
  await run(page);
  assert.match(await results(page), /甲区 净购入火电（吨标准煤） — 控件标签或用途已变化/);
  const assignments = await page.evaluate(() => window.changes);
  const switched = assignments.findLastIndex(change => change.mode === 'physical');
  assert(!assignments.slice(switched + 1).some(change => change.key === '0-0'), JSON.stringify(assignments));

  await ctl(page, 'templateDetails').evaluate(n => { n.open = true; });
  await ctl(page, 'save').click();
  await page.waitForFunction(() => JSON.parse(window.gm['tfa.database.v1']).templates.length === 1);
  // Store a template whose upstream choice changes the unit of its downstream entries.
  await page.evaluate(() => {
    const db = JSON.parse(window.gm['tfa.database.v1']);
    db.templates[0].fields.find(f => f.descriptor.kind === 'radio').value = { value: 'standard', text: '折标量核算法' };
    window.gm['tfa.database.v1'] = JSON.stringify(db);
  });
  // Reinitialize in a fresh page so the userscript reads the saved template normally.
  const store = await page.evaluate(() => window.gm);
  await page.reload();
  await page.evaluate(store => { window.gm = store; }, store);
  await page.locator('#energy-0-0').waitFor();
  await page.getByRole('radio', { name: '实物量核算法', exact: true }).check();
  await page.addScriptTag({ content: script });
  await ctl(page, 'launcher').click(); await ctl(page, 'openSettings').click();
  await ctl(page, 'templateDetails').evaluate(n => { n.open = true; });
  await ctl(page, 'overwrite').check(); await run(page, 'replay');
  assert.equal((await model(page)).mode, 'standard');
  assert.equal((await model(page)).amounts['0-0'], undefined, await results(page));
  assert.match(await results(page), /标签或用途已变化/);
});

test('Ant numeric precision padding is accepted, but an actual value reset still fails', async t => {
  for (const resetNumbers of [false, true]) {
    const page = await setup(t, { library: 'ant', kind: 'energy', resetNumbers });
    await energyRule(page, '计算方式', 'skip');
    await energyRule(page, '甲区 净购入火电（吨标准煤）', 'fixed', '12.34');
    await energyRule(page, '甲区 非化石能源消耗占比（%）', 'fixed', '0.5');
    await run(page);
    assert.equal((await model(page)).amounts['0-0'], resetNumbers ? 7 : 12.34);
    assert.equal(await page.locator('#energy-0-0').inputValue(), resetNumbers ? '7.0000' : '12.3400');
    assert.equal(await page.locator('#share-0').inputValue(), resetNumbers ? '7.00' : '0.50');
    if (resetNumbers) assert.match(await results(page), /甲区 净购入火电（吨标准煤） — 值被页面重置或转换/);
    else assert.equal(await ctl(page, 'stats').textContent(), '成功 10 · 跳过 1 · 检查 0 · 失败 0', await results(page));
  }
});

for (const library of ['ant', 'el']) {
  test(`${library} Chinese datetime confirmation commits the selected value`, async t => {
    const page = await setup(t, { library, kind: 'datetime', chinese: true, readonly: true });
    await run(page); await success(page); assert(await model(page));
    await run(page, 'undo'); assert.equal(await model(page), null, await results(page));
  });
  for (const kind of ['date', 'year', 'month', 'range', 'datetime', 'datetimerange', 'time']) {
    test(`${library} ${kind}: auto commits framework model and undo clears it`, async t => {
      const page = await setup(t, { library, kind, readonly: true, limited: kind === 'date' });
      await run(page); await success(page); const value = await model(page);
      assert(value && (!Array.isArray(value) || value.every(Boolean)), JSON.stringify(value));
      if (kind === 'date') assert.equal(new Date(value).getDate(), 15);
      if (Array.isArray(value)) assert(new Date(value[0]) <= new Date(value[1]));
      await run(page, 'undo'); assert.equal(await model(page), null, await results(page));
    });
  }
  for (const kind of ['cascader', 'tree']) {
    test(`${library} ${kind}: auto chooses an enabled leaf and restores empty`, async t => {
      const page = await setup(t, { library, kind, lazy: kind === 'cascader', expanded: kind === 'tree' });
      await run(page); await success(page); const value = await model(page);
      const leaf = Array.isArray(value) ? value.at(-1) : value;
      assert(['aa', 'ab', 'ba', 'bb'].includes(leaf), JSON.stringify(value));
      await run(page, 'undo'); assert([null, undefined].includes(await model(page)) || (await model(page)).length === 0, await results(page));
    });
    test(`${library} ${kind}: full paths disambiguate names and multiple selections commit`, async t => {
      const page = await setup(t, { library, kind, multiple: true });
      await fixed(page, '甲省 / 同名市,乙省 / 乙市'); await run(page); await success(page);
      assert.deepEqual(await model(page), kind === 'cascader' ? [['a', 'ab'], ['b', 'ba']] : ['ab', 'ba']);
    });
  }
  for (const kind of ['date', 'year', 'month', 'range', 'datetime', 'datetimerange', 'time']) {
    test(`${library} ${kind}: fixed values commit and restore the previous model`, async t => {
      const value = kind === 'time' ? '14:25:36' : kind === 'year' ? '2024' : kind === 'month' ? '2026-05' : kind === 'range' ? '2026-05-03,2026-06-08' : kind === 'datetimerange' ? '2026-05-03 14:25:36,2026-06-08 18:10:22' : kind === 'datetime' ? '2026-05-03 14:25:36' : '2026-05-03';
      const initial = kind.endsWith('range') ? ['2026-04-02', '2026-04-05'] : '2026-04-02T09:10:11';
      const page = await setup(t, { library, kind, readonly: true, initial }); const before = await model(page);
      await fixed(page, value); await run(page); await success(page); assert.notDeepEqual(await model(page), before);
      await run(page, 'undo');
      assert.match(await ctl(page, 'stats').textContent(), /成功 1.*失败 0/, await results(page));
      // Date-only pickers legitimately normalize the time component on restoration.
      const shown = await page.locator('#editor input:not([type=file])').evaluateAll(ns => ns.map(n => n.value));
      assert(shown[0].startsWith(kind === 'time' ? '09:10:11' : kind === 'year' ? '2026' : kind === 'month' ? '2026-04' : '2026-04-02'), JSON.stringify(shown));
    });
  }
  for (const kind of ['date', 'cascader', 'tree']) {
    test(`${library} ${kind}: disabled controls stay unchanged`, async t => {
      const page = await setup(t, { library, kind, disabled: true }); await run(page);
      assert.equal(await model(page), null); assert.equal(await page.evaluate(() => window.changes.length), 0);
      assert.match(await ctl(page, 'toastMessage').textContent(), /没有可填写/);
    });
  }
  test(`${library} date: a forbidden fixed date is not reported as a success`, async t => {
    const page = await setup(t, { library, kind: 'date', readonly: true, limited: true });
    await fixed(page, '2026-05-03'); await run(page);
    assert.equal(await model(page), null); assert.match(await ctl(page, 'stats').textContent(), /成功 0.*失败 1/, await results(page));
  });
  for (const kind of ['cascader', 'tree']) {
    test(`${library} ${kind}: ambiguous labels fail before changing the model`, async t => {
      const page = await setup(t, { library, kind }); await fixed(page, '同名市'); await run(page);
      assert.equal(await model(page), null); assert.equal(await page.evaluate(() => window.changes.length), 0);
      assert.match(await results(page), /歧义/);
    });
    test(`${library} ${kind}: template replay and undo preserve multiple selections`, async t => {
      const page = await setup(t, { library, kind, multiple: true });
      await fixed(page, '甲省 / 甲市,乙省 / 乙市'); await run(page); await success(page);
      const saved = await model(page);
      await ctl(page, 'templateDetails').evaluate(n => { n.open = true; }); await ctl(page, 'save').click();
      await page.waitForFunction(() => JSON.parse(window.gm['tfa.database.v1']).templates.length === 1);
      const backup = await page.evaluate(() => ({ format: 'test-form-assistant', schema: 1, templates: JSON.parse(window.gm['tfa.database.v1']).templates }));
      assert.equal(backup.templates[0].fields[0].descriptor.kind, kind);
      await run(page, 'undo'); assert(!await model(page) || (await model(page)).length === 0, await results(page));
      await ctl(page, 'overwrite').check(); await run(page, 'replay'); await success(page, 0); assert.deepEqual(await model(page), saved);
      await fixed(page, '甲省 / 同名市'); await run(page); await success(page);
      await run(page, 'undo'); assert.deepEqual(await model(page), saved, await results(page));
    });
  }
  test(`${library} cascader: cancellation during lazy loading prevents a late selection`, async t => {
    const page = await setup(t, { library, kind: 'cascader', lazy: true, delay: 1200 });
    await ctl(page, 'quickFill').click();
    await page.waitForFunction(() => window.lazyLoads.some(v => v === 'a' || v === 'b'));
    await ctl(page, 'quickFill').click();
    await page.waitForFunction(() => document.getElementById('tfa-host-v1').shadowRoot.getElementById('quickFill').dataset.busy === 'false');
    await page.waitForTimeout(1400); assert.equal(await model(page), null); assert.match(await results(page), /停止/);
  });
  test(`${library} date range: exported values import and replay through the component`, async t => {
    const page = await setup(t, { library, kind: 'range' });
    await run(page); await success(page); const saved = await model(page);
    await ctl(page, 'templateDetails').evaluate(n => { n.open = true; }); await ctl(page, 'save').click();
    await page.waitForFunction(() => JSON.parse(window.gm['tfa.database.v1']).templates.length === 1);
    const backup = await page.evaluate(() => ({ format: 'test-form-assistant', schema: 1, templates: JSON.parse(window.gm['tfa.database.v1']).templates }));
    assert.equal(backup.templates[0].fields[0].descriptor.kind, 'picker');
    assert.equal(backup.templates[0].fields[0].value.length, 2);
    await run(page, 'undo'); assert.equal(await model(page), null);
    await ctl(page, 'moreDetails').evaluate(n => { n.open = true; });
    await ctl(page, 'importFile').setInputFiles({ name: 'dates.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(() => JSON.parse(window.gm['tfa.database.v1']).templates.length === 2);
    const id = await page.evaluate(() => JSON.parse(window.gm['tfa.database.v1']).templates.at(-1).id);
    await ctl(page, 'templates').selectOption(id); await run(page, 'replay'); await success(page, 0);
    assert.deepEqual(await model(page), saved);
  });
}

test('Ant cascader parent tags can be saved and replayed with the default grouping', async t => {
  const page = await setup(t, { library: 'ant', kind: 'cascader', multiple: true, grouped: true });
  await fixed(page, '甲省 / 甲市,甲省 / 同名市'); await run(page); await success(page);
  assert.match(await page.locator('#editor .ant-select-selection-item').textContent(), /甲省/);
  const saved = await model(page);
  await fixed(page, '乙省 / 乙市'); await run(page); await success(page);
  await run(page, 'undo'); assert.deepEqual(await model(page), saved, await results(page));
});

test('existing unrelated picker panels and their inputs are not operated on', async t => {
  const page = await setup(t, { library: 'ant', kind: 'date' });
  await page.evaluate(() => {
    const popup = document.createElement('div'); popup.id = 'unrelated'; popup.className = 'ant-picker-dropdown'; popup.setAttribute('role', 'dialog');
    popup.innerHTML = '<input value="保留"><table><tbody><tr><td class="ant-picker-cell ant-picker-cell-in-view">1</td></tr></tbody></table>';
    document.querySelector('main').append(popup); window.unrelatedClicks = 0;
    popup.addEventListener('click', () => window.unrelatedClicks++);
  });
  await run(page); await success(page);
  assert.equal(await page.locator('#unrelated input').inputValue(), '保留'); assert.equal(await page.evaluate(() => window.unrelatedClicks), 0);
  assert.equal(await page.locator('#tfa-host-v1 .field').count(), 2);
});
