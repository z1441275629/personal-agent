<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { useChatStore } from '../stores/chat';
import { useSettingsStore } from '../stores/settings';

const chat = useChatStore();
const settings = useSettingsStore();

const input = ref('');
const messagesEl = ref<HTMLElement | null>(null);

onMounted(() => {
  void chat.loadConversations();
  void settings.load();
});

const enabledProviders = computed(() => settings.providers.filter((p) => p.enabled));
const providerId = ref<string>('');
watch(enabledProviders, (list) => {
  if (list.length && !list.some((p) => p.id === providerId.value)) {
    providerId.value = list[0]!.id;
  }
}, { immediate: true });

async function scrollToBottom(): Promise<void> {
  await nextTick();
  messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight });
}
watch(() => [chat.messages.length, chat.streamingText] as const, () => void scrollToBottom());

async function handleSend(): Promise<void> {
  const content = input.value.trim();
  if (!content || chat.streaming) return;
  input.value = '';
  await chat.send(content, providerId.value || undefined);
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    void handleSend();
  }
}
</script>

<template>
  <div class="chat-page">
    <!-- 会话侧栏 -->
    <aside class="sidebar">
      <button class="btn primary new-chat" @click="chat.startNewChat()">＋ 新对话</button>
      <div class="conv-list">
        <!-- 当前处于草稿（未落库的新会话）时置顶显示 -->
        <div v-if="!chat.activeId" class="conv-item active">
          <span class="conv-title">新对话</span>
        </div>
        <div
          v-for="c in chat.conversations"
          :key="c.id"
          class="conv-item"
          :class="{ active: c.id === chat.activeId }"
          @click="chat.select(c.id)"
        >
          <span class="conv-title">{{ c.title }}</span>
          <button
            class="icon-btn"
            title="删除会话"
            @click.stop="chat.removeConversation(c.id)"
          >
            ×
          </button>
        </div>
      </div>
    </aside>

    <!-- 消息区 -->
    <main class="main">
      <header class="main-header">
        <select v-model="providerId" class="provider-select" title="使用的模型服务">
          <option v-if="!enabledProviders.length" value="" disabled>请先在设置页配置模型</option>
          <option v-for="p in enabledProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </header>

      <div ref="messagesEl" class="messages">
        <p v-if="!chat.messages.length && !chat.streaming" class="empty">
          {{ chat.activeId ? '输入消息开始对话' : '输入消息，开始一段新对话' }}
        </p>

        <div v-for="m in chat.messages" :key="m.id" class="bubble" :class="m.role">
          <div class="who">{{ m.role === 'user' ? '我' : '助手' }}</div>
          <div class="text">{{ m.content }}</div>
        </div>

        <div v-if="chat.streaming" class="bubble assistant">
          <div class="who">助手</div>
          <div class="text">
            {{ chat.streamingText || '…' }}
            <span class="cursor">▌</span>
          </div>
        </div>

        <p v-if="chat.error" class="banner error">{{ chat.error }}</p>
      </div>

      <footer class="composer">
        <textarea
          v-model="input"
          rows="2"
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          :disabled="chat.streaming"
          @keydown="onKeydown"
        />
        <button class="btn primary" :disabled="!input.trim() || chat.streaming" @click="handleSend">
          {{ chat.streaming ? '生成中…' : '发送' }}
        </button>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  height: 100vh;
}
.sidebar {
  width: 240px;
  border-right: 1px solid #e5e5e5;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}
.new-chat {
  width: 100%;
}
.conv-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.conv-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.conv-item:hover {
  background: #f2f4f7;
}
.conv-item.active {
  background: #e3ecfa;
}
.conv-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-btn {
  border: none;
  background: none;
  color: #999;
  cursor: pointer;
  font-size: 14px;
  padding: 0 2px;
}
.icon-btn:hover {
  color: #c0392b;
}
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.main-header {
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px;
  border-bottom: 1px solid #eee;
}
.provider-select {
  border: 1px solid #ccc;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 13px;
  max-width: 220px;
}
.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.empty {
  margin: auto;
  color: #999;
}
.bubble {
  max-width: 72%;
  border-radius: 10px;
  padding: 10px 14px;
}
.bubble.user {
  align-self: flex-end;
  background: #2c6ecb;
  color: #fff;
}
.bubble.assistant {
  align-self: flex-start;
  background: #f2f4f7;
}
.who {
  font-size: 11px;
  opacity: 0.6;
  margin-bottom: 4px;
}
.text {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 14px;
  line-height: 1.6;
}
.cursor {
  animation: blink 1s step-start infinite;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.banner.error {
  align-self: center;
  background: #fdecec;
  color: #b33;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  max-width: 80%;
}
.composer {
  display: flex;
  gap: 10px;
  padding: 14px 16px;
  border-top: 1px solid #eee;
  align-items: flex-end;
}
.composer textarea {
  flex: 1;
  resize: none;
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 14px;
  font-family: inherit;
}
.composer textarea:focus {
  outline: 1px solid #2c6ecb;
}
.btn {
  border: 1px solid #ccc;
  border-radius: 6px;
  background: #fff;
  padding: 6px 14px;
  cursor: pointer;
}
.btn.primary {
  background: #2c6ecb;
  border-color: #2c6ecb;
  color: #fff;
}
.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
