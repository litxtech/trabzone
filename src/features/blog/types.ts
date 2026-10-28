/** Blog RPC'lerinin döndürdüğü şekiller. */

export type BlogFaq = {
  question: string;
  answer: string;
};

export type BlogCategory = {
  name: string;
  count: number;
};

export type BlogListItem = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  category: string;
  tags: string[];
  author_name: string;
  reading_minutes: number;
  word_count: number;
  is_featured: boolean;
  published_at: string | null;
  updated_at: string;
};

export type BlogListResponse = {
  items: BlogListItem[];
  total: number;
  limit: number;
  offset: number;
  categories: BlogCategory[];
};

export type BlogRelatedPost = {
  slug: string;
  title: string;
  excerpt: string;
  cover_image_url: string | null;
  category: string;
  reading_minutes: number;
  published_at: string | null;
};

export type BlogPost = Omit<BlogListItem, 'is_featured' | 'author_name'> & {
  body_markdown: string;
  seo_title: string | null;
  seo_description: string | null;
  keywords: string[];
  faq: BlogFaq[];
  author_name: string;
  view_count: number;
  related: BlogRelatedPost[];
};

export type AdminBlogStatus = 'draft' | 'published' | 'archived';

export type AdminBlogListItem = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  tags: string[];
  status: AdminBlogStatus;
  is_featured: boolean;
  reading_minutes: number;
  word_count: number;
  view_count: number;
  version: number;
  ai_generated: boolean;
  ai_model: string | null;
  published_at: string | null;
  updated_at: string;
  updated_by_name: string | null;
  scheduled: boolean;
};

export type AdminBlogListResponse = {
  items: AdminBlogListItem[];
  total: number;
  limit: number;
  offset: number;
};

export type AdminBlogStats = {
  total: number;
  published: number;
  scheduled: number;
  draft: number;
  archived: number;
  featured: number;
  views: number;
  words: number;
  ai_generated: number;
};

export type AdminBlogVersion = {
  version: number;
  title: string;
  status: AdminBlogStatus;
  created_at: string;
  created_by_name: string | null;
};

export type AdminBlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body_markdown: string;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  category: string;
  tags: string[];
  seo_title: string | null;
  seo_description: string | null;
  keywords: string[];
  faq: BlogFaq[];
  author_name: string;
  status: AdminBlogStatus;
  is_featured: boolean;
  reading_minutes: number;
  word_count: number;
  view_count: number;
  ai_generated: boolean;
  ai_model: string | null;
  version: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  versions: AdminBlogVersion[];
};

export type AdminBlogAiSettings = {
  enabled: boolean;
  model: string;
  temperature: number;
  system_prompt: string;
  api_configured: boolean;
};

export type AdminBlogAiRun = {
  id: number;
  action: string;
  model: string | null;
  tokens_in: number | null;
  tokens_out: number | null;
  duration_ms: number | null;
  ok: boolean;
  error: string | null;
  created_at: string;
  actor_name: string | null;
  prompt: string | null;
};

export type AdminBlogSaveInput = {
  id: string | null;
  slug: string;
  title: string;
  excerpt: string;
  body_markdown: string;
  cover_image_url: string | null;
  cover_image_alt: string | null;
  category: string;
  tags: string[];
  seo_title: string | null;
  seo_description: string | null;
  keywords: string[];
  faq: BlogFaq[];
  author_name: string;
  status: AdminBlogStatus;
  is_featured: boolean;
  publish_at: string | null;
  ai_generated: boolean;
  ai_model: string | null;
  reason: string | null;
};

export type AiArticleResult = {
  title: string;
  excerpt: string;
  body_markdown: string;
};

export type AiSeoResult = {
  slug: string;
  seo_title: string;
  seo_description: string;
  keywords: string[];
  tags: string[];
  faq: BlogFaq[];
};

export type AiAction = 'article' | 'seo' | 'improve' | 'title' | 'faq' | 'outline';

export type AiRequest = {
  action: AiAction;
  topic?: string;
  category?: string;
  keywords?: string[];
  audience?: string;
  tone?: string;
  targetWords?: number;
  notes?: string;
  title?: string;
  body_markdown?: string;
  instructions?: string;
  count?: number;
};
