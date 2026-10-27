// Complete accelerated scenarios through authenticated Go /paso, with separate
// physical assertions and measured timings. Never touches a deployed service.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const backend = path.join(root, 'services/evacuation');
const temporary = await mkdtemp(path.join(tmpdir(), 'mantasim-hydrology-'));
const evidence = path.join(backend, 'reports/phase8');
const go = process.env.GO_BIN || (existsSync('/usr/local/go/bin/go') ? '/usr/local/go/bin/go' : 'go');
async function command(executable, args) {
  const child = spawn(executable, args, { cwd: backend, stdio: 'inherit' });
  assert.equal((await once(child, 'exit'))[0], 0, args.join(' '));
}
const summary = {
  recorded_at: new Date().toISOString(),
  environment: 'Local Linux; accelerated real authenticated loopback HTTP. No EC2 capacity claim.',
  methodology: 'Full scenarios, one execution at a time. Processing excludes pacing; CPU/RSS include setup, validation, serialization and forced GC. Logical hashes exclude timings. Historical Legacy evidence is retained separately; no Legacy runtime.',
  runs: [],
};
try {
  await mkdir(evidence, { recursive: true });
  const binary = path.join(temporary, 'flood-bench');
  await command(go, ['build', '-o', binary, './cmd/flood-bench']);
  const base = JSON.parse(await readFile(path.join(backend, 'scenarios/flood/urban-storm.json'), 'utf8'));
  async function run(name, { turns = 150, profile = 'storm', behavior = 'preventive', model = 'rainfall_runoff_2d', graph = 'data/manta-v2.json', hydrology = {}, agents = 80 } = {}, expectedHash) {
    const config = structuredClone(base);
    config.survivors = agents;
    config.flood = { ...config.flood, simulation_duration: turns, rainfall_profile: profile, evacuation_behavior: behavior, hydraulic_model: model, hydrology };
    const scenario = path.join(temporary, `${name}.json`);
    await writeFile(scenario, JSON.stringify(config));
    const output = path.join(evidence, `${name}.json`);
    await command(binary, ['-scenario', scenario, '-graph', graph, '-output', output, ...(expectedHash ? ['-expect-hash', expectedHash] : [])]);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.validation_passed, true);
    assert.equal(report.completed_step, turns);
    assert.ok(report.hydraulic && report.hydraulic.depths_m.length <= 4096);
    assert.ok(report.hydraulic.depths_m.every(value => Number.isFinite(value) && value >= 0));
    const record = {
      name, graph, turns, agents, profile, behavior, model,
      config: report.effective_config.flood,
      grid: report.hydraulic.grid,
      metrics: report.evacuation_metrics,
      hydraulic_history: report.hydraulic_history,
      mass_balance: report.hydraulic.mass_balance,
      step_latency: report.simulation_step_latency,
      serialization_latency: report.serialization_latency,
      performance: report.performance,
      resources: report.resource_usage,
      peak_snapshot_bytes: report.peak_snapshot_bytes,
      peak_blocked_edges: report.peak_blocked_edges,
      heap_checkpoints: report.heap_checkpoints,
      logical_hash: report.deterministic_timeline_sha256,
      validation_passed: true,
    };
    summary.runs.push(record);
    return record;
  }
  for (const turns of [30, 150, 300, 600, 1200, 3000]) {
    const first = await run(`duration-${turns}`, { turns });
    await run(`duration-${turns}-replay`, { turns }, first.logical_hash);
  }
  for (const profile of ['storm', 'constant', 'pulse']) {
    for (const behavior of ['preventive', 'late', 'adaptive']) {
      await run(`${profile}-${behavior}`, { profile, behavior });
    }
  }
  await run('compound-high-sea', { model: 'compound_flood_2d', hydrology: { sea_level_m: 1, channel_inflow_m3_s: 5, initial_saturation: 1, antecedent_rain_hours: 1 } });
  for (const cell_size_m of [50, 200, 500]) {
    await run(`master-resolution-${cell_size_m}`, { graph: 'data/manta-master.json', agents: 200, hydrology: { cell_size_m } });
  }
  summary.result = 'PASS';
} finally {
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Hydrology evidence: ${path.join(evidence, 'summary.json')} (${summary.runs.length} complete scenarios)`);
