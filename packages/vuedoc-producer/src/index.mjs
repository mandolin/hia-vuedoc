import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { vueDocToCssExtraction, vueDocToHiaDocument, vueDocToHtmlExtraction } from "@hia-doc/vue-sfc-bridge";
import { createVueSfcDocSourceMap } from "@hia-doc/vue-sfc-doc-source-map";
import { compileVueSfc, extractVueSfc } from "@hia-doc/vue-sfc-extractor";
import {
  VUEDOC_EXTRACTION_CONTRACT,
  VUEDOC_EXTRACTION_CONTRACT_VERSION
} from "@hia-doc/vuedoc-spec";
import { createVueTemplateCoordinateProfile, decodeCoordinateSource } from "./coordinate-profile.mjs";

/**
 * Declares the runtime version of the VueDoc producer adapter.
 *
 * @constant {string}
 * @lang zh-CN 声明 VueDoc producer adapter 的运行时版本。
 * @lang en Declares the runtime version of the VueDoc producer adapter.
 */
export const VUEDOC_PRODUCER_VERSION = "0.0.0";

/**
 * Lists the VueDoc input kinds accepted by the producer adapter.
 *
 * @constant {string[]}
 * @lang zh-CN 列出 VueDoc producer adapter 接受的输入类型。
 * @lang en Lists the VueDoc input kinds accepted by the producer adapter.
 */
export const VUEDOC_INPUT_KINDS = Object.freeze(["vue-sfc"]);

/**
 * Lists the artifact kinds emitted by the VueDoc producer adapter.
 *
 * @constant {string[]}
 * @lang zh-CN 列出 VueDoc producer adapter 可能产出的 artifact 类型。
 * @lang en Lists the artifact kinds emitted by the VueDoc producer adapter.
 */
export const VUEDOC_OUTPUT_KINDS = Object.freeze([
  "generated-js",
  "generated-css",
  "ordinary-source-map",
  "vuedoc-extraction",
  "htmdoc-extraction",
  "cssdoc-extraction",
  "hia-document",
  "doc-source-map",
  "ordinary-source-map-coordinate-profile"
]);

const RESULT_CONTRACT = "documentation-producer-result";
const RESULT_CONTRACT_VERSION = "0.1.0-draft";
const PRODUCER_ID = "vuedoc";
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Describes the VueDoc producer for HIA project manifest orchestration.
 *
 * @constant {object}
 * @lang zh-CN 描述供 HIA project manifest 编排层加载的 VueDoc producer 能力。
 * @lang en Describes the VueDoc producer for HIA project manifest orchestration.
 */
export const vuedocProducerDescriptor = Object.freeze({
  contract: "documentation-producer",
  contractVersion: "0.1.0-draft",
  id: PRODUCER_ID,
  version: VUEDOC_PRODUCER_VERSION,
  displayName: "VueDoc",
  inputKinds: [...VUEDOC_INPUT_KINDS],
  outputKinds: [...VUEDOC_OUTPUT_KINDS],
  capabilities: {
    sourceLinkage: true,
    incremental: false,
    watch: false
  }
});

/**
 * Runs Vue SFC extraction, framework bridges, generated artifacts, and doc-source-map emission.
 *
 * @constant {object}
 * @lang zh-CN 运行 Vue SFC extraction、framework bridge、生成产物和 doc-source-map 输出。
 * @lang en Runs Vue SFC extraction, framework bridges, generated artifacts, and doc-source-map emission.
 */
export const vuedocProducer = Object.freeze({
  descriptor: vuedocProducerDescriptor,
  produce(request, context = {}) {
    return runVueDoc(request, context);
  }
});

export default vuedocProducer;

/**
 * @lang zh-CN 执行多输入 Vue 生产：严格侧载模式先核输出根，逐输入失败只进入诊断；成功工件与当前结果清单同步。
 * @lang en Runs multi-input Vue production: strict sidecar mode checks the output root first, per-input failures become diagnostics, and successful artifacts feed the current result manifest.
 * @param {object} request 未规范化的生产请求 / Unnormalized producer request.
 * @param {object} [context] 可选取消与进度适配器 / Optional cancellation and progress adapter.
 * @returns {Promise<object>} 本次生产结果；侧载默认关闭 / This run's producer result; the sidecar is off by default.
 * @throws {TypeError} 请求非法或严格输出根越界；结果清单 I/O 异常可继续抛出 / Invalid request or escaped strict output root; result-manifest I/O can also throw.
 */
