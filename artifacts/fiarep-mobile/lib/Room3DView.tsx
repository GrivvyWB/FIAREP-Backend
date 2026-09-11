import { useRef } from 'react';
import { View, Text, PanResponder } from 'react-native';
import { GLView } from 'expo-gl';
import * as THREE from 'three';

export type Geo3D = {
  kind: string;
  wFt: number;
  hFt: number;
  tFt: number;
  m: number[]; // column-major 4x4; translation (m[12..14]) in meters, RoomPlan Y-up
};

const M_TO_FT = 3.28084;

export function Room3DView({ geometry, height = 340 }: { geometry: Geo3D[]; height?: number }) {
  const rot = useRef({ x: -0.85, y: 0.6 });
  const dist = useRef(30);
  const cam = useRef<THREE.PerspectiveCamera | null>(null);
  const target = useRef(new THREE.Vector3(0, 4, 0));

  const applyCam = () => {
    const c = cam.current; if (!c) return;
    const { x, y } = rot.current; const d = dist.current;
    c.position.set(
      target.current.x + d * Math.cos(x) * Math.sin(y),
      target.current.y + d * Math.sin(-x),
      target.current.z + d * Math.cos(x) * Math.cos(y),
    );
    c.lookAt(target.current);
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_e, g) => {
        rot.current.y -= g.dx * 0.005;
        rot.current.x -= g.dy * 0.005;
        rot.current.x = Math.max(-1.5, Math.min(-0.05, rot.current.x));
        applyCam();
      },
    })
  ).current;

  if (!geometry || geometry.length === 0) {
    return <Text style={{ color: '#999', fontSize: 13 }}>No 3D data (scan a room to capture geometry).</Text>;
  }

  const onCreate = async (gl: any) => {
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    // expo-gl: give three a fake canvas so it never touches `document`
    const canvas = {
      width, height,
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      clientHeight: height,
      getContext: () => gl,
    } as any;
    const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
    renderer.setSize(width, height, false);
    renderer.setClearColor(0xf2f2f2, 1);

    const sc = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      50, gl.drawingBufferWidth / gl.drawingBufferHeight, 0.1, 1000
    );
    cam.current = camera;

    sc.add(new THREE.AmbientLight(0xffffff, 0.75));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(10, 20, 10); sc.add(dir);
    const dir2 = new THREE.DirectionalLight(0xffffff, 0.25);
    dir2.position.set(-10, 8, -6); sc.add(dir2);

    // bounding box over wall extents (account for each wall's half-width along its facing)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
    geometry.forEach(el => {
      const px = el.m[12] * M_TO_FT, pz = el.m[14] * M_TO_FT;
      const half = Math.max(el.wFt, 1) / 2;
      minX = Math.min(minX, px - half); maxX = Math.max(maxX, px + half);
      minZ = Math.min(minZ, pz - half); maxZ = Math.max(maxZ, pz + half);
      maxY = Math.max(maxY, el.hFt);
    });
    const ctrX = (minX + maxX) / 2, ctrZ = (minZ + maxZ) / 2;
    const spanX = maxX - minX, spanZ = maxZ - minZ;
    const roomH = maxY || (geometry[0]?.hFt ?? 8);
    const roomSize = Math.max(spanX, spanZ, roomH, 4);
    dist.current = roomSize * 1.7;
    target.current.set(0, roomH / 2, 0);

    const wallMat = new THREE.MeshLambertMaterial({ color: 0xdfe3e8 });
    const openingMat = new THREE.MeshLambertMaterial({ color: 0xc9a27a });
    geometry.forEach(el => {
      const th = el.tFt > 0.05 ? el.tFt : 0.3;
      const geo = new THREE.BoxGeometry(el.wFt, el.hFt, th);
      const mesh = new THREE.Mesh(geo, el.kind === 'wall' ? wallMat : openingMat);
      const m = el.m;
      // three reads column-major arrays natively — no manual element shuffling
      const mat4 = new THREE.Matrix4().fromArray(m);
      // extract rotation + position from RoomPlan's matrix
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      mat4.decompose(pos, quat, scl);
      // apply rotation only; set our own position (converted m->ft, recentered)
      mesh.quaternion.copy(quat);
      mesh.position.set(
        m[12] * M_TO_FT - ctrX,
        m[13] * M_TO_FT,
        m[14] * M_TO_FT - ctrZ,
      );
      sc.add(mesh);
    });

    const fW = (maxX - minX) + 3, fD = (maxZ - minZ) + 3;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(fW, fD),
      new THREE.MeshLambertMaterial({ color: 0xeaeaea, side: THREE.DoubleSide })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    sc.add(floor);

    applyCam();

    const loop = () => {
      requestAnimationFrame(loop);
      renderer.render(sc, camera);
      gl.endFrameEXP();
    };
    loop();
  };

  return (
    <View style={{ height, borderRadius: 8, overflow: 'hidden', backgroundColor: '#f2f2f2' }} {...pan.panHandlers}>
      <GLView style={{ flex: 1 }} onContextCreate={onCreate} />
    </View>
  );
}
