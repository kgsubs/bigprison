const TILE       = 32;
const COLS       = 10;   // cell width
const TOTAL_COLS = 44;   // cell(10) + corridor(14) + mess hall(20)
const ROWS       = 8;
const W          = COLS * TILE;        // 320 — viewport width
const H          = ROWS * TILE;        // 256 — viewport height
const TOTAL_W    = TOTAL_COLS * TILE;  // 1408 — full world width

// Tile types: 0=floor 1=wall 2=cell door 3=double doors 5=exit door (wall until riot)
const MAP = (() => {
  const g = Array.from({ length: ROWS }, () => Array(TOTAL_COLS).fill(1));

  // Cell interior (cols 1-8, rows 1-6)
  for (let r = 1; r <= 6; r++)
    for (let c = 1; c <= 8; c++) g[r][c] = 0;

  // Cell door (right wall, row 4)
  g[4][9] = 2;

  // Corridor floor (rows 3-6, cols 10-22)
  for (let r = 3; r <= 6; r++)
    for (let c = 10; c <= 22; c++) g[r][c] = 0;

  // Double doors (col 23, rows 3-6)
  for (let r = 3; r <= 6; r++) g[r][23] = 3;

  // Mess hall entrance (col 24, rows 3-6)
  for (let r = 3; r <= 6; r++) g[r][24] = 0;

  // Mess hall interior (rows 1-6, cols 25-42)
  for (let r = 1; r <= 6; r++)
    for (let c = 25; c <= 42; c++) g[r][c] = 0;

  // Exit door — solid wall until riot (col 43, rows 3-4)
  g[3][43] = 5;
  g[4][43] = 5;

  return g;
})();

const COLOR_FLOOR       = 0x2a2a2a;
const COLOR_WALL        = 0x4a4a4a;
const COLOR_WALL_BORDER = 0x6a6a6a;
const COLOR_DOOR        = 0x5a3a1a;
const COLOR_PLAYER      = 0xa0ffa0;
const COLOR_SHIV        = 0xd4883a;
const COLOR_GUARD       = 0xbb2222;
const COLOR_PRISONER    = 0x5a6e8a;
const COLOR_TRAY        = 0x9a9a9a;
const COLOR_DDOOR       = 0x353535;
const COLOR_TABLE       = 0x7a5a3a;
const COLOR_EXIT        = 0x44cc44;

const THROW_SPEED         = 580;
const SETTLE_MS           = 3000;
const SETTLE_SPEED        = 12;

const GUARD_PATROL_SPEED  = 60;
const GUARD_CHASE_SPEED   = 90;
const GUARD_DETECT_RADIUS = 56;
const GUARD_ATTACK_RANGE  = 24;
const GUARD_ATTACK_MS     = 800;
const GUARD_HP_MAX        = 3;
const PLAYER_HP_MAX       = 5;

const PRISONER_SPEED      = 40;
const RIOT_TIMER_MS       = 30000;

class CellScene extends Phaser.Scene {
  constructor() { super({ key: 'CellScene' }); }

