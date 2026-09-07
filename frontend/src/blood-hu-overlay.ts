import { BufferGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry, Quaternion, Texture, Vector3 } from 'three';

import { AssetLoader } from './asset-loader';
import { Size } from './types';

const TILE_DU = 32 / 256;
const TILE_DV = 40 / 256;

export interface BloodHuOverlayRender {
  tileKey: number;
  position: Vector3;
  rotation: Quaternion;
  // three.js layer：0=主桌面；1=移动端手牌视口
  layer: number;
  badgePosition: Vector3;
  badgeRotation: Quaternion;
  hideTile?: boolean;
}

export interface GuobiaoSeatInnerDisplayTileRender {
  tileKey: number;
  position: Vector3;
  rotation: Quaternion;
  layer: number;
  scale: number;
}

export class BloodHuOverlay {
  private parent: Group;
  private badgeTexture: Texture | null;
  private badgeAspect: number;
  private seats: Array<{
    tileGroup: Group;
    tile: Mesh;
    badgeGroup: Group;
    badge: Mesh;
    lastTileKey: number | null;
  }>;

  constructor(assetLoader: AssetLoader, parent: Group) {
    this.parent = parent;
    this.badgeTexture = (assetLoader.textures.huBadge as Texture | undefined) ?? null;
    this.badgeAspect = 1;
    {
      const w = (this.badgeTexture?.image as any)?.width;
      const h = (this.badgeTexture?.image as any)?.height;
      if (typeof w === 'number' && typeof h === 'number' && h > 0) {
        this.badgeAspect = w / h;
      }
    }
    this.seats = [];

    for (let seat = 0; seat < 4; seat++) {
      const tileGroup = new Group();
      tileGroup.visible = false;
      tileGroup.name = `bloodHuOverlayTile@${seat}`;

      const tile = assetLoader.make('tile');
      tile.name = `huTile@${seat}`;
      // 这些 mesh 来自 GLB，确保本地变换为 identity（胡牌的位置由 group 统一控制）。
      tile.position.set(0, 0, 0);
      tile.rotation.set(0, 0, 0);
      tile.scale.setScalar(1);
      // 该 mesh 默认会共享 GLB 的 geometry；这里克隆一份并缓存 base UV，
      // 以便后续反复切换牌面（不同胡牌）时不会叠加偏移或误 dispose 共享几何。
      {
        const geom = tile.geometry.clone() as BufferGeometry;
        tile.geometry = geom;
        const uvs = geom.attributes.uv?.array as Float32Array | undefined;
        if (uvs) {
          tile.userData.baseUvs = new Float32Array(uvs);
        }
      }
      // 单独渲染一张牌（不走 instanced），保持与桌面一致的 3D 厚度。
      tile.castShadow = false;
      tile.receiveShadow = false;
      tileGroup.add(tile);

      const badgeGroup = new Group();
      badgeGroup.visible = false;
      badgeGroup.name = `bloodHuOverlayBadge@${seat}`;

      const badge = this.makeHuBadgeMesh();
      badge.name = `huBadge@${seat}`;
      badge.position.set(0, 0, 0);
      badge.rotation.set(0, 0, 0);
      badgeGroup.add(badge);

      this.parent.add(tileGroup);
      this.parent.add(badgeGroup);

      this.seats.push({ tileGroup, tile, badgeGroup, badge, lastTileKey: null });
    }
  }

  update(overlays: Array<BloodHuOverlayRender | null>): void {
    for (let seat = 0; seat < 4; seat++) {
      const info = overlays[seat] ?? null;
      const item = this.seats[seat];
      if (!info) {
        item.tileGroup.visible = false;
        item.badgeGroup.visible = false;
        item.lastTileKey = null;
        continue;
      }

      item.tileGroup.visible = info.hideTile !== true;
      if (item.tileGroup.visible) {
        item.tileGroup.position.copy(info.position);
        item.tileGroup.setRotationFromQuaternion(info.rotation);
        item.tileGroup.traverse((o) => o.layers.set(info.layer));
      }

      item.badgeGroup.visible = this.badgeTexture !== null;
      if (item.badgeGroup.visible) {
        item.badgeGroup.position.copy(info.badgePosition);
        item.badgeGroup.setRotationFromQuaternion(info.badgeRotation);
        item.badgeGroup.traverse((o) => o.layers.set(info.layer));
      }

      if (item.tileGroup.visible && item.lastTileKey !== info.tileKey) {
        this.applyTileKey(item.tile, info.tileKey);
        item.lastTileKey = info.tileKey;
      }

      // 本项目关闭了 scene.matrixWorldAutoUpdate；需要手动刷新矩阵，否则 position/rotation 的变更不会立刻反映到渲染结果。
      if (item.tileGroup.visible) {
        item.tileGroup.updateMatrixWorld(true);
      }
      if (item.badgeGroup.visible) {
        item.badgeGroup.updateMatrixWorld(true);
      }
    }
  }

