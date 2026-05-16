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
 * - data에 키가 없으면 sample 사용(미리보기 모드만), sample도 없으면 빈 문자열 + warning
 * - {{key}} 외 블록·조건문 미지원
 * - HTML 이스케이프 X (이메일 HTML 본문에서 raw 사용 의도)
 *
 * ★ 2026-05-16: 진짜 발송 시 sample fallback 사용하면 미리보기 예시값(예: "홍길동")이
 * 실제 메일에 그대로 박혀버림. options.useSampleFallback 기본값을 false로 두고,
 * 미리보기 화면에서만 명시적으로 true 전달하도록 변경.
 */
export interface RenderOptions {
  /** true면 변수 데이터 못 찾을 때 variables[].sample로 fallback (미리보기 전용). 기본 false. */
  useSampleFallback?: boolean;
}

export function renderTemplate(
  template: string,
  variables: TemplateVariable[],
  data: Record<string, string> = {},
  options: RenderOptions = {},
): RenderResult {
  const warnings: string[] = [];
  const varMap = new Map(variables.map((v) => [v.key, v]));
  const allowSample = options.useSampleFallback === true;

  /* ★ 2026-05-16: \w+는 ASCII 단어 문자만 매칭 → 한글 변수명({{회원이름}})은
     치환 안 되고 그대로 남던 결함. [^{}]+로 확장해 한글·공백 포함 변수명 지원.
     키 trim 추가로 {{ 회원이름 }} 같은 공백 입력도 안전 처리. */
  const rendered = template.replace(/\{\{([^{}]+)\}\}/g, (_, rawKey: string) => {
    const key = String(rawKey).trim();
    if (key in data) return data[key];
    if (allowSample) {
      const varDef = varMap.get(key);
      if (varDef?.sample !== undefined && varDef.sample !== "") return varDef.sample;
    }
    warnings.push(`변수 {{${key}}}의 값이 없어 빈 문자열로 치환되었습니다.`);
    return "";
  });

  return { rendered, warnings };
}

/** 본문에서 사용된 {{key}} 모두 추출 (중복 제거) — 한글 변수명 지원 */
export function extractVariableKeys(template: string): string[] {
  const keys = new Set<string>();
  for (const [, rawKey] of template.matchAll(/\{\{([^{}]+)\}\}/g)) {
    keys.add(String(rawKey).trim());
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
