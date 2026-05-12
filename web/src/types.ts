export type RankingType = "24h" | "7d" | "30d" | "year";

export interface RankItem {
  rank: number;
  rj_code: string;
  title: string;
  title_url?: string;
  circle?: string;
  circle_url?: string;
  cv?: string;
  tags: string[];
  release_date?: string;
  thumbnail?: string | null;
  nsfw?: boolean;
}

export interface RankingResponse {
  ranking_type: RankingType;
  total: number;
  page: number;
  page_size: number;
  items: RankItem[];
}

export interface CircleItem {
  name: string;
  nickname?: string;
  circle_url?: string;
  remark?: string;
  rj_count?: number;
  created_at?: string;
}

export interface CircleListResponse {
  total: number;
  page: number;
  page_size: number;
  data: CircleItem[];
}

export interface CircleDetail {
  name: string;
  nickname?: string;
  circle_url?: string;
  remark?: string;
  rj_count?: number;
  created_at?: string;
}

export interface CircleWork {
  rj_code: string;
  title?: string;
  title_url?: string;
  status?: number;
  source?: string;
  tags: string[];
  release_date?: string;
  thumbnail?: string;
  nsfw?: boolean;
  added_at?: string;
}

export interface CircleWorksResponse {
  total: number;
  page: number;
  page_size: number;
  data: CircleWork[];
}

export interface CircleLatestWork {
  rj_code: string;
  title: string;
  title_url: string | null;
  thumbnail: string | null;
  release_date: string | null;
  is_all_ages: boolean;
  cv: string | null;
  tags: string[];
}

export interface CircleLatestWorksResponse {
  circle_name: string;
  circle_url: string;
  total: number;
  items: CircleLatestWork[];
}
