import { z } from 'zod';
import { MemorySchema, MemoryTypeSchema } from '../domain/memory';

export const ListMemoriesResponseSchema = z.object({
  memories: z.array(MemorySchema),
});
export type ListMemoriesResponse = z.infer<typeof ListMemoriesResponseSchema>;

export const CreateMemoryRequestSchema = z.object({
  content: z.string().min(1).max(2_000),
  type: MemoryTypeSchema.optional(),
});
export type CreateMemoryRequest = z.infer<typeof CreateMemoryRequestSchema>;
