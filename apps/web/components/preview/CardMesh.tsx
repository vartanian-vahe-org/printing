'use client';

import { useThree } from '@react-three/fiber';
import { useEffect, useMemo } from 'react';
import { DoubleSide, ExtrudeGeometry, Shape, ShapeGeometry, type Texture } from 'three';
import { faceUv, finishMaterial, THICKNESS_EXAGGERATION, type CardSpec, type Finish } from '../../lib/card3d';
import { blankFace, paperGrain, placeholderBack, placeholderFront } from './textures';

const CURVE_SEGMENTS = 24;
/** Lifts each face off the edge body to avoid z-fighting. */
const FACE_OFFSET = 0.0004;

function cardShape(widthIn: number, heightIn: number, radiusIn: number): Shape {
  const x = -widthIn / 2;
  const y = -heightIn / 2;
  const r = radiusIn;
  const shape = new Shape();
  if (r <= 0) {
    shape.moveTo(x, y);
    shape.lineTo(x + widthIn, y);
    shape.lineTo(x + widthIn, y + heightIn);
    shape.lineTo(x, y + heightIn);
    shape.closePath();
    return shape;
  }
  shape.moveTo(x + r, y);
  shape.lineTo(x + widthIn - r, y);
  shape.absarc(x + widthIn - r, y + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(x + widthIn, y + heightIn - r);
  shape.absarc(x + widthIn - r, y + heightIn - r, r, 0, Math.PI / 2, false);
  shape.lineTo(x + r, y + heightIn);
  shape.absarc(x + r, y + heightIn - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(x, y + r);
  shape.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

/** Flat face whose UVs span the full card (0..1), so artwork maps edge to edge. */
function faceGeometry(shape: Shape, widthIn: number, heightIn: number): ShapeGeometry {
  const geometry = new ShapeGeometry(shape, CURVE_SEGMENTS);
  const position = geometry.attributes.position!;
  const uv = geometry.attributes.uv!;
  for (let i = 0; i < position.count; i++) {
    const [u, v] = faceUv(position.getX(i), position.getY(i), widthIn, heightIn);
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geometry;
}

function FaceMaterial({ finish, map, grain }: { finish: Finish; map: Texture; grain: Texture | null }) {
  const m = finishMaterial(finish);
  return (
    <meshPhysicalMaterial
      map={map}
      color={m.color}
      roughness={m.roughness}
      clearcoat={m.clearcoat}
      clearcoatRoughness={m.clearcoatRoughness}
      sheen={m.sheen}
      sheenRoughness={m.sheenRoughness}
      sheenColor="#ffffff"
      envMapIntensity={m.envMapIntensity}
      bumpMap={m.paperGrain && grain ? grain : null}
      bumpScale={m.paperGrain ? 0.0015 : 0}
      side={DoubleSide}
    />
  );
}

export interface CardArtwork {
  front?: Texture;
  back?: Texture;
}

export function CardMesh({ spec, artwork }: { spec: CardSpec; artwork?: CardArtwork }) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  const anisotropy = gl.capabilities.getMaxAnisotropy();
  const depth = spec.thicknessIn * THICKNESS_EXAGGERATION;

  const { edge, face } = useMemo(() => {
    const shape = cardShape(spec.widthIn, spec.heightIn, spec.radiusIn);
    const edgeGeometry = new ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: CURVE_SEGMENTS });
    edgeGeometry.translate(0, 0, -depth / 2);
    return { edge: edgeGeometry, face: faceGeometry(shape, spec.widthIn, spec.heightIn) };
  }, [spec.widthIn, spec.heightIn, spec.radiusIn, depth]);

  const textures = useMemo(() => {
    const front = placeholderFront(spec, anisotropy);
    const back =
      spec.backMode === 'blank' ? blankFace(spec, anisotropy) : spec.backMode === 'same_as_front' ? front : placeholderBack(spec, anisotropy);
    return { front, back, grain: paperGrain(spec) };
    // Textures only depend on dimensions and back mode, not on finish.
  }, [spec.widthIn, spec.heightIn, spec.backMode, anisotropy]);

  useEffect(() => {
    invalidate();
    return () => {
      edge.dispose();
      face.dispose();
    };
  }, [edge, face, invalidate]);

  useEffect(
    () => () => {
      textures.front.dispose();
      textures.back.dispose();
      textures.grain.dispose();
    },
    [textures],
  );

  const frontMap = artwork?.front ?? textures.front;
  const backMap = spec.backMode === 'blank' ? textures.back : spec.backMode === 'same_as_front' ? frontMap : (artwork?.back ?? textures.back);

  return (
    <group>
      <mesh geometry={edge}>
        <meshStandardMaterial color={spec.frontFinish === 'none' ? '#f4f0e6' : '#f2f2ef'} roughness={0.9} />
      </mesh>
      <mesh geometry={face} position={[0, 0, depth / 2 + FACE_OFFSET]}>
        <FaceMaterial finish={spec.frontFinish} map={frontMap} grain={textures.grain} />
      </mesh>
      <mesh geometry={face} position={[0, 0, -depth / 2 - FACE_OFFSET]} rotation={[0, Math.PI, 0]}>
        <FaceMaterial finish={spec.backFinish} map={backMap} grain={textures.grain} />
      </mesh>
    </group>
  );
}
