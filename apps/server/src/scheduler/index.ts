import cron, { type ScheduledTask } from 'node-cron';
import type { Notification, Task } from '@pa/shared';
import { notificationsRepo, tasksRepo } from '@pa/persistence';
import { runReminderJob } from './jobs/reminder';
import { runDailyTrainingJob } from './jobs/daily-training';

/**
 * 定时任务调度器：server 进程内单例。
 * - 任务定义存 SQLite，增删改后调用 reload() 重建 cron 注册表
 * - cron 触发与手动"立即执行"统一走 runTask()
 * - 已知限制：应用未运行时错过的任务不补跑（个人桌面场景后续可加启动补跑）
 */
class TaskScheduler {
  private jobs = new Map<string, ScheduledTask>();

  /** 启动时全量注册启用的任务 */
  start(): void {
    this.reload();
  }

  /** 重建注册表：停掉全部旧 job，按当前任务表重新注册 */
  reload(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();

    for (const task of tasksRepo.list()) {
      if (!task.enabled) continue;
      if (!cron.validate(task.cron)) {
        console.warn(`[scheduler] 任务「${task.name}」cron 无效，跳过: ${task.cron}`);
        continue;
      }
      const job = cron.schedule(task.cron, () => void this.fire(task.id));
      this.jobs.set(task.id, job);
    }
    console.log(`[scheduler] 已注册 ${this.jobs.size} 个定时任务`);
  }

  /** cron 到点触发：按 id 重读最新任务定义（避免闭包持有旧数据） */
  private async fire(taskId: string): Promise<void> {
    const task = tasksRepo.get(taskId);
    if (!task || !task.enabled) return;
    try {
      await runTask(task);
    } catch (err) {
      // runTask 内部已兜底落错误通知，这里只记日志
      console.error(`[scheduler] 任务「${task.name}」执行异常:`, err);
    }
  }

  stop(): void {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }
}

export const taskScheduler = new TaskScheduler();

/** 通知标题/正文截断：系统 toast 和列表预览只放短文本，全文在 content */
const TITLE_MAX = 40;
const BODY_MAX = 80;

function clampText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 执行一次任务（cron 触发 / 手动运行共用）：
 * 按 type 跑对应 job → 产出通知 → 记录 lastRunAt。
 * job 抛错时降级为一条 error 通知，不让调度器崩掉。
 */
export async function runTask(task: Task): Promise<Notification> {
  try {
    const raw =
      task.type === 'reminder' ? runReminderJob(task) : await runDailyTrainingJob(task);
    const notification = notificationsRepo.create({
      ...raw,
      title: clampText(raw.title, TITLE_MAX),
      body: clampText(raw.body, BODY_MAX),
    });
    tasksRepo.setLastRun(task.id);
    return notification;
  } catch (err) {
    const notification = notificationsRepo.create({
      taskId: task.id,
      type: 'error',
      title: clampText(`「${task.name}」执行失败`, TITLE_MAX),
      body: clampText(err instanceof Error ? err.message : String(err), BODY_MAX),
    });
    tasksRepo.setLastRun(task.id);
    return notification;
  }
}
