<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * 轻量 Markdown 渲染（marked 解析 + DOMPurify 防 XSS）。
 * AI 输出不可信（提示注入可让它产出 HTML），sanitize 必须保留。
 * 链接强制新窗口/外部打开（Electron 里不能让应用窗口跳走）。
 */

// 外链行为：sanitize 后补 target/rel
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

marked.setOptions({ gfm: true, breaks: true });

const props = defineProps<{ text: string }>();

const html = computed(() =>
  DOMPurify.sanitize(marked.parse(props.text ?? '', { async: false }) as string),
);
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html — 内容经 DOMPurify 消毒 -->
  <div class="md" v-html="html"></div>
</template>

<style scoped>
.md {
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
}
.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4) {
  margin: 0.8em 0 0.4em;
  line-height: 1.35;
}
.md :deep(h1) {
  font-size: 1.35em;
}
.md :deep(h2) {
  font-size: 1.2em;
}
.md :deep(h3) {
  font-size: 1.08em;
}
.md :deep(p) {
  margin: 0.45em 0;
  white-space: pre-wrap;
}
.md :deep(ul),
.md :deep(ol) {
  margin: 0.45em 0;
  padding-left: 1.5em;
}
.md :deep(li) {
  margin: 0.2em 0;
}
.md :deep(code) {
  font-family: Consolas, Menlo, monospace;
  font-size: 0.92em;
  background: rgba(0, 0, 0, 0.06);
  border-radius: 4px;
  padding: 0.1em 0.35em;
}
.md :deep(pre) {
  background: #282c34;
  border-radius: 8px;
  padding: 12px 14px;
  overflow-x: auto;
  margin: 0.6em 0;
}
.md :deep(pre code) {
  background: none;
  color: #e6eaf0;
  padding: 0;
  font-size: 12.5px;
  line-height: 1.6;
}
.md :deep(blockquote) {
  margin: 0.5em 0;
  padding: 0.2em 0.9em;
  border-left: 3px solid rgba(0, 0, 0, 0.18);
  color: #666;
}
.md :deep(table) {
  border-collapse: collapse;
  margin: 0.6em 0;
  font-size: 13px;
}
.md :deep(th),
.md :deep(td) {
  border: 1px solid rgba(0, 0, 0, 0.15);
  padding: 4px 10px;
}
.md :deep(th) {
  background: rgba(0, 0, 0, 0.04);
}
.md :deep(a) {
  color: #2c6ecb;
}
.md :deep(hr) {
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.12);
  margin: 0.8em 0;
}
.md :deep(img) {
  max-width: 100%;
}
/* 深底色的用户气泡内暂不使用本组件（用户消息保持纯文本） */
</style>
