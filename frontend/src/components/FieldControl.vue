<script setup>
import { computed } from 'vue';
import { Select, DatePicker, TimePicker } from 'ant-design-vue';
import dayjs from 'dayjs';
import Icon from './Icon.vue';
const props = defineProps({
  modelValue: [String, Number, Array, Boolean],
  type: { default: 'text' },
  options: { default: () => [] },
  placeholder: String,
  label: String,
  required: Boolean,
  disabled: Boolean,
  readonly: Boolean,
  name: String,
  min: { default: 0 },
  max: Number,
  multiple: Boolean,
});
const emit = defineEmits(['update:modelValue', 'change']);
const opts = computed(() =>
  props.options.map((x) => (typeof x === 'object' ? x : { value: x, label: String(x) })),
);
const date = computed(() =>
  props.modelValue && dayjs(props.modelValue).isValid() ? dayjs(props.modelValue) : null,
);
const time = computed(() => (props.modelValue ? dayjs('2000-01-01T' + props.modelValue) : null));
const selectPlaceholder = computed(
  () =>
    props.placeholder ||
    (props.type === 'multi'
      ? '请选择，可搜索并多选'
      : opts.value[0]?.value === ''
        ? opts.value[0].label
        : props.label === '招聘岗位'
          ? '请先选择需求部门，再选择岗位'
          : ['工作片区', '工作所在地', '合同归属'].includes(props.label)
            ? '请选择' + props.label
            : '请选择'),
);
function update(value) {
  emit('update:modelValue', value ?? '');
  emit('change', value ?? '');
}
function selectPopupContainer(trigger) {
  return trigger.closest('.v-dialog .v-field') || document.body;
}
</script>
<template>
  <span v-if="type === 'select' || type === 'multi'" class="w3-control"
    ><Select
      class="w-select"
      :id="name ? 'field-' + name : undefined"
      :value="modelValue === '' || modelValue === null ? undefined : modelValue"
      :aria-label="label || placeholder"
      :options="opts"
      :placeholder="selectPlaceholder"
      :disabled="disabled || readonly"
      :mode="type === 'multi' || multiple ? 'multiple' : undefined"
      allow-clear
      show-search
      :filter-option="(v, o) => String(o.label).toLowerCase().includes(v.toLowerCase())"
      :get-popup-container="selectPopupContainer"
      style="width: 100%"
      @change="update"
      ><template #suffixIcon><Icon name="down" /></template></Select
  ></span>
  <span v-else-if="type === 'date'" class="w3-control"
    ><DatePicker
      class="w-date-picker"
      :id="name ? 'field-' + name : undefined"
      :value="date"
      :aria-label="label || placeholder"
      :placeholder="placeholder || '请选择日期'"
      :disabled="disabled || readonly"
      input-read-only
      format="YYYY-MM-DD"
      style="width: 100%"
      @change="(_, value) => update(value)"
      ><template #suffixIcon><Icon name="e9f6" /></template></DatePicker
  ></span>
  <span v-else-if="type === 'time'" class="w3-control"
    ><TimePicker
      :id="name ? 'field-' + name : undefined"
      :value="time"
      :aria-label="label || placeholder"
      placeholder="请选择时间"
      :disabled="disabled || readonly"
      input-read-only
      format="HH:mm"
      style="width: 100%"
      @change="(_, value) => update(value)"
  /></span>
  <textarea
    v-else-if="type === 'textarea'"
    :id="'field-' + name"
    :name="name"
    :value="modelValue"
    :aria-label="label"
    :required="required"
    :readonly="readonly"
    :disabled="disabled"
    :placeholder="placeholder"
    @input="update($event.target.value)"
  ></textarea>
  <input
    v-else
    class="inp"
    :id="name ? 'field-' + name : undefined"
    :name="name"
    :type="type"
    :value="modelValue"
    :aria-label="label || placeholder"
    :required="required"
    :readonly="readonly"
    :disabled="disabled"
    :placeholder="placeholder"
    :min="type === 'number' ? min : undefined"
    :max="type === 'number' ? max : undefined"
    :step="type === 'number' ? 'any' : undefined"
    @input="
      update(
        type === 'number' && $event.target.value !== ''
          ? Number($event.target.value)
          : $event.target.value,
      )
    "
  />
</template>
