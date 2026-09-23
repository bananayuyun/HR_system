<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import Icon from './Icon.vue';
const props = defineProps({
  title: String,
  wide: Boolean,
  narrow: Boolean,
  employee: Boolean,
  advanced: Boolean,
  busy: Boolean,
  error: String,
  dirty: Boolean,
  leaveMessage: String,
  panelClass: String,
});
const emit = defineEmits(['close']);
const full = ref(false),
  panel = ref(),
  confirmLeave = ref(false);
let lastFocus;
let confirmFocus;
let pendingNavigation;
watch(confirmLeave, async (open) => {
  if (open) {
    confirmFocus = document.activeElement;
    await nextTick();
    panel.value?.querySelector('.w3-leave-confirm button')?.focus();
  } else if (confirmFocus?.isConnected) confirmFocus.focus();
});
function keepEditing() {
  confirmLeave.value = false;
  pendingNavigation = null;
}
function discard() {
  const proceed = pendingNavigation;
  pendingNavigation = null;
  confirmLeave.value = false;
  if (proceed) proceed();
  else emit('close');
}
function beforeNavigate(event) {
  if (!props.busy && !props.dirty) return;
  event.preventDefault();
  if (props.busy) return;
  confirmDiscard(event.detail.proceed);
}
function confirmDiscard(proceed) {
  if (props.busy) return;
  pendingNavigation = proceed;
  confirmLeave.value = true;
}
defineExpose({ confirmDiscard });
function beforeUnload(event) {
  if (!props.dirty) return;
  event.preventDefault();
  event.returnValue = '';
}
function close() {
  if (props.busy) return;
  if (props.dirty) confirmLeave.value = true;
  else emit('close');
}
function keys(e) {
  if (e.key === 'Escape') {
    if (
      document.querySelector(
        '.ant-select-dropdown:not(.ant-select-dropdown-hidden),.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)',
      )
    )
      return;
    e.preventDefault();
    if (confirmLeave.value) keepEditing();
    else close();
  }
  if (e.key === 'Tab') {
    const scope = confirmLeave.value ? panel.value.querySelector('.w3-leave-confirm') : panel.value;
    const nodes = [
      ...scope.querySelectorAll(
        'button:not(:disabled),input:not(:disabled),textarea,select,[tabindex="0"]',
      ),
    ].filter((x) => x.offsetParent);
    const first = nodes[0],
      last = nodes.at(-1);
    if (!scope.contains(document.activeElement) || document.activeElement === scope) {
      e.preventDefault();
      (e.shiftKey ? last : first)?.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
}
onMounted(async () => {
  lastFocus = document.activeElement;
  await nextTick();
  panel.value.focus();
  document.addEventListener('keydown', keys);
  window.addEventListener('hr:before-navigate', beforeNavigate);
  window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', keys);
  window.removeEventListener('hr:before-navigate', beforeNavigate);
  window.removeEventListener('beforeunload', beforeUnload);
  lastFocus?.isConnected && lastFocus.focus();
});
</script>
<template>
  <Teleport to="body"
    ><div id="overlay"
      ><div class="mask" @click.self="close"
        ><section
          ref="panel"
          class="v-dialog w3-drawer"
          :class="[
            panelClass,
            {
              wide,
              'w3-narrow': narrow,
              'employee-detail employee-sections': employee,
              'w3-advanced': advanced,
              'w-dialog-full': full,
            },
          ]"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
        >
          <header class="modal-h"
            ><h3>{{ title }}</h3
            ><button
              class="iconbtn"
              :aria-label="full ? '退出弹窗全屏' : '弹窗全屏'"
              @click="full = !full"
              ><Icon name="full" /></button
            ><button class="iconbtn" aria-label="关闭" :disabled="busy" @click="close"
              ><Icon name="close" /></button
          ></header>
          <div class="modal-b"
            ><div v-if="error" class="v-error" role="alert">{{ error }}</div
            ><slot :full="full" :request-close="close"
          /></div>
          <footer class="modal-f"
            ><slot name="footer" :request-close="close"
              ><button class="btn" :disabled="busy" @click="close">关闭</button></slot
            ></footer
          >
          <div
            v-if="confirmLeave"
            class="w3-leave-confirm"
            role="alertdialog"
            aria-label="未保存的更改"
            ><section
              ><h3>未保存的更改</h3><p>{{ leaveMessage || '当前修改尚未保存，确定放弃更改吗？' }}</p
              ><footer
                ><button class="btn" @click="keepEditing">继续编辑</button
                ><button class="btn pri-btn" @click="discard">放弃更改</button></footer
              ></section
            ></div
          >
        </section></div
      ></div
    ></Teleport
  >
</template>
