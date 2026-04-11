export const SPEED_BOOST_MULTIPLIER = 3;
/** Baseline run speed (m/s). Half of the legacy default. */
export const DEFAULT_MOVE_SPEED = 7.5 / 2;
/** Creative mode horizontal speed (m/s): 3× legacy default 7.5. */
export const CREATIVE_MOVE_SPEED = 7.5 * 3;
export const FLY_TOGGLE_WINDOW_MS = 350;

/** Extra movement flags that accompany the local pose. */
export interface MovementModeFlags {
  creative: boolean;
  flying: boolean;
  sprinting: boolean;
}

/** Local creative/fly toggle state driven by keyboard input. */
export interface MovementModeState {
  creativeMode: boolean;
  flyMode: boolean;
  lastSpacePressAtMs: number | null;
}

export function createMovementModeState(): MovementModeState {
  return {
    creativeMode: false,
    flyMode: false,
    lastSpacePressAtMs: null,
  };
}

export function toggleCreativeMode(
  state: MovementModeState,
): MovementModeState {
  if (state.creativeMode) {
    return {
      creativeMode: false,
      flyMode: false,
      lastSpacePressAtMs: null,
    };
  }
  return {
    creativeMode: true,
    flyMode: false,
    lastSpacePressAtMs: null,
  };
}

/**
 * Double-tapping space while creative mode is armed enters fly mode.
 * Once flying, space is reserved for ascend and does not toggle back off.
 */
export function applyCreativeSpacePress(
  state: MovementModeState,
  nowMs: number,
): MovementModeState {
  if (!state.creativeMode || state.flyMode) {
    return state;
  }
  if (
    state.lastSpacePressAtMs !== null &&
    nowMs - state.lastSpacePressAtMs <= FLY_TOGGLE_WINDOW_MS
  ) {
    return {
      ...state,
      flyMode: true,
      lastSpacePressAtMs: null,
    };
  }
  return {
    ...state,
    lastSpacePressAtMs: nowMs,
  };
}

export function movementSpeedMultiplier(sprinting: boolean): number {
  return sprinting ? SPEED_BOOST_MULTIPLIER : 1;
}
