import { z } from 'zod';

/**
 * JSON Schema（MCP 工具的 inputSchema）→ zod 浅层转换。
 *
 * MCP 服务器只给 JSON Schema，而 LangChain tool() 用 zod 描述参数。
 * 绝大多数 MCP 工具参数是扁平的（string/number/boolean/枚举），
 * 这几类精确转换；嵌套 object / 复杂 array 退化为 z.any() 并把原始
 * schema 塞进 description，保证模型仍有参数线索。
 */

/** 单个属性 → zod 类型 */
function propToZod(prop: Record<string, unknown>, optional: boolean): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  const description =
    typeof prop.description === 'string' ? prop.description : undefined;

  if (Array.isArray(prop.enum)) {
    const values = prop.enum.filter((v): v is string => typeof v === 'string');
    base =
      values.length > 0
        ? z.enum(values as [string, ...string[]])
        : z.any().describe(`枚举值: ${JSON.stringify(prop.enum).slice(0, 200)}`);
  } else {
    switch (prop.type) {
      case 'string':
        base = z.string();
        break;
      case 'number':
        base = z.number();
        break;
      case 'integer':
        base = z.number().int();
        break;
      case 'boolean':
        base = z.boolean();
        break;
      case 'array':
        base = Array.isArray(prop.items)
          ? z.array(z.any().describe(`元素定义: ${JSON.stringify(prop.items).slice(0, 200)}`))
          : propToZod((prop.items ?? {}) as Record<string, unknown>, true);
        break;
      default:
        // object / oneOf / 未识别：透传原始 schema 当描述
        base = z.any().describe(`原始参数定义: ${JSON.stringify(prop).slice(0, 300)}`);
    }
  }
  const described = description ? base.describe(description) : base;
  return optional ? described.optional() : described;
}

/** 工具级 inputSchema（应为 object 类型）→ z.object */
export function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.object({});
  const s = schema as {
    type?: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: unknown[];
  };
  if (s.type !== 'object' || !s.properties || typeof s.properties !== 'object') {
    return z.object({});
  }
  const required = new Set(
    Array.isArray(s.required) ? (s.required.filter((r) => typeof r === 'string') as string[]) : [],
  );
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, prop] of Object.entries(s.properties)) {
    shape[key] = propToZod(prop, !required.has(key));
  }
  return z.object(shape);
}
