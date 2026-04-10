import { Group, PerspectiveCamera } from "three";
import type { CombatInput } from "../player/CombatInput";
import type { SnapshotPlayer } from "../net/types";
import { normalizeWeaponKind } from "../net/snapshotNormalize";
import {
  animateWeaponGroups,
  buildWeaponGroupsFirstPerson,
  setWeaponVisible,
  type WeaponGroups,
} from "./weaponModels";

/**
 * Primitive weapon meshes in view space (parented to the camera) so the local
 * player sees swing / block / bow charge like remotes do.
 */
export class FirstPersonWeapon {
  private readonly root: Group;
  private readonly groups: WeaponGroups;

  constructor(camera: PerspectiveCamera) {
    this.root = new Group();
    this.root.name = "fpWeapons";
    this.root.scale.setScalar(1.48);
    this.groups = buildWeaponGroupsFirstPerson();
    this.root.add(this.groups.sword, this.groups.shield, this.groups.bow);
    camera.add(this.root);
    this.root.visible = false;
  }

  /**
   * Authoritative pose from snapshot; bow charge / block use local input when
   * available so the view stays responsive between server ticks.
   */
  sync(me: SnapshotPlayer, combat: CombatInput | null): void {
    const weapon = normalizeWeaponKind(combat?.weapon ?? me.weapon);
    const blocking =
      weapon === "shield" && (combat?.getBlocking() ?? me.blocking);
    const bowCharge =
      weapon === "bow" && combat !== null
        ? combat.getBowChargeVisual()
        : me.bowCharge;

    setWeaponVisible(
      this.groups.sword,
      this.groups.shield,
      this.groups.bow,
      weapon,
    );
    animateWeaponGroups(this.groups.sword, this.groups.shield, this.groups.bow, {
      weapon,
      swingT: me.swingT,
      blocking,
      bowCharge,
    });
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  dispose(camera: PerspectiveCamera): void {
    camera.remove(this.root);
  }
}
