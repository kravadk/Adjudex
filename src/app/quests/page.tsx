import { QuestsClient } from "@/components/app/QuestsClient";

export const metadata = {
  title: "Quests",
  description: "Complete quests on Adjudex to earn points as you trade, discuss, and invite.",
};

export default function QuestsPage() {
  return <QuestsClient />;
}