async function runVueDoc(request, context = {}) {
  const normalized = normalizeRequest(request);
  // <lang><zh-CN>可选证据在第一次建目录前逐级拒绝外部路径和链接，避免失败签发前已越界写入。</zh-CN><en>Before the first opt-in directory write, walk and reject external paths or links so a failed proof cannot have written outside the workspace.</en></lang>
  if (normalized.options.emitCoordinateProfile) {
    await ensureCoordinateDirectory(normalized.workspaceRoot, normalized.outputDirectory);
    if (normalized.options.writeResultManifest) {
      await assertSafeOutputFile(normalized.outputDirectory, "vuedoc.producer-result.json");
    }
  } else {
    await mkdir(normalized.outputDirectory, { recursive: true });
  }

  const artifacts = [];
  const diagnostics = [];
  let completed = 0;

  for (const [index, input] of normalized.inputs.entries()) {
    if (context.signal?.aborted) {
      diagnostics.push(createDiagnostic("VUEDOC_PRODUCER_ABORTED", "VueDoc producer was aborted before all inputs completed.", "error"));
      break;
    }

    context.reportProgress?.({
      phase: "extract",
      current: index,
      total: normalized.inputs.length,
      message: input.path
    });

    try {
      const generated = await processInput(input, normalized, index);
      artifacts.push(...generated.artifacts);
      diagnostics.push(...generated.diagnostics);
      completed += 1;
    } catch (error) {
      diagnostics.push(createDiagnostic(
        "VUEDOC_PRODUCER_INPUT_FAILED",
        `Unable to process VueDoc input ${input.path} (${errorCode(error)}).`,
        "error",
        input.path
      ));
    }
  }

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const result = {
    contract: RESULT_CONTRACT,
    contractVersion: RESULT_CONTRACT_VERSION,
    producer: {
      id: PRODUCER_ID,
      version: VUEDOC_PRODUCER_VERSION
    },
    status: hasErrors ? (artifacts.length > 0 ? "partial" : "failed") : "success",
    artifacts,
    diagnostics
  };

  if (normalized.options.writeResultManifest) {
    await writeJson(path.join(normalized.outputDirectory, "vuedoc.producer-result.json"), result);
  }

  context.reportProgress?.({
    phase: "complete",
    current: completed,
    total: normalized.inputs.length
  });

  return result;
}

/**
 * @lang zh-CN 处理单一 Vue SFC，先撤销旧侧载，再从同一源码快照生成桥接/地图；仅在模板证据通过后最后写无正文侧载。
 * @lang en Processes one Vue SFC, revoking old evidence first, generating bridges/maps from one source snapshot and writing the body-free sidecar last only after template proof passes.
 * @param {object} input 已核安全相对来源 / Validated safe-relative input.
 * @param {object} request 已规范化生产请求 / Normalized producer request.
 * @param {number} index 本次输入的零基序号 / Zero-based input index for this run.
 * @returns {Promise<{artifacts:object[],diagnostics:object[]}>} 仅成功输入的工件和诊断 / Artifacts and diagnostics for a successful input.
 * @throws {TypeError} 严格来源、路径、编译图或身份不能证明时拒绝签发 / Refuses proof when strict source, path, compiled map or identity cannot be established.
 */
