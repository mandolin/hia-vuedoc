/**
 * @file
 * @lang zh-CN Vue 原生模板编译的无正文坐标侧载；只签发已核实的单 SFC 模板槽位。
 * @lang en Body-free coordinate sidecar for native Vue template compilation; only a proven single-SFC template slot is signed.
 */
import { createHash } from "node:crypto";

/** @lang zh-CN 严格读取器对每份源码或地图的字节上限。 @lang en The strict reader's per-source and per-map byte limit. */
const ARTIFACT_LIMIT = 16 * 1024 * 1024;
/** @lang zh-CN 严格读取器对侧载的字节上限。 @lang en The strict reader's sidecar byte limit. */
const PROFILE_LIMIT = 2 * 1024 * 1024;
/** @lang zh-CN 用于拒绝非原始单槽位或非法 VLQ 的字母表。 @lang en Alphabet used to reject nonprimary slots or malformed VLQ. */
const BASE64_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** @lang zh-CN 新侧载公开身份的安全词法。 @lang en Safe public identity syntax for the new sidecar. */
const IDENTITY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/**
 * @lang zh-CN 严格解码本轮实际获准的 UTF-8 字节，保留 BOM 和 CRLF，拒绝替换字符造成的假版本。
 * @lang en Strictly decodes authorized UTF-8 bytes from this build, preserving BOM and CRLF and refusing replacement-character versions.
 * @param {Uint8Array} sourceBytes 获准读取的 Vue SFC 原始字节 / Authorized raw Vue SFC bytes.
 * @returns {string} 供提取与编译共用的原始逻辑文本 / Logical source text shared by extraction and compilation.
 * @throws {TypeError} 超过 16 MiB 或非有效 UTF-8 / Over 16 MiB or invalid UTF-8.
 */
