// Quest / points engine. Intentionally derives completion LIVE from the
// data that already exists (positions, comments, followers, referrals,
// claims) rather than maintaining a separate event-sourced progress table.
// Each quest is a single COUNT query with a threshold. Points = sum of
// rewards for completed quests. This keeps the engine honest (no drift
// between "progress" and reality) and trivial to extend.

import { query } from "./db";

export type QuestDef = {
  id: string;
  title: string;
  description: string;
  points: number;
  // Threshold the metric must reach to complete.
  target: number;
};

export const QUESTS: QuestDef[] = [
  { id: "first_bet", title: "Place your first bet", description: "Open any position on a market.", points: 100, target: 1 },
  { id: "first_comment", title: "Join the discussion", description: "Post a comment on any market.", points: 50, target: 1 },
  { id: "follow_trader", title: "Build your network", description: "Follow another trader.", points: 50, target: 1 },
  { id: "first_claim", title: "Claim a win", description: "Claim a payout from a resolved market.", points: 150, target: 1 },
  { id: "three_categories", title: "Diversify", description: "Bet across 3 different categories.", points: 200, target: 3 },
  { id: "refer_friend", title: "Spread the word", description: "Refer a friend who joins.", points: 250, target: 1 },
  { id: "ten_bets", title: "Active trader", description: "Place 10 bets total.", points: 300, target: 10 },
];

async function count(sql: string, address: string): Promise<number> {
  const { rows } = await query<{ n: string }>(sql, [address]);
  return Number(rows[0]?.n ?? 0);
}

// Returns current metric value per quest id for one address.
async function metrics(address: string): Promise<Record<string, number>> {
  const a = address.toLowerCase();
  const [bets, comments, follows, claims, categories, referrals] = await Promise.all([
    count(`SELECT COUNT(*) AS n FROM positions WHERE lower(address) = $1`, a),
    count(`SELECT COUNT(*) AS n FROM market_comments WHERE lower(author_address) = $1`, a),
    count(`SELECT COUNT(*) AS n FROM user_followers WHERE lower(follower_address) = $1`, a),
    count(
      `SELECT COUNT(*) AS n FROM claims c JOIN positions p ON p.id = c.position_id WHERE lower(p.address) = $1`,
      a,
    ),
    count(
      `SELECT COUNT(DISTINCT m.category) AS n FROM positions p JOIN markets m ON m.id = p.market_id WHERE lower(p.address) = $1`,
      a,
    ),
    count(`SELECT COUNT(*) AS n FROM referrals WHERE lower(referrer_address) = $1`, a),
  ]);
  return {
    first_bet: bets,
    ten_bets: bets,
    first_comment: comments,
    follow_trader: follows,
    first_claim: claims,
    three_categories: categories,
    refer_friend: referrals,
  };
}

export type QuestState = {
  id: string;
  title: string;
  description: string;
  points: number;
  target: number;
  progress: number;
  completed: boolean;
};

export async function questStateFor(address: string): Promise<{
  quests: QuestState[];
  pointsEarned: number;
  pointsTotal: number;
}> {
  const m = await metrics(address);
  let pointsEarned = 0;
  let pointsTotal = 0;
  const quests = QUESTS.map((q) => {
    const progress = Math.min(m[q.id] ?? 0, q.target);
    const completed = (m[q.id] ?? 0) >= q.target;
    pointsTotal += q.points;
    if (completed) pointsEarned += q.points;
    return { ...q, progress, completed };
  });
  return { quests, pointsEarned, pointsTotal };
}

// Public catalog (no per-user state) for signed-out viewers.
export function questCatalog(): QuestState[] {
  return QUESTS.map((q) => ({ ...q, progress: 0, completed: false }));
}
