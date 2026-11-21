// Gesture vocabulary shared by the engine, the UI and the integrations.

/** Static hand poses produced by the classifier. */
export const POSES = {
  none: { label: 'Nessuna', emoji: '·' },
  open_palm: { label: 'Mano aperta', emoji: '🖐️' },
  fist: { label: 'Pugno', emoji: '✊' },
  point: { label: 'Indice', emoji: '☝️' },
  victory: { label: 'Vittoria', emoji: '✌️' },
  thumb_up: { label: 'Pollice su', emoji: '👍' },
  thumb_down: { label: 'Pollice giù', emoji: '👎' },
  rock: { label: 'Corna', emoji: '🤘' },
  pinch: { label: 'Pizzico', emoji: '🤏' },
};

/**
 * Discrete gestures (the things an application reacts to). Each one is
 * emitted by the engine as a `gesture` event with `detail.id` set to the key.
 */
export const GESTURES = {
  swipe_left: { label: 'Scorri a sinistra', emoji: '👈' },
  swipe_right: { label: 'Scorri a destra', emoji: '👉' },
  swipe_up: { label: 'Scorri in alto', emoji: '👆' },
  swipe_down: { label: 'Scorri in basso', emoji: '👇' },
  tap: { label: 'Pizzico rapido (clic)', emoji: '🤏' },
  hold_open_palm: { label: 'Mano aperta ferma', emoji: '🖐️' },
  hold_fist: { label: 'Pugno fermo', emoji: '✊' },
  hold_point: { label: 'Indice fermo', emoji: '☝️' },
  hold_victory: { label: 'Vittoria ferma', emoji: '✌️' },
  hold_thumb_up: { label: 'Pollice su fermo', emoji: '👍' },
  hold_thumb_down: { label: 'Pollice giù fermo', emoji: '👎' },
  hold_rock: { label: 'Corna ferme', emoji: '🤘' },
};

export function describeGesture(id) {
  return GESTURES[id] ?? { label: id, emoji: '❔' };
}

export function describePose(id) {
  return POSES[id] ?? POSES.none;
}