async function processInput(input, request, index) {
  const sourcePath = input.path;
  const basePath = outputBasePath(input, index);
  // <lang><zh-CN>每次处理本输入先撤销旧侧载；即使随后源码缺失或拒绝，也不能留下冒充新地图的证明。</zh-CN><en>Revoke this input's old sidecar first, even when source reading later fails, so no old proof survives a rebuild.</en></lang>
  const coordinateProfilePath = `${basePath}.coordinate-profile.json`;
  const absoluteCoordinateProfilePath = path.join(request.outputDirectory, coordinateProfilePath);
  // <lang><zh-CN>严格模式在首次撤销或写入前核所有同基名输出文件，阻止预存文件链接跳出输出根。</zh-CN><en>Before strict revocation or writing, preflight every same-base output path so existing file links cannot redirect outside the output root.</en></lang>
  if (request.options.emitCoordinateProfile) {
    for (const suffix of [".vuedoc.json", ".htmdoc.json", ".cssdoc.json", ".hia.json", ".docmap.json",
      ".coordinate-profile.json", ".template.js", ".template.js.map", ".script.js", ".script.js.map", ".style.css", ".style.css.map"]) {
      await assertSafeOutputFile(request.outputDirectory, `${basePath}${suffix}`);
    }
  } else {
    await assertSafeOutputFile(request.outputDirectory, coordinateProfilePath);
  }
  await rm(absoluteCoordinateProfilePath, { force: true });
  // <lang><zh-CN>可选坐标证据用严格 UTF-8 原始字节作为本轮提取、编译与摘要共用的不可变快照。</zh-CN><en>Optional coordinate evidence shares one strictly decoded raw-byte snapshot across extraction, compilation and digests.</en></lang>
  const absoluteSourcePath = path.resolve(request.workspaceRoot, sourcePath);
  if (request.options.emitCoordinateProfile) {
    await assertContainedRealPath(request.workspaceRoot, absoluteSourcePath);
    await assertContainedRealPath(request.workspaceRoot, request.outputDirectory);
  }
  const sourceBytes = request.options.emitCoordinateProfile ? await readFile(absoluteSourcePath) : null;
  const source = sourceBytes ? decodeCoordinateSource(sourceBytes) : await readFile(absoluteSourcePath, "utf8");
  const vueDocPath = `${basePath}.vuedoc.json`;
  const htmDocPath = `${basePath}.htmdoc.json`;
  const cssDocPath = `${basePath}.cssdoc.json`;
  const hiaDocumentPath = `${basePath}.hia.json`;
  const docSourceMapPath = `${basePath}.docmap.json`;
  const vueArtifact = extractVueSfc(source, {
    path: sourcePath
  });
  const compiled = compileVueSfc(source, {
    path: sourcePath,
    id: request.options.componentId ?? slug(sourcePath)
  });
  const outputRefs = await writeCompiledOutputs(compiled.outputs, basePath, request.outputDirectory);
  // <lang><zh-CN>关闭映射输出时不向三个桥接工件写入悬空链接。</zh-CN><en>Do not place dangling map links in the three bridge artifacts when map emission is disabled.</en></lang>
  const activeDocSourceMapPath = request.options.emitDocSourceMap ? docSourceMapPath : null;
  // <lang><zh-CN>先得到真实映射版本，再写 HIA 文档及结果清单；关闭映射时不构造悬空工件。</zh-CN><en>Obtain the actual map version before writing the HIA document and result manifest; do not build a dangling map when disabled.</en></lang>
  const docSourceMap = activeDocSourceMapPath ? createVueSfcDocSourceMap({
    vueArtifact,
    vueDocPath,
    htmDocPath,
    cssDocPath,
    hiaDocumentPath,
    ...outputRefs
  }) : null;
  const htmDoc = vueDocToHtmlExtraction(vueArtifact, {
    docSourceMapPath: activeDocSourceMapPath,
    templatePath: outputRefs.templatePath ?? sourcePath
  });
  const cssDoc = vueDocToCssExtraction(vueArtifact, {
    docSourceMapPath: activeDocSourceMapPath,
    stylePath: outputRefs.stylePath ?? sourcePath
  });
  const hiaDocument = vueDocToHiaDocument(vueArtifact, {
    id: `vuedoc:${sourcePath}`,
    title: path.posix.basename(sourcePath),
    docSourceMapPath: activeDocSourceMapPath,
    docSourceMapContractVersion: docSourceMap?.contractVersion,
    entryArtifact: outputRefs.templatePath ?? null
  });
  await writeJson(path.join(request.outputDirectory, vueDocPath), vueArtifact);
  await writeJson(path.join(request.outputDirectory, htmDocPath), htmDoc);
  await writeJson(path.join(request.outputDirectory, cssDocPath), cssDoc);
  await writeJson(path.join(request.outputDirectory, hiaDocumentPath), hiaDocument);
  if (docSourceMap) {
    await writeJson(path.join(request.outputDirectory, docSourceMapPath), docSourceMap);
  }

  // <lang><zh-CN>只在模板普通图与文档图均由本轮实际写出、源码快照仍相同时构造侧载；script/style 保持未核。</zh-CN><en>Create a sidecar only after the template ordinary map and documentation map are actually written and the source snapshot still matches; script/style remain unverified.</en></lang>
  if (request.options.emitCoordinateProfile) {
    const templateOutput = compiled.outputs.find((output) => output.kind === "template-render");
    if (!templateOutput?.map || !outputRefs.templateMapPath || !docSourceMap || !sourceBytes
      || compiled.errors.length > 0 || templateOutput.errors.length > 0
      || !Buffer.from(await readFile(absoluteSourcePath)).equals(sourceBytes)) {
      throw new TypeError("Coordinate template lacks same-build source and maps.");
    }
    await assertContainedRealPath(request.outputDirectory, path.join(request.outputDirectory, outputRefs.templateMapPath));
    await assertContainedRealPath(request.outputDirectory, path.join(request.outputDirectory, docSourceMapPath));
    const profile = createVueTemplateCoordinateProfile({
      sourceBytes,
      sourceText: source,
      sourcePath,
      templateBlock: compiled.descriptor.template,
      ordinaryMap: templateOutput.map,
      ordinaryMapBytes: await readFile(path.join(request.outputDirectory, outputRefs.templateMapPath)),
      documentationMap: docSourceMap,
      documentationMapBytes: await readFile(path.join(request.outputDirectory, docSourceMapPath)),
      inputIndex: index
    });
    try {
      await writeJson(absoluteCoordinateProfilePath, profile);
    } catch (error) {
      // <lang><zh-CN>侧载若只写入部分字节，不能把半成品留在下一次消费路径。</zh-CN><en>If sidecar I/O wrote only partial bytes, keep no incomplete profile at the consumer path.</en></lang>
      await rm(absoluteCoordinateProfilePath, { force: true });
      throw error;
    }
  }

  const artifactIdBase = `input-${index + 1}`;
  const artifacts = [
    ...compiledOutputArtifacts(outputRefs, artifactIdBase, request.profileIds),
    {
      ...artifact(`${artifactIdBase}-vuedoc`, "vuedoc-extraction", vueDocPath, "json", "application/json", request.profileIds),
      contract: VUEDOC_EXTRACTION_CONTRACT,
      contractVersion: VUEDOC_EXTRACTION_CONTRACT_VERSION
    },
    {
      ...artifact(`${artifactIdBase}-htmdoc`, "htmdoc-extraction", htmDocPath, "json", "application/json", request.profileIds),
      contract: "hia-htmdoc-extraction",
      contractVersion: "0.1.0-draft"
    },
    {
      ...artifact(`${artifactIdBase}-cssdoc`, "cssdoc-extraction", cssDocPath, "json", "application/json", request.profileIds),
      contract: "hia-cssdoc-extraction",
      // <lang><zh-CN>清单采用实际桥接工件身份，避免writer升级后版本描述仍旧。</zh-CN><en>The manifest uses the actual bridge artifact identity so writer upgrades cannot leave stale version metadata.</en></lang>
      contractVersion: cssDoc.contractVersion
    },
    artifact(`${artifactIdBase}-hia-document`, "hia-document", hiaDocumentPath, "json", "application/json", request.profileIds)
  ];

  if (docSourceMap) {
    artifacts.push({
      ...artifact(`${artifactIdBase}-doc-source-map`, "doc-source-map", docSourceMapPath, "json", "application/json", request.profileIds),
      contract: "doc-source-map",
      contractVersion: docSourceMap.contractVersion
    });
  }
  if (request.options.emitCoordinateProfile) {
    artifacts.push({
      ...artifact(`${artifactIdBase}-coordinate-profile`, "ordinary-source-map-coordinate-profile", coordinateProfilePath, "json", "application/json", request.profileIds),
      contract: "ordinary-source-map-coordinate-profile",
      contractVersion: "0.1.0-draft"
    });
  }

  return {
    artifacts,
    diagnostics: [
      ...normalizeDiagnostics(vueArtifact.diagnostics, sourcePath),
      ...normalizeCompileDiagnostics(compiled, sourcePath)
    ]
  };
}

