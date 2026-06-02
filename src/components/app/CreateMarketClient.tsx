"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Info, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { useChainId } from "wagmi";
import { getBytecode, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { keccak256, parseEventLogs, toBytes, type Address } from "viem";
import { arbitrumSepolia } from "wagmi/chains";
import marketFactoryAbi from "@/lib/abi/MarketFactory.json";
import { getServices } from "@/lib/services/provider";
import type { ImportCandidate, ImportSource, MarketCategory, MarketSpec, MarketValidationResult, OracleType, SystemStatus } from "@/lib/types/domain";
import { robinhoodChainTestnet, wagmiConfig } from "@/lib/wagmi";

const SAMPLES = [
  "Will Microsoft trade above $450 on June 28 open?",
  "Solana SOL touches $300 before September 30, 2026",
  "Will the Warriors finish the 2025-26 NBA season with at least 50 wins?",
  "ECB keeps deposit rate unchanged at July meeting",
  "Meta ships consumer Orion AR glasses during 2026",
];

type CreatorDraft = {
  title: string;
  description: string;
  category: MarketCategory;
  oracleType: OracleType;
  asset: MarketSpec["asset"];
  deadlineLocal: string;
  feeBps: number;
  sourceUrl: string;
  expectedField: string;
  resolutionCriteria: string;
  escalationPolicy: string;
};

type ImporterLoadState = "loading" | "ready" | "unavailable";
type SupportedChainId = (typeof wagmiConfig)["chains"][number]["id"];
type DeployTarget = {
  chainId: SupportedChainId;
  factoryAddress: Address;
};

const initialDraft: CreatorDraft = {
  title: "",
  description: "",
  category: "crypto",
  oracleType: "zktls-ai-oracle",
  asset: "USDC",
  deadlineLocal: "",
  feeBps: 50,
  sourceUrl: "",
  expectedField: "",
  resolutionCriteria: "",
  escalationPolicy: "If the source is unavailable or contradictory, mark the market as resolving and require manual escalation with cited proof.",
};

export function CreateMarketClient() {
  const router = useRouter();
  const activeChainId = useChainId();
  const activeChainLabel = chainLabelForId(activeChainId);
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<CreatorDraft>(initialDraft);
  const [validation, setValidation] = useState<MarketValidationResult | null>(null);
  const [spec, setSpec] = useState<MarketSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<ImportSource[]>([]);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [importerLoadState, setImporterLoadState] = useState<ImporterLoadState>("loading");
  const [importBusy, setImportBusy] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [reviewCandidate, setReviewCandidate] = useState<ImportCandidate | null>(null);

  const specHash = spec ? keccak256(toBytes(JSON.stringify(spec))) : null;

  function updateDraft<K extends keyof CreatorDraft>(key: K, value: CreatorDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setValidation(null);
    setSpec(null);
  }

  function draftToSpec(nextDraft = draft): MarketSpec {
    const deadline = nextDraft.deadlineLocal ? new Date(nextDraft.deadlineLocal) : null;
    const deadlineIso = deadline && !Number.isNaN(deadline.getTime()) ? deadline.toISOString() : "";
    const criteria = [
      nextDraft.resolutionCriteria.trim(),
      nextDraft.expectedField.trim() ? `Expected source field: ${nextDraft.expectedField.trim()}.` : "",
      nextDraft.escalationPolicy.trim() ? `Escalation policy: ${nextDraft.escalationPolicy.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    return {
      title: nextDraft.title.trim(),
      description: nextDraft.description.trim(),
      category: nextDraft.category,
      oracleType: nextDraft.oracleType,
      asset: nextDraft.asset,
      deadlineIso,
      feeBps: nextDraft.feeBps,
      sourceUrl: nextDraft.sourceUrl.trim(),
      resolutionCriteria: criteria,
    };
  }

  async function validateDraft() {
    setError(null);
    setBusy(true);
    try {
      const nextSpec = draftToSpec();
      const result = await postJson<MarketValidationResult>("/api/markets/validate", nextSpec);
      setValidation(result);
      if (result.ok) setSpec(nextSpec);
      else setSpec(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not validate market.");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!prompt.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const generated = await getServices().marketService.generateSpec(prompt);
      setSpec(generated);
      setDraft(specToDraft(generated));
      setValidation({ ok: true, errors: [] });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not generate market",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deploy() {
    if (!spec) return;
    setError(null);
    setBusy(true);
    try {
      const deployTarget = await resolveDeployTarget(activeChainId);
      const validationResult = await postJson<MarketValidationResult>("/api/markets/validate", spec);
      setValidation(validationResult);
      if (!validationResult.ok) {
        throw new Error(`Market validation failed: ${validationResult.errors.join(", ")}`);
      }
      const hash = keccak256(toBytes(JSON.stringify(spec)));
      const specJson = JSON.stringify(spec);
      const specUri = `data:application/json;base64,${toBase64(specJson)}`;
      const deadline = BigInt(Math.floor(new Date(spec.deadlineIso).getTime() / 1000));
      const transactionHash = await writeContract(wagmiConfig, {
        address: deployTarget.factoryAddress,
        abi: marketFactoryAbi,
        functionName: "createMarketWithSpec",
        args: [hash, deadline, specUri],
        chainId: deployTarget.chainId,
      });
      const receipt = await waitForTransactionReceipt(wagmiConfig, {
        hash: transactionHash,
        chainId: deployTarget.chainId,
      });
      const events = parseEventLogs({
        abi: marketFactoryAbi,
        logs: receipt.logs,
        eventName: "MarketCreated",
      });
      const created = (
        events[0] as unknown as
          | { args?: { marketId?: bigint; pool?: Address } }
          | undefined
      )?.args;
      if (!created?.marketId || !created.pool) {
        throw new Error(
          "MarketCreated event was not found in transaction receipt.",
        );
      }
      const createdMarket = await postJson<{ id: string }>("/api/markets", {
        ...spec,
        transactionHash,
        marketId: String(created.marketId),
        poolAddress: created.pool,
        chainId: deployTarget.chainId,
        factoryAddress: deployTarget.factoryAddress,
      });
      router.push(`/market/${encodeURIComponent(createdMarket.id)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not deploy market");
    } finally {
      setBusy(false);
    }
  }

  async function loadImporter() {
    setImporterLoadState("loading");
    setImportError(null);
    try {
      const [sourceRows, candidateRows] = await Promise.all([
        getJson<ImportSource[]>("/api/import/sources"),
        getJson<ImportCandidate[]>("/api/import/candidates"),
      ]);
      setSources(sourceRows);
      setCandidates(candidateRows);
      setImporterLoadState("ready");
    } catch (err) {
      setSources([]);
      setCandidates([]);
      setImporterLoadState("unavailable");
      setImportError(err instanceof Error ? err.message : "Market importer unavailable.");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadImporter();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function scanSources() {
    setImportBusy("scan");
    setImportError(null);
    try {
      const result = await postJson<{
        candidates: ImportCandidate[];
        sourceErrors: Array<{ sourceId: string; error: string }>;
      }>("/api/import/scan", {});
      setCandidates(result.candidates);
      if (result.sourceErrors.length > 0) {
        setImportError(result.sourceErrors.map((e) => `${e.sourceId}: ${e.error}`).join("; "));
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not scan import sources.");
    } finally {
      setImportBusy(null);
    }
  }

  async function validateCandidate(id: string) {
    setImportBusy(`validate:${id}`);
    setImportError(null);
    try {
      const updated = await postJson<ImportCandidate>(`/api/import/candidates/${encodeURIComponent(id)}/validate`, {});
      setCandidates((rows) => rows.map((row) => (row.id === id ? updated : row)));
      setReviewCandidate((current) => (current?.id === id ? updated : current));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not validate candidate.");
    } finally {
      setImportBusy(null);
    }
  }

  async function deployCandidate(candidate: ImportCandidate) {
    if (!candidate.specHash || !candidate.specUri || !candidate.deadlineIso) {
      setImportError("Candidate must be validated before deploy.");
      return;
    }

    setImportBusy(`deploy:${candidate.id}`);
    setImportError(null);
    try {
      const revalidated = await postJson<ImportCandidate>(`/api/import/candidates/${encodeURIComponent(candidate.id)}/validate`, {});
      setCandidates((rows) => rows.map((row) => (row.id === candidate.id ? revalidated : row)));
      setReviewCandidate(revalidated);
      if (!revalidated.specHash || !revalidated.specUri || !revalidated.deadlineIso) {
        throw new Error("Backend validation did not return a deployable candidate.");
      }
      const deployTarget = await resolveDeployTarget(activeChainId);
      const deadline = BigInt(Math.floor(new Date(revalidated.deadlineIso).getTime() / 1000));
      const transactionHash = await writeContract(wagmiConfig, {
        address: deployTarget.factoryAddress,
        abi: marketFactoryAbi,
        functionName: "createMarketWithSpec",
        args: [revalidated.specHash, deadline, revalidated.specUri],
        chainId: deployTarget.chainId,
      });
      const receipt = await waitForTransactionReceipt(wagmiConfig, {
        hash: transactionHash,
        chainId: deployTarget.chainId,
      });
      const events = parseEventLogs({
        abi: marketFactoryAbi,
        logs: receipt.logs,
        eventName: "MarketCreated",
      });
      const created = (
        events[0] as unknown as { args?: { marketId?: bigint; pool?: Address } } | undefined
      )?.args;
      if (!created?.marketId || !created.pool) {
        throw new Error("MarketCreated event was not found in transaction receipt.");
      }
      const createdMarket = await postJson<{ id: string }>(`/api/import/candidates/${encodeURIComponent(candidate.id)}/deploy`, {
        transactionHash,
        marketId: String(created.marketId),
        poolAddress: created.pool,
        chainId: deployTarget.chainId,
        factoryAddress: deployTarget.factoryAddress,
      });
      router.push(`/market/${encodeURIComponent(createdMarket.id)}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Could not deploy imported market.");
    } finally {
      setImportBusy(null);
    }
  }

  function deadlineLabel(iso: string): string {
    try {
      const d = new Date(iso);
      return (
        d.toLocaleString("en-US", {
          weekday: "long",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        }) + " UTC"
      );
    } catch {
      return iso;
    }
  }

  return (
    <div className="px-[22px] py-5 pb-7">
      <div className="flex items-center gap-4 mb-[18px] flex-wrap">
        <div>
          <h1
            className="text-[22px] font-semibold tracking-[-0.01em]"
            style={{ color: "var(--tx)" }}
          >
            Create a market
          </h1>
          <p
            className="text-[12.5px] mt-1 max-w-2xl leading-relaxed"
            style={{ color: "var(--t2)" }}
          >
            Build a validated market spec with a real source URL, resolution
            rules, oracle path, and confirmed MarketFactory deployment on{" "}
            {activeChainLabel}.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-[14px]">
        <div className="flex flex-col gap-[14px]">
          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">
                Creator studio
                <Info className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
              </span>
              <div className="flex-1" />
              <StepPill done={Boolean(draft.title)} label="Question" />
              <StepPill done={Boolean(draft.deadlineLocal && draft.sourceUrl)} label="Source" />
              <StepPill done={Boolean(validation?.ok)} label="Validated" />
            </div>
            <div className="panel-body space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Field label="Binary question">
                  <input
                    value={draft.title}
                    onChange={(event) => updateDraft("title", event.target.value)}
                    placeholder="Will ETH close above 4000 USDC before the deadline?"
                    className="form-input"
                  />
                </Field>
                <Field label="Deadline">
                  <input
                    type="datetime-local"
                    value={draft.deadlineLocal}
                    onChange={(event) => updateDraft("deadlineLocal", event.target.value)}
                    className="form-input"
                  />
                </Field>
                <Field label="Category">
                  <select
                    value={draft.category}
                    onChange={(event) => updateDraft("category", event.target.value as MarketCategory)}
                    className="form-input"
                  >
                    <option value="crypto">Crypto</option>
                    <option value="stocks">Stocks</option>
                    <option value="sports">Sports</option>
                    <option value="soft">Soft event</option>
                  </select>
                </Field>
                <Field label="Oracle / resolution path">
                  <select
                    value={draft.oracleType}
                    onChange={(event) => updateDraft("oracleType", event.target.value as OracleType)}
                    className="form-input"
                  >
                    <option value="zktls-ai-oracle">AI/source verifier</option>
                    <option value="chainlink-price">Chainlink price</option>
                    <option value="manual">Manual escalation</option>
                  </select>
                </Field>
                <Field label="Settlement asset">
                  <select
                    value={draft.asset}
                    onChange={(event) => updateDraft("asset", event.target.value as MarketSpec["asset"])}
                    className="form-input"
                  >
                    <option value="USDC">USDC</option>
                    <option value="tokenized-TSLA">tokenized-TSLA</option>
                    <option value="tokenized-AAPL">tokenized-AAPL</option>
                  </select>
                </Field>
                <Field label="Protocol fee (bps)">
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={draft.feeBps}
                    onChange={(event) => updateDraft("feeBps", Number(event.target.value))}
                    className="form-input"
                  />
                </Field>
              </div>

              <Field label="Description">
                <textarea
                  value={draft.description}
                  onChange={(event) => updateDraft("description", event.target.value)}
                  placeholder="Explain what the market is about and why this source resolves it."
                  className="form-input min-h-[86px] resize-y"
                />
              </Field>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <Field label="Resolution source URL">
                  <input
                    value={draft.sourceUrl}
                    onChange={(event) => updateDraft("sourceUrl", event.target.value)}
                    placeholder="https://..."
                    className="form-input"
                  />
                </Field>
                <Field label="Expected field / proof target">
                  <input
                    value={draft.expectedField}
                    onChange={(event) => updateDraft("expectedField", event.target.value)}
                    placeholder="close price, final score, official announcement field..."
                    className="form-input"
                  />
                </Field>
              </div>

              <Field label="Resolution criteria">
                <textarea
                  value={draft.resolutionCriteria}
                  onChange={(event) => updateDraft("resolutionCriteria", event.target.value)}
                  placeholder="YES if the cited source reports the condition true at or before the deadline. Otherwise NO."
                  className="form-input min-h-[92px] resize-y"
                />
              </Field>

              <Field label="Fallback / escalation policy">
                <textarea
                  value={draft.escalationPolicy}
                  onChange={(event) => updateDraft("escalationPolicy", event.target.value)}
                  className="form-input min-h-[74px] resize-y"
                />
              </Field>

              {validation && (
                <div
                  className={`rounded-[8px] border p-3 text-[12px] ${
                    validation.ok
                      ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
                      : "border-red-500/30 bg-red-500/5 text-red-300"
                  }`}
                >
                  {validation.ok ? "Market quality checks passed. Review the configured source and deploy." : validation.errors.join(", ")}
                  {validation.warnings && validation.warnings.length > 0 && (
                    <div className="mt-1 text-yellow-200">
                      Warnings: {validation.warnings.join(", ")}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between mt-3 flex-wrap gap-3">
                <div className="flex items-center gap-2 text-[11.5px]" style={{ color: "var(--t3)" }}>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Backend validation is required before deploy.
                </div>
                <button
                  onClick={validateDraft}
                  disabled={busy}
                  className="btn primary"
                  style={{ opacity: busy ? 0.5 : 1 }}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {busy ? "Validating..." : "Validate and preview"}
                </button>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">
                AI assist
                <Info className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
              </span>
            </div>
            <div className="panel-body">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={'Example: "Will the ECB keep its deposit rate unchanged in July?"'}
                className="w-full min-h-[140px] resize-y rounded-[10px] p-3.5 text-[13.5px] leading-relaxed outline-none"
                style={{
                  background: "#211f1e",
                  border: "1px solid #34312e",
                  color: "var(--tx)",
                  fontFamily: "inherit",
                }}
              />
              <div className="flex items-center justify-between mt-3 flex-wrap gap-3">
                <div
                  className="flex items-center gap-2 text-[11.5px]"
                  style={{ color: "var(--t3)" }}
                >
                  <span>Fees</span>
                  <span className="font-mono" style={{ color: "var(--t2)" }}>
                    0.5% per bet
                  </span>
                  <span style={{ color: "var(--t4)" }}>-</span>
                  <span>Deploys on</span>
                  <span className="font-mono" style={{ color: "var(--t2)" }}>
                    {activeChainLabel}
                  </span>
                </div>
                <button
                  onClick={generate}
                  disabled={!prompt.trim() || busy}
                  className="btn primary"
                  style={{ opacity: !prompt.trim() || busy ? 0.5 : 1 }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {busy ? "Working..." : "Generate with AI"}
                </button>
              </div>
            </div>
          </section>

          <section className="panel reveal">
            <div className="panel-head">
              <span className="panel-title">
                Market Importer
                <Info className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
              </span>
              <div className="flex-1" />
              <button
                onClick={scanSources}
                disabled={importBusy === "scan"}
                className="btn ghost"
                style={{ opacity: importBusy === "scan" ? 0.55 : 1 }}
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {importBusy === "scan" ? "Scanning..." : "Scan sources"}
              </button>
            </div>
            <div className="panel-body">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 mb-3">
                <ImporterMetric label="Configured sources" value={sources.length} />
                <ImporterMetric label="Candidates" value={candidates.length} />
                <ImporterMetric
                  label="Validated"
                  value={candidates.filter((candidate) => candidate.status === "validated").length}
                />
              </div>
              {importError && (
                <div className="mb-3 rounded-[8px] border border-red-500/30 bg-red-500/5 p-3 text-[12px] text-red-300">
                  {importError}
                </div>
              )}
              {importerLoadState === "loading" ? (
                <div
                  className="rounded-[10px] border border-[#34312e] bg-[#211f1e] p-4 text-[12.5px] leading-relaxed"
                  style={{ color: "var(--t2)" }}
                >
                  Loading public import sources...
                </div>
              ) : importerLoadState === "unavailable" ? (
                <div
                  className="rounded-[10px] border border-[#5b3535] bg-[#241b1b] p-4 text-[12.5px] leading-relaxed"
                  style={{ color: "#fca5a5" }}
                >
                  Market importer is unavailable. Source configuration could not be loaded.
                </div>
              ) : sources.length === 0 ? (
                <div
                  className="rounded-[10px] border border-[#34312e] bg-[#211f1e] p-4 text-[12.5px] leading-relaxed"
                  style={{ color: "var(--t2)" }}
                >
                  No public import sources are configured. Set{" "}
                  <span className="font-mono">IMPORT_SOURCE_URLS</span> on the
                  backend to scan real RSS or JSON event feeds.
                </div>
              ) : candidates.length === 0 ? (
                <div
                  className="rounded-[10px] border border-[#34312e] bg-[#211f1e] p-4 text-[12.5px]"
                  style={{ color: "var(--t2)" }}
                >
                  Sources are configured. Run a scan to load real public events.
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {candidates.slice(0, 6).map((candidate) => (
                    <div
                      key={candidate.id}
                      className="rounded-[10px] p-3"
                      style={{
                        background: "var(--card-inner)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <CandidateStatus status={candidate.status} />
                        <div className="min-w-0 flex-1">
                          <div
                            className="text-[13px] font-medium leading-snug"
                            style={{ color: "var(--tx)" }}
                          >
                            {candidate.question}
                          </div>
                          <div
                            className="mt-1 text-[11.5px] leading-relaxed"
                            style={{ color: "var(--t3)" }}
                          >
                            {candidate.sourcePublishedAtIso
                              ? `Published ${new Date(candidate.sourcePublishedAtIso).toLocaleString()} - `
                              : ""}
                            Confidence {(candidate.confidence * 100).toFixed(0)}% -{" "}
                            {candidate.category}
                          </div>
                          {candidate.riskFlags.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {candidate.riskFlags.map((flag) => (
                                <span
                                  key={flag}
                                  className="caps rounded-[999px] border border-yellow-500/25 bg-yellow-500/5 px-2 py-1 text-yellow-200"
                                >
                                  {flag}
                                </span>
                              ))}
                            </div>
                          )}
                          {candidate.validationErrors.length > 0 && (
                            <div className="mt-2 text-[11.5px] text-red-300">
                              {candidate.validationErrors.join(", ")}
                            </div>
                          )}
                        </div>
                        <a
                          href={candidate.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="dots-btn"
                          title={candidate.sourceUrl}
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      <div className="mt-3 flex items-center justify-end gap-2">
                        <button
                          onClick={() => validateCandidate(candidate.id)}
                          disabled={importBusy === `validate:${candidate.id}` || candidate.status === "deployed"}
                          className="btn ghost"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          {importBusy === `validate:${candidate.id}` ? "Validating..." : "Validate"}
                        </button>
                        <button onClick={() => setReviewCandidate(candidate)} className="btn primary">
                          Review
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {error && (
            <div
              className="panel"
              style={{ borderColor: "rgba(239,68,68,0.4)" }}
            >
              <div
                className="panel-body text-[13px]"
                style={{ color: "#ef4444" }}
              >
                {error}
              </div>
            </div>
          )}

          {spec && specHash && (
            <section className="panel reveal">
              <div className="panel-head">
                <span className="panel-title">
                  Preview
                  <Info className="w-3.5 h-3.5" style={{ color: "var(--t4)" }} />
                </span>
                <div className="flex-1" />
                <span
                  className="text-[10.5px] font-mono"
                  style={{ color: "var(--t3)" }}
                >
                  spec hash {specHash.slice(0, 10)}...
                </span>
              </div>
              <div className="panel-body">
                <h2
                  className="text-[17px] font-semibold leading-tight mb-4"
                  style={{ color: "var(--tx)" }}
                >
                  {spec.title}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(
                    [
                      ["Outcomes", "YES / NO", true],
                      ["Resolves via", labelForOracle(spec.oracleType), false],
                      ["Deadline", deadlineLabel(spec.deadlineIso), true],
                      ["Asset", spec.asset, false],
                      ["Fee", `${(spec.feeBps / 100).toFixed(2)}% protocol`, false],
                      ["Category", spec.category, false],
                    ] as const
                  ).map(([label, val, mono]) => (
                    <div
                      key={label}
                      className="rounded-[10px] p-3"
                      style={{
                        background: "var(--card-inner)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      <span className="caps">{label}</span>
                      <div
                        className="mt-1.5 text-[13px]"
                        style={{
                          color: "var(--tx)",
                          fontFamily: mono ? "var(--font-mono)" : "inherit",
                        }}
                      >
                        {val}
                      </div>
                    </div>
                  ))}
                </div>
                {spec.resolutionCriteria && (
                  <div
                    className="mt-3 rounded-[10px] p-3"
                    style={{
                      background: "var(--card-inner)",
                      border: "1px solid var(--line)",
                    }}
                  >
                    <span className="caps">Resolution criteria</span>
                    <p
                      className="mt-1.5 text-[13px] leading-relaxed"
                      style={{ color: "var(--t2)" }}
                    >
                      {spec.resolutionCriteria}
                    </p>
                  </div>
                )}
                <div
                  className="h-px my-4"
                  style={{ background: "var(--line)" }}
                />
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => setSpec(null)} className="btn ghost">
                    Edit spec
                  </button>
                  <button onClick={deploy} disabled={busy} className="btn primary">
                    {busy ? "Deploying..." : "Deploy market"}
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-[14px]">
          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">How resolution works</span>
            </div>
            <div className="panel-body">
              <ol
                className="space-y-2 text-[12.5px] list-decimal list-inside leading-relaxed"
                style={{ color: "var(--t2)" }}
              >
                <li>Resolution source and criteria are stored in the market spec.</li>
                <li>Oracle/proof mode is selected during review and must be configured by backend/contracts.</li>
                <li>Resolution and payout status are shown only after confirmed indexed transactions.</li>
                <li>If proof infrastructure is unavailable, the backend returns an explicit configuration error.</li>
              </ol>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <span className="panel-title">Example prompts</span>
            </div>
            <div className="panel-body flex flex-col gap-2">
              {SAMPLES.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPrompt(p);
                    updateDraft("title", p.endsWith("?") ? p : `Will ${p}?`);
                  }}
                  className="text-left px-3 py-2 rounded-[8px] text-[12.5px] leading-relaxed"
                  style={{
                    background: "var(--card-inner)",
                    border: "1px solid var(--line)",
                    color: "var(--t2)",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
      {reviewCandidate && (
        <ImporterReviewDrawer
          candidate={reviewCandidate}
          busy={importBusy === `deploy:${reviewCandidate.id}` || importBusy === `validate:${reviewCandidate.id}`}
          onClose={() => setReviewCandidate(null)}
          onValidate={() => validateCandidate(reviewCandidate.id)}
          onDeploy={() => deployCandidate(reviewCandidate)}
        />
      )}
    </div>
  );
}

function labelForOracle(oracle: string): string {
  switch (oracle) {
    case "chainlink-price":
      return "Chainlink price path";
    case "zktls-ai-oracle":
      return "Configured AI/source oracle";
    case "manual":
      return "Manual review";
    default:
      return oracle;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="caps">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function StepPill({ done, label }: { done: boolean; label: string }) {
  return (
    <span
      className={`hidden md:inline-flex items-center gap-1 rounded-[999px] border px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${
        done
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : "border-[color:var(--line)] bg-[#211f1e] text-[color:var(--t3)]"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${done ? "bg-emerald-300" : "bg-[color:var(--t4)]"}`} />
      {label}
    </span>
  );
}

function specToDraft(spec: MarketSpec): CreatorDraft {
  return {
    title: spec.title,
    description: spec.description,
    category: spec.category,
    oracleType: spec.oracleType,
    asset: spec.asset,
    deadlineLocal: toDatetimeLocal(spec.deadlineIso),
    feeBps: spec.feeBps,
    sourceUrl: spec.sourceUrl,
    expectedField: "",
    resolutionCriteria: spec.resolutionCriteria,
    escalationPolicy: initialDraft.escalationPolicy,
  };
}

function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function ImporterMetric({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="rounded-[10px] p-3"
      style={{ background: "var(--card-inner)", border: "1px solid var(--line)" }}
    >
      <span className="caps">{label}</span>
      <div className="mt-1.5 font-mono text-[17px]" style={{ color: "var(--tx)" }}>
        {value}
      </div>
    </div>
  );
}

function CandidateStatus({ status }: { status: ImportCandidate["status"] }) {
  if (status === "validated") {
    return (
      <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#CCE9E7]/35 bg-[#CCE9E7]/10 text-[#CCE9E7]">
        <ShieldCheck className="h-3.5 w-3.5" />
      </span>
    );
  }
  if (status === "deployed") {
    return (
      <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-500/35 bg-emerald-500/10 text-emerald-300">
        <ShieldCheck className="h-3.5 w-3.5" />
      </span>
    );
  }
  return (
    <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full border border-yellow-500/30 bg-yellow-500/10 text-yellow-200">
      <AlertTriangle className="h-3.5 w-3.5" />
    </span>
  );
}

function ImporterReviewDrawer({
  candidate,
  busy,
  onClose,
  onValidate,
  onDeploy,
}: {
  candidate: ImportCandidate;
  busy: boolean;
  onClose: () => void;
  onValidate: () => void;
  onDeploy: () => void;
}) {
  const deployable = candidate.status === "validated" && Boolean(candidate.specHash && candidate.specUri && candidate.deadlineIso);
  return (
    <div className="fixed inset-0 z-50 bg-black/45" onMouseDown={onClose}>
      <aside
        className="ml-auto flex h-full w-full max-w-xl flex-col border-l border-[color:var(--line)] bg-[color:var(--panel-bg)] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[color:var(--line-soft)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold" style={{ color: "var(--tx)" }}>
              Import candidate review
            </div>
            <div className="mt-1 truncate text-[11px] font-mono" style={{ color: "var(--t3)" }}>
              {candidate.id}
            </div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] border border-[color:var(--line)] text-[color:var(--t2)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--card-bg)] p-3">
            <div className="flex items-center justify-between gap-2">
              <CandidateStatus status={candidate.status} />
              <span className="font-mono text-[11px]" style={{ color: "var(--t2)" }}>
                confidence {(candidate.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <h2 className="mt-3 text-[16px] font-semibold leading-snug" style={{ color: "var(--tx)" }}>
              {candidate.question}
            </h2>
            <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--t2)" }}>
              {candidate.description}
            </p>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ReviewField label="Category" value={candidate.category} />
            <ReviewField label="Oracle" value={labelForOracle(candidate.oracleType)} />
            <ReviewField label="Asset" value={candidate.asset} />
            <ReviewField label="Deadline" value={candidate.deadlineIso ? deadlineLabelStatic(candidate.deadlineIso) : "missing deadline"} mono />
            <ReviewField label="Source published" value={candidate.sourcePublishedAtIso ? new Date(candidate.sourcePublishedAtIso).toLocaleString() : "not provided"} />
            <ReviewField label="Spec hash" value={candidate.specHash ?? "not validated"} mono />
          </div>

          <div className="mt-3 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--card-bg)] p-3">
            <span className="caps">Public source</span>
            <a href={candidate.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1.5 break-all text-[12px] text-[color:var(--accent-bright)] hover:text-white">
              {candidate.sourceUrl}
              <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            </a>
          </div>

          <div className="mt-3 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--card-bg)] p-3">
            <span className="caps">Resolution criteria</span>
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed" style={{ color: "var(--t2)" }}>
              {candidate.resolutionCriteria || "missing resolution criteria"}
            </p>
          </div>

          {(candidate.riskFlags.length > 0 || candidate.validationErrors.length > 0) && (
            <div className="mt-3 rounded-[10px] border border-yellow-500/25 bg-yellow-500/5 p-3">
              <span className="caps text-yellow-200">Review signals</span>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {candidate.riskFlags.map((flag) => (
                  <span key={flag} className="rounded-full border border-yellow-500/25 px-2 py-1 text-[10.5px] text-yellow-100">
                    {flag}
                  </span>
                ))}
                {candidate.validationErrors.map((error) => (
                  <span key={error} className="rounded-full border border-red-500/30 px-2 py-1 text-[10.5px] text-red-200">
                    {error}
                  </span>
                ))}
              </div>
            </div>
          )}

          {candidate.spec && (
            <div className="mt-3 rounded-[10px] border border-[color:var(--line)] bg-[#141312] p-3">
              <span className="caps">Validated market spec</span>
              <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed" style={{ color: "var(--t2)" }}>
                {JSON.stringify(candidate.spec, null, 2)}
              </pre>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--line-soft)] px-4 py-3">
          <button onClick={onValidate} disabled={busy || candidate.status === "deployed"} className="btn ghost">
            <ShieldCheck className="h-3.5 w-3.5" />
            Validate
          </button>
          <button
            onClick={onDeploy}
            disabled={busy || !deployable}
            className="btn primary"
            style={{ opacity: busy || !deployable ? 0.5 : 1 }}
          >
            {busy ? "Working..." : "Deploy reviewed market"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function ReviewField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[8px] border border-[color:var(--line)] bg-[color:var(--card-bg)] p-3">
      <div className="caps">{label}</div>
      <div className={`mt-1.5 break-all text-[12px] ${mono ? "font-mono" : ""}`} style={{ color: "var(--tx)" }}>
        {value}
      </div>
    </div>
  );
}

function deadlineLabelStatic(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function resolveDeployTarget(activeChainId: number): Promise<DeployTarget> {
  const factoryAddress = factoryAddressForChain(activeChainId);
  if (!factoryAddress) {
    throw new Error(`A public MarketFactory address is required to deploy on chain ${activeChainId}.`);
  }
  if (!isSupportedChainId(activeChainId)) {
    throw new Error(`Wallet is on unsupported chain ${activeChainId}. Switch to a configured deployment chain before deploying.`);
  }

  await assertFactoryMatchesBackend(factoryAddress, activeChainId);
  await assertFactoryHasCode(factoryAddress, activeChainId);

  return { chainId: activeChainId, factoryAddress };
}

function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return wagmiConfig.chains.some((chain) => chain.id === chainId);
}

function factoryAddressForChain(chainId: number): Address | undefined {
  if (chainId === arbitrumSepolia.id) {
    return process.env.NEXT_PUBLIC_MARKET_FACTORY_ADDRESS as Address | undefined;
  }
  if (chainId === robinhoodChainTestnet.id) {
    return process.env.NEXT_PUBLIC_RHC_MARKET_FACTORY_ADDRESS as Address | undefined;
  }
  return undefined;
}

function chainLabelForId(chainId: number): string {
  if (chainId === arbitrumSepolia.id) return "Arbitrum Sepolia";
  if (chainId === robinhoodChainTestnet.id) return "RHC";
  return `unsupported chain ${chainId}`;
}

async function assertFactoryMatchesBackend(factoryAddress: Address, chainId: SupportedChainId) {
  let status: SystemStatus;
  try {
    status = await getJson<SystemStatus>("/api/status");
  } catch (error) {
    throw new Error(
      `Cannot verify backend MarketFactory for chain ${chainId}: ${
        error instanceof Error ? error.message : "status unavailable"
      }`,
    );
  }

  const chainStatus = [status.chains.arbitrumSepolia, status.chains.rhc].find(
    (chain) => chain.chainId === chainId,
  );
  if (!chainStatus) {
    throw new Error(`Backend status does not include active chain ${chainId}.`);
  }
  if (!chainStatus.factoryAddress) {
    throw new Error(`Backend has no MarketFactory configured for active chain ${chainId}.`);
  }
  if (chainStatus.factoryAddress.toLowerCase() !== factoryAddress.toLowerCase()) {
    throw new Error(
      `Wallet is on chain ${chainId}, but the public MarketFactory address does not match the backend factory for that chain.`,
    );
  }
}

async function assertFactoryHasCode(factoryAddress: Address, chainId: SupportedChainId) {
  let bytecode: string | undefined;
  try {
    bytecode = await getBytecode(wagmiConfig, { address: factoryAddress, chainId });
  } catch (error) {
    throw new Error(
      `Cannot verify MarketFactory contract code on chain ${chainId}: ${
        error instanceof Error ? error.message : "bytecode read failed"
      }`,
    );
  }
  if (!bytecode || bytecode === "0x") {
    throw new Error(`No MarketFactory contract code was found at ${factoryAddress} on active chain ${chainId}.`);
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
