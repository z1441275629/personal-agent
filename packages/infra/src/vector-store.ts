/**
 * 向量存储抽象（port）：知识库切片向量的读写接口。
 *
 * 设计目标：业务层（knowledge.service 等）只依赖本接口，不感知具体向量库；
 * 当前实现为 Chroma（chroma-vector-store.ts，原生 fetch 直连 v2 REST），
 * 后续如迁移 Milvus / Qdrant 等，仅需新增一个 adapter 并在装配处替换，
 * 业务代码零改动。
 *
 * 约定：
 *  - similarity 为归一化相关度（余弦相似度，越大越相关），由实现负责换算；
 *  - 只存「已向量化」的切片；无向量的关键词检索由业务层基于原文另行实现，
 *    不经过本接口（Chroma 等多数向量库强制要求向量，纯文本记录不可入库）；
 *  - 注册表（文档元信息与原文）在主库 SQLite，本接口只承载可重建的派生索引。
 */

/** 切片元数据（随向量一并存储，检索结果直接带回来源信息） */
export interface VectorChunkMeta {
  docId: string;
  docName: string;
  chunkIndex: number;
  /** 建立该向量时使用的 embedding 模型（不同模型的向量不可同空间比较，查询侧据此过滤） */
  embeddingModel: string;
}

/** 写入切片：id 需业务侧确定性生成（如 `${docId}:${chunkIndex}`），保证 upsert 幂等 */
export interface VectorChunkInput {
  id: string;
  text: string;
  metadata: VectorChunkMeta;
  embedding: number[];
}

/** 相似度查询命中项 */
export interface VectorMatch {
  id: string;
  text: string;
  metadata: VectorChunkMeta;
  similarity: number;
}

export interface VectorStore {
  /** 实现标识（chroma / milvus / ...），展示与诊断用 */
  readonly kind: string;
  /** 服务健康检查（心跳），不抛异常 */
  health(): Promise<boolean>;
  /** 确保目标集合存在且配置就绪（幂等；写入前调用） */
  ensureReady(): Promise<void>;
  /** 按 id 覆盖式写入切片（存在即更新） */
  upsertChunks(chunks: VectorChunkInput[]): Promise<void>;
  /** 删除一个文档的全部切片（文档删除 / 重建索引时调用；无命中不算错误） */
  deleteDocChunks(docId: string): Promise<void>;
  /** 更新一个文档全部切片元数据中的文档名（仅改名，不动向量） */
  updateDocName(docId: string, newDocName: string): Promise<void>;
  /** 最近邻查询：返回按相似度降序的前 k 条 */
  querySimilar(embedding: number[], k: number): Promise<VectorMatch[]>;
  /** 集合内切片总数（统计用；不可得时返回 null，不抛异常） */
  countChunks(): Promise<number | null>;
}