async function writeCompiledOutputs(outputs, basePath, outputDirectory) {
  const refs = {};
  for (const output of outputs) {
    if (output.kind === "template-render") {
      refs.templatePath = `${basePath}.template.js`;
      await writeText(path.join(outputDirectory, refs.templatePath), ensureTrailingNewline(output.content));
      if (output.map) {
        refs.templateMapPath = `${refs.templatePath}.map`;
        await writeJson(path.join(outputDirectory, refs.templateMapPath), output.map);
      }
    }
    if (output.kind === "script") {
      refs.scriptPath = `${basePath}.script.js`;
      await writeText(path.join(outputDirectory, refs.scriptPath), ensureTrailingNewline(output.content));
      if (output.map) {
        refs.scriptMapPath = `${refs.scriptPath}.map`;
        await writeJson(path.join(outputDirectory, refs.scriptMapPath), output.map);
      }
    }
    if (output.kind === "style") {
      refs.stylePath = `${basePath}.style.css`;
      await writeText(path.join(outputDirectory, refs.stylePath), ensureTrailingNewline(output.content));
      if (output.map) {
        refs.styleMapPath = `${refs.stylePath}.map`;
        await writeJson(path.join(outputDirectory, refs.styleMapPath), output.map);
      }
    }
  }
  return refs;
}

