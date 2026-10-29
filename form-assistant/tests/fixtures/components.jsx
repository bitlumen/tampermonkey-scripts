import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider, DatePicker, TimePicker, Cascader, TreeSelect } from 'antd';
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

if (library === 'ant') {
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
