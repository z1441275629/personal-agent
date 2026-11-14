import type { Task } from '@pa/shared';
import type { NotificationDraft } from '@pa/persistence';

/**
 * 提醒任务：无副作用，直接把任务内容变成通知。
 */
export function runReminderJob(task: Task): NotificationDraft {
  return {
    taskId: task.id,
    type: 'reminder',
    title: task.name,
    body: task.payload.text ?? task.name,
  };
}