function compiledOutputArtifacts(outputRefs, artifactIdBase, profileIds) {
  const artifacts = [];
  if (outputRefs.templatePath) {
    artifacts.push(artifact(`${artifactIdBase}-template-js`, "generated-js", outputRefs.templatePath, "javascript", "text/javascript", profileIds));
  }
  if (outputRefs.scriptPath) {
    artifacts.push(artifact(`${artifactIdBase}-script-js`, "generated-js", outputRefs.scriptPath, "javascript", "text/javascript", profileIds));
  }
  if (outputRefs.stylePath) {
    artifacts.push(artifact(`${artifactIdBase}-style-css`, "generated-css", outputRefs.stylePath, "css", "text/css", profileIds));
  }
  for (const [key, value] of Object.entries(outputRefs)) {
    if (key.endsWith("MapPath")) {
      artifacts.push(artifact(`${artifactIdBase}-${key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`, "ordinary-source-map", value, "json", "application/json", profileIds));
    }
  }
  return artifacts;
}

/**
 * @lang zh-CN 规范化 Vue producer 请求；坐标侧载必须显式布尔开启，并依赖文档图与无正文隐私策略。
 * @lang en Normalizes a Vue producer request; coordinate evidence requires an explicit boolean plus a documentation map and no-body privacy policy.
 * @param {unknown} value 外部请求 / External request.
 * @returns {object} 具有绝对运行目录和保守选项默认值的请求 / Request with absolute runtime directories and conservative option defaults.
 * @throws {TypeError} 输入路径、身份、选项或证据依赖非法 / Invalid input path, identity, option or evidence prerequisite.
 */
