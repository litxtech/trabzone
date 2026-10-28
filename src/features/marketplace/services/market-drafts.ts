import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'trabzone.market.drafts.v2';
const MAX_DRAFTS = 20;

export type MarketDraft = {
  id: string;
  title: string;
  category_name: string;
  kind: string;
  cover_uri: string | null;
  updated_at: string;
  payload: Record<string, unknown>;
};

async function readAll(): Promise<MarketDraft[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MarketDraft[]) : [];
  } catch {
    return [];
  }
}

async function writeAll(drafts: MarketDraft[]) {
  await AsyncStorage.setItem(KEY, JSON.stringify(drafts.slice(0, MAX_DRAFTS)));
}

export async function listMarketDrafts(): Promise<MarketDraft[]> {
  return readAll();
}

export async function saveMarketDraft(draft: MarketDraft): Promise<void> {
  const drafts = await readAll();
  const next = [draft, ...drafts.filter((entry) => entry.id !== draft.id)].slice(0, MAX_DRAFTS);
  await writeAll(next);
}

export async function deleteMarketDraft(id: string): Promise<void> {
  const drafts = await readAll();
  await writeAll(drafts.filter((entry) => entry.id !== id));
}
