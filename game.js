const TILE       = 32;
const COLS       = 10;
const TOTAL_COLS = 44;
const ROWS       = 8;
const W          = COLS * TILE;
const H          = ROWS * TILE;
const TOTAL_W    = TOTAL_COLS * TILE;

// Tile types: 0=floor 1=wall 2=cell door 3=double doors 5=exit door
const MAP = (() => {
  const g = Array.from({ length: ROWS }, () => Array(TOTAL_COLS).fill(1));
  for (let r = 1; r <= 6; r++) for (let c = 1; c <= 8; c++) g[r][c] = 0;
  g[4][9] = 2;
  for (let r = 3; r <= 6; r++) for (let c = 10; c <= 22; c++) g[r][c] = 0;
  for (let r = 3; r <= 6; r++) g[r][23] = 3;
  for (let r = 3; r <= 6; r++) g[r][24] = 0;
  for (let r = 1; r <= 6; r++) for (let c = 25; c <= 42; c++) g[r][c] = 0;
  g[3][43] = 5;
  g[4][43] = 5;
  return g;
})();

// Wall tile frame index in Tileset.png (16x16 grid, 19 cols x 11 rows)
// Tune after visual inspection
const FRAME_WALL = 57;

// Attack flash colors (hitbox rect only — not character visuals)
const COLOR_SHIV = 0xd4883a;
const COLOR_TRAY = 0x9a9a9a;
const COLOR_EXIT = 0x44cc44;

const THROW_SPEED        = 580;
const SETTLE_MS          = 3000;
const SETTLE_SPEED       = 12;
const GUARD_PATROL_SPEED = 60;
const GUARD_CHASE_SPEED  = 90;
const GUARD_DETECT_RADIUS= 56;
const GUARD_ATTACK_RANGE = 24;
const GUARD_ATTACK_MS    = 800;
const GUARD_HP_MAX       = 3;
const PLAYER_HP_MAX      = 5;
const PRISONER_SPEED     = 40;
const RIOT_TIMER_MS      = 30000;

class CellScene extends Phaser.Scene {
  constructor() { super({ key: 'CellScene' }); }

  // ─── PRELOAD ───────────────────────────────────────────────────────────────
  preload() {
    // Player — 3 dirs × 5 anims = 15 sheets (all 32×32 frames)
    for (const dir of ['S', 'U', 'D']) {
      for (const [key, file] of [['idle','Idle'],['walk','Walk'],['attack','Attack'],['death','Death'],['hurt','Hurt']]) {
        this.load.spritesheet(`char_${dir}_${key}`, `assets/char/${dir}_${file}.png`, { frameWidth: 32, frameHeight: 32 });
      }
    }
    // Guard — 3 dirs × 4 anims = 12 sheets (no Hurt)
    for (const dir of ['S', 'U', 'D']) {
      for (const [key, file] of [['idle','Idle'],['walk','Walk'],['attack','Attack'],['death','Death']]) {
        this.load.spritesheet(`guard_${dir}_${key}`, `assets/guard/${dir}_${file}.png`, { frameWidth: 32, frameHeight: 32 });
      }
    }
    // Prisoner — 3 dirs × 2 anims = 6 sheets
    for (const dir of ['S', 'U', 'D']) {
      this.load.spritesheet(`pris_${dir}_idle`, `assets/prisoner/${dir}_Idle.png`, { frameWidth: 32, frameHeight: 32 });
      this.load.spritesheet(`pris_${dir}_walk`, `assets/prisoner/${dir}_Walk.png`, { frameWidth: 32, frameHeight: 32 });
    }
    // Doors
    this.load.spritesheet('door_s',    'assets/objects/Door_S.png',    { frameWidth: 14, frameHeight: 26 });
    this.load.spritesheet('bigdoor_s', 'assets/objects/BigDoor_S.png', { frameWidth: 45, frameHeight: 42 });
    // Tileset (16×16 tiles)
    this.load.spritesheet('tileset', 'assets/tiles/Tileset.png', { frameWidth: 16, frameHeight: 16 });
    // Static images
    this.load.image('table_img',  'assets/objects/Table.png');
    this.load.image('item_floor', 'assets/objects/Item.png');
    this.load.image('bar_full',   'assets/gui/BarTile_01.png');
    this.load.image('bar_empty',  'assets/gui/BarTile_05.png');
  }

