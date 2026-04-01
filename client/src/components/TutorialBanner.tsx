import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { GraduationCap, ChevronDown, ChevronUp } from "lucide-react";

// Tutorial 계정 username 목록
const TUTORIAL_USERNAMES = ["owner1", "supervisor1", "staff1", "staff2"];

// 페이지별 가이드 텍스트
const PAGE_GUIDES: Record<string, { title: string; tips: string[] }> = {
  // 대시보드
  dashboard: {
    title: "대시보드",
    tips: [
      "오늘의 매출, 매입, 스케줄 현황을 한눈에 확인할 수 있습니다.",
      "각 카드를 클릭하면 상세 페이지로 이동합니다.",
    ],
  },
  "admin-dashboard": {
    title: "사업 대시보드",
    tips: [
      "전체 매장의 매출·비용·수익 현황을 확인합니다.",
      "매장별 성과를 비교하고 월간 추이를 분석하세요.",
    ],
  },
  // 매출
  sales: {
    title: "매출 관리",
    tips: [
      "일일 매출을 등록하고 마감 처리할 수 있습니다.",
      "카드/현금/배달앱 등 매출 유형별로 기록하세요.",
      "마감 후에는 수정이 제한됩니다. 점장 이상 권한으로 마감 해제가 가능합니다.",
    ],
  },
  // 월정산
  profitability: {
    title: "월정산",
    tips: [
      "한 달간 수집된 매출·매입·인건비·고정비 데이터를 점검합니다.",
      "데이터 수집 현황에서 누락 항목을 확인하세요.",
      "모든 데이터 확인 후 월정산을 확정하면 월간 손익이 기록됩니다.",
    ],
  },
  // 거래처
  counterparties: {
    title: "거래처 관리",
    tips: [
      "매장에 납품하는 거래처와 품목을 등록합니다.",
      "거래처별 품목·단가를 설정하면 매입 등록 시 자동으로 연동됩니다.",
      "전화번호를 등록하면 바로 전화 연결이 가능합니다.",
    ],
  },
  // 매입
  "purchase-management": {
    title: "매입 관리",
    tips: [
      "일별 매입 내역을 거래처별로 등록합니다.",
      "전표/영수증을 촬영하면 OCR로 자동 인식하여 입력됩니다.",
      "인식 결과에 '확인 필요' 표시가 있으면 반드시 검토하세요.",
    ],
  },
  // 고정비
  "fixed-costs": {
    title: "고정비 관리",
    tips: [
      "임대료, 보험료, 통신비 등 월 고정 지출을 관리합니다.",
      "매월 반복되는 비용은 한 번 등록하면 자동 반영됩니다.",
    ],
  },
  // 스케줄
  schedule: {
    title: "근무 스케줄",
    tips: [
      "주간 근무 스케줄을 작성하고 게시합니다.",
      "직원은 휴무 신청 탭에서 휴무를 요청할 수 있습니다.",
      "스케줄 상태: 초안 → 게시 → 확정 → 완료 순서로 진행됩니다.",
    ],
  },
  // 운영일지
  "daily-ops": {
    title: "운영일지",
    tips: [
      "오픈/마감 체크리스트를 실행하고 기록합니다.",
      "발주서 이미지를 업로드하면 OCR로 품목이 자동 인식됩니다.",
      "특이사항이나 인수인계 사항을 메모로 남기세요.",
    ],
  },
  // 운영캘린더
  "ops-calendar": {
    title: "운영 캘린더",
    tips: [
      "매장 운영 일정을 캘린더 형태로 확인합니다.",
      "체크리스트 완료 현황, 매출 마감 여부를 한눈에 파악하세요.",
    ],
  },
  // 업무관리
  "task-management": {
    title: "업무 관리",
    tips: [
      "매장 단위 업무를 등록하고 담당자를 배정합니다.",
      "진행 상태(대기·진행·완료)로 업무를 추적하세요.",
    ],
  },
  // 인건비
  "labor-cost": {
    title: "인건비 관리",
    tips: [
      "직원별 근무시간과 시급을 기반으로 인건비를 정산합니다.",
      "스케줄 데이터와 연동되어 자동 계산됩니다.",
    ],
  },
  // 직원관리
  staff: {
    title: "직원 관리",
    tips: [
      "매장 소속 직원을 등록하고 역할(점장/매니져/직원)을 배정합니다.",
      "근로계약서 발송, 보건증 관리 기능이 포함되어 있습니다.",
    ],
  },
  // 매장관리
  restaurants: {
    title: "매장 관리",
    tips: [
      "매장 정보(주소, 영업시간, 목표매출 등)를 설정합니다.",
      "매장별 계약 조건(임대료, 수수료율, 로열티)을 관리할 수 있습니다.",
    ],
  },
  // 레시피
  recipes: {
    title: "레시피 정보",
    tips: [
      "메뉴별 레시피를 등록하고 직원들과 공유합니다.",
      "사진과 함께 조리 방법을 기록하세요.",
      "카테고리별로 분류하면 찾기 쉽습니다.",
    ],
  },
  // 업무정보
  "store-info": {
    title: "업무 정보",
    tips: [
      "매장 운영에 필요한 정보 카드를 등록합니다.",
      "공지사항, 매뉴얼, 연락처 등 자주 참고하는 정보를 고정하세요.",
    ],
  },
  // 사용자관리
  users: {
    title: "사용자 관리",
    tips: [
      "시스템 전체 사용자 계정을 관리합니다.",
      "역할(개발자/대표) 배정과 비밀번호 초기화가 가능합니다.",
    ],
  },
  // 시스템
  system: {
    title: "시스템 관리",
    tips: [
      "에러 로그, 알림 이력 등 시스템 운영 정보를 확인합니다.",
    ],
  },
};

interface TutorialBannerProps {
  pageKey: string;
}

export default function TutorialBanner({ pageKey }: TutorialBannerProps) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  // Tutorial 계정이 아니면 렌더링하지 않음
  if (!user || !TUTORIAL_USERNAMES.includes(user.username)) return null;

  const guide = PAGE_GUIDES[pageKey];
  if (!guide) return null;

  return (
    <div className="mx-auto max-w-full">
      <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/30 rounded-lg overflow-hidden">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-emerald-100/50 dark:hover:bg-emerald-500/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
              Tutorial — {guide.title}
            </span>
          </div>
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          )}
        </button>
        {!collapsed && (
          <div className="px-3 pb-2.5 pt-0">
            <ul className="space-y-1">
              {guide.tips.map((tip, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-emerald-900 dark:text-slate-300 leading-relaxed">
                  <span className="text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0">•</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
