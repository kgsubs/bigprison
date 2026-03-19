const TILE = 32;
const COLS = 10;
const ROWS = 8;
const W = COLS * TILE; // 320
const H = ROWS * TILE; // 256

// 0=floor, 1=wall, 2=door
const MAP = [
  [1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,1],
  [1,0,0,0,0,0,0,0,0,1],
  [1,1,1,1,2,1,1,1,1,1],
];

const COLOR_FLOOR        = 0x2a2a2a;
const COLOR_WALL         = 0x4a4a4a;
const COLOR_WALL_BORDER  = 0x6a6a6a;
const COLOR_DOOR         = 0x5a3a1a;
const COLOR_PLAYER       = 0xa0ffa0;
const COLOR_SHIV         = 0xd4883a;
const COLOR_GUARD        = 0xbb2222;

const THROW_SPEED         = 580;
const SETTLE_MS           = 3000;
const SETTLE_SPEED        = 12;

const GUARD_PATROL_SPEED  = 60;
const GUARD_CHASE_SPEED   = 90;
const GUARD_DETECT_RADIUS = 120;
const GUARD_ATTACK_RANGE  = 24;
const GUARD_ATTACK_MS     = 800;
const GUARD_HP_MAX        = 3;
const PLAYER_HP_MAX       = 5;

class CellScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CellScene' });
  }

  create() {
    // --- Tilemap ---
    this.walls = this.physics.add.staticGroup();
    const gfx = this.add.graphics();

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
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
          gfx.fillRect(x + TILE - 8, y + TILE / 2 - 2, 4, 4);
          const door = this.add.rectangle(x + TILE / 2, y + TILE / 2, TILE, TILE);
          this.physics.add.existing(door, true);
          this.walls.add(door);
        }
      }
    }

    // --- Guard ---
    const guardStartX = 7 * TILE + TILE / 2;
    const guardStartY = 2 * TILE + TILE / 2;
    this.guard = this.add.rectangle(guardStartX, guardStartY, 32, 32, COLOR_GUARD).setDepth(1);
    this.physics.add.existing(this.guard);
    this.guard.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.guard, this.walls);

    this.guardHp       = GUARD_HP_MAX;
    this.guardState    = 'PATROL';
    this.guardFlashing = false;
    this.patrolPoints  = [
      { x: 7 * TILE + TILE / 2, y: 2 * TILE + TILE / 2 },
      { x: 7 * TILE + TILE / 2, y: 5 * TILE + TILE / 2 },
    ];
    this.patrolIndex = 0;

    // Guard repeatedly tries to damage player when in ATTACK state
    this.guardAttackTimer = this.time.addEvent({
      delay: GUARD_ATTACK_MS,
      loop: true,
      callback: () => {
        if (this.guardState === 'ATTACK' && !this.playerDead) {
          this.damagePlayer();
        }
      },
    });

    // --- Player ---
    this.player = this.add.rectangle(W / 2, H / 2, 28, 28, COLOR_PLAYER).setDepth(2);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);

    // --- Player state ---
    this.playerHp      = PLAYER_HP_MAX;
    this.playerDead    = false;
    this.playerFlashing = false;
    this.facing        = 'down';
    this.inventory     = null;
    this.attackFlash   = null;
    this.attackFacing  = null;
    this.attackHasHit  = false;

    // --- Thrown item state ---
    this.thrownItem    = null;
    this.throwCollider = null;
    this.settleTimer   = null;
    this.thrownHasHit  = false;

    // --- Shiv on floor ---
    const shivX = 3 * TILE + TILE / 2;
    const shivY = 3 * TILE + TILE / 2;
    this.shiv = this.add.rectangle(shivX, shivY, 8, 16, COLOR_SHIV).setDepth(1);
    this.physics.add.existing(this.shiv);
    this.shiv.body.setImmovable(true);
    this.physics.add.overlap(this.player, this.shiv, this.pickupShiv, null, this);

    // --- Camera ---
    this.cameras.main.setBounds(0, 0, W, H);
    this.cameras.main.startFollow(this.player, true);

    // --- HUD ---
    this.hudText = this.add.text(8, 8, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(10);
    this.updateHUD();

    // --- Input ---
    this.keys = this.input.keyboard.addKeys({
      up:    Phaser.Input.Keyboard.KeyCodes.W,
      down:  Phaser.Input.Keyboard.KeyCodes.S,
      left:  Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
    });

    this.input.keyboard.on('keydown', (event) => {
      if (event.code === 'ShiftRight') this.throwItem();
    });
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

  pickupThrown() {
    if (!this.thrownItem) return;
    this.inventory = 'shiv';
    this.thrownItem.destroy();
    this.thrownItem = null;
    this.updateHUD();
  }

  // -------------------------------------------------------
  // Throw
  // -------------------------------------------------------
  throwItem() {
    if (this.inventory !== 'shiv') return;
    if (this.thrownItem) return;

    this.inventory = null;
    this.thrownHasHit = false;
    this.updateHUD();

    const dirVel = {
      up:    { vx:  0,           vy: -THROW_SPEED },
      down:  { vx:  0,           vy:  THROW_SPEED },
      left:  { vx: -THROW_SPEED, vy:  0           },
      right: { vx:  THROW_SPEED, vy:  0           },
    };
    const { vx, vy } = dirVel[this.facing];

    this.thrownItem = this.add.rectangle(this.player.x, this.player.y, 8, 16, COLOR_SHIV).setDepth(3);
    this.physics.add.existing(this.thrownItem);
    this.thrownItem.body.setBounce(0.15, 0.15);
    this.thrownItem.body.setDrag(300, 300);
    this.thrownItem.body.setVelocity(vx, vy);

    this.throwCollider = this.physics.add.collider(this.thrownItem, this.walls);

    // Thrown shiv damages guard on contact (once per throw)
    if (this.guard) {
      this.physics.add.overlap(this.thrownItem, this.guard, () => {
        if (!this.thrownHasHit) {
          this.thrownHasHit = true;
          this.hitGuard();
        }
      }, null, this);
    }

    this.settleTimer = this.time.delayedCall(SETTLE_MS, () => {
      this.settleThrown();
    });
  }

  // -------------------------------------------------------
  // Settle thrown item
  // -------------------------------------------------------
  settleThrown() {
    if (!this.thrownItem) return;
    if (this.settleTimer) { this.settleTimer.remove(false); this.settleTimer = null; }
    if (this.throwCollider) { this.throwCollider.destroy(); this.throwCollider = null; }

    this.thrownItem.body.setVelocity(0);
    this.thrownItem.body.setImmovable(true);
    this.physics.add.overlap(this.player, this.thrownItem, this.pickupThrown, null, this);
  }

  // -------------------------------------------------------
  // Attack offset
  // -------------------------------------------------------
  _attackOffset(dir) {
    switch (dir) {
      case 'right': return { dx:  22, dy:  0, w: 8, h: 16 };
      case 'left':  return { dx: -22, dy:  0, w: 8, h: 16 };
      case 'down':  return { dx:   0, dy: 26, w: 8, h: 16 };
      case 'up':    return { dx:   0, dy:-26, w: 8, h: 16 };
    }
  }

  // -------------------------------------------------------
  // Melee attack
  // -------------------------------------------------------
  spawnFlash() {
    if (this.inventory !== 'shiv' || this.attackFlash) return;

    const { dx, dy, w, h } = this._attackOffset(this.facing);
    this.attackFacing = this.facing;
    this.attackHasHit = false;
    this.attackFlash = this.add.rectangle(
      this.player.x + dx, this.player.y + dy, w, h, COLOR_SHIV
    ).setDepth(5);

    this.time.delayedCall(150, () => {
      if (this.attackFlash) { this.attackFlash.destroy(); this.attackFlash = null; }
      this.attackFacing = null;
      this.attackHasHit = false;
    });
  }

  // -------------------------------------------------------
  // Guard logic
  // -------------------------------------------------------
  updateGuard() {
    if (!this.guard) return;

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
      if (dist > GUARD_ATTACK_RANGE) {
        this.guardState = 'CHASE';
      }
    }
  }

  hitGuard() {
    if (!this.guard || this.guardFlashing) return;
    this.guardHp--;
    if (this.guardHp <= 0) {
      this.killGuard();
      return;
    }
    this.guardFlashing = true;
    this.guard.setFillStyle(0xffffff);
    this.time.delayedCall(100, () => {
      if (this.guard) this.guard.setFillStyle(COLOR_GUARD);
      this.guardFlashing = false;
    });
  }

  killGuard() {
    if (this.guardAttackTimer) { this.guardAttackTimer.remove(false); this.guardAttackTimer = null; }
    this.guard.destroy();
    this.guard = null;
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
    this.guard.body.setVelocity(0);
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0xff0000, 0.6)
      .setDepth(20).setScrollFactor(0);
    this.time.delayedCall(500, () => {
      this.scene.restart();
    });
  }

  // -------------------------------------------------------
  // Update
  // -------------------------------------------------------
  update() {
    if (this.playerDead) return;

    // --- Player movement ---
    const speed = 150;
    const body = this.player.body;
    body.setVelocity(0);

    let movingX = false;
    let movingY = false;

    if (this.keys.left.isDown) {
      body.setVelocityX(-speed);
      movingX = true;
      this.facing = 'left';
    } else if (this.keys.right.isDown) {
      body.setVelocityX(speed);
      movingX = true;
      this.facing = 'right';
    }

    if (this.keys.up.isDown) {
      body.setVelocityY(-speed);
      movingY = true;
      if (!movingX) this.facing = 'up';
    } else if (this.keys.down.isDown) {
      body.setVelocityY(speed);
      movingY = true;
      if (!movingX) this.facing = 'down';
    }

    if (movingX && movingY) {
      body.velocity.normalize().scale(speed);
    }

    // --- Melee ---
    if (Phaser.Input.Keyboard.JustDown(this.keys.space)) {
      this.spawnFlash();
    }

    // Keep attack weapon glued to player edge
    if (this.attackFlash && this.attackFacing) {
      const { dx, dy } = this._attackOffset(this.attackFacing);
      this.attackFlash.setPosition(this.player.x + dx, this.player.y + dy);

      // Melee hit detection against guard (manual bounds — attackFlash is not a physics body)
      if (!this.attackHasHit && this.guard) {
        const af = this.attackFlash.getBounds();
        const gf = this.guard.getBounds();
        if (Phaser.Geom.Intersects.RectangleToRectangle(af, gf)) {
          this.attackHasHit = true;
          this.hitGuard();
        }
      }
    }

    // --- Settle thrown item ---
    if (this.thrownItem && this.thrownItem.body && this.thrownItem.body.speed < SETTLE_SPEED) {
      this.settleThrown();
    }

    // --- Guard AI ---
    this.updateGuard();
  }
}

const config = {
  type: Phaser.AUTO,
  width: W,
  height: H,
  backgroundColor: '#111111',
  physics: {
    default: 'arcade',
    arcade: { gravity: { y: 0 }, debug: false },
  },
  scene: CellScene,
};

new Phaser.Game(config);
