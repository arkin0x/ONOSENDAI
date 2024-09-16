import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Text } from '@react-three/drei';

const Warning = ({ width = 3, height = 1, stripeWidth = 0.2, centerRectRatio = 0.5 }) => {
  const groupRef = useRef();
  const geometry = useMemo(() => new THREE.PlaneGeometry(width, height), [width, height]);

  const material = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024 / 3;
    const ctx = canvas.getContext('2d');

    // Calculate stripe angle
    const angle = Math.atan2(canvas.height, canvas.width);

    // Create diagonal stripes
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const stripeCount = Math.ceil(canvas.width / (stripeWidth * canvas.width)) * 2;
    const stripeThickness = canvas.width * stripeWidth;

    ctx.fillStyle = '#660000';
    for (let i = 0; i < stripeCount; i++) {
      ctx.save();
      ctx.translate(i * stripeThickness, 0);
      ctx.rotate(angle);
      ctx.fillRect(0, 0, stripeThickness * 2, canvas.height * 2);
      ctx.restore();
    }

    // Create center black rectangle
    const centerWidth = canvas.width * centerRectRatio;
    const centerHeight = canvas.height * centerRectRatio;
    ctx.fillStyle = 'black';
    ctx.fillRect(
      (canvas.width - centerWidth) / 2,
      (canvas.height - centerHeight) / 2,
      centerWidth,
      centerHeight
    );

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    return new THREE.MeshBasicMaterial({ map: texture });
  }, [stripeWidth, centerRectRatio]);

  useFrame(({ camera }) => {
    if (groupRef.current) {
      groupRef.current.lookAt(camera.position);
    }
  });

  return (
    <group ref={groupRef} position={[0, 0, -2]}>
      <mesh geometry={geometry} material={material} />
      <Text 
        position={[0, 0, 0.15]} 
        fontSize={height * 0.2}
        color="#999999"
        anchorX="center"
        anchorY="middle"
      >
        WARNING
      </Text>
    </group>
  );
};

export default Warning;