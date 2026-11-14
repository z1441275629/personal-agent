import type {
  CreateTaskRequest,
  ListTasksResponse,
  RunTaskResponse,
  Task,
  UpdateTaskRequest,
} from '@pa/shared';
import { request } from './http';

export const fetchTasks = (): Promise<Task[]> =>
  request<ListTasksResponse>('/api/tasks/').then((r) => r.tasks);

export const createTask = (body: CreateTaskRequest): Promise<Task> =>
  request<Task>('/api/tasks/', { method: 'POST', body: JSON.stringify(body) });

export const updateTask = (id: string, body: UpdateTaskRequest): Promise<Task> =>
  request<Task>(`/api/tasks/${id}`, { method: 'PUT', body: JSON.stringify(body) });

export const deleteTask = (id: string): Promise<void> =>
  request<void>(`/api/tasks/${id}`, { method: 'DELETE' });

/** 立即执行一次，返回生成的通知（培训课程全文在 content） */
export const runTaskNow = (id: string): Promise<RunTaskResponse['notification']> =>
  request<RunTaskResponse>(`/api/tasks/${id}/run`, { method: 'POST' }).then(
    (r) => r.notification,
  );
