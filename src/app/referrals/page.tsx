import { ReferralsClient } from "@/components/app/ReferralsClient";

export const metadata = {
  title: "Referrals",
  description: "Invite friends to Adjudex and earn a rebate on their trading fees.",
};

export default function ReferralsPage() {
  return <ReferralsClient />;
}
