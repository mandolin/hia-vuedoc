import { createCommentVNode as _createCommentVNode, toDisplayString as _toDisplayString, createElementVNode as _createElementVNode, renderSlot as _renderSlot, Fragment as _Fragment, openBlock as _openBlock, createElementBlock as _createElementBlock } from "vue"

export function render(_ctx, _cache) {
  return (_openBlock(), _createElementBlock(_Fragment, null, [
    _createCommentVNode("\n    @component ProfileCard Profile card Vue SFC component.\n    @slot actions Optional action controls rendered by the parent app.\n    @stylehook .profile-card Root element style hook shared with CSSDoc.\n  "),
    _createElementVNode("article", {
      class: "profile-card",
      "data-component": "ProfileCard",
      onClick: _cache[0] || (_cache[0] = $event => (_ctx.emit('select', _ctx.props.user.id)))
    }, [
      _createElementVNode("h2", null, _toDisplayString(_ctx.formatUserLabel(_ctx.props.user)), 1 /* TEXT */),
      _renderSlot(_ctx.$slots, "actions")
    ])
  ], 2112 /* STABLE_FRAGMENT, DEV_ROOT_FRAGMENT */))
}
