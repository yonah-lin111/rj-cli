export type RankingType = "24h" | "7d" | "30d" | "year";
export type WorksQueryPreset = "all" | "latest-added" | "latest-undownloaded";

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

export interface CircleAddResponse {
  name: string;
  added: boolean;
  exists?: boolean;
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

export type DownloadLinksValue = Record<string, unknown> | unknown[] | string | null;

export interface WorkItem {
  rj_code: string;
  title?: string;
  title_url?: string;
  circle?: string;
  circle_url?: string;
  cv?: string;
  tags: string[];
  release_date?: string;
  thumbnail?: string | null;
  source?: string | null;
  status?: number;
  created_at?: string;
  download_links: DownloadLinksValue;
}

export interface WorksListResponse {
  preset: WorksQueryPreset;
  total: number;
  page: number;
  page_size: number;
  data: WorkItem[];
}

export interface ResourceMatchItem {
  rj_code: string;
  title?: string;
  source?: string;
  matched_url?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ResourceMatchResponse {
  total: number;
  message?: string;
  items?: ResourceMatchItem[];
  [key: string]: unknown;
}

export interface WorkOpsPreviewAudioFile {
  filename: string;
  format: string;
  size_mb: number;
}

export interface WorkOpsPreviewSubFolder {
  name: string;
  audio_files: WorkOpsPreviewAudioFile[];
  image_files: string[];
  other_items: string[];
}

export interface WorkOpsPreviewResponse {
  success: boolean;
  message: string;
  rj_code?: string;
  title?: string;
  cv?: string;
  cv_folder_name?: string;
  audio_files: WorkOpsPreviewAudioFile[];
  image_files: string[];
  cover_image?: string;
  other_items: string[];
  output_path_preview?: string;
  sub_folders: WorkOpsPreviewSubFolder[];
}

export interface WorkOpsProgressEvent {
  step: string;
  message: string;
  progress?: number;
  total?: number;
  output_path?: string;
  total_files?: number;
  success_count?: number;
  error_count?: number;
  errors?: string[];
}

export interface WorkOpsProcessResponse {
  success: boolean;
  events: WorkOpsProgressEvent[];
  last_event: WorkOpsProgressEvent | null;
  error?: string;
}
