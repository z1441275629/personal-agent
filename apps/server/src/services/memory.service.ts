import type { CreateMemoryRequest, Memory } from '@pa/shared';
import { memoriesRepo } from '@pa/persistence';

export const memoryService = {
  list(): Memory[] {
    return memoriesRepo.list();
  },

  create(input: CreateMemoryRequest): Memory {
    return memoriesRepo.create({
      content: input.content.trim(),
      type: input.type ?? 'note',
      sourceConversationId: null,
    });
  },

  remove(id: string): void {
    const existing = memoriesRepo.get(id);
    if (!existing) {
      const err = new Error(`记忆不存在: ${id}`) as Error & { status: number };
      err.status = 404;
      throw err;
    }
    memoriesRepo.remove(id);
  },
};
