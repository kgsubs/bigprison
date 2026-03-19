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

const COLOR_FLOOR       = 0x2a2a2a;
const COLOR_WALL        = 0x4a4a4a;
const COLOR_WALL_BORDER = 0x6a6a6a;
const COLOR_DOOR        = 0x5a3a1a;
const COLOR_PLAYER      = 0xa0ffa0;
const COLOR_SHIV        = 0xd4883a;
const COLOR_FLASH       = 0xffffff;

class CellScene extends Phaser.Scene {
  constructor() {
    super({ key: 'CellScene' });
  }

  create() {
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

    // Player
    this.player = this.add.rectangle(W / 2, H / 2, 28, 28, COLOR_PLAYER);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.walls);

    // Camera
    this.cameras.main.setBounds(0, 0, W, H);
    this.cameras.main.startFollow(this.player, true);

    // State
    this.facing = 'down';
    this.inventory = null;
    this.flashActive = false;

    // Shiv — placed at tile (3,3), centered
    const shivX = 3 * TILE + TILE / 2;
    const shivY = 3 * TILE + TILE / 2;
    this.shiv = this.add.rectangle(shivX, shivY, 8, 16, COLOR_SHIV);
    this.physics.add.existing(this.shiv);
    this.shiv.body.setImmovable(true);
    this.physics.add.overlap(this.player, this.shiv, this.pickupShiv, null, this);

    // HUD — fixed to camera via setScrollFactor(0)
    this.hudText = this.add.text(8, 8, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
    }).setScrollFactor(0).setDepth(10);

    // Input
    this.keys = this.input.keyboard.addKeys({
      up:    Phaser.Input.Keyboard.KeyCodes.W,
      down:  Phaser.Input.Keyboard.KeyCodes.S,
      left:  Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
    });
  }

  pickupShiv() {
    this.inventory = 'shiv';
    this.shiv.destroy();
    this.shiv = null;
    this.hudText.setText('SHIV');
  }

  spawnFlash() {
    if (this.inventory !== 'shiv' || this.flashActive) return;

    const offsets = {
      up:    { dx:  0, dy: -TILE },
      down:  { dx:  0, dy:  TILE },
      left:  { dx: -TILE, dy: 0 },
      right: { dx:  TILE, dy: 0 },
    };
    const { dx, dy } = offsets[this.facing];
    const fx = this.player.x + dx;
    const fy = this.player.y + dy;

    this.flashActive = true;
    const flash = this.add.rectangle(fx, fy, 16, 16, COLOR_FLASH).setDepth(5);
    this.time.delayedCall(150, () => {
      flash.destroy();
      this.flashActive = false;
    });
  }

  update() {
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

    // Normalize diagonal speed
    if (movingX && movingY) {
      body.velocity.normalize().scale(speed);
    }

    // Attack
    if (Phaser.Input.Keyboard.JustDown(this.keys.space)) {
      this.spawnFlash();
    }
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