function normalizeRequest(value) {
  assertRecord(value, "VueDoc producer request must be an object.");
  assertAbsoluteDirectory(value.workspaceRoot, "workspaceRoot");
  assertAbsoluteDirectory(value.outputDirectory, "outputDirectory");
  if (!Array.isArray(value.inputs) || value.inputs.length === 0) {
    throw new TypeError("inputs must be a non-empty array.");
  }

  const inputs = value.inputs.map((input, index) => {
    assertRecord(input, `inputs[${index}] must be an object.`);
    assertKnownKeys(input, ["kind", "path", "language"], `inputs[${index}]`);
    const inputPath = normalizeSafeRelativePath(input.path, `inputs[${index}].path`);
    const kind = input.kind ?? "vue-sfc";
    if (!VUEDOC_INPUT_KINDS.includes(kind)) {
      throw new TypeError(`Unsupported VueDoc input kind: ${kind}`);
    }
    return {
      kind,
      path: inputPath,
      ...(typeof input.language === "string" ? { language: input.language } : {})
    };
  });

  const options = value.options ?? {};
  assertRecord(options, "options must be an object.");
  assertKnownKeys(options, ["componentId", "emitDocSourceMap", "emitCoordinateProfile", "sourcesContentPolicy", "writeResultManifest"], "options");
  const sourcesContentPolicy = options.sourcesContentPolicy ?? "none";
  if (!["none", "reference", "embed"].includes(sourcesContentPolicy)) {
    throw new TypeError(`Unsupported sourcesContentPolicy: ${sourcesContentPolicy}`);
  }
  if (options.emitCoordinateProfile !== undefined && typeof options.emitCoordinateProfile !== "boolean") {
    throw new TypeError("emitCoordinateProfile must be a boolean.");
  }
  if (options.emitCoordinateProfile === true && (options.emitDocSourceMap === false || sourcesContentPolicy !== "none")) {
    throw new TypeError("Coordinate profile requires doc-source-map and sourcesContentPolicy none.");
  }
  const profileIds = value.profileIds ?? ["htmdoc", "cssdoc", "doc-source-map"];
  if (!Array.isArray(profileIds) || profileIds.length === 0 || profileIds.some((id) => typeof id !== "string" || !SAFE_ID_PATTERN.test(id))) {
    throw new TypeError("profileIds must be a non-empty array of lower-case identifiers.");
  }

  return {
    workspaceRoot: path.resolve(value.workspaceRoot),
    outputDirectory: path.resolve(value.outputDirectory),
    inputs,
    profileIds: [...profileIds],
    options: {
      componentId: typeof options.componentId === "string" ? options.componentId : null,
      emitDocSourceMap: options.emitDocSourceMap !== false,
      emitCoordinateProfile: options.emitCoordinateProfile === true,
      sourcesContentPolicy,
      writeResultManifest: options.writeResultManifest !== false
    }
  };
}

/**
 * @lang zh-CN 为可选证明核真实路径仍在获准根内，防止相对输入或输出符号链接绕过边界。
 * @lang en Checks that a real path remains within its authorized root for optional evidence, rejecting symlink escapes.
 * @param {string} root 获准根 / Authorized root.
 * @param {string} candidate 待核已存在路径 / Existing path to verify.
 * @returns {Promise<void>} 成功时无值 / Resolves without a value on success.
 * @throws {TypeError} 路径越界 / Path escapes the root.
 */
async function assertContainedRealPath(root, candidate) {
  const relative = path.relative(await realpath(root), await realpath(candidate));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError("Coordinate path escapes its authorized root.");
  }
}

/**
 * @lang zh-CN 从已存在且获准的根逐级检查/建立输出目录，拒绝词法越界、符号链接、junction 与非目录组件。
 * @lang en Checks or creates output directories component by component from an existing authorized root, rejecting lexical escapes, links, junctions and nondirectories.
 * @param {string} baseDirectory 已存在的获准目录 / Existing authorized directory.
 * @param {string} targetDirectory 待建或待核目录 / Directory to create or verify.
 * @returns {Promise<void>} 每级都在真实根内 / Every component remains within the real root.
 * @throws {TypeError} 越界、链接或非目录 / Escape, link or nondirectory.
 */
async function ensureCoordinateDirectory(baseDirectory, targetDirectory) {
  const base = path.resolve(baseDirectory);
  const target = path.resolve(targetDirectory);
  const relative = path.relative(base, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError("Coordinate output escapes its authorized root.");
  }
  const baseReal = await realpath(base);
  let current = base;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let state;
    try {
      state = await lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current);
      state = await lstat(current);
    }
    if (state.isSymbolicLink() || !state.isDirectory()) {
      throw new TypeError("Coordinate output contains a linked or non-directory component.");
    }
    const actual = await realpath(current);
    const actualRelative = path.relative(baseReal, actual);
    if (actualRelative === ".." || actualRelative.startsWith(`..${path.sep}`) || path.isAbsolute(actualRelative)) {
      throw new TypeError("Coordinate output redirects outside its authorized root.");
    }
  }
}

