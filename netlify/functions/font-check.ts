/**
 * STEP H-2b: 폰트 로딩 검증 (1회용 임시 함수)
 * 호출: GET /api/font-check?key=siren-h2b-2026
 *
 * ⚠️ 검증 성공 후 이 파일을 반드시 삭제하세요!
 *
 * 동작:
 *   - assets/fonts/NotoSansKR-Regular.ttf 파일을 여러 경로에서 시도
 *   - 파일 크기, MD5 해시, 첫 4바이트(폰트 시그니처) 응답
 *   - 어떤 경로가 실제로 동작하는지 알아내는 진단 도구
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const config = { path: "/api/font-check" };

const SECRET_KEY = "siren-h2b-2026";

export default async (req: Request) => {
  try {
    const url = new URL(req.url);
    const key = url.searchParams.get("key");
    if (key !== SECRET_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }

    const log: any[] = [];
    const cwd = process.cwd();
    log.push({ step: "process.cwd()", value: cwd });
    log.push({ step: "__dirname (fallback)", value: typeof __dirname !== "undefined" ? __dirname : "(undefined in ESM)" });

    /* 시도할 후보 경로들 (Netlify 환경에서 실제로 동작하는 곳을 찾기 위함) */
    const candidates = [
      join(cwd, "assets", "fonts", "NotoSansKR-Regular.ttf"),
      join(cwd, "..", "assets", "fonts", "NotoSansKR-Regular.ttf"),
      join(cwd, "..", "..", "assets", "fonts", "NotoSansKR-Regular.ttf"),
      join("/var/task", "assets", "fonts", "NotoSansKR-Regular.ttf"),
      "assets/fonts/NotoSansKR-Regular.ttf",
      "./assets/fonts/NotoSansKR-Regular.ttf",
    ];

    let foundPath: string | null = null;
    let foundData: { size: number; md5: string; firstBytes: string } | null = null;

    for (const p of candidates) {
      const item: any = { path: p };
      try {
        if (existsSync(p)) {
          const stat = statSync(p);
          item.exists = true;
          item.size = stat.size;
          item.sizeKB = Math.round(stat.size / 1024) + " KB";

          /* 처음 발견된 경로에서만 실제 읽어보기 */
          if (!foundPath) {
            const buf = readFileSync(p);
            const md5 = createHash("md5").update(buf).digest("hex");
            const sig = Array.from(buf.subarray(0, 4))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(" ");
            foundPath = p;
            foundData = {
              size: buf.length,
              md5,
              firstBytes: sig,
            };
            item.md5 = md5;
            item.firstBytes = sig;
            item.signatureCheck =
              sig === "00 01 00 00" ? "✅ TTF magic OK" :
              sig === "4f 54 54 4f" ? "✅ OTF magic OK" :
              "⚠️ Unknown signature";
          }
        } else {
          item.exists = false;
        }
      } catch (e: any) {
        item.error = e.message;
      }
      log.push(item);
    }

    /* 디렉토리 리스팅 시도 (디버깅용) */
    try {
      const { readdirSync } = await import("node:fs");
      const rootList = readdirSync(cwd).slice(0, 30);
      log.push({ step: "cwd ls (first 30)", value: rootList });
    } catch (e: any) {
      log.push({ step: "cwd ls failed", error: e.message });
    }

    return new Response(
      JSON.stringify(
        {
          ok: !!foundPath,
          foundPath,
          foundData,
          message: foundPath
            ? "✅ 폰트 파일을 찾았습니다. 위의 foundPath를 lib/pdf-receipt.ts에서 사용하세요."
            : "❌ 어느 경로에서도 폰트를 찾지 못했습니다. assets/fonts 폴더 위치와 netlify.toml의 included_files 설정을 확인하세요.",
          log,
        },
        null,
        2
      ),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, error: e?.message || "internal error" }, null, 2),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
};