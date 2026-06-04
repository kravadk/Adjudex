"use client";

import { useState } from "react";
import Link from "next/link";
import { Radio, Save, Search } from "lucide-react";

type CreatorProfile = {
  handle: string;
  walletAddress: string;
  channelUrl: string;
  preferredGames: string[];
  verifiedAtIso: string;
};

export default function CreatorPage() {
  const [handle, setHandle] = useState("");
  const [channelUrl, setChannelUrl] = useState("");
  const [preferredGames, setPreferredGames] = useState("");
  const [marketId, setMarketId] = useState("");
  const [streamUrl, setStreamUrl] = useState("");
  const [profile, setProfile] = useState<CreatorProfile | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "lookup" | "link" | null>(null);

  async function saveProfile() {
    setBusy("save");
    setMessage(null);
    try {
      const response = await fetch("/api/creators", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          handle,
          channelUrl,
          preferredGames: preferredGames.split(",").map((item) => item.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      setProfile((await response.json()) as CreatorProfile);
      setMessage("Creator profile saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Creator profile save failed.");
    } finally {
      setBusy(null);
    }
  }

  async function lookupProfile() {
    if (!handle.trim()) return;
    setBusy("lookup");
    setMessage(null);
    try {
      const response = await fetch(`/api/creators/${encodeURIComponent(handle.trim())}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      const next = (await response.json()) as CreatorProfile;
      setProfile(next);
      setHandle(next.handle);
      setChannelUrl(next.channelUrl);
      setPreferredGames(next.preferredGames.join(", "));
    } catch (error) {
      setProfile(null);
      setMessage(error instanceof Error ? error.message : "Creator profile not found.");
    } finally {
      setBusy(null);
    }
  }

  async function linkMarket() {
    if (!profile?.handle) return;
    setBusy("link");
    setMessage(null);
    try {
      const response = await fetch(`/api/creators/${encodeURIComponent(profile.handle)}/markets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketId, streamUrl: streamUrl || undefined }),
      });
      if (!response.ok) throw new Error(await response.text());
      setMessage("Market linked to creator profile.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Market link failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="mx-auto max-w-[980px] px-5 py-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <div className="caps mb-2">creator markets</div>
          <h1 className="text-[22px] font-semibold text-white">Creator control surface</h1>
        </div>
        <Link href="/create" className="inline-flex h-9 items-center gap-2 rounded-[6px] border border-[#2a2a2a] bg-[#232323] px-3 text-[12px] text-gray-200 hover:border-[#3a3a3a]">
          <Radio className="h-4 w-4" /> Create market
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <section className="panel p-4">
          <div className="mb-3 text-[11px] text-gray-500">Verified profile</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Input label="Handle" value={handle} onChange={setHandle} placeholder="creator_handle" />
            <Input label="Channel URL" value={channelUrl} onChange={setChannelUrl} placeholder="https://..." />
            <div className="md:col-span-2">
              <Input label="Preferred games" value={preferredGames} onChange={setPreferredGames} placeholder="cs2, dota2, valorant" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => void saveProfile()} disabled={busy !== null} className="inline-flex h-9 items-center gap-2 rounded-[6px] bg-[#CCE9E7] px-3 text-[12px] font-medium text-black disabled:opacity-50">
              <Save className="h-4 w-4" /> Save
            </button>
            <button onClick={() => void lookupProfile()} disabled={busy !== null} className="inline-flex h-9 items-center gap-2 rounded-[6px] border border-[#2a2a2a] bg-[#232323] px-3 text-[12px] text-gray-200 disabled:opacity-50">
              <Search className="h-4 w-4" /> Lookup
            </button>
          </div>
        </section>

        <aside className="panel p-4">
          <div className="mb-3 text-[11px] text-gray-500">Indexed profile</div>
          {profile ? (
            <div className="space-y-2 text-[12px]">
              <Row label="Handle" value={profile.handle} />
              <Row label="Wallet" value={profile.walletAddress} mono />
              <Row label="Channel" value={profile.channelUrl} />
              <Row label="Games" value={profile.preferredGames.join(", ") || "none"} />
            </div>
          ) : (
            <div className="rounded-[6px] border border-[#262626] bg-[#111111] p-3 text-[11.5px] text-gray-500">
              No creator profile loaded from the backend.
            </div>
          )}
        </aside>
      </div>

      <section className="panel mt-4 p-4">
        <div className="mb-3 text-[11px] text-gray-500">Market attribution</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Input label="Market ID" value={marketId} onChange={setMarketId} placeholder="421614:1" />
          <Input label="Stream URL" value={streamUrl} onChange={setStreamUrl} placeholder="https://..." />
        </div>
        <button onClick={() => void linkMarket()} disabled={!profile || busy !== null} className="mt-4 inline-flex h-9 items-center gap-2 rounded-[6px] bg-[#CCE9E7] px-3 text-[12px] font-medium text-black disabled:opacity-50">
          <Radio className="h-4 w-4" /> Link market
        </button>
      </section>

      {message && <div className="mt-4 rounded-[6px] border border-[#2a2a2a] bg-[#111111] p-3 text-[12px] text-gray-300">{message}</div>}
    </main>
  );
}

function Input({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] text-gray-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-10 w-full rounded-[6px] border border-[#2a2a2a] bg-[#111111] px-3 text-[13px] text-white outline-none focus:border-[#CCE9E7]" />
    </label>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.12em] text-gray-500">{label}</div>
      <div className={`break-all text-gray-200 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
