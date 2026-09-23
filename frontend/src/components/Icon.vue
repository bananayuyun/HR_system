<script setup>
import { computed } from 'vue';
const props = defineProps({ name: String });
const icons = {
  search: 'e8af',
  reset: 'ea17',
  filter: 'e80d',
  settings: 'e8d4',
  export: 'e8a0',
  full: 'e9d6',
  close: 'e9f0',
  down: 'e9a1',
  plus: 'e98e',
  phone: 'e891',
  eye: 'ea1a',
  edit: 'ea19',
  users: 'e808',
  org: 'ea14',
  assets: 'e718',
};
const value = computed(() =>
  String.fromCodePoint(parseInt(icons[props.name] || props.name || 'e8af', 16)),
);
</script>
<template>
  <i class="wi" aria-hidden="true">{{ value }}</i>
</template>
