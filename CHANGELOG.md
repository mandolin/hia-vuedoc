# 变更日志 / Changelog

## 未发布 / Unreleased

- Vue 块注释只从编译器确认的精确内容切片提取；模板外同行注释不再误归属，排他式零长范围保持未知精度。
- Vue block annotations now come only from compiler-confirmed content slices; same-line outside comments are excluded, and exclusive zero-length spans remain unverified.
- 文档源码映射的mapsTo始终为引用数组；缺少可选注释或选择器时省略字段，保留未注释组件及脚本/样式条目。
- Documentation maps emit list-valued mapsTo and omit absent optional annotations/selectors, retaining undocumented components and script/style entries.
- 契约与包版本保持；本项描述源码变化，不表示已经发布npm。Contract/package versions are unchanged; these source changes are not an npm publication.