  // ─── CREATE ────────────────────────────────────────────────────────────────
  create() {
    this.physics.world.setBounds(0, 0, TOTAL_W, H);

    this.walls            = this.physics.add.staticGroup();
    this.doorBody         = null;
    this.doorSprite       = null;
    this.doorOpen         = false;
    this.bigDoor1         = null;
    this.bigDoor2         = null;
    this.doubleDoorBodies = [];
    this.doubleDoorOpen   = false;
    this.exitDoorBodies   = [];
    this.exitDoorRevealed = false;

    // ── Tilemap ──────────────────────────────────────────────────────────────
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < TOTAL_COLS; col++) {
        const tile = MAP[row][col];
        const cx   = col * TILE + TILE / 2;
        const cy   = row * TILE + TILE / 2;

        if (tile === 1) {
          // Wall visual (tileset sprite)
          this.add.image(cx, cy, 'tileset', FRAME_WALL).setDisplaySize(TILE, TILE).setDepth(1);
          // Physics rect (invisible)
          const wr = this.add.rectangle(cx, cy, TILE, TILE).setAlpha(0);
          this.physics.add.existing(wr, true);
          this.walls.add(wr);

        } else if (tile === 2) {
          // Cell door: visual sprite + invisible physics rect
          this.doorSprite = this.add.sprite(cx, cy, 'door_s').setDisplaySize(TILE, TILE).setDepth(2);
          const dr = this.add.rectangle(cx, cy, TILE, TILE).setAlpha(0);
          this.physics.add.existing(dr, true);
          this.walls.add(dr);
          this.doorBody = dr;

        } else if (tile === 3) {
          // Double doors: physics rect only; visuals set up below after loop
          const dd = this.add.rectangle(cx, cy, TILE, TILE).setAlpha(0);
          this.physics.add.existing(dd, true);
          this.walls.add(dd);
          this.doubleDoorBodies.push({ rect: dd, x: col * TILE, y: row * TILE });

        } else if (tile === 5) {
          // Exit door: wall visual + invisible physics rect, revealed on riot
          const ev = this.add.image(cx, cy, 'tileset', FRAME_WALL).setDisplaySize(TILE, TILE).setDepth(2);
          const er = this.add.rectangle(cx, cy, TILE, TILE).setAlpha(0);
          this.physics.add.existing(er, true);
          this.walls.add(er);
          this.exitDoorBodies.push({ rect: er, visual: ev, x: col * TILE, y: row * TILE });
        }
      }
    }

    // BigDoor sprites (visual only, 2 sprites cover rows 3-4 and 5-6)
    const ddX = 23 * TILE + TILE / 2;
    this.bigDoor1 = this.add.sprite(ddX, 128, 'bigdoor_s').setDisplaySize(TILE, TILE * 2).setDepth(2);
    this.bigDoor2 = this.add.sprite(ddX, 192, 'bigdoor_s').setDisplaySize(TILE, TILE * 2).setDepth(2);

    // ── Tables ───────────────────────────────────────────────────────────────
    const tableDefs = [
      { c: 27, r: 2 }, { c: 33, r: 2 },
      { c: 27, r: 5 }, { c: 33, r: 5 },
    ];
    for (const td of tableDefs) {
      const tw = TILE * 3, th = TILE;
      const tx = td.c * TILE + tw / 2;
      const ty = td.r * TILE + th / 2;
      this.add.image(tx, ty, 'table_img').setDisplaySize(tw, th).setDepth(1);
      const tbl = this.add.rectangle(tx, ty, tw, th).setAlpha(0);
      this.physics.add.existing(tbl, true);
      this.walls.add(tbl);
    }

    // ── Animations ───────────────────────────────────────────────────────────
    const mk = (key, tex, end, fps, repeat) =>
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(tex, { start: 0, end }), frameRate: fps, repeat });

    for (const dir of ['S', 'U', 'D']) {
      mk(`p_${dir}_idle`,   `char_${dir}_idle`,   3, 8,  -1);
      mk(`p_${dir}_walk`,   `char_${dir}_walk`,   5, 10, -1);
      mk(`p_${dir}_attack`, `char_${dir}_attack`, 3, 12, -1);
      mk(`p_${dir}_death`,  `char_${dir}_death`,  7, 8,   0);
      mk(`p_${dir}_hurt`,   `char_${dir}_hurt`,   1, 12,  0);
      mk(`g_${dir}_idle`,   `guard_${dir}_idle`,  3, 8,  -1);
      mk(`g_${dir}_walk`,   `guard_${dir}_walk`,  5, 10, -1);
      mk(`g_${dir}_attack`, `guard_${dir}_attack`,3, 12, -1);
      mk(`g_${dir}_death`,  `guard_${dir}_death`, 7, 8,   0);
      mk(`z_${dir}_idle`,   `pris_${dir}_idle`,   3, 8,  -1);
      mk(`z_${dir}_walk`,   `pris_${dir}_walk`,   5, 10, -1);
    }
    mk('door_open',    'door_s',    3, 8, 0);
    mk('bigdoor_open', 'bigdoor_s', 3, 6, 0);

    // ── Cell guard ───────────────────────────────────────────────────────────
    this.guard = this.physics.add.sprite(
      7 * TILE + TILE / 2, 2 * TILE + TILE / 2, 'guard_D_idle'
    ).setDepth(2);
    this.guard.body.setSize(22, 28, true);
    this.guard.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.guard, this.walls);
    this.guard.play('g_D_idle');

    this.guardHp      = GUARD_HP_MAX;
    this.guardState   = 'PATROL';
    this.guardFacing  = 'down';
    this.guardFlashing= false;
    this.guardStunned = false;
    this.patrolPoints = [
      { x: 7 * TILE + TILE / 2, y: 2 * TILE + TILE / 2 },
      { x: 7 * TILE + TILE / 2, y: 5 * TILE + TILE / 2 },
    ];
    this.patrolIndex  = 0;

    this.guardAttackTimer = this.time.addEvent({
      delay: GUARD_ATTACK_MS, loop: true,
      callback: () => { if (this.guardState === 'ATTACK' && !this.playerDead) this.damagePlayer(); },
    });

    // ── Mess hall guards ─────────────────────────────────────────────────────
    this.messGuards = [];
    const mgDefs = [
      { sx: 30*TILE+TILE/2, sy: 1*TILE+TILE/2, p0x: 26*TILE+TILE/2, p0y: 1*TILE+TILE/2, p1x: 41*TILE+TILE/2, p1y: 1*TILE+TILE/2 },
      { sx: 35*TILE+TILE/2, sy: 6*TILE+TILE/2, p0x: 26*TILE+TILE/2, p0y: 6*TILE+TILE/2, p1x: 41*TILE+TILE/2, p1y: 6*TILE+TILE/2 },
    ];
    for (const def of mgDefs) {
      const spr = this.physics.add.sprite(def.sx, def.sy, 'guard_S_idle').setDepth(2);
      spr.body.setSize(22, 28, true);
      spr.body.setCollideWorldBounds(true);
      this.physics.add.collider(spr, this.walls);
      spr.play('g_S_idle');
      const mg = {
        rect: spr, hp: GUARD_HP_MAX, state: 'PATROL', facing: 'right',
        flashing: false, stunned: false, attackTimer: null,
        patrolPoints: [{ x: def.p0x, y: def.p0y }, { x: def.p1x, y: def.p1y }],
        patrolIndex: 0,
      };
      mg.attackTimer = this.time.addEvent({
        delay: GUARD_ATTACK_MS, loop: true,
        callback: () => { if (mg.state === 'ATTACK' && !this.playerDead) this.damagePlayer(); },
      });
      this.messGuards.push(mg);
    }

    // ── Player ───────────────────────────────────────────────────────────────
    this.player = this.physics.add.sprite(W / 2, H / 2, 'char_D_idle').setDepth(3);
    this.player.body.setSize(20, 24, true);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);
    this.player.play('p_D_idle');

    this.playerHp       = PLAYER_HP_MAX;
    this.playerDead     = false;
    this.playerFlashing = false;
    this.playerHurting  = false;
    this.facing         = 'down';
    this.inventory      = null;
    this.attackFlash    = null;
    this.attackFacing   = null;
    this.attackItemType = null;
    this.attackHasHit   = false;
    this.thrownItem     = null;
    this.throwCollider  = null;
    this.settleTimer    = null;
    this.thrownHasHit   = false;
    this.thrownItemType = null;
    this.messHallEntered= false;
    this.riotTriggered  = false;
    this.riotActive     = false;
    this.gameComplete   = false;
    this.riotStartTime  = null;

    // ── Floor items ──────────────────────────────────────────────────────────
    this.shiv = this.add.image(3*TILE+TILE/2, 3*TILE+TILE/2, 'item_floor').setScale(4).setDepth(1);
    this.physics.add.existing(this.shiv);
    this.shiv.body.setImmovable(true);
    this.physics.add.overlap(this.player, this.shiv, this.pickupShiv, null, this);

    this.tray = this.add.image(17*TILE+TILE/2, 5*TILE+TILE/2, 'item_floor').setScale(4).setDepth(1);
    this.physics.add.existing(this.tray);
    this.tray.body.setImmovable(true);
    this.physics.add.overlap(this.player, this.tray, this.pickupTray, null, this);

    // ── Prisoners ────────────────────────────────────────────────────────────
    this.prisoners = [];
    const prisDefs = [
      { col: 12, row: 4 }, { col: 16, row: 5 }, { col: 20, row: 3 },
      { col: 25, row: 1 }, { col: 30, row: 1 }, { col: 38, row: 1 }, { col: 42, row: 1 },
      { col: 25, row: 3 }, { col: 31, row: 3 }, { col: 37, row: 3 }, { col: 41, row: 3 },
      { col: 25, row: 4 }, { col: 31, row: 4 }, { col: 37, row: 4 }, { col: 41, row: 4 },
      { col: 25, row: 6 }, { col: 38, row: 6 },
    ];
    for (const def of prisDefs) {
      const initFacing = Phaser.Utils.Array.GetRandom(['up', 'down', 'left', 'right']);
      const dir = this._dirKey(initFacing);
      const spr = this.physics.add.sprite(
        def.col * TILE + TILE / 2, def.row * TILE + TILE / 2, `pris_${dir}_idle`
      ).setDepth(2);
      spr.body.setSize(18, 22, true);
      spr.body.setCollideWorldBounds(true);
      this.physics.add.collider(spr, this.walls);
      spr.setFlipX(initFacing === 'left');
      spr.play(`z_${dir}_idle`);
      this.prisoners.push({ rect: spr, facing: initFacing, timer: Phaser.Math.Between(500, 1500), moving: false, frantic: false });
    }

    // ── Camera ───────────────────────────────────────────────────────────────
    this.cameras.main.setBounds(0, 0, TOTAL_W, H);
    this.cameras.main.startFollow(this.player, true);

    // ── HUD: bar tiles + text ─────────────────────────────────────────────────
    this.barTiles = [];
    for (let i = 0; i < PLAYER_HP_MAX; i++) {
      const bt = this.add.image(8 + i * 20, 8, 'bar_full')
        .setScale(1.5).setOrigin(0, 0).setScrollFactor(0).setDepth(10);
      this.barTiles.push(bt);
    }

    this.promptText = this.add.text(W / 2, H - 20, '', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffff88',
    }).setOrigin(0.5, 1).setScrollFactor(0).setDepth(10);

    this.riotDebugText = this.add.text(W - 4, 8, '', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ff8888',
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);

    this.updateHUD();

    // ── Input ─────────────────────────────────────────────────────────────────
    this.keys = this.input.keyboard.addKeys({
      up:    Phaser.Input.Keyboard.KeyCodes.W,
      down:  Phaser.Input.Keyboard.KeyCodes.S,
      left:  Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      e:     Phaser.Input.Keyboard.KeyCodes.E,
    });
    this.input.keyboard.on('keydown', (ev) => {
      if (ev.code === 'ShiftRight') this.throwItem();
    });
  }

  // ─── HELPERS ───────────────────────────────────────────────────────────────
  _dirKey(facing) {
    if (facing === 'up')   return 'U';
    if (facing === 'down') return 'D';
    return 'S';
  }

  _velFacing(body, cur) {
    const vx = body.velocity.x, vy = body.velocity.y;
    if (Math.abs(vx) < 5 && Math.abs(vy) < 5) return cur;
    return Math.abs(vx) >= Math.abs(vy)
      ? (vx > 0 ? 'right' : 'left')
      : (vy > 0 ? 'down'  : 'up');
  }

  _itemVisual(type) {
    switch (type) {
      case 'shiv': return { w: 8,  h: 16, color: COLOR_SHIV };
      case 'tray': return { w: 24, h: 10, color: COLOR_TRAY };
      default:     return { w: 8,  h: 8,  color: 0xffffff };
    }
  }

  _attackOffset(dir, iw, ih) {
    const edge = 14 + 4;
    switch (dir) {
      case 'right': return { dx:  edge + iw / 2, dy: 0 };
      case 'left':  return { dx: -(edge + iw / 2), dy: 0 };
      case 'down':  return { dx: 0, dy:  edge + ih / 2 };
      case 'up':    return { dx: 0, dy: -(edge + ih / 2) };
    }
  }

  _updatePlayerAnim(movingX, movingY) {
    if (this.playerDead || this.playerHurting) return;
    const dir = this._dirKey(this.facing);
    let key;
    if (this.attackFlash)         key = `p_${dir}_attack`;
    else if (movingX || movingY)  key = `p_${dir}_walk`;
    else                          key = `p_${dir}_idle`;
    if (this.player.anims.currentAnim?.key !== key) this.player.play(key, true);
    this.player.setFlipX(this.facing === 'left');
  }

  _updateGuardAnim(spr, state, facing) {
    const dir    = this._dirKey(facing);
    const vx     = spr.body.velocity.x, vy = spr.body.velocity.y;
    const moving = Math.abs(vx) > 2 || Math.abs(vy) > 2;
    const key    = state === 'ATTACK' ? `g_${dir}_attack`
                 : moving             ? `g_${dir}_walk`
                 :                      `g_${dir}_idle`;
    if (spr.anims.currentAnim?.key !== key) spr.play(key, true);
    spr.setFlipX(facing === 'left');
  }

  _updatePrisonerAnim(p) {
    if (!p.rect || !p.rect.active) return;
    const dir    = this._dirKey(p.facing);
    const vx     = p.rect.body.velocity.x, vy = p.rect.body.velocity.y;
    const moving = Math.abs(vx) > 2 || Math.abs(vy) > 2;
    const key    = moving ? `z_${dir}_walk` : `z_${dir}_idle`;
    if (p.rect.anims.currentAnim?.key !== key) p.rect.play(key, true);
    p.rect.setFlipX(p.facing === 'left');
  }

  // ─── HUD ───────────────────────────────────────────────────────────────────
  updateHUD() {
    for (let i = 0; i < PLAYER_HP_MAX; i++) {
      this.barTiles[i].setTexture(i < this.playerHp ? 'bar_full' : 'bar_empty');
    }
  }

  // ─── PICKUPS ───────────────────────────────────────────────────────────────
  pickupShiv() {
    this.inventory = 'shiv';
    this.shiv.destroy(); this.shiv = null;
    this.updateHUD();
  }

  pickupTray() {
    if (this.inventory) this.dropCurrentItem(this.player.x, this.player.y);
    this.inventory = 'tray';
    this.tray.destroy(); this.tray = null;
    this.updateHUD();
  }

  dropCurrentItem(x, y) {
    const type = this.inventory;
    const behind = {
      up:    { dx:  0,  dy:  24 }, down:  { dx:  0,  dy: -24 },
      left:  { dx:  24, dy:  0  }, right: { dx: -24, dy:  0  },
    }[this.facing];
    const dropped = this.add.image(x + behind.dx, y + behind.dy, 'item_floor')
      .setScale(4).setDepth(1);
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
    this.thrownItem = null; this.thrownItemType = null;
    this.updateHUD();
  }

  // ─── THROW ─────────────────────────────────────────────────────────────────
  throwItem() {
    if (!this.inventory || this.thrownItem) return;
    this.thrownItemType = this.inventory;
    this.inventory      = null;
    this.thrownHasHit   = false;
    this.updateHUD();

    const dirVel = {
      up:    { vx:  0,           vy: -THROW_SPEED },
      down:  { vx:  0,           vy:  THROW_SPEED },
      left:  { vx: -THROW_SPEED, vy:  0           },
      right: { vx:  THROW_SPEED, vy:  0           },
    };
    const { vx, vy } = dirVel[this.facing];

    this.thrownItem = this.add.image(this.player.x, this.player.y, 'item_floor')
      .setScale(4).setDepth(3);
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

  settleThrown() {
    if (!this.thrownItem) return;
    if (this.settleTimer)   { this.settleTimer.remove(false);   this.settleTimer   = null; }
    if (this.throwCollider) { this.throwCollider.destroy();     this.throwCollider = null; }
    this.thrownItem.body.setVelocity(0);
    this.thrownItem.body.setImmovable(true);
    this.physics.add.overlap(this.player, this.thrownItem, this.pickupThrown, null, this);
  }

  // ─── MELEE ─────────────────────────────────────────────────────────────────
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
      this.attackFacing = null; this.attackItemType = null; this.attackHasHit = false;
    });
  }

  // ─── DOORS ─────────────────────────────────────────────────────────────────
  openDoor() {
    this.doorOpen = true;
    this.promptText.setText('');
    if (this.doorSprite) {
      this.doorSprite.play('door_open');
      this.doorSprite.once('animationcomplete', () => {
        if (this.doorBody)   { this.walls.remove(this.doorBody, true);  this.doorBody   = null; }
        if (this.doorSprite) { this.doorSprite.destroy();               this.doorSprite = null; }
      });
    } else {
      if (this.doorBody) { this.walls.remove(this.doorBody, true); this.doorBody = null; }
    }
  }

  openDoubleDoors() {
    this.doubleDoorOpen = true;
    this.promptText.setText('');
    const clearAll = () => {
      for (const dd of this.doubleDoorBodies) this.walls.remove(dd.rect, true);
      this.doubleDoorBodies = [];
      if (this.bigDoor1) { this.bigDoor1.destroy(); this.bigDoor1 = null; }
      if (this.bigDoor2) { this.bigDoor2.destroy(); this.bigDoor2 = null; }
    };
    if (this.bigDoor1) {
      this.bigDoor1.play('bigdoor_open');
      this.bigDoor1.once('animationcomplete', clearAll);
    }
    if (this.bigDoor2) this.bigDoor2.play('bigdoor_open');
    if (!this.bigDoor1 && !this.bigDoor2) clearAll();
  }

  // ─── CELL GUARD AI ─────────────────────────────────────────────────────────
  updateGuard() {
    if (!this.guard || this.guardStunned) return;
    const dist = Phaser.Math.Distance.Between(this.guard.x, this.guard.y, this.player.x, this.player.y);
    if (this.guardState === 'PATROL') {
      if (dist < GUARD_DETECT_RADIUS) {
        this.guardState = 'CHASE';
      } else {
        const target = this.patrolPoints[this.patrolIndex];
        const d = Phaser.Math.Distance.Between(this.guard.x, this.guard.y, target.x, target.y);
        if (d < 4) { this.guard.body.setVelocity(0); this.patrolIndex = 1 - this.patrolIndex; }
        else        { this.physics.moveTo(this.guard, target.x, target.y, GUARD_PATROL_SPEED); }
      }
    } else if (this.guardState === 'CHASE') {
      if (dist <= GUARD_ATTACK_RANGE) { this.guardState = 'ATTACK'; this.guard.body.setVelocity(0); }
      else                            { this.physics.moveTo(this.guard, this.player.x, this.player.y, GUARD_CHASE_SPEED); }
    } else if (this.guardState === 'ATTACK') {
      this.guard.body.setVelocity(0);
      if (dist > GUARD_ATTACK_RANGE) this.guardState = 'CHASE';
    }
    this.guardFacing = this._velFacing(this.guard.body, this.guardFacing);
    this._updateGuardAnim(this.guard, this.guardState, this.guardFacing);
  }

  hitGuard() {
    if (!this.guard || this.guardFlashing) return;
    if (this.guardState === 'PATROL') this.guardState = 'CHASE';
    this.guardHp--;
    if (this.guardHp <= 0) { this.killGuard(); return; }
    this.guardFlashing = true;
    this.guard.setTint(0xffffff);
    this.time.delayedCall(100, () => { if (this.guard) this.guard.clearTint(); this.guardFlashing = false; });
    this.guardStunned = true;
    this.guard.body.setVelocity(0);
    this.time.delayedCall(400, () => { this.guardStunned = false; });
  }

  killGuard() {
    if (this.guardAttackTimer) { this.guardAttackTimer.remove(false); this.guardAttackTimer = null; }
    if (this.guard) {
      this.guard.body.destroy();
      const dir  = this._dirKey(this.guardFacing);
      const dead = this.guard;
      this.guard = null;
      dead.play(`g_${dir}_death`);
      this.time.delayedCall(1000, () => dead.destroy());
    }
  }

  // ─── MESS GUARD AI ─────────────────────────────────────────────────────────
  hitMessGuard(mg) {
    if (!mg || !mg.rect || mg.flashing) return;
    if (mg.state === 'PATROL') mg.state = 'CHASE';
    mg.hp--;
    if (mg.hp <= 0) { this.killMessGuard(mg); return; }
    mg.flashing = true;
    mg.rect.setTint(0xffffff);
    this.time.delayedCall(100, () => { if (mg.rect) mg.rect.clearTint(); mg.flashing = false; });
    mg.stunned = true;
    mg.rect.body.setVelocity(0);
    this.time.delayedCall(400, () => { mg.stunned = false; });
  }

  killMessGuard(mg) {
    if (mg.attackTimer) { mg.attackTimer.remove(false); mg.attackTimer = null; }
    if (mg.rect) {
      mg.rect.body.destroy();
      const dir  = this._dirKey(mg.facing);
      const dead = mg.rect;
      mg.rect = null;
      dead.play(`g_${dir}_death`);
      this.time.delayedCall(1000, () => dead.destroy());
    }
  }

  updateMessGuards() {
    for (const mg of this.messGuards) {
      if (!mg || !mg.rect || mg.stunned) continue;
      const dist = Phaser.Math.Distance.Between(mg.rect.x, mg.rect.y, this.player.x, this.player.y);
      if (this.riotActive) {
        if (dist <= GUARD_ATTACK_RANGE) { mg.state = 'ATTACK'; mg.rect.body.setVelocity(0); }
        else                            { mg.state = 'CHASE';  this.physics.moveTo(mg.rect, this.player.x, this.player.y, GUARD_CHASE_SPEED); }
      } else {
        if (mg.state === 'PATROL') {
          if (dist < GUARD_DETECT_RADIUS) {
            mg.state = 'CHASE';
          } else {
            const target = mg.patrolPoints[mg.patrolIndex];
            const d = Phaser.Math.Distance.Between(mg.rect.x, mg.rect.y, target.x, target.y);
            if (d < 4) { mg.rect.body.setVelocity(0); mg.patrolIndex = 1 - mg.patrolIndex; }
            else        { this.physics.moveTo(mg.rect, target.x, target.y, GUARD_PATROL_SPEED); }
          }
        } else if (mg.state === 'CHASE') {
          if (dist <= GUARD_ATTACK_RANGE) { mg.state = 'ATTACK'; mg.rect.body.setVelocity(0); }
          else                            { this.physics.moveTo(mg.rect, this.player.x, this.player.y, GUARD_CHASE_SPEED); }
        } else if (mg.state === 'ATTACK') {
          mg.rect.body.setVelocity(0);
          if (dist > GUARD_ATTACK_RANGE) mg.state = 'CHASE';
        }
      }
      mg.facing = this._velFacing(mg.rect.body, mg.facing);
      this._updateGuardAnim(mg.rect, mg.state, mg.facing);
    }
  }

  // ─── PLAYER DAMAGE ─────────────────────────────────────────────────────────
  damagePlayer() {
    if (this.playerDead || this.playerFlashing) return;
    this.playerHp--;
    this.updateHUD();
    if (this.playerHp <= 0) { this.playerDead = true; this.killPlayer(); return; }
    this.playerFlashing = true;
    this.playerHurting  = true;
    this.player.setTint(0xff4444);
    const dir = this._dirKey(this.facing);
    this.player.play(`p_${dir}_hurt`, true);
    this.player.once('animationcomplete', () => {
      this.playerHurting  = false;
      this.playerFlashing = false;
      this.player.clearTint();
    });
  }

  killPlayer() {
    const dir = this._dirKey(this.facing);
    this.player.play(`p_${dir}_death`, true);
    if (this.guard) this.guard.body.setVelocity(0);
    for (const mg of this.messGuards) { if (mg && mg.rect) mg.rect.body.setVelocity(0); }
    this.add.rectangle(W / 2, H / 2, W, H, 0xff0000, 0.6).setDepth(20).setScrollFactor(0);
    this.time.delayedCall(800, () => this.scene.restart());
  }

  // ─── PRISONERS ─────────────────────────────────────────────────────────────
  updatePrisoners(delta) {
    const dirs = [
      { vx:  PRISONER_SPEED, vy: 0, f: 'right' },
      { vx: -PRISONER_SPEED, vy: 0, f: 'left'  },
      { vx: 0, vy:  PRISONER_SPEED, f: 'down'  },
      { vx: 0, vy: -PRISONER_SPEED, f: 'up'    },
    ];
    const franticDirs = [
      { vx:  180, vy: 0, f: 'right' }, { vx: -180, vy: 0, f: 'left' },
      { vx: 0, vy:  180, f: 'down'  }, { vx: 0, vy: -180, f: 'up'   },
    ];
    for (const p of this.prisoners) {
      if (!p.rect) continue;
      p.timer -= delta;
      if (p.timer <= 0) {
        if (p.frantic) {
          const d = Phaser.Utils.Array.GetRandom(franticDirs);
          p.rect.body.setVelocity(d.vx, d.vy);
          p.facing = d.f;
          p.timer  = Phaser.Math.Between(300, 800);
        } else {
          if (p.moving) {
            p.rect.body.setVelocity(0);
            p.moving = false;
            p.timer  = Phaser.Math.Between(800, 1800);
          } else {
            const d = Phaser.Utils.Array.GetRandom(dirs);
            p.rect.body.setVelocity(d.vx, d.vy);
            p.facing = d.f;
            p.moving = true;
            p.timer  = Phaser.Math.Between(1000, 2200);
          }
        }
      }
      this._updatePrisonerAnim(p);
    }
  }

  // ─── RIOT ──────────────────────────────────────────────────────────────────
  triggerRiot() {
    if (this.riotTriggered || this.playerDead || this.gameComplete) return;
    this.riotTriggered = true;
    let flashCount = 0;
    const doFlash = () => {
      this.cameras.main.flash(200, 255, 255, 255);
      if (++flashCount < 3) this.time.delayedCall(400, doFlash);
      else                  this.time.delayedCall(400, () => this._showRiotText());
    };
    doFlash();
  }

  _showRiotText() {
    const rt = this.add.text(W / 2, H / 2, 'RIOT', {
      fontFamily: 'monospace', fontSize: '48px', color: '#ff0000',
      stroke: '#ffffff', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30);
    this.time.delayedCall(1500, () => { rt.destroy(); this._activateRiot(); });
  }

  _activateRiot() {
    this.riotActive = true;
    for (const p of this.prisoners) { p.frantic = true; p.timer = 0; }
    if (this.guard) this.guardState = 'CHASE';
    for (const mg of this.messGuards) { if (mg && mg.rect) mg.state = 'CHASE'; }
    this._revealExitDoor();
  }

  _revealExitDoor() {
    this.exitDoorRevealed = true;
    for (const ed of this.exitDoorBodies) {
      this.walls.remove(ed.rect, true);
      if (ed.visual) { ed.visual.setTint(COLOR_EXIT); ed.visual.setAlpha(0.85); }
    }
    this.exitDoorBodies = [];
  }

  // ─── COMPLETION ────────────────────────────────────────────────────────────
  completeGame() {
    if (this.gameComplete) return;
    this.gameComplete = true;
    this.player.body.setVelocity(0);
    if (this.guard) this.guard.body.setVelocity(0);
    for (const mg of this.messGuards) { if (mg && mg.rect) mg.rect.body.setVelocity(0); }
    for (const p  of this.prisoners)  { if (p.rect) p.rect.body.setVelocity(0); }
    this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.88).setDepth(50).setScrollFactor(0);
    this.add.text(W/2, H/2 - 24, 'CHAPTER 1', {
      fontFamily: 'monospace', fontSize: '26px', color: '#ffffff',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);
    this.add.text(W/2, H/2 + 18, 'END', {
      fontFamily: 'monospace', fontSize: '44px', color: '#ff4444',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);
  }

  // ─── UPDATE ────────────────────────────────────────────────────────────────
  update(time, delta) {
    if (this.playerDead || this.gameComplete) return;

    const speed = 150;
    const body  = this.player.body;
    body.setVelocity(0);
    let movingX = false, movingY = false;

    if (this.keys.left.isDown)       { body.setVelocityX(-speed); movingX = true; this.facing = 'left'; }
    else if (this.keys.right.isDown) { body.setVelocityX(speed);  movingX = true; this.facing = 'right'; }
    if (this.keys.up.isDown)         { body.setVelocityY(-speed); movingY = true; if (!movingX) this.facing = 'up'; }
    else if (this.keys.down.isDown)  { body.setVelocityY(speed);  movingY = true; if (!movingX) this.facing = 'down'; }
    if (movingX && movingY) body.velocity.normalize().scale(speed);

    this._updatePlayerAnim(movingX, movingY);

    if (Phaser.Input.Keyboard.JustDown(this.keys.space)) this.spawnFlash();

    if (this.attackFlash && this.attackFacing) {
      const vis = this._itemVisual(this.attackItemType);
      const { dx, dy } = this._attackOffset(this.attackFacing, vis.w, vis.h);
      this.attackFlash.setPosition(this.player.x + dx, this.player.y + dy);
      if (!this.attackHasHit) {
        const fb = this.attackFlash.getBounds();
        if (this.guard && Phaser.Geom.Intersects.RectangleToRectangle(fb, this.guard.getBounds())) {
          this.attackHasHit = true; this.hitGuard();
        }
        if (!this.attackHasHit) {
          for (const mg of this.messGuards) {
            if (mg && mg.rect && Phaser.Geom.Intersects.RectangleToRectangle(fb, mg.rect.getBounds())) {
              this.attackHasHit = true; this.hitMessGuard(mg); break;
            }
          }
        }
      }
    }

    if (this.thrownItem && this.thrownItem.body && this.thrownItem.body.speed < SETTLE_SPEED) {
      this.settleThrown();
    }

    if (!this.messHallEntered && this.doubleDoorOpen && this.player.x > 24 * TILE) {
      this.messHallEntered = true;
      this.riotStartTime   = time;
      this.time.delayedCall(RIOT_TIMER_MS, () => this.triggerRiot());
    }

    if (this.riotStartTime !== null && !this.riotTriggered) {
      const secs = ((RIOT_TIMER_MS - (time - this.riotStartTime)) / 1000).toFixed(1);
      this.riotDebugText.setText(`RIOT: ${Math.max(0, secs)}s`);
    } else if (this.riotTriggered && this.riotDebugText.text !== '') {
      this.riotDebugText.setText('RIOT!');
    }

    let promptShown = false;

    if (this.riotActive && this.exitDoorRevealed && !promptShown) {
      const ex = 43 * TILE + TILE / 2, ey = 3 * TILE + TILE;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, ex, ey) < 50) {
        this.promptText.setText('ESCAPE (E)'); promptShown = true;
        if (Phaser.Input.Keyboard.JustDown(this.keys.e)) this.completeGame();
      }
    }
    if (!promptShown && this.doorOpen && !this.doubleDoorOpen) {
      const ddx = 23 * TILE + TILE / 2, ddy = 4 * TILE + TILE / 2;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, ddx, ddy) < 50) {
        this.promptText.setText('OPEN (E)'); promptShown = true;
        if (Phaser.Input.Keyboard.JustDown(this.keys.e)) this.openDoubleDoors();
      }
    }
    if (!promptShown && !this.guard && !this.doorOpen) {
      const doorX = 9 * TILE + TILE / 2, doorY = 4 * TILE + TILE / 2;
      if (Phaser.Math.Distance.Between(this.player.x, this.player.y, doorX, doorY) < 40) {
        this.promptText.setText('OPEN (E)'); promptShown = true;
        if (Phaser.Input.Keyboard.JustDown(this.keys.e)) this.openDoor();
      }
    }
    if (!promptShown) this.promptText.setText('');

    this.updateGuard();
    this.updateMessGuards();
    this.updatePrisoners(delta);
  }
}

const config = {
  type:            Phaser.AUTO,
  width:           W,
  height:          H,
  backgroundColor: '#000000',
  physics: {
    default: 'arcade',
    arcade:  { gravity: { y: 0 }, debug: false },
  },
  scene: CellScene,
};

new Phaser.Game(config);
