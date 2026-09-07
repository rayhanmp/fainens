import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const allowed = new Set(["--live", "--model", "--judge-model", "--case", "--tag", "--repeat", "--transport", "--out", "--max-requests", "--max-case-calls", "--max-cost-usd", "--help"]);
function fail(message) { console.error(message); process.exit(2); }
function fingerprint(directories) {
  const hash = createHash("sha256");
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = join(path, entry.name);
      if (entry.isDirectory()) visit(next);
      else if (/\.(ts|js|mjs|json|sql)$/.test(entry.name)) { hash.update(next.slice(root.length).replace(/\\/g, "/")); hash.update(readFileSync(next)); }
    }
  }
  directories.forEach((dir) => visit(resolve(root, dir)));
  return hash.digest("hex");
}

if (args[0] === "compare") {
  if (args.length !== 3) fail("Usage: npm run eval:agent -- compare baseline/report.json candidate/report.json");
  const [baseline, candidate] = args.slice(1).map((path) => JSON.parse(readFileSync(resolve(path), "utf8")));
  if (!baseline.complete || !candidate.complete) fail("Cannot compare incomplete evaluation runs");
  for (const key of ["formatVersion", "suiteFingerprint", "mode", "transport", "repetitions", "judgeModel"]) {
    if (baseline[key] !== candidate[key]) fail(`Cannot compare mismatched ${key}. Use the same suite, mode, transport, repeats and judge.`);
  }
  const key = (c) => `${c.caseId}:${c.repetition}`;
  const before = new Map(baseline.cases.map((c) => [key(c), c]));
  if (before.size !== candidate.cases.length || candidate.cases.some((c) => !before.has(key(c)))) fail("Cannot compare different case selections");
  const regressions = candidate.cases.filter((c) => before.get(key(c)).passed && !c.passed).map(key);
  const improvements = candidate.cases.filter((c) => !before.get(key(c)).passed && c.passed).map(key);
  const deltas = Object.fromEntries(["passRate", "providerCalls", "toolFailures", "schemaLoads", "maxRequestChars", "p50CaseLatencyMs", "p95CaseLatencyMs"]
    .map((metric) => [metric, { baseline: baseline.summary[metric], candidate: candidate.summary[metric], delta: candidate.summary[metric] - baseline.summary[metric] }]));
  console.log(JSON.stringify({ baselineModel: baseline.model, candidateModel: candidate.model, regressions, improvements, deltas,
    baselineUsage: baseline.summary.measuredUsage, candidateUsage: candidate.summary.measuredUsage,
    baselineJudgeScores: baseline.summary.meanJudgeScores, candidateJudgeScores: candidate.summary.meanJudgeScores,
    baselineWorkflowPassRates: baseline.summary.workflowPassRates, candidateWorkflowPassRates: candidate.summary.workflowPassRates,
    baselineSource: baseline.sourceFingerprint, candidateSource: candidate.sourceFingerprint }, null, 2));
  process.exit(regressions.length ? 1 : 0);
}

const options = {};
for (let i = 0; i < args.length; i++) {
  const name = args[i];
  if (!allowed.has(name)) fail(`Unknown option ${name}; use --help`);
  if (name === "--live" || name === "--help") options[name] = true;
  else {
    const value = args[++i];
    if (!value || value.startsWith("--")) fail(`${name} requires a value`);
    options[name] = value;
  }
}
if (options["--help"]) {
  console.log(`Agent workflows through real query/stream routes + in-memory ledger.
Default: offline scripted replay (no network, does not score model quality).
--live --model <OpenRouter ID>    Run a model (requires EVAL_OPENROUTER_API_KEY).
--judge-model <OpenRouter ID>     Optional separate quality judge; extra paid calls.
--case <substring> --tag <tag>    Filter workflows (both filters apply).
--repeat <N>                     Repeat each case; default 1, use 3+ for live comparisons.
--transport query|stream        Default query; stream tests SSE and persistence.
--out <new directory>            Default eval-results/<timestamp>.
--max-requests <N>               Whole-run HTTP attempt cap incl. judge/retries; default 100.
--max-case-calls <N>             Candidate provider rounds per case; default 16.
--max-cost-usd <N>               Stop after observed cost reaches N; default 2.
compare <baseline.json> <candidate.json>  Compare compatible reports; exit 1 on regressions.`);
  process.exit(0);
}
if (options["--live"] && (!options["--model"] || !process.env.EVAL_OPENROUTER_API_KEY)) fail("Live runs require --model and EVAL_OPENROUTER_API_KEY. No app .env is loaded.");
if (!options["--live"] && (options["--model"] || options["--judge-model"])) fail("Model and judge require --live; offline mode always uses scripted responses.");
for (const flag of ["--repeat", "--max-requests", "--max-case-calls"]) {
  if (options[flag] && (!Number.isSafeInteger(Number(options[flag])) || Number(options[flag]) < 1)) fail(`${flag} must be a positive integer`);
}
if (options["--max-cost-usd"] && (!Number.isFinite(Number(options["--max-cost-usd"])) || Number(options["--max-cost-usd"]) <= 0)) fail("--max-cost-usd must be positive");
if (options["--transport"] && !["query", "stream"].includes(options["--transport"])) fail("--transport must be query or stream");
let output;
if (options["--out"]) {
  output = resolve(root, options["--out"]);
  mkdirSync(dirname(output), { recursive: true });
  try { mkdirSync(output); } catch (error) {
    if (error.code === "EEXIST") fail("Output directory already exists; choose a new --out to preserve previous evaluations");
    throw error;
  }
} else {
  const resultsRoot = resolve(root, "eval-results");
  mkdirSync(resultsRoot, { recursive: true });
  // Parallel query/SSE runs can start in the same millisecond. Allocate the
  // directory atomically so one run cannot overwrite another run's evidence.
  output = mkdtempSync(join(resultsRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-`));
}
let gitRevision = "unknown";
try { gitRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* source hash still identifies dirty/unversioned work */ }
const env = {
  ...process.env, EVAL_LIVE: options["--live"] ? "1" : "0", EVAL_MODEL: options["--model"] ?? "",
  EVAL_JUDGE_MODEL: options["--judge-model"] ?? "", EVAL_CASE: options["--case"] ?? "", EVAL_TAG: options["--tag"] ?? "",
  EVAL_TRANSPORT: options["--transport"] ?? "query", EVAL_REPEATS: options["--repeat"] ?? "1",
  EVAL_MAX_REQUESTS: options["--max-requests"] ?? "100", EVAL_MAX_CASE_CALLS: options["--max-case-calls"] ?? "16",
  EVAL_MAX_COST_USD: options["--max-cost-usd"] ?? "2", EVAL_OUTPUT_DIR: output,
  EVAL_SOURCE_HASH: fingerprint(["src", "drizzle"]), EVAL_SUITE_HASH: fingerprint(["evals"]), EVAL_GIT_REVISION: gitRevision,
};
console.log(`Evaluation ${options["--live"] ? "LIVE (paid, synthetic data only)" : "offline replay"}; output: ${output}`);
const child = spawnSync(process.execPath, [resolve(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "evals/vitest.config.ts"], { cwd: root, env, stdio: "inherit" });
writeFileSync(join(output, "run-status.json"), JSON.stringify({ exitCode: child.status, signal: child.signal, error: child.error?.message,
  sourceFingerprint: env.EVAL_SOURCE_HASH, suiteFingerprint: env.EVAL_SUITE_HASH }, null, 2));
if (child.error) console.error(child.error.message);
console.log(`Report directory: ${output}`);
process.exit(child.status ?? 2);
