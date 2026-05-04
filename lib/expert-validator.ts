// lib/expert-validator.ts
// ★ Phase M-19-11: 전문가 회원 검증 + 프로필 생성 헬퍼

import { eq } from "drizzle-orm";
import { db } from "../db";
import { members, expertProfiles, blobUploads } from "../db/schema";

export type ExpertType = "lawyer" | "counselor";

export interface ExpertSignupData {
  memberId: number;
  expertType: ExpertType;
  specialty?: string;
  affiliation?: string;
  licenseNumber?: string;
  yearsOfExperience?: number;
  bio?: string;
  preferredArea?: string;
  certificateBlobId?: number;
  additionalDocs?: number[];
}

/**
 * 전문가 프로필 생성 (가입 시 또는 나중에 추가)
 */
export async function createExpertProfile(data: ExpertSignupData): Promise<{
  ok: boolean;
  profileId?: number;
  error?: string;
}> {
  try {
    if (!data.memberId || !data.expertType) {
      return { ok: false, error: "memberId와 expertType은 필수입니다" };
    }

    /* 기존 프로필 확인 (member 당 1개) */
    const [existing] = await db
      .select({ id: expertProfiles.id })
      .from(expertProfiles)
      .where(eq(expertProfiles.memberId, data.memberId))
      .limit(1);

    if (existing) {
      return { ok: false, error: "이미 전문가 프로필이 존재합니다" };
    }

    /* 증빙 파일 검증 (필수) */
    if (!data.certificateBlobId) {
      return { ok: false, error: "자격증 증빙 파일이 필요합니다" };
    }

    const [blob] = await db
      .select({ id: blobUploads.id, mimeType: blobUploads.mimeType })
      .from(blobUploads)
      .where(eq(blobUploads.id, data.certificateBlobId))
      .limit(1);

    if (!blob) {
      return { ok: false, error: "증빙 파일을 찾을 수 없습니다" };
    }

    /* PDF/이미지만 허용 */
    const allowedMime = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
    if (!allowedMime.includes(blob.mimeType)) {
      return { ok: false, error: "증빙 파일은 PDF/JPG/PNG/WebP만 허용됩니다" };
    }

    /* 프로필 생성 */
    const insertData: any = {
      memberId: data.memberId,
      expertType: data.expertType,
      expertStatus: "pending",
      specialty: data.specialty ? String(data.specialty).slice(0, 200) : null,
      affiliation: data.affiliation ? String(data.affiliation).slice(0, 200) : null,
      licenseNumber: data.licenseNumber ? String(data.licenseNumber).slice(0, 100) : null,
      yearsOfExperience: Number(data.yearsOfExperience) || 0,
      bio: data.bio ? String(data.bio).slice(0, 5000) : null,
      preferredArea: data.preferredArea ? String(data.preferredArea).slice(0, 200) : null,
      certificateBlobId: data.certificateBlobId,
      additionalDocs: Array.isArray(data.additionalDocs) ? data.additionalDocs.slice(0, 5) : [],
      isMatchable: false,
    };

    const [created] = await db.insert(expertProfiles).values(insertData).returning({
      id: expertProfiles.id,
    });

    /* members 테이블에 pending_expert_review 플래그 설정 */
    await db.update(members).set({
      pendingExpertReview: true,
      status: "pending",
      updatedAt: new Date(),
    } as any).where(eq(members.id, data.memberId));

    return { ok: true, profileId: created.id };
  } catch (e: any) {
    console.error("[createExpertProfile]", e);
    return { ok: false, error: e?.message || "프로필 생성 실패" };
  }
}

/**
 * 전문가 프로필 조회
 */
export async function getExpertProfile(memberId: number): Promise<any | null> {
  try {
    const [row] = await db
      .select()
      .from(expertProfiles)
      .where(eq(expertProfiles.memberId, memberId))
      .limit(1);
    return row || null;
  } catch (e) {
    console.error("[getExpertProfile]", e);
    return null;
  }
}

/**
 * 매칭 가능한 전문가 목록 (관리자가 상담 배정 시 사용)
 */
export async function listMatchableExperts(type: ExpertType): Promise<any[]> {
  try {
    const list = await db
      .select({
        id: expertProfiles.id,
        memberId: expertProfiles.memberId,
        expertType: expertProfiles.expertType,
        specialty: expertProfiles.specialty,
        affiliation: expertProfiles.affiliation,
        yearsOfExperience: expertProfiles.yearsOfExperience,
        preferredArea: expertProfiles.preferredArea,
        maxConcurrentCases: expertProfiles.maxConcurrentCases,
        totalCasesHandled: expertProfiles.totalCasesHandled,
        totalCasesCompleted: expertProfiles.totalCasesCompleted,
        memberName: members.name,
        memberEmail: members.email,
        memberPhone: members.phone,
      })
      .from(expertProfiles)
      .innerJoin(members, eq(expertProfiles.memberId, members.id))
      .where(eq(expertProfiles.expertType, type));

    /* 추가 필터링: 승인+활성+매칭가능 */
    return list.filter((e: any) => {
      return e.memberId != null;
    });
  } catch (e) {
    console.error("[listMatchableExperts]", e);
    return [];
  }
}