// ==UserScript==
// @name         系统测试填表助手
// @namespace    https://github.com/bitlumen
// @version      1.3.0
// @description  三段快捷条：整表重填、填表设置、全局单项随机；支持模板、文本库与生成偏好。本地及局域网默认显示。
// @author       enthem
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';
  if (document.getElementById('tfa-host-v1')) return;
  const VERSION = '1.3.0';
  const STORAGE = 'tfa.database.v1';
  const SITE_STORAGE = 'tfa.site-visibility.v1';
  const LIBRARY_STORAGE = 'tfa.text-library.v1';
  const INLINE_STORAGE = 'tfa.inline-enabled.v1';
  const WRAP = '.el-form-item,.ant-form-item,.form-group,.form-item,[data-form-item],[data-field]';
  const COMBO = '.el-select,.ant-select:not(.ant-cascader),[role="combobox"]';
  const PICKER = '.el-date-editor,.ant-picker';
  const CASCADER = '.el-cascader,.ant-cascader';
  const TREE = '.el-tree-select,.ant-tree-select';
  const COMPONENT = `${PICKER},${CASCADER},${TREE}`;
  const POPUP = '.ant-picker-dropdown,.el-picker__popper,.el-picker-panel,.el-time-panel,.el-time-range-picker,.ant-select-dropdown,.ant-cascader-dropdown,.ant-cascader-menus,.el-cascader__dropdown,.el-select__popper,.el-select-dropdown';
  const CONTROL = 'input,textarea,select,[role="combobox"],[role="switch"],[role="checkbox"],[role="radio"],[contenteditable="true"],.el-select,.ant-select,.el-cascader,.el-tree-select,.el-date-editor,.ant-picker';
  const FORM = 'form,[role="form"],.el-form,.ant-form';
  const OVERLAY = 'dialog[open],[role="dialog"],[role="alertdialog"],[aria-modal="true"],.el-dialog,.ant-modal-content,.el-drawer,.ant-drawer-content';
  const SEARCH_AREA = 'search,[role="search"],.ant-pro-query-filter,.ant-pro-table-search,.ant-table-filter-dropdown,.el-table-filter,.search-form,.searchForm,.search-bar,.search-panel,.search-box,.filter-form,.filter-bar,.query-form,[data-search-form]';
  const TYPES = { text: '文本', textarea: '多行', number: '数字', select: '下拉', combo: '组件下拉', picker: '日期组件', cascader: '级联选择', tree: '树选择', radio: '单选组', checkbox: '复选', switch: '开关', date: '日期/时间', rich: '富文本', unsupported: '需适配' };
  const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim();
  const clean = v => norm(v).replace(/^[*＊\s]+|[:：*＊\s]+$/g, '');
  const arr = x => Array.from(x || []);
  const q = (sel, root = document) => root.querySelector(sel);
  const qa = (sel, root = document) => arr(root.querySelectorAll(sel));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  const isEmpty = v => v == null || v === '' || (Array.isArray(v) && !v.length) || v === false;
  let db = { schema: 1, templates: [], rules: {}, settings: {} };
  let siteModes = {};
  let fields = [], busy = false, cancelled = false, opened = false, reports = [], history = [];
  const nodeIds = new WeakMap(), sessionRules = new WeakMap();
  const emptyRules = Object.freeze({});
  let nextNodeId = 0, sessionRuleRevision = 0;
  let historyPage = '', historyRoot = null;
  let lastURL = location.href, lastPageKey = '', structureDirty = false, scopeDirty = true, activeRoot = null;
  const emptyRoot = document.createElement('div');
  let host, shadow, ui, renderedRuleKey = '', renderedRoot = null;
  let inlineEnabled = false, inlineFields = [], inlineFrame = 0, inlineRebuild = false;
  let inlineSaving = false, inlineRevision = 0;
  let dockPinned = false, dockTimer;
  let generationSession = { online: [], error: '' }, activeRequest = null, lastOnlineRequest = 0;
  let libraryText = '', libraryError = '', libraryCache = { source: null, pool: [] }, libraryImporting = false;
  let templateNameKey = '', templateNameRoot = null, templateNameAuto = true;
  const TEXT_MODES = { auto: '内置文本库 · 随机抽取拼接', library: '自定义文本库 · 随机抽取拼接', candidates: '自定义候选文案 · 每行一条', online: '在线短句 · 一言' };
  const TEXT_LIMIT = 10000;
  const LIBRARY_LIMIT = 500000, LIBRARY_FILE_LIMIT = 1024 * 1024;
  // Independent fragments, deliberately mixed without field-specific naming conventions.
  const TEXT_POOL = [...new Set(`
    星砂 云隙 薄雾 微光 晨露 晚霞 月影 日晕 流萤 雨丝 风铃 雪粒 霜花 露珠 虹桥 暖阳 暮色 夜幕 晴空 雷声 电光 云絮 天际 星河 雾海 蓝穹 余晖 冷月 晓风 朝云 暗香 浮光
    山岚 谷地 峰顶 岩层 石阶 河湾 溪涧 瀑影 海潮 沙洲 湖心 泉眼 岸线 礁石 岛屿 林间 原野 丘陵 旷野 湿地 冰原 雪岭 深潭 浅滩 沟壑 坡面 土丘 地平 远岫 海角 沙丘 洞口
    松针 竹叶 花瓣 枝桠 树梢 苔痕 藤蔓 绿芽 草籽 麦穗 稻浪 荷叶 蒲苇 芦花 青果 橡实 柳絮 榆荚 莲蓬 梅影 桂枝 梧桐 白桦 银杏 杉木 栗壳 枫红 野菊 木棉 蕨叶 芒草 香樟
    鸥翼 燕尾 鹤羽 雁阵 鹿角 狐影 蝉鸣 蛙声 鱼鳞 蝶翅 蜂巢 蚁径 蜗壳 贝纹 珊瑚 海螺 鸟巢 鸭绒 猫步 虎斑 豹纹 马蹄 熊掌 鹰眼 雀跃 蟹钳 螺旋 鳅影 萤火 鲸歌 豚跃 鳍尖
    雾蓝 浅青 墨绿 银白 绛紫 琥珀 朱砂 赭石 靛蓝 米黄 藕粉 炭灰 松绿 湖蓝 赤铜 雪白 暖橙 柠黄 烟紫 草绿 深蓝 珠光 宝蓝 鹅黄 秋褐 春碧 月白 黛青 铜绿 霞红 瓷白 金棕
    方格 圆环 三角 弧线 折线 网点 曲面 棱角 边框 轮廓 条纹 波纹 漩涡 颗粒 断面 切片 光斑 阴影 纹理 轴线 界面 层次 坐标 尺度 半径 直径 斜面 中轴 尖角 对角 刻度 零点
    书页 纸角 墨迹 笔尖 画框 印章 卷轴 信封 卡片 标签 书签 便笺 素描 稿纸 颜料 画笔 草图 题跋 装帧 折页 页眉 页脚 插图 摘录 注脚 目录 索引 印痕 留白 字迹 行距 段落
    木盒 铜扣 瓷盏 玻璃 石盘 竹篮 棉线 皮革 织锦 丝带 绒布 铁环 银匙 陶碗 漆器 贝扣 榫卯 铰链 纽扣 镜片 珠串 铃铛 刀鞘 齿轮 弹簧 杠杆 铆钉 缆绳 手柄 底座 滑轮 支架
    窗棂 门扉 廊檐 屋脊 墙角 台阶 栏杆 庭院 天井 阁楼 走廊 石桥 街巷 广场 码头 站台 路灯 招牌 圆拱 塔尖 亭柱 桥洞 舷窗 烟囱 灯塔 篱笆 回廊 地砖 窗帘 花架 隔板 扶手
    帆影 舟楫 车轮 轨道 航线 路标 隧道 弯道 岔口 里程 旅途 行囊 地图 指南 罗盘 舵盘 船锚 浮标 桨声 驿站 车厢 座椅 踏板 机翼 尾灯 前沿 后座 列队 远行 停泊 穿行 抵达
    晨间 午后 傍晚 深夜 初春 仲夏 晚秋 寒冬 昨日 明朝 瞬间 片刻 长昼 短夜 年轮 时序 秒针 时钟 沙漏 节拍 间歇 循环 轮转 更迭 清晨 正午 薄暮 夜半 岁末 月初 星移 光阴
    回响 轻吟 低语 颤音 和弦 旋律 节奏 音阶 琴弦 鼓点 笛音 钟声 风声 水声 雨声 潮声 脚步 呼吸 静默 鸣笛 余音 高音 低音 共鸣 弦外 听觉 乐谱 音符 变调 间奏 尾声 序曲
    温润 清凉 轻盈 柔软 坚实 细腻 粗糙 朦胧 明亮 暗淡 清透 厚重 疏朗 紧密 平滑 锋利 圆润 纤细 宽阔 窄小 高远 深邃 浅淡 丰盈 稀薄 绵密 松散 规整 参差 匀称 斑驳 洁净
    摇曳 漂浮 翻转 折叠 延展 收拢 舒展 旋转 滑行 漫游 徘徊 跳跃 穿梭 环绕 交汇 汇聚 分散 铺展 堆叠 流转 推移 弹跳 摆动 盘旋 悬停 落下 升起 沉入 伸展 卷起 展开 合拢
    东方 西岸 南坡 北岭 上方 下沿 左侧 右端 前方 后沿 内侧 外圈 中间 边缘 近处 远处 高处 低处 顶层 底部 中段 两端 彼岸 此间 四周 周边 邻侧 对岸 深处 尽头 起点 终点
    微粒 晶格 纤维 薄片 丝束 砂砾 尘埃 水滴 气泡 涟漪 波峰 波谷 频率 振幅 相位 脉冲 光谱 磁场 电荷 热流 气流 液面 密度 比例 容积 重量 形态 结构 序列 模式 样本 参数
    拼图 积木 方舟 沙盘 棋子 牌面 骰点 弹珠 秋千 风车 纸鸢 飞轮 迷宫 七巧 万花 盲盒 木马 滚筒 滑梯 轨迹 跳格 彩带 沙画 叠石 涂鸦 手作 编织 折纸 刺绣 雕刻 塑形 镶嵌 拓印
    麦香 茶烟 果皮 花蜜 米粒 豆荚 芝麻 杏仁 桃核 瓜瓤 柚瓣 橙片 桔络 椰壳 薯块 莲子 枣红 李青 梨白 葡紫 核桃 花生 松子 菱角 荸荠 山药 木耳 银耳 冰糖 蜂糖 清泉 露水
    开端 过程 结果 片段 章节 情节 路径 分支 线索 交点 联结 次序 层级 阶段 范围 标记 记录 版本 批次 节点 切换 排列 组合 分组 分类 映射 关联 对照 拓展 复用 更新 保留
    清醒 自在 悠然 宁静 沉稳 活泼 轻快 随意 新鲜 古朴 简洁 丰富 灵动 流畅 连续 交错 错落 均衡 对称 自然 偶然 有序 无序 稳定 变化 多样 单纯 复杂 细微 辽阔 开阔 深长
    秘径 空谷 幽林 古道 新枝 老树 野渡 荒台 孤峰 双桥 半岛 远帆 近水 高台 长廊 短亭 横塘 斜阳 疏雨 密林 叠嶂 群峰 浅溪 深港 宽河 窄桥 晓月 暮云 秋水 春山 冬雪 夏荷
    纸船 纸窗 纸灯 纸伞 纸鹤 木舟 木窗 木灯 木椅 木桌 木碗 石门 石窗 石凳 石磨 石刻 铜镜 铜铃 铜锁 铜壶 竹简 竹席 竹扇 竹筏 布袋 布鞋 布帘 布纹 丝绒 丝绢 丝绸 丝光
    一隅 一叶 一帧 一缕 一抹 一束 一弯 一层 两岸 双翼 三叠 四角 五色 六棱 七弦 八方 九曲 十里 百川 千帆 万象 半扇 满枝 零散 些许 少量 多重 数段 几何 偶数 奇数 等距 等分
    碎玉 流金 凝霜 铺锦 拾光 寻迹 问影 逐浪 听雨 观潮 望野 探溪 绕林 越岭 向远 归途 循径 入画 出岫 沿岸 临窗 倚栏 扶风 踏雪 穿云 过桥 临水 绕石 掠影 寻岸 藏锋 含章
    一 二 三 四 五 六 七 八 九 十 零 百 千 万 的 地 得 了 着 过 是 有 在 和 与 及 或 也 都 就 又 还 很 更 最 太 真 好 要 会 能 可 以 因 为 所 如 若 则 但 而 且 之 于 乎 者 也 吗 呢 吧 啊 哦 嗯 不 没 无 非 别 莫
    我 你 他 她 它 我们 这 那 此 其 谁 何 哪 什么 每 各 某 自 己 人 大 小 多 少 长 短 高 低 新 旧 早 晚 快 慢 轻 重 冷 热 干 湿 明 暗 红 黄 蓝 绿 白 黑 上 下 左 右 前 后 里 外 中 东 南 西 北 近 远 来 去 回 出 入 开 关 起 落 走 跑 跳 坐 站 躺 看 听 说 读 写 想 知 懂 学 问 答 做 用 拿 放 给 找 等 帮 把 被 对 从 到 向 往 离 跟 同 将 让 把 吃 喝 玩 乐 睡 醒 笑 哭 爱 喜 怕 忙 闲 生 活 家 门 窗 路 车 船 山 水 火 土 木 金 日 月 星 云 风 雨 雪 花 草 树 果 米 面 饭 菜 茶 肉 鱼 蛋 糖 盐 手 足 口 目 耳 心 头 身 书 笔 纸 字 画 灯 桌 椅 杯 碗 衣 鞋 钱 店 城 乡 年 季 天 时 分 秒 今 昨 明 春 夏 秋 冬 先 再 才 已 曾 正 常 总 只 全 半 满 空 些 点 次 个 本 张 条 片 只 座 件 双 对 杯 份
  `.trim().split(/\s+/))];
  const defaultSettings = () => ({ number: { mode: 'auto', min: '', max: '', decimals: '2' }, text: { mode: 'auto', candidates: '', minLength: '', maxLength: '' } });

  function localAddress(hostname) {
    const hostnameText = String(hostname).toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    const localV4 = text => {
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(text)) return false;
      const p = text.split('.').map(Number);
      if (p.some(n => n > 255)) return false;
      return text === '0.0.0.0' || p[0] === 127 || p[0] === 10 ||
        (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
        (p[0] === 192 && p[1] === 168) || (p[0] === 169 && p[1] === 254);
    };
    if (hostnameText.includes(':')) {
      // URL.hostname normalizes IPv6 in browsers; also accept full and mapped forms.
      let text = hostnameText;
      if (text.includes('.')) {
        const split = text.lastIndexOf(':'), v4 = text.slice(split + 1).split('.').map(Number);
        if (v4.length !== 4 || v4.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
        text = text.slice(0, split + 1) + ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
      }
      const halves = text.split('::');
      if (halves.length > 2) return false;
      const left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
      if (![...left, ...right].every(s => /^[\da-f]{1,4}$/.test(s))) return false;
      const gap = 8 - left.length - right.length;
      if (halves.length === 1 ? gap !== 0 : gap < 1) return false;
      const words = [...left, ...Array(gap).fill('0'), ...right].map(s => parseInt(s, 16));
      if (words.slice(0, 7).every(n => n === 0) && words[7] <= 1) return true;
      if ((words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80) return true;
      if (words.slice(0, 5).every(n => n === 0) && words[5] === 0xffff) {
        return localV4([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.'));
      }
      return false;
    }
    if (/^[\d.]+$/.test(hostnameText)) return localV4(hostnameText);
    return !!hostnameText && (!hostnameText.includes('.') ||
      /\.(localhost|local|lan)$/.test(hostnameText) || hostnameText.endsWith('.home.arpa'));
  }
  function readSiteModes(raw) {
    const value = raw == null ? {} : typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('网站显示设置格式不兼容');
    return Object.fromEntries(Object.entries(value).filter(([, mode]) => ['show', 'hide', 'default'].includes(mode)));
  }
  function siteEnabled() {
    const mode = siteModes[location.origin];
    if (mode === 'show') return true;
    if (mode === 'hide') return false;
    return localAddress(location.hostname);
  }
  async function setSiteMode(mode) {
    // Store website choices separately so template saves in other tabs cannot overwrite them.
    const fresh = readSiteModes(await GM_getValue(SITE_STORAGE, null));
    if (mode === 'default') delete fresh[location.origin];
    else fresh[location.origin] = mode;
    await GM_setValue(SITE_STORAGE, JSON.stringify(fresh));
    siteModes = fresh;
    cancelled = true; activeRequest?.abort();
    opened = false; dockPinned = false;
    ui.panel.hidden = ui.toast.hidden = true;
    ui.dock.hidden = !siteEnabled(); ui.openSettings.setAttribute('aria-expanded', 'false');
    setDockExpanded(false);
    updateInlineLabels(); scheduleInline(true);
  }

  function applyInlinePreference(value) {
    inlineEnabled = value === true;
    if (ui) {
      if (!inlineEnabled) { inlineFields = []; ui.inlineLayer.replaceChildren(); }
      updateInlineLabels(); scheduleInline(true);
    }
  }
  async function syncInlinePreference() {
    const revision = inlineRevision;
    const value = await GM_getValue(INLINE_STORAGE, false);
    if (revision === inlineRevision) applyInlinePreference(value);
  }
  async function setInlinePreference() {
    if (inlineSaving) { updateInlineLabels(); return; }
    const enabled = ui.globalInline.checked;
    inlineSaving = true; ui.globalInline.disabled = true;
    try {
      await GM_setValue(INLINE_STORAGE, enabled);
      await syncInlinePreference();
      toast(inlineEnabled ? '单项随机已开启并记住选择：左键换值，右键设置规则' : '单项随机已关闭并记住选择');
    } finally { inlineSaving = false; updateInlineLabels(); }
  }

  function visible(el) {
    if (!el?.isConnected || el.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.visibility !== 'collapse' && el.getClientRects().length > 0;
  }
  function disabled(el) {
    return !!(el.disabled || el.matches(':disabled') || el.closest('[aria-disabled="true"],.is-disabled,.ant-select-disabled,.ant-picker-disabled,.ant-switch-disabled'));
  }
  function legacyDynamicId(id) { return !id || /^(el-id-|el-\d|rc[_-]|:r|headlessui-|radix-)|\d{8,}|[a-f0-9]{16,}/i.test(id); }
  function dynamicId(id) { return legacyDynamicId(id) || /^«[rR][\w:-]*»$/.test(id); }
  function labelText(label) {
    const copy = label.cloneNode(true);
    for (const node of qa('input,select,textarea,button,svg,[aria-hidden="true"],.el-select,.ant-select', copy)) node.remove();
    return clean(copy.textContent);
  }
  function pageInfo() {
    const route = location.hash.match(/^#!?(\/[^?]*)/);
    const path = location.pathname.replace(/\/$/, '') || '/';
    return { origin: location.origin, path: path + (route ? '#' + route[1] : ''), title: document.title };
  }
  function pageKey() { const p = pageInfo(); return p.origin + p.path; }
  function controlOwner(el) {
    return el.closest(COMPONENT) || el.closest('.el-select,.ant-select,.ant-input-number,.el-input-number,[role="radiogroup"],.el-radio-group,.ant-radio-group') ||
      el.closest('[role="combobox"],[role="switch"]') || el;
  }
  function localFieldLabel(el) {
    const owner = controlOwner(el);
    // Stop at the first multi-control container; never merge labels across a row.
    for (let branch = owner, parent = owner.parentElement, depth = 0; parent && depth < 6; branch = parent, parent = parent.parentElement, depth++) {
      if (parent.matches(`${FORM},${OVERLAY},main,body,html`)) break;
      const controls = new Set(qa(CONTROL, parent).filter(fieldVisible).map(controlOwner));
      if (controls.size !== 1 || !controls.has(owner)) break;
      const candidates = arr(parent.children).filter(node => node !== branch && visible(node) &&
        !node.matches('button,a,[role="alert"],[role="status"],h1,h2,h3,h4') && !q(`${CONTROL},button,a`, node) &&
        !/error|feedback|hint|help|description|tooltip/i.test(node.className) &&
        (node.compareDocumentPosition(branch) & Node.DOCUMENT_POSITION_FOLLOWING));
      const labels = candidates.map(node => ({ node, text: labelText(node) })).filter(item => item.text && item.text.length <= 100);
      const explicit = labels.filter(({ node }) => node.matches('label,[data-label]') || /label/i.test(node.className));
      if (explicit.length === 1) return explicit[0].text;
      if (labels.length === 1) return labels[0].text;
      if (labels.length > 1) return '';
    }
    return '';
  }
  function labelFor(el, legacy = false) {
    const inp = el.matches('input,select,textarea') ? el : q('input,select,textarea', el);
    const labels = inp?.labels;
    if (labels?.length) { const text = clean(arr(labels).map(labelText).join(' ')); if (text || legacy) return text; }
    const labelled = (el.getAttribute('aria-labelledby') || inp?.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    if (labelled.length) {
      const text = labelled.map(id => document.getElementById(id)?.textContent || '').join(' ');
      if (clean(text)) return clean(text);
    }
    const aria = el.getAttribute('aria-label') || inp?.getAttribute('aria-label');
    if (aria) return clean(aria);
    const wrap = el.closest(WRAP);
    const label = wrap && q('.el-form-item__label,.ant-form-item-label,label,[data-label]', wrap);
    if (label && (legacy || new Set(qa(CONTROL, wrap).filter(fieldVisible).map(controlOwner)).size === 1)) {
      const text = labelText(label); if (text || legacy) return text;
    }
    const cell = el.closest('td');
    const table = cell?.closest('table');
    if (table) {
      const header = table.querySelectorAll('thead tr:last-child th')[cell.cellIndex];
      if (header) return clean(header.textContent);
    }
    if (!legacy) { const nearby = localFieldLabel(el); if (nearby) return nearby; }
    return clean(el.getAttribute('placeholder') || inp?.getAttribute('placeholder') || el.getAttribute('name') || inp?.name || (!(legacy ? legacyDynamicId : dynamicId)(el.id) ? el.id : ''));
  }
  function contextFor(el, legacy = false) {
    const parts = [];
    const fs = el.closest('fieldset');
    if (fs) parts.push(clean(q('legend', fs)?.textContent));
    const section = el.closest('section,[role="group"],[data-section],.el-card,.ant-card');
    if (section) parts.push(clean(section.getAttribute('aria-label') || q('h1,h2,h3,h4,.el-card__header,.ant-card-head-title', section)?.textContent));
    const row = el.closest('tr');
    if (row) {
      const rowKey = row.getAttribute('data-row-key') || row.getAttribute('data-key');
      const heading = q('th[scope="row"],th', row) || arr(row.cells || []).find(c => !q(CONTROL, c) && norm(c.textContent));
      parts.push(rowKey ? `行:${rowKey}` : clean(heading?.textContent));
    }
    const context = parts.filter(Boolean).join(' / ');
    if (context || legacy) return context;
    // Custom layouts often place a heading wrapper immediately before its body.
    for (let node = el.parentElement, depth = 0; node && depth < 8; node = node.parentElement, depth++) {
      if (node.matches(`${FORM},${OVERLAY},main,body,html`)) break;
      for (let prev = node.previousElementSibling, count = 0; prev && count < 3; prev = prev.previousElementSibling, count++) {
        if (q(CONTROL, prev) || prev.matches(CONTROL)) break;
        const headings = prev.matches('h1,h2,h3,h4,[role="heading"]') ? [prev] : qa('h1,h2,h3,h4,[role="heading"]', prev);
        const shown = headings.filter(visible);
        if (shown.length === 1) return clean(shown[0].textContent).slice(0, 120);
        if (shown.length > 1) break;
      }
    }
    return '';
  }
  function descriptor(f, legacy = false) {
    const input = f.el.matches('input,select,textarea') ? f.el : q('input,select,textarea', f.el);
    const unstable = legacy ? legacyDynamicId : dynamicId;
    return {
      kind: f.kind, type: f.type || '', name: f.el.getAttribute('name') || input?.name || '',
      id: !unstable(f.el.id) ? f.el.id : (!unstable(input?.id) ? input.id : ''),
      testid: f.el.getAttribute('data-testid') || f.el.getAttribute('data-test') || input?.getAttribute('data-testid') || '',
      label: legacy ? f.legacyLabel : f.label, context: legacy ? contextFor(f.el, true) : f.context,
      // These components hide their placeholder when selected; it is not an identity.
      placeholder: !legacy && ['picker', 'cascader', 'tree'].includes(f.kind) ? '' : input?.getAttribute('placeholder') || ''
    };
  }
  function identity(f) { return hash(JSON.stringify(f.desc)); }
  function liveReference(f) { return { descriptor: f.desc, element: f.el, unique: f.unique }; }
  // Group captions may improve, but saved radio option text keeps its original meaning.
  function radioOptionLabel(el) { return labelFor(el, true) || clean(el.textContent); }
  function sensitive(f) {
    const s = [f.label, f.desc.name, f.type, f.desc.placeholder, f.el.getAttribute('autocomplete')].join(' ');
    return /password|密码|验证码|一次性口令|otp\b|one-time-code|csrf|access.?token|secret|api.?key|信用卡|银行卡|身份证|passport|social.?security|同意.*(协议|条款)|隐私.*(协议|政策)/i.test(s);
  }
  function fieldVisible(el) {
    if (visible(el)) return true;
    if (el.matches('input[type="checkbox"],input[type="radio"]')) {
      return !!arr(el.labels || []).some(visible);
    }
    return false;
  }

  function searchRegion(el) {
    if (el.matches(SEARCH_AREA)) return true;
    const identity = `${el.id || ''} ${el.className || ''} ${el.getAttribute('name') || ''}`;
    if (/(?:^|[-_\s])(search|filter|query)(?:[-_\s]|$)|(?:search|filter|query)(?:Form|Bar|Panel|Box)/i.test(identity)) return true;
    const buttons = qa('button,input[type="submit"],[role="button"]', el).filter(visible).map(b => clean(b.value || b.getAttribute('aria-label') || b.textContent).replace(/\s+/g, ''));
    const search = buttons.some(t => /^(搜索|查询|筛选|查找|检索|search|filter|query|find)$/i.test(t));
    const edit = buttons.some(t => /^(保存|提交|确定|确认|新增|创建|测算|下一步|完成|更新|save|submit|create|confirm|next|calculate)$/i.test(t));
    return search && !edit;
  }
  function searchField(el, kind) {
    if (el.closest(SEARCH_AREA + ',nav,[role="navigation"]')) return true;
    const form = el.closest(FORM);
    if (form && searchRegion(form)) return true;
    const area = el.closest('.toolbar,.search-area,.filter-area,.query-panel,.el-form--inline,.ant-form-inline');
    if (area && searchRegion(area)) return true;
    if (['combo', 'picker', 'cascader', 'tree', 'unsupported'].includes(kind) || el.closest(COMBO)) return false;
    if (el.matches('input[type="search"],[enterkeyhint="search"]')) return true;
    const hint = [el.getAttribute('placeholder'), el.getAttribute('aria-label'), labelFor(el)].filter(Boolean).join(' ');
    return /(?:搜索|请输入.*关键词|输入.*进行查询|搜索关键词)|\bsearch\b/i.test(hint) || /^(search|searchText|searchKeyword|searchQuery|queryText|q)$/i.test(el.getAttribute('name') || '');
  }
  function collect(root) {
    const result = [], seen = new Set(), radioGroups = new Map();
    for (const item of qa(CONTROL, root)) {
      if (item === host || host.contains(item) || item.closest(POPUP)) continue;
      let el = item, kind, type = item.type || '';
      const special = item.closest(COMPONENT);
      const combo = item.closest('.el-select,.ant-select:not(.ant-cascader)') || item.closest('[role="combobox"]');
      if (special && root.contains(special)) {
        el = special; kind = el.matches(PICKER) ? 'picker' : el.matches(CASCADER) ? 'cascader' : 'tree';
        type = kind === 'picker' ? (pickerInputs(el).length === 2 ? 'range' : 'single') : '';
      }
      else if (combo && root.contains(combo) && !combo.matches('select')) { el = combo; kind = linkedTree(combo) ? 'tree' : 'combo'; }
      else if (item.closest('[contenteditable="true"]')) { el = item.closest('[contenteditable="true"]'); kind = 'rich'; }
      else if (item.matches('input')) {
        if (/^(hidden|button|submit|reset|image)$/.test(type)) continue;
        if (type === 'file') kind = 'unsupported';
        else if (type === 'radio') kind = 'radio';
        else if (type === 'checkbox') kind = item.closest('[role="switch"],.el-switch') ? 'switch' : 'checkbox';
        else if (/^(number|range)$/.test(type) || item.getAttribute('role') === 'spinbutton') kind = 'number';
        else if (/^(date|datetime-local|month|week|time)$/.test(type)) kind = 'date';
        else kind = 'text';
      } else if (item.matches('textarea')) kind = 'textarea';
      else if (item.matches('select')) kind = 'select';
      else if (item.matches('[role="switch"]')) kind = 'switch';
      else if (item.matches('[role="checkbox"]')) kind = 'checkbox';
      else if (item.matches('[role="radio"]')) kind = 'radio';
      else continue;
      if (kind === 'switch' && el.matches('input') && el.closest('[role="switch"]')) el = el.closest('[role="switch"]');
      if (seen.has(el) || !fieldVisible(el) || searchField(el, kind)) continue;
      if (el.matches('[role="checkbox"],[role="radio"]') && q('input[type="checkbox"],input[type="radio"]', el)) continue;
      seen.add(el);
      const f = { el, kind, type, label: labelFor(el), legacyLabel: labelFor(el, true), context: contextFor(el), required: !!(el.required || el.getAttribute('aria-required') === 'true' || el.closest('.is-required,.ant-form-item-required')) };
      if (kind === 'radio') {
        const groupRoot = el.closest('[role="radiogroup"],fieldset,.el-radio-group,.ant-radio-group') || el.form || root;
        const name = el.name || groupRoot.getAttribute('aria-label') || 'unnamed';
        let groups = radioGroups.get(groupRoot);
        if (!groups) radioGroups.set(groupRoot, groups = new Map());
        if (groups.has(name)) { groups.get(name).members.push(el); continue; }
        f.members = [el];
        const groupLabel = clean(q('legend', groupRoot)?.textContent || groupRoot.getAttribute('aria-label'));
        f.label = groupLabel || clean(q('.el-form-item__label,.ant-form-item-label', el.closest(WRAP) || el)?.textContent) ||
          (groupRoot.matches('[role="radiogroup"],.el-radio-group,.ant-radio-group') ? localFieldLabel(groupRoot) : '') || el.name || f.label;
        f.legacyLabel = groupLabel || clean(q('.el-form-item__label,.ant-form-item-label', el.closest(WRAP) || el)?.textContent) || el.name || f.legacyLabel;
        groups.set(name, f);
      }
      f.desc = descriptor(f); f.key = identity(f);
      f.legacyDesc = descriptor(f, true); f.legacyKey = hash(JSON.stringify(f.legacyDesc));
      if (!nodeIds.has(el)) nodeIds.set(el, `field-${++nextNodeId}`);
      f.uid = nodeIds.get(el);
      f.reason = sensitive(f) ? '敏感或认证字段，跳过' : disabled(el) || (['picker', 'cascader', 'tree'].includes(kind) && pickerInputs(el).some(disabled)) ? '控件已禁用' : (el.readOnly && !['combo', 'picker'].includes(kind)) ? '字段只读' : kind === 'rich' ? '富文本编辑器需单独适配' : kind === 'unsupported' ? '文件控件需手动选择文件' : '';
      if (!f.label) f.label = `未命名${TYPES[kind] || '字段'}`;
      result.push(f);
    }
    const limited = result.slice(0, 500), counts = new Map();
    for (const f of limited) counts.set(f.key, (counts.get(f.key) || 0) + 1);
    for (const f of limited) {
      f.peers = limited;
      f.unique = counts.get(f.key) === 1 && matchField(f.desc, limited).field === f;
    }
    return limited;
  }

  function discoverScopes() {
    const shown = el => visible(el) && !el.closest('.ant-tabs-tabpane-hidden,[data-state="inactive"][role="tabpanel"]');
    const paintPath = el => {
      const path = [];
      for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
        const css = getComputedStyle(node), z = Number.parseInt(css.zIndex, 10);
        if (Number.isFinite(z) || css.position === 'fixed' || css.transform !== 'none' || css.isolation === 'isolate' || Number(css.opacity) < 1) path.unshift(Number.isFinite(z) ? z : 0);
      }
      if (el.matches('dialog:modal') || el.closest('dialog:modal')) path.unshift(Number.MAX_SAFE_INTEGER);
      return path;
    };
    const topmost = elements => elements.map(el => ({ el, path: paintPath(el) })).sort((a, b) => {
      for (let i = 0; i < Math.max(a.path.length, b.path.length); i++) { const delta = (b.path[i] || 0) - (a.path[i] || 0); if (delta) return delta; }
      return a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : -1;
    })[0]?.el;
    const overlays = [...new Set(qa(OVERLAY).filter(shown).filter(el => !el.closest(POPUP)).map(el => {
      return el.matches('[role="dialog"],[role="alertdialog"],dialog,[aria-modal="true"]') ? el : el.closest('[role="dialog"],[role="alertdialog"],dialog,[aria-modal="true"]') || el;
    }))].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; });
    const overlay = topmost(overlays);
    if (overlay) {
      // An empty top dialog still blocks forms behind it.
      activeRoot = searchRegion(overlay) ? emptyRoot : overlay;
    } else {
      const panes = qa('[role="tabpanel"],.ant-tabs-tabpane-active,.el-tab-pane').filter(shown).filter(el => q(CONTROL, el));
      const pane = topmost(panes.filter(el => !panes.some(other => other !== el && el.contains(other))));
      const page = pane || topmost(qa('main,[role="main"]').filter(shown)) || document.body;
      const forms = qa(FORM, page).filter(shown).filter(el => !searchRegion(el) && !el.closest(SEARCH_AREA)).filter(el => {
        const parent = el.parentElement?.closest(FORM); return !parent || !page.contains(parent);
      });
      forms.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      activeRoot = forms.find(el => collect(el).length) || (page.matches(FORM) && !searchRegion(page) ? page : null);
      if (!activeRoot) {
        const loose = collect(page).filter(f => !f.el.closest(FORM));
        activeRoot = loose.length ? page : emptyRoot;
      }
    }
    scopeDirty = false;
    return activeRoot;
  }
  function rootScope() {
    if (scopeDirty || !activeRoot || (activeRoot !== emptyRoot && !activeRoot.isConnected)) discoverScopes();
    return activeRoot;
  }
  function scopeKey(legacy = false) {
    const root = rootScope();
    if (root === emptyRoot) return 'empty';
    return root === document.body || (!root.matches(FORM) && !root.matches(OVERLAY)) ? 'body' : norm(root.getAttribute('name') || root.getAttribute('aria-label') || (!(legacy ? legacyDynamicId : dynamicId)(root.id) ? root.id : '') || root.tagName);
  }
  function ruleKey() { return `${pageKey()}::${scopeKey()}`; }
  function templateBaseName() {
    const root = rootScope(), dialog = root.closest(OVERLAY);
    const label = el => {
      if (!el) return '';
      const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
      return clean(el.getAttribute('aria-label') || labelled);
    };
    const firstText = (selector, parent = document) => qa(selector, parent).filter(visible).map(labelText).find(Boolean) || '';
    const tabs = qa('[role="tab"][aria-selected="true"],.el-tabs__item.is-active,.ant-tabs-tab-active .ant-tabs-tab-btn,.tags-view-item.active').filter(visible);
    const associatedTab = tabs.find(tab => (tab.getAttribute('aria-controls') || '').split(/\s+/).some(id => document.getElementById(id)?.contains(root)));
    const activeTab = associatedTab || tabs.at(-1);
    const button = qa('button,input[type="submit"],[role="button"]', root).filter(visible).map(el => clean(el.value || el.getAttribute('aria-label') || el.textContent)).find(text => text && !/^(取消|关闭|返回|重置|搜索|查询|cancel|close|back|reset|search)$/i.test(text));
    const base = (dialog && (label(dialog) || firstText('.el-dialog__title,.ant-modal-title,h1,h2,h3', dialog))) ||
      (root !== document.body && label(root)) || (activeTab && labelText(activeTab)) ||
      firstText('h1', root) || firstText('main h1,[role="main"] h1') || clean(document.title) ||
      firstText('legend,h2,h3', root) || button || '当前页面';
    return Array.from(base.replace(/[×✕]+$/u, '').trim()).slice(0, 45).join('') || '当前页面';
  }
  function suggestTemplateName(force = false) {
    const key = ruleKey(), root = rootScope();
    if (key !== templateNameKey || root !== templateNameRoot) templateNameAuto = true;
    templateNameKey = key; templateNameRoot = root;
    if (!force && !templateNameAuto && ui.templateName.value.trim()) return;
    const base = templateBaseName() + '-模板', p = pageInfo();
    const used = new Set(db.templates.filter(t => t.page.origin === p.origin && t.page.path === p.path && t.scope === scopeKey()).map(t => t.name));
    let name = base, index = 2;
    while (used.has(name)) name = `${base}（${index++}）`;
    ui.templateName.value = name; templateNameAuto = true;
  }
  function currentRules() { return db.rules[ruleKey()] || db.rules[`${pageKey()}::${scopeKey(true)}`] || emptyRules; }
  function bindRules(list) {
    const rules = currentRules();
    if (list.ruleSource === rules && list.sessionRevision === sessionRuleRevision) return;
    list.ruleSource = rules; list.sessionRevision = sessionRuleRevision;
    const aliases = new Map(), unresolved = new Set();
    for (const f of list) {
      f.ruleOptions = []; f.ruleWarning = ''; f.ruleBlocked = '';
      for (const key of new Set([f.key, f.legacyKey])) {
        if (!aliases.has(key)) aliases.set(key, []);
        aliases.get(key).push(f);
      }
    }
    for (const [key, rule] of Object.entries(rules)) {
      const matched = rule.descriptor && matchField(rule.descriptor, list).field;
      const owners = matched ? [matched] : aliases.get(key) || [];
      if (owners.length === 1 && owners[0].unique && (!rule.descriptor || matched)) {
        const f = owners[0], priority = rule.descriptor ? (key === f.key ? 3 : 2) : 1;
        f.ruleOptions.push({ key, rule, priority });
      } else {
        unresolved.add(key);
        for (const f of owners) f.ruleBlocked = f.ruleWarning = '旧规则无法唯一对应，已保留原数据；请为此项重新指定规则';
      }
    }
    for (const f of list) {
      const sorted = f.ruleOptions.sort((a, b) => b.priority - a.priority), first = sorted[0];
      if (first && sorted[1]?.priority === first.priority && !same(first.rule, sorted[1].rule)) {
        f.ruleBlocked = f.ruleWarning = '存在多份可匹配的规则，已保留原数据；请为此项重新指定规则';
        sorted.forEach(option => unresolved.add(option.key)); f.boundRule = { mode: 'auto', value: '' };
      } else {
        f.boundRule = first?.rule || { mode: 'auto', value: '' };
        if (first) f.ruleBlocked = f.ruleWarning = '';
      }
      const local = sessionRules.get(f.el);
      if (local?.scope === ruleKey() && local.key === f.key) { f.boundRule = local.rule; f.ruleBlocked = f.ruleWarning = ''; }
      if (!f.unique) f.ruleWarning = [f.ruleWarning, '缺少可区分的长期标识；单项规则仅当前控件有效，不保存到模板'].filter(Boolean).join('；');
    }
    list.unresolvedRules = unresolved.size;
  }
  function ruleFor(f) { bindRules(f.peers); return f.boundRule; }
  function currentSettings() {
    const saved = db.settings[ruleKey()] || db.settings[`${pageKey()}::${scopeKey(true)}`] || {}, defaults = defaultSettings();
    return { number: { ...defaults.number, ...saved.number }, text: { ...defaults.text, ...saved.text } };
  }
  function read(f) {
    if (f.kind === 'picker') { const values = pickerInputs(f.el).map(el => el.value); return values.some(Boolean) ? values : []; }
    if (f.kind === 'cascader' || f.kind === 'tree') return hierarchyValues(f.el);
    if (f.kind === 'radio') {
      const selected = f.members.find(e => e.checked || e.getAttribute('aria-checked') === 'true');
      return selected ? { value: selected.value ?? selected.getAttribute('data-value') ?? '', text: radioOptionLabel(selected) } : null;
    }
    if (f.kind === 'checkbox' || f.kind === 'switch') return f.el.matches('input') ? f.el.checked : f.el.getAttribute('aria-checked') === 'true' || f.el.classList.contains('is-checked') || f.el.classList.contains('ant-switch-checked');
    if (f.kind === 'select') return arr(f.el.selectedOptions).filter(o => o.value !== '' && !o.disabled).map(o => ({ value: o.value, text: clean(o.textContent) }));
    if (f.kind === 'combo') {
      const tags = qa('.el-tag__content,.ant-select-selection-item', f.el).filter(visible).map(e => clean(e.getAttribute('title') || e.textContent)).filter(Boolean);
      if (tags.length) return [...new Set(tags)];
      // Ant Design versions use different wrappers for the single selected value.
      // Ignore hidden display nodes, which may retain an old value during search.
      const antValue = qa('.ant-select-content-value,.ant-select-content-has-value', f.el).find(visible);
      if (antValue && f.el.matches('.ant-select-single')) {
        const value = clean(antValue.getAttribute('title') || labelText(antValue));
        if (value) return [value];
      }
      const selected = q('.el-select__selected-item.el-select__placeholder:not(.is-transparent)', f.el) || qa('.el-select__selected-item:not(.is-transparent)', f.el).find(e => !q('input', e) && clean(e.textContent));
      if (selected && !f.el.classList.contains('is-empty') && !selected.classList.contains('is-transparent')) {
        const val = clean(selected.textContent);
        if (val && !/^(请选择|please select|select)$/i.test(val)) return [val];
      }
      const input = f.el.matches('input') ? f.el : q('input', f.el);
      // Non-searchable Element UI and accessible custom comboboxes expose their selection in the input.
      if (input && (input.readOnly || !f.el.matches('.el-select,.ant-select')) && input.value) return [input.value];
      if (!input && f.el.matches('[role="combobox"]')) {
        const text = labelText(f.el);
        const placeholder = clean(f.el.getAttribute('aria-placeholder'));
        if (text && text !== placeholder && !/^(请选择|选择|please select|select|choose)(\s|$|.{0,12}$)/i.test(text)) return [text];
      }
      return [];
    }
    return f.el.value ?? f.el.textContent ?? '';
  }
  function compatible(a, b) { return a.kind === b.kind && (!['text', 'date', 'picker'].includes(a.kind) || a.type === b.type); }
  function matchField(desc, candidates) {
    const scoreFor = target => {
      let score = 0;
      if (desc.testid && target.testid && desc.testid !== target.testid) return 0;
      if (desc.name && target.name && desc.name !== target.name) return 0;
      if (!dynamicId(desc.id) && !dynamicId(target.id) && desc.id !== target.id) return 0;
      if (desc.testid && desc.testid === target.testid) score += 100;
      if (desc.name && desc.name === target.name) score += 70;
      if (!dynamicId(desc.id) && desc.id === target.id) score += 80;
      if (desc.label && desc.label === target.label) score += 45;
      if (desc.context && desc.context === target.context) score += 35;
      if (desc.placeholder && desc.placeholder === target.placeholder) score += 12;
      if (desc.context && target.context && desc.context !== target.context) score -= 80;
      return score;
    };
    const scored = candidates.filter(f => compatible(desc, f.desc)).map(f => {
      const conflict = desc.context && f.desc.context && desc.context !== f.desc.context && desc.context !== f.legacyDesc.context;
      return { f, score: conflict ? 0 : Math.max(scoreFor(f.desc), scoreFor(f.legacyDesc)) };
    }).sort((a, b) => b.score - a.score);
    if (!scored.length || scored[0].score < 40) return { reason: '未找到可靠匹配字段' };
    if (scored[1]?.score === scored[0].score) return { reason: '存在多个同名字段，需增加标签或分组标识' };
    return { field: scored[0].f };
  }
  function matchLive(reference, candidates) {
    if (!reference.element) return matchField(reference.descriptor, candidates);
    const direct = candidates.find(f => f.el === reference.element);
    if (direct) return same(direct.desc, reference.descriptor) ? { field: direct } : { reason: '控件标签或用途已变化，未继续填写' };
    if (reference.element.isConnected) return { reason: '原控件已隐藏或移出当前填写范围' };
    if (!reference.unique) return { reason: '原同名控件已被替换，无法确认对应关系' };
    // A replacement node is safe only when its saved features identify one field.
    return matchField(reference.descriptor, candidates);
  }

  function rng(seed) {
    let n = parseInt(hash(seed), 36) >>> 0;
    return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function configuredNumber(f, random, config) {
    const has = v => v !== '' && v != null && Number.isFinite(Number(v));
    const el = f.el, hint = `${f.label} ${f.desc.name}`;
    const nativeMin = el.getAttribute('min') ?? el.getAttribute('aria-valuemin');
    const nativeMax = el.getAttribute('max') ?? el.getAttribute('aria-valuemax');
    let lo = has(config.min) ? Number(config.min) : has(nativeMin) ? Number(nativeMin) : 1;
    let hi = has(config.max) ? Number(config.max) : has(nativeMax) ? Number(nativeMax) : /增速|增长率|growth/i.test(hint) ? 8 : 100;
    if (has(nativeMin)) lo = Math.max(lo, Number(nativeMin));
    if (has(nativeMax)) hi = Math.min(hi, Number(nativeMax));
    if (lo > hi) throw new Error('设定范围与字段 min/max 没有交集，请调整上下限');
    if (Math.max(Math.abs(lo), Math.abs(hi)) > 1e12) throw new Error('自定义随机范围最大支持 ±1 万亿');
    const digits = config.mode === 'integer' ? 0 : Number(config.decimals);
    if (!Number.isInteger(digits) || digits < 0 || digits > 6) throw new Error('小数位请设置为 0～6');
    const st = el.getAttribute('step');
    const nativeStep = st === 'any' ? null : has(st) && Number(st) > 0 ? Number(st) : /^(number|range)$/.test(el.type) ? 1 : null;
    const base = has(nativeMin) ? Number(nativeMin) : has(el.getAttribute('value')) ? Number(el.getAttribute('value')) : 0;
    // Intersect the requested decimal grid with the browser step grid using exact integers.
    const parts = value => {
      const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
      const places = (mantissa.split('.')[1] || '').length - Number(exponent);
      let integer = BigInt(mantissa.replace('.', ''));
      if (places < 0) integer *= 10n ** BigInt(-places);
      return { integer, places: Math.max(0, places) };
    };
    const values = [lo, hi, nativeStep || 0, base].map(parts);
    const precision = Math.max(digits, ...values.map(v => v.places));
    if (precision > 12) throw new Error('字段步长精度超过本版支持范围');
    const [lower, upper, step, offset] = values.map(v => v.integer * 10n ** BigInt(precision - v.places));
    const grid = 10n ** BigInt(precision - digits);
    const mod = (a, b) => (a % b + b) % b;
    const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
    const floorDiv = (a, b) => a >= 0n ? a / b : -((-a + b - 1n) / b);
    let first = 0n, interval = grid;
    if (nativeStep) {
      const divisor = gcd(grid, step);
      if (mod(offset, divisor)) throw new Error('整数 / 小数位设置与字段 step 不兼容');
      const modulus = step / divisor;
      let a = grid / divisor, b = modulus, x = 1n, y = 0n;
      while (b) { const k = a / b; [a, b] = [b, a - k * b]; [x, y] = [y, x - k * y]; }
      first = grid * (modulus === 1n ? 0n : mod((offset / divisor) * x, modulus));
      interval = grid * modulus;
    }
    const from = -floorDiv(-(lower - first), interval), to = floorDiv(upper - first, interval);
    if (from > to) throw new Error('范围内没有同时满足小数位和 step 的数值');
    const count = to - from + 1n;
    const index = BigInt(Math.floor(random() * 0x100000000)) * count / 0x100000000n;
    const value = first + (from + index) * interval;
    const raw = (value < 0n ? -value : value).toString().padStart(precision + 1, '0');
    const formatted = precision ? `${raw.slice(0, -precision)}.${raw.slice(-precision)}`.replace(/0+$/, '').replace(/\.$/, '') : raw;
    return (value < 0n ? '-' : '') + formatted;
  }
  function generatedNumber(f, random, config = currentSettings().number) {
    if (config.mode !== 'auto') return configuredNumber(f, random, config);
    const el = f.el, hint = `${f.label} ${f.desc.name} ${el.getAttribute('placeholder') || ''}`;
    const numeric = s => s != null && s !== '' && Number.isFinite(Number(s));
    const growth = /增速|增长率|growth/i.test(hint);
    const percentage = /比例|占比|百分|rate|ratio|percent|%|％/i.test(hint);
    const year = /年份|年度|year/i.test(hint) && !growth && !percentage;
    const min = el.getAttribute('min') ?? el.getAttribute('aria-valuemin');
    const max = el.getAttribute('max') ?? el.getAttribute('aria-valuemax');
    let lo = numeric(min) ? Number(min) : percentage && !growth ? 0 : 1;
    let hi = numeric(max) ? Number(max) : growth ? 8 : year ? new Date().getFullYear() + 5 : 100;
    if (year && !numeric(min)) lo = new Date().getFullYear();
    if (hi < lo) lo = hi;
    const st = el.getAttribute('step');
    const step = st === 'any' ? 0.01 : numeric(st) && Number(st) > 0 ? Number(st) : 1;
    const base = numeric(min) ? Number(min) : numeric(el.getAttribute('value')) ? Number(el.getAttribute('value')) : 0;
    const kLo = Math.ceil((lo - base) / step - 1e-9), kHi = Math.floor((hi - base) / step + 1e-9);
    if (kHi < kLo) throw new Error('min/max/step 之间没有可用数值');
    const k = kLo + Math.floor(random() * (kHi - kLo + 1));
    return String(Number((base + k * step).toFixed(10)));
  }
  function dateValue(f) {
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    let value = { date: day, month: day.slice(0, 7), 'datetime-local': day + 'T10:00', time: '10:00', week: `${d.getFullYear()}-W01` }[f.type];
    if (f.el.min && value < f.el.min) value = f.el.min;
    if (f.el.max && value > f.el.max) value = f.el.max;
    const probe = f.el.cloneNode(false); probe.value = value;
    if (probe.validity.stepMismatch) { try { probe.stepUp(0); value = probe.value; } catch { /* report validation below */ } }
    return value;
  }
  function textFormat(f) {
    const hint = `${f.label} ${f.desc.name} ${f.desc.placeholder}`, inputMode = f.el.inputMode;
    if (f.type === 'email' || inputMode === 'email' || /邮箱|e.?mail/i.test(hint)) return 'email';
    if (f.type === 'url' || inputMode === 'url' || /网址|网站|website|url/i.test(hint)) return 'url';
    if (f.type === 'tel' || inputMode === 'tel' || /手机|电话|mobile|phone/i.test(hint)) return 'tel';
    if (f.type === 'color') return 'color';
    if (/邮编|postal|zip.?code/i.test(hint)) return 'postal';
    if (/金额|数量|面积|数值|排放量|人口|产值|增速|增长率|占比|比例|percent|amount|quantity|gdp|growth/i.test(hint) || /^(numeric|decimal)$/.test(inputMode)) return 'number';
    if (/年份|年度|year/i.test(hint)) return 'year';
    if (/编码|编号|code|serial/i.test(hint)) return 'code';
    return '';
  }
  function textLengthSettings(config) {
    const result = {};
    for (const key of ['minLength', 'maxLength']) {
      const raw = String(config[key] ?? '').trim();
      if (raw !== '' && (!/^\d{1,5}$/.test(raw) || Number(raw) > TEXT_LIMIT)) throw new Error('文本字数请填写 0～10000 的整数，或留空');
      result[key] = raw === '' ? null : Number(raw);
    }
    if (result.minLength != null && result.maxLength != null && result.minLength > result.maxLength) throw new Error('最小字数不能大于最大字数');
    return result;
  }
  function textBounds(f, config, defaults) {
    const { minLength: min, maxLength: max } = textLengthSettings(config);
    const nativeMin = Math.max(0, f.el.minLength || 0, f.el.required ? 1 : 0);
    const nativeMax = f.el.maxLength >= 0 ? Math.min(f.el.maxLength, TEXT_LIMIT) : TEXT_LIMIT;
    const baseMin = f.kind === 'textarea' ? 100 : 20, baseMax = f.kind === 'textarea' ? 300 : 60;
    let lo, hi;
    if (nativeMin > nativeMax) throw new Error('字段自身的长度限制没有可用范围');
    if (!defaults) { lo = Math.max(nativeMin, min ?? 0); hi = Math.min(nativeMax, max ?? TEXT_LIMIT); }
    else if (min == null && max == null) {
      lo = Math.min(nativeMax, Math.max(nativeMin, baseMin));
      hi = Math.min(nativeMax, Math.max(baseMax, lo));
    } else if (max == null) {
      lo = Math.max(nativeMin, min); hi = Math.min(nativeMax, Math.max(baseMax, lo + baseMax - baseMin));
    } else {
      lo = Math.max(nativeMin, min ?? Math.min(1, max)); hi = Math.min(nativeMax, max);
    }
    if (lo > hi) throw new Error('字数设置与字段 minlength / maxlength 没有交集，原值未改动');
    return { lo, hi, custom: min != null || max != null };
  }
  function composeText(pool, length, random, prefix = '') {
    let result = '';
    const append = fragment => {
      // Iterate by Unicode character so a length limit never leaves half an emoji.
      for (const character of fragment) {
        if (result.length + character.length > length) break;
        result += character;
        if (result.length === length) break;
      }
    };
    append(prefix);
    while (result.length < length) {
      const before = result.length;
      append(pool[Math.floor(random() * pool.length)]);
      if (result.length === before) {
        const remainder = length - result.length;
        const fitting = pool.flatMap(text => Array.from(text)).find(character => character.length <= remainder);
        if (!fitting) break;
        append(fitting);
      }
    }
    return result;
  }
  async function onlineText(random) {
    if (generationSession.error) throw new Error(generationSession.error);
    // A batch obtains at most five sentences, then reuses its local pool.
    if (generationSession.online.length >= 5) return generationSession.online[Math.floor(random() * generationSession.online.length)];
    await sleep(Math.max(0, 700 - (Date.now() - lastOnlineRequest)));
    if (cancelled) throw new Error('操作已停止');
    const controller = new AbortController(); activeRequest = controller;
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      lastOnlineRequest = Date.now();
      const response = await fetch('https://v1.hitokoto.cn/', { method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (typeof data.hitokoto !== 'string' || !data.hitokoto.trim() || data.hitokoto.length > 1000) throw new Error('接口返回格式不符');
      const text = data.hitokoto.trim(); generationSession.online.push(text); return text;
    } catch (error) {
      if (cancelled) throw new Error('操作已停止');
      generationSession.error = '在线短句暂不可用或被页面网络策略拦截；请改用本地文案（原值未改动）';
      throw new Error(generationSession.error);
    } finally { clearTimeout(timer); if (activeRequest === controller) activeRequest = null; }
  }
  function validateLibrary(text, requireContent = false) {
    if (typeof text !== 'string' || text.length > LIBRARY_LIMIT) throw new Error('自定义文本库最多 500000 字，请缩小文本后重试');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) throw new Error('文本库包含非文本控制字符，请使用纯文本 TXT');
    if (requireContent && !norm(text)) throw new Error('自定义文本库为空，请先粘贴文字或导入 TXT');
    return text;
  }
  function libraryPool(text) {
    validateLibrary(text, true);
    if (libraryCache.source === text) return libraryCache.pool;
    // Bound each fragment so a large, single-paragraph file can contribute from throughout its contents.
    const pool = [];
    for (const paragraph of text.split(/\r\n?|\n/).map(norm).filter(Boolean)) {
      let fragment = '', count = 0;
      for (const character of paragraph) {
        fragment += character;
        if (++count === 24) { pool.push(fragment); fragment = ''; count = 0; }
      }
      if (fragment) pool.push(fragment);
    }
    libraryCache = { source: text, pool };
    return pool;
  }
  function updateLibraryStatus() {
    const text = ui.libraryText.value, dirty = text !== libraryText;
    ui.libraryStatus.textContent = libraryError ? `读取失败：${libraryError}` :
      `${text.length.toLocaleString()} / ${LIBRARY_LIMIT.toLocaleString()} 字${dirty ? ' · 尚未保存' : text ? ' · 已保存于本机油猴' : ' · 尚未添加文本'}`;
  }
  async function saveLibrary() {
    if (libraryError) throw new Error('文本库读取失败，已禁止覆盖已有数据；请先检查油猴存储');
    if (libraryImporting) throw new Error('TXT 正在读取，请稍后再试');
    const text = validateLibrary(ui.libraryText.value);
    if (text !== libraryText) {
      // Store the shared corpus separately from page templates and generation settings.
      await GM_setValue(LIBRARY_STORAGE, text);
      libraryText = text;
    }
    updateLibraryStatus();
  }
  async function importTextLibrary(file) {
    if (!file) return;
    if (!/\.txt$/i.test(file.name)) throw new Error('请选择 .txt 纯文本文件');
    if (file.size > LIBRARY_FILE_LIMIT) throw new Error('TXT 文件不能超过 1 MB');
    const draft = ui.libraryText.value;
    libraryImporting = true; ui.importLibrary.disabled = true;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let encoding = 'utf-8', text;
      if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
      else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
      try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
      catch (error) {
        if (encoding !== 'utf-8') throw new Error('TXT 编码无法读取，请另存为 UTF-8 后重试');
        try { text = new TextDecoder('gb18030', { fatal: true }).decode(bytes); encoding = 'gb18030'; }
        catch (error) { throw new Error('TXT 编码无法读取，请另存为 UTF-8 后重试'); }
      }
      validateLibrary(text, true);
      if (ui.libraryText.value !== draft) throw new Error('读取期间文本库已被编辑，已保留当前内容；请重新导入');
      ui.libraryText.value = text; updateLibraryStatus();
      toast(`已读取 ${file.name}（${encoding.toUpperCase()}）；请保存文本库后使用`);
    } finally { libraryImporting = false; ui.importLibrary.disabled = busy; }
  }
  async function generatedText(f, random, config) {
    // Use the built-in text bank when the configured source is not recognized.
    const mode = Object.hasOwn(TEXT_MODES, config.mode) ? config.mode : 'auto';
    const bounds = textBounds(f, config, ['auto', 'library'].includes(mode) || String(config.minLength ?? '') !== '' || String(config.maxLength ?? '') !== '');
    let pool = TEXT_POOL, prefix = '';
    if (mode === 'library') pool = libraryPool(libraryText);
    if (mode === 'candidates') {
      pool = String(config.candidates || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!pool.length) throw new Error('请先填写候选文案，每行一条');
    }
    if (mode === 'online') pool = [await onlineText(random)];
    let length;
    if (!['auto', 'library'].includes(mode) && !bounds.custom) {
      prefix = pool[Math.floor(random() * pool.length)];
      length = Math.min(bounds.hi, Math.max(bounds.lo, prefix.length));
    } else length = bounds.lo + Math.floor(random() * (bounds.hi - bounds.lo + 1));
    const result = composeText(pool, length, random, prefix);
    if (result.length < bounds.lo) throw new Error('文本库字符无法满足当前字数限制，原值未改动');
    return result;
  }
  async function generate(f, seed) {
    const random = rng(`${seed}:${f.key}${f.unique ? '' : ':' + f.uid}`);
    const rule = ruleFor(f), settings = currentSettings();
    if (rule.mode === 'number') return generatedNumber(f, random, { ...settings.number, ...rule.number });
    if (f.kind === 'number') return generatedNumber(f, random);
    if (f.kind === 'date') return dateValue(f);
    if (f.kind === 'checkbox' || f.kind === 'switch') return true;
    if (f.kind === 'radio') {
      const opts = f.members.filter(e => !disabled(e));
      if (!opts.length) throw new Error('没有可选项');
      const e = opts[Math.floor(random() * opts.length)];
      return { value: e.value ?? e.getAttribute('data-value') ?? '', text: radioOptionLabel(e) };
    }
    if (f.kind === 'select') {
      const opts = arr(f.el.options).filter(o => o.value !== '' && !o.disabled && !o.parentElement.disabled);
      if (!opts.length) throw new Error('暂无可选项，可能需先填写上游字段');
      const e = opts[Math.floor(random() * opts.length)]; return [{ value: e.value, text: clean(e.textContent) }];
    }
    if (['combo', 'picker', 'cascader', 'tree'].includes(f.kind)) return { auto: true, seed };
    const format = textFormat(f);
    if (!format) return generatedText(f, random, rule.mode === 'text' ? { ...settings.text, ...rule.text } : settings.text);
    let value;
    const suffix = String(Math.floor(random() * 90000) + 10000);
    if (format === 'email') value = `test${suffix}@example.com`;
    else if (format === 'url') value = `https://example.com/test/${suffix}`;
    else if (format === 'tel') value = `138000${suffix}`;
    else if (format === 'color') value = '#2563eb';
    else if (format === 'postal') value = '610000';
    else if (format === 'number') value = generatedNumber(f, random);
    else if (format === 'year') value = String(new Date().getFullYear());
    else value = `TEST${suffix}`;
    if ((f.el.maxLength >= 0 && value.length > f.el.maxLength) || (f.el.minLength > 0 && value.length < f.el.minLength)) throw new Error('格式字段的生成值与网页长度限制不兼容，请设置固定值（原值未改动）');
    return value;
  }

  function setNative(el, property, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, property)?.set;
    if (setter) setter.call(el, value); else el[property] = value;
  }
  function dispatchValue(el) {
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false, composed: true }));
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
  }
  function pointerClick(el) {
    for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      const Ctor = name.startsWith('pointer') ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(name, { bubbles: true, cancelable: true, composed: true, button: 0 }));
    }
    el.click();
  }
  function multiCombo(el) { return el.matches('.ant-select-multiple') || el.getAttribute('aria-multiselectable') === 'true' || !!q('.el-tag,.el-select__tags', el); }
  function comboInput(el) { return el.matches('input,[role="combobox"]') ? el : q('input,[role="combobox"]', el); }
  function comboOptions(f) {
    const input = comboInput(f.el), ids = (input?.getAttribute('aria-controls') || input?.getAttribute('aria-owns') || f.el.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean);
    const linked = ids.map(id => document.getElementById(id)).filter(Boolean);
    let popups = linked.map(e => e.closest('.ant-select-dropdown,.el-select__popper,.el-select-dropdown') || e).filter(visible);
    if (!popups.length) {
      popups = qa('.ant-select-dropdown,.el-select__popper,.el-select-dropdown,[role="listbox"]').filter(visible);
      popups = popups.filter(p => !popups.some(other => other !== p && other.contains(p)));
      if (popups.length !== 1) return [];
    }
    const options = popups.flatMap(p => {
      const libraryOptions = qa('.el-select-dropdown__item,.ant-select-item-option', p);
      // Ant Design also renders an invisible ARIA list for virtual scrolling; it is not clickable.
      return libraryOptions.length ? libraryOptions : qa('[role="option"]', p);
    });
    return [...new Set(options)].filter(e => visible(e) && !disabled(e) && !e.classList.contains('ant-select-item-option-disabled') && !e.classList.contains('is-disabled')).map(e => ({ el: e, text: clean(q('.ant-select-item-option-content', e)?.textContent || e.textContent), selected: e.getAttribute('aria-selected') === 'true' || e.classList.contains('is-selected') || e.classList.contains('selected') || e.classList.contains('ant-select-item-option-selected') }));
  }
  async function closeCombo(f) {
    const input = comboInput(f.el) || f.el;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    input.blur?.();
    // Close only the active picker, without clicking any application button.
    if (comboOptions(f).length) pointerClick(host);
    await sleep(40);
  }
  async function setCombo(f, desired) {
    if (Array.isArray(desired) && desired.length === 0) {
      if (read(f).length === 0) return;
      throw new Error('空下拉值请手动清除，避免误触清空按钮');
    }
    const wanted = desired?.auto ? null : (Array.isArray(desired) ? desired : [desired]).map(v => typeof v === 'object' ? v.text : String(v));
    if (wanted && same(read(f), wanted)) return;
    const input = comboInput(f.el);
    const trigger = q('.ant-select-selector,.el-select__wrapper,.el-input__wrapper', f.el) || input || f.el;
    const isMulti = multiCombo(f.el) || (wanted?.length > 1);
    try {
      pointerClick(trigger);
      await sleep(100);
      const deadline = Date.now() + 2200;
      while (!comboOptions(f).length && Date.now() < deadline && !cancelled) await sleep(80);
      if (!comboOptions(f).length && wanted?.[0] && input && !input.readOnly && input.matches('input')) {
        setNative(input, 'value', wanted[0]); dispatchValue(input);
        await sleep(700);
      }
      let opts = comboOptions(f);
      if (!opts.length) throw new Error('未找到可见选项；远程搜索或未适配的下拉需手动加载');
      if (!wanted) {
        const pool = opts.filter(o => !o.selected);
        const opt = pool.length ? pool[Math.floor(rng(`${desired.seed}:${f.key}`)() * pool.length)] : opts[0]; pointerClick(opt.el); await sleep(160);
        if (!read(f).includes(opt.text)) throw new Error('点击后未确认选中值');
        return;
      }
      // Resolve every requested value before making changes to avoid partial matches.
      for (const text of wanted) if (opts.filter(o => o.text === text).length !== 1) throw new Error(`选项“${text}”未找到或不唯一（虚拟滚动/远程项需手动加载）`);
      if (isMulti) {
        for (const old of read(f)) {
          if (!wanted.includes(old)) {
            const found = comboOptions(f).find(o => o.text === old && o.selected);
            if (!found) throw new Error(`无法移除已有选项“${old}”`);
            pointerClick(found.el); await sleep(80);
          }
        }
      }
      for (const text of wanted) {
        if (read(f).includes(text)) continue;
        opts = comboOptions(f);
        if (!opts.length) { pointerClick(trigger); await sleep(100); opts = comboOptions(f); }
        const opt = opts.find(o => o.text === text);
        if (!opt) throw new Error(`选项“${text}”在更新后消失`);
        pointerClick(opt.el); await sleep(160);
      }
      if (!same([...read(f)].sort(), [...wanted].sort())) throw new Error('组件显示值与模板不一致');
    } finally { await closeCombo(f); }
  }
  // Component adapters use public DOM interactions, never React/Vue private state.
  function pickerInputs(el) { return (el.matches('input') ? [el] : qa('input', el)).filter(e => e.type !== 'hidden' && visible(e)); }
  function linkedTree(el) {
    return qa('[aria-controls],[aria-owns]', el).some(input => `${input.getAttribute('aria-controls') || ''} ${input.getAttribute('aria-owns') || ''}`.split(/\s+/).some(id => document.getElementById(id)?.closest('.el-tree-select__popper')));
  }
  function popupRoots() { const all = qa(POPUP).filter(visible); return all.filter(p => !all.some(other => other !== p && other.contains(p))); }
  function componentSession(f) { return { f, page: pageKey(), root: rootScope(), prior: new Set(popupRoots()), popup: null }; }
  function componentAlive(s) {
    if (cancelled || pageKey() !== s.page || !s.f.el.isConnected || rootScope() !== s.root || disabled(s.f.el) || pickerInputs(s.f.el).some(disabled)) throw new Error('页面或控件已变化，已停止组件填写');
  }
  async function componentWait(s, predicate, message, timeout = 3000) {
    const end = Date.now() + timeout;
    do { componentAlive(s); const result = predicate(); if (result) return result; await sleep(60); } while (Date.now() < end);
    throw new Error(message);
  }
  function ownedPopup(s) {
    const nodes = [s.f.el, ...pickerInputs(s.f.el)];
    const ids = nodes.flatMap(el => `${el.getAttribute('aria-controls') || ''} ${el.getAttribute('aria-owns') || ''}`.split(/\s+/)).filter(Boolean);
    const linked = ids.map(id => document.getElementById(id)).filter(Boolean);
    const roots = popupRoots();
    const matched = roots.filter(p => linked.some(el => p === el || p.contains(el) || el.contains(p)));
    const candidates = matched.length ? matched : roots.filter(p => !s.prior.has(p) || p === s.popup);
    if (candidates.length > 1) throw new Error('出现多个组件面板，无法确定归属');
    if (candidates.length === 1) s.popup = candidates[0];
    return candidates[0] || null;
  }
  function componentKey(el, key) { el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, composed: true })); }
  async function openComponent(s, index = 0) {
    componentAlive(s);
    const input = pickerInputs(s.f.el)[index] || comboInput(s.f.el) || s.f.el;
    input.focus({ preventScroll: true }); pointerClick(input);
    return componentWait(s, () => ownedPopup(s), '组件面板未打开，或无法确定面板归属');
  }
  async function closeComponent(s) {
    if (!s.f.el.isConnected || pageKey() !== s.page) return;
    for (const input of pickerInputs(s.f.el)) { componentKey(input, 'Escape'); input.blur(); }
    if (s.popup && visible(s.popup)) { pointerClick(host); await sleep(80); }
  }
  async function clearComponent(s) {
    if (isEmpty(read(s.f))) return;
    componentAlive(s);
    s.f.el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    s.f.el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    await sleep(80);
    const selector = s.f.kind === 'picker' ? '.ant-picker-clear,.el-input__clear,.el-range__close-icon,.clear-icon' : '.ant-select-clear,.el-input__clear,.el-select__clear,.el-select__caret.is-show-close,.el-cascader .icon-circle-close';
    const clear = q(selector, s.f.el);
    if (!clear || disabled(clear)) throw new Error('组件没有可用的清空按钮，原值未清除');
    pointerClick(clear);
    await componentWait(s, () => isEmpty(read(s.f)), '组件未接受清空操作');
  }
  function calendarCells(popup) {
    const selector = '.ant-picker-cell,.el-date-table td,.el-month-table td,.el-year-table td';
    return qa(selector, popup).filter(el => visible(el) && !disabled(el) && !el.matches('.ant-picker-cell-disabled,.disabled,.prev-month,.next-month,.week') &&
      (!el.matches('.ant-picker-cell') || el.classList.contains('ant-picker-cell-in-view')) && !!clean(el.textContent));
  }
  function cellTarget(cell) { return q('.ant-picker-cell-inner,.el-date-table-cell__text,.cell', cell) || cell; }
  function confirmButton(popup) {
    return qa('.ant-picker-ok button,.el-picker-panel__link-btn,.el-time-panel__btn.confirm', popup).find(el => visible(el) && !disabled(el) && /^(确定|确认|OK|Confirm)$/i.test(clean(el.textContent).replace(/\s+/g, '')));
  }
  async function chooseTime(s, popup, random) {
    const timeInputs = qa('.el-date-picker__time-header input,.el-date-range-picker__time-header input', popup).filter(el => visible(el) && !disabled(el) && /^\d{2}:\d{2}/.test(el.value));
    for (const input of timeInputs) {
      componentAlive(s); input.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
      const panel = await componentWait(s, () => qa('.el-time-panel', popup).find(visible), '时间面板未打开');
      await chooseTimeColumns(s, panel, random);
      const confirm = confirmButton(panel);
      if (!confirm) throw new Error('时间尚未达到可确认状态');
      pointerClick(confirm);
      await componentWait(s, () => !panel.isConnected || !visible(panel), '时间面板未关闭');
    }
    if (!timeInputs.length) await chooseTimeColumns(s, popup, random);
  }
  async function chooseTimeColumns(s, popup, random) {
    for (const selector of ['.ant-picker-time-panel-column', '.el-time-spinner__wrapper']) {
      const columns = qa(selector, popup).filter(visible);
      for (const column of columns) {
        componentAlive(s);
        const choices = qa('.ant-picker-time-panel-cell,.el-time-spinner__item', column).filter(el => visible(el) && !disabled(el) && !el.matches('.ant-picker-time-panel-cell-disabled,.is-disabled') && /^\d/.test(clean(el.textContent)));
        if (!choices.length) throw new Error('时间列没有可选值');
        pointerClick(choices[Math.floor(random() * choices.length)]); await sleep(100);
      }
    }
  }
  async function setPicker(f, desired) {
    const s = componentSession(f), before = read(f), inputs = pickerInputs(f.el), wanted = desired?.auto ? null : desired;
    if (!inputs.length || inputs.length > 2) throw new Error('日期组件输入结构暂不支持');
    if (wanted && (!Array.isArray(wanted) || (wanted.length && wanted.length !== inputs.length))) throw new Error('日期范围需要开始和结束两个值，以逗号分隔');
    try {
      if (wanted && !wanted.length) { await clearComponent(s); return; }
      if (wanted && same(before, wanted)) return;
      let popup = await openComponent(s);
      if (wanted && inputs.length === 2 && f.el.matches('.el-date-editor')) {
        // Element range change commits both endpoints together. Updating one endpoint
        // first can be rejected against the old opposite endpoint.
        for (let i = 0; i < inputs.length; i++) {
          componentAlive(s);
          setNative(inputs[i], 'value', wanted[i]);
          inputs[i].dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          await sleep(80);
        }
        componentKey(inputs[1], 'Enter');
        await sleep(150);
      } else if (wanted) {
        for (let i = 0; i < inputs.length; i++) {
          componentAlive(s);
          const input = pickerInputs(f.el)[i];
          if (i) popup = await openComponent(s, i);
          // Popup-only inputs still expose the component's input/change handlers.
          // Opening the picker above verifies that the component itself is editable.
          input.focus({ preventScroll: true }); setNative(input, 'value', wanted[i]);
          input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
          await sleep(100); // Let controlled inputs render before committing.
          input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          componentKey(input, 'Enter'); await sleep(150); input.blur();
        }
      } else {
        const random = rng(`${desired.seed}:${f.key}`);
        // Pick through the calendar so locale, format and disabledDate remain authoritative.
        for (let selection = 0; selection < 6; selection++) {
          componentAlive(s); popup = ownedPopup(s);
          if (!popup) break;
          const cells = calendarCells(popup);
          if (cells.length) {
            const alternative = cells.filter(el => !el.matches('.ant-picker-cell-selected,.current,.start-date,.end-date'));
            const choices = alternative.length ? alternative : cells;
            pointerClick(cellTarget(choices[Math.floor(random() * choices.length)])); await sleep(150);
          }
          popup = ownedPopup(s);
          if (!popup) break;
          // Only commit time after the date (both endpoints for a range) is chosen.
          if (!cells.length || inputs.length === 1 || selection >= 1) {
            await chooseTime(s, popup, random);
            const confirm = confirmButton(popup);
            if (confirm) {
              pointerClick(confirm); await sleep(150);
              if (read(f).length === inputs.length && read(f).every(Boolean)) break;
            }
          }
          if (!cells.length) break;
        }
      }
      popup = ownedPopup(s);
      const confirm = popup && confirmButton(popup);
      if (confirm) { pointerClick(confirm); await sleep(150); }
      await closeComponent(s);
      await componentWait(s, () => { const values = read(f); return values.length === inputs.length && values.every(Boolean) && (!wanted || same(values, wanted)); }, '日期未提交或被页面重置，请检查格式和可选范围');
      await sleep(150);
      if (wanted && !same(read(f), wanted)) throw new Error('日期值未保持');
    } finally { await closeComponent(s); }
  }
  function hierarchyValues(el) {
    const tags = qa('.ant-select-selection-item,.el-tag__content,.el-cascader__tags .el-tag > span', el).filter(visible).map(n => clean(n.getAttribute('title') || n.textContent)).filter(Boolean);
    if (tags.length) return [...new Set(tags)];
    const antValue = q('.ant-select-content-has-value', el);
    if (antValue && !el.matches('.ant-select-multiple')) return [clean(antValue.getAttribute('title') || antValue.textContent)].filter(Boolean);
    const selected = qa('.el-select__selected-item:not(.is-transparent),.ant-select-content-value', el).find(n => !q('input', n) && visible(n) && clean(n.textContent));
    if (selected && !el.classList.contains('is-empty')) return [clean(selected.textContent)];
    const input = q('input', el);
    return input?.value ? [clean(input.value)] : [];
  }
  function hierarchyColumns(popup) { return qa('.ant-cascader-menu,.el-cascader-menu', popup).filter(visible); }
  function hierarchyNodes(popup, kind, depth = 0, parent = null) {
    if (kind === 'cascader') {
      const column = hierarchyColumns(popup)[depth];
      return column ? qa('.ant-cascader-menu-item,.el-cascader-node', column).filter(visible) : [];
    }
    const nodes = qa('.ant-select-tree-treenode,.el-tree-node', popup).filter(visible);
    if (nodes.some(n => n.matches('.el-tree-node'))) return nodes.filter(n => n.parentElement.closest('.el-tree-node') === parent);
    // Ant tree nodes are flat DOM rows; indentation exposes their hierarchy.
    const level = n => qa('.ant-select-tree-indent-unit', n).length;
    if (!parent) return nodes.filter(n => level(n) === 0);
    const start = nodes.indexOf(parent);
    if (start < 0) return [];
    const siblings = nodes.slice(start + 1), end = siblings.findIndex(n => level(n) < depth);
    return (end < 0 ? siblings : siblings.slice(0, end)).filter(n => level(n) === depth);
  }
  function nodeLabel(node) { return clean((q('.ant-cascader-menu-item-content,.el-cascader-node__label,.ant-select-tree-title,:scope > .el-tree-node__content .el-select-dropdown__item,:scope > .el-tree-node__content .el-tree-node__label', node) || node).textContent); }
  function nodeDisabled(node) { return disabled(node) || node.matches('.ant-cascader-menu-item-disabled,.ant-select-tree-treenode-disabled,.is-disabled') || !!q(':scope > .el-tree-node__content .el-checkbox.is-disabled,:scope > .el-checkbox.is-disabled,:scope > .ant-select-tree-checkbox-disabled', node); }
  function nodeBranch(node, kind) {
    if (kind === 'cascader') return !!q('.ant-cascader-menu-item-expand,.ant-cascader-menu-item-expand-icon,.el-cascader-node__postfix', node) || node.getAttribute('aria-haspopup') === 'true';
    const expand = q('.ant-select-tree-switcher,.el-tree-node__expand-icon', node);
    return !!expand && !expand.matches('.ant-select-tree-switcher-noop,.is-leaf');
  }
  async function expandNode(s, node) {
    const target = s.f.kind === 'tree' ? q('.ant-select-tree-switcher,.el-tree-node__expand-icon', node) : q('.el-cascader-node__label,.ant-cascader-menu-item-content', node) || node;
    if (!target) throw new Error('无法展开此节点');
    target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
    if (!(s.f.kind === 'tree' && (node.getAttribute('aria-expanded') === 'true' || node.matches('.is-expanded') || target.matches('.ant-select-tree-switcher_open')))) pointerClick(target);
    await sleep(100);
    await componentWait(s, () => !node.matches('.ant-cascader-menu-item-loading') && !q('.is-loading,.ant-select-tree-switcher-loading-icon', node) && (s.f.kind !== 'cascader' || node.matches('.ant-cascader-menu-item-active,[aria-expanded="true"]')), '下级选项加载超时');
  }
  async function hierarchyPaths(s) {
    const leaves = [], branches = []; let visited = 0;
    async function walk(depth, path, parent) {
      if (depth >= 16) throw new Error('选项层级超出自动遍历范围');
      const popup = ownedPopup(s); if (!popup) throw new Error('选择面板意外关闭');
      const names = hierarchyNodes(popup, s.f.kind, depth, parent).filter(n => !nodeDisabled(n)).map(nodeLabel);
      for (const name of names) {
        componentAlive(s);
        if (++visited > 300) throw new Error('选项数量超出自动遍历范围');
        const matches = hierarchyNodes(popup, s.f.kind, depth, parent).filter(n => nodeLabel(n) === name && !nodeDisabled(n));
        if (matches.length !== 1) throw new Error('同层存在重名选项，请增加可区分名称');
        const node = matches[0], nextPath = [...path, name];
        if (!nodeBranch(node, s.f.kind)) { leaves.push(nextPath); continue; }
        branches.push(nextPath);
        await expandNode(s, node);
        await componentWait(s, () => hierarchyNodes(popup, s.f.kind, depth + 1, s.f.kind === 'tree' ? node : null).length, `“${name}”的下级选项未加载`);
        await walk(depth + 1, nextPath, s.f.kind === 'tree' ? node : null);
        // Collapse Ant's flat rows before walking another branch with the same depth.
        if (s.f.kind === 'tree' && node.matches('.ant-select-tree-treenode')) { pointerClick(q('.ant-select-tree-switcher', node)); await sleep(80); }
      }
    }
    await componentWait(s, () => { const popup = ownedPopup(s); return popup && hierarchyNodes(popup, s.f.kind).length; }, '暂无可选项或选项尚未加载');
    await walk(0, [], null); return { leaves, branches };
  }
  async function selectHierarchyPath(s, path) {
    let parent = null;
    for (let depth = 0; depth < path.length; depth++) {
      componentAlive(s);
      const popup = ownedPopup(s) || await openComponent(s);
      const nodes = await componentWait(s, () => { const nodes = hierarchyNodes(popup, s.f.kind, depth, parent); return nodes.length && nodes; }, '下级选项未加载');
      const matches = nodes.filter(n => nodeLabel(n) === path[depth] && !nodeDisabled(n));
      if (matches.length !== 1) throw new Error(`选项“${path[depth]}”缺失、禁用或不唯一`);
      const node = matches[0];
      if (depth < path.length - 1) { await expandNode(s, node); parent = s.f.kind === 'tree' ? node : null; }
      else {
        const checkbox = q(':scope > .ant-cascader-checkbox,:scope > .el-checkbox .el-checkbox__input,:scope > .ant-select-tree-checkbox,:scope > .el-tree-node__content .el-checkbox__input', node);
        pointerClick(checkbox || q('.ant-select-tree-node-content-wrapper,.el-tree-node__content,.el-cascader-node__label,.ant-cascader-menu-item-content', node) || node);
        await sleep(150);
      }
    }
  }
  async function setHierarchy(f, desired) {
    const s = componentSession(f), before = read(f), wanted = desired?.auto ? null : desired;
    if (wanted && (!Array.isArray(wanted) || !wanted.every(v => typeof v === 'string'))) throw new Error('级联选项格式错误');
    try {
      if (wanted && !wanted.length) { await clearComponent(s); return; }
      if (wanted && same(before, wanted)) return;
      await openComponent(s);
      const { leaves, branches } = await hierarchyPaths(s), catalog = [...leaves, ...branches];
      if (!leaves.length) throw new Error('没有可选的末级选项');
      const displayKey = text => text.split(/\s*\/\s*/).join('/');
      let paths;
      if (wanted) paths = wanted.map(text => {
        const matches = catalog.filter(path => displayKey(path.join('/')) === displayKey(text) || path.at(-1) === text);
        if (matches.length !== 1) throw new Error(`选项“${text}”缺失或有歧义，请填写完整路径（上级 / 下级）`);
        return matches[0];
      });
      else {
        const different = leaves.filter(p => !before.some(v => displayKey(v) === displayKey(p.join('/')) || v === p.at(-1)));
        const pool = different.length ? different : leaves;
        paths = [pool[Math.floor(rng(`${desired.seed}:${f.key}`)() * pool.length)]];
      }
      // Libraries can collapse fully checked children into a parent tag. Compare
      // the represented leaf sets so the default SHOW_PARENT display also works.
      const represented = selected => [...new Set(selected.flatMap(path => leaves.filter(leaf => path.every((name, i) => leaf[i] === name)).map(path => path.join('/'))))].sort();
      const expected = represented(paths);
      if (!expected.length) throw new Error('选中路径没有可用的末级项');
      paths = paths.filter((path, i) => paths.findIndex(other => same(path, other)) === i);
      const popup = ownedPopup(s), multiple = multiCombo(f.el) || !!q('.ant-cascader-checkbox,.el-cascader-node .el-checkbox,.ant-select-tree-checkbox,.el-tree-node .el-checkbox', popup);
      if (!multiple && paths.length > 1) throw new Error('当前组件不支持多选');
      if (multiple && before.length) { await closeComponent(s); await clearComponent(s); await openComponent(s); }
      for (const path of paths) { if (!ownedPopup(s)) await openComponent(s); await selectHierarchyPath(s, path); }
      await closeComponent(s);
      await componentWait(s, () => {
        const selected = read(f).map(text => catalog.filter(path => (displayKey(path.join('/')) === displayKey(text) || path.at(-1) === text) && represented([path]).every(key => expected.includes(key))));
        return selected.every(matches => matches.length === 1) && same(represented(selected.map(matches => matches[0])), expected);
      }, '组件选择未提交，或显示格式无法核对');
    } finally { await closeComponent(s); }
  }
  async function write(f, value, restoring = false) {
    if (f.reason) throw new Error(f.reason);
    if (f.kind === 'picker') return setPicker(f, value);
    if (f.kind === 'cascader' || f.kind === 'tree') return setHierarchy(f, value);
    if (f.kind === 'combo') return setCombo(f, value);
    if (f.kind === 'radio') {
      if (!value) {
        for (const el of f.members.filter(e => e.checked)) { setNative(el, 'checked', false); dispatchValue(el); }
        return;
      }
      const exact = f.members.filter(el => (el.value ?? el.getAttribute('data-value') ?? '') === value.value && radioOptionLabel(el) === value.text);
      const opts = exact.length ? exact : f.members.filter(el => radioOptionLabel(el) === value.text);
      if (opts.length !== 1 || disabled(opts[0])) throw new Error('单选项缺失、禁用或不唯一');
      if (!opts[0].checked && opts[0].getAttribute('aria-checked') !== 'true') opts[0].click();
    } else if (f.kind === 'checkbox' || f.kind === 'switch') {
      if (read(f) !== !!value) f.el.click();
    } else if (f.kind === 'select') {
      const values = Array.isArray(value) ? value : [];
      const options = values.map(v => {
        const exact = arr(f.el.options).filter(o => o.value === v.value && clean(o.textContent) === v.text);
        const matched = exact.length ? exact : arr(f.el.options).filter(o => clean(o.textContent) === v.text);
        if (matched.length !== 1 || matched[0].disabled || matched[0].parentElement.disabled) throw new Error(`下拉选项“${v.text}”缺失、禁用或不唯一`);
        return matched[0];
      });
      if (!f.el.multiple && options.length > 1) throw new Error('当前下拉框不支持多选');
      for (const option of f.el.options) option.selected = options.includes(option);
      if (!options.length) f.el.selectedIndex = -1;
      dispatchValue(f.el);
    } else {
      const desired = String(value ?? '');
      const probe = f.el.cloneNode(false); probe.value = desired;
      if (desired && probe.value !== desired && f.kind !== 'number') throw new Error('值不符合控件格式');
      if (!restoring && probe.validity && !probe.validity.valid) throw new Error(validationMessage(probe));
      setNative(f.el, 'value', desired); dispatchValue(f.el);
    }
    await sleep(90);
    const actual = read(f);
    if (f.kind === 'select') {
      const expected = (value || []).map(v => v.text).sort();
      if (!same(actual.map(v => v.text).sort(), expected)) throw new Error('选中结果未保持');
    } else if (f.kind === 'radio') {
      if ((value?.text ?? null) !== (actual?.text ?? null)) throw new Error('单选值未保持');
    } else if (!same(actual, f.kind === 'number' ? String(value) : value)) throw new Error('值被页面重置或转换，请检查业务规则');
  }
  function validationMessage(el) {
    const v = el.validity;
    if (v?.patternMismatch) return '不符合字段格式 pattern，请设置固定规则';
    if (v?.rangeOverflow || v?.rangeUnderflow) return '数值超出 min/max 范围';
    if (v?.stepMismatch) return '不符合 step 步长';
    if (v?.typeMismatch || v?.badInput) return '值的格式不正确';
    if (v?.valueMissing) return '必填字段为空';
    return el.validationMessage || '浏览器校验未通过';
  }
  function fieldError(f) {
    if (f.el.validity && !f.el.validity.valid) return validationMessage(f.el);
    const wrap = f.el.closest(WRAP);
    const msg = wrap && qa('.el-form-item__error,.ant-form-item-explain-error,[role="alert"]', wrap).filter(visible).map(e => clean(e.textContent)).join('；');
    if (msg) return msg;
    if (f.el.getAttribute('aria-invalid') === 'true') return '页面标记此字段校验失败';
    return '';
  }

  function report(label, status, message, descriptor) {
    reports.push({ label, status, message, descriptor }); renderReports();
  }
  function parseFixed(f, value) {
    if (['picker', 'cascader', 'tree'].includes(f.kind)) return value.replace(/\{date\}/g, new Date().toLocaleDateString('sv-SE')).replace(/\{seed\}/g, ui.seed.value).replace(/\{timestamp\}/g, String(Date.now())).split(/[,，\n]|\s*~\s*/).map(clean).filter(Boolean);
    if (f.kind === 'checkbox' || f.kind === 'switch') {
      if (/^(true|1|是|开|选中)$/i.test(value.trim())) return true;
      if (/^(false|0|否|关|未选中)$/i.test(value.trim())) return false;
      throw new Error('复选/开关固定值请填写 true 或 false');
    }
    if (f.kind === 'combo') return value.split(/[,，\n]/).map(clean).filter(Boolean);
    if (f.kind === 'select') return value.split(/[,，\n]/).map(clean).filter(Boolean).map(text => {
      const opts = arr(f.el.options).filter(o => clean(o.textContent) === text || o.value === text);
      if (opts.length !== 1) throw new Error(`固定选项“${text}”未找到或不唯一`);
      return { value: opts[0].value, text: clean(opts[0].textContent) };
    });
    if (f.kind === 'radio') {
      const opts = f.members.filter(e => radioOptionLabel(e) === value || e.value === value);
      if (opts.length !== 1) throw new Error('固定单选值未找到或不唯一');
      return { value: opts[0].value ?? '', text: radioOptionLabel(opts[0]) };
    }
    return value.replace(/\{date\}/g, new Date().toLocaleDateString('sv-SE')).replace(/\{seed\}/g, ui.seed.value).replace(/\{timestamp\}/g, String(Date.now()));
  }
  async function run(mode) {
    if (busy) return;
    busy = true; cancelled = false; setBusy(true);
    let started = false;
    try {
      await saveRuleEdits();
      if (cancelled) return toast('已停止，本次未填写');
      refreshFields(true);
      const startPage = pageKey(), startRoot = rootScope(), overwrite = mode === 'refresh' || ui.overwrite.checked;
      const template = db.templates.find(t => t.id === ui.templates.value);
      if (mode === 'template' && !template) return toast('请先选择模板');
      if (mode === 'template' && template.page.origin !== location.origin) return toast('模板属于其他网站，请在对应网站使用');
      if (!fields.some(f => !f.reason && ruleFor(f).mode !== 'skip' && !f.ruleBlocked)) return toast('当前表单没有可填写项；请检查跳过、禁用或无法对应的旧规则');
      reports = []; history = []; started = true;
      generationSession = { online: [], error: '' };
      historyPage = startPage; historyRoot = startRoot;
      // Quick refill uses a new batch seed without changing the reproducibility setting.
      const seed = mode === 'refresh' ? `${ui.seed.value || '1'}:${uid()}` : ui.seed.value || '1';
      const entries = mode === 'template' ? template.fields : fields.map(liveReference);
      const done = new Set(), planned = entries.slice();
      const pending = entries.map(entry => ({ entry }));
      const successes = [];
      // Bounded rescanning handles conditional fields and upstream option loading.
      for (let pass = 0; pass < 3 && pending.length && !cancelled; pass++) {
        const count = pending.length;
        for (let i = 0; i < count && !cancelled; i++) {
          const task = pending.shift(), entry = task.entry;
          if (pageKey() !== startPage || !startRoot.isConnected || rootScope() !== startRoot) { cancelled = true; report('任务', 'skip', '页面或表单已变化，已停止'); break; }
          const candidates = collect(startRoot), match = matchLive(entry, candidates);
          const label = entry.descriptor.label || entry.descriptor.name || '未命名字段';
          if (!match.field) {
            if (pass < 2) pending.push(task); else report(label, 'skip', match.reason);
            continue;
          }
          const f = match.field;
          if (done.has(f.uid)) { report(label, 'skip', '多个填写任务指向同一控件'); continue; }
          if (mode !== 'template') entry.element = f.el;
          const rule = ruleFor(f);
          if (f.reason === '控件已禁用' && pass < 2) { pending.push(task); continue; }
          if (f.reason || f.ruleBlocked || rule.mode === 'skip') { report(f.label, 'skip', f.reason || f.ruleBlocked || '规则设为跳过'); done.add(f.uid); continue; }
          const before = read(f);
          if (!overwrite && !isEmpty(before)) { report(f.label, 'skip', '已有内容，保留'); done.add(f.uid); continue; }
          try {
            const value = mode === 'template' ? entry.value : rule.mode === 'fixed' ? parseFixed(f, rule.value) : mode === 'refresh' ? await generateDifferent(f, before, seed) : await generate(f, seed);
            if (cancelled || pageKey() !== startPage || !f.el.isConnected || rootScope() !== startRoot) throw new Error('页面已变化或操作已停止，未写入');
            if (!matchLive(liveReference(f), collect(startRoot)).field) throw new Error('生成期间控件标签或用途已变化，未写入');
            if (!same(read(f), before)) throw new Error('生成期间字段被修改，已保留新内容');
            // Capture before touching the control, including attempts that partially fail.
            const snapshot = { ...liveReference(f), value: before, after: undefined };
            history.push(snapshot);
            try { await write(f, value); }
            finally { snapshot.after = read(f); }
            const error = fieldError(f);
            report(f.label, error ? 'warn' : 'ok', error || '已填写并核对显示值', f.desc);
            successes.push({ ...liveReference(f), value: read(f), reportIndex: reports.length - 1 }); done.add(f.uid);
          } catch (err) {
            if (pass < 2 && /暂无可选项/.test(err.message)) pending.push(task);
            else { report(f.label, 'fail', err.message, f.desc); done.add(f.uid); }
          }
        }
        if (pass < 2 && !cancelled) {
          await sleep(250);
          if (mode !== 'template' && pageKey() === startPage) {
            for (const f of collect(startRoot)) if (planned.length < 500 && !planned.some(entry => entry.element === f.el)) {
              const related = planned.filter(entry => same(entry.descriptor, f.desc));
              if (related.length && (f.unique || related.some(entry => !entry.element?.isConnected))) continue;
              const entry = liveReference(f); planned.push(entry); pending.push({ entry });
            }
          }
        }
      }
      if (!cancelled && pageKey() === startPage) {
        await sleep(220);
        const latest = collect(startRoot);
        for (const result of successes) {
          const f = matchLive(result, latest).field;
          const error = f ? fieldError(f) || (!same(read(f), result.value) ? '后续联动改变了此字段，请检查' : '') : '字段在联动后消失';
          if (error) Object.assign(reports[result.reportIndex], { status: 'warn', message: error });
        }
      }
      if (cancelled) report('任务', 'skip', '已停止；之前的字段改动仍保留');
    } finally {
      busy = false; setBusy(false);
      if (started) {
        refreshFields(false); renderReports();
        const count = reports.filter(r => r.status === 'ok').length;
        toast(`${cancelled ? '已停止' : '完成'}：${count} 项已填，${reports.filter(r => r.status === 'fail' || r.status === 'warn').length} 项需检查`, true);
      }
    }
  }
  async function generateDifferent(f, before, seed) {
    if (f.kind === 'checkbox' || f.kind === 'switch') return !before;
    let value = await generate(f, seed);
    const rule = ruleFor(f);
    const online = (rule.mode === 'text' ? rule.text?.mode : currentSettings().text.mode) === 'online';
    for (let attempt = 0; attempt < 8 && !online && !cancelled && same(value, before); attempt++) value = await generate(f, `${seed}:${attempt}`);
    return value;
  }
  async function randomizeOne(reference) {
    if (busy) return;
    busy = true; cancelled = false; setBusy(true); reports = [];
    generationSession = { online: [], error: '' };
    let label = reference.descriptor.label || '此字段';
    try {
      await saveRuleEdits();
      const root = rootScope(), page = pageKey(), match = matchLive(reference, collect(root));
      if (!match.field) throw new Error(match.reason);
      const f = match.field, rule = ruleFor(f); label = f.label;
      if (f.reason || f.ruleBlocked || rule.mode === 'skip') throw new Error(f.reason || f.ruleBlocked || '字段规则为跳过');
      const before = read(f), seed = `${ui.seed.value}:${uid()}`;
      let value;
      if (rule.mode === 'fixed') value = parseFixed(f, rule.value);
      else value = await generateDifferent(f, before, seed);
      if (cancelled || pageKey() !== page || !root.isConnected || rootScope() !== root || !f.el.isConnected) throw new Error('页面已变化或操作已停止，未写入');
      if (!matchLive(liveReference(f), collect(root)).field) throw new Error('生成期间控件标签或用途已变化，未写入');
      if (!same(read(f), before)) throw new Error('生成期间字段被修改，已保留新内容');
      if (same(value, before)) { report(label, 'skip', '本次生成与原值相同，可调整规则或再次点击'); toast(`${label}：本次值相同，未改动`); return; }
      const snapshot = { ...liveReference(f), value: before, after: undefined };
      history = [snapshot]; historyPage = page; historyRoot = root;
      try { await write(f, value); } finally { snapshot.after = read(f); }
      await sleep(160);
      const error = fieldError(f) || (!same(read(f), snapshot.after) ? '页面联动改变了该值，请检查' : '');
      report(label, error ? 'warn' : 'ok', error || '已单独更新此字段', f.desc);
      toast(error ? `${label}：${error}` : `已更新「${label}」`, true);
    } catch (error) { report(label, 'fail', error.message); toast(`${label}：${error.message}`); }
    finally { busy = false; setBusy(false); refreshFields(false); scheduleInline(true); }
  }
  async function undo() {
    if (busy || !history.length) return toast('暂无可恢复的本次改动');
    if (pageKey() !== historyPage || rootScope() !== historyRoot) return toast('页面或填写范围已变化，无法恢复之前的改动');
    busy = true; cancelled = false; setBusy(true); reports = [];
    const snapshots = history.slice().reverse(); history = [];
    try {
      for (const snapshot of snapshots) {
        if (cancelled || pageKey() !== historyPage || rootScope() !== historyRoot) break;
        const match = matchLive(snapshot, collect(rootScope()));
        if (!match.field) { report(snapshot.descriptor.label, 'skip', match.reason); continue; }
        const f = match.field;
        if (!same(read(f), snapshot.after)) { report(f.label, 'skip', '填写后被再次修改，保留当前值'); continue; }
        if (f.kind === 'combo' || (f.kind === 'radio' && snapshot.value == null)) { report(f.label, 'skip', '该组件的空值恢复需手动处理'); continue; }
        try { await write(f, snapshot.value, true); report(f.label, 'ok', '已恢复原值'); }
        catch (err) { report(f.label, 'fail', err.message); }
      }
    } finally { busy = false; setBusy(false); refreshFields(false); toast('恢复完成；页面联动和自动保存需自行检查'); }
  }

  async function persist() {
    await GM_setValue(STORAGE, JSON.stringify(db));
  }
  function readNumberSettings(root) {
    const result = { mode: q('.num-mode', root).value, min: q('.num-min', root).value.trim(), max: q('.num-max', root).value.trim(), decimals: q('.num-decimals', root).value };
    if (result.mode !== 'auto') {
      for (const key of ['min', 'max']) if (result[key] !== '' && (!Number.isFinite(Number(result[key])) || Math.abs(Number(result[key])) > 1e12)) throw new Error('数字上下限需为 ±1 万亿以内的数值');
      if (result.min !== '' && result.max !== '' && Number(result.min) > Number(result.max)) throw new Error('随机范围的最小值不能大于最大值');
      if (!/^[0-6]$/.test(result.decimals)) throw new Error('最多小数位请选择 0～6');
    }
    return result;
  }
  function readTextSettings(root) {
    const result = { mode: q('.text-mode', root).value, candidates: q('.text-candidates', root).value, minLength: q('.text-min', root).value.trim(), maxLength: q('.text-max', root).value.trim() };
    textLengthSettings(result);
    if (result.mode === 'candidates' && !result.candidates.trim()) throw new Error('自定义候选文案不能为空，请每行填写一条');
    if (result.mode === 'library') {
      if (libraryError) throw new Error('自定义文本库读取失败，请检查油猴存储');
      if (libraryImporting) throw new Error('TXT 正在读取，请稍后再试');
      validateLibrary(ui.libraryText.value, true);
    }
    return result;
  }
  async function saveRuleEdits() {
    if (!ui || renderedRuleKey !== ruleKey() || renderedRoot !== rootScope()) return;
    const scope = ruleKey(), rules = { ...currentRules() }, localEdits = [];
    for (const row of qa('.field', ui.fields)) {
      const f = fields.find(item => item.uid === row.dataset.key); if (!f) continue;
      const mode = q('.mode', row).value, value = q('.fixed', row).value;
      if (mode === 'auto' && !row.dataset.edited && ruleFor(f).mode === 'auto') continue;
      const rule = { mode, value, ...(mode === 'number' ? { number: readNumberSettings(q('.numeric-config', row)) } : {}), ...(mode === 'text' ? { text: readTextSettings(q('.text-config', row)) } : {}) };
      // Keep opaque legacy entries. An explicit auto rule overrides an older rule.
      if (f.unique) rules[f.key] = { ...rule, descriptor: f.desc };
      else localEdits.push({ f, rule });
    }
    const settings = { number: readNumberSettings(ui.numberSettings), text: readTextSettings(ui.textSettings) };
    if (ui.libraryText.value !== libraryText) await saveLibrary();
    const previousRules = db.rules[scope], previousSettings = db.settings[scope];
    db.rules[scope] = rules; db.settings[scope] = settings;
    try { await persist(); }
    catch (error) { db.rules[scope] = previousRules; db.settings[scope] = previousSettings; throw error; }
    for (const { f, rule } of localEdits) sessionRules.set(f.el, { scope, key: f.key, rule });
    sessionRuleRevision++;
    for (const row of qa('.field', ui.fields)) delete row.dataset.edited;
    updateRuleHints();
  }
  async function saveTemplate() {
    await saveRuleEdits(); refreshFields(false);
    if (!ui.templateName.value.trim()) suggestTemplateName(true);
    const name = ui.templateName.value.trim();
    const eligible = fields.filter(f => !f.reason && ruleFor(f).mode !== 'skip' && !f.ruleBlocked);
    const saved = eligible.filter(f => f.unique).map(f => ({ descriptor: f.desc, value: read(f) }));
    const ambiguous = eligible.length - saved.length;
    if (!saved.length) return toast('当前范围没有可可靠保存的字段；同名且无法区分的项不保存到模板');
    const matching = db.templates.find(t => t.name === name && t.page.origin === location.origin && t.page.path === pageInfo().path && t.scope === scopeKey());
    if (matching && !confirm(`覆盖当前页面的同名模板“${name}”？`)) return;
    const template = { id: matching?.id || uid(), name, page: pageInfo(), scope: scopeKey(), fields: saved, createdAt: matching?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    db.templates = db.templates.filter(t => t.id !== template.id).concat(template);
    await persist(); renderTemplates(template.id); suggestTemplateName(true); toast(`已保存“${name}”（${saved.length} 项）${ambiguous ? `；${ambiguous} 个同名且无法区分的字段未保存` : '；已生成下一个默认名称'}`);
  }
  function validateTemplate(t) {
    const str = (s, max = 1000) => typeof s === 'string' && s.length <= max;
    if (!t || !str(t.name, 120) || !t.page || !str(t.page.origin) || !/^https?:\/\//.test(t.page.origin) || !str(t.page.path) || !Array.isArray(t.fields) || t.fields.length > 500) throw new Error('模板结构不合法');
    const fields = t.fields.map(entry => {
      const d = entry?.descriptor;
      if (!d || !['text', 'textarea', 'number', 'date', 'select', 'combo', 'picker', 'cascader', 'tree', 'radio', 'checkbox', 'switch'].includes(d.kind)) throw new Error('模板包含不支持的字段类型');
      const descriptor = {};
      for (const key of ['kind', 'type', 'name', 'id', 'testid', 'label', 'context', 'placeholder']) { if (!str(d[key] ?? '')) throw new Error('字段标识过长'); descriptor[key] = d[key] || ''; }
      const v = entry.value;
      if (d.kind === 'checkbox' || d.kind === 'switch') { if (typeof v !== 'boolean') throw new Error('布尔值格式错误'); }
      else if (['combo', 'picker', 'cascader', 'tree'].includes(d.kind)) { if (!Array.isArray(v) || v.length > (d.kind === 'picker' ? 2 : 100) || !v.every(x => str(x))) throw new Error('组件选项格式错误'); }
      else if (d.kind === 'select' || d.kind === 'radio') {
        const list = d.kind === 'select' ? v : v == null ? [] : [v];
        if (!Array.isArray(list) || list.length > 100 || !list.every(x => x && str(x.value) && str(x.text))) throw new Error('选项格式错误');
      } else if (!str(v, 100000)) throw new Error('字段值格式错误');
      return { descriptor, value: v };
    });
    return { id: uid(), name: t.name, page: { origin: t.page.origin, path: t.page.path, title: str(t.page.title) ? t.page.title : '' }, scope: str(t.scope) ? t.scope : '', fields, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }
  function exportTemplates() {
    const templates = db.templates.filter(t => t.page.origin === location.origin);
    if (!templates.length) return toast('当前网站暂无模板');
    const blob = new Blob([JSON.stringify({ format: 'test-form-assistant', schema: 1, templates }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `form-templates-${location.hostname}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); toast('已导出当前网站的模板（包含字段值）');
  }
  async function importTemplates(file) {
    if (!file) return;
    const importCurrentSite = ui.importCurrentSite.checked, targetOrigin = location.origin;
    if (file.size > 3 * 1024 * 1024) throw new Error('文件不能超过 3 MB');
    const data = JSON.parse(await file.text());
    if (data.format !== 'test-form-assistant' || data.schema !== 1 || !Array.isArray(data.templates) || data.templates.length > 100) throw new Error('不是兼容的模板备份');
    const templates = data.templates.map(validateTemplate);
    if (importCurrentSite) for (const template of templates) template.page.origin = targetOrigin;
    db.templates.push(...templates); await persist(); renderTemplates();
    toast(importCurrentSite ? `已导入 ${templates.length} 个模板到当前网站；路径不同可勾选“显示本站其他页面模板”` : `已导入 ${templates.length} 个模板；按原网站归属显示`);
  }

  function numberControls(config, allowAuto = true) {
    const mode = !allowAuto && config.mode === 'auto' ? 'integer' : config.mode;
    return `<label class="label">数字方式<select class="num-mode">${(allowAuto ? [['auto', '自动（按字段约束）']] : []).concat([['integer', '仅整数'], ['decimal', '允许小数']]).map(([v, label]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <div class="number-values" ${mode === 'auto' ? 'hidden' : ''}><div class="setting-grid"><label>最小值（含）<input class="num-min" type="text" inputmode="decimal" placeholder="按字段默认" value="${esc(config.min)}"></label><label>最大值（含）<input class="num-max" type="text" inputmode="decimal" placeholder="按字段默认" value="${esc(config.max)}"></label></div>
      <label class="digits-label" ${mode !== 'decimal' ? 'hidden' : ''}>最多小数位<select class="num-decimals">${[0, 1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${String(config.decimals) === String(n) ? 'selected' : ''}>${n} 位</option>`).join('')}</select></label><div class="help">范围包含端点；同时遵守页面 min / max / step，冲突时提示并保留原值。小数末尾的 0 可能省略。</div></div>`;
  }
  function textControls(config) {
    const mode = Object.hasOwn(TEXT_MODES, config.mode) ? config.mode : 'auto';
    return `<label class="label">文字方式<select class="text-mode">${Object.entries(TEXT_MODES).map(([v, label]) => `<option value="${v}" ${mode === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <div class="help">内置 ${TEXT_POOL.length} 个文本片段；也可选择自己的文本库。姓名、企业名等均不添加固定前后缀。</div>
      <div class="library-note" ${mode !== 'library' ? 'hidden' : ''}><div class="help">从已保存的自定义文本库随机抽取片段并拼接，不混入内置库。字数沿用下方范围。</div><button type="button" class="smallbtn edit-library">粘贴文字 / 导入 TXT</button></div>
      <textarea class="text-candidates" rows="4" maxlength="12000" placeholder="每行一条，可填写任意长短的文本片段" ${mode !== 'candidates' ? 'hidden' : ''}>${esc(config.candidates || '')}</textarea>
      <div class="setting-grid"><label>最小字数（可留空）<input class="text-min" type="text" inputmode="numeric" maxlength="5" placeholder="按默认范围" value="${esc(config.minLength ?? '')}"></label><label>最大字数（可留空）<input class="text-max" type="text" inputmode="numeric" maxlength="5" placeholder="按默认范围" value="${esc(config.maxLength ?? '')}"></label></div>
      <div class="help">范围含两端，支持只填一项；上限 10000 字。内置 / 自定义库默认单行 20～60 字、多行 100～300 字，同时遵守页面长度限制。邮箱、手机号等格式字段不受此设置影响。</div><div class="help online-note" ${mode !== 'online' ? 'hidden' : ''}>从 <a href="https://developer.hitokoto.cn/sentence/" target="_blank" rel="noopener noreferrer">一言</a> 获取随机短句，不附带表单内容或 Cookie；可能受网站网络策略限制。批量最多请求 5 句后复用。设置字数时会截取或重复句子。</div>`;
  }
  function syncGenerationControls(root) {
    const numberMode = q('.num-mode', root);
    if (numberMode) { q('.number-values', root).hidden = numberMode.value === 'auto'; q('.digits-label', root).hidden = numberMode.value !== 'decimal'; }
    const textMode = q('.text-mode', root);
    if (textMode) { q('.text-candidates', root).hidden = textMode.value !== 'candidates'; q('.online-note', root).hidden = textMode.value !== 'online'; q('.library-note', root).hidden = textMode.value !== 'library'; }
  }
  function syncRuleRow(row) {
    const mode = q('.mode', row).value;
    q('.fixed', row).hidden = mode !== 'fixed';
    const number = q('.numeric-config', row), text = q('.text-config', row);
    if (number) { number.hidden = mode !== 'number'; syncGenerationControls(number); }
    if (text) { text.hidden = mode !== 'text'; syncGenerationControls(text); }
  }
  function updateInlineLabels() {
    ui.globalInline.checked = inlineEnabled;
    ui.globalInline.disabled = inlineSaving;
    ui.inlineHint.textContent = inlineEnabled ? '单项随机已开启：左键换值，右键设置规则。快捷条开关在本浏览器各网站共用。' : '单项随机可在右下角快捷条开启；本浏览器各网站共用并记住选择。';
    ui.launcher.title = inlineEnabled ? '展开填表快捷条 · 单项随机已开启' : '展开填表快捷条';
    ui.launcher.dataset.inline = String(inlineEnabled);
  }
  function setDockExpanded(expanded) {
    const show = !!expanded || opened || busy;
    ui.quickBar.hidden = !show; ui.launcher.hidden = show;
    ui.launcher.setAttribute('aria-expanded', String(show));
  }
  function collapseDockSoon() {
    clearTimeout(dockTimer);
    dockTimer = setTimeout(() => {
      if (!dockPinned && !ui.dock.matches(':hover') && !ui.dock.contains(shadow.activeElement)) setDockExpanded(false);
    }, 220);
  }
  function closePanel() {
    opened = false; ui.panel.hidden = true; ui.openSettings.setAttribute('aria-expanded', 'false');
    ui.dock.hidden = !siteEnabled(); collapseDockSoon(); scheduleInline(true);
  }
  async function toggleSettings() {
    if (!opened) { openPanel(); return; }
    if (!busy) await saveRuleEdits();
    closePanel();
  }
  function stopFilling() {
    cancelled = true; activeRequest?.abort(); updateActionAvailability();
    toast('正在停止；当前控件操作结束后停止');
  }
  function scheduleInline(rebuild = false) {
    inlineRebuild ||= rebuild;
    if (inlineFrame) return;
    inlineFrame = requestAnimationFrame(() => { inlineFrame = 0; renderInline(inlineRebuild); inlineRebuild = false; });
  }
  function renderInline(rebuild) {
    if (!ui) return;
    if (!inlineEnabled || !siteEnabled()) { ui.inlineLayer.replaceChildren(); return; }
    if (rebuild) {
      discoverScopes();
      const found = collect(rootScope());
      inlineFields = found.filter(f => !f.reason && ruleFor(f).mode !== 'skip' && !f.ruleBlocked);
    }
    ui.inlineLayer.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const f of inlineFields) {
      if (!f.el.isConnected || !fieldVisible(f.el) || disabled(f.el)) continue;
      let anchor = f.el.closest('.ant-input-affix-wrapper,.ant-input-number,.el-input-number,.el-input__wrapper,.el-textarea') || f.el;
      if (f.kind === 'radio' || f.kind === 'checkbox' || f.kind === 'switch') anchor = arr(f.el.labels || []).find(visible) || f.el.closest('.el-switch,.ant-switch,[role="radiogroup"]') || f.el;
      const r = anchor.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom <= 0 || r.top < 0 || r.top >= innerHeight - 28 || r.right <= 0 || r.left >= innerWidth) continue;
      let x = Math.max(2, Math.min(r.right + 3, innerWidth - 28)), y = Math.max(2, r.top + Math.min(8, (r.height - 24) / 2));
      const overlaps = [1, 23].some(dx => {
        const beside = document.elementFromPoint(Math.min(innerWidth - 1, x + dx), Math.min(innerHeight - 1, y + 12));
        const neighbor = beside?.matches(CONTROL) ? beside : beside && q(CONTROL, beside);
        return anchor.contains(beside) || (neighbor && neighbor !== f.el && !f.el.contains(neighbor));
      });
      if (overlaps) {
        // Dense rows and suffixes (%, currency, number steppers) retain their space.
        x = Math.max(2, Math.min(r.right - 25, innerWidth - 28)); y = Math.max(2, r.top - (r.height < 28 ? 24 : 12));
      }
      if (opened) {
        const panelRect = ui.panel.getBoundingClientRect();
        if (x < panelRect.right && x + 24 > panelRect.left && y < panelRect.bottom && y + 24 > panelRect.top) continue;
      }
      // A clipped field in an inactive panel must not receive a floating button.
      const cx = Math.max(0, Math.min(innerWidth - 1, r.left + Math.min(r.width / 2, 8))), cy = Math.min(innerHeight - 1, r.top + Math.min(r.height / 2, 8));
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== host && !anchor.contains(top) && !top.contains(anchor)) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'field-dice'; button.dataset.key = f.uid;
      button.textContent = '⚄'; button.title = `${f.label}：单独生成并覆盖此项；右键设置规则`;
      button.setAttribute('aria-label', `随机填写：${f.label}`); button.style.left = `${x}px`; button.style.top = `${y}px`; button.disabled = busy;
      fragment.append(button);
    }
    ui.inlineLayer.replaceChildren(fragment);
  }
  function openFieldRule(reference) {
    openPanel(); ui.fieldDetails.open = true;
    const f = matchLive(reference, fields).field;
    const row = f && qa('.field', ui.fields).find(row => row.dataset.key === f.uid);
    if (row) { row.scrollIntoView({ block: 'center' }); q('.mode', row).focus(); }
  }

  const styles = `
    :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;color-scheme:light!important;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif!important;color:#253047!important}
    *{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s}button:disabled{cursor:default;opacity:.45}button:focus-visible,summary:focus-visible{outline:3px solid #a5b4fc;outline-offset:3px}[hidden]{display:none!important}
    .launcher-dock{pointer-events:none;position:fixed;z-index:4;right:0;bottom:14px;padding:10px 0 10px 10px;max-width:100vw}.launcher{pointer-events:auto;position:relative;display:grid;place-items:center;width:40px;height:48px;border:1px solid #5264df;background:#4455ce;color:#fff;border-radius:16px 0 0 16px;box-shadow:0 5px 20px #394db536;font-size:21px}.launcher:hover{background:#3949bb}.launcher[data-inline=true]::after{content:'';position:absolute;left:7px;top:8px;width:6px;height:6px;border-radius:50%;background:#b3efd7;box-shadow:0 0 0 2px #4455ce}
    .quickbar{pointer-events:auto;display:flex;align-items:stretch;max-width:calc(100vw - 10px);min-height:48px;background:#fff;border:1px solid #d4dcf3;border-radius:13px 0 0 13px;box-shadow:0 5px 24px #394db52b;overflow:hidden;font-size:13px}.quick-action,.quick-toggle{display:flex;align-items:center;justify-content:center;gap:6px;min-height:46px;padding:10px 12px;border:0;background:#fff;color:#5a6682;white-space:nowrap;font-weight:600;font-size:inherit}.quick-action+.quick-action,.quick-toggle{border-left:1px solid #e4e8f4}.quick-action.primary{background:#4455ce;color:#fff}.quick-action.primary:hover:not(:disabled){background:#3949bb}.quick-action[aria-expanded=true]{background:#edf0ff;color:#4455ce}.quick-action:hover:not(:disabled),.quick-toggle:hover{background:#f1f4ff}.quick-action[data-busy=true]{background:#b9636d}.quick-action[data-busy=true]:hover:not(:disabled){background:#a6535d}.quick-toggle{cursor:pointer}.quick-toggle input{accent-color:#5362d8}.quickbar button:focus-visible,.quick-toggle:focus-within{outline:3px solid #a5b4fc;outline-offset:-4px}.inline-note{padding-top:12px;margin-top:12px;border-top:1px solid #dde3f4}.toast button{margin-left:10px;border:1px solid #b9c6e9;border-radius:6px;padding:3px 7px;background:#fff;color:#4455ce;font-size:12px}.toast button:disabled{opacity:.5}
    .panel{pointer-events:auto;position:fixed;z-index:2;right:20px;top:24px;width:424px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 112px);display:flex;flex-direction:column;background:#f3f5fa;border:1px solid #e0e5ee;border-radius:22px;box-shadow:0 20px 64px #182d4d26,0 3px 14px #182d4d0a;overflow:hidden}.head{display:flex;align-items:center;gap:12px;padding:20px;background:#fff;border-bottom:1px solid #e8ecf3}.brand-mark{display:grid;place-items:center;background:#eef0ff;color:#5361d4;width:42px;height:42px;border-radius:13px;font-size:26px}.title{font-size:18px;font-weight:720;letter-spacing:.3px;color:#19253b}.sub{font-size:12px;color:#8490a4;margin-top:2px}.close{width:32px;height:32px;display:grid;place-items:center;border:0;background:transparent;border-radius:9px;color:#8490a4;font-size:24px;line-height:1}.close:hover{color:#35415a;background:#f1f3f8}
    .body{min-height:0;padding:16px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#c9d1e0 transparent}.grow{flex:1;min-width:0}.row{display:flex;align-items:center;gap:8px}.row>*{min-width:0}.label{display:block;font-size:12px;font-weight:600;color:#53617a;margin:0 0 7px}.help{font-size:11px;line-height:1.65;color:#6f7c92;overflow-wrap:anywhere}.muted{font-size:11px;color:#95a0b1;margin-left:auto}.line{height:1px;background:#edf0f5;margin:16px 0}
    input[type=text],select,textarea.text-candidates,#libraryText{width:100%;min-height:38px;padding:9px 10px;background:#fff;border:1px solid #dde3ee;border-radius:9px;color:#35415a;outline:none;transition:border-color .15s,box-shadow .15s}input::placeholder,textarea::placeholder{color:#a2aab8}input[type=text]:focus,select:focus,textarea:focus{border-color:#8995ea;box-shadow:0 0 0 3px #eef0ff}select{cursor:pointer;padding-right:20px}input[type=checkbox]{width:14px;height:14px;accent-color:#5967d8;margin:0;flex:none}textarea.text-candidates,#libraryText{resize:vertical;min-height:100px;font-family:inherit;line-height:1.65}#libraryText{min-height:150px}
    .action{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:37px;padding:8px 12px;border:1px solid #dde3ed;background:#fff;color:#53617b;border-radius:9px;font-weight:550;white-space:nowrap}.action:hover:not(:disabled){border-color:#b6c0df;background:#f8faff}.action.primary{background:#5362d8;border-color:#5362d8;color:#fff;box-shadow:0 3px 8px #5362d827}.action.primary:hover:not(:disabled){background:#4655c7;border-color:#4655c7}.action.soft{background:#ffffffb3;border-color:#dce2f4;color:#6e7a99}.action.tint{background:#eef1ff;color:#5362c8;border-color:#e7ebff}.action.ghost{border-color:transparent;background:transparent}.action.danger{color:#c46972}.full{width:100%}.smallbtn{padding:5px 0;border:0;background:none;color:#6172d6;font-size:12px;text-align:left}.smallbtn:hover{text-decoration:underline}
    .fill-card{padding:17px;background:linear-gradient(125deg,#eef1ff,#f8f9ff);border:1px solid #dee4fb;border-radius:15px;margin-bottom:13px}.card-top{display:flex;gap:10px;align-items:center}.eyebrow{color:#828db2;font-size:11px;margin-bottom:3px}.ready-count{font-size:18px;font-weight:680;color:#354478;letter-spacing:.2px}.icon-action{display:grid;place-items:center;width:30px;height:30px;border:1px solid #dce3f6;border-radius:9px;background:#ffffff91;color:#8b97b7;font-size:20px}.icon-action:hover{background:white;color:#5362d8}.status-hint{margin-top:4px;color:#7785a5}.fill-actions{display:flex;gap:8px;margin:16px 0 12px}.fill-actions .primary{min-height:42px;font-size:14px}.fill-actions .primary span{font-size:18px}.check-line{display:flex;align-items:center;gap:7px;color:#748099;font-size:12px;cursor:pointer;min-height:20px}.check-line.subtle{font-size:11px;margin:11px 0 0}
    .section-card{margin:12px 0 0;background:#fff;border:1px solid #e3e8f0;border-radius:15px;overflow:hidden}.section-card>summary{display:flex;align-items:center;gap:11px;padding:15px;cursor:pointer;list-style:none;user-select:none}.section-card>summary:hover{background:#fbfcff}summary::-webkit-details-marker{display:none}.summary-copy{flex:1;min-width:0}.summary-copy strong{display:block;font-size:14px;font-weight:650;color:#3d4a62}.summary-copy small{display:block;font-size:11px;font-weight:400;color:#7e8ba1;margin-top:3px}.section-icon{display:grid;place-items:center;flex:none;width:34px;height:34px;border-radius:11px;font-size:21px}.amber{background:#fff4df;color:#c3a064}.violet{background:#f0edff;color:#9985d1}.teal{background:#e9f5f2;color:#6caa9c}.blue{background:#eaf1fc;color:#7e9cc7}.gray{background:#f0f2f6;color:#9aa4b5}.count-pill{font-size:10px;color:#9ba5b6;white-space:nowrap;background:#f5f7fa;padding:2px 6px;border-radius:6px}.chevron{display:block;flex:none;width:6px;height:6px;margin-right:3px;border-right:1.5px solid #a8b1c1;border-bottom:1.5px solid #a8b1c1;transform:rotate(-45deg);transition:transform .15s}details[open]>summary>.chevron{transform:rotate(45deg)}.section-body{padding:0 15px 16px}.section-card[open]>summary{padding-bottom:13px}.templates-card[open]>summary{border-bottom:1px solid #f3f1eb;margin-bottom:14px}.template-actions{display:flex;gap:7px;margin-top:10px}.save-box{padding:12px;margin-top:15px;border:1px solid #edf0f5;border-radius:10px;background:#f9fafc}.save-box input{font-size:12px}.save-bottom{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px}.save-bottom .action{min-height:31px;padding:5px 11px;font-size:12px}.save-bottom .help{font-size:10px}.empty-state{font-size:12px;line-height:1.7;color:#99a3b4;background:#f8f9fc;border-radius:9px;padding:12px;margin-bottom:12px}
    .setting-block{background:#f8f9fc;border:1px solid #edf0f6;border-radius:11px;padding:12px;margin:0 0 12px}.setting-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0 9px}.setting-grid label,.digits-label{font-size:11px;color:#7e8aa0}.setting-grid input{margin-top:5px}.digits-label{display:block;margin:10px 0}.digits-label select{margin-top:5px}.inset-details{background:#fafbfe;border:1px solid #e9edf4;border-radius:9px;margin:11px 0}.inset-details>summary{display:flex;align-items:center;justify-content:space-between;padding:11px;font-size:12px;font-weight:550;color:#75839d;cursor:pointer;list-style:none}.inset-body{padding:0 11px 12px}.library-actions{margin-top:10px;margin-bottom:9px}.library-note{margin:8px 0}.online-note a{color:#6172d6}.numeric-config,.text-config{padding:10px;background:#f6f8fc;border-radius:9px;margin-top:10px}
    .field{border:1px solid #e6eaf2;border-radius:11px;padding:11px;margin:11px 0;background:#fff}.field-top{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.field-name{font-size:12px;font-weight:600;flex:1;min-width:90px;overflow-wrap:anywhere;color:#56627b}.badge{font-size:10px;background:#f4f6fa;color:#9aa4b5;padding:2px 5px;border-radius:4px}.field .row{margin-top:9px}.field .mode{width:100%;font-size:12px}.field input{font-size:12px}.field .fixed{width:100%;margin-top:9px}.field .locate{border:0;color:#8391c6;background:none;font-size:11px;padding:0}.field .random-one{min-height:25px;padding:2px 6px;font-size:11px;color:#8191c9}.field .meta{font-size:10px;color:#a0a8b8;margin-top:6px}.reason{font-size:11px;color:#b99b70;margin-top:7px}.numeric-config select,.text-config select{width:100%}
    .stats{font-size:12px;color:#8390a6;margin-bottom:10px}#results{max-height:260px;overflow:auto}.result{border-left:2px solid #c8ced9;padding:8px 10px;margin:7px 0;font-size:11px;line-height:1.6;background:#f8f9fc;border-radius:0 7px 7px 0;color:#6f7c92;overflow-wrap:anywhere}.result.ok{border-color:#80b9a0}.result.fail{border-color:#d68e94}.result.warn{border-color:#d7b578}.result b{color:#64728a;font-weight:550}.footer{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:12px 20px;border-top:1px solid #e7ebf2;background:#fbfcfe;font-size:10px;color:#a0aaba}.footer-dot{display:inline-block;width:5px;height:5px;border-radius:50%;background:#9bb9ad;margin-right:6px;vertical-align:middle}.toast{pointer-events:auto;position:fixed;z-index:3;bottom:90px;right:22px;max-width:min(400px,calc(100vw - 32px));background:#35415b;color:white;padding:12px 16px;border-radius:12px;box-shadow:0 6px 25px #26355130;font-size:12px;line-height:1.6;white-space:pre-wrap}
    #inlineLayer{pointer-events:none}.field-dice{pointer-events:auto;position:fixed;width:24px;height:24px;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid #c3ccef;border-radius:7px;background:#f0f3ff;color:#6978d4;font-size:20px;line-height:1;box-shadow:0 2px 5px #5362d820}.field-dice:hover{background:#6878d7;border-color:#6878d7;color:white}.field-dice:focus-visible{outline:3px solid #acb9f8}
    @media(max-width:550px){.panel{right:10px;top:10px;max-width:calc(100vw - 20px);max-height:calc(100dvh - 92px);border-radius:18px}.head{padding:15px}.body{padding:12px}.launcher-dock{bottom:4px}.quickbar{font-size:12px}.quick-action,.quick-toggle{padding:10px}.muted{font-size:10px}.footer{padding:11px 16px}}
    @media(prefers-reduced-motion:reduce){*{transition:none!important}}
  `;
  function mount() {
    host = document.createElement('div'); host.id = 'tfa-host-v1';
    host.style.cssText = 'position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `<style>${styles}</style>
      <div id="inlineLayer"></div>
      <div class="launcher-dock" id="dock"><button type="button" class="launcher" id="launcher" title="展开填表快捷条" aria-label="展开填表快捷条" aria-expanded="false" aria-controls="quickBar"><span aria-hidden="true">✦</span></button><div class="quickbar" id="quickBar" role="group" aria-label="填表快捷操作" hidden><button type="button" class="quick-action primary" id="quickFill" title="按当前规则重新生成并覆盖当前表单"><span id="quickFillIcon" aria-hidden="true">⟳</span><span id="quickFillLabel">整表重填</span></button><button type="button" class="quick-action" id="openSettings" aria-expanded="false" aria-controls="panel"><span aria-hidden="true">⚙</span><span>填表设置</span></button><label class="quick-toggle" title="在字段旁显示骰子，本浏览器各网站共用并记住选择"><input id="globalInline" type="checkbox"><span>单项随机</span></label></div></div>
      <section class="panel" id="panel" hidden aria-label="系统测试填表助手">
        <header class="head"><div class="brand-mark" aria-hidden="true">✦</div><div class="grow"><div class="title">系统测试填表助手</div><div class="sub">为当前表单准备测试数据</div></div><button class="close" id="close" title="收起面板" aria-label="收起面板">×</button></header>
        <div class="body">
          <section class="fill-card" aria-label="快速填写">
            <div class="card-top"><div class="grow"><div class="eyebrow">当前表单</div><div class="ready-count" id="status" role="status">正在识别可填写内容</div></div><button class="icon-action" id="scan" title="重新识别当前表单" aria-label="重新识别">↻</button></div>
            <div class="help status-hint" id="scopeHint">自动识别最上层表单，跳过搜索与筛选区</div>
            <div class="fill-actions"><button class="action primary grow" id="fill"><span aria-hidden="true">✦</span> 一键填空</button><button class="action soft" id="undo">恢复本次</button><button class="action danger" id="stop" hidden>停止</button></div>
            <label class="check-line"><input type="checkbox" id="overwrite"><span>覆盖已有内容</span><span class="muted">默认只填空项</span></label>
            <div class="help inline-note" id="inlineHint"></div>
          </section>

          <details class="section-card" id="generationDetails" open><summary><span class="section-icon violet" aria-hidden="true">◈</span><span class="summary-copy"><strong>生成偏好</strong><small>数字范围、文本来源与长度</small></span><span class="chevron" aria-hidden="true"></span></summary><div class="section-body">
            <div id="numberSettings" class="setting-block"></div><div id="textSettings" class="setting-block"></div>
            <details class="inset-details" id="libraryDetails"><summary>我的文本库<span class="chevron" aria-hidden="true"></span></summary><div class="inset-body"><label class="label" for="libraryText">粘贴一段文字，或导入 TXT</label><textarea id="libraryText" rows="6" maxlength="${LIBRARY_LIMIT}" placeholder="放入你常用的文字，随机填写时从这里抽取片段。无需逐行整理。" spellcheck="false"></textarea><div class="help" id="libraryStatus" aria-live="polite"></div><div class="row library-actions"><button type="button" class="action grow" id="importLibrary">导入 TXT</button><button type="button" class="action grow" id="saveLibrary">保存文本库</button><input type="file" id="libraryFile" accept=".txt,text/plain" hidden></div><div class="help">各页面共用，仅在选择自定义文本库时使用。最多 50 万字 / TXT 1 MB，支持 UTF-8、UTF-16、GBK；仅保存于本机。</div></div></details>
            <details class="inset-details" id="seedDetails"><summary>复现相同数据<span class="chevron" aria-hidden="true"></span></summary><div class="inset-body"><label class="label" for="seed">数据标记</label><div class="row"><input id="seed" type="text" value="1" maxlength="80" class="grow"><button class="action" id="newSeed">换一组</button></div><div class="help">相同标记用于生成相同的一组数据。</div></div></details>
            <button class="action tint full" id="saveSettings">保存生成偏好</button>
          </div></details>

          <details class="section-card" id="fieldDetails"><summary><span class="section-icon teal" aria-hidden="true">☷</span><span class="summary-copy"><strong>单项设置</strong><small>为特定字段单独设置生成方式</small></span><span class="count-pill" id="fieldCount"></span><span class="chevron" aria-hidden="true"></span></summary><div class="section-body"><div class="help">可以设置随机范围、文本库、固定值，或跳过某一项。右键字段旁的随机按钮可直接找到它。</div><div class="reason" id="ruleHint" hidden></div><div id="fields"></div><button class="action tint full" id="saveRules">保存单项设置</button><details class="inset-details"><summary>固定值怎么填写<span class="chevron" aria-hidden="true"></span></summary><div class="inset-body help">支持 {date}、{seed}、{timestamp}。下拉填写选项文字；级联重名时填写“上级 / 下级”；多选和日期范围用逗号分隔；日期按页面格式；开关填写 true / false。</div></details></div></details>
          <details class="section-card" id="reportDetails"><summary><span class="section-icon blue" aria-hidden="true">✓</span><span class="summary-copy"><strong>填写记录</strong><small id="reportHint">查看本次填写结果</small></span><span class="chevron" aria-hidden="true"></span></summary><div class="section-body"><div class="stats" id="stats"></div><div id="results"><div class="empty-state">开始填写后，结果会显示在这里。</div></div></div></details>
          <details class="section-card templates-card" id="templateDetails"><summary><span class="section-icon amber" aria-hidden="true">▤</span><span class="summary-copy"><strong>我的模板</strong><small>保存一套填写，下次直接复用</small></span><span class="count-pill" id="templateCount">0 份</span><span class="chevron" aria-hidden="true"></span></summary><div class="section-body">
            <div id="emptyTemplates" class="empty-state" hidden>还没有模板。填好表单后，把这套内容保存下来吧。</div>
            <label class="label" for="templates">已保存模板</label><select id="templates"></select>
            <div class="template-actions"><button class="action tint grow" id="replay">回填到表单</button><button class="action ghost danger" id="delete">删除</button></div>
            <label class="check-line subtle"><input type="checkbox" id="siteTemplates"><span>显示本站其他页面模板</span></label>
            <div class="save-box"><label class="label" for="templateName">保存当前填写</label><input id="templateName" type="text" aria-label="模板名称" placeholder="自动生成名称，也可以自行修改" maxlength="120"><div class="save-bottom"><span class="help">名称已为你准备好</span><button class="action" id="save">存为模板</button></div></div>
          </div></details>
          <details class="section-card" id="moreDetails"><summary><span class="section-icon gray" aria-hidden="true">⋯</span><span class="summary-copy"><strong>备份与更多</strong><small>导入导出、站点显示设置</small></span><span class="chevron" aria-hidden="true"></span></summary><div class="section-body"><label class="check-line"><input type="checkbox" id="importCurrentSite"><span>导入到当前网站</span></label><div class="help">同一系统跨环境使用时勾选，页面路径保持不变；不勾选则保留原网站归属。</div><div class="row library-actions"><button class="action grow" id="export">导出本站模板</button><button class="action grow" id="import">导入 JSON</button><input type="file" id="importFile" accept=".json,application/json" hidden></div><div class="help">模板仅存于本机，导出文件包含字段值。自定义文本库请保留 TXT 原文件。</div><div class="line"></div><div class="label">网站显示</div><div class="help">本地与局域网默认显示。其他网站可通过油猴菜单手动开启。</div><div class="row library-actions"><button class="action grow" id="hideSite">在本站隐藏</button><button class="action grow" id="resetSite">恢复默认</button></div><details class="inset-details"><summary>使用说明<span class="chevron" aria-hidden="true"></span></summary><div class="inset-body help">默认跳过密码、验证码、文件、富文本和未适配控件。填写会触发页面联动；有自动保存功能的页面可能写入后台。“恢复本次”尽力恢复字段内容，不能回滚后台保存。复杂业务约束请以页面校验为准。</div></details></div></details>
        </div><footer class="footer"><span><i class="footer-dot"></i>本地保存 · 由你决定何时提交</span><span>v${VERSION}</span></footer>
      </section><div class="toast" id="toast" role="status" hidden><span id="toastMessage"></span><button type="button" id="toastUndo" hidden>恢复本次</button></div>
`;
    document.documentElement.append(host);
    ui = Object.fromEntries(qa('[id]', shadow).map(el => [el.id, el]));
    ui.libraryText.value = libraryText; updateLibraryStatus();
    const on = (id, fn, event = 'click') => ui[id].addEventListener(event, async () => { try { await fn(); } catch (err) { toast(`操作失败：${err.message}`); console.error('[系统测试填表助手]', err); } });
    on('launcher', () => { clearTimeout(dockTimer); dockPinned = true; setDockExpanded(true); ui.openSettings.focus({ preventScroll: true }); });
    on('openSettings', toggleSettings);
    on('close', async () => { if (!busy) await saveRuleEdits(); closePanel(); });
    on('quickFill', () => busy ? stopFilling() : run('refresh'));
    on('globalInline', setInlinePreference, 'change');
    on('toastUndo', undo);
    on('scan', async () => { await saveRuleEdits(); refreshFields(true); });
    on('newSeed', () => { ui.seed.value = String(Date.now()).slice(-8); });
    on('fill', () => run('auto')); on('replay', () => run('template')); on('save', saveTemplate); on('undo', undo);
    on('stop', stopFilling);
    on('saveSettings', async () => { await saveRuleEdits(); toast('已保存当前页面的数字与文字随机设置'); });
    on('saveRules', async () => { await saveRuleEdits(); toast(fields.some(f => !f.unique) ? '规则已保存；无法长期区分的同名项仅对当前控件生效' : '字段规则已保存'); });
    on('siteTemplates', () => renderTemplates(), 'change');
    on('templates', () => { const t = db.templates.find(t => t.id === ui.templates.value); if (t) { ui.templateName.value = t.name; templateNameAuto = false; } }, 'change');
    on('templateName', () => { templateNameAuto = false; }, 'input');
    on('delete', async () => { const id = ui.templates.value, t = db.templates.find(t => t.id === id); if (t && confirm(`删除模板“${t.name}”？`)) { db.templates = db.templates.filter(t => t.id !== id); await persist(); renderTemplates(); toast('模板已删除'); } });
    on('export', exportTemplates); on('import', () => ui.importFile.click());
    on('importFile', async () => { try { await importTemplates(ui.importFile.files[0]); } finally { ui.importFile.value = ''; } }, 'change');
    on('libraryText', updateLibraryStatus, 'input');
    on('saveLibrary', async () => { await saveLibrary(); toast('自定义文本库已保存；选择“自定义文本库”后即可用于随机填充'); });
    on('importLibrary', () => ui.libraryFile.click());
    on('libraryFile', async () => { try { await importTextLibrary(ui.libraryFile.files[0]); } finally { ui.libraryFile.value = ''; } }, 'change');
    ui.panel.addEventListener('click', event => {
      if (!event.target.closest('.edit-library')) return;
      ui.generationDetails.open = ui.libraryDetails.open = true;
      ui.libraryText.scrollIntoView({ block: 'center' }); ui.libraryText.focus();
    });
    on('hideSite', () => setSiteMode('hide')); on('resetSite', () => setSiteMode('default'));
    for (const root of [ui.numberSettings, ui.textSettings]) root.addEventListener('change', () => syncGenerationControls(root));
    ui.fields.addEventListener('change', event => { const row = event.target.closest('.field'); if (row) { row.dataset.edited = 'true'; syncRuleRow(row); } });
    ui.fields.addEventListener('input', event => { const row = event.target.closest('.field'); if (row) row.dataset.edited = 'true'; });
    ui.inlineLayer.addEventListener('click', event => { const button = event.target.closest('.field-dice'), f = button && inlineFields.find(f => f.uid === button.dataset.key); if (f) randomizeOne(liveReference(f)); });
    ui.inlineLayer.addEventListener('contextmenu', event => { const button = event.target.closest('.field-dice'), f = button && inlineFields.find(f => f.uid === button.dataset.key); if (f && !busy) { event.preventDefault(); openFieldRule(liveReference(f)); } });
    addEventListener('scroll', () => scheduleInline(), { capture: true, passive: true });
    addEventListener('resize', () => scheduleInline(), { passive: true });
    ui.fields.addEventListener('click', event => {
      const button = event.target.closest('.locate,.random-one'); if (!button) return;
      const original = fields.find(f => f.uid === button.dataset.key); if (!original) return;
      if (button.classList.contains('random-one')) { randomizeOne(liveReference(original)); return; }
      const match = matchLive(liveReference(original), collect(rootScope())), f = match.field;
      if (!f) return toast(match.reason);
      f.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const old = f.el.style.outline; f.el.style.outline = '3px solid #2563eb'; setTimeout(() => { f.el.style.outline = old; }, 1800);
    });
    ui.dock.hidden = !siteEnabled();
    ui.dock.addEventListener('pointerenter', event => {
      clearTimeout(dockTimer);
      if (event.pointerType === 'mouse') dockTimer = setTimeout(() => setDockExpanded(true), 150);
    });
    ui.dock.addEventListener('pointerleave', collapseDockSoon);
    ui.dock.addEventListener('focusout', collapseDockSoon);
    ui.launcher.addEventListener('focus', () => {
      if (ui.launcher.matches(':focus-visible')) { setDockExpanded(true); ui.openSettings.focus({ preventScroll: true }); }
    });
    document.addEventListener('pointerdown', event => {
      if (event.composedPath().includes(ui.dock)) return;
      dockPinned = false; clearTimeout(dockTimer); setDockExpanded(false);
    }, true);
    if (typeof GM_registerMenuCommand === 'function') {
      const menu = (label, action) => GM_registerMenuCommand(label, async () => {
        try { await action(); } catch (error) { toast(`操作失败：${error.message}`); console.error('[系统测试填表助手]', error); }
      });
      menu('本站开启助手（记住选择）', async () => { await setSiteMode('show'); openPanel(); });
      menu('本站隐藏助手（记住选择）', () => setSiteMode('hide'));
      menu('本站恢复默认（仅本地 / 局域网显示）', () => setSiteMode('default'));
    }
  }
  function openPanel() {
    if (opened) return;
    opened = true; ui.openSettings.setAttribute('aria-expanded', 'true');
    ui.panel.hidden = false; setDockExpanded(true);
    if (!busy) refreshFields(true);
    scheduleInline();
  }
  function refreshFields(rebuild) {
    if (rebuild) discoverScopes();
    fields = collect(rootScope()); structureDirty = false;
    const available = fields.filter(f => !f.reason).length;
    ui.status.textContent = available ? `${available} 项内容可以填写` : '暂未发现可填写内容';
    ui.scopeHint.textContent = fields.length === 500 ? '当前识别前 500 项，超出部分请手动处理' : fields.length ? '已识别当前表单 · 搜索与筛选字段不参与' : '打开编辑表单或弹窗，助手会自动识别';
    ui.fieldCount.textContent = `${fields.length} 项`;
    const settings = currentSettings();
    renderedRuleKey = ruleKey(); renderedRoot = rootScope();
    ui.numberSettings.innerHTML = numberControls(settings.number);
    ui.textSettings.innerHTML = textControls(settings.text);
    ui.fields.innerHTML = fields.map(f => {
      const rule = ruleFor(f);
      const numeric = ['text', 'textarea', 'number'].includes(f.kind), text = ['text', 'textarea'].includes(f.kind) && !textFormat(f);
      const modes = [['auto', '按页面设置生成'], ...(numeric ? [['number', '数字随机（单独设置）']] : []), ...(text ? [['text', '文字随机（单独设置）']] : []), ['fixed', '固定值'], ['skip', '跳过']];
      return `<div class="field" data-key="${esc(f.uid)}"><div class="field-top"><span class="field-name">${esc(f.label)}</span><span class="badge">${TYPES[f.kind]}</span><button class="action random-one" data-key="${esc(f.uid)}" ${f.reason ? 'disabled' : ''}>⚄ 换此项</button><button class="locate" data-key="${esc(f.uid)}">定位</button></div>${f.context ? `<div class="meta">${esc(f.context)}</div>` : ''}${f.reason ? `<div class="reason">${esc(f.reason)}</div>` : ''}<div class="reason rule-warning" hidden></div><div class="row"><select class="mode" ${f.reason ? 'disabled' : ''}>${modes.map(([value, label]) => `<option value="${value}" ${rule.mode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><input class="fixed" type="text" value="${esc(rule.value || '')}" placeholder="填写固定值" ${f.reason ? 'disabled' : ''}>${numeric ? `<div class="numeric-config">${numberControls({ ...settings.number, ...rule.number }, false)}</div>` : ''}${text ? `<div class="text-config">${textControls({ ...settings.text, ...rule.text })}</div>` : ''}</div>`;
    }).join('') || '<div class="empty-state">当前没有可填写的表单，搜索和筛选字段已自动排除。</div>';
    for (const row of qa('.field', ui.fields)) syncRuleRow(row);
    updateRuleHints();
    updateInlineLabels(); scheduleInline(true); if (busy) setBusy(true);
    renderTemplates();
    suggestTemplateName();
  }
  function updateRuleHints() {
    bindRules(fields);
    ui.ruleHint.hidden = !fields.unresolvedRules;
    ui.ruleHint.textContent = `${fields.unresolvedRules} 条已有规则无法可靠对应，原数据已保留；请检查并重新指定单项规则`;
    for (const row of qa('.field', ui.fields)) {
      const f = fields.find(item => item.uid === row.dataset.key), hint = q('.rule-warning', row);
      if (f && hint) { hint.textContent = f.ruleWarning; hint.hidden = !f.ruleWarning; }
    }
  }
  function renderTemplates(selected) {
    const id = selected || ui.templates.value, p = pageInfo();
    const templates = db.templates.filter(t => t.page.origin === p.origin && (ui.siteTemplates.checked || t.page.path === p.path));
    ui.templates.innerHTML = templates.length ? templates.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.page.path !== p.path ? ' · 其他页面' : ''}（${t.fields.length} 项）</option>`).join('') : '<option value="">暂无模板</option>';
    if (templates.some(t => t.id === id)) ui.templates.value = id;
    ui.templateCount.textContent = `${templates.length} 份`;
    ui.emptyTemplates.hidden = templates.length > 0;
    updateActionAvailability();
  }
  function renderReports() {
    ui.reportDetails.open = true;
    ui.stats.textContent = ['ok', 'skip', 'warn', 'fail'].map((s, i) => `${['成功', '跳过', '检查', '失败'][i]} ${reports.filter(r => r.status === s).length}`).join(' · ');
    ui.reportHint.textContent = reports.length ? `已填写 ${reports.filter(r => r.status === 'ok').length} 项 · 查看详情` : '查看本次填写结果';
    ui.results.innerHTML = reports.map(r => `<div class="result ${r.status}"><b>${esc(r.label)}</b> — ${esc(r.message)}</div>`).join('');
  }
  function setBusy(value) {
    for (const el of qa('button,input,select', ui.panel)) if (!['stop', 'close'].includes(el.id)) el.disabled = value;
    for (const el of qa('textarea', ui.panel)) el.disabled = value;
    scheduleInline();
    ui.stop.hidden = !value; ui.stop.disabled = false;
    if (value) { ui.toast.hidden = true; setDockExpanded(true); }
    else collapseDockSoon();
    updateActionAvailability();
  }
  function updateActionAvailability() {
    const available = fields.some(f => !f.reason), template = !!ui.templates.value;
    ui.fill.disabled = busy || !available; ui.save.disabled = busy || !available;
    ui.replay.disabled = busy || !available || !template;
    ui.delete.disabled = busy || !template; ui.templates.disabled = busy || !template;
    ui.undo.disabled = busy || !history.length;
    ui.toastUndo.disabled = busy || !history.length;
    ui.quickFillLabel.textContent = busy ? (cancelled ? '正在停止' : '停止填写') : '整表重填';
    ui.quickFillIcon.textContent = busy ? '■' : '⟳';
    ui.quickFill.dataset.busy = String(busy); ui.quickFill.disabled = busy && cancelled;
    ui.quickFill.title = busy ? '停止后续填写，保留本次已完成的改动' : '按当前规则重新生成并覆盖当前表单';
  }
  let toastTimer;
  function toast(message, restorable = false) {
    clearTimeout(toastTimer); ui.toastMessage.textContent = message;
    ui.toastUndo.hidden = !restorable || !history.length; ui.toastUndo.disabled = busy;
    ui.toast.hidden = false; toastTimer = setTimeout(() => { ui.toast.hidden = true; }, restorable ? 9000 : 5500);
  }

  async function init() {
    let storageError = '';
    try {
      const raw = await GM_getValue(STORAGE, null);
      if (raw) {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed.schema !== 1 || !Array.isArray(parsed.templates)) throw new Error('本地数据库格式不兼容');
        db = { schema: 1, templates: parsed.templates, rules: parsed.rules || {}, settings: parsed.settings || {} };
      }
    } catch (error) { storageError = error.message; }
    try { siteModes = readSiteModes(await GM_getValue(SITE_STORAGE, null)); }
    catch (error) { console.error('[系统测试填表助手] 无法读取网站显示设置', error); }
    try { libraryText = validateLibrary(await GM_getValue(LIBRARY_STORAGE, '')); }
    catch (error) { libraryError = error.message; console.error('[系统测试填表助手] 无法读取自定义文本库', error); }
    if (typeof GM_addValueChangeListener === 'function') {
      try { GM_addValueChangeListener(INLINE_STORAGE, (_key, _oldValue, value) => { inlineRevision++; applyInlinePreference(value); }); }
      catch (error) { console.error('[系统测试填表助手] 无法订阅单项随机设置', error); }
    }
    try { await syncInlinePreference(); }
    catch (error) { console.error('[系统测试填表助手] 无法读取单项随机设置', error); }
    mount(); if (siteEnabled()) refreshFields(true); updateInlineLabels(); scheduleInline(true); lastPageKey = pageKey();
    const resyncInline = () => syncInlinePreference().catch(error => console.error('[系统测试填表助手] 无法同步单项随机设置', error));
    addEventListener('focus', resyncInline);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) resyncInline(); });
    if (storageError) { toast(`读取存储失败：${storageError}。请先备份已有数据；当前会话不可保存。`); persist = async () => { throw new Error('存储读取失败，已禁止覆盖已有数据'); }; }
    let debounce;
    new MutationObserver(mutations => {
      if (!mutations.some(m => !host.contains(m.target) && m.target !== host)) return;
      scopeDirty = true;
      if ((!opened && !inlineEnabled) || busy) return;
      clearTimeout(debounce); debounce = setTimeout(() => {
        if (rootScope() !== renderedRoot) { refreshFields(true); return; }
        structureDirty = true; ui.scopeHint.textContent = '页面内容有更新，可点右上角重新识别';
        if (inlineEnabled) scheduleInline(true);
      }, 180);
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'class', 'style', 'aria-hidden', 'aria-disabled', 'aria-selected', 'readonly', 'open'] });
    setInterval(() => {
      if (location.href === lastURL) return;
      lastURL = location.href;
      if (lastPageKey !== pageKey()) {
        lastPageKey = pageKey(); history = []; scopeDirty = true;
        if (busy) { cancelled = true; activeRequest?.abort(); } else if (opened || inlineEnabled) refreshFields(true);
      }
    }, 1000);
  }
  init().catch(error => console.error('[系统测试填表助手] 初始化失败', error));
})();
