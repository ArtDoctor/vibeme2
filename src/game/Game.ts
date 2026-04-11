import { Clock, Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { horizontalYawFromCamera } from "../combat/constants";
import type { MultiplayerClient } from "../net/multiplayer";
import type { InventoryEntry, SnapshotMob, SnapshotMsg, SnapshotPlayer } from "../net/types";
import { mainHandIsSword } from "../net/types";
import { CombatInput } from "../player/CombatInput";
import { FirstPersonControls } from "../player/FirstPersonControls";
import { buildDesertScene } from "../scene/DesertScene";
import { FirstPersonWeapon } from "./FirstPersonWeapon";
import { MeleeHitboxVisual } from "./MeleeHitboxVisual";
import {
  createPlayerAvatarRig,
  RemotePlayers,
  updatePlayerAvatarRig,
} from "./RemotePlayers";
import { WorldArrows } from "./WorldArrows";
import { WorldMobs } from "./WorldMobs";
import { CompassHud } from "./CompassHud";
import { WorldPickups } from "./WorldPickups";
import {
  nearestShopIndex,
  SHOP_SELL_OFFERS,
  shopCatalogForSafeZoneIndex,
} from "../world/shops";
import { isAdvancedShopSafeZoneIndex } from "../world/spawnSafeZone";

/**
 * Owns the renderer, scene, camera, animation loop, resize handler, and dispose.
 *
 * Intentionally thin: it wires modules together and pumps the loop. Level
 * geometry lives in scene/, movement lives in player/. Adding a new system
 * (mobs, networking, UI overlays) means adding a module and calling its
 * update + dispose from here — not editing the scene file.
 */
export interface GameOptions {
  canvas: HTMLCanvasElement;
  hudHint?: HTMLElement;
  safeZoneHint?: HTMLElement;
  creativeHint?: HTMLElement;
  /** HP / stamina / gold (multiplayer). */
  hudCombat?: HTMLElement;
  /** When set, other players are rendered for this connection. */
  localPlayerId?: string;
  /** Top compass and nearby mob indicators (multiplayer). */
  compassEl?: HTMLElement;
  /** Buy UI (Milestone 4 shops). */
  shopPanel?: HTMLElement;
  /** World position x, y, z (top-right). */
  coordsEl?: HTMLElement;
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene: Scene;
  private readonly camera: PerspectiveCamera;
  private readonly clock = new Clock();
  private readonly controls: FirstPersonControls;
  private readonly combatInput: CombatInput | null;
  private readonly firstPersonWeapon: FirstPersonWeapon | null;
  private readonly meleeHitboxVisual: MeleeHitboxVisual | null;
  private readonly resizeHandler: () => void;
  private readonly remotePlayers: RemotePlayers | null;
  private readonly worldArrows: WorldArrows | null;
  private readonly worldPickups: WorldPickups | null;
  private readonly worldMobs: WorldMobs | null;
  private readonly compassHud: CompassHud | null;
  private readonly localThirdPersonRig: Group | null;
  private readonly hudCombat?: HTMLElement;
  private readonly localPlayerId?: string;
  private lastMobs: readonly SnapshotMob[] = [];
  private localPlayerSnapshot: SnapshotPlayer | null = null;
  private multiplayer: MultiplayerClient | null = null;
  private readonly shopPanel?: HTMLElement;
  private readonly coordsEl?: HTMLElement;
  private shopOpen = false;
  private shopAtIndex: number | null = null;
  private readonly onDocKeydown = (e: KeyboardEvent): void => {
    if (e.code !== "KeyE") return;
    if (document.pointerLockElement !== this.canvas) return;
    e.preventDefault();
    this.toggleShopPanel();
  };
  private animationId: number | null = null;
  private disposed = false;

  constructor(options: GameOptions) {
    this.canvas = options.canvas;

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);

    this.scene = new Scene();

    this.camera = new PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.05,
      400,
    );
    /** Required so meshes parented to the camera (first-person weapons) render. */
    this.scene.add(this.camera);

    const world = buildDesertScene(this.scene);

    this.controls = new FirstPersonControls({
      camera: this.camera,
      domElement: this.canvas,
      world,
      hudHint: options.hudHint,
      safeZoneHint: options.safeZoneHint,
      creativeHint: options.creativeHint,
    });
    this.controls.setSpawn(world.spawn);

    this.localPlayerId = options.localPlayerId;
    this.hudCombat = options.hudCombat;
    this.remotePlayers =
      options.localPlayerId !== undefined
        ? new RemotePlayers(this.scene, options.localPlayerId)
        : null;
    this.worldArrows =
      options.localPlayerId !== undefined ? new WorldArrows(this.scene) : null;
    this.worldPickups =
      options.localPlayerId !== undefined ? new WorldPickups(this.scene) : null;
    this.worldMobs =
      options.localPlayerId !== undefined
        ? new WorldMobs(this.scene, this.camera, options.localPlayerId)
        : null;
    this.combatInput =
      options.localPlayerId !== undefined
        ? new CombatInput(this.canvas, () => this.controls.controls.isLocked)
        : null;
    this.firstPersonWeapon =
      this.combatInput !== null
        ? new FirstPersonWeapon(this.camera)
        : null;
    this.meleeHitboxVisual =
      this.combatInput !== null
        ? new MeleeHitboxVisual(this.scene)
        : null;

    if (options.localPlayerId !== undefined) {
      const rig = createPlayerAvatarRig("You");
      rig.visible = false;
      this.scene.add(rig);
      this.localThirdPersonRig = rig;
    } else {
      this.localThirdPersonRig = null;
    }

    if (options.compassEl !== undefined && options.localPlayerId !== undefined) {
      this.compassHud = new CompassHud(options.compassEl);
      this.compassHud.setVisible(true);
    } else {
      this.compassHud = null;
    }

    this.shopPanel = options.shopPanel;
    this.coordsEl = options.coordsEl;
    if (this.coordsEl) {
      this.coordsEl.classList.remove("hidden");
    }
    if (this.shopPanel) {
      const closeBtn = this.shopPanel.querySelector("[data-shop-close]");
      if (closeBtn instanceof HTMLButtonElement) {
        closeBtn.addEventListener("click", () => this.closeShopPanel());
      }
    }

    this.resizeHandler = (): void => this.handleResize();
    window.addEventListener("resize", this.resizeHandler);
    document.addEventListener("keydown", this.onDocKeydown);
    // Trigger once so we match whatever the initial canvas size is.
    this.handleResize();
  }

  /** Wire authoritative snapshots + outbound pose after `MultiplayerClient.connect`. */
  attachMultiplayer(client: MultiplayerClient): void {
    if (this.disposed) return;
    this.multiplayer = client;
    if (!this.combatInput) {
      client.startSending(() => {
        const pose = this.controls.getNetworkPose();
        return {
          x: pose.x,
          y: pose.y,
          z: pose.z,
          yaw: pose.yaw,
          pitch: pose.pitch,
          creative: pose.creative,
          flying: pose.flying,
          sprinting: pose.sprinting,
          mainHand: "woodenSword" as const,
          offHand: null,
          blocking: false,
          bowCharge: 0,
          swing: false,
          fireArrow: false,
        };
      });
      return;
    }
    const combatInput = this.combatInput;
    client.startSending(() => {
      const pose = this.controls.getNetworkPose();
      const c = combatInput.consumeOutbound();
      return {
        x: pose.x,
        y: pose.y,
        z: pose.z,
        yaw: pose.yaw,
        pitch: pose.pitch,
        creative: pose.creative,
        flying: pose.flying,
        sprinting: pose.sprinting,
        mainHand: c.mainHand,
        offHand: c.offHand,
        blocking: c.blocking,
        bowCharge: c.bowCharge,
        swing: c.swing,
        fireArrow: c.fireArrow,
      };
    });
  }

  applyRemoteSnapshot(msg: SnapshotMsg): void {
    if (this.disposed) return;
    const players = msg.players;
    const arrows = msg.arrows ?? [];
    const mobs = msg.mobs ?? [];
    const id = this.localPlayerId;
    this.localPlayerSnapshot =
      id !== undefined
        ? (players.find((p) => p.id === id) ?? null)
        : null;
    if (this.localPlayerSnapshot) {
      this.combatInput?.syncFromSnapshot(this.localPlayerSnapshot);
    }
    this.remotePlayers?.applySnapshot(players);
    this.worldArrows?.sync(arrows);
    this.worldPickups?.sync(msg.pickups ?? []);
    this.worldMobs?.sync(mobs, msg.damageFloats);
    this.lastMobs = mobs;
    this.updateCombatHud(players);
  }

  private updateCombatHud(players: SnapshotMsg["players"]): void {
    const el = this.hudCombat;
    const id = this.localPlayerId;
    if (!el || !id) return;
    const me = players.find((p) => p.id === id);
    if (!me) return;
    el.classList.remove("hidden");
    const hpEl = el.querySelector("[data-hp]");
    const stEl = el.querySelector("[data-stamina]");
    const gEl = el.querySelector("[data-gold]");
    const mainHandEl = el.querySelector("[data-main-hand]");
    const offHandEl = el.querySelector("[data-off-hand]");
    const armorEl = el.querySelector("[data-armor]");
    const packSwordEl = el.querySelector("[data-pack-woodenSword]");
    const packIronEl = el.querySelector("[data-pack-ironSword]");
    const packSteelEl = el.querySelector("[data-pack-steelSword]");
    const packVanguardEl = el.querySelector("[data-pack-vanguardSword]");
    const packShieldEl = el.querySelector("[data-pack-basicShield]");
    const packBowEl = el.querySelector("[data-pack-shortBow]");
    const packArmorEl = el.querySelector("[data-pack-armor]");
    if (hpEl) hpEl.textContent = String(Math.round(me.hp));
    if (stEl) stEl.textContent = String(Math.round(me.stamina));
    if (gEl) gEl.textContent = String(me.gold);
    const mainHand =
      this.combatInput != null ? this.combatInput.getCurrentMainHand() : me.mainHand;
    const offHand =
      this.combatInput != null ? this.combatInput.getCurrentOffHand() : me.offHand;
    if (mainHandEl) {
      mainHandEl.textContent = formatMainHandLabel(mainHand);
    }
    const bossEl = el.querySelector("[data-boss-unlock]");
    if (bossEl) {
      bossEl.textContent = me.bossUnlock ? "yes" : "no";
    }
    if (offHandEl) {
      offHandEl.textContent = offHand === "basicShield" ? "basic shield" : "none";
    }
    if (armorEl) {
      armorEl.textContent =
        me.armor.head && me.armor.chest && me.armor.legs ? "scout set" : "none";
    }
    for (const node of el.querySelectorAll("[data-weapon-slot]")) {
      if (!(node instanceof HTMLElement)) continue;
      const slot = node.dataset.weaponSlot;
      const active =
        (slot === "sword" && mainHandIsSword(mainHand)) ||
        (slot === "shortBow" && mainHand === "shortBow") ||
        (slot === "basicShield" && offHand === "basicShield");
      const owned =
        slot === "sword"
          ? hasAnyMeleeSword(me.inventory)
          : inventoryCount(me.inventory, slot) > 0;
      node.classList.toggle("weapon-slot--active", active);
      node.classList.toggle("weapon-slot--owned", owned);
      node.classList.toggle("weapon-slot--locked", !owned);
    }
    if (packSwordEl) packSwordEl.textContent = String(inventoryCount(me.inventory, "woodenSword"));
    if (packIronEl) packIronEl.textContent = String(inventoryCount(me.inventory, "ironSword"));
    if (packSteelEl) packSteelEl.textContent = String(inventoryCount(me.inventory, "steelSword"));
    if (packVanguardEl) {
      packVanguardEl.textContent = String(inventoryCount(me.inventory, "vanguardSword"));
    }
    if (packShieldEl) {
      packShieldEl.textContent = String(inventoryCount(me.inventory, "basicShield"));
    }
    if (packBowEl) packBowEl.textContent = String(inventoryCount(me.inventory, "shortBow"));
    if (packArmorEl) {
      packArmorEl.textContent = String(
        Math.min(
          inventoryCount(me.inventory, "scoutHelm"),
          inventoryCount(me.inventory, "scoutChest"),
          inventoryCount(me.inventory, "scoutLegs"),
        ),
      );
    }
    const hpFill = el.querySelector("[data-hp-fill]") as HTMLElement | null;
    const stFill = el.querySelector("[data-stamina-fill]") as HTMLElement | null;
    if (hpFill) hpFill.style.width = `${Math.max(0, Math.min(100, me.hp))}%`;
    if (stFill) stFill.style.width = `${Math.max(0, Math.min(100, me.stamina))}%`;

    if (this.shopOpen && this.shopPanel && this.shopAtIndex !== null) {
      this.renderShopOffers(me, this.shopAtIndex);
    }
  }

  private toggleShopPanel(): void {
    if (!this.shopPanel || !this.multiplayer || !this.localPlayerId) return;
    if (this.shopOpen) {
      this.closeShopPanel();
      return;
    }
    const pose = this.controls.getNetworkPose();
    const near = nearestShopIndex(pose.x, pose.z);
    if (near === null) return;
    this.shopAtIndex = near.index;
    this.shopOpen = true;
    this.shopPanel.classList.remove("hidden");
    void document.exitPointerLock();
    const me = this.localPlayerSnapshot;
    if (me) this.renderShopOffers(me, this.shopAtIndex);
  }

  private closeShopPanel(): void {
    this.shopOpen = false;
    this.shopAtIndex = null;
    this.shopPanel?.classList.add("hidden");
  }

  private renderShopOffers(me: SnapshotPlayer, shopIndex: number): void {
    if (!this.shopPanel || !this.multiplayer) return;
    const titleEl = this.shopPanel.querySelector("#shop-title");
    if (titleEl) {
      titleEl.textContent = isAdvancedShopSafeZoneIndex(shopIndex)
        ? "Corner emporium"
        : "Traveling merchant";
    }
    const subEl = this.shopPanel.querySelector("[data-shop-zone-hint]");
    if (subEl) {
      subEl.textContent = isAdvancedShopSafeZoneIndex(shopIndex)
        ? "Premium steel and vanguard gear."
        : "Iron weapons, shields, bows, and scout armor.";
    }
    const g = this.shopPanel.querySelector("[data-shop-gold]");
    if (g) g.textContent = String(me.gold);
    const list = this.shopPanel.querySelector("[data-shop-list]");
    if (!(list instanceof HTMLUListElement)) return;
    list.replaceChildren();
    for (const offer of shopCatalogForSafeZoneIndex(shopIndex)) {
      const li = document.createElement("li");
      const left = document.createElement("span");
      left.textContent = `${offer.label} — ${offer.price}g`;
      if (offer.needsBoss) {
        left.textContent += me.bossUnlock ? "" : " (boss)";
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Buy";
      const canBoss = !offer.needsBoss || me.bossUnlock;
      btn.disabled = me.gold < offer.price || !canBoss;
      btn.addEventListener("click", () => {
        this.multiplayer?.sendShopBuy(shopIndex, offer.sku);
      });
      li.appendChild(left);
      li.appendChild(btn);
      list.appendChild(li);
    }

    const sellList = this.shopPanel.querySelector("[data-shop-sell-list]");
    if (!(sellList instanceof HTMLUListElement)) return;
    sellList.replaceChildren();
    for (const row of SHOP_SELL_OFFERS) {
      const n = inventoryCount(me.inventory, row.kind);
      if (n <= 0 || row.unitGold <= 0) continue;
      const li = document.createElement("li");
      li.classList.add("shop-sell-row");
      const left = document.createElement("span");
      left.textContent = `${row.label} ×${n} — ${row.unitGold}g ea`;
      const actions = document.createElement("span");
      actions.className = "shop-sell-actions";
      const b1 = document.createElement("button");
      b1.type = "button";
      b1.textContent = "Sell 1";
      b1.addEventListener("click", () => {
        this.multiplayer?.sendShopSell(shopIndex, row.kind, 1);
      });
      const bAll = document.createElement("button");
      bAll.type = "button";
      bAll.textContent = "Sell all";
      bAll.addEventListener("click", () => {
        this.multiplayer?.sendShopSell(shopIndex, row.kind, n);
      });
      actions.appendChild(b1);
      actions.appendChild(bAll);
      li.appendChild(left);
      li.appendChild(actions);
      sellList.appendChild(li);
    }
    if (sellList.children.length === 0) {
      const empty = document.createElement("li");
      empty.classList.add("shop-sell-empty");
      empty.textContent = "Nothing to sell (starter wooden sword has no resale value).";
      sellList.appendChild(empty);
    }
  }

  start(): void {
    if (this.disposed) return;
    const loop = (): void => {
      if (this.disposed) return;
      this.animationId = requestAnimationFrame(loop);
      // Clamp delta so a backgrounded tab can't unleash a huge step on resume.
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.controls.update(delta);
      this.combatInput?.update(delta);
      this.remotePlayers?.update();
      this.worldPickups?.update(delta);
      this.worldMobs?.update(delta);
      const eye = this.controls.getNetworkPose();
      const coordsHud = this.coordsEl;
      if (coordsHud) {
        const fmt = (v: number): string => v.toFixed(1);
        coordsHud.textContent = `x ${fmt(eye.x)}, y ${fmt(eye.y)}, z ${fmt(eye.z)}`;
      }
      this.compassHud?.update(
        horizontalYawFromCamera(this.camera),
        eye.x,
        eye.z,
        this.lastMobs,
      );
      const thirdPerson = this.controls.isThirdPerson;
      if (this.firstPersonWeapon && this.localPlayerSnapshot && this.combatInput) {
        this.firstPersonWeapon.sync(this.localPlayerSnapshot, this.combatInput);
        this.firstPersonWeapon.setVisible(!thirdPerson);
      } else {
        this.firstPersonWeapon?.setVisible(false);
      }
      if (
        thirdPerson &&
        this.localThirdPersonRig &&
        this.localPlayerSnapshot &&
        this.combatInput
      ) {
        this.localThirdPersonRig.visible = true;
        const pose = this.controls.getNetworkPose();
        const c = this.combatInput;
        updatePlayerAvatarRig(
          this.localThirdPersonRig,
          {
            ...this.localPlayerSnapshot,
            x: pose.x,
            y: pose.y,
            z: pose.z,
            yaw: pose.yaw,
            pitch: pose.pitch,
            mainHand: c.getCurrentMainHand(),
            offHand: c.getCurrentOffHand(),
            blocking: c.getBlocking(),
            bowCharge: c.getBowChargeVisual(),
          },
          { viewCamera: this.camera },
        );
      } else if (this.localThirdPersonRig) {
        this.localThirdPersonRig.visible = false;
      }
      this.meleeHitboxVisual?.update(
        this.controls.getNetworkPose(),
        this.localPlayerSnapshot,
        this.combatInput,
      );
      this.renderer.render(this.scene, this.camera);
    };
    this.animationId = requestAnimationFrame(loop);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    window.removeEventListener("resize", this.resizeHandler);
    document.removeEventListener("keydown", this.onDocKeydown);
    this.multiplayer?.dispose();
    this.multiplayer = null;
    this.remotePlayers?.dispose();
    this.worldArrows?.dispose();
    this.worldPickups?.dispose();
    this.worldMobs?.dispose();
    this.compassHud?.dispose();
    this.coordsEl?.classList.add("hidden");
    if (this.localThirdPersonRig) {
      this.scene.remove(this.localThirdPersonRig);
    }
    this.firstPersonWeapon?.dispose(this.camera);
    this.meleeHitboxVisual?.dispose(this.scene);
    this.combatInput?.dispose();
    this.controls.dispose();
    this.scene.remove(this.camera);
    this.renderer.dispose();
  }

  private handleResize(): void {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }
}

function inventoryCount(
  inventory: readonly InventoryEntry[],
  kind: string | undefined,
): number {
  if (!kind) return 0;
  return inventory.find((entry) => entry.kind === kind)?.count ?? 0;
}

function hasAnyMeleeSword(inventory: readonly InventoryEntry[]): boolean {
  return (
    inventoryCount(inventory, "woodenSword") > 0 ||
    inventoryCount(inventory, "ironSword") > 0 ||
    inventoryCount(inventory, "steelSword") > 0 ||
    inventoryCount(inventory, "vanguardSword") > 0
  );
}

function formatMainHandLabel(k: SnapshotPlayer["mainHand"]): string {
  switch (k) {
    case "shortBow":
      return "short bow";
    case "ironSword":
      return "iron sword";
    case "steelSword":
      return "steel sword";
    case "vanguardSword":
      return "vanguard sword";
    default:
      return "wooden sword";
  }
}
