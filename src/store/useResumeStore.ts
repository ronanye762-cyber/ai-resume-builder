import { create } from "zustand";

export interface BasicsData {
  name: string;
  email: string;
  phone: string;
  summary: string;
}

export interface EducationItem {
  school: string;
  degree: string;
  major: string;
  startDate?: string;
  endDate?: string;
}

export interface ExperienceItem {
  company?: string;
  role: string;
  startDate?: string;
  endDate?: string;
  description: string;
}

export interface ResumeData {
  basics: BasicsData;
  targetRole: string;
  education: EducationItem[];
  experience: ExperienceItem[];
  skills: string[];
}

/** AI 返回的 JSON 结构（所有字段均可选） */
export interface AiResumePayload {
  basics?: Partial<BasicsData>;
  targetRole?: string;
  education?: EducationItem[];
  experience?: ExperienceItem[];
  skills?: string[];
}

// ── 访谈阶段状态机 ────────────────────────────────────────────
export type InterviewPhase =
  | "EDUCATION"    // 基本信息 & 教育背景
  | "INTERNSHIP"   // 实习经历
  | "PROJECT"      // 项目经历
  | "HONOR"        // 荣誉 & 技能
  | "SUMMARY"      // 个人总结
  | "DONE";        // 访谈完成

export const PHASE_ORDER: InterviewPhase[] = [
  "EDUCATION", "INTERNSHIP", "PROJECT", "HONOR", "SUMMARY", "DONE",
];

/** 阶段 → 进度条步骤 index（DONE=5 表示全部完成） */
export const PHASE_TO_STEP: Record<InterviewPhase, number> = {
  EDUCATION: 0,
  INTERNSHIP: 1,
  PROJECT: 2,
  HONOR: 3,
  SUMMARY: 4,
  DONE: 5,
};

export type AppMode = "idle" | "mining" | "polishing";

interface ResumeStore {
  mode: AppMode;
  setMode: (mode: AppMode) => void;

  currentPhase: InterviewPhase;
  advancePhase: () => void;
  resetInterview: () => void;

  resumeData: ResumeData;
  updateBasics: (patch: Partial<BasicsData>) => void;
  updateResume: (payload: AiResumePayload) => void;
  appendExperience: (item: ExperienceItem) => void;
}

const initialResumeData: ResumeData = {
  basics: { name: "待填", email: "", phone: "", summary: "" },
  targetRole: "",
  education: [],
  experience: [],
  skills: [],
};

const useResumeStore = create<ResumeStore>((set) => ({
  mode: "idle",
  setMode: (mode) => set({ mode }),

  currentPhase: "EDUCATION",
  advancePhase: () =>
    set((state) => {
      const idx = PHASE_ORDER.indexOf(state.currentPhase);
      const next = PHASE_ORDER[Math.min(idx + 1, PHASE_ORDER.length - 1)];
      return { currentPhase: next };
    }),
  resetInterview: () =>
    set({ currentPhase: "EDUCATION", resumeData: initialResumeData }),

  resumeData: initialResumeData,

  updateBasics: (patch) =>
    set((state) => ({
      resumeData: {
        ...state.resumeData,
        basics: { ...state.resumeData.basics, ...patch },
      },
    })),

  appendExperience: (item) =>
    set((state) => ({
      resumeData: {
        ...state.resumeData,
        experience: [...state.resumeData.experience, item],
      },
    })),

  updateResume: (payload) =>
    set((state) => ({
      resumeData: {
        ...state.resumeData,
        basics: payload.basics
          ? { ...state.resumeData.basics, ...payload.basics }
          : state.resumeData.basics,
        targetRole: payload.targetRole ?? state.resumeData.targetRole,
        education:
          payload.education && payload.education.length > 0
            ? payload.education
            : state.resumeData.education,
        experience:
          payload.experience && payload.experience.length > 0
            ? payload.experience
            : state.resumeData.experience,
        skills:
          payload.skills && payload.skills.length > 0
            ? payload.skills
            : state.resumeData.skills,
      },
    })),
}));

export default useResumeStore;
