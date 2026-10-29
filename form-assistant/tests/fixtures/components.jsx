import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, DatePicker, TimePicker, Cascader, TreeSelect, InputNumber, Radio, Form } from 'antd';
import antZh from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import { createApp, h, ref } from 'vue';
import { ElConfigProvider, ElDatePicker, ElTimePicker, ElCascader, ElTreeSelect } from 'element-plus';
import elementZh from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';

const config = window.fixtureConfig;
const { library, kind, multiple, readonly, lazy, initial } = config;
const options = () => [
  { label: '甲省', value: 'a', children: [{ label: '甲市', value: 'aa' }, { label: '同名市', value: 'ab' }, { label: '禁用市', value: 'ac', disabled: true }] },
  { label: '乙省', value: 'b', children: [{ label: '乙市', value: 'ba' }, { label: '同名市', value: 'bb' }] },
  { label: '禁用省', value: 'c', disabled: true, children: [{ label: '隐藏市', value: 'ca' }] },
];
const treeOptions = () => options().map(node => ({ ...node, title: node.label, key: node.value, children: node.children.map(child => ({ ...child, title: child.label, key: child.value })) }));
const hierarchy = kind === 'cascader' || kind === 'tree';
const range = kind === 'range' || kind === 'datetimerange';
const initialDate = value => Array.isArray(value) ? value.map(dayjs) : value ? dayjs(value) : null;
window.changes = []; window.submitted = false; window.lazyLoads = [];
document.addEventListener('submit', e => { e.preventDefault(); window.submitted = true; });

if (kind === 'energy') {
  function EnergyFixture() {
    const [mode, setMode] = useState('standard');
    const [amounts, setAmounts] = useState({});
    const names = ['净购入火电', '天然气', '石油', '煤炭'];
    const units = ['万千瓦时', '万立方米', '吨', '吨'];
    const change = (key, value) => {
      window.changes.push({ key, value });
      setAmounts(previous => ({ ...previous, [key]: config.resetNumbers && value != null ? 7 : value }));
    };
    return <Form id="editor"><h2>能源活动下达目标</h2>
      <Radio.Group aria-label="计算方式" name="method" value={mode} onChange={event => { setMode(event.target.value); window.changes.push({ mode: event.target.value }); }}>
        <Radio value="standard">折标量核算法</Radio><Radio value="physical">实物量核算法</Radio>
      </Radio.Group>
      <table><thead><tr><th rowSpan={2}>地区</th><th colSpan={4}>{mode === 'standard' ? '折标量' : '实物量'}</th><th rowSpan={2}>非化石能源消耗占比（%）</th></tr><tr>{names.map((name, i) => <th key={name}>{name}（{mode === 'standard' ? '吨标准煤' : units[i]}）</th>)}</tr></thead>
        <tbody>{['甲区', '乙区'].map((region, r) => <tr key={region}><th scope="row">{region}</th>{names.map((name, i) => {
          const key = `${r}-${i}`;
          return <td key={key}><InputNumber id={`energy-${key}`} aria-label={`${region} ${name}（${mode === 'standard' ? '吨标准煤' : units[i]}）`} placeholder="请输入" controls={false} precision={4} step={0.0001} value={amounts[key]} onChange={value => change(key, value)} /></td>;
        })}<td><InputNumber id={`share-${r}`} aria-label={`${region} 非化石能源消耗占比（%）`} placeholder="请输入" controls={false} min={0} max={100} precision={2} step={0.01} value={amounts[`share-${r}`]} onChange={value => change(`share-${r}`, value)} /></td></tr>)}</tbody>
      </table><output id="model">{JSON.stringify({ mode, amounts })}</output><button type="submit">保存</button>
    </Form>;
  }
  createRoot(document.getElementById('fixture')).render(<EnergyFixture />);
} else if (library === 'ant') {
  function Fixture() {
    const [value, setValue] = useState(hierarchy ? initial : initialDate(initial));
    const [data, setData] = useState(() => lazy ? options().map(({ children, ...node }) => ({ ...node, isLeaf: false })) : options());
    const change = next => { window.changes.push(next); setValue(next); };
    const shared = { value, onChange: change, allowClear: true, disabled: config.disabled, style: { minWidth: 320 }, id: 'target' };
    let component;
    if (kind === 'cascader') component = <Cascader {...shared} options={data} multiple={multiple} showCheckedStrategy={config.grouped ? Cascader.SHOW_PARENT : Cascader.SHOW_CHILD} loadData={lazy ? async selected => {
      const node = selected.at(-1); node.loading = true; setData([...data]); window.lazyLoads.push(node.value);
      await new Promise(r => setTimeout(r, config.delay || 240));
      node.children = options().find(n => n.value === node.value).children; node.loading = false; setData([...data]);
    } : undefined} />;
    else if (kind === 'tree') component = <TreeSelect {...shared} treeData={treeOptions()} treeCheckable={multiple} showCheckedStrategy={TreeSelect.SHOW_CHILD} virtual={false} treeDefaultExpandAll={config.expanded} />;
    else {
      const Picker = kind === 'time' ? TimePicker : range ? DatePicker.RangePicker : DatePicker;
      component = <Picker {...shared} inputReadOnly={readonly} picker={kind === 'time' ? 'time' : ['year', 'month', 'week'].includes(kind) ? kind : 'date'} showTime={kind.startsWith('datetime')} disabledDate={d => config.limited && d.date() !== 15} />;
    }
    return <form id="editor"><label htmlFor="target">测试字段</label><div>{component}</div><input type="file" name="attachment" /><output id="model">{JSON.stringify(value ?? null)}</output><button type="submit">提交</button></form>;
  }
  createRoot(document.getElementById('fixture')).render(<ConfigProvider locale={config.chinese ? antZh : undefined}><Fixture /></ConfigProvider>);
} else {
  createApp({ setup() {
    const value = ref(initial ?? null);
    const data = lazy ? [] : options();
    const cascaderProps = { multiple: !!multiple, lazy: !!lazy, lazyLoad: (node, resolve) => {
      window.lazyLoads.push(node.value ?? 'root'); setTimeout(() => resolve(node.level === 0 ? options().map(({ children, ...n }) => n) : options().find(n => n.value === node.value).children.map(n => ({ ...n, leaf: true }))), config.delay || 240);
    } };
    return () => {
      const shared = { id: 'target', modelValue: value.value, 'onUpdate:modelValue': next => { window.changes.push(next); value.value = next; }, clearable: true, disabled: config.disabled, style: { width: '350px' } };
      let component;
      if (kind === 'cascader') component = h(ElCascader, { ...shared, options: data, props: cascaderProps });
      else if (kind === 'tree') component = h(ElTreeSelect, { ...shared, data, multiple: !!multiple, showCheckbox: !!multiple, renderAfterExpand: true, defaultExpandAll: config.expanded });
      else component = h(kind === 'time' ? ElTimePicker : ElDatePicker, { ...shared, type: kind === 'range' ? 'daterange' : kind, editable: !readonly, disabledDate: d => config.limited && d.getDate() !== 15 });
      const form = h('form', { id: 'editor' }, [h('div', { class: 'el-form-item' }, [h('label', { for: 'target', class: 'el-form-item__label' }, '测试字段'), h('div', { class: 'el-form-item__content' }, [component])]), h('input', { type: 'file', name: 'attachment' }), h('output', { id: 'model' }, JSON.stringify(value.value ?? null)), h('button', { type: 'submit' }, '提交')]);
      return config.chinese ? h(ElConfigProvider, { locale: elementZh }, () => form) : form;
    };
  } }).mount('#fixture');
}
