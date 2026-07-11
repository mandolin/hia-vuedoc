
const __default__ = {
  __name: 'ProfileCard',
  props: {
  user: {
    type: Object,
    required: true
  }
},
  emits: ["select"],
  setup(__props, { expose: __expose, emit: __emit }) {
  __expose();

/**
 * @expose formatUserLabel Public helper used by the template render path.
 * @event select Emitted when the profile card is selected.
 */
const props = __props;

const emit = __emit;

function formatUserLabel(user) {
  return user.displayName || user.name;
}

const __returned__ = { props, emit, formatUserLabel }
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true })
return __returned__
}

}
