export interface TemplateVariable {
  key: string;
  label?: string;
  sample?: string;
}

export interface RenderResult {
  rendered: string;
  warnings: string[];
}

/**
 * mustache 스타일 {{key}} 치환.
 * - data에 키가 없으면 sample 사용, sample도 없으면 빈 문자열 + warning
 * - {{key}} 외 블록·조건문 미지원
 * - HTML 이스케이프 X (이메일 HTML 본문에서 raw 사용 의도)
 */
export function renderTemplate(
  template: string,
  variables: TemplateVariable[],
  data: Record<string, string> = {},
): RenderResult {
  const warnings: string[] = [];
  const varMap = new Map(variables.map((v) => [v.key, v]));

  const rendered = template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (key in data) return data[key];
    const varDef = varMap.get(key);
    if (varDef?.sample !== undefined && varDef.sample !== "") return varDef.sample;
    warnings.push(`변수 {{${key}}}의 값이 없어 빈 문자열로 치환되었습니다.`);
    return "";
  });

  return { rendered, warnings };
}

/** 본문에서 사용된 {{key}} 모두 추출 (중복 제거) */
export function extractVariableKeys(template: string): string[] {
  const keys = new Set<string>();
  for (const [, key] of template.matchAll(/\{\{(\w+)\}\}/g)) {
    keys.add(key);
  }
  return Array.from(keys);
}

/** variables[].key와 본문 사용 키 비교 → 미정의 키 목록 반환 */
export function findUndefinedVariables(
  template: string,
  variables: TemplateVariable[],
): string[] {
  const defined = new Set(variables.map((v) => v.key));
  return extractVariableKeys(template).filter((k) => !defined.has(k));
}
