import { parse } from 'yaml';
import type { ZodType, ZodTypeDef } from 'zod';

/**
 * Parse YAML config text with a zod schema. Empty or missing text, or a file of only comments,
 * parses as `{}`, so a schema whose fields all have defaults yields the defaults.
 */
export function parseYamlConfig<T>(schema: ZodType<T, ZodTypeDef, unknown>, yamlText?: string): T {
  return schema.parse(parse(yamlText ?? '') ?? {});
}