  create() {
    this.physics.world.setBounds(0, 0, TOTAL_W, H);

    // --- Tilemap ---
    this.walls            = this.physics.add.staticGroup();
    this.doorBody         = null;
    this.doorOpen         = false;
    this.doubleDoorBodies = [];
    this.doubleDoorOpen   = false;
    this.exitDoorBodies   = [];
    this.exitDoorRevealed = false;

    const gfx = this.add.graphics();

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < TOTAL_COLS; col++) {
        const tile = MAP[row][col];
        const x = col * TILE;
        const y = row * TILE;

        if (tile === 0) {
          gfx.fillStyle(COLOR_FLOOR);
          gfx.fillRect(x, y, TILE, TILE);

        } else if (tile === 1) {
          gfx.fillStyle(COLOR_WALL);
          gfx.fillRect(x, y, TILE, TILE);
          gfx.lineStyle(1, COLOR_WALL_BORDER, 1);
          gfx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
          const wall = this.add.rectangle(x + TILE / 2, y + TILE / 2, TILE, TILE);
          this.physics.add.existing(wall, true);
          this.walls.add(wall);

        } else if (tile === 2) {
          gfx.fillStyle(COLOR_DOOR);
          gfx.fillRect(x, y, TILE, TILE);
          gfx.lineStyle(2, 0x8a6a3a, 1);
          gfx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
          gfx.fillStyle(0xc8a060);
          gfx.fillRect(x + 4, y + TILE / 2 - 2, 4, 4);
          const door = this.add.rectangle(x + TILE / 2, y + TILE / 2, TILE, TILE);
          this.physics.add.existing(door, true);
          this.walls.add(door);
          this.doorBody = door;

        } else if (tile === 3) {
          gfx.fillStyle(COLOR_DDOOR);
          gfx.fillRect(x, y, TILE, TILE);
          gfx.lineStyle(1, 0x555555, 1);
          gfx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
          if (row === 4) {
            gfx.lineStyle(3, 0x111111, 1);
            gfx.beginPath();
            gfx.moveTo(x, y + TILE);
            gfx.lineTo(x + TILE, y + TILE);
            gfx.strokePath();
          }
          const dd = this.add.rectangle(x + TILE / 2, y + TILE / 2, TILE, TILE);
          this.physics.add.existing(dd, true);
          this.walls.add(dd);
          this.doubleDoorBodies.push({ rect: dd, x, y });

        } else if (tile === 5) {
          // Exit door — drawn as wall, becomes floor on riot
          gfx.fillStyle(COLOR_WALL);
          gfx.fillRect(x, y, TILE, TILE);
          gfx.lineStyle(1, COLOR_WALL_BORDER, 1);
          gfx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);
          const ed = this.add.rectangle(x + TILE / 2, y + TILE / 2, TILE, TILE);
          this.physics.add.existing(ed, true);
          this.walls.add(ed);
          this.exitDoorBodies.push({ rect: ed, x, y });
        }
      }
    }

    // --- Mess hall tables (static obstacles) ---
    const tgfx = this.add.graphics();
    const tableDefs = [
      { c: 27, r: 2, wt: 3, ht: 1 },
      { c: 33, r: 2, wt: 3, ht: 1 },
      { c: 27, r: 5, wt: 3, ht: 1 },
      { c: 33, r: 5, wt: 3, ht: 1 },
    ];
    for (const td of tableDefs) {
      const tx = td.c * TILE;
      const ty = td.r * TILE;
      const tw = td.wt * TILE;
      const th = td.ht * TILE;
      tgfx.fillStyle(COLOR_TABLE);
      tgfx.fillRect(tx, ty, tw, th);
      tgfx.lineStyle(2, 0xaa7a4a, 1);
      tgfx.strokeRect(tx + 2, ty + 2, tw - 4, th - 4);
      const tbl = this.add.rectangle(tx + tw / 2, ty + th / 2, tw, th);
      this.physics.add.existing(tbl, true);
      this.walls.add(tbl);
    }

    // --- Cell guard ---
    this.guard = this.add.rectangle(
      7 * TILE + TILE / 2, 2 * TILE + TILE / 2, 32, 32, COLOR_GUARD
    ).setDepth(1);
    this.physics.add.existing(this.guard);
    this.guard.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.guard, this.walls);

    this.guardHp       = GUARD_HP_MAX;
    this.guardState    = 'PATROL';
    this.guardFlashing = false;
    this.guardStunned  = false;
    this.patrolPoints  = [
      { x: 7 * TILE + TILE / 2, y: 2 * TILE + TILE / 2 },
      { x: 7 * TILE + TILE / 2, y: 5 * TILE + TILE / 2 },
    ];
    this.patrolIndex = 0;

    this.guardAttackTimer = this.time.addEvent({
      delay: GUARD_ATTACK_MS,
      loop:  true,
      callback: () => {
        if (this.guardState === 'ATTACK' && !this.playerDead) this.damagePlayer();
      },
    });

    // --- Mess hall guards ---
    this.messGuards = [];
    const mgDefs = [
      {
        sx: 30 * TILE + TILE / 2, sy: 1 * TILE + TILE / 2,
        p0x: 26 * TILE + TILE / 2, p0y: 1 * TILE + TILE / 2,
        p1x: 41 * TILE + TILE / 2, p1y: 1 * TILE + TILE / 2,
      },
      {
        sx: 35 * TILE + TILE / 2, sy: 6 * TILE + TILE / 2,
        p0x: 26 * TILE + TILE / 2, p0y: 6 * TILE + TILE / 2,
        p1x: 41 * TILE + TILE / 2, p1y: 6 * TILE + TILE / 2,
      },
    ];
    for (const def of mgDefs) {
      const rect = this.add.rectangle(def.sx, def.sy, 32, 32, COLOR_GUARD).setDepth(1);
      this.physics.add.existing(rect);
      rect.body.setCollideWorldBounds(true);
      this.physics.add.collider(rect, this.walls);
      const mg = {
        rect,
        hp:          GUARD_HP_MAX,
        state:       'PATROL',
        flashing:    false,
        stunned:     false,
        attackTimer: null,
        patrolPoints:[
          { x: def.p0x, y: def.p0y },
          { x: def.p1x, y: def.p1y },
        ],
        patrolIndex: 0,
      };
      mg.attackTimer = this.time.addEvent({
        delay:    GUARD_ATTACK_MS,
        loop:     true,
        callback: () => {
          if (mg.state === 'ATTACK' && !this.playerDead) this.damagePlayer();
        },
      });
      this.messGuards.push(mg);
    }

    // --- Player ---
    this.player = this.add.rectangle(W / 2, H / 2, 28, 28, COLOR_PLAYER).setDepth(2);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);

    // --- Player state ---
    this.playerHp       = PLAYER_HP_MAX;
    this.playerDead     = false;
    this.playerFlashing = false;
    this.facing         = 'down';
    this.inventory      = null;
    this.attackFlash    = null;
    this.attackFacing   = null;
    this.attackItemType = null;
    this.attackHasHit   = false;

    // --- Thrown item state ---
    this.thrownItem     = null;
    this.throwCollider  = null;
    this.settleTimer    = null;
    this.thrownHasHit   = false;
    this.thrownItemType = null;

    // --- Riot state ---
    this.messHallEntered = false;
    this.riotTriggered   = false;
    this.riotActive      = false;
    this.gameComplete    = false;

    // --- Floor shiv ---
    this.shiv = this.add.rectangle(
      3 * TILE + TILE / 2, 3 * TILE + TILE / 2, 8, 16, COLOR_SHIV
    ).setDepth(1);
    this.physics.add.existing(this.shiv);
    this.shiv.body.setImmovable(true);
    this.physics.add.overlap(this.player, this.shiv, this.pickupShiv, null, this);

    // --- Floor tray ---
    this.tray = this.add.rectangle(
      17 * TILE + TILE / 2, 5 * TILE + TILE / 2, 24, 10, COLOR_TRAY
    ).setDepth(1);
    this.physics.add.existing(this.tray);
    this.tray.body.setImmovable(true);
    this.physics.add.overlap(this.player, this.tray, this.pickupTray, null, this);

    // --- Prisoners (corridor + mess hall) ---
    this.prisoners = [];

    const corridorPrisoners = [
      { col: 12, row: 4 },
      { col: 16, row: 5 },
      { col: 20, row: 3 },
    ];
    const messPrisoners = [
      { col: 25, row: 1 }, { col: 30, row: 1 }, { col: 38, row: 1 }, { col: 42, row: 1 },
      { col: 25, row: 3 }, { col: 31, row: 3 }, { col: 37, row: 3 }, { col: 41, row: 3 },
      { col: 25, row: 4 }, { col: 31, row: 4 }, { col: 37, row: 4 }, { col: 41, row: 4 },
      { col: 25, row: 6 }, { col: 38, row: 6 },
    ];

    for (const def of [...corridorPrisoners, ...messPrisoners]) {
      const rect = this.add.rectangle(
        def.col * TILE + TILE / 2, def.row * TILE + TILE / 2, 28, 28, COLOR_PRISONER
      ).setDepth(1);
      this.physics.add.existing(rect);
      rect.body.setCollideWorldBounds(true);
      this.physics.add.collider(rect, this.walls);
      this.prisoners.push({ rect, timer: Phaser.Math.Between(500, 1500), moving: false, frantic: false });
    }

    // --- Camera ---
    this.cameras.main.setBounds(0, 0, TOTAL_W, H);
    this.cameras.main.startFollow(this.player, true);

    // --- HUD ---
    this.hudText = this.add.text(8, 8, '', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffffff',
    }).setScrollFactor(0).setDepth(10);

    this.promptText = this.add.text(W / 2, H - 20, '', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffff88',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(10);

    this.riotDebugText = this.add.text(W - 4, 8, '', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ff8888',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);

    this.riotStartTime = null;

    this.updateHUD();

    // --- Input ---
    this.keys = this.input.keyboard.addKeys({
      up:    Phaser.Input.Keyboard.KeyCodes.W,
      down:  Phaser.Input.Keyboard.KeyCodes.S,
      left:  Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      e:     Phaser.Input.Keyboard.KeyCodes.E,
    });

    this.input.keyboard.on('keydown', (event) => {
      if (event.code === 'ShiftRight') this.throwItem();
    });
  }

  // -------------------------------------------------------
  // Item helpers
  // -------------------------------------------------------
  _itemVisual(type) {
    switch (type) {
      case 'shiv': return { w: 8,  h: 16, color: COLOR_SHIV };
      case 'tray': return { w: 24, h: 10, color: COLOR_TRAY };
      default:     return { w: 8,  h: 8,  color: 0xffffff };
    }
  }

  _attackOffset(dir, itemW, itemH) {
    const edge = 14 + 4;
    switch (dir) {
      case 'right': return { dx:  edge + itemW / 2, dy: 0 };
      case 'left':  return { dx: -(edge + itemW / 2), dy: 0 };
      case 'down':  return { dx: 0, dy:  edge + itemH / 2 };
      case 'up':    return { dx: 0, dy: -(edge + itemH / 2) };
    }
  }

  // -------------------------------------------------------
  // HUD
  // -------------------------------------------------------
  updateHUD() {
    const item = this.inventory ? ' | ' + this.inventory.toUpperCase() : '';
    this.hudText.setText('HP: ' + this.playerHp + item);
  }

  // -------------------------------------------------------
  // Pickup
  // -------------------------------------------------------
  pickupShiv() {
    this.inventory = 'shiv';
    this.shiv.destroy();
    this.shiv = null;
    this.updateHUD();
  }

  pickupTray() {
    if (this.inventory) this.dropCurrentItem(this.player.x, this.player.y);
    this.inventory = 'tray';
    this.tray.destroy();
    this.tray = null;
    this.updateHUD();
  }

  dropCurrentItem(x, y) {
    const type = this.inventory;
    const vis  = this._itemVisual(type);
    const behind = {
      up:    { dx:  0,  dy:  24 },
      down:  { dx:  0,  dy: -24 },
      left:  { dx:  24, dy:  0  },
      right: { dx: -24, dy:  0  },
    }[this.facing];
    const dropped = this.add.rectangle(
      x + behind.dx, y + behind.dy, vis.w, vis.h, vis.color
    ).setDepth(1);
    this.physics.add.existing(dropped);
    dropped.body.setImmovable(true);
    this.physics.add.overlap(this.player, dropped, () => {
      if (!this.inventory) {
        this.inventory = type;
        dropped.destroy();
        this.updateHUD();
      }
    }, null, this);
  }

  pickupThrown() {
    if (!this.thrownItem) return;
    this.inventory      = this.thrownItemType;
    this.thrownItem.destroy();
    this.thrownItem     = null;
    this.thrownItemType = null;
    this.updateHUD();
  }

  // -------------------------------------------------------
  // Throw
  // -------------------------------------------------------
  throwItem() {
    if (!this.inventory || this.thrownItem) return;

    this.thrownItemType = this.inventory;
    this.inventory      = null;
    this.thrownHasHit   = false;
    this.updateHUD();

    const vis = this._itemVisual(this.thrownItemType);
    const dirVel = {
      up:    { vx:  0,           vy: -THROW_SPEED },
      down:  { vx:  0,           vy:  THROW_SPEED },
      left:  { vx: -THROW_SPEED, vy:  0           },
      right: { vx:  THROW_SPEED, vy:  0           },
    };
    const { vx, vy } = dirVel[this.facing];

    this.thrownItem = this.add.rectangle(
      this.player.x, this.player.y, vis.w, vis.h, vis.color
    ).setDepth(3);
    this.physics.add.existing(this.thrownItem);
    this.thrownItem.body.setBounce(0.15, 0.15);
    this.thrownItem.body.setDrag(300, 300);
    this.thrownItem.body.setVelocity(vx, vy);

    this.throwCollider = this.physics.add.collider(this.thrownItem, this.walls);

    if (this.guard) {
      this.physics.add.overlap(this.thrownItem, this.guard, () => {
        if (!this.thrownHasHit) { this.thrownHasHit = true; this.hitGuard(); }
      }, null, this);
    }

    for (const mg of this.messGuards) {
      if (mg && mg.rect) {
        this.physics.add.overlap(this.thrownItem, mg.rect, () => {
          if (!this.thrownHasHit) { this.thrownHasHit = true; this.hitMessGuard(mg); }
        }, null, this);
      }
    }

    this.settleTimer = this.time.delayedCall(SETTLE_MS, () => this.settleThrown());
  }

  // -------------------------------------------------------
  // Settle
  // -------------------------------------------------------
  settleThrown() {
    if (!this.thrownItem) return;
    if (this.settleTimer)   { this.settleTimer.remove(false);   this.settleTimer   = null; }
    if (this.throwCollider) { this.throwCollider.destroy();     this.throwCollider = null; }
    this.thrownItem.body.setVelocity(0);
    this.thrownItem.body.setImmovable(true);
    this.physics.add.overlap(this.player, this.thrownItem, this.pickupThrown, null, this);
  }

  // -------------------------------------------------------
  // Melee attack
  // -------------------------------------------------------
  spawnFlash() {
    if (!this.inventory || this.attackFlash) return;
    const vis = this._itemVisual(this.inventory);
    const { dx, dy } = this._attackOffset(this.facing, vis.w, vis.h);
    this.attackFacing   = this.facing;
    this.attackItemType = this.inventory;
    this.attackHasHit   = false;
    this.attackFlash    = this.add.rectangle(
      this.player.x + dx, this.player.y + dy, vis.w, vis.h, vis.color
    ).setDepth(5);
    this.time.delayedCall(150, () => {
      if (this.attackFlash) { this.attackFlash.destroy(); this.attackFlash = null; }
      this.attackFacing   = null;
      this.attackItemType = null;
      this.attackHasHit   = false;
    });
  }

  // -------------------------------------------------------
  // Doors
  // -------------------------------------------------------
  openDoor() {
    this.doorOpen = true;
    this.promptText.setText('');
    if (this.doorBody) { this.doorBody.destroy(); this.doorBody = null; }
    const g = this.add.graphics();
    g.fillStyle(COLOR_FLOOR);
    g.fillRect(9 * TILE, 4 * TILE, TILE, TILE);
  }

  openDoubleDoors() {
    this.doubleDoorOpen = true;
    this.promptText.setText('');
    const g = this.add.graphics();
    for (const dd of this.doubleDoorBodies) {
      this.walls.remove(dd.rect, true);
      g.fillStyle(COLOR_FLOOR);
      g.fillRect(dd.x, dd.y, TILE, TILE);
    }
    this.doubleDoorBodies = [];
  }

  // -------------------------------------------------------
  // Cell guard logic
  // -------------------------------------------------------
  updateGuard() {
    if (!this.guard || this.guardStunned) return;

    const dist = Phaser.Math.Distance.Between(
      this.guard.x, this.guard.y, this.player.x, this.player.y
    );

    if (this.guardState === 'PATROL') {
      if (dist < GUARD_DETECT_RADIUS) {
        this.guardState = 'CHASE';
      } else {
        const target = this.patrolPoints[this.patrolIndex];
        const d = Phaser.Math.Distance.Between(this.guard.x, this.guard.y, target.x, target.y);
        if (d < 4) {
          this.guard.body.setVelocity(0);
          this.patrolIndex = 1 - this.patrolIndex;
        } else {
          this.physics.moveTo(this.guard, target.x, target.y, GUARD_PATROL_SPEED);
        }
      }
    } else if (this.guardState === 'CHASE') {
      if (dist <= GUARD_ATTACK_RANGE) {
        this.guardState = 'ATTACK';
        this.guard.body.setVelocity(0);
      } else {
        this.physics.moveTo(this.guard, this.player.x, this.player.y, GUARD_CHASE_SPEED);
      }
    } else if (this.guardState === 'ATTACK') {
      this.guard.body.setVelocity(0);
      if (dist > GUARD_ATTACK_RANGE) this.guardState = 'CHASE';
    }
  }

  hitGuard() {
    if (!this.guard || this.guardFlashing) return;
    if (this.guardState === 'PATROL') this.guardState = 'CHASE';
    this.guardHp--;
    if (this.guardHp <= 0) { this.killGuard(); return; }
    this.guardFlashing = true;
    this.guard.setFillStyle(0xffffff);
    this.time.delayedCall(100, () => {
      if (this.guard) this.guard.setFillStyle(COLOR_GUARD);
      this.guardFlashing = false;
    });
    this.guardStunned = true;
    this.guard.body.setVelocity(0);
    this.time.delayedCall(400, () => { this.guardStunned = false; });
  }

  killGuard() {
    if (this.guardAttackTimer) { this.guardAttackTimer.remove(false); this.guardAttackTimer = null; }
    this.guard.destroy();
    this.guard = null;
  }

  // -------------------------------------------------------
  // Mess hall guard logic
  // -------------------------------------------------------
  hitMessGuard(mg) {
    if (!mg || !mg.rect || mg.flashing) return;
    if (mg.state === 'PATROL') mg.state = 'CHASE';
    mg.hp--;
    if (mg.hp <= 0) { this.killMessGuard(mg); return; }
    mg.flashing = true;
    mg.rect.setFillStyle(0xffffff);
    this.time.delayedCall(100, () => {
      if (mg.rect) mg.rect.setFillStyle(COLOR_GUARD);
      mg.flashing = false;
    });
    mg.stunned = true;
    mg.rect.body.setVelocity(0);
    this.time.delayedCall(400, () => { mg.stunned = false; });
  }

  killMessGuard(mg) {
    if (mg.attackTimer) { mg.attackTimer.remove(false); mg.attackTimer = null; }
    if (mg.rect)        { mg.rect.destroy(); mg.rect = null; }
  }

  updateMessGuards() {
    for (const mg of this.messGuards) {
      if (!mg || !mg.rect || mg.stunned) continue;

      const dist = Phaser.Math.Distance.Between(
        mg.rect.x, mg.rect.y, this.player.x, this.player.y
      );

      if (this.riotActive) {
        if (dist <= GUARD_ATTACK_RANGE) {
          mg.state = 'ATTACK';
          mg.rect.body.setVelocity(0);
        } else {
          mg.state = 'CHASE';
          this.physics.moveTo(mg.rect, this.player.x, this.player.y, GUARD_CHASE_SPEED);
        }
      } else {
        if (mg.state === 'PATROL') {
          if (dist < GUARD_DETECT_RADIUS) {
            mg.state = 'CHASE';
          } else {
            const target = mg.patrolPoints[mg.patrolIndex];
            const d = Phaser.Math.Distance.Between(mg.rect.x, mg.rect.y, target.x, target.y);
            if (d < 4) {
              mg.rect.body.setVelocity(0);
              mg.patrolIndex = 1 - mg.patrolIndex;
            } else {
              this.physics.moveTo(mg.rect, target.x, target.y, GUARD_PATROL_SPEED);
            }
          }
        } else if (mg.state === 'CHASE') {
          if (dist <= GUARD_ATTACK_RANGE) {
            mg.state = 'ATTACK';
            mg.rect.body.setVelocity(0);
          } else {
            this.physics.moveTo(mg.rect, this.player.x, this.player.y, GUARD_CHASE_SPEED);
          }
        } else if (mg.state === 'ATTACK') {
          mg.rect.body.setVelocity(0);
          if (dist > GUARD_ATTACK_RANGE) mg.state = 'CHASE';
        }
      }
    }
  }

  // -------------------------------------------------------
  // Player damage / death
  // -------------------------------------------------------
  damagePlayer() {
    if (this.playerDead || this.playerFlashing) return;
    this.playerHp--;
    this.updateHUD();
    if (this.playerHp <= 0) {
      this.playerDead = true;
      this.killPlayer();
      return;
    }
    this.playerFlashing = true;
    this.player.setFillStyle(0xff4444);
    this.time.delayedCall(100, () => {
      if (this.player && this.player.active) this.player.setFillStyle(COLOR_PLAYER);
      this.playerFlashing = false;
    });
  }

  killPlayer() {
    this.player.setFillStyle(0xff0000);
    if (this.guard) this.guard.body.setVelocity(0);
    for (const mg of this.messGuards) {
      if (mg && mg.rect) mg.rect.body.setVelocity(0);
    }
    this.add.rectangle(W / 2, H / 2, W, H, 0xff0000, 0.6).setDepth(20).setScrollFactor(0);
    this.time.delayedCall(500, () => this.scene.restart());
  }

  // -------------------------------------------------------
  // Prisoners — random wander / frantic
  // -------------------------------------------------------
  updatePrisoners(delta) {
    const dirs = [
      { vx:  PRISONER_SPEED, vy: 0 },
      { vx: -PRISONER_SPEED, vy: 0 },
      { vx: 0, vy:  PRISONER_SPEED },
      { vx: 0, vy: -PRISONER_SPEED },
    ];
    const franticDirs = [
      { vx:  180, vy: 0 }, { vx: -180, vy: 0 },
      { vx: 0, vy:  180 }, { vx: 0, vy: -180 },
    ];

    for (const p of this.prisoners) {
      if (!p.rect) continue;
      p.timer -= delta;
      if (p.timer > 0) continue;

      if (p.frantic) {
        const d = Phaser.Utils.Array.GetRandom(franticDirs);
        p.rect.body.setVelocity(d.vx, d.vy);
        p.timer = Phaser.Math.Between(300, 800);
      } else {
        if (p.moving) {
          p.rect.body.setVelocity(0);
          p.moving = false;
          p.timer  = Phaser.Math.Between(800, 1800);
        } else {
          const d = Phaser.Utils.Array.GetRandom(dirs);
          p.rect.body.setVelocity(d.vx, d.vy);
          p.moving = true;
          p.timer  = Phaser.Math.Between(1000, 2200);
        }
      }
    }
  }

  // -------------------------------------------------------
  // Riot sequence
  // -------------------------------------------------------
  triggerRiot() {
    if (this.riotTriggered || this.playerDead || this.gameComplete) return;
    this.riotTriggered = true;

    let flashCount = 0;
    const doFlash = () => {
      this.cameras.main.flash(200, 255, 255, 255);
      flashCount++;
      if (flashCount < 3) {
        this.time.delayedCall(400, doFlash);
      } else {
        this.time.delayedCall(400, () => this._showRiotText());
      }
    };
    doFlash();
  }

  _showRiotText() {
    const riotText = this.add.text(W / 2, H / 2, 'RIOT', {
      fontFamily: 'monospace',
      fontSize:   '48px',
      color:      '#ff0000',
      stroke:     '#ffffff',
      strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30);

    this.time.delayedCall(1500, () => {
      riotText.destroy();
      this._activateRiot();
    });
  }

  _activateRiot() {
    this.riotActive = true;

    for (const p of this.prisoners) {
      p.frantic = true;
      p.timer   = 0;
    }

    if (this.guard) this.guardState = 'CHASE';

    for (const mg of this.messGuards) {
      if (mg && mg.rect) mg.state = 'CHASE';
    }

    this._revealExitDoor();
  }

  _revealExitDoor() {
    this.exitDoorRevealed = true;
    const g = this.add.graphics();
    for (const ed of this.exitDoorBodies) {
      this.walls.remove(ed.rect, true);
      g.fillStyle(COLOR_EXIT);
      g.fillRect(ed.x, ed.y, TILE, TILE);
      g.lineStyle(2, 0x00ff00, 1);
      g.strokeRect(ed.x + 2, ed.y + 2, TILE - 4, TILE - 4);
    }
    this.exitDoorBodies = [];
  }

  // -------------------------------------------------------
  // Completion
  // -------------------------------------------------------
  completeGame() {
    if (this.gameComplete) return;
    this.gameComplete = true;

    this.player.body.setVelocity(0);
    if (this.guard) this.guard.body.setVelocity(0);
    for (const mg of this.messGuards) {
      if (mg && mg.rect) mg.rect.body.setVelocity(0);
    }
    for (const p of this.prisoners) {
      if (p.rect) p.rect.body.setVelocity(0);
    }

    this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.88)
      .setDepth(50).setScrollFactor(0);
    this.add.text(W / 2, H / 2 - 24, 'CHAPTER 1', {
      fontFamily: 'monospace', fontSize: '26px', color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);
    this.add.text(W / 2, H / 2 + 18, 'END', {
      fontFamily: 'monospace', fontSize: '44px', color: '#ff4444',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);
  }

  // -------------------------------------------------------
  // Update
  // -------------------------------------------------------
  update(time, delta) {
    if (this.playerDead || this.gameComplete) return;

    // --- Player movement ---
    const speed = 150;
    const body  = this.player.body;
    body.setVelocity(0);
    let movingX = false, movingY = false;

    if (this.keys.left.isDown)  { body.setVelocityX(-speed); movingX = true; this.facing = 'left'; }
    else if (this.keys.right.isDown) { body.setVelocityX(speed); movingX = true; this.facing = 'right'; }
    if (this.keys.up.isDown)    { body.setVelocityY(-speed); movingY = true; if (!movingX) this.facing = 'up'; }
    else if (this.keys.down.isDown)  { body.setVelocityY(speed); movingY = true; if (!movingX) this.facing = 'down'; }
    if (movingX && movingY) body.velocity.normalize().scale(speed);

    // --- Melee ---
    if (Phaser.Input.Keyboard.JustDown(this.keys.space)) this.spawnFlash();

    // --- Attack flash: track position + hit detection ---
    if (this.attackFlash && this.attackFacing) {
      const vis = this._itemVisual(this.attackItemType);
      const { dx, dy } = this._attackOffset(this.attackFacing, vis.w, vis.h);
      this.attackFlash.setPosition(this.player.x + dx, this.player.y + dy);

      if (!this.attackHasHit) {
        const fb = this.attackFlash.getBounds();
        if (this.guard && Phaser.Geom.Intersects.RectangleToRectangle(fb, this.guard.getBounds())) {
          this.attackHasHit = true;
          this.hitGuard();
        }
        if (!this.attackHasHit) {
          for (const mg of this.messGuards) {
            if (mg && mg.rect && Phaser.Geom.Intersects.RectangleToRectangle(fb, mg.rect.getBounds())) {
              this.attackHasHit = true;
              this.hitMessGuard(mg);
              break;
            }
          }
        }
      }
    }

    // --- Settle thrown item ---
    if (this.thrownItem && this.thrownItem.body && this.thrownItem.body.speed < SETTLE_SPEED) {
      this.settleThrown();
    }

    // --- Mess hall entry detection (riot timer) ---
    if (!this.messHallEntered && this.doubleDoorOpen && this.player.x > 24 * TILE) {
      this.messHallEntered = true;
      this.riotStartTime = time;
      this.time.delayedCall(RIOT_TIMER_MS, () => this.triggerRiot());
    }

    // Debug riot countdown
    if (this.riotStartTime !== null && !this.riotTriggered) {
      const elapsed = time - this.riotStartTime;
      const remaining = Math.max(0, RIOT_TIMER_MS - elapsed);
      const secs = (remaining / 1000).toFixed(1);
      this.riotDebugText.setText(`RIOT: ${secs}s`);
    } else if (this.riotTriggered && this.riotDebugText.text !== '') {
      this.riotDebugText.setText('RIOT!');
    }

    // --- Prompt chain ---
    let promptShown = false;

    // Exit door
    if (this.riotActive && this.exitDoorRevealed && !promptShown) {
      const ex = 43 * TILE + TILE / 2;
      const ey = 3 * TILE + TILE;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, ex, ey) < 50) {
        this.promptText.setText('ESCAPE (E)');
        promptShown = true;
        if (Phaser.Input.Keyboard.JustDown(this.keys.e)) this.completeGame();
      }
    }

    // Double doors
    if (!promptShown && this.doorOpen && !this.doubleDoorOpen) {
      const ddx = 23 * TILE + TILE / 2;
      const ddy = 4 * TILE + TILE / 2;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, ddx, ddy) < 50) {
        this.promptText.setText('OPEN (E)');
        promptShown = true;
        if (Phaser.Input.Keyboard.JustDown(this.keys.e)) this.openDoubleDoors();
      }
    }

    // Cell door
    if (!promptShown && !this.guard && !this.doorOpen) {
      const doorX = 9 * TILE + TILE / 2;
      const doorY = 4 * TILE + TILE / 2;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, doorX, doorY) < 40) {
        this.promptText.setText('OPEN (E)');
        promptShown = true;
        if (Phaser.Input.Keyboard.JustDown(this.keys.e)) this.openDoor();
      }
    }

    if (!promptShown) this.promptText.setText('');

    // --- AI ---
    this.updateGuard();
    this.updateMessGuards();

    // --- Prisoner wander ---
    this.updatePrisoners(delta);
  }
}

const config = {
  type:            Phaser.AUTO,
  width:           W,
  height:          H,
  backgroundColor: '#111111',
  physics: {
    default: 'arcade',
    arcade:  { gravity: { y: 0 }, debug: false },
  },
  scene: CellScene,
};

new Phaser.Game(config);
