
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

/**
 * @event select Emitted when the profile card is selected.
 */
const props = __props;

const emit = __emit;

function formatUserLabel(user) {
  return user.displayName || user.name;
}

__expose({
  formatUserLabel
});

const __returned__ = { props, emit, formatUserLabel }
Object.defineProperty(__returned__, '__isScriptSetup', { enumerable: false, value: true })
return __returned__
}

}
