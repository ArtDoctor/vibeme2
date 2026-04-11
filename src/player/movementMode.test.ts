import { describe, expect, it } from "vitest";

import {
  applyCreativeSpacePress,
  createMovementModeState,
  FLY_TOGGLE_WINDOW_MS,
  movementSpeedMultiplier,
  SPEED_BOOST_MULTIPLIER,
  toggleCreativeMode,
} from "./movementMode";

describe("movementMode", () => {
  it("toggles creative mode on and off", () => {
    const enabled = toggleCreativeMode(createMovementModeState());
    expect(enabled.creativeMode).toBe(true);
    expect(enabled.flyMode).toBe(false);

    const disabled = toggleCreativeMode(enabled);
    expect(disabled.creativeMode).toBe(false);
    expect(disabled.flyMode).toBe(false);
  });

  it("enters fly mode after a quick double-space in creative mode", () => {
    const creative = toggleCreativeMode(createMovementModeState());
    const firstTap = applyCreativeSpacePress(creative, 1000);
    const secondTap = applyCreativeSpacePress(
      firstTap,
      1000 + FLY_TOGGLE_WINDOW_MS - 1,
    );
    expect(secondTap.flyMode).toBe(true);
  });

  it("does not enter fly mode when taps are too far apart", () => {
    const creative = toggleCreativeMode(createMovementModeState());
    const firstTap = applyCreativeSpacePress(creative, 1000);
    const secondTap = applyCreativeSpacePress(
      firstTap,
      1000 + FLY_TOGGLE_WINDOW_MS + 1,
    );
    expect(secondTap.flyMode).toBe(false);
  });

  it("keeps fly mode enabled while space is reused for ascend", () => {
    const creative = toggleCreativeMode(createMovementModeState());
    const flying = applyCreativeSpacePress(
      applyCreativeSpacePress(creative, 1000),
      1100,
    );
    expect(applyCreativeSpacePress(flying, 1200).flyMode).toBe(true);
  });

  it("uses the requested 3x boost while sprinting", () => {
    expect(movementSpeedMultiplier(false)).toBe(1);
    expect(movementSpeedMultiplier(true)).toBe(SPEED_BOOST_MULTIPLIER);
  });
});
