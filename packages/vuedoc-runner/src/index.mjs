import { readFile } from "node:fs/promises";
import path from "node:path";

import { vuedocProducer } from "@hia-doc/vuedoc-producer";

/**
 * Declares the runtime version of the standalone VueDoc runner.
 *
 * @constant {string}
 * @lang zh-CN 声明独立 VueDoc runner 的运行时版本。
 * @lang en Declares the runtime version of the standalone VueDoc runner.
 */
export const VUEDOC_RUNNER_VERSION = "0.0.0";

/**
 * Identifies the JSON contract consumed by the VueDoc runner.
 *
 * @constant {string}
 * @lang zh-CN 标识 VueDoc runner 消费的 JSON 配置契约。
 * @lang en Identifies the JSON contract consumed by the VueDoc runner.
 */
export const VUEDOC_RUNNER_CONFIG_CONTRACT = "hia-vuedoc-runner-config";

/**
 * Declares the current draft version of the VueDoc runner config contract.
 *
 * @constant {string}
 * @lang zh-CN 声明 VueDoc runner 配置契约当前草案版本。
 * @lang en Declares the current draft version of the VueDoc runner config contract.
 */
export const VUEDOC_RUNNER_CONFIG_VERSION = "0.1.0-draft";

/**
 * Describes the standalone runner surface for host tools and external projects.
 *
 * @constant {object}
 * @lang zh-CN 描述供宿主工具和外部项目识别的独立 runner 能力边界。
 * @lang en Describes the standalone runner surface for host tools and external projects.
 */
