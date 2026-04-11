import { Clock, Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { horizontalYawFromCamera } from "../combat/constants";
import type { MultiplayerClient } from "../net/multiplayer";
import type {
  InventoryEntry,
  MainHandKind,
  MoneyLeaderboardEntry,
  OffHandKind,
  SnapshotMob,
  SnapshotMsg,
  SnapshotPlayer,
} from "../net/types";
import { mainHandIsSword } from "../net/types";
import { CombatInput } from "../player/CombatInput";
import { FirstPersonControls } from "../player/FirstPersonControls";
import { buildDesertScene, type DesertWorld } from "../scene/DesertScene";
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
import { PlayerChatHud } from "./PlayerChatHud";
import { WorldPickups } from "./WorldPickups";
import {
  nearestShopIndex,
  SHOP_SELL_OFFERS,
  shopCatalogForSafeZoneIndex,
} from "../world/shops";
import { isAdvancedShopSafeZoneIndex } from "../world/spawnSafeZone";
import { HitChunkParticles } from "./HitChunkParticles";
import { MinimapHud } from "./MinimapHud";
import { ScreenJuice } from "./ScreenJuice";

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
  /** Proximity chat container (`#hud-chat`); multiplayer only. */
  chatHud?: HTMLElement;
  /** Server richest list (`#hud-money-lb`); multiplayer only. */
  moneyLeaderboardEl?: HTMLElement;
  /** When true, chat hotkey is ignored (e.g. death screen). */
  isChatBlocked?: () => boolean;
  /** Red edge vignette (`#hud-hurt`). */
  hurtOverlay?: HTMLElement;
  /** Fullscreen layer for incoming damage numbers. */
  incomingFloatRoot?: HTMLElement;
  /** Top-down minimap canvas (`#hud-minimap`). */
  minimapCanvas?: HTMLCanvasElement;
  /** Global server announcements (`#hud-announcements`). */
  announcementRoot?: HTMLElement;
  /** Pause/settings dialog root. */
  pausePanel?: HTMLElement;
  /** Full paged leaderboard overlay root. */
  leaderboardPanel?: HTMLElement;
  /** Return to main menu from in-game UI. */
  onReturnToMenu?: () => void;
}

type HudVisibilitySettingKey =
  | "minimap"
  | "leaderboard"
  | "compass"
  | "coords"
  | "combatHud"
  | "announcements"
  | "bottomHint";

interface HudVisibilitySettings {
  minimap: boolean;
  leaderboard: boolean;
  compass: boolean;
  coords: boolean;
  combatHud: boolean;
  announcements: boolean;
  bottomHint: boolean;
}

const HUD_SETTINGS_KEY = "vibeme2.hudSettings";
const COMPACT_LEADERBOARD_ROWS = 10;
const FULL_LEADERBOARD_PAGE_SIZE = 12;

function defaultHudVisibilitySettings(): HudVisibilitySettings {
  return {
    minimap: true,
    leaderboard: true,
    compass: true,
    coords: true,
    combatHud: true,
    announcements: true,
    bottomHint: true,
  };
}

