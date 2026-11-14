import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { env } from '../config';

/**
 * HITL（Human-in-the-loop）审批中心。
 *
 * 机制：confirm 级工具执行前调用 request() 挂起（Promise 不落地直到用户决定），
 * SSE 路由通过 onRequested 订阅事件把 approval_request 推给前端；
 * 用户在前端确认卡片上批准（可改参数）/拒绝 → POST /api/chat/approvals/:id
 * → decide() resolve 挂起的 Promise → 工具继续执行（或拿到拒绝提示）。
 *
 * 为什么走 EventEmitter 而不是生成器 yield：工具在 LangGraph ToolNode 内部执行，
 * 此时 chatService.streamReply 生成器正阻塞在 for-await 上，无法产出事件——
 * 只能由路由层旁路直写 SSE。
 */

export interface ApprovalRequest {
  approvalId: string;
  conversationId: string;
  toolName: string;
  input: Record<string, unknown>;
  timeoutMs: number;
}

export interface ApprovalDecision {
  approved: boolean;
  /** 批准且用户改过参数时携带修改后的参数 */
  input?: Record<string, unknown>;
  /** 拒绝来源：用户主动拒绝 / 超时自动拒绝 */
  reason: 'user' | 'timeout';
}

interface PendingEntry {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, PendingEntry>();

/** 进程内事件总线；SSE 路由订阅 'requested'，同会话才转发 */
const bus = new EventEmitter();

export const approvalService = {
  /** 工具执行前请求确认：挂起直到用户决定或超时（超时=拒绝） */
  request(params: {
    conversationId: string;
    toolName: string;
    input: Record<string, unknown>;
  }): Promise<ApprovalDecision> {
    const request: ApprovalRequest = {
      approvalId: randomUUID(),
      conversationId: params.conversationId,
      toolName: params.toolName,
      input: params.input,
      timeoutMs: env.APPROVAL_TIMEOUT_MS,
    };
    return new Promise<ApprovalDecision>((resolve) => {
      const entry: PendingEntry = {
        request,
        resolve,
        timer: setTimeout(() => {
          pending.delete(request.approvalId);
          resolve({ approved: false, reason: 'timeout' });
        }, request.timeoutMs),
      };
      pending.set(request.approvalId, entry);
      bus.emit('requested', request);
    });
  },

  /** 用户决定（HTTP 端点调用）。返回 false = 该审批不存在或已处理（含超时） */
  decide(approvalId: string, approved: boolean, input?: Record<string, unknown>): boolean {
    const entry = pending.get(approvalId);
    if (!entry) return false;
    pending.delete(approvalId);
    clearTimeout(entry.timer);
    entry.resolve({ approved, input, reason: 'user' });
    return true;
  },

  /** SSE 路由订阅/退订（同会话过滤由订阅方做） */
  onRequested(listener: (req: ApprovalRequest) => void): void {
    bus.on('requested', listener);
  },
  offRequested(listener: (req: ApprovalRequest) => void): void {
    bus.off('requested', listener);
  },
};