/**
 * @lang zh-CN 写文件或撤销旧侧载前检查父目录与现存文件，避免通过预存链接写出工作区。
 * @lang en Checks parent directories and any existing file before writing or revoking a sidecar, preventing pre-existing links from redirecting output.
 * @param {string} outputDirectory 输出根 / Output root.
 * @param {string} relativeFile 输出根内的工件路径 / Artifact path below the output root.
 * @returns {Promise<void>} 静态路径预检通过 / Static path preflight succeeds.
 * @throws {TypeError} 路径越界或链接 / Path escape or link.
 */
async function assertSafeOutputFile(outputDirectory, relativeFile) {
  const absoluteFile = path.resolve(outputDirectory, relativeFile);
  const relative = path.relative(path.resolve(outputDirectory), absoluteFile);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError("Coordinate artifact escapes its output root.");
  }
  await ensureCoordinateDirectory(outputDirectory, path.dirname(absoluteFile));
  try {
    const state = await lstat(absoluteFile);
    if (state.isSymbolicLink() || !state.isFile()) {
      throw new TypeError("Coordinate artifact is a linked or non-file output.");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function outputBasePath(input, index) {
  const parsed = path.posix.parse(input.path);
  const directory = parsed.dir ? `${parsed.dir}/` : "";
  return normalizeSafeRelativePath(
    `artifacts/${directory}${parsed.name}.vue-sfc-${index + 1}`,
    "artifact base path"
  );
}

function normalizeDiagnostics(diagnostics, fallbackPath) {
  return (diagnostics ?? []).map((diagnostic) => ({
    code: typeof diagnostic?.code === "string" ? diagnostic.code : "VUEDOC_PRODUCER_DIAGNOSTIC",
    message: typeof diagnostic?.message === "string" ? diagnostic.message : "VueDoc producer diagnostic.",
    severity: ["error", "warning", "info"].includes(diagnostic?.severity) ? diagnostic.severity : "info",
    path: typeof diagnostic?.path === "string" ? diagnostic.path : fallbackPath,
    ...(isJsonObject(diagnostic?.data) ? { data: diagnostic.data } : {})
  }));
}

function normalizeCompileDiagnostics(compiled, sourcePath) {
  const diagnostics = [];
  for (const output of compiled.outputs ?? []) {
    for (const error of output.errors ?? []) {
      diagnostics.push(createDiagnostic(
        "VUEDOC_COMPILE_ERROR",
        typeof error === "string" ? error : String(error?.message ?? error),
        "error",
        sourcePath
      ));
    }
    for (const tip of output.tips ?? []) {
      diagnostics.push(createDiagnostic(
        "VUEDOC_COMPILE_TIP",
        typeof tip === "string" ? tip : String(tip),
        "info",
        sourcePath
      ));
    }
  }
  return diagnostics;
}

function artifact(id, kind, artifactPath, language, mediaType, profileIds) {
  return {
    id,
    kind,
    path: artifactPath,
    language,
    mediaType,
    profileIds
  };
}

async function writeJson(filePath, value) {
  await writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
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

function assertAbsoluteDirectory(value, label) {
  if (typeof value !== "string" || (!path.posix.isAbsolute(value) && !path.win32.isAbsolute(value))) {
    throw new TypeError(`${label} must be an absolute runtime path.`);
  }
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

function isJsonObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function createDiagnostic(code, message, severity, diagnosticPath) {
  return {
    code,
    message,
    severity,
    ...(diagnosticPath ? { path: diagnosticPath } : {})
  };
}

function errorCode(error) {
  return typeof error?.code === "string" ? error.code : error?.name ?? "Error";
}

function slug(value) {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "input";
}
