import { notFound } from "next/navigation";
import { ProfileClient } from "@/components/app/ProfileClient";

export const dynamicParams = true;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return { title: `Trader ${address.slice(0, 6)}…${address.slice(-4)}` };
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) notFound();
  return <ProfileClient address={address.toLowerCase()} />;
}
