import { Group, Mesh, Vector3, MeshBasicMaterial, MeshLambertMaterial, Object3D, PlaneGeometry, InstancedMesh, BufferGeometry } from "three";
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { World } from "./world";
import { Client } from "./client";
import { AssetLoader } from "./asset-loader";
import { BloodHuOverlay, GuobiaoSeatInnerDisplayOverlay, type BloodHuOverlayRender, type GuobiaoSeatInnerDisplayTileRender } from "./blood-hu-overlay";
import { Center, CenterStyle } from "./center";
import { ThingParams, ThingGroup, TileThingGroup, StickThingGroup, MarkerThingGroup } from "./thing-group";
import { ThingType, Place, TileVariant } from "./types";

export interface Render {
  type: ThingType;
  thingIndex: number;
  place: Place;
  scale: number;
  selected: boolean;
  hovered: boolean;
  held: boolean;
  temporary: boolean;
  bottom: boolean;
  // three.js layers（0=桌面默认层；1=移动端手牌视口层）
  layer: number;
}

const MAX_SHADOWS = 300;
const HAND_VIEW_LAYER = 1;

export class ObjectView {
  mainGroup: Group;
  private assetLoader: AssetLoader;
  private options: {
    showTable: boolean;
    showSticks: boolean;
    showTrays: boolean;
    tableScale: number;
    centerStyle: CenterStyle;
    showBloodDingqueMarkers: boolean;
  };

  private center: Center;

  private thingGroups: Map<ThingType, ThingGroup>;

  private shadowObject: InstancedMesh;
  private dropShadowProto: Mesh;
  private dropShadowObjects: Array<Mesh>;

  selectedObjects: Array<Mesh>;
  private bloodHuOverlay: BloodHuOverlay;
  private guobiaoSeatInnerDisplayOverlay: GuobiaoSeatInnerDisplayOverlay;

