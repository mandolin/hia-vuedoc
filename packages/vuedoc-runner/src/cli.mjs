#!/usr/bin/env node
import process from "node:process";
import { parseArgs } from "node:util";

import { loadVueDocRunnerConfig, runVueDocRunner } from "./index.mjs";

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});

/**
 * Runs the VueDoc CLI entry point.
 *
 * @returns {Promise<void>} Resolves after the runner result summary is printed.
 * @lang zh-CN 运行 VueDoc CLI 入口，并在完成后输出 runner result 摘要。
 * @lang en Runs the VueDoc CLI entry point and prints a runner result summary when complete.
 */
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: {
        type: "string",
        short: "c"
      },
      "workspace-root": {
        type: "string"
      },
      output: {
        type: "string",
        short: "o"
      },
      input: {
        type: "string",
        short: "i",
        multiple: true
      },
      profile: {
        type: "string",
        multiple: true
      },
      "emit-doc-source-map": {
        type: "boolean"
      },
      "no-doc-source-map": {
        type: "boolean"
      },
      "write-result-manifest": {
        type: "boolean"
      },
      "no-result-manifest": {
        type: "boolean"
      },
      "sources-content-policy": {
        type: "string"
      }
    }
  });
  const configPath = values.config ?? positionals[0] ?? "hia-vuedoc.config.json";
  const config = await loadVueDocRunnerConfig(configPath, {
    overrides: createCliOverrides(values)
  });
  const result = await runVueDocRunner(config);
  const summary = {
    contract: result.contract,
    status: result.status,
    artifacts: result.artifacts.length,
    diagnostics: result.diagnostics.length
  };

  console.log(JSON.stringify(summary, null, 2));
  if (result.status !== "success") {
    process.exitCode = 1;
  }
}

function createCliOverrides(values) {
  const overrides = {};
  const optionOverrides = {};
  if (values["workspace-root"]) {
    overrides.workspaceRoot = values["workspace-root"];
  }
  if (values.output) {
    overrides.outputDirectory = values.output;
  }
  if (values.input?.length) {
    overrides.inputs = values.input.map((inputPath) => ({
      kind: "vue-sfc",
      path: inputPath,
      language: "vue"
    }));
  }
  if (values.profile?.length) {
    overrides.profileIds = values.profile;
  }
  if (values["emit-doc-source-map"] === true) {
    optionOverrides.emitDocSourceMap = true;
  }
  if (values["no-doc-source-map"] === true) {
    optionOverrides.emitDocSourceMap = false;
  }
  if (values["write-result-manifest"] === true) {
    optionOverrides.writeResultManifest = true;
  }
  if (values["no-result-manifest"] === true) {
    optionOverrides.writeResultManifest = false;
  }
  if (values["sources-content-policy"]) {
    optionOverrides.sourcesContentPolicy = values["sources-content-policy"];
  }
  if (Object.keys(optionOverrides).length > 0) {
    overrides.options = optionOverrides;
  }
  return overrides;
}
