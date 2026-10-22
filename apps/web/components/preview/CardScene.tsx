'use client';

import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { NeutralToneMapping, type Group } from 'three';
import { cameraDistance, type CardSpec } from '../../lib/card3d';
import { CardMesh } from './CardMesh';
import { useImageTexture } from './useImageTexture';

const FOV = 32;
const AUTO_ROTATE_SPEED = 0.45; // radians per second
const BASE_TILT_X = -0.12;

export type CardSide = 'front' | 'back';

/** Artwork image URL per side (template SVG or uploaded PDF page); null shows the sample design. */
export interface ArtworkImages {
  front: string | null;
  back: string | null;
}

interface SceneProps {
  spec: CardSpec;
  artwork?: ArtworkImages;
  /** Plain card without the sample design. */
  blank?: boolean;
  /** Bumped by the Front/Back buttons; the card turns to that side. */
  turnRequest: { side: CardSide; id: number } | null;
  autoRotate: boolean;
  onUserInteract: () => void;
}

/** Nearest angle to `current` that shows the requested side (0 = front, PI = back, plus full turns). */
function targetAngle(current: number, side: CardSide): number {
  const offset = side === 'front' ? 0 : Math.PI;
  return Math.round((current - offset) / (2 * Math.PI)) * 2 * Math.PI + offset;
}

function TurningCard({ spec, artwork, blank, turnRequest, autoRotate }: Omit<SceneProps, 'onUserInteract'>) {
  const group = useRef<Group>(null);
  const target = useRef<number | null>(null);
  const invalidate = useThree((state) => state.invalidate);
  const front = useImageTexture(artwork?.front ?? null, spec.widthIn, spec.heightIn);
  const back = useImageTexture(artwork?.back ?? null, spec.widthIn, spec.heightIn);

  useEffect(() => {
    if (!turnRequest || !group.current) return;
    target.current = targetAngle(group.current.rotation.y, turnRequest.side);
    // frameloop="demand": nothing renders until asked, so start the turn animation explicitly.
    invalidate();
  }, [turnRequest, invalidate]);

  useEffect(() => {
    if (autoRotate) invalidate();
  }, [autoRotate, invalidate]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    if (target.current !== null) {
      const diff = target.current - g.rotation.y;
      if (Math.abs(diff) < 0.001) {
        g.rotation.y = target.current;
        target.current = null;
      } else {
        g.rotation.y += diff * Math.min(1, delta * 6);
        state.invalidate();
      }
    } else if (autoRotate) {
      g.rotation.y += delta * AUTO_ROTATE_SPEED;
      state.invalidate();
    }
  });

  return (
    <group ref={group} rotation={[BASE_TILT_X, 0, 0]}>
      <CardMesh spec={spec} blank={blank} artwork={{ front: front ?? undefined, back: back ?? undefined }} />
    </group>
  );
}

/** Keeps the whole card in view when its size or the canvas aspect changes. */
function FrameCamera({ spec }: { spec: CardSpec }) {
  const camera = useThree((state) => state.camera);
  const aspect = useThree((state) => state.size.width / Math.max(state.size.height, 1));
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    camera.position.setLength(cameraDistance(spec, FOV, aspect));
    camera.updateProjectionMatrix();
    invalidate();
  }, [camera, aspect, spec.widthIn, spec.heightIn, invalidate, spec]);

  return null;
}

export default function CardScene({ spec, artwork, blank, turnRequest, autoRotate, onUserInteract }: SceneProps) {
  const maxDim = Math.max(spec.widthIn, spec.heightIn);
  const distance = cameraDistance(spec, FOV, 1.4);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: FOV, position: [0, 0, distance], near: 0.1, far: 100 }}
      // Neutral tone mapping keeps white paper white (the default ACES curve greys it out).
      gl={{ antialias: true, alpha: true, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
      aria-label="3D preview of your business card. Drag to rotate."
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 4, 6]} intensity={1.8} />
      <directionalLight position={[-4, -2, -5]} intensity={0.5} />

      {/* Studio built from light panels (no HDR download). The dark base plus one narrow, strong
          strip gives shiny finishes a visible moving highlight; matte paper stays even. */}
      <Environment resolution={256}>
        <color attach="background" args={['#3b3a38']} />
        <Lightformer form="rect" intensity={6} position={[1.5, 2, 5]} rotation-z={Math.PI / 5} scale={[0.5, 12, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[0, 5, 2]} rotation-x={Math.PI / 2} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={1} position={[-5, 0, 3]} rotation-y={Math.PI / 3} scale={[3, 6, 1]} />
        <Lightformer form="rect" intensity={1} position={[5, 0, 3]} rotation-y={-Math.PI / 3} scale={[3, 6, 1]} />
      </Environment>

      <TurningCard spec={spec} artwork={artwork} blank={blank} turnRequest={turnRequest} autoRotate={autoRotate} />

      <ContactShadows position={[0, -maxDim * 0.7, 0]} opacity={0.35} scale={maxDim * 3} blur={2.4} far={maxDim * 2} />

      <FrameCamera spec={spec} />
      <OrbitControls
        enablePan={false}
        enableDamping
        minDistance={maxDim * 1.2}
        maxDistance={maxDim * 6}
        onStart={onUserInteract}
      />
    </Canvas>
  );
}
