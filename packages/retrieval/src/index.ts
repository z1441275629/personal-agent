// @pa/retrieval — 检索：切分、关键词/向量打分（RAG 管线由 server 的 knowledge.service 编排）
// 依赖方向：只允许向下引用（见 docs/architecture.md）

export interface ChunkOptions {
  /** 单块目标字符数 */
  maxChars?: number;
  /** 相邻块重叠字符数（硬切长段落时保留上下文） */
  overlap?: number;
}

const DEFAULT_MAX_CHARS = 800;
const DEFAULT_OVERLAP = 120;

/**
 * 文档切分：段落感知（\n\n 分段组装；超长段落按 maxChars 硬切并带重叠）。
 * 尾部碎块（< 15% 目标长度）并入前块，避免无意义的小块。
 */
export function chunkText(content: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const overlap = Math.min(options.overlap ?? DEFAULT_OVERLAP, Math.floor(maxChars / 2));
  const paragraphs = content
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!paragraphs.length) return [];

  // 先把超长段落炸成 ≤maxChars 的段（带重叠），得到规整段列表
  const pieces: string[] = [];
  for (const p of paragraphs) {
    if (p.length <= maxChars) {
      pieces.push(p);
      continue;
    }
    for (let start = 0; start < p.length; start += maxChars - overlap) {
      pieces.push(p.slice(start, start + maxChars));
      if (start + maxChars >= p.length) break;
    }
  }

  // 组装：装满即出块
  const chunks: string[] = [];
  let buf = '';
  for (const piece of pieces) {
    if (!buf) {
      buf = piece;
    } else if (buf.length + piece.length + 2 <= maxChars) {
      buf = `${buf}\n\n${piece}`;
    } else {
      chunks.push(buf);
      buf = piece;
    }
  }
  // 尾块过小并入前块
  if (buf) {
    const last = chunks[chunks.length - 1];
    if (last && buf.length < maxChars * 0.15 && last.length + buf.length + 2 <= maxChars * 1.25) {
      chunks[chunks.length - 1] = `${last}\n\n${buf}`;
    } else {
      chunks.push(buf);
    }
  }
  return chunks;
}

/** 余弦相似度（零向量返回 0） */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 提取检索词：CJK 2-gram + 拉丁词（小写） */
function extractTerms(text: string): string[] {
  const terms: string[] = [];
  const lower = text.toLowerCase();
  // 拉丁词
  for (const w of lower.match(/[a-z0-9_]{2,}/g) ?? []) terms.push(w);
  // CJK 2-gram（连续汉字段滑窗）
  for (const seg of lower.match(/[一-鿿]+/g) ?? []) {
    if (seg.length === 1) {
      terms.push(seg);
    } else {
      for (let i = 0; i + 1 < seg.length; i++) terms.push(seg.slice(i, i + 2));
    }
  }
  return terms;
}

/**
 * 关键词相关度（无 embedding 时的兜底检索）：
 * 查询词命中数 / 查询词总数，多次出现轻微加权，短块轻微惩罚。
 * 分值域约 [0, 1.2]。
 */
export function keywordScore(query: string, text: string): number {
  const terms = [...new Set(extractTerms(query))];
  if (!terms.length) return 0;
  const haystack = text.toLowerCase();
  let hit = 0;
  for (const t of terms) {
    let first = haystack.indexOf(t);
    if (first === -1) continue;
    hit += 1;
    // 额外出现加权（封顶 2 次）
    for (let extra = 0; extra < 2; extra++) {
      first = haystack.indexOf(t, first + t.length);
      if (first === -1) break;
      hit += 0.15;
    }
  }
  const coverage = hit / terms.length;
  const lengthPenalty = 1 / (1 + Math.max(0, text.length - 1_500) / 3_000);
  return coverage * lengthPenalty;
}