function loadHudVisibilitySettings(): HudVisibilitySettings {
  const fallback = defaultHudVisibilitySettings();
  try {
    const raw = window.localStorage.getItem(HUD_SETTINGS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<HudVisibilitySettings>;
    return {
      minimap: parsed.minimap ?? fallback.minimap,
      leaderboard: parsed.leaderboard ?? fallback.leaderboard,
      compass: parsed.compass ?? fallback.compass,
      coords: parsed.coords ?? fallback.coords,
      combatHud: parsed.combatHud ?? fallback.combatHud,
      announcements: parsed.announcements ?? fallback.announcements,
      bottomHint: parsed.bottomHint ?? fallback.bottomHint,
    };
  } catch {
    return fallback;
  }
}

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly hudHint?: HTMLElement;
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
  private readonly moneyLeaderboardRoot?: HTMLElement;
  private readonly localPlayerId?: string;
  private lastMobs: readonly SnapshotMob[] = [];
  private localPlayerSnapshot: SnapshotPlayer | null = null;
  private multiplayer: MultiplayerClient | null = null;
  private readonly shopPanel?: HTMLElement;
  private readonly coordsEl?: HTMLElement;
  private readonly chatHud: PlayerChatHud | null;
  private readonly moneyLeaderboardList?: HTMLElement;
  private readonly world: DesertWorld;
  private readonly minimapHud: MinimapHud | null;
  private readonly screenJuice: ScreenJuice | null;
  private readonly hitParticles: HitChunkParticles | null;
  private readonly announcementRoot?: HTMLElement;
  private readonly pausePanel?: HTMLElement;
  private readonly leaderboardPanel?: HTMLElement;
  private readonly onReturnToMenu?: () => void;
  private readonly announcementTimers: number[] = [];
  private readonly pauseSettingInputs = new Map<
    HudVisibilitySettingKey,
    HTMLInputElement
  >();
  private readonly leaderboardListEl?: HTMLOListElement;
  private readonly leaderboardPageEl?: HTMLElement;
  private readonly leaderboardPrevBtn?: HTMLButtonElement;
  private readonly leaderboardNextBtn?: HTMLButtonElement;
  private hudVisibility = loadHudVisibilitySettings();
  private moneyLeaderboardRows: readonly MoneyLeaderboardEntry[] = [];
  private shopRenderKey: string | null = null;
  private deathUiActive = false;
  private pauseOpen = false;
  private chatComposeOpen = false;
  private leaderboardHeldOpen = false;
  private leaderboardPage = 0;
  private deathRigSnapshot: SnapshotPlayer | null = null;
  private weaponFlashUntil = 0;
  private lastWeaponMain: MainHandKind | undefined;
  private lastWeaponOff: OffHandKind | null | undefined;
  private shopOpen = false;
  private shopAtIndex: number | null = null;
  private readonly onDocKeydown = (e: KeyboardEvent): void => {
    if (e.code === "Tab") {
      if (
        !e.repeat &&
        !this.deathUiActive &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        this.leaderboardHeldOpen = true;
        this.updateLeaderboardPanelVisibility();
      }
      return;
    }
    if (e.code === "Escape") {
      if (this.shopOpen) {
        e.preventDefault();
        this.closeShopPanel();
        return;
      }
      if (this.pauseOpen) {
        e.preventDefault();
        this.resumeFromPause();
      }
      return;
    }
    if (
      this.isLeaderboardOverlayVisible() &&
      (e.code === "ArrowRight" ||
        e.code === "PageDown" ||
        e.code === "ArrowLeft" ||
        e.code === "PageUp")
    ) {
      e.preventDefault();
      this.changeLeaderboardPage(
        e.code === "ArrowRight" || e.code === "PageDown" ? 1 : -1,
      );
      return;
    }
    if (e.code !== "KeyE") return;
    if (document.pointerLockElement !== this.canvas) return;
    if (this.pauseOpen || this.chatComposeOpen || this.deathUiActive) return;
    e.preventDefault();
    this.toggleShopPanel();
  };
  private readonly onDocKeyup = (e: KeyboardEvent): void => {
    if (e.code !== "Tab") return;
    this.leaderboardHeldOpen = false;
    this.updateLeaderboardPanelVisibility();
  };
  private readonly onPointerLockChange = (): void => {
    if (document.pointerLockElement === this.canvas) {
      return;
    }
    if (
      this.disposed ||
      this.pauseOpen ||
      this.shopOpen ||
      this.chatComposeOpen ||
      this.deathUiActive
    ) {
      return;
    }
    this.openPauseMenu();
  };
  private animationId: number | null = null;
  private disposed = false;

  constructor(options: GameOptions) {
    this.canvas = options.canvas;
    this.hudHint = options.hudHint;

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
    this.world = world;

    this.controls = new FirstPersonControls({
      camera: this.camera,
      domElement: this.canvas,
      world,
      hudHint: options.hudHint,
      safeZoneHint: options.safeZoneHint,
      creativeHint: options.creativeHint,
      getPlayerTeam:
        options.localPlayerId !== undefined
          ? () => this.multiplayer?.team ?? null
          : undefined,
    });
    this.controls.setSpawn(world.spawn);

    this.localPlayerId = options.localPlayerId;
    this.hudCombat = options.hudCombat;
    this.moneyLeaderboardRoot = options.moneyLeaderboardEl;
    this.remotePlayers =
      options.localPlayerId !== undefined
        ? new RemotePlayers(this.scene, options.localPlayerId)
        : null;
    this.worldArrows =
      options.localPlayerId !== undefined ? new WorldArrows(this.scene) : null;
    this.worldPickups =
      options.localPlayerId !== undefined ? new WorldPickups(this.scene) : null;
    this.hitParticles =
      options.localPlayerId !== undefined
        ? new HitChunkParticles(this.scene, (x, z) =>
            world.sampleGroundHeight(x, z),
          )
        : null;
    this.worldMobs =
      options.localPlayerId !== undefined
        ? new WorldMobs(
            this.scene,
            this.camera,
            options.localPlayerId,
            this.hitParticles,
          )
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
    if (
      options.chatHud !== undefined &&
      options.localPlayerId !== undefined &&
      options.isChatBlocked !== undefined
    ) {
      this.chatHud = new PlayerChatHud({
        root: options.chatHud,
        isBlocked: options.isChatBlocked,
        onComposeOpen: () => {
          this.chatComposeOpen = true;
          this.applyInputSuppression();
          void document.exitPointerLock();
        },
        onComposeClose: () => {
          this.chatComposeOpen = false;
          this.applyInputSuppression();
        },
        onSend: (text: string) => {
          this.multiplayer?.sendChat(text);
        },
      });
    } else {
      this.chatHud = null;
    }
    if (this.coordsEl) {
      this.coordsEl.classList.remove("hidden");
    }
    this.moneyLeaderboardList =
      options.moneyLeaderboardEl?.querySelector("[data-money-lb]") ?? undefined;
    if (options.moneyLeaderboardEl !== undefined && options.localPlayerId !== undefined) {
      options.moneyLeaderboardEl.classList.remove("hidden");
    }

    this.minimapHud =
      options.minimapCanvas !== undefined && options.localPlayerId !== undefined
        ? new MinimapHud(options.minimapCanvas, world.worldHalfSize)
        : null;
    this.minimapHud?.setVisible(true);

    this.screenJuice =
      options.hurtOverlay !== undefined &&
      options.incomingFloatRoot !== undefined &&
      options.localPlayerId !== undefined
        ? new ScreenJuice({
            hurtOverlay: options.hurtOverlay,
            floatRoot: options.incomingFloatRoot,
          })
        : null;
    this.announcementRoot = options.announcementRoot;
    this.pausePanel = options.pausePanel;
    this.leaderboardPanel = options.leaderboardPanel;
    this.onReturnToMenu = options.onReturnToMenu;
    const leaderboardList = options.leaderboardPanel?.querySelector(
      "[data-leaderboard-list]",
    );
    this.leaderboardListEl =
      leaderboardList instanceof HTMLOListElement ? leaderboardList : undefined;
    const leaderboardPage = options.leaderboardPanel?.querySelector(
      "[data-leaderboard-page]",
    );
    this.leaderboardPageEl =
      leaderboardPage instanceof HTMLElement ? leaderboardPage : undefined;
    const leaderboardPrev = options.leaderboardPanel?.querySelector(
      "[data-leaderboard-prev]",
    );
    this.leaderboardPrevBtn =
      leaderboardPrev instanceof HTMLButtonElement
        ? leaderboardPrev
        : undefined;
    const leaderboardNext = options.leaderboardPanel?.querySelector(
      "[data-leaderboard-next]",
    );
    this.leaderboardNextBtn =
      leaderboardNext instanceof HTMLButtonElement
        ? leaderboardNext
        : undefined;

    if (this.pausePanel) {
      for (const input of this.pausePanel.querySelectorAll<HTMLInputElement>(
        "input[data-setting]",
      )) {
        const key = input.dataset.setting as HudVisibilitySettingKey | undefined;
        if (!key) continue;
        this.pauseSettingInputs.set(key, input);
        input.addEventListener("change", () => {
          this.setHudVisibility(key, input.checked);
        });
      }
      const resumeBtn = this.pausePanel.querySelector("#pause-resume");
      if (resumeBtn instanceof HTMLButtonElement) {
        resumeBtn.addEventListener("click", () => this.resumeFromPause());
      }
      const menuBtn = this.pausePanel.querySelector("#pause-menu");
      if (menuBtn instanceof HTMLButtonElement) {
        menuBtn.addEventListener("click", () => this.returnToMenu());
      }
    }
    this.leaderboardPrevBtn?.addEventListener("click", () => {
      this.changeLeaderboardPage(-1);
    });
    this.leaderboardNextBtn?.addEventListener("click", () => {
      this.changeLeaderboardPage(1);
    });
    this.syncPauseMenuControls();
    this.applyHudVisibilitySettings();
    this.renderLeaderboardPanel();

    if (this.shopPanel) {
      const closeBtn = this.shopPanel.querySelector("[data-shop-close]");
      if (closeBtn instanceof HTMLButtonElement) {
        closeBtn.addEventListener("click", () => this.closeShopPanel());
      }
    }

    this.resizeHandler = (): void => this.handleResize();
    window.addEventListener("resize", this.resizeHandler);
    document.addEventListener("keydown", this.onDocKeydown);
    document.addEventListener("keyup", this.onDocKeyup);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
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
    const dyingNow =
      id !== undefined && (msg.deaths?.includes(id) ?? false);
    const prevSnap = this.localPlayerSnapshot;

    this.localPlayerSnapshot =
      id !== undefined
        ? (players.find((p) => p.id === id) ?? null)
        : null;

    if (
      prevSnap !== null &&
      this.localPlayerSnapshot !== null &&
      this.localPlayerSnapshot.hp < prevSnap.hp
    ) {
      this.controls.addDamageShake(prevSnap.hp - this.localPlayerSnapshot.hp);
      const me = this.localPlayerSnapshot;
      this.hitParticles?.burst(me.x, me.y - 0.28, me.z, "hurt");
    }

    if (dyingNow && prevSnap !== null) {
      if (this.shopOpen) this.closeShopPanel();
      this.pauseOpen = false;
      this.pausePanel?.classList.add("hidden");
      this.leaderboardHeldOpen = false;
      this.deathUiActive = true;
      this.deathRigSnapshot = prevSnap;
      this.applyInputSuppression();
      this.updateLeaderboardPanelVisibility();
      this.controls.beginDeathCamera();
      this.combatInput?.setDeathLocked(true);
    }

    if (this.localPlayerSnapshot !== null) {
      if (prevSnap === null) {
        this.controls.syncAuthoritativePose(this.localPlayerSnapshot);
      } else if (!this.deathUiActive) {
        this.controls.reconcileAuthoritativePose(this.localPlayerSnapshot);
      }
    }

    if (this.localPlayerSnapshot) {
      this.combatInput?.syncFromSnapshot(this.localPlayerSnapshot);
    }
    this.remotePlayers?.applySnapshot(players);
    this.worldArrows?.sync(arrows);
    this.worldPickups?.sync(msg.pickups ?? []);
    this.worldMobs?.sync(mobs, msg.damageFloats);
    this.lastMobs = mobs;
    this.chatHud?.mergeFromSnapshot(msg.chat);
    for (const text of msg.announcements ?? []) {
      this.pushAnnouncement(text);
    }
    this.updateMoneyLeaderboard(msg.moneyLeaderboard ?? []);
    this.updateCombatHud(players);

    if (id !== undefined && this.localPlayerSnapshot) {
      const me = this.localPlayerSnapshot;
      this.screenJuice?.syncFromSnapshot(
        id,
        me.x,
        me.z,
        me.hp,
        msg.damageFloats,
      );
    }
  }

  revive(): void {
    if (this.disposed) return;
    this.deathUiActive = false;
    this.deathRigSnapshot = null;
    this.controls.endDeathCamera();
    if (this.localPlayerSnapshot !== null) {
      this.controls.syncAuthoritativePose(this.localPlayerSnapshot);
    }
    this.combatInput?.setDeathLocked(false);
    this.applyInputSuppression();
    if (this.localPlayerSnapshot !== null) {
      this.combatInput?.syncFromSnapshot(this.localPlayerSnapshot);
    }
  }

  private updateMoneyLeaderboard(rows: readonly MoneyLeaderboardEntry[]): void {
    this.moneyLeaderboardRows = rows;
    if (this.leaderboardPage >= this.totalLeaderboardPages()) {
      this.leaderboardPage = Math.max(0, this.totalLeaderboardPages() - 1);
    }
    this.renderLeaderboardPanel();
    const list = this.moneyLeaderboardList;
    if (!list) return;
    list.replaceChildren();
    if (rows.length === 0) {
      const p = document.createElement("p");
      p.className = "hud-money-lb-empty";
      p.textContent = "No rankings yet";
      list.appendChild(p);
      return;
    }
    for (let i = 0; i < Math.min(COMPACT_LEADERBOARD_ROWS, rows.length); i++) {
      const r = rows[i];
      const li = document.createElement("li");
      li.className = "hud-money-lb-row";
      const rank = document.createElement("span");
      rank.className = "hud-money-lb-rank";
      rank.textContent = String(i + 1);
      const dot = document.createElement("span");
      dot.className = `hud-money-lb-dot hud-money-lb-dot--${r.team}`;
      const name = document.createElement("span");
      name.className = "hud-money-lb-name";
      name.textContent = r.nickname;
      name.title = r.nickname;
      const g = document.createElement("span");
      g.className = "hud-money-lb-gold";
      g.textContent = `${r.gold}g`;
      li.append(rank, dot, name, g);
      list.appendChild(li);
    }
  }

  private updateCombatHud(players: SnapshotMsg["players"]): void {
    const el = this.hudCombat;
    const id = this.localPlayerId;
    if (!el || !id) return;
    const me = players.find((p) => p.id === id);
    if (!me) return;
    el.classList.toggle("hidden", !this.hudVisibility.combatHud);
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
      this.maybeRenderShopOffers(me, this.shopAtIndex);
    }

    if (
      this.lastWeaponMain !== undefined &&
      (mainHand !== this.lastWeaponMain || offHand !== this.lastWeaponOff)
    ) {
      this.weaponFlashUntil = performance.now() + 420;
    }
    this.lastWeaponMain = mainHand;
    this.lastWeaponOff = offHand;
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
    this.shopRenderKey = null;
    this.shopPanel.classList.remove("hidden");
    this.applyInputSuppression();
    void document.exitPointerLock();
    const me = this.localPlayerSnapshot;
    if (me) this.maybeRenderShopOffers(me, this.shopAtIndex);
  }

  private closeShopPanel(): void {
    this.shopOpen = false;
    this.shopAtIndex = null;
    this.shopRenderKey = null;
    this.shopPanel?.classList.add("hidden");
    this.applyInputSuppression();
  }

  private maybeRenderShopOffers(me: SnapshotPlayer, shopIndex: number): void {
    const nextKey = shopRenderKey(me, shopIndex);
    if (this.shopRenderKey === nextKey) return;
    this.shopRenderKey = nextKey;
    this.renderShopOffers(me, shopIndex);
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
      this.hitParticles?.update(delta);
      this.screenJuice?.update(delta);
      const wBar = this.hudCombat?.querySelector(".weapon-bar");
      if (wBar instanceof HTMLElement) {
        wBar.classList.toggle(
          "weapon-bar--flash",
          performance.now() < this.weaponFlashUntil,
        );
      }
      const eye = this.controls.getNetworkPose();
      const coordsHud = this.coordsEl;
      if (coordsHud) {
        const fmt = (v: number): string => v.toFixed(1);
        coordsHud.textContent = `x ${fmt(eye.x)}, y ${fmt(eye.y)}, z ${fmt(eye.z)}`;
      }
      this.chatHud?.update();
      this.compassHud?.update(
        horizontalYawFromCamera(this.camera),
        eye.x,
        eye.z,
        this.lastMobs,
      );
      if (this.localPlayerId) {
        this.minimapHud?.update(
          eye.x,
          eye.z,
          horizontalYawFromCamera(this.camera),
          this.lastMobs,
        );
      }
      const thirdShow = this.controls.shouldShowThirdPersonRig;
      if (
        this.firstPersonWeapon &&
        this.localPlayerSnapshot &&
        this.combatInput &&
        !this.deathUiActive
      ) {
        this.firstPersonWeapon.sync(this.localPlayerSnapshot, this.combatInput);
        this.firstPersonWeapon.setVisible(!thirdShow);
      } else {
        this.firstPersonWeapon?.setVisible(false);
      }
      if (this.deathUiActive && this.deathRigSnapshot && this.localThirdPersonRig) {
        this.localThirdPersonRig.visible = true;
        const pose = this.controls.getNetworkPose();
        const frozen = this.deathRigSnapshot;
        const p: SnapshotPlayer = {
          ...frozen,
          x: pose.x,
          y: pose.y,
          z: pose.z,
          yaw: pose.yaw,
          pitch: pose.pitch,
        };
        const gy = this.world.sampleGroundHeight(pose.x, pose.z);
        updatePlayerAvatarRig(this.localThirdPersonRig, p, {
          viewCamera: this.camera,
          lieDead: true,
          groundFeetY: gy,
        });
      } else if (
        thirdShow &&
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
      if (!this.deathUiActive) {
        this.meleeHitboxVisual?.update(
          this.controls.getNetworkPose(),
          this.localPlayerSnapshot,
          this.combatInput,
        );
      }
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
    document.removeEventListener("keyup", this.onDocKeyup);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.multiplayer?.dispose();
    this.multiplayer = null;
    this.remotePlayers?.dispose();
    this.worldArrows?.dispose();
    this.worldPickups?.dispose();
    this.worldMobs?.dispose();
    this.compassHud?.dispose();
    this.chatHud?.dispose();
    this.minimapHud?.dispose();
    this.screenJuice?.dispose();
    this.hitParticles?.dispose();
    for (const timer of this.announcementTimers) {
      window.clearTimeout(timer);
    }
    this.announcementTimers.length = 0;
    this.announcementRoot?.replaceChildren();
    this.pausePanel?.classList.add("hidden");
    this.leaderboardPanel?.classList.add("hidden");
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

  isChatBlocked(): boolean {
    return this.deathUiActive || this.pauseOpen || this.shopOpen;
  }

  private applyInputSuppression(): void {
    const blocked =
      this.deathUiActive || this.pauseOpen || this.shopOpen || this.chatComposeOpen;
    this.controls.setInputSuppressed(blocked);
    this.combatInput?.setChatSuppressed(blocked);
  }

  private openPauseMenu(): void {
    if (this.pauseOpen || this.deathUiActive) return;
    this.pauseOpen = true;
    this.pausePanel?.classList.remove("hidden");
    this.applyInputSuppression();
    this.updateLeaderboardPanelVisibility();
  }

  private resumeFromPause(): void {
    if (!this.pauseOpen) return;
    this.pauseOpen = false;
    this.pausePanel?.classList.add("hidden");
    this.applyInputSuppression();
    this.updateLeaderboardPanelVisibility();
    void this.controls.controls.lock();
  }

  private returnToMenu(): void {
    this.pauseOpen = false;
    this.pausePanel?.classList.add("hidden");
    this.onReturnToMenu?.();
  }

  private setHudVisibility(
    key: HudVisibilitySettingKey,
    visible: boolean,
  ): void {
    this.hudVisibility = { ...this.hudVisibility, [key]: visible };
    this.syncPauseMenuControls();
    this.applyHudVisibilitySettings();
    try {
      window.localStorage.setItem(
        HUD_SETTINGS_KEY,
        JSON.stringify(this.hudVisibility),
      );
    } catch {
      /* ignore storage failures */
    }
  }

  private syncPauseMenuControls(): void {
    for (const [key, input] of this.pauseSettingInputs) {
      input.checked = this.hudVisibility[key];
    }
  }

  private applyHudVisibilitySettings(): void {
    this.minimapHud?.setVisible(this.hudVisibility.minimap);
    this.compassHud?.setVisible(this.hudVisibility.compass);
    this.moneyLeaderboardRoot?.classList.toggle(
      "hidden",
      !this.hudVisibility.leaderboard,
    );
    this.coordsEl?.classList.toggle("hidden", !this.hudVisibility.coords);
    this.hudCombat?.classList.toggle("hidden", !this.hudVisibility.combatHud);
    this.announcementRoot?.classList.toggle(
      "hidden",
      !this.hudVisibility.announcements,
    );
    if (this.hudHint) {
      this.hudHint.style.display = this.hudVisibility.bottomHint ? "" : "none";
    }
  }

  private totalLeaderboardPages(): number {
    return Math.max(
      1,
      Math.ceil(this.moneyLeaderboardRows.length / FULL_LEADERBOARD_PAGE_SIZE),
    );
  }

  private changeLeaderboardPage(delta: number): void {
    const pages = this.totalLeaderboardPages();
    this.leaderboardPage = Math.max(
      0,
      Math.min(pages - 1, this.leaderboardPage + delta),
    );
    this.renderLeaderboardPanel();
  }

  private isLeaderboardOverlayVisible(): boolean {
    return this.pauseOpen || this.leaderboardHeldOpen;
  }

  private updateLeaderboardPanelVisibility(): void {
    this.leaderboardPanel?.classList.toggle(
      "hidden",
      !this.isLeaderboardOverlayVisible(),
    );
  }

  private renderLeaderboardPanel(): void {
    this.updateLeaderboardPanelVisibility();
    const list = this.leaderboardListEl;
    if (!list) return;
    list.replaceChildren();
    const pages = this.totalLeaderboardPages();
    const start = this.leaderboardPage * FULL_LEADERBOARD_PAGE_SIZE;
    const slice = this.moneyLeaderboardRows.slice(
      start,
      start + FULL_LEADERBOARD_PAGE_SIZE,
    );
    if (this.leaderboardPageEl) {
      this.leaderboardPageEl.textContent = `Page ${this.leaderboardPage + 1} / ${pages}`;
    }
    this.leaderboardPrevBtn?.toggleAttribute("disabled", this.leaderboardPage <= 0);
    this.leaderboardNextBtn?.toggleAttribute(
      "disabled",
      this.leaderboardPage >= pages - 1,
    );
    if (slice.length === 0) {
      const li = document.createElement("li");
      li.className = "leaderboard-panel__row";
      li.textContent = "No rankings yet";
      list.appendChild(li);
      return;
    }
    for (let i = 0; i < slice.length; i += 1) {
      const row = slice[i];
      const li = document.createElement("li");
      li.className = "leaderboard-panel__row";
      const rank = document.createElement("span");
      rank.className = "leaderboard-panel__rank";
      rank.textContent = String(start + i + 1);
      const dot = document.createElement("span");
      dot.className = `hud-money-lb-dot hud-money-lb-dot--${row.team}`;
      const name = document.createElement("span");
      name.className = "leaderboard-panel__name";
      name.textContent = row.nickname;
      const gold = document.createElement("span");
      gold.className = "leaderboard-panel__gold";
      gold.textContent = `${row.gold}g`;
      li.append(rank, dot, name, gold);
      list.appendChild(li);
    }
  }

  private pushAnnouncement(text: string): void {
    if (!this.announcementRoot || text.trim().length === 0) return;
    const row = document.createElement("div");
    row.className = "hud-announcement";
    row.textContent = text;
    this.announcementRoot.appendChild(row);
    const timer = window.setTimeout(() => {
      row.classList.add("hud-announcement--hide");
      const cleanup = window.setTimeout(() => {
        row.remove();
      }, 220);
      this.announcementTimers.push(cleanup);
    }, 4200);
    this.announcementTimers.push(timer);
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

function shopRenderKey(me: SnapshotPlayer, shopIndex: number): string {
  const inventory = me.inventory
    .map((entry) => `${entry.kind}:${entry.count}`)
    .sort()
    .join("|");
  return `${shopIndex}/${me.gold}/${me.bossUnlock ? 1 : 0}/${inventory}`;
}
