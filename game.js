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

const COLOR_FLOOR = 0x2a2a2a;
const COLOR_WALL  = 0x4a4a4a;
const COLOR_WALL_BORDER = 0x6a6a6a;
const COLOR_DOOR  = 0x5a3a1a;
const COLOR_PLAYER = 0xa0ffa0;

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
          // Floor
          gfx.fillStyle(COLOR_FLOOR);
          gfx.fillRect(x, y, TILE, TILE);
        } else if (tile === 1) {
          // Wall fill
          gfx.fillStyle(COLOR_WALL);
          gfx.fillRect(x, y, TILE, TILE);
          // Inner border to give depth
          gfx.lineStyle(1, COLOR_WALL_BORDER, 1);
          gfx.strokeRect(x + 1, y + 1, TILE - 2, TILE - 2);

          // Add invisible solid physics body for wall
          const wall = this.add.rectangle(x + TILE / 2, y + TILE / 2, TILE, TILE);
          this.physics.add.existing(wall, true);
          this.walls.add(wall);
        } else if (tile === 2) {
          // Door tile — visually distinct, solid for now
          gfx.fillStyle(COLOR_DOOR);
          gfx.fillRect(x, y, TILE, TILE);
          // Door frame lines
          gfx.lineStyle(2, 0x8a6a3a, 1);
          gfx.strokeRect(x + 2, y + 2, TILE - 4, TILE - 4);
          // Handle dot
          gfx.fillStyle(0xc8a060);
          gfx.fillRect(x + TILE - 8, y + TILE / 2 - 2, 4, 4);

          // Still solid in Stage 1
          const door = this.add.rectangle(x + TILE / 2, y + TILE / 2, TILE, TILE);
          this.physics.add.existing(door, true);
          this.walls.add(door);
        }
      }
    }

    // Player — 28x28 so collision box feels clean
    this.player = this.add.rectangle(W / 2, H / 2, 28, 28, COLOR_PLAYER);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(true);

    this.physics.add.collider(this.player, this.walls);

    // Camera locked to room, no scroll
    this.cameras.main.setBounds(0, 0, W, H);
    this.cameras.main.startFollow(this.player, true);

    // Input
    this.keys = this.input.keyboard.addKeys({
      up:    Phaser.Input.Keyboard.KeyCodes.W,
      down:  Phaser.Input.Keyboard.KeyCodes.S,
      left:  Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    });
  }

  update() {
    const speed = 150;
    const body = this.player.body;

    body.setVelocity(0);

    if (this.keys.left.isDown) {
      body.setVelocityX(-speed);
    } else if (this.keys.right.isDown) {
      body.setVelocityX(speed);
    }

    if (this.keys.up.isDown) {
      body.setVelocityY(-speed);
    } else if (this.keys.down.isDown) {
      body.setVelocityY(speed);
    }

    // Normalize diagonal speed
    if (body.velocity.x !== 0 && body.velocity.y !== 0) {
      body.velocity.normalize().scale(speed);
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