export const vuedocRunnerDescriptor = Object.freeze({
  contract: "documentation-runner",
  contractVersion: "0.1.0-draft",
  id: "vuedoc-runner",
  version: VUEDOC_RUNNER_VERSION,
  configContract: VUEDOC_RUNNER_CONFIG_CONTRACT,
  configContractVersion: VUEDOC_RUNNER_CONFIG_VERSION,
  producer: vuedocProducer.descriptor
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Loads and normalizes a VueDoc runner config file.
 *
 * @param {string} configPath Absolute or process-relative path to the JSON config file.
 * @param {object} [options] Loader options.
 * @param {object} [options.overrides] Shallow command-line overrides applied after the file is read.
 * @returns {Promise<object>} Normalized runner config with absolute runtime directories.
 * @lang zh-CN 加载并规范化 VueDoc runner 配置文件；相对 `workspaceRoot` 以配置文件目录为基准，`outputDirectory` 以 workspace root 为基准。
 * @lang en Loads and normalizes a VueDoc runner config file; relative `workspaceRoot` resolves from the config directory and `outputDirectory` resolves from the workspace root.
 */
export async function loadVueDocRunnerConfig(configPath, options = {}) {
  if (typeof configPath !== "string" || configPath.length === 0) {
    throw new TypeError("configPath must be a non-empty string.");
  }
  const absoluteConfigPath = path.resolve(configPath);
  const rawConfig = JSON.parse(await readFile(absoluteConfigPath, "utf8"));
  return normalizeRunnerConfig(applyOverrides(rawConfig, options.overrides), {
    configDirectory: path.dirname(absoluteConfigPath)
  });
}

/**
 * Converts a normalized VueDoc runner config into a documentation producer request.
 *
 * @param {object} config VueDoc runner config.
 * @returns {object} Documentation producer request accepted by `@hia-doc/vuedoc-producer`.
 * @lang zh-CN 将 VueDoc runner 配置转换为 `@hia-doc/vuedoc-producer` 可消费的 producer request。
 * @lang en Converts VueDoc runner config into the producer request accepted by `@hia-doc/vuedoc-producer`.
 */
export function createVueDocProducerRequest(config) {
  const normalized = normalizeRunnerConfig(config, {
    configDirectory: process.cwd()
  });
  return {
    workspaceRoot: normalized.workspaceRoot,
    outputDirectory: normalized.outputDirectory,
    inputs: normalized.inputs,
    profileIds: normalized.profileIds,
    options: normalized.options
  };
}

/**
 * Runs VueDoc extraction from a runner config and returns the producer result.
 *
 * @param {object} config VueDoc runner config.
 * @param {object} [context] Optional cancellation and progress callbacks.
 * @returns {Promise<object>} Documentation producer result.
 * @lang zh-CN 基于 runner 配置运行 VueDoc extraction，并返回 producer result。
 * @lang en Runs VueDoc extraction from runner config and returns the producer result.
 */
export async function runVueDocRunner(config, context = {}) {
  return vuedocProducer.produce(createVueDocProducerRequest(config), context);
}

function normalizeRunnerConfig(value, runtime) {
  assertRecord(value, "VueDoc runner config must be an object.");
  assertKnownKeys(value, [
    "contract",
    "contractVersion",
    "workspaceRoot",
    "outputDirectory",
    "inputs",
    "profileIds",
    "options"
  ], "config");
  if (value.contract !== undefined && value.contract !== VUEDOC_RUNNER_CONFIG_CONTRACT) {
    throw new TypeError(`Unsupported VueDoc runner config contract: ${value.contract}`);
  }
  if (value.contractVersion !== undefined && value.contractVersion !== VUEDOC_RUNNER_CONFIG_VERSION) {
    throw new TypeError(`Unsupported VueDoc runner config version: ${value.contractVersion}`);
  }

  const configDirectory = runtime?.configDirectory ?? process.cwd();
  const workspaceRoot = resolveRuntimeDirectory(value.workspaceRoot ?? ".", configDirectory, "workspaceRoot");
  const outputDirectory = resolveRuntimeDirectory(value.outputDirectory ?? "dist/hia-vuedoc", workspaceRoot, "outputDirectory");
  const profileIds = normalizeProfileIds(value.profileIds ?? ["vuedoc", "htmdoc", "cssdoc", "doc-source-map"]);
  const options = normalizeOptions(value.options ?? {});

  if (!Array.isArray(value.inputs) || value.inputs.length === 0) {
    throw new TypeError("inputs must be a non-empty array.");
  }

  return {
    contract: VUEDOC_RUNNER_CONFIG_CONTRACT,
    contractVersion: VUEDOC_RUNNER_CONFIG_VERSION,
    workspaceRoot,
    outputDirectory,
    profileIds,
    inputs: value.inputs.map((input, index) => normalizeInput(input, index)),
    options
  };
}

function normalizeInput(value, index) {
  assertRecord(value, `inputs[${index}] must be an object.`);
  assertKnownKeys(value, ["kind", "path", "language"], `inputs[${index}]`);
  const kind = value.kind ?? "vue-sfc";
  if (kind !== "vue-sfc") {
    throw new TypeError(`Unsupported VueDoc runner input kind: ${kind}`);
  }
  return {
    kind,
    path: normalizeSafeRelativePath(value.path, `inputs[${index}].path`),
    ...(typeof value.language === "string" ? { language: value.language } : {})
  };
}

function normalizeOptions(value) {
  assertRecord(value, "options must be an object.");
  assertKnownKeys(value, ["componentId", "emitDocSourceMap", "sourcesContentPolicy", "writeResultManifest"], "options");
  const sourcesContentPolicy = value.sourcesContentPolicy ?? "none";
  if (!["none", "reference", "embed"].includes(sourcesContentPolicy)) {
    throw new TypeError(`Unsupported sourcesContentPolicy: ${sourcesContentPolicy}`);
  }
  return {
    componentId: typeof value.componentId === "string" ? value.componentId : null,
    emitDocSourceMap: value.emitDocSourceMap !== false,
    sourcesContentPolicy,
    writeResultManifest: value.writeResultManifest !== false
  };
}

function normalizeProfileIds(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== "string" || !SAFE_ID_PATTERN.test(id))) {
    throw new TypeError("profileIds must be a non-empty array of lower-case identifiers.");
  }
  return [...value];
}

function resolveRuntimeDirectory(value, baseDirectory, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return path.resolve(baseDirectory, value);
}

function normalizeSafeRelativePath(value, label) {
  if (typeof value !== "string" || !isSafeRelativePath(value)) {
    throw new TypeError(`${label} must be a safe relative path.`);
  }
  return value.replaceAll("\\", "/");
}

function isSafeRelativePath(value) {
  const normalized = String(value).replaceAll("\\", "/");
  return Boolean(normalized)
    && !path.posix.isAbsolute(normalized)
    && !path.win32.isAbsolute(value)
    && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(normalized)
    && !normalized.split("/").includes("..");
}

function applyOverrides(config, overrides) {
  if (overrides === undefined) {
    return config;
  }
  assertRecord(overrides, "overrides must be an object.");
  return {
    ...config,
    ...overrides,
    options: {
      ...(config.options ?? {}),
      ...(overrides.options ?? {})
    }
  };
}

function assertKnownKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
  }
}

function assertRecord(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(message);
  }
}