  private applyTileKey(mesh: Mesh, tileKey: number): void {
    const x = (tileKey % 37) % 8;
    const y = Math.floor((tileKey % 37) / 8);
    const back = 0;

    const geometry = mesh.geometry as BufferGeometry;
    const uvs: Float32Array | undefined = geometry.attributes.uv?.array as Float32Array | undefined;
    const baseUvs: Float32Array | undefined = mesh.userData.baseUvs as Float32Array | undefined;
    if (!uvs || !baseUvs || baseUvs.length !== uvs.length) {
      return;
    }
    for (let i = 0; i < uvs.length; i += 2) {
      const u0 = baseUvs[i]!;
      const v0 = baseUvs[i + 1]!;
      if (u0 <= TILE_DU && v0 <= TILE_DV) {
        uvs[i] = u0 + x * TILE_DU;
        uvs[i + 1] = v0 + y * TILE_DV;
      } else if (v0 >= 4 * TILE_DV) {
        uvs[i] = u0;
        uvs[i + 1] = v0 + back * TILE_DV;
      } else {
        uvs[i] = u0;
        uvs[i + 1] = v0;
      }
    }
    geometry.attributes.uv.needsUpdate = true;
  }

  private makeHuBadgeMesh(): Mesh {
    const geom = new PlaneGeometry(1, 1);
    // AssetLoader 统一把 texture.flipY 设为 false（glTF UV 约定）。
    // PlaneGeometry 默认 UV(v=1 在上)，这里翻转 v 以保证图片方向正常。
    const uvs = geom.attributes.uv?.array as Float32Array | undefined;
    if (uvs) {
      for (let i = 0; i < uvs.length; i += 2) {
        uvs[i + 1] = 1 - uvs[i + 1]!;
      }
      geom.attributes.uv.needsUpdate = true;
    }
    const mat = new MeshBasicMaterial({
      map: this.badgeTexture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new Mesh(geom, mat);
    mesh.renderOrder = 3000;

    // 需求：胡字标识接近 1.5 张牌高（以 TILE.y 为基准），并按图片宽高比缩放。
    const h = Size.TILE.y * 1.5;
    const w = h * this.badgeAspect;
    mesh.scale.set(w, h, 1);
    return mesh;
  }
}

export class GuobiaoSeatInnerDisplayOverlay {
  private parent: Group;
  private assetLoader: AssetLoader;
  private tiles: Array<{
    mesh: Mesh;
    lastTileKey: number | null;
  }>;

  constructor(assetLoader: AssetLoader, parent: Group) {
    this.parent = parent;
    this.assetLoader = assetLoader;
    this.tiles = [];

    // 国标座位内侧展示区：4 个座位 * (8 张花牌 + 1 张胡牌)。
    for (let i = 0; i < 36; i++) {
      const mesh = this.createTileMesh();
      mesh.visible = false;
      mesh.name = `guobiaoSeatInnerDisplayTile@${i}`;
      mesh.renderOrder = 2500;
      this.parent.add(mesh);
      this.tiles.push({ mesh, lastTileKey: null });
    }
  }

  update(overlays: Array<GuobiaoSeatInnerDisplayTileRender>): void {
    for (let i = 0; i < this.tiles.length; i++) {
      const item = this.tiles[i]!;
      const info = overlays[i] ?? null;
      if (!info) {
        item.mesh.visible = false;
        item.lastTileKey = null;
        continue;
      }

      item.mesh.visible = true;
      item.mesh.position.copy(info.position);
      item.mesh.setRotationFromQuaternion(info.rotation);
      item.mesh.scale.setScalar(info.scale);
      item.mesh.traverse((o) => o.layers.set(info.layer));

      if (item.lastTileKey !== info.tileKey) {
        this.applyTileKey(item.mesh, info.tileKey);
        item.lastTileKey = info.tileKey;
      }

      item.mesh.updateMatrix();
      item.mesh.updateMatrixWorld(true);
    }
  }

  private createTileMesh(): Mesh {
    const mesh = this.assetLoader.make('tile');
    const material = mesh.material as MeshLambertMaterial;
    const guobiaoTexture = this.assetLoader.textures.guobiaoTiles;
    if (guobiaoTexture) {
      material.map = guobiaoTexture;
      material.needsUpdate = true;
    }

    const geometry = mesh.geometry.clone() as BufferGeometry;
    mesh.geometry = geometry;
    const uvs = geometry.attributes.uv?.array as Float32Array | undefined;
    if (uvs) {
      mesh.userData.baseUvs = new Float32Array(uvs);
    }
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }

  private applyTileKey(mesh: Mesh, tileKey: number): void {
    const normalized = Math.max(0, Math.min(41, Math.trunc(tileKey)));
    const col = normalized % 16;
    const row = Math.floor(normalized / 16);
    const scaleX = 0.5;

    const geometry = mesh.geometry as BufferGeometry;
    const uvs: Float32Array | undefined = geometry.attributes.uv?.array as Float32Array | undefined;
    const baseUvs: Float32Array | undefined = mesh.userData.baseUvs as Float32Array | undefined;
    if (!uvs || !baseUvs || baseUvs.length !== uvs.length) {
      return;
    }

    for (let i = 0; i < uvs.length; i += 2) {
      const u0 = baseUvs[i]!;
      const v0 = baseUvs[i + 1]!;
      if (u0 <= TILE_DU && v0 <= TILE_DV) {
        uvs[i] = u0 * scaleX + col * TILE_DU * scaleX;
        uvs[i + 1] = v0 + row * TILE_DV;
      } else if (v0 >= 4 * TILE_DV) {
        uvs[i] = u0;
        uvs[i + 1] = v0;
      } else {
        uvs[i] = u0;
        uvs[i + 1] = v0;
      }
    }
    geometry.attributes.uv.needsUpdate = true;
  }
}