  constructor(
    mainGroup: Group,
    assetLoader: AssetLoader,
    client: Client,
    options?: {
      showTable?: boolean;
      showSticks?: boolean;
      showTrays?: boolean;
      tableScale?: number;
      centerStyle?: CenterStyle;
      showBloodDingqueMarkers?: boolean;
    },
  ) {
    this.mainGroup = mainGroup;
    this.assetLoader = assetLoader;
    this.options = {
      showTable: options?.showTable ?? true,
      showSticks: options?.showSticks ?? true,
      showTrays: options?.showTrays ?? true,
      tableScale: options?.tableScale ?? 1,
      centerStyle: options?.centerStyle ?? 'default',
      showBloodDingqueMarkers: options?.showBloodDingqueMarkers ?? true,
    };

    this.center = new Center(this.assetLoader, client, { style: this.options.centerStyle });
    this.center.mesh.position.set(World.WIDTH / 2, World.WIDTH / 2, 0.75);
    this.dropShadowObjects = [];
    this.selectedObjects = [];

    this.thingGroups = new Map();
    this.thingGroups.set(ThingType.TILE, new TileThingGroup(this.assetLoader, this.mainGroup));
    if (this.options.showSticks) {
      this.thingGroups.set(ThingType.STICK, new StickThingGroup(this.assetLoader, this.mainGroup));
    }
    const markerGroup = new MarkerThingGroup(this.assetLoader, this.mainGroup, client);
    markerGroup.setShowBloodDingqueMarkers(this.options.showBloodDingqueMarkers);
    this.thingGroups.set(ThingType.MARKER, markerGroup);

    const plane = new PlaneGeometry(1, 1, 1);
    let material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.1,
      color: 0,
      depthWrite: false,
    });
    this.shadowObject = new InstancedMesh(plane, material, MAX_SHADOWS);
    this.shadowObject.visible = true;
    this.mainGroup.add(this.shadowObject);

    material = material.clone();
    material.opacity = 0.2;

    this.dropShadowProto = new Mesh(plane, material);
    this.dropShadowProto.name = 'dropShadow';

    this.addStatic();
    this.bloodHuOverlay = new BloodHuOverlay(this.assetLoader, this.mainGroup);
    this.guobiaoSeatInnerDisplayOverlay = new GuobiaoSeatInnerDisplayOverlay(this.assetLoader, this.mainGroup);
  }

  replaceThings(params: Map<number, ThingParams>): void {
    for (const type of [ThingType.TILE, ThingType.STICK, ThingType.MARKER]) {
      const thingGroup = this.thingGroups.get(type);
      if (!thingGroup) {
        continue;
      }
      const typeParams = [...params.values()].filter(p => p.type === type);
      typeParams.sort((a, b) => a.index - b.index);

      if (typeParams.length === 0) {
        if (type === ThingType.MARKER) {
          thingGroup.replace(0, []);
        }
        continue;
      }
      const startIndex = typeParams[0].index;
      thingGroup.replace(startIndex, typeParams);
    }
  }

  replaceShadows(places: Array<Place>): void {
    const dummy = new Object3D();

    this.shadowObject.count = 0;
    for (const place of places) {
      dummy.position.set(place.position.x, place.position.y, 0.1);
      dummy.scale.set(place.size.x, place.size.y, 1);
      dummy.updateMatrix();

      const idx = this.shadowObject.count++;
      this.shadowObject.setMatrixAt(idx, dummy.matrix);
    }
    this.shadowObject.instanceMatrix.needsUpdate = true;
  }

  private addStatic(): void {
    const tableMesh = this.options.showTable ? this.assetLoader.makeTable({ repeatScale: this.options.tableScale }) : null;
    if (tableMesh) {
      tableMesh.position.set(World.WIDTH / 2, World.WIDTH / 2, 0);
      tableMesh.scale.setScalar(this.options.tableScale);
      // 让桌布同时出现在“桌面视角(0)”与“底部手牌视角(1)”里，避免手牌视口背景变黑。
      tableMesh.layers.enable(HAND_VIEW_LAYER);
      this.mainGroup.add(tableMesh);
    }
    this.mainGroup.add(this.center.mesh);

    tableMesh?.updateMatrixWorld();
    this.center.mesh.updateMatrixWorld();

    if (this.options.showTrays) {
      const tray = this.assetLoader.makeTray();
      tray.updateMatrixWorld();
      const geometries: Array<BufferGeometry> = [];
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 6; j++) {
          const trayPos = new Vector3(
            25 + 24 * j - World.WIDTH / 2,
            -33 - World.WIDTH / 2,
            0
          );
          trayPos.applyAxisAngle(new Vector3(0, 0, 1), Math.PI * i / 2);

          const geometry = tray.geometry.clone();

          geometry.rotateZ(Math.PI * i / 2);
          geometry.translate(
            trayPos.x + World.WIDTH / 2,
            trayPos.y + World.WIDTH / 2,
            0
          );

          geometries.push(geometry);
        }
      }
      tray.geometry = mergeGeometries(geometries);
      tray.position.set(0, 0, 0);
      this.mainGroup.add(tray);
      tray.updateMatrixWorld();
    }
  }

  updateScores(scores: Array<number | null>): void {
    this.center.setScores(scores);
    this.center.draw();
  }

  getMeshForThing(type: ThingType, thingIndex: number): Mesh | null {
    const group = this.thingGroups.get(type);
    if (!group) {
      return null;
    }
    return group.getMesh(thingIndex);
  }

  setTileTypeIndex(tileId: number, typeIndex: number): void {
    const group = this.thingGroups.get(ThingType.TILE) as TileThingGroup | undefined;
    if (!group) return;
    group.setTypeIndex(tileId, typeIndex);
  }

  setGuobiaoTileAtlas(enabled: boolean): void {
    const group = this.thingGroups.get(ThingType.TILE) as TileThingGroup | undefined;
    if (!group) return;
    group.setGuobiaoTileAtlas(enabled);
  }

  updateThings(things: Array<Render>): void {
    this.selectedObjects.splice(0);
    for (const thing of things) {
      const layer = Number.isFinite(thing.layer) ? thing.layer : 0;
      const thingGroup = this.thingGroups.get(thing.type);
      if (!thingGroup) {
        continue;
      }
      // 手牌视口层（layer=1）必须用“独立 Mesh”渲染，才能被 handCamera 单独渲染（InstancedMesh 无法按实例分层）。
      const forceCustom = layer === HAND_VIEW_LAYER;
      const custom = forceCustom || thing.hovered || thing.selected || thing.held || thing.bottom;
      if (!custom && thingGroup.canSetSimple()) {
        thingGroup.setSimple(thing.thingIndex, thing.place.position, thing.place.rotation, thing.scale);
        continue;
      }

      const obj = thingGroup.setCustom(
        thing.thingIndex, thing.place.position, thing.place.rotation, thing.scale);
      // layers 不会自动继承到子节点（例如定缺标识的文字平面），所以需要 traverse 统一设置
      obj.traverse((o) => o.layers.set(layer));

      const material = obj.material as MeshLambertMaterial;
      const wasTransparent = material.transparent;

      material.color.set(1.0, 1.0, 1.0);
      material.emissive.set(0.0, 0.0, 0.0);
      material.transparent = false;
      material.depthTest = true;
      obj.renderOrder = 0;

      if (thing.hovered) {
        material.emissive.set(0.05, 0.05, 0.05);
      }

      if (thing.bottom) {
        material.color.set(0.8, 0.8, 0.8);
      }

      if (thing.selected) {
        this.selectedObjects.push(obj);
      }

      if (thing.held) {
        material.transparent = true;
        material.opacity = thing.temporary ? 0.7 : 1;
        material.depthTest = false;
        obj.position.z += 1;
        obj.renderOrder = 1;
      }

      if (material.transparent !== wasTransparent) {
        material.needsUpdate = true;
      }

      obj.updateMatrix();
      obj.updateMatrixWorld();
    }
  }

  updateDropShadows(places: Array<Place>): void {
    for (const obj of this.dropShadowObjects) {
      this.mainGroup.remove(obj);
    }
    this.dropShadowObjects.splice(0);

    for (const place of places) {
      const obj = this.dropShadowProto.clone();
      obj.position.set(
        place.position.x,
        place.position.y,
        place.position.z - place.size.z/2 + 0.2);
      obj.scale.set(place.size.x, place.size.y, 1);
      this.dropShadowObjects.push(obj);
      this.mainGroup.add(obj);
      obj.updateMatrixWorld();
    }
  }

  updateBloodHuOverlays(overlays: Array<BloodHuOverlayRender | null>): void {
    this.bloodHuOverlay.update(overlays);
  }

  updateGuobiaoSeatInnerDisplay(overlays: Array<GuobiaoSeatInnerDisplayTileRender>): void {
    this.guobiaoSeatInnerDisplayOverlay.update(overlays);
  }

  setTileVariant(tileVariant: TileVariant) {
    const tileThingGroup = this.thingGroups.get(ThingType.TILE) as TileThingGroup;
    tileThingGroup.setVariant(tileVariant);
  }
}
