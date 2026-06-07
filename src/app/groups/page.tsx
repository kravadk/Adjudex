import { GroupsClient } from "@/components/app/GroupsClient";

export const metadata = {
  title: "Exclusive groups",
  description: "Browse and create mutually-exclusive market groups on Adjudex.",
};

export default function GroupsPage() {
  return <GroupsClient />;
}
