<template>
  <!--
    @component ProfileCard Profile card Vue SFC component.
    @slot actions Optional action controls rendered by the parent app.
    @stylehook .profile-card Root element style hook shared with CSSDoc.
  -->
  <article class="profile-card" data-component="ProfileCard" @click="emit('select', props.user.id)">
    <h2>{{ formatUserLabel(props.user) }}</h2>
    <slot name="actions" />
  </article>
</template>

<script setup>
/**
 * @event select Emitted when the profile card is selected.
 */
const props = defineProps({
  user: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(["select"]);

function formatUserLabel(user) {
  return user.displayName || user.name;
}

defineExpose({
  formatUserLabel
});
</script>

<style scoped>
/*
 * @component ProfileCard Scoped styles for the Vue profile card.
 * @selector .profile-card Public selector exposed by the component root.
 * @cssprop --profile-card-accent Accent color consumed by the card border.
 */
.profile-card {
  --profile-card-accent: #0f766e;
  border: 1px solid var(--profile-card-accent);
  padding: 0.75rem;
}
</style>
