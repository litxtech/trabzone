// Trabzonspor Maç Arenası — RPC yanıt tipleri (0195–0198 migration'larıyla birebir).

export type MatchPhase =
  | 'scheduled'
  | 'first_half'
  | 'half_time'
  | 'second_half'
  | 'extra_time'
  | 'break_time'
  | 'penalties'
  | 'suspended'
  | 'interrupted'
  | 'live'
  | 'finished'
  | 'finished_aet'
  | 'finished_pen'
  | 'postponed'
  | 'cancelled'
  | 'abandoned'
  | 'awarded'
  | 'walkover'
  | 'unknown';

export type Side = 'home' | 'away';

export type ScorePair = { home: number | null; away: number | null };

export type FixtureTeam = { id: number | null; name: string | null; logo: string | null };

export type Fixture = {
  id: number;
  uid: string;
  is_test: boolean;
  league: {
    id: number | null;
    name: string | null;
    type: string | null;
    country: string | null;
    season: number | null;
    round: string | null;
    logo: string | null;
  };
  kickoff_at: string;
  venue: { name: string | null; city: string | null };
  referee: string | null;
  status: {
    short: string;
    long: string | null;
    elapsed: number | null;
    extra: number | null;
    phase: MatchPhase;
    is_live: boolean;
    is_finished: boolean;
  };
  primary_side: Side;
  home: FixtureTeam;
  away: FixtureTeam;
  goals: ScorePair;
  score: { halftime: ScorePair; fulltime: ScorePair; extratime: ScorePair; penalty: ScorePair };
  lineups_available: boolean;
  synced: {
    fixture: string | null;
    events: string | null;
    stats: string | null;
    lineups: string | null;
    players: string | null;
  };
  data_age_seconds: number | null;
  live_started_at: string | null;
  finished_at: string | null;
  final_verified: boolean;
  chat_state: 'auto' | 'open' | 'paused' | 'closed';
  comments_locked: boolean;
};

export type EventKind =
  | 'goal'
  | 'own_goal'
  | 'penalty_goal'
  | 'missed_penalty'
  | 'shootout_goal'
  | 'shootout_miss'
  | 'yellow'
  | 'red'
  | 'second_yellow'
  | 'substitution'
  | 'var'
  | 'other';

export type MatchEvent = {
  id: string;
  kind: EventKind;
  type: string | null;
  detail: string | null;
  comments: string | null;
  minute: number | null;
  extra: number | null;
  team_id: number | null;
  team_name: string | null;
  player_id: number | null;
  player_name: string | null;
  assist_id: number | null;
  assist_name: string | null;
  revision: number;
  first_seen_at: string;
};

export type StatKey =
  | 'ball_possession'
  | 'total_shots'
  | 'shots_on_goal'
  | 'shots_off_goal'
  | 'blocked_shots'
  | 'shots_insidebox'
  | 'shots_outsidebox'
  | 'corner_kicks'
  | 'offsides'
  | 'fouls'
  | 'yellow_cards'
  | 'red_cards'
  | 'goalkeeper_saves'
  | 'total_passes'
  | 'passes_accurate'
  | 'passes_pct'
  | 'expected_goals'
  | 'goals_prevented';

/** Anahtar yoksa sağlayıcı bu istatistiği vermemiştir; değer null ise "veri yok". */
export type TeamStats = Partial<Record<StatKey, number | null>>;

export type ChatSummary = { state: ChatRoomState; active_users: number; messages: number };

export type ChatRoomState = 'disabled' | 'closed' | 'paused' | 'open' | 'not_open';

export type FeedCardMode = 'preview' | 'live' | 'result' | 'status';

export type FeedCard = {
  enabled: boolean;
  mode?: FeedCardMode;
  settings?: {
    default_view: 'compact' | 'expanded';
    show_chat_count: boolean;
    show_stats: boolean;
    allow_hide: boolean;
  };
  fixture: Fixture | null;
  last_event?: MatchEvent | null;
  stats?: { home: TeamStats | null; away: TeamStats | null; updated_at: string | null } | null;
  chat?: ChatSummary | null;
};

export type ChatPinned = { body: string; by?: string; at?: string } | null;

export type FixtureDetail = {
  fixture: Fixture;
  last_event: MatchEvent | null;
  coverage: Record<string, unknown>;
  available: { events: boolean; stats: boolean; lineups: boolean; players: boolean; snapshots: boolean };
  chat: ChatSummary;
  pinned: ChatPinned;
  rights: { logos: boolean; player_photos: boolean };
  attribution: string;
};

export type StatSnapshot = {
  at: string;
  elapsed: number | null;
  status: string | null;
  home: TeamStats | null;
  away: TeamStats | null;
};

export type FixtureStats = {
  home: TeamStats | null;
  away: TeamStats | null;
  updated_at: string | null;
  snapshots: StatSnapshot[];
};

export type FixtureTimeline = {
  events: MatchEvent[];
  phases: { status: string; phase: MatchPhase; elapsed: number | null; at: string }[];
  updated_at: string | null;
};

export type LineupPlayer = {
  id: number | null;
  name: string | null;
  number: number | null;
  pos: string | null;
  grid: string | null;
};

export type TeamLineup = {
  team_id: number;
  team_name: string | null;
  formation: string | null;
  coach: { id: number | null; name: string | null; photo?: string | null } | null;
  start_xi: LineupPlayer[];
  substitutes: LineupPlayer[];
  colors: Record<string, unknown> | null;
  is_predicted: boolean;
  source: string | null;
  updated_at: string;
};

