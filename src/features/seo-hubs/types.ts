export type HubMode = 'city' | 'district' | 'market' | 'real_estate' | 'places';

export type HubItem = {
  id: string;
  url: string;
  title: string;
  price_cents?: number | null;
  currency?: string | null;
  price_period?: string | null;
  condition?: string | null;
  district?: string | null;
  neighborhood?: string | null;
  category_name?: string | null;
  category_slug?: string | null;
  cover_path?: string | null;
  image_count?: number | null;
  published_at?: string | null;
  listing_kind?: string | null;
  room_count?: number | null;
  gross_m2?: number | null;
  rating?: number | null;
  review_count?: number | null;
  is_verified?: boolean | null;
};

export type HubLink = {
  slug: string;
  name: string;
  url: string;
  count: number;
  kind?: string;
};

export type HubPage = {
  ok: boolean;
  mode: HubMode;
  path: string;
  total: number;
  items: HubItem[];
  sections: HubLink[];
  categories: HubLink[];
  districts: HubLink[];
  section: { slug: string; name: string; kind: string; description: string | null } | null;
  category: { slug: string; name: string } | null;
  district: { id: number; slug: string; name: string } | null;
  updated_at: string | null;
};