export function decodeCoordinateSource(sourceBytes) {
  if (!(sourceBytes instanceof Uint8Array) || sourceBytes.byteLength > ARTIFACT_LIMIT) {
    throw new TypeError("Coordinate source must be at most 16 MiB of bytes.");
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(sourceBytes);
}

/**
 * @lang zh-CN 将同轮模板普通图、文档图和 SFC 字节绑定，只认证无预处理且首行无列偏移风险的模板。
 * @lang en Binds same-build template map, documentation map and SFC bytes; certifies only native templates without a first-line column-offset risk.
 * @param {object} input 本轮源码、Vue 模板块及实际落盘的两张图 / This build's source, Vue template block and actual written map bytes.
 * @returns {object} `ordinary-source-map-coordinate-profile@0.1.0-draft` 无正文侧载 / Body-free coordinate sidecar.
 * @throws {TypeError} 字节、原始槽位、范围或身份不能被证明 / Bytes, original slot, range or identities cannot be proven.
 */
export function createVueTemplateCoordinateProfile(input) {
  const {
    sourceBytes, sourceText, sourcePath, templateBlock,
    ordinaryMap, ordinaryMapBytes, documentationMap, documentationMapBytes, inputIndex
  } = input;

  // <lang><zh-CN>只摘要同轮实际写出的 JSON；不得只信内存对象或上次同名文件。</zh-CN><en>Hash JSON actually written in this build, never only an in-memory object or a prior same-name file.</en></lang>
  if (!Number.isSafeInteger(inputIndex) || inputIndex < 0
    || !(ordinaryMapBytes instanceof Uint8Array) || !(documentationMapBytes instanceof Uint8Array)
    || ordinaryMapBytes.byteLength > ARTIFACT_LIMIT || documentationMapBytes.byteLength > ARTIFACT_LIMIT
    || !Buffer.from(ordinaryMapBytes).equals(serializedJson(ordinaryMap))
    || !Buffer.from(documentationMapBytes).equals(serializedJson(documentationMap))) {
    throw new TypeError("Coordinate map bytes do not match this build.");
  }
  if (!(sourceBytes instanceof Uint8Array) || typeof sourceText !== "string"
    || decodeCoordinateSource(sourceBytes) !== sourceText) {
    throw new TypeError("Coordinate source text does not match its input bytes.");
  }

  // <lang><zh-CN>Vue 3.5.39 的模板 inMap 合并保留模板内列号而不加首行 SFC 偏移；只接受标签后立即换行的本地原生模板。</zh-CN><en>Vue 3.5.39 preserves template-local columns when merging inMap without the first SFC-line offset; accept only a native template with a newline immediately after its opening tag.</en></lang>
  if (!templateBlock || templateBlock.lang || templateBlock.src
    || !/^\r?\n/.test(templateBlock.content)
    || !Number.isSafeInteger(templateBlock.loc?.start?.offset)
    || !Number.isSafeInteger(templateBlock.loc?.end?.offset)
    || sourceText.slice(templateBlock.loc.start.offset, templateBlock.loc.end.offset) !== templateBlock.content) {
    throw new TypeError("Coordinate template has no proven original-column basis.");
  }

  // <lang><zh-CN>此分支只允许 Vue 编译器给出的一个无正文、非 section 原始槽位；不把 script/style 的图借为模板证据。</zh-CN><en>This branch admits only the compiler's single body-free, nonsection original slot; script/style maps never lend evidence to the template.</en></lang>
  if (ordinaryMap?.version !== 3 || !Array.isArray(ordinaryMap.sources)
    || ordinaryMap.sources.length !== 1 || ordinaryMap.sources[0] !== sourcePath
    || ordinaryMap.sourceRoot !== "" || Object.hasOwn(ordinaryMap, "sections")
    || ordinaryMap.sourcesContent !== undefined && (!Array.isArray(ordinaryMap.sourcesContent) || ordinaryMap.sourcesContent.length !== 0)
    || typeof ordinaryMap.mappings !== "string") {
    throw new TypeError("Coordinate template ordinary map has no supported primary slot.");
  }

  // <lang><zh-CN>模板图必须由当前文档图的模板边唯一声明，并准确指向本次 SFC 来源。</zh-CN><en>The current documentation map must uniquely declare this template edge and point it at this SFC source.</en></lang>
  const sourceNode = documentationMap?.sources?.[0];
  const templateMaps = documentationMap?.sourceMaps?.filter((node) => node?.id === "sourcemap:vue-template");
  const templateMap = templateMaps?.[0];
  if (documentationMap?.contract !== "doc-source-map" || documentationMap.contractVersion !== "1.1.0"
    || documentationMap.privacy?.sourcesContentPolicy !== "none"
    || !safeIdentity(documentationMap.id)
    || !Array.isArray(documentationMap.sources) || documentationMap.sources.length !== 1
    || !safeIdentity(sourceNode?.id) || sourceNode.path !== sourcePath
    || sourceNode.sourcesContentPolicy !== "none" || Object.hasOwn(sourceNode, "sourcesContent")
    || templateMaps?.length !== 1 || templateMap?.kind !== "ordinary-source-map"
    || !safeIdentity(templateMap.mapsFrom) || templateMap.mapsTo?.length !== 1
    || templateMap.mapsTo[0] !== sourceNode.id
    || !documentationMap.artifacts?.some((artifact) => artifact.id === templateMap.mapsFrom)) {
    throw new TypeError("Coordinate template documentation map identities are not linked.");
  }

  // <lang><zh-CN>无原始段时只绑定双图，不签发可误认同点的槽位；真实段的来源序号须一直为零。</zh-CN><en>With no original segment, bind the maps but sign no slot; every real segment must keep source index zero.</en></lang>
  const sourceSlots = !hasOriginalSlotMapping(ordinaryMap.mappings) ? [] : [{
    sectionIndex: null,
    sourceIndex: 0,
    sourceId: sourceNode.id,
    columnUnit: "utf16-code-unit",
    sourceRevision: `content-sha256:${createHash("sha256").update(sourceBytes).digest("hex")}`,
    sourceByteDigest: { algorithm: "sha256", value: sha256(sourceBytes) },
    sourceTextEncoding: "utf-8",
    sourceTextTransform: "none",
    sourceTextDigest: {
      representation: "decoded-utf16-code-units",
      algorithm: "sha256",
      value: sha256(Buffer.from(sourceText, "utf16le"))
    }
  }];
  const profile = {
    contract: "ordinary-source-map-coordinate-profile",
    contractVersion: "0.1.0-draft",
    id: `coordinate-profile:vue-template:input-${inputIndex + 1}`,
    ordinaryMap: {
      sourceMapId: templateMap.id,
      artifactId: templateMap.mapsFrom,
      digest: { algorithm: "sha256", value: sha256(ordinaryMapBytes) }
    },
    documentationMap: {
      id: documentationMap.id,
      contractVersion: "1.1.0",
      digest: { algorithm: "sha256", value: sha256(documentationMapBytes) }
    },
    sourceSlots,
    privacy: { sourcesContentPolicy: "none" }
  };
  if (serializedJson(profile).byteLength > PROFILE_LIMIT) {
    throw new TypeError("Coordinate profile exceeds the 2 MiB reader limit.");
  }
  return profile;
}

/**
 * @lang zh-CN 有界解码 ECMA-426 段来源增量；只判断原始槽位是否确有实际段，不进行最近段推断。
 * @lang en Decodes ECMA-426 segment source deltas within the map byte bound; detects real original-slot segments without nearest-segment inference.
 * @param {string} mappings 普通图 VLQ 字符串 / Ordinary-map VLQ mappings.
 * @returns {boolean} 是否出现原始槽位 0 的实际段 / Whether a real segment references original slot zero.
 * @throws {TypeError} 非法 VLQ、段形状或其它槽位 / Malformed VLQ, segment shape or another slot.
 */
function hasOriginalSlotMapping(mappings) {
  let sourceIndex = 0;
  let found = false;
  for (const segment of mappings.split(/[;,]/)) {
    if (!segment) continue;
    const fields = [];
    let encoded = 0;
    let multiplier = 1;
    for (const character of segment) {
      const digit = BASE64_DIGITS.indexOf(character);
      if (digit < 0) throw new TypeError("Coordinate template map contains invalid VLQ.");
      encoded += (digit & 31) * multiplier;
      if (!Number.isSafeInteger(encoded)) throw new TypeError("Coordinate template map VLQ exceeds the safe integer range.");
      if (digit & 32) {
        multiplier *= 32;
        if (!Number.isSafeInteger(multiplier)) throw new TypeError("Coordinate template map VLQ exceeds the safe integer range.");
      } else {
        fields.push(encoded % 2 === 1 ? -Math.floor(encoded / 2) : Math.floor(encoded / 2));
        encoded = 0;
        multiplier = 1;
      }
    }
    if (multiplier !== 1 || ![1, 4, 5].includes(fields.length)) {
      throw new TypeError("Coordinate template map has an unsupported segment shape.");
    }
    if (fields.length > 1) {
      sourceIndex += fields[1];
      if (sourceIndex !== 0) throw new TypeError("Coordinate template map segment points outside its primary source slot.");
      found = true;
    }
  }
  return found;
}

/** @lang zh-CN 只把公开安全 ASCII token 放进侧载身份。 @lang en Keep only public-safe ASCII tokens in sidecar identities. */
function safeIdentity(value) { return typeof value === "string" && value.length <= 512 && IDENTITY_PATTERN.test(value); }
/** @lang zh-CN 与 producer 的落盘 JSON 缩进及尾换行字节一致。 @lang en Match the producer's written JSON indentation and trailing newline bytes. */
function serializedJson(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"); }
/** @lang zh-CN 摘要本身采用规范 Base64，而非源码正文编码。 @lang en Return canonical Base64 of the digest, never an encoding of source body. */
function sha256(bytes) { return createHash("sha256").update(bytes).digest("base64"); }
