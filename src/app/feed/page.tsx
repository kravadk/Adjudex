import { FeedClient } from "@/components/app/FeedClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Feed · PariAI",
  description:
    "Personalised feed of prediction markets ranked by your open positions, watchlist, and traded categories — with hot markets as the fallback.",
};

export default function FeedPage() {
  return <FeedClient />;
}