export type PlayerPerformance = {
  player_id: number;
  team_id: number;
  name: string;
  number: number | null;
  position: string | null;
  minutes: number | null;
  rating: number | null;
  captain: boolean;
  substitute: boolean;
  stats: Record<string, unknown>;
  photo: string | null;
};

export type FixtureLineups = {
  teams: TeamLineup[];
  players: PlayerPerformance[];
  updated_at: string | null;
};

export type StandingRow = {
  group: string | null;
  rank: number;
  team_id: number;
  team_name: string;
  team_logo: string | null;
  points: number | null;
  goals_diff: number | null;
  form: string | null;
  description: string | null;
  played: number | null;
  win: number | null;
  draw: number | null;
  lose: number | null;
  goals_for: number | null;
  goals_against: number | null;
};

export type Standings = {
  league: { id: number; season: number; name: string; type: string; logo: string | null } | null;
  primary_team_id?: number | null;
  rows: StandingRow[];
  synced_at?: string | null;
};

export type SportsCenter = {
  configured: boolean;
  team: { id: number; name: string; logo: string | null; venue: string | null } | null;
  season: number | null;
  live: Fixture | null;
  next: Fixture | null;
  last: Fixture | null;
  upcoming: Fixture[];
  results: Fixture[];
  standing: {
    league_id: number;
    season: number;
    league_name: string;
    rank: number;
    points: number | null;
    played: number | null;
    goals_diff: number | null;
    form: string | null;
  } | null;
  competitions: { id: number; season: number; name: string; type: string; has_standings: boolean }[];
  attribution: string;
};

export type FixtureScope = 'upcoming' | 'results' | 'live' | 'all';

// --- Sohbet -----------------------------------------------------------------

export type SportsAuthor = {
  id: string;
  username: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_path: string | null;
  is_verified: boolean;
};

export type ChatMessage = {
  id: number;
  fixture_id: number;
  kind: 'user' | 'moderator' | 'system';
  status: 'visible' | 'deleted' | 'removed';
  body: string | null;
  created_at: string;
  like_count: number;
  liked: boolean;
  is_mine: boolean;
  author: SportsAuthor | null;
  reply_to: { id: number; author_username: string | null; author_name: string | null; body: string | null } | null;
  /** Yalnızca istemci: gönderimi süren iyimser mesaj. */
  pending?: boolean;
  client_id?: string;
};

export type ChatState = {
  state: ChatRoomState;
  slow_mode_seconds: number;
  max_length: number;
  links_allowed: boolean;
  pinned: ChatPinned;
  active_users: number;
  me: {
    is_moderator: boolean;
    account_active: boolean;
    child_protected: boolean;
    sanction: { kind: 'mute' | 'kick' | 'ban'; expires_at: string | null; reason: string | null } | null;
  } | null;
};

export type ChatPage = { items: ChatMessage[]; has_more: boolean };

export type ChatReportReason = 'spam' | 'hate' | 'harassment' | 'violence' | 'sexual' | 'personal_info' | 'other';

// --- Anket ------------------------------------------------------------------

export type Poll = {
  id: string;
  fixture_id: number;
  question: string;
  kind: 'custom' | 'winner' | 'first_half' | 'player_of_match';
  state: 'draft' | 'disabled' | 'scheduled' | 'active' | 'closed';
  opens_at: string;
  closes_at: string | null;
  allow_change: boolean;
  results_visibility: 'after_vote' | 'always' | 'after_close';
  results_visible: boolean;
  total_votes: number | null;
  my_vote: string | null;
  options: { id: string; label: string; player_id: number | null; votes: number | null; pct: number | null }[];
};

// --- Taraftar / haber / nabız ------------------------------------------------

export type FanCategory = 'prematch' | 'stadium' | 'video' | 'watch_party' | 'celebration' | 'opinion';

export type FanMediaItem = {
  id: string;
  category: FanCategory;
  created_at: string;
  /** `tz_post_json` çıktısı; görünmüyorsa null. */
  post: Record<string, unknown> | null;
};

export type FanMediaPage = { items: FanMediaItem[]; has_more: boolean };

export type FixturePulse = {
  window: { from: string; to: string; bucket_minutes: number } | null;
  official: {
    source: string;
    events: { minute: number | null; extra: number | null; kind: EventKind; team_id: number | null; player_name: string | null }[];
    snapshots: StatSnapshot[];
  } | null;
  community: { source: string; buckets: { at: string; chat: number; comments: number }[] } | null;
};

// --- Bildirim ---------------------------------------------------------------

export type SportsPrefs = {
  saved: boolean;
  enabled: boolean;
  reminder: boolean;
  lineups: boolean;
  kickoff: boolean;
  goal_for: boolean;
  goal_against: boolean;
  red_card: boolean;
  half_time: boolean;
  full_time: boolean;
  postponed: boolean;
  announcement: boolean;
  sound_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_start_hour: number;
  quiet_end_hour: number;
  system_enabled: boolean;
  devices: number;
};

export type SportsPrefsInput = Omit<SportsPrefs, 'saved' | 'system_enabled' | 'devices'>;

export type SportsHistoryItem = {
  id: string;
  type: string;
  title: string;
  body: string;
  route: string | null;
  fixture_id: number | null;
  is_test: boolean;
  created_at: string;
  read_at: string | null;
  push: { sent: number; suppressed: number; failed: number; pending: number } | null;
};

// --- Konuşma paylaşımı ------------------------------------------------------

export type ThreadShare = {
  context: { kind: 'post' | 'reel' | 'match'; title: string; subtitle?: string; route: string };
  root_id: string;
  items: {
    id: string;
    body: string;
    created_at: string;
    like_count: number;
    is_root: boolean;
    author: SportsAuthor | null;
  }[];
};
